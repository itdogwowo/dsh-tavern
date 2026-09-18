window.__ModuleLoader__.load({
  id: 'dsh-tavern',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    /* ------------------------------------------------------------------ *
     * dsh-tavern — 瀏覽器半（v2：只有 UI 與檔案）
     *
     * 掛兩個座位：
     *   sidebar.workspaces    → 側邊欄的「酒館街」區塊（與原生工作區上下並排）
     *   main / 'tavern'       → 這間酒館的設定頁（純檔案瀏覽）
     *   main / 'tavern-chats' → 一份對話紀錄的資訊頁
     *   settings.plugin.item  → 設定 → 插件 → 酒館卡片
     *
     * 這裡只做兩件事：畫畫面、呼叫宿主半的檔案 API。
     * **不碰模型、不碰提示詞、不碰 agent**——那些會讓 DSH 啟動時跟核心服務糾纏，
     * 是上一個版本把 DSH 卡死的原因，所以整批拿掉了。
     * ------------------------------------------------------------------ */

    /**
     * 這份 client bundle 的建置標記。
     *
     * DSH 的 client bundle 是**行程啟動時的快照**，所以「頁面上跑的是新是舊」
     * 不能靠重新整理判斷。把這個字串顯示在側邊欄區塊的 tooltip 上，
     * 就能一眼確認載入的是哪一版——不用開 DevTools。
     */
    var CLIENT_BUILD = 'tavern-client-2.5.1'

    var RPC = '/api/dsh-tavern/rpc'

    /**
     * 酒館模式的 preset id。
     *
     * ⚠️ 這是**我們自己裝的那一份** preset 的資料夾名（`lib/preset.js` 的 `PRESET_ID`）。
     * 它必須跟那裡一致——`session.create({agentPreset})` 只認 roster id，
     * 而且 id 會變成資料夾名，所以只能英數與連字號。
     */
    var TAVERN_PRESET_ID = 'dsh-tavern'

    /**
     * 這份 client bundle 的 Cordis context。掛載時存下來，讓 UI 可以讀 client 服務
     * （例如挑資料夾用的 `uiWorkspace.pickDirectory()`）。
     */
    var ctxRef = null

    /**
     * 離線測試用的初始狀態。
     *
     * 正式路徑永遠是 `{ loaded: false }`，元件第一件事就是去問宿主半。
     * `test-client.mjs` 會把 `loaded` 設成 true，這樣才能在沒有真 React runtime
     * 的情況下斷言「載入完成後畫面真的有內容」——那是先前真的踩過的坑。
     */
    var testSeed = { loaded: false }

    /**
     * 建立 Package 私有 RPC 的實作。
     *
     * 抽成工廠是為了測試：`test-client.mjs` 會注入假的 fetch，用假的微任務排程器
     * 真的跑一次非同步鏈，驗證「載入失敗時一定離開載入中」——那正是最難診斷的失敗。
     */
    function createRpc(deps) {
      var doFetch = deps.fetch
      var setTimer = deps.setTimeout
      var clearTimer = deps.clearTimeout
      var Abort = deps.AbortController

      /**
       * 一次呼叫。
       *
       * 逾時語意對齊官方 `@deepseek-ai/dsh-timeout` 的設計（見它的 README）：
       *   - 逾時「只負責通知」，呼叫端必須自己接上終止機制 → 這裡把 signal 交給 fetch；
       *   - 逾時與上游取消要分得出來 → 只有本地 timer 先觸發時才回報逾時；
       *   - 不提供「0 = 停用逾時」這種公開開關，逾時一定是正有限值。
       *
       * `options.signal` 是外部的取消來源（元件卸載時用），與本地逾時合併成一個訊號。
       */
      return function rpc(op, args, timeoutMs, options) {
        var limit = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 15000
        var upstream = options !== undefined && options !== null ? options.signal : undefined
        var controller = typeof Abort === 'function' ? new Abort() : null

        var timedOut = false
        var cancelled = upstream !== undefined && upstream !== null && upstream.aborted === true
        var timer = null
        var stopTimer = function () {
          if (timer !== null) {
            clearTimer(timer)
            timer = null
          }
        }
        var onUpstreamAbort = function () {
          cancelled = true
          stopTimer()
          if (controller !== null) {
            try {
              controller.abort()
            } catch (error) {
              /* 已結束 */
            }
          }
        }

        if (controller !== null) {
          timer = setTimer(function () {
            timedOut = true
            try {
              controller.abort()
            } catch (error) {
              /* 已結束 */
            }
          }, limit)
        }

        if (upstream !== undefined && upstream !== null) {
          if (upstream.aborted === true) {
            // 已經被取消：不必送出請求。
            stopTimer()
            return Promise.reject(new Error('已取消'))
          }
          if (typeof upstream.addEventListener === 'function') {
            upstream.addEventListener('abort', onUpstreamAbort)
          }
        }

        return doFetch(RPC + '?op=' + encodeURIComponent(op), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(args === undefined ? {} : args),
          signal: controller === null ? undefined : controller.signal,
        })
          .then(function (response) {
            return response.json()
          })
          .then(function (payload) {
            // 取消之後就不要套用結果——否則晚回來的回應會蓋掉新狀態。
            if (cancelled) throw new Error('已取消')
            if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
              throw new Error(payload && payload.error ? String(payload.error) : 'rpc failed')
            }
            return payload.value
          })
          .catch(function (error) {
            if (cancelled && !timedOut) throw new Error('已取消')
            if (timedOut) throw new Error('逾時（超過 ' + String(limit) + 'ms 沒有回應）')
            throw error
          })
          .finally(function () {
            stopTimer()
            if (upstream !== undefined && upstream !== null && typeof upstream.removeEventListener === 'function') {
              upstream.removeEventListener('abort', onUpstreamAbort)
            }
          })
      }
    }

    var rpc = createRpc({
      fetch: function (url, options) {
        return fetch(url, options)
      },
      setTimeout: function (fn, ms) {
        return setTimeout(fn, ms)
      },
      clearTimeout: function (id) {
        return clearTimeout(id)
      },
      AbortController: typeof AbortController === 'function' ? AbortController : null,
    })

    /** 測試用：換掉 RPC 實作，好在沒有真網路的情況下驗證載入流程。 */
    function setRpc(next) {
      if (typeof next === 'function') rpc = next
    }

    /* ---------------------- 酒館對話的 DSH session ---------------------- */

    /**
     * 對話的 session 生命週期：開、回復、送訊息、取消。
     *
     * ────────────────────────────────────────────────────────────────────
     * ⚠️ **R2：`remote.session` 不可以寫進 client bundle 的 `inject` 陣列。**
     *
     * 客戶端插件的 `inject` 等不到服務時，DSH 的啟動核心會把整個 GUI 判成
     * 「沒掛起來」——**白屏**，不是「酒館壞掉」。所以一律用 `ctx.get()`，
     * 而且**在真的要用的那一刻才拿**（那時服務樹早就穩定了）。
     *
     * 拿不到時的行為：回報「這台 DSH 沒有對話服務」，酒館的其他功能照常。
     * ────────────────────────────────────────────────────────────────────
     */
    function sessionsService() {
      if (ctxRef === null || typeof ctxRef.get !== 'function') return null
      try {
        var service = ctxRef.get('remote.session')
        return service === undefined || service === null ? null : service
      } catch (error) {
        return null
      }
    }

    /** 這台 DSH 有沒有對話服務（UI 用它決定要不要顯示「開始聊天」）。 */
    function chatAvailable() {
      var service = sessionsService()
      return service !== null && typeof service.create === 'function'
    }

    /**
     * 把 `RemoteResult` 攤平成值或例外。
     *
     * DSH 的 Remote 一律回 `{ok:true,value}` 或 `{ok:false,error}`，
     * **不會因為傳輸問題 reject**——所以「ok 是 false」要當成正常的失敗路徑處理。
     */
    function unwrapRemote(result, what) {
      if (result !== null && typeof result === 'object' && result.ok === true) return result.value
      var raw = result !== null && typeof result === 'object' && result.error ? result.error : null
      var message = raw === null ? '' : String(raw.message || raw.code || raw)
      throw new Error(what + '失敗：' + (message === '' ? '沒有回報原因' : message))
    }

    /** 送一則使用者訊息需要的識別碼（DSH 用它去重複）。 */
    function mintRequestId() {
      return 'tavern-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
    }

    /**
     * 從逐字串流的 frame 取出文字。
     *
     * `frame.chunk` 是 provider 原始的 `StreamChunk`；我們只認文字增量，
     * 其他（reasoning、工具呼叫…）一律忽略——**不認識的東西不要亂猜**。
     *
     * @returns 文字，或 `''`。
     */
    function textDeltaOf(frame) {
      if (frame === null || typeof frame !== 'object') return ''
      if (frame.type !== 'chunk') return ''
      var chunk = frame.chunk
      if (chunk === null || typeof chunk !== 'object') return ''
      if (chunk.type !== 'text-delta') return ''
      return typeof chunk.text === 'string' ? chunk.text : ''
    }

    /**
     * 從 frame 取出**思考**（reasoning）增量。
     *
     * 模型在 reasoning 階段的輸出是 `reasoning-delta`（跟 `text-delta` 同層的 chunk
     * 型別，DSH 原生的 `isTokenDelta()` 也是這樣認的）。以前這一條被當成「不認識的
     * 東西」丟掉——於是模型在思考的那幾秒畫面上什麼都沒有，看起來像卡住。
     */
    function reasoningDeltaOf(frame) {
      if (frame === null || typeof frame !== 'object') return ''
      if (frame.type !== 'chunk') return ''
      var chunk = frame.chunk
      if (chunk === null || typeof chunk !== 'object') return ''
      if (chunk.type !== 'reasoning-delta') return ''
      return typeof chunk.text === 'string' ? chunk.text : ''
    }

    /**
     * 從 frame 取出**思考**（reasoning）增量。
     *
     * 模型在 reasoning 階段的輸出是 `reasoning-delta`，跟 `text-delta` 是同一層的
     * chunk 型別（DSH 原生的 `isTokenDelta()` 也是這樣認的）。
     *
     * 以前這一條被當成「不認識的東西」直接丟掉——於是模型在思考的那幾秒，
     * 畫面上**什麼都沒有**，看起來像卡住。DSH 原生會在那段時間顯示一列會流動的
     * 「思考」，所以我們也照做。
     *
     * @returns 思考的文字增量，或 `''`。
     */
    function reasoningDeltaOf(frame) {
      if (frame === null || typeof frame !== 'object') return ''
      if (frame.type !== 'chunk') return ''
      var chunk = frame.chunk
      if (chunk === null || typeof chunk !== 'object') return ''
      if (chunk.type !== 'reasoning-delta') return ''
      return typeof chunk.text === 'string' ? chunk.text : ''
    }


    /**
     * 把一段訊息切成「有角色的行」——敘事／台詞／動作。
     *
     * 用最保守的規則分類：`（…）` ＝動作、引號開頭＝台詞、其餘＝敘事。
     * **不做**的事：不猜情緒、不解析 HTML、不碰 `*…*`（那是 Markdown 斜體，
     * 但在中文卡片裡常被當動作——寧可留給正則腳本，不要猜錯）。
     */
    function splitNarration(text) {
      var raw = typeof text === 'string' ? text : ''
      if (raw === '') return []
      var lines = raw.split('\n')
      var out = []
      for (var i = 0; i < lines.length; i += 1) {
        var trimmed = lines[i].trim()
        var kind = 'narration'
        if (trimmed !== '' && /^[（(].*[）)]$/.test(trimmed)) kind = 'action'
        else if (trimmed !== '' && /^[「『"“]/.test(trimmed)) kind = 'speech'
        out.push({ kind: kind, text: lines[i] })
      }
      return out
    }

    /** 把一段文字渲染成有角色的行（四種樣式見 docs/design-language.md §6）。 */
    function narrationRows(text) {
      return splitNarration(text).map(function (line, at) {
        return React.createElement(
          'div',
          { key: 'l' + String(at), className: 'dsh-tv-' + line.kind },
          line.text === '' ? ' ' : line.text,
        )
      })
    }

    /** 這一輪結束了嗎（`end` 且 outcome 是 committed）。 */
    function isCommittedEnd(frame) {
      if (frame === null || typeof frame !== 'object' || frame.type !== 'end') return false
      var outcome = frame.outcome
      return outcome !== null && typeof outcome === 'object' && outcome.kind === 'committed'
    }

    /**
     * 確保這個對話有一個可以用的 session。
     *
     * 流程（三步，順序不能換）：
     *   1. `preset.ensure`——酒館模式的 preset 要存在，`session.create` 才指名得到
     *   2. 反查有沒有既有綁定（`session.list`）→ 有就**回復**它
     *   3. 沒有就新開一個（`cwd` 指酒館資料夾），然後 `session.bind` 寫下對照表
     *
     * @returns `{ sessionId, created }`。
     */
    function ensureChatSession(tavernId, character, chat, root) {
      if (chatAvailable() === false) {
        return Promise.reject(new Error('這台 DSH 沒有對話服務（remote.session），只能管理檔案'))
      }
      return rpc('preset.ensure', {})
        .then(function () {
          return rpc('session.list', { id: tavernId })
        })
        .then(function (bindings) {
          var list = Array.isArray(bindings) ? bindings : []
          for (var i = 0; i < list.length; i += 1) {
            if (list[i].character === character && list[i].chat === chat) return list[i].sessionId
          }
          return ''
        })
        .then(function (existing) {
          var service = sessionsService()
          if (existing !== '') {
            // 回復：DSH 會用**當初那個 preset**重新組一次 composition。
            return service
              .create({ sessionId: existing })
              .then(function () {
                return { sessionId: existing, created: false }
              })
              .catch(function () {
                // 回復不了（session 被砍了？）→ 當作沒綁定，往下走新開一個。
                return null
              })
          }
          return null
        })
        .then(function (resumed) {
          if (resumed !== null) return resumed
          var service = sessionsService()
          return service
            .create({ cwd: root, agentPreset: TAVERN_PRESET_ID })
            .then(function (created) {
              return unwrapRemote(created, '開新對話')
            })
            .then(function (value) {
              var sessionId = value !== null && typeof value.sessionId === 'string' ? value.sessionId : ''
              if (sessionId === '') throw new Error('開新對話失敗：DSH 沒有回傳 session id')
              // 綁定：寫對照表（Agent 面靠它認出「這個 session 是誰」）
              return rpc('session.bind', { id: tavernId, sessionId: sessionId, character: character, chat: chat }).then(
                function () {
                  return { sessionId: sessionId, created: true }
                },
              )
            })
        })
    }

    /**
     * 送一則訊息，並把回覆逐字接回來。
     *
     * ⚠️ **先開始 follow，再送出 prompt**：反過來的話，模型可能在我們開始聽之前
     * 就開始吐字了。這是 DSH 的 `session.follow` 的用法（先開串流再送）。
     *
     * @param sessionId - 目標 session。
     * @param text - 使用者說的話。
     * @param handlers - `{ onDelta(text), signal }`。
     * @returns 這一輪的完整回覆文字。
     */
    function sendChatMessage(sessionId, text, handlers) {
      var onDelta = handlers !== null && typeof handlers === 'object' && typeof handlers.onDelta === 'function' ? handlers.onDelta : null
      var onReasoning =
        handlers !== null && typeof handlers === 'object' && typeof handlers.onReasoning === 'function'
          ? handlers.onReasoning
          : null
      var signal = handlers !== null && typeof handlers === 'object' ? handlers.signal : undefined

      if (chatAvailable() === false) return Promise.reject(new Error('這台 DSH 沒有對話服務'))
      var service = sessionsService()

      var stream
      try {
        stream = service.follow(
          { address: { kind: 'session', sessionId: sessionId }, assistantStream: true },
          signal,
        )
      } catch (error) {
        return Promise.reject(new Error('接上對話串流失敗：' + String((error && error.message) || error)))
      }
      if (stream === null || typeof stream !== 'object' || typeof stream[Symbol.asyncIterator] !== 'function') {
        return Promise.reject(new Error('接上對話串流失敗：DSH 沒有回傳可讀的串流'))
      }

      var collected = ''
      var reasoned = ''
      var settled = false

      var pump = (function () {
        var iterator = stream[Symbol.asyncIterator]()
        var step = function () {
          if (settled === true) return Promise.resolve()
          return iterator.next().then(function (result) {
            if (result.done === true) return undefined
            var frame = result.value
            // 只認 assistant-stream 的 frame：snapshot 與 durable event 交給別的畫面用。
            if (frame !== null && typeof frame === 'object' && frame.type === 'assistant-stream') {
              var inner = frame.frame
              // 思考（reasoning）與正文（text）是兩種 chunk，分開累積：
              // 思考不進 `.jsonl` 的正文，但要讓使用者看得到「模型正在想」。
              var thought = reasoningDeltaOf(inner)
              if (thought !== '' && onReasoning !== null) {
                reasoned += thought
                onReasoning(thought)
              }
              var delta = textDeltaOf(inner)
              if (delta !== '' && onDelta !== null) {
                collected += delta
                onDelta(delta)
              }
              if (isCommittedEnd(inner)) {
                settled = true
                return undefined
              }
            }
            return step()
          })
        }
        return step
      })()

      var pumping = pump().catch(function (error) {
        // 串流斷掉不是世界末日：已經收到的字還是要留給使用者。
        settled = true
        return undefined
      })

      var requestId = mintRequestId()
      return service
        .prompt({ requestId: requestId, sessionId: sessionId, mode: 'queue', content: [{ type: 'text', text: text }] })
        .then(function (result) {
          unwrapRemote(result, '送出訊息')
          return pumping
        })
        .then(function () {
          settled = true
          // `reasoning` 一起回：呼叫端要把它寫進 `.jsonl` 的 `extra.reasoning`
          // （SillyTavern 就是放在那裡）——思考是紀錄的一部分，不該只有畫面上看得到。
          return { text: collected, reasoning: reasoned, requestId: requestId }
        })
    }

    /** 打斷這一輪。 */
    function cancelChatMessage(sessionId) {
      if (chatAvailable() === false) return Promise.resolve()
      var service = sessionsService()
      if (typeof service.cancel !== 'function') return Promise.resolve()
      return service.cancel({ sessionId: sessionId }).then(
        function () {
          return undefined
        },
        function () {
          return undefined
        },
      )
    }

    /**
     * 送一個檔案給宿主半（**二進位 body**，不是 JSON）。
     *
     * 目前兩個使用者：上傳插圖、匯入 PNG 卡。兩者的參數都很少，所以放 query string，
     * body 留給檔案本身——一張圖常常好幾 MB，base64 會再多 33%。
     *
     * ⚠️ op 一定要用**字面字串**呼叫（`sendFile('assets.write', …)`）。smoke.mjs 的
     * 跨半契約檢查是掃原始碼找 op 名稱的；用變數組出來的話，那一層檢查會看不到它，
     * 就等於回到「面板呼叫了不存在的 op 而測試全綠」那個老問題。
     *
     * @param op - 宿主半的 op 名稱（字面字串）
     * @param params - 會被編進 query string 的參數
     * @param body - File 或 Blob
     */
    function sendFile(op, params, body, contentType) {
      var parts = []
      var keys = Object.keys(params || {})
      for (var i = 0; i < keys.length; i += 1) {
        parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(params[keys[i]]))
      }
      return fetch(RPC + '?op=' + op + (parts.length === 0 ? '' : '&' + parts.join('&')), {
        method: 'POST',
        headers: { 'content-type': contentType || 'application/octet-stream' },
        credentials: 'same-origin',
        body: body,
      }).then(function (response) {
        return response.json()
      })
    }

    /** 把 sendFile 的回應收斂成「ok 就回 value，否則丟錯」。 */
    function sendFileExpectOk(op, params, body, contentType) {
      return sendFile(op, params, body, contentType).then(function (payload) {
        if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
          throw new Error(payload && payload.error ? String(payload.error) : op + ' 失敗')
        }
        return payload.value
      })
    }

    /** 只依賴 useState：不碰可能在這個 runtime 缺席的 hook。 */
    function useForceRender() {
      var pair = React.useState(0)
      var setTick = pair[1]
      return function render() {
        setTick(function (n) {
          return n + 1
        })
      }
    }

    /** 插圖的四個掛載點（跟宿主半的 assetDir 對應）。 */
    var ASSET_LABELS = {
      character: '🎭 這個角色的插圖',
      worldbook: '📖 這本世界書的插圖',
      chat: '💬 這份對話的插圖',
      tavern: '🏠 這間酒館的店面圖',
    }

    /** 資料夾 → 說明（設定頁的「資料夾結構」用）。 */
    var ASSET_LABELS_BY_DIR = {
      characters: '人物卡',
      worldbooks: '世界書',
      chats: '對話紀錄',
      art: '插圖',
    }

    /** 給使用者看的「圖放在哪個資料夾」（可以直接去檔案總管丟圖）。 */
    /**
     * 從 `<input type="file">` 的 change 事件取出使用者挑的檔案。
     *
     * ⚠️ 這裡踩過一個**靜默失效**：以前寫成
     * ```js
     * var files = event.target.files
     * event.target.value = ''   // 想讓同一個檔案下次還能再選
     * use(files)                // ← 這時候 files 已經空了
     * ```
     * `event.target.files` 回傳的是**活的** `FileList`，`value = ''` 會**就地**
     * 把它清空（同一個物件，不是換一個新的），所以 `files.length` 變成 0，
     * 檔案永遠送不出去，而且不會有任何錯誤訊息——按鈕看起來完全正常。
     * 三個隱藏 input（插圖、匯入卡片、匯入世界書）都中過。
     *
     * 因此：**先複製成真正的陣列，再清 value。**
     */

    /**
     * 主題的 token 表（目前生效的那一組）。
     *
     * **權威來源是宿主**：`lib/theme.js` 持有完整色票，`theme.read` 會把
     * `defaults` / `lightDefaults` 一起送來。客戶端 bundle 沒有 ESM import，
     * 拿不到那一支，所以在**還沒讀到主題之前**先用下面這一份最小值撐著
     * ——不然第一次開啟時所有 `var(--dsh-tv-*)` 都是空的，畫面會是全裸的 HTML。
     */
    var FALLBACK_THEME_TOKENS = {
      'surface-0': '#14100D',
      'surface-1': '#1B1611',
      'surface-2': '#241C16',
      'surface-3': '#2E241C',
      hover: '#221B15',
      line: '#3A2E25',
      'line-soft': '#2A211A',
      'text-1': '#F3E6D2',
      'text-2': '#C6B199',
      'text-3': '#9C8A74',
      accent: '#E8A33D',
      'accent-hover': '#F5BC63',
      'accent-soft': 'rgba(232,163,61,.14)',
      live: '#E8A33D',
      info: '#7FA8C9',
      glow: '#D98A2B',
      danger: '#D96C5F',
      warn: '#E5B25D',
      ok: '#7FB069',
      'radius-sm': '6px',
      'radius-md': '8px',
      'radius-lg': '10px',
      'radius-pill': '999px',
      'shadow-1': '0 1px 2px rgba(0,0,0,.35)',
      'shadow-2': '0 12px 32px rgba(0,0,0,.45)',
      'speed-fast': '120ms',
      'speed-slow': '220ms',
      ease: 'cubic-bezier(.2,.8,.2,1)',
      font: '-apple-system,"Segoe UI","PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif',
      'font-reading': '"Iowan Old Style","Source Serif 4","Songti TC","Noto Serif TC",Georgia,serif',
      'font-mono': 'ui-monospace,SFMono-Regular,Consolas,monospace',
    }

    var themeTokens = {}
    ;(function seedThemeTokens() {
      for (var key in FALLBACK_THEME_TOKENS) {
        if (Object.prototype.hasOwnProperty.call(FALLBACK_THEME_TOKENS, key)) {
          themeTokens[key] = FALLBACK_THEME_TOKENS[key]
        }
      }
    })()

    /** token 層的 `<style>`（換主題只換這一層）。 */
    var themeStyle = null
    /** 目前套用的主題；`null`＝還沒讀到（用 fallback）。 */
    var activeTheme = null
    /** 已經為哪一間酒館讀過主題（換酒館要重讀）。 */
    var themeForTavern = null

    /**
     * 目前這一組 token → CSS 字串。
     *
     * **只寫認得的 token**：這一層的值會直接進 CSS，不該讓主題檔亂塞東西。
     */
    function themeTokensCss() {
      var lines = []
      for (var key in themeTokens) {
        if (Object.prototype.hasOwnProperty.call(themeTokens, key)) {
          lines.push('  --dsh-tv-' + key + ': ' + themeTokens[key] + ';')
        }
      }
      return ':root{\n' + lines.join('\n') + '\n}'
    }

    /**
     * 把宿主送來的預設 ＋ 這間酒館的覆寫併成目前這一組 token。
     *
     * @param defaults - 該基底的完整 token 表（宿主給）。
     * @param tokens - 這間酒館的覆寫。
     */
    function setThemeTokens(defaults, tokens) {
      var merged = {}
      var key
      var source = defaults !== null && defaults !== undefined && typeof defaults === 'object' ? defaults : {}
      for (key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) merged[key] = source[key]
      }
      var patch = tokens !== null && tokens !== undefined && typeof tokens === 'object' ? tokens : {}
      for (key in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, key) && source[key] !== undefined) merged[key] = patch[key]
      }
      // 宿主沒送到（或送少了）的項目，用 fallback 補齊——不然會缺 token。
      for (key in FALLBACK_THEME_TOKENS) {
        if (Object.prototype.hasOwnProperty.call(FALLBACK_THEME_TOKENS, key) && merged[key] === undefined) {
          merged[key] = FALLBACK_THEME_TOKENS[key]
        }
      }
      themeTokens = merged
    }

    /**
     * 把一份主題套上去（只換 token 那一層）。
     *
     * @param theme - `{ base, tokens }`，或 `null`（＝用預設）。
     * @param defaults - 深色基底的完整 token 表。
     * @param lightDefaults - 淺色基底的完整表。
     */
    function applyTheme(theme, defaults, lightDefaults) {
      activeTheme = theme
      var isLight = theme !== null && theme !== undefined && theme.base === 'light'
      var base = isLight && lightDefaults !== undefined ? lightDefaults : defaults
      if (base !== undefined) {
        setThemeTokens(base, theme === null || theme === undefined ? {} : theme.tokens)
      }
      if (themeStyle === null || themeStyle === undefined) return
      themeStyle.textContent = themeTokensCss()
    }

    /** 目前套用中的主題（給測試與設定頁看）。 */
    function currentTheme() {
      return activeTheme
    }

    /**
     * 讀目前酒館的主題並套用。**只在一間酒館讀一次**；失敗就用預設
     * ——主題讀不到不該讓整個面板壞掉。
     */
    function ensureTheme(tavernId) {
      if (themeStyle === null || themeStyle === undefined) return Promise.resolve(null)
      var id = typeof tavernId === 'string' ? tavernId : ''
      if (id === '') {
        themeForTavern = ''
        applyTheme(null)
        return Promise.resolve(null)
      }
      if (themeForTavern === id) return Promise.resolve(activeTheme)
      themeForTavern = id
      return rpc('theme.read', { id: id }, 8000)
        .then(function (payload) {
          var body = payload !== null && typeof payload === 'object' ? payload : {}
          applyTheme(body.theme, body.defaults, body.lightDefaults)
          return body.theme
        })
        .catch(function () {
          applyTheme(null)
          return null
        })
    }

    var MAP_CSS = [
      '.dsh-tv-mapHead{display:flex;align-items:center;gap:10px;padding:14px 20px 12px;border-bottom:1px solid var(--dsh-tv-line)}',
      '.dsh-tv-mapTitle{margin:0;font-size:16px;font-weight:600;flex:1}',
      '.dsh-tv-mapBody{flex:1;min-height:0;overflow-y:auto;padding:18px 20px 40px}',
      '.dsh-tv-btn{border:1px solid var(--dsh-tv-line);background:var(--dsh-tv-surface-2);',
      'color:var(--dsh-tv-text-1);font:inherit;font-size:12px;padding:5px 12px;border-radius:var(--dsh-tv-radius-pill);cursor:pointer;white-space:nowrap}',
      '.dsh-tv-btn:hover{border-color:var(--dsh-tv-accent)}',
      '.dsh-tv-btnPrimary{background:var(--dsh-tv-accent);border-color:transparent;color:var(--dsh-tv-surface-0);font-weight:600}',
      '.dsh-tv-btnDanger:hover{border-color:var(--dsh-tv-danger);color:var(--dsh-tv-danger)}',
      '.dsh-tv-empty{border:1px dashed var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-md);padding:26px 20px;text-align:center;',
      'color:var(--dsh-tv-text-2);font-size:12.5px}',
      '.dsh-tv-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}',
      '.dsh-tv-fieldLabel{font-size:11.5px;color:var(--dsh-tv-text-2)}',
      '.dsh-tv-fieldHint{font-size:10.5px;color:var(--dsh-tv-text-3);line-height:1.5}',
      '.dsh-tv-in,.dsh-tv-ta{width:100%;padding:7px 10px;border-radius:var(--dsh-tv-radius-sm);font:inherit;outline:none;box-sizing:border-box;',
      'border:1px solid var(--dsh-tv-line);background:var(--dsh-tv-surface-2);',
      'color:var(--dsh-tv-text-1)}',
      '.dsh-tv-in:focus,.dsh-tv-ta:focus{border-color:var(--dsh-tv-accent)}',
      '.dsh-tv-ta{resize:vertical;line-height:1.6;min-height:70px}',
      '.dsh-tv-note{font-size:11.5px;color:var(--dsh-tv-text-3);line-height:1.6}',
      '.dsh-tv-err{border:1px solid rgba(248,81,73,.5);color:var(--dsh-tv-danger);border-radius:var(--dsh-tv-radius-sm);padding:7px 10px;font-size:11.5px;margin-bottom:12px}',
      '.dsh-tv-errRow{display:flex;align-items:center;gap:10px;border:1px solid rgba(248,81,73,.5);border-radius:var(--dsh-tv-radius-sm);',
      'padding:7px 10px;margin-bottom:12px}',
      '.dsh-tv-errText{flex:1;min-width:0;color:var(--dsh-tv-danger);font-size:11.5px;line-height:1.5;word-break:break-word}',
      '.dsh-tv-ok{border:1px solid rgba(63,185,80,.45);color:var(--dsh-tv-ok);border-radius:var(--dsh-tv-radius-sm);padding:7px 10px;font-size:11.5px;margin-bottom:12px}',
      // 一行裡的輸入框＋按鈕（設定頁的「名稱」那一列）。
      '.dsh-tv-inlineRow{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
      '.dsh-tv-inlineRow .dsh-tv-in{flex:1;min-width:0}',
      // ⚠️ 以前叫 `.dsh-tv-split`，跟側邊欄的**拖曳分隔線**同名（見下面那條）——
      // 同名的 CSS 規則一定會半途蓋掉彼此。設定頁的兩欄排版叫 `splitGrid`，
      // 分隔線叫 `divider`。
      '.dsh-tv-splitGrid{display:grid;grid-template-columns:230px 1fr;gap:16px;align-items:start}',
      '.dsh-tv-list{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.dsh-tv-listItem{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:var(--dsh-tv-radius-sm);cursor:pointer;',
      'border:1px solid transparent;background:transparent}',
      '.dsh-tv-listItem:hover{background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-listItemOn{border-color:var(--dsh-tv-accent);background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-listPick{flex:1;min-width:0;border:none;background:0 0;font:inherit;font-size:12.5px;text-align:left;',
      'cursor:pointer;color:inherit;padding:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}',
      '.dsh-tv-splitMain{min-width:0}',
      // 資料夾結構的標籤（「這間酒館」分區）。
      '.dsh-tv-layout{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}',
      '.dsh-tv-chip{border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-pill);padding:2px 9px;',
      'font-size:11px;color:var(--dsh-tv-text-2)}',
      '.dsh-tv-dash{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px;margin-bottom:16px}',
      '.dsh-tv-stat{border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-md);padding:11px 13px}',
      '.dsh-tv-statN{font-size:20px;font-weight:600}',
      '.dsh-tv-statL{font-size:11px;color:var(--dsh-tv-text-2)}',
      '.dsh-tv-path{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsh-tv-text-3);',
      'word-break:break-all;margin:4px 0 0}',
      '.dsh-tv-icon{display:flex;align-items:center;justify-content:center;line-height:1}',
      '.dsh-tv-card{border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-md);padding:12px 13px;',
      'display:flex;flex-direction:column;gap:8px;background:var(--dsh-tv-surface-1)}',
      '.dsh-tv-cardName{font-size:13px;font-weight:600;display:flex;align-items:center;gap:7px}',
      '.dsh-tv-cardDesc{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9aa4b2);line-height:1.55}',
      '.dsh-tv-two{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
      '.dsh-tv-check{display:flex;align-items:flex-start;gap:9px;cursor:pointer;margin-bottom:12px;font-size:12.5px}',
      '.dsh-tv-check input{margin-top:3px;flex:none}',
      '.dsh-tv-checkHint{display:block;font-size:10.5px;color:var(--dsh-tv-text-3);line-height:1.5}',
      '.dsh-tv-hr{height:1px;background:var(--dsh-tv-line);margin:20px 0 18px}',
      '.dsh-tv-assets{border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-md);padding:11px 12px;margin-bottom:14px;',
      'background:var(--dsh-tv-surface-1);display:flex;flex-direction:column;gap:5px}',
      '.dsh-tv-assetsHead{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;margin-bottom:2px}',
      '.dsh-tv-assetRow{font-size:11.5px;color:var(--dsh-tv-text-3);line-height:1.5}',
      '.dsh-tv-assetOn{color:var(--dsh-tv-text-2)}',
      // 插圖管理：一組圖 + 主圖。縮圖格用固定大小，數量多的時候自己換行。
      '.dsh-tv-assetsBox{border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-md);padding:11px 12px;margin:14px 0;',
      'background:var(--dsh-tv-surface-1)}',
      '.dsh-tv-assetsBar{display:flex;align-items:center;gap:9px;margin-bottom:9px;flex-wrap:wrap}',
      '.dsh-tv-drop{border:1px dashed var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-md);padding:8px;min-height:44px;',
      'transition:border-color .12s var(--ds-ease-in-out,ease),background .12s var(--ds-ease-in-out,ease)}',
      '.dsh-tv-dropOn{border-color:var(--dsh-tv-accent);background:var(--dsh-tv-accent-soft)}',
      '.dsh-tv-thumbs{display:flex;flex-wrap:wrap;gap:7px}',
      '.dsh-tv-thumb{position:relative;width:74px;height:74px;border-radius:var(--dsh-tv-radius-md);overflow:hidden;cursor:pointer;flex:none;',
      'border:1px solid var(--dsh-tv-line);background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-thumbOn{border-color:var(--dsh-tv-accent);box-shadow:0 0 0 1px var(--dsh-tv-accent)}',
      '.dsh-tv-thumb img{width:100%;height:100%;object-fit:cover;display:block}',
      '.dsh-tv-thumbTag{position:absolute;left:0;bottom:0;font-size:9px;padding:1px 5px;border-top-right-radius:6px;',
      'background:var(--dsh-tv-accent);color:var(--dsh-tv-surface-0);font-weight:600}',
      '.dsh-tv-thumbDel{position:absolute;right:2px;top:2px;width:17px;height:17px;border-radius:50%;border:none;cursor:pointer;',
      'background:rgba(0,0,0,.6);color:var(--dsh-tv-surface-1);font-size:10px;line-height:1;padding:0;opacity:0;transition:opacity .12s ease}',
      '.dsh-tv-thumb:hover .dsh-tv-thumbDel{opacity:1}',
      // 清單裡的迷你臉：有主圖就畫圖，沒有就畫一個淡框。
      '.dsh-tv-face{width:26px;height:26px;border-radius:var(--dsh-tv-radius-sm);object-fit:cover;flex:none}',
      '.dsh-tv-faceEmpty{width:26px;height:26px;border-radius:var(--dsh-tv-radius-sm);flex:none;display:flex;align-items:center;justify-content:center;',
      'font-size:12px;opacity:.4;border:1px solid var(--dsw-alias-border-l1,#2a3140)}',
      '.dsh-tv-count{font-size:10px;color:var(--dsw-alias-label-tertiary,#6b7280);font-variant-numeric:tabular-nums}',
      // 舊版殘留的標記與說明方塊。
      '.dsh-tv-legacy{font-size:9.5px;padding:1px 6px;border-radius:var(--dsh-tv-radius-pill);flex:none;margin-left:5px;cursor:help;',
      'border:1px solid var(--dsh-tv-line);color:var(--dsh-tv-text-3)}',
      '.dsh-tv-legacyBox{border:1px solid var(--dsh-tv-line);border-left:3px solid var(--dsh-tv-warn);border-radius:var(--dsh-tv-radius-md);',
      'padding:10px 12px;margin:0 0 14px;display:flex;flex-direction:column;gap:5px;',
      'background:var(--dsh-tv-accent-soft)}',
      '.dsh-tv-legacyTitle{font-size:12.5px;font-weight:600}',
      '.dsh-tv-thumbRow{display:flex;align-items:center;gap:4px;margin-top:5px}',
      '.dsh-tv-thumbSm{width:20px;height:20px;border-radius:var(--dsh-tv-radius-sm);object-fit:cover;opacity:.75}',
      '.dsh-tv-thumbSmOn{opacity:1;box-shadow:0 0 0 1px var(--dsh-tv-accent)}',
      '.dsh-tv-fileTag{font-size:10px;padding:1px 7px;border-radius:var(--dsh-tv-radius-pill);border:1px solid var(--dsh-tv-line);',
      'color:var(--dsh-tv-text-3);font-weight:400}',
      '.dsh-tv-tavern{border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-md);padding:11px 12px;',
      'background:var(--dsh-tv-surface-1)}',
      '.dsh-tv-tavernOn{border-color:var(--dsh-tv-accent);background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-tavernRow{display:flex;align-items:center;gap:9px}',
      '.dsh-tv-tavernName{font-size:13px;font-weight:600;display:flex;align-items:center;gap:7px}',
      // 對話畫面：訊息泡泡 ＋ 輸入區。
      // 泡泡用「誰說的」分左右：使用者靠右、角色靠左——跟其他聊天介面同一個直覺。
      '.dsh-tv-chatBody{display:flex;flex-direction:column;gap:10px}',
      '.dsh-tv-chatLog{display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto;padding:2px}',
      '.dsh-tv-bubble{max-width:78%;align-self:flex-start;border:1px solid var(--dsh-tv-line);',
      'border-radius:var(--dsh-tv-radius-md);padding:8px 11px;background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-bubbleMe{align-self:flex-end;border-color:var(--dsh-tv-accent);',
      'background:var(--dsh-tv-accent-soft)}',
      '.dsh-tv-bubbleWho{font-size:10.5px;font-weight:600;margin-bottom:3px;color:var(--dsh-tv-text-3)}',
      '.dsh-tv-bubbleText{font-family:var(--dsh-tv-font-reading);font-size:15.5px;line-height:1.9;',
      'max-width:34em;white-space:pre-wrap;word-break:break-word;',
      'color:var(--dsh-tv-text-1)}',
      '.dsh-tv-narration{color:var(--dsh-tv-text-1)}',
      '.dsh-tv-speech{color:var(--dsh-tv-text-1)}',
      '.dsh-tv-action{color:var(--dsh-tv-text-2);font-weight:400}',
      '.dsh-tv-thought{color:var(--dsh-tv-text-3);border-left:2px solid var(--dsh-tv-line);padding-left:12px}',
      '.dsh-tv-chatInput{margin-top:10px;border-top:1px solid var(--dsh-tv-line);padding-top:10px}',
      // 「思考」那一列。形狀照原生 `ReasoningRow`：一行（可折疊）＋ 收合時的一小段
      // 預覽；**streaming 時疊一層流動的高光**（原生是 `:after` 的
      // `dsh-reasoning-row-sweep` 動畫）。
      '.dsh-tv-think{position:relative;overflow:hidden;display:flex;align-items:center;gap:6px;',
      'height:24px;padding:0 6px;border-radius:var(--dsh-tv-radius-sm);cursor:pointer;user-select:none;',
      'color:var(--dsh-tv-text-2);font-size:12px}',
      '.dsh-tv-think:hover{background:var(--dsh-tv-accent-soft)}',
      '.dsh-tv-thinkIcon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px}',
      '.dsh-tv-thinkLabel{flex:none}',
      '.dsh-tv-thinkPeek{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
      'color:var(--dsh-tv-text-3)}',
      '.dsh-tv-thinkChevron{flex:none;display:inline-flex;align-items:center;justify-content:center;',
      'color:var(--dsh-tv-text-2);transition:transform .15s ease}',
      '.dsh-tv-thinkOn .dsh-tv-thinkChevron{transform:rotate(90deg)}',
      '.dsh-tv-think:after{content:"";position:absolute;left:0;inset-block:0;width:300px;pointer-events:none;',
      // `color-mix` 在舊引擎不支援，所以底色用主題的 hover 色＋透明漸層（視覺等價）。
      'background:linear-gradient(90deg,transparent 0%,var(--dsh-tv-accent-soft) 55%,transparent 100%)}',
      '.dsh-tv-thinkRun:after{animation:dsh-tv-sweep 2.6s ease-out infinite}',
      // 寬度上限跟氣泡一致（`max-width:78%`）：思考全文可能很長，鋪滿整個對話寬度
      // 會把正文擠到看不見。
      '.dsh-tv-thinkGroup{max-width:78%;align-self:flex-start}',
      '.dsh-tv-thinkText{margin:2px 0 6px;padding:8px 10px;border-radius:var(--dsh-tv-radius-sm);white-space:pre-wrap;word-break:break-word;',
      'font-size:12.5px;line-height:1.6;color:var(--dsh-tv-text-2);',
      'background:var(--dsh-tv-accent-soft)}',
      '@keyframes dsh-tv-sweep{from{transform:translateX(-300px)}to{transform:translateX(100%)}}',
      '@media (prefers-reduced-motion:reduce){.dsh-tv-thinkRun:after{animation:none}}',
      '.dsh-tv-mini{font-size:11px;color:var(--dsh-tv-text-3);font-variant-numeric:tabular-nums;margin-top:2px}',
      // 分區標題 + 「＋」：與 DSH 工作區區塊同一個位置與形狀。
      '.dsh-tv-secHead{display:flex;align-items:center;gap:8px;padding:2px 0 8px}',
      '.dsh-tv-secLabel{font-size:12.5px;font-weight:600;flex:1;color:var(--dsh-tv-text-1)}',
      '.dsh-tv-plus{width:26px;height:26px;flex:none;display:flex;align-items:center;justify-content:center;cursor:pointer;',
      'border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-sm);background:transparent;font:inherit;font-size:15px;',
      'line-height:1;color:var(--dsh-tv-text-2);padding:0}',
      '.dsh-tv-plus:hover:not(:disabled){border-color:var(--dsh-tv-accent);color:var(--dsh-tv-text-1)}',
      '.dsh-tv-plus:disabled{opacity:.5;cursor:default}',
      'background:var(--dsh-tv-surface-2);display:flex;flex-direction:column;gap:1px;max-width:340px}',
      '.dsh-tv-manual{border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-md);padding:12px;margin-bottom:12px;',
      'background:var(--dsh-tv-surface-1)}',
      '.dsh-tv-tavernDot{font-size:10px;color:var(--dsw-alias-label-tertiary,#6b7280)}',
      // 側邊欄「酒館」區塊。高度固定（flex:none），因為它跟工作區共用
      // .regionArea（flex:1 + overflow:hidden）；展開的清單用絕對定位浮在上面。
      //
      // 視覺刻意對齊 DSH 原生的面板列（.hHd-Xa_panelRow，從 ui-sidebar 的 CSS 抄來的度量）：
      //   min-height:36px / border-radius:var(--dsh-tv-radius-sm) / padding:7px 8px / gap:8px / line-height:22px
      // 顏色一律走原生變數（--dsw-alias-interactive-bg-hover 等），
      // 這樣換主題或社群皮膚時會跟著變，而不是各寫一套。
      // 側邊欄 `.regionArea` 的佔用者：上面原生工作區（自己滾動），下面酒館街。
      '.dsh-tv-region{display:flex;flex-direction:column;height:100%;min-height:0;width:100%}',
      '.dsh-tv-regionTop{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      // 分隔線：可以拖（雙擊回復預設）。平常是一條細線，滑過／拖曳時變明顯。
      // 分隔線：**照 DSH 原生 `widthHandle` 的做法**（`ui-conversation` 的
      // `.wSkVaW_widthHandle`）。原生不是畫一條固定的線，而是：
      //   1. 平常一條幾乎看不見的細線
      //   2. 滑過時用 `:after` 畫一段**以游標為中心**的漸層光條（±52px 淡出）
      //   3. 那個中心點由 JS 寫進 `--dsh-width-handle-pointer-y`
      //      （`e.clientY - box.top`）——所以光會跟著你的手走
      // 我們照抄這一組（變數名用自己的 `--dsh-tv-pointer-y`），拖曳中維持亮著。
      '.dsh-tv-divider{flex:none;height:9px;margin:2px 0 0;cursor:row-resize;position:relative;',
      'touch-action:none}',
      '.dsh-tv-divider:before{content:"";position:absolute;left:6px;right:6px;top:4px;height:1px;',
      'background:var(--dsw-alias-border-l1,#2a3140);transition:background .12s var(--ds-ease-in-out,ease)}',
      '.dsh-tv-divider:after{content:"";position:absolute;left:6px;right:6px;top:0;bottom:0;',
      'border-radius:3px;opacity:0;pointer-events:none;transition:opacity .12s var(--ds-ease-in-out,ease);',
      'background:linear-gradient(to bottom,transparent calc(var(--dsh-tv-pointer-y,50%) - 6px),',
      'var(--dsw-alias-label-secondary,#9aa4b2) calc(var(--dsh-tv-pointer-y,50%) - 1px),',
      'var(--dsw-alias-label-secondary,#9aa4b2) calc(var(--dsh-tv-pointer-y,50%) + 1px),',
      'transparent calc(var(--dsh-tv-pointer-y,50%) + 6px))}',
      '.dsh-tv-divider:hover:after,.dsh-tv-dividerOn:after{opacity:1}',
      '.dsh-tv-divider:hover:before,.dsh-tv-dividerOn:before{background:var(--dsw-alias-label-tertiary,#6b7280)}',
      // ---- 酒館街 ----------------------------------------------------------
      // 度量全部照抄原生工作區瀏覽器（`ui-workspace` 的 Rows.module.css 與區塊標題）：
      //   區塊標題 36px / 專案列 34px / 會話列 32px / 溢出按鈕 28px
      //   16px 圖示欄、標題 14px/20px、時間 12px、動作按鈕 16px
      // 顏色一律走原生變數，所以換主題或皮膚時會跟著變。
      '.dsh-tv-street{flex:none;min-height:0;max-height:56%;overflow-y:auto;display:flex;flex-direction:column;',
      'padding-top:2px;padding-right:8px}',
      '.dsh-tv-streetRail{max-height:none;padding-right:0}',
      '.dsh-tv-streetInner{display:flex;flex-direction:column;min-width:0;width:100%}',
      // 區塊標題：36px、tertiary、右邊一顆 28px 圓形 icon 按鈕（跟原生「工作区」標題同高）。
      // `cursor:pointer`：整列可點（跟下面每一列同一個規矩）。
      '.dsh-tv-sectionHead{cursor:pointer;box-sizing:border-box;height:36px;flex:none;display:flex;align-items:center;gap:4px;',
      'margin:2px 0 4px;padding-left:4px;border-radius:var(--dsh-tv-radius-md);color:var(--dsw-alias-label-tertiary,#6b7280);',
      'overflow:hidden}',
      // 標題列那顆「顯示／收合」的按鈕：平常長得像標籤，滑過才像按鈕。
      '.dsh-tv-sectionToggle{flex:none;min-width:0;max-width:45%;border:none;background:0 0;padding:0 4px;',
      'border-radius:var(--dsh-tv-radius-sm);font:inherit;font-size:14px;line-height:20px;text-align:left;cursor:pointer;',
      'color:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dsh-tv-sectionToggle:hover{background:var(--dsw-alias-fill-l1,rgba(255,255,255,.04));',
      'color:var(--dsw-alias-label-primary,#e6e8eb)}',
      '.dsh-tv-sectionIcon{flex:none;width:16px;height:16px;display:inline-flex;align-items:center;',
      'justify-content:center}',
      // 自己選的圖示（emoji 或短字串）。
      '.dsh-tv-iconEmoji{font-size:13px;line-height:1;display:inline-flex;align-items:center}',
      // 設定頁的圖示選擇器。
      '.dsh-tv-iconGrid{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}',
      '.dsh-tv-iconPick{width:30px;height:30px;flex:none;display:inline-flex;align-items:center;justify-content:center;',
      'border-radius:var(--dsh-tv-radius-sm);border:1px solid var(--dsh-tv-line);background:0 0;font-size:15px;',
      'line-height:1;cursor:pointer;color:inherit}',
      '.dsh-tv-iconPick:hover{border-color:var(--dsh-tv-accent)}',
      '.dsh-tv-iconPickOn{border-color:var(--dsh-tv-accent);',
      'background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-iconBtn{corner-shape:round;cursor:pointer;width:28px;height:28px;flex:none;display:inline-flex;',
      'align-items:center;justify-content:center;margin-left:auto;padding:0;border:none;border-radius:50%;',
      'background:0 0;color:var(--dsw-alias-label-secondary,#9aa4b2)}',
      '.dsh-tv-iconBtn:hover:not(:disabled){background:var(--dsw-alias-fill-l1,rgba(255,255,255,.04))}',
      '.dsh-tv-iconBtn:disabled{opacity:.5;cursor:default}',
      '.dsh-tv-spin{font-size:14px;line-height:1}',
      // 每一間酒館＝一個 groupSection（原生：同群組列距 2px、群組之間 4px）。
      // 每一層容器都要 `min-width:0`：少一層，下面的 `nowrap` 就會把整條鏈撐開。
      '.dsh-tv-group{position:relative;display:flex;flex-direction:column;min-width:0;width:100%}',
      '.dsh-tv-group + .dsh-tv-group{margin-top:4px}',
      '.dsh-tv-group > * + *{margin-top:2px}',
      // 專案列（酒館）：34px、滑過變底色；滑過時資料夾圖示換成折疊三角形。
      '.dsh-tv-row{box-sizing:border-box;cursor:pointer;user-select:none;height:34px;display:flex;',
      'align-items:center;gap:6px;padding:0 8px;border-radius:var(--dsh-tv-radius-sm);overflow:hidden;',
      'color:var(--dsw-alias-label-primary,#e6e8eb)}',
      '.dsh-tv-row:hover,.dsh-tv-rowMenuOpen{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}',
      '.dsh-tv-slot{width:16px;height:20px;flex:none;display:inline-flex;align-items:center;justify-content:center;',
      'color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.dsh-tv-slotOn{color:var(--dsw-alias-state-accent-primary,#4f8ef7)}',
      // 「這一份對話正在跑」的指示器：色票與動畫都照 DSH 原生的 `StatusDot`
      // （八顆 2×2 方格繞一圈、負延遲製造跑馬燈）。四段透明度寫成自訂屬性，
      // keyframes 才不會有兩份數字。
      '.dsh-tv-runDot{--dsh-tv-chase-1:.15;--dsh-tv-chase-2:.35;--dsh-tv-chase-3:.6;--dsh-tv-chase-4:1;',
      'color:var(--dsh-tv-live)}',
      '.dsh-tv-runCell{fill:currentColor;opacity:var(--dsh-tv-chase-1,.15);animation:dsh-tv-chase 1s infinite}',
      '@keyframes dsh-tv-chase{0%,12.4%{opacity:var(--dsh-tv-chase-4,1)}12.5%,24.9%{opacity:var(--dsh-tv-chase-3,.6)}',
      '25%,37.4%{opacity:var(--dsh-tv-chase-2,.35)}37.5%,to{opacity:var(--dsh-tv-chase-1,.15)}}',
      '@media (prefers-reduced-motion:reduce){.dsh-tv-runCell{animation:none;opacity:var(--dsh-tv-chase-4,1)}}',
      '.dsh-tv-row .dsh-tv-chevron{display:none}',
      '.dsh-tv-row:hover .dsh-tv-chevron{display:inline-flex}',
      '.dsh-tv-row:hover .dsh-tv-folder{display:none}',
      '.dsh-tv-folder{display:inline-flex;align-items:center;justify-content:center}',
      '.dsh-tv-arrow{transition:transform .15s var(--ds-ease-in-out,ease-in-out)}',
      '.dsh-tv-arrowOpen .dsh-tv-arrow{transform:rotate(90deg)}',
      '.dsh-tv-projectText{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;overflow:hidden}',
      // ⚠️ **逐字照原生 `.title`**：
      //   `text-overflow:ellipsis; white-space:nowrap; min-width:0; font-size:14px;
      //    line-height:20px; overflow:hidden`
      // 關鍵是 `min-width:0`：flex 子項目的預設 `min-width:auto` 會讓 nowrap 的
      // 標題**撐開整列**，右邊被側邊欄的 `overflow:hidden` 裁掉（而不是顯示 `…`）。
      // **不要在這裡寫 `width`**：`flex:1` 已經決定了它會佔滿剩下的空間，
      // 再寫一個 `width` 會在 flex 解析時打架（實測 `width:0` 會讓它變成 0 寬）。
      '.dsh-tv-title{min-width:0;font-size:14px;line-height:20px;white-space:nowrap;',
      'overflow:hidden;text-overflow:ellipsis}',
      '.dsh-tv-time{flex:none;font-size:12px;line-height:20px;color:var(--dsh-tv-text-3)}',
      // 動作：平常隱藏，滑過（或選單開著）才出現——原生的做法。
      // ⚠️ `gap:12px` 是**照抄原生**的值（`.rowActions{gap:12px}`），不是 6px：
      // 原生同時塞了 ⋯ 與 ＋ 兩顆 16px 按鈕，12px 才對得上那個視覺節奏。
      '.dsh-tv-actions{flex:none;display:none;align-items:center;gap:12px;height:20px}',
      '.dsh-tv-row:hover .dsh-tv-actions,.dsh-tv-chatRow:hover .dsh-tv-actions,.dsh-tv-rowMenuOpen .dsh-tv-actions,',
      '.dsh-tv-chatMenuOpen .dsh-tv-actions{display:inline-flex}',
      '.dsh-tv-miniBtn{cursor:pointer;width:16px;height:16px;flex:none;display:inline-flex;align-items:center;',
      'justify-content:center;padding:0;border:none;border-radius:var(--dsh-tv-radius-sm);background:0 0;',
      'color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.dsh-tv-miniBtn:hover{color:var(--dsw-alias-label-primary,#e6e8eb)}',
      // 會話列（對話）：32px、滑過時時間換成動作。
      // ⚠️ 這一組的值逐條對照原生 `.sessionRow`：
      //   height:32px / padding:0 8px / border-radius:var(--dsh-tv-radius-sm) / gap:0
      //   hover 與選中同一種底色（`interactive-bg-hover`）
      //   title 的邊距 0 6px 0 4px、滑過或選單開著時時間消失
      '.dsh-tv-chatRow{box-sizing:border-box;cursor:pointer;user-select:none;height:32px;display:flex;',
      'flex-direction:row;align-items:center;gap:0;padding:0 8px;border-radius:var(--dsh-tv-radius-sm);overflow:hidden;',
      'color:var(--dsw-alias-label-primary,#e6e8eb)}',
      '.dsh-tv-chatRow:hover,.dsh-tv-chatOn,.dsh-tv-chatMenuOpen{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}',
      // 原生 `.sessionRow .title{flex:1;margin:0 6px 0 4px}`——就只有這兩條。
      '.dsh-tv-chatRow .dsh-tv-title{flex:1;margin:0 6px 0 4px}',
      '.dsh-tv-chatRow:hover .dsh-tv-time,.dsh-tv-chatMenuOpen .dsh-tv-time{display:none}',
      // 行內改名：原生 `.renameInput`（14px/20px、4px 圓角、細邊框、填色底）。
      '.dsh-tv-rename{box-sizing:border-box;flex:1;min-width:0;height:20px;padding:0 2px;margin:0 6px 0 4px;',
      'border:.5px solid var(--dsw-alias-border-l1,#2a3140);border-radius:var(--dsh-tv-radius-sm);outline:none;',
      'background:var(--dsw-alias-fill-l1,rgba(255,255,255,.04));color:inherit;',
      'font:inherit;font-size:14px;line-height:20px}',
      // 那一列的下拉動作（⋯）：原生用 portal 到 body 的選單，我們照做（見 renderChatMenu），
      // 所以它不受側邊欄 overflow 影響，也不會把列本身撐開。
      // ⚠️ 選單 portal 到 `document.body`，而**主題變數定義在側邊欄那棵子樹裡**
      // （`:root` 沒有；實測 body 的 `--dsw-alias-label-primary` 解析出來是對的，
      // 但 `--dsw-alias-bg-elevated` **根本不存在**）。所以底色與文字色由
      // `inheritTheme()` 從側邊欄當下的 computed style 直接寫進容器，
      // 這裡只負責版面——**不要再自己猜顏色**（猜錯就是「深字壓深底」，看不到字）。
      '.dsh-tv-menu{position:fixed;z-index:2147483000;min-width:132px;padding:4px;border-radius:var(--dsh-tv-radius-md);',
      'box-shadow:0 8px 26px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:1px;',
      'font:13px/1.5 -apple-system,"Segoe UI","Microsoft JhengHei","Microsoft YaHei",sans-serif}',
      '.dsh-tv-menuItem{cursor:pointer;display:flex;align-items:center;gap:8px;height:28px;padding:0 8px;',
      'border:none;border-radius:var(--dsh-tv-radius-sm);background:0 0;text-align:left;font:inherit;font-size:13px;',
      'color:inherit}',
      '.dsh-tv-menuItem:hover{background:var(--dsw-alias-fill-l1,rgba(255,255,255,.04))}',
      '.dsh-tv-menuItem:disabled{cursor:default;opacity:.45}',
      '.dsh-tv-menuItemDanger:hover{color:#f85149}',
      '.dsh-tv-menuIcon{width:16px;height:16px;flex:none;display:inline-flex;align-items:center;justify-content:center;',
      'opacity:.75}',
      '.dsh-tv-menuErr{padding:4px 8px 2px;font-size:12px;line-height:1.5;color:#f85149;max-width:220px}',
      // 溢出按鈕（「展開其餘 N 個」）：原生 28px、12px 字、左緣對齊標題。
      '.dsh-tv-overflow{cursor:pointer;width:100%;height:28px;flex:none;padding:0 12px 0 28px;border:none;',
      'border-radius:var(--dsh-tv-radius-sm);background:0 0;text-align:left;font:inherit;font-size:12px;',
      'color:var(--dsw-alias-label-tertiary,#6b7280)}',
      '.dsh-tv-overflow:hover{color:var(--dsw-alias-label-secondary,#9aa4b2)}',
      '.dsh-tv-emptyRow{padding:6px 12px 8px 28px;font-size:12px;line-height:18px;',
      'color:var(--dsw-alias-label-tertiary,#6b7280)}',
      // 列的行內輸入（重新命名）。
      '.dsh-tv-inlineInput{box-sizing:border-box;width:100%;height:22px;padding:0 6px;border-radius:var(--dsh-tv-radius-sm);font:inherit;',
      'font-size:13px;outline:none;border:1px solid var(--dsh-tv-accent);',
      'background:var(--dsh-tv-surface-0);color:var(--dsh-tv-text-1)}',
      // 動作選單：貼在那一列下面（原生也是就地彈出）。
      'flex-direction:column;gap:2px;padding:4px;border-radius:var(--dsh-tv-radius-md);',
      'border:1px solid var(--dsh-tv-line);background:var(--dsh-tv-surface-0);',
      'padding:5px 8px;border:none;border-radius:var(--dsh-tv-radius-sm);background:0 0;font:inherit;font-size:12.5px;text-align:left;',
      'cursor:pointer;color:var(--dsh-tv-text-2)}',
      'color:var(--dsh-tv-text-1)}',
      '.dsh-tv-sideErr{margin:2px 8px;padding:4px 8px;border-radius:var(--dsh-tv-radius-sm);font-size:11px;line-height:1.5;',
      'color:#f85149}',
      '.dsh-tv-sideManual{padding:0 8px 4px}',
      '.dsh-tv-sideInput{box-sizing:border-box;width:100%;padding:6px 8px;border-radius:var(--dsh-tv-radius-sm);font:inherit;font-size:13px;outline:none;',
      'border:1px solid var(--dsw-alias-border-l1,#2a3140);background:var(--dsw-alias-fill-l1,rgba(255,255,255,.04));',
      'color:var(--dsw-alias-label-primary,#e6e8eb)}',
      '.dsh-tv-sideInput:focus{border-color:var(--dsw-alias-state-accent-primary,#4f8ef7)}',
      // rail（側邊欄收合成圖示列）時只留區塊標題那顆 36px 的按鈕。
      '.dsh-tv-streetRail .dsh-tv-group,.dsh-tv-streetRail .dsh-tv-overflow,',
      '.dsh-tv-streetRail .dsh-tv-emptyRow,.dsh-tv-streetRail .dsh-tv-sideErr{display:none}',
      '.dsh-tv-streetRail .dsh-tv-sectionHead{justify-content:flex-start;margin-bottom:12px;padding-left:0}',
      '.dsh-tv-streetRail .dsh-tv-iconBtn{width:36px;height:36px;margin-left:0;',
      'color:var(--dsw-alias-label-primary,#e6e8eb)}',
      // 不需要外層再包一層帶側邊導航的容器（導航已經在 DSH 側邊欄）。
      '.dsh-tv-view{font-synthesis:none;position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;',
      'background:var(--dsh-tv-surface-0);color:var(--dsh-tv-text-1);',
      'font:13px/1.6 -apple-system,"Segoe UI","Microsoft JhengHei","Microsoft YaHei",sans-serif}',
      '.dsh-tv-pre{margin:0;padding:8px 9px;border-radius:var(--dsh-tv-radius-sm);font-family:ui-monospace,Consolas,monospace;font-size:10.5px;',
      'line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:190px;overflow:auto;',
      'background:var(--dsh-tv-surface-2);border:1px solid var(--dsh-tv-line);',
      'color:var(--dsh-tv-text-2)}',
      '.dsh-tv-in option{background:var(--dsh-tv-surface-0);color:var(--dsh-tv-text-1)}',
    ].join('')

    function MapBtn(props) {
      var cls = 'dsh-tv-btn'
      if (props.primary) cls += ' dsh-tv-btnPrimary'
      if (props.danger) cls += ' dsh-tv-btnDanger'
      return React.createElement(
        'button',
        {
          className: cls,
          title: props.title,
          style: props.disabled ? { opacity: 0.5, cursor: 'default' } : undefined,
          onClick: props.disabled
            ? undefined
            : function (event) {
                props.onClick(event)
              },
        },
        props.children,
      )
    }

    function MapField(props) {
      return React.createElement(
        'label',
        { className: 'dsh-tv-field' },
        React.createElement('span', { className: 'dsh-tv-fieldLabel' }, props.label),
        props.textarea
          ? React.createElement('textarea', {
              className: 'dsh-tv-ta',
              style: props.rows ? { minHeight: String(props.rows * 20) + 'px' } : undefined,
              value: props.value,
              placeholder: props.placeholder,
              onChange: function (event) {
                props.onChange(event.target.value)
              },
            })
          : React.createElement('input', {
              className: 'dsh-tv-in',
              value: props.value,
              placeholder: props.placeholder,
              onChange: function (event) {
                props.onChange(event.target.value)
              },
            }),
        props.hint ? React.createElement('span', { className: 'dsh-tv-fieldHint' }, props.hint) : null,
      )
    }

    /** 插圖的四個掛載點（跟宿主半的 assetDir 對應）。 */
    var ASSET_LABELS = {
      character: '🎭 這個角色的插圖',
      worldbook: '📖 這本世界書的插圖',
      chat: '💬 這份對話的插圖',
      tavern: '🏠 這間酒館的店面圖',
    }

    /** 資料夾 → 說明（設定頁的「資料夾結構」用）。 */
    var ASSET_LABELS_BY_DIR = {
      characters: '人物卡',
      worldbooks: '世界書',
      chats: '對話紀錄',
      art: '插圖',
    }

    /** 給使用者看的「圖放在哪個資料夾」（可以直接去檔案總管丟圖）。 */
    /**
     * 從 `<input type="file">` 的 change 事件取出使用者挑的檔案。
     *
     * ⚠️ 這裡踩過一個**靜默失效**：以前寫成
     * ```js
     * var files = event.target.files
     * event.target.value = ''   // 想讓同一個檔案下次還能再選
     * use(files)                // ← 這時候 files 已經空了
     * ```
     * `event.target.files` 回傳的是**活的** `FileList`，`value = ''` 會**就地**
     * 把它清空（同一個物件，不是換一個新的），所以 `files.length` 變成 0，
     * 檔案永遠送不出去，而且不會有任何錯誤訊息——按鈕看起來完全正常。
     * 三個隱藏 input（插圖、匯入卡片、匯入世界書）都中過。
     *
     * 因此：**先複製成真正的陣列，再清 value。**
     */
    function pickFiles(event) {
      var picked = []
      var list = event.target.files
      if (list !== null && list !== undefined) {
        for (var i = 0; i < list.length; i += 1) picked.push(list[i])
      }
      // 清空才可以再選同一個檔案（現在清是安全的，檔案已經複製出來了）。
      event.target.value = ''
      return picked
    }

    function assetFolderHint(kind, owner) {
      if (kind === 'tavern') return 'art/tavern/'
      if (kind === 'character') return 'art/characters/' + String(owner) + '/'
      if (kind === 'worldbook') return 'art/worldbooks/' + String(owner) + '/'
      return 'art/chats/' + String(owner) + '/'
    }

    /**
     * 從清單回應裡找某張圖的 URL。
     *
     * 宿主半已經在每個 item 上給了 `url`，所以正常情況一定找得到；找不到就回 null，
     * 呼叫端會退回「沒有圖」的顯示（例如舊版宿主半的回應）。
     */
    function findAssetUrl(assets, name) {
      if (assets === null || assets === undefined) return null
      if (Array.isArray(assets.items)) {
        for (var i = 0; i < assets.items.length; i += 1) {
          if (assets.items[i].name === name && typeof assets.items[i].url === 'string') return assets.items[i].url
        }
      }
      return null
    }

    /** 位元組數變成人看得懂的大小。 */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || bytes <= 0) return '0 B'
      if (bytes < 1024) return String(bytes) + ' B'
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
    }

    /** 角色卡欄位定義（對齊 SillyTavern v2 / v3）。 */
    var CARD_FIELDS = [
      { key: 'name', label: '名稱', hint: '{{char}} 會替換成這個名字' },
      { key: 'description', label: '人設 description', rows: 8, textarea: true, hint: '身分、性格、外貌、講話方式、價值觀' },
      { key: 'personality', label: '性格摘要 personality', rows: 3, textarea: true, hint: '短版人設；有些前端只讀這個欄位' },
      { key: 'scenario', label: '場景 scenario', rows: 3, textarea: true, hint: '現在在哪、發生什麼事' },
      { key: 'first_mes', label: '開場白 first_mes', rows: 4, textarea: true, hint: '對話開始時角色的第一句話' },
      { key: 'mes_example', label: '對話示範 mes_example', rows: 6, textarea: true, hint: '<START> 分段；{{user}} 是你、{{char}} 是角色' },
      { key: 'system_prompt', label: '角色專屬系統提示', rows: 3, textarea: true, hint: '留空則用全域風格規則' },
      { key: 'post_history_instructions', label: '歷史後指令', rows: 3, textarea: true, hint: '接在對話歷史之後，常用來強化格式或越獄' },
    ]

    /**
     * 這張卡有哪些「還沒原生支援」的東西——照實顯示，不假裝支援。
     *
     * ⚠️ `card.extensions` 一定要用 `== null` 判斷，**不可以寫 `!== null`**。
     * 以前寫成 `card.extensions !== null && Array.isArray(card.extensions.regex_scripts)`，
     * 而 `undefined !== null` 是 **true**——所以**任何沒有 `extensions` 欄位的卡片**
     * 都會在這裡丟 `Cannot read properties of undefined (reading 'regex_scripts')`。
     *
     * 後果不是「這一張卡顯示不出來」，是**整個設定頁整格消失**：這個元件在
     * React 的渲染期丟錯 → 座位被退位（abdicate）→ `main` 變成一格空白，
     * 而且**沒有任何錯誤訊息**（`window.__dshTavern.entryErrors` 裡才有）。
     * 實際症狀：在人物卡清單點任何一張卡，整個設定頁就不見了。
     *
     * `test-client.mjs` §10 用「沒有 extensions 的卡」把這一條釘住。
     */
    function cardAssets(card) {
      const safe = card !== null && typeof card === 'object' ? card : {}
      const book = safe.character_book
      // 兩種形狀都要算：卡內嵌是陣列，獨立世界書是以 uid 為 key 的物件。
      const entries =
        book === null || book === undefined
          ? 0
          : Array.isArray(book.entries)
            ? book.entries.length
            : book.entries !== null && typeof book.entries === 'object'
              ? Object.keys(book.entries).length
              : 0
      const extensions = safe.extensions !== null && typeof safe.extensions === 'object' ? safe.extensions : {}
      const allScripts = Array.isArray(extensions.regex_scripts) ? extensions.regex_scripts : []
      return {
        bookEntries: entries,
        bookName: book !== null && book !== undefined && typeof book.name === 'string' ? book.name : '',
        scripts: allScripts.length,
      }
    }

    /**
     * 卡片資產現況（純讀取，不跑任何引擎）。
     *
     * v2 拿掉了顯示層正則引擎，所以這裡只說「這張卡帶了什麼」，不再有預覽按鈕
     * ——卡片裡的欄位一樣原樣保存，只是 DSH 不負責把它們渲染出來。
     */
    function CardAssets(props) {
      var assets = cardAssets(props.card)
      var rows = [
        {
          text:
            assets.bookEntries > 0
              ? '📖 內嵌世界書：' + String(assets.bookEntries) + ' 條' + (assets.bookName !== '' ? '（' + assets.bookName + '）' : '')
              : '📖 內建世界書：無',
          done: assets.bookEntries > 0,
        },
        {
          text: assets.scripts > 0 ? '🔧 卡片內的正則腳本：' + String(assets.scripts) + ' 條（原樣保存）' : '🔧 卡片內的正則腳本：無',
          done: assets.scripts > 0,
        },
      ]

      return React.createElement(
        'div',
        { className: 'dsh-tv-assets' },
        React.createElement('div', { className: 'dsh-tv-assetsHead' }, '這張卡帶了什麼'),
        rows.map(function (row, index) {
          return React.createElement(
            'div',
            { key: String(index), className: row.done ? 'dsh-tv-assetRow dsh-tv-assetOn' : 'dsh-tv-assetRow' },
            row.text,
          )
        }),
        React.createElement(
          'p',
          { className: 'dsh-tv-note', style: { margin: '6px 0 0' } },
          '卡片裡不認識的欄位一律原樣保存。這個版本只做檔案的讀寫與顯示，不跑任何引擎。',
        ),
      )
    }

    /**
     * 插圖管理器：一個實體（角色卡／世界書／對話室／酒館店面）的全部插圖。
     *
     * 為什麼是一整組而不是「一張立繪」：實際使用時一個角色會有微笑／生氣／各種
     * 動作的差分圖，幾十張跑不掉；世界書與對話室也各有自己的圖。所以模型是
     * **一組圖 + 指定哪一張是主圖**，資料夾就是清單，主圖記在 tavern.json。
     *
     * @param props.kind   - `character` / `worldbook` / `chat` / `tavern`
     * @param props.owner  - 擁有者 id（角色卡／世界書＝檔名；對話＝`角色/對話名`；店面省略）
     * @param props.label  - 區塊標題（省略時給一個合理的預設）
     * @param props.compact - true 時只畫縮圖列（清單裡用）
     */
    function AssetManager(props) {
      var render = useForceRender()
      var ref = React.useRef(null)
      if (ref.current === null) {
        ref.current = { items: [], primary: null, loaded: false, busy: false, error: '', message: '', dropped: false }
      }
      var state = ref.current
      var inputRef = React.useRef(null)

      function onFiles(files) {
        if (files === null || files === undefined || files.length === 0) return
        if (files.length > 1) uploadMany(files)
        else upload(files[0])
      }

      var fileInput = React.createElement('input', {
        type: 'file',
        accept: 'image/*',
        multiple: true,
        style: { display: 'none' },
        ref: inputRef,
        onChange: function (event) {
          var files = pickFiles(event)
          if (files.length > 0) onFiles(files)
        },
      })

      var addButton = React.createElement(
        MapBtn,
        {
          primary: true,
          disabled: state.busy,
          onClick: function () {
            if (inputRef.current !== null && inputRef.current !== undefined) inputRef.current.click()
          },
        },
        state.busy ? '處理中…' : '＋ 加入插圖',
      )
      var kind = props.kind
      var owner = props.owner === undefined ? '' : props.owner
      var label = props.label !== undefined ? props.label : ASSET_LABELS[kind]

      function fail(error) {
        state.busy = false
        state.error = String((error && error.message) || error)
        render()
      }

      function apply(listed) {
        if (listed === null || listed === undefined) return
        if (Array.isArray(listed.items)) state.items = listed.items
        state.primary = listed.primary === undefined ? null : listed.primary
      }

      function load() {
        return rpc('assets.list', { kind: kind, owner: owner })
          .then(function (listed) {
            apply(listed)
            state.loaded = true
            state.error = ''
            render()
          })
          .catch(function (error) {
            state.loaded = true
            fail(error)
          })
      }

      React.useEffect(function () {
        load()
      }, [kind, owner])
      // 「重新讀取」＝「我剛剛自己往資料夾丟了圖」，這個掛載點也要跟著重讀。
      useRefreshVersion(load)

      /** 上傳：走二進位路由，不是 base64 JSON。 */
      function upload(file) {
        if (file === null || file === undefined) return
        state.busy = true
        state.error = ''
        state.message = ''
        render()
        return sendFileExpectOk(
          'assets.write',
          { kind: kind, owner: owner, name: file.name || '' },
          file,
          file.type || 'application/octet-stream',
        )
          .then(function (value) {
            state.busy = false
            apply(value)
            state.message = value.renamed
              ? '已加入（撞名，存成 ' + String(value.written) + '）'
              : '已加入 ' + String(value.written)
            render()
            // 插圖數量在上方統計裡，加完要讓它重算。
            notifyWorkspaceChanged()
          })
          .catch(function (error) {
            state.busy = false
            fail(error)
          })
      }

      /** 一次丟多張：逐張上傳，最後只重讀一次清單。 */
      function uploadMany(files) {
        var list = []
        for (var i = 0; i < files.length; i += 1) list.push(files[i])
        if (list.length === 0) return
        state.busy = true
        state.error = ''
        state.message = '上傳中…（' + String(list.length) + ' 張）'
        render()
        var done = 0
        var failed = 0
        var next = function () {
          if (done >= list.length) {
            state.busy = false
            state.message =
              '已加入 ' + String(list.length - failed) + ' 張' + (failed > 0 ? '，' + String(failed) + ' 張失敗' : '')
            notifyWorkspaceChanged()
            return load()
          }
          var file = list[done]
          done += 1
          return sendFile(
            'assets.write',
            { kind: kind, owner: owner, name: file.name || '' },
            file,
            file.type || 'application/octet-stream',
          )
            .then(function (payload) {
              if (payload === null || payload.ok !== true) failed += 1
            })
            .catch(function () {
              failed += 1
            })
            .then(next)
        }
        return next()
      }

      function setPrimary(name) {
        state.busy = true
        render()
        return rpc('assets.primary', { kind: kind, owner: owner, name: name })
          .then(function (listed) {
            state.busy = false
            apply(listed)
            state.message = '主圖：' + String(name)
            render()
          })
          .catch(fail)
      }

      function remove(name) {
        state.busy = true
        render()
        return rpc('assets.delete', { kind: kind, owner: owner, name: name })
          .then(function (listed) {
            state.busy = false
            apply(listed)
            state.message = '已刪除 ' + String(name)
            render()
            notifyWorkspaceChanged()
          })
          .catch(fail)
      }

      var thumbs = state.items.map(function (item) {
        var isPrimary = item.name === state.primary
        return React.createElement(
          'div',
          { key: item.name, className: isPrimary ? 'dsh-tv-thumb dsh-tv-thumbOn' : 'dsh-tv-thumb' },
          React.createElement('img', {
            src: item.url,
            alt: item.name,
            title: item.name + '（' + formatBytes(item.bytes) + '）',
            loading: 'lazy',
            onClick: function () {
              setPrimary(item.name)
            },
          }),
          isPrimary ? React.createElement('span', { className: 'dsh-tv-thumbTag' }, '主圖') : null,
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-tv-thumbDel',
              title: '刪除這張圖',
              'aria-label': '刪除 ' + item.name,
              onClick: function () {
                remove(item.name)
              },
            },
            '✕',
          ),
        )
      })

      if (props.compact === true) {
        return React.createElement(
          'div',
          { className: 'dsh-tv-thumbRow' },
          state.items.length === 0
            ? React.createElement('span', { className: 'dsh-tv-note' }, '沒有插圖')
            : state.items.slice(0, 6).map(function (item) {
                return React.createElement('img', {
                  key: item.name,
                  className: item.name === state.primary ? 'dsh-tv-thumbSm dsh-tv-thumbSmOn' : 'dsh-tv-thumbSm',
                  src: item.url,
                  alt: item.name,
                  title: item.name,
                  loading: 'lazy',
                })
              }),
          state.items.length > 6
            ? React.createElement('span', { className: 'dsh-tv-note' }, '+' + String(state.items.length - 6))
            : null,
        )
      }

      return React.createElement(
        'div',
        { className: 'dsh-tv-assetsBox' },
        React.createElement(
          'div',
          { className: 'dsh-tv-assetsBar' },
          React.createElement('span', { className: 'dsh-tv-fieldLabel', style: { margin: 0 } }, label),
          React.createElement(
            'span',
            { className: 'dsh-tv-note', style: { flex: 1, margin: 0 } },
            state.loaded
              ? String(state.items.length) + ' 張' + (state.primary !== null ? '，主圖：' + String(state.primary) : '')
              : '讀取中…',
          ),
          addButton,
        ),
        React.createElement(
          'div',
          {
            className: state.dropped ? 'dsh-tv-drop dsh-tv-dropOn' : 'dsh-tv-drop',
            onDragOver: function (event) {
              event.preventDefault()
              if (state.dropped !== true) {
                state.dropped = true
                render()
              }
            },
            onDragLeave: function () {
              state.dropped = false
              render()
            },
            onDrop: function (event) {
              event.preventDefault()
              state.dropped = false
              var files = event.dataTransfer !== null && event.dataTransfer !== undefined ? event.dataTransfer.files : null
              if (files !== null && files !== undefined && files.length > 1) uploadMany(files)
              else if (files !== null && files !== undefined && files.length === 1) upload(files[0])
              else render()
            },
          },
          fileInput,
          state.items.length === 0
            ? React.createElement(
                'div',
                { className: 'dsh-tv-note', style: { padding: '10px 2px' } },
                state.loaded
                  ? '還沒有插圖。按「加入插圖」或把圖直接拖進來——同一個角色可以放很多張（表情、動作），點縮圖就能換主圖。'
                  : '讀取中…',
              )
            : React.createElement('div', { className: 'dsh-tv-thumbs' }, thumbs),
        ),
        state.error !== '' ? React.createElement('div', { className: 'dsh-tv-err' }, state.error) : null,
        state.message !== '' ? React.createElement('div', { className: 'dsh-tv-ok' }, state.message) : null,
        React.createElement(
          'p',
          { className: 'dsh-tv-note', style: { margin: '6px 0 0' } },
          '檔案位置：' + assetFolderHint(kind, owner) + '　（直接丟圖進那個資料夾也會出現在這裡）',
        ),
      )
    }

    /**
     * 「這間酒館」分區：改名、移除、路徑。
     *
     * 這些動作原本在側邊欄那一列的 ⋯ 彈出式選單裡，但酒館街在側邊欄最底部，
     * 彈窗會撞到視窗下緣被裁掉（使用者：「他在最底層摺疊起來你再彈彈窗就看不見
     * 東西了」）。所以 ⋯ 現在直接進這一頁，動作就放在這裡。
     */
    function MapTavernActions(props) {
      var render = useForceRender()
      var ref = React.useRef(null)
      if (ref.current === null) {
        ref.current = {
          // `String(...)`：`props.tavern.name` 來自註冊表檔案，壞掉時可能是 undefined，
          // 而下面直接呼叫 `state.name.trim()`——undefined 會在渲染期丟錯，
          // 整個 `main` 面板變成死格（同 §7.4b 那兩個 bug 的型別）。
          name:
            props.tavern !== null && props.tavern !== undefined && typeof props.tavern.name === 'string'
              ? props.tavern.name
              : '',
          busy: false,
          error: '',
          message: '',
        }
      }
      var state = ref.current

      function commit() {
        var next = String(state.name === undefined || state.name === null ? '' : state.name).trim()
        if (next === '') {
          state.error = '名稱不可為空'
          render()
          return
        }
        if (props.tavern !== null && next === props.tavern.name) return
        state.busy = true
        state.error = ''
        state.message = ''
        render()
        rpc('tavern.rename', { id: props.tavern.id, name: next })
          .then(function () {
            state.busy = false
            state.message = '已重新命名'
            render()
            props.reload()
          })
          .catch(function (error) {
            state.busy = false
            state.error = String((error && error.message) || error)
            render()
          })
      }

      function remove() {
        state.busy = true
        state.error = ''
        render()
        rpc('tavern.remove', { id: props.tavern.id })
          .then(function () {
            state.busy = false
            state.message = '已從酒館街移除（資料夾與檔案都還在）'
            render()
            props.reload()
          })
          .catch(function (error) {
            state.busy = false
            state.error = String((error && error.message) || error)
            render()
          })
      }

      /** 選一個圖示（傳空字串＝回到內建的彩色燈籠）。 */
      function setIcon(icon) {
        state.busy = true
        state.error = ''
        state.message = ''
        render()
        rpc('tavern.update', { id: props.tavern.id, icon: icon })
          .then(function () {
            state.busy = false
            state.message = '已更新圖示'
            state.icon = icon
            render()
            props.reload()
          })
          .catch(function (error) {
            state.busy = false
            state.error = String((error && error.message) || error)
            render()
          })
      }

      if (props.tavern === null || props.tavern === undefined) return null

      var currentIcon = typeof state.icon === 'string' ? state.icon : props.tavern.icon || ''

      return React.createElement(
        'div',
        { className: 'dsh-tv-field' },
        React.createElement('div', { className: 'dsh-tv-fieldLabel' }, '名稱'),
        React.createElement(
          'div',
          { className: 'dsh-tv-inlineRow' },
          React.createElement('input', {
            className: 'dsh-tv-in',
            value: typeof state.name === 'string' ? state.name : '',
            'aria-label': '酒館名稱',
            onChange: function (event) {
              state.name = event.target.value
              render()
            },
            onKeyDown: function (event) {
              if (event.key === 'Enter') commit()
            },
          }),
          React.createElement(
            MapBtn,
            { onClick: commit, disabled: state.busy || String(state.name || '').trim() === '' },
            state.busy ? '處理中…' : '重新命名',
          ),
          React.createElement(
            MapBtn,
            { onClick: remove, disabled: state.busy, danger: true, title: '只從酒館街移除，不會刪除資料夾裡的任何檔案' },
            '從酒館街移除',
          ),
        ),
        // 圖示：每一間酒館在酒館街上長什麼樣子（沒選就用內建的彩色燈籠）。
        React.createElement('div', { className: 'dsh-tv-fieldLabel', style: { marginTop: '10px' } }, '圖示'),
        React.createElement(
          'div',
          { className: 'dsh-tv-iconGrid' },
          TAVERN_ICON_CHOICES.map(function (choice) {
            var on = currentIcon === choice.value
            return React.createElement(
              'button',
              {
                key: choice.label,
                type: 'button',
                className: on ? 'dsh-tv-iconPick dsh-tv-iconPickOn' : 'dsh-tv-iconPick',
                title: choice.label,
                'aria-label': choice.label,
                'aria-pressed': on ? 'true' : 'false',
                disabled: state.busy,
                onClick: function () {
                  setIcon(choice.value)
                },
              },
              // 預設那個用內建燈籠畫出來，其餘是 emoji。
              choice.value === '' ? React.createElement(IconLantern) : choice.value,
            )
          }),
        ),
        React.createElement(
          'div',
          { className: 'dsh-tv-inlineRow' },
          React.createElement('input', {
            className: 'dsh-tv-in',
            value: state.customIcon === undefined ? '' : state.customIcon,
            placeholder: '或直接貼一個 emoji／短字串',
            'aria-label': '自訂圖示',
            onChange: function (event) {
              state.customIcon = event.target.value
              render()
            },
            onKeyDown: function (event) {
              if (event.key !== 'Enter') return
              setIcon((state.customIcon || '').trim())
            },
          }),
          React.createElement(
            MapBtn,
            {
              onClick: function () {
                setIcon((state.customIcon || '').trim())
              },
              disabled: state.busy,
            },
            '套用',
          ),
        ),
        state.error !== '' ? React.createElement('div', { className: 'dsh-tv-err' }, state.error) : null,
        state.message !== '' ? React.createElement('div', { className: 'dsh-tv-ok' }, state.message) : null,
        // 這間酒館自己的設定檔（tavern.json）——v2 只有備註一個自由欄位。
        React.createElement('div', { className: 'dsh-tv-fieldLabel', style: { marginTop: '10px' } }, '備註（存在 tavern.json）'),
        React.createElement(
          'textarea',
          {
            className: 'dsh-tv-ta',
            rows: 3,
            'aria-label': '備註',
            value: state.note === undefined ? (props.settings && props.settings.note) || '' : state.note,
            placeholder: '這間酒館是拿來做什麼的、有什麼規矩…',
            onChange: function (event) {
              state.note = event.target.value
              render()
            },
          },
        ),
        React.createElement(
          'div',
          { className: 'dsh-tv-inlineRow', style: { marginTop: '6px' } },
          React.createElement(
            MapBtn,
            {
              onClick: function () {
                props.commit({ note: state.note === undefined ? (props.settings && props.settings.note) || '' : state.note })
              },
              disabled: state.busy || typeof props.commit !== 'function',
            },
            '儲存備註',
          ),
        ),
        React.createElement(
          'div',
          { className: 'dsh-tv-fieldHint' },
          '「移除」只會把這間酒館從清單拿掉，資料夾與裡面所有檔案都不會被刪除。',
        ),
        legacyNotice(props.legacy === true),
      )
    }

    /**
     * 舊版殘留的說明方塊。
     *
     * 為什麼需要它：v1 會自動建立／認養「預設酒館」，那筆紀錄到了 v2 還留在
     * `taverns.json` 裡。酒館街預設是收合的，所以使用者第一次按 ＋（新增成功後
     * 清單會自動展開）才第一次看到它——看起來就像「按了新增就跑出兩間酒館」。
     * 這裡把真相講清楚：這個資料夾不是這一版建立的，移除只是把紀錄拿掉。
     */
    function legacyNotice(show) {
      if (show !== true) return null
      return React.createElement(
        'div',
        { className: 'dsh-tv-legacyBox' },
        React.createElement('div', { className: 'dsh-tv-legacyTitle' }, '⚠️ 這是舊版留下來的紀錄'),
        React.createElement(
          'div',
          { className: 'dsh-tv-note' },
          '這個資料夾裡沒有 tavern.json，所以它不是這一版（v2）建立的——是 v1 自動建立／認養的那間「預設酒館」。它一直躺在酒館清單裡，只是酒館街預設收合，所以你按了 ＋ 讓清單第一次展開時，才會跟著新酒館一起出現。',
        ),
        React.createElement(
          'div',
          { className: 'dsh-tv-note' },
          '按下面的「移除」只會把這筆紀錄從清單拿掉，資料夾與裡面的檔案一個都不會刪。',
        ),
      )
    }

    /**
     * 世界書：`worldbooks/*.json` 的清單 ＋ 原始 JSON 編輯器。
     *
     * 刻意不做欄位表單——世界書的格式很多種（SillyTavern 的 uid 物件、陣列、自訂），
     * 直接編輯原始 JSON 才不會吃掉使用者的欄位。
     */
    function MapWorldbooks() {
      var render = useForceRender()
      var ref = React.useRef(null)
      if (ref.current === null) ref.current = { books: [], selected: null, draft: '', message: '', error: '', busy: false }
      var state = ref.current
      /** 匯入世界書用的隱藏 file input。 */
      var importInputRef = React.useRef(null)

      function loadList() {
        return rpc('worldbook.list')
          .then(function (books) {
            state.books = books
            render()
          })
          .catch(function (error) {
            state.error = String((error && error.message) || error)
            render()
          })
      }

      React.useEffect(function () {
        loadList()
      }, [])
      // 別的分區動了內容、或使用者按了「重新讀取」→ 這份清單也要重讀。
      useRefreshVersion(loadList)

      function open(id) {
        state.selected = id
        state.message = ''
        state.error = ''
        render()
        rpc('worldbook.read', { book: id })
          .then(function (data) {
            if (state.selected !== id) return
            state.draft = JSON.stringify(data, null, 2)
            render()
          })
          .catch(function (error) {
            state.error = String((error && error.message) || error)
            render()
          })
      }

      function create() {
        state.error = ''
        rpc('worldbook.write', { payload: { name: '新世界書', entries: {} } })
          .then(function (id) {
            notifyWorkspaceChanged()
            return loadList().then(function () {
              open(id)
            })
          })
          .catch(function (error) {
            state.error = String((error && error.message) || error)
            render()
          })
      }

      function save() {
        state.busy = true
        state.error = ''
        state.message = ''
        render()
        var parsed
        try {
          parsed = JSON.parse(state.draft)
        } catch (error) {
          state.busy = false
          state.error = 'JSON 有錯：' + String((error && error.message) || error)
          render()
          return
        }
        rpc('worldbook.write', { book: state.selected, payload: parsed })
          .then(function () {
            state.busy = false
            state.message = '已寫回 worldbooks/' + String(state.selected) + '.json'
            render()
            loadList()
          })
          .catch(function (error) {
            state.busy = false
            state.error = String((error && error.message) || error)
            render()
          })
      }

      function remove(id) {
        rpc('worldbook.delete', { book: id })
          .then(function () {
            if (state.selected === id) {
              state.selected = null
              state.draft = ''
            }
            state.message = '已刪除 worldbooks/' + String(id) + '.json'
            render()
            notifyWorkspaceChanged()
            loadList()
          })
          .catch(function (error) {
            state.error = String((error && error.message) || error)
            render()
          })
      }

      /**
       * 匯入世界書檔（`.json`）。
       *
       * 世界書格式很多種，使用者手上通常已經有一本——手動貼進編輯器很折磨。
       * 跟匯入卡片一樣走二進位路由。
       */
      function importBook(file) {
        if (file === null || file === undefined) return
        state.busy = true
        state.error = ''
        state.message = '匯入中…'
        render()
        return sendFileExpectOk(
          'worldbook.import',
          { name: file.name || '' },
          file,
          file.type || 'application/json',
        )
          .then(function (result) {
            state.busy = false
            state.message = '已匯入 worldbooks/' + String(result.id) + '.json'
            render()
            notifyWorkspaceChanged()
            return loadList()
          })
          .catch(function (error) {
            state.busy = false
            state.message = ''
            state.error = '匯入失敗：' + String(error.message || error)
            render()
          })
      }

      return React.createElement(
        'div',
        { className: 'dsh-tv-splitGrid' },
        React.createElement(
          'div',
          { className: 'dsh-tv-list' },
          React.createElement(
            'div',
            { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' } },
            React.createElement(MapBtn, { onClick: create, title: '建立一本空的世界書' }, '＋ 新增世界書'),
            React.createElement(
              MapBtn,
              {
                disabled: state.busy,
                title: '匯入既有的世界書 .json（不做欄位轉換，原樣寫入）',
                onClick: function () {
                  if (importInputRef.current !== null && importInputRef.current !== undefined) {
                    importInputRef.current.click()
                  }
                },
              },
              state.busy ? '處理中…' : '📥 匯入世界書',
            ),
            React.createElement('input', {
              type: 'file',
              accept: '.json,application/json',
              style: { display: 'none' },
              ref: importInputRef,
              onChange: function (event) {
                var files = pickFiles(event)
                if (files.length > 0) importBook(files[0])
              },
            }),
          ),
          state.books.length === 0
            ? React.createElement('p', { className: 'dsh-tv-note' }, 'worldbooks/ 裡還沒有 .json。')
            : state.books.map(function (book) {
                var primary = book.assets !== undefined && book.assets !== null ? book.assets.primary : null
                var thumb = primary === null || primary === undefined ? null : findAssetUrl(book.assets, primary)
                return React.createElement(
                  'div',
                  { key: book.id, className: book.id === state.selected ? 'dsh-tv-listItem dsh-tv-listItemOn' : 'dsh-tv-listItem' },
                  React.createElement(
                    'button',
                    { type: 'button', className: 'dsh-tv-listPick', onClick: function () { open(book.id) } },
                    thumb === null ? null : React.createElement('img', { className: 'dsh-tv-face', src: thumb, alt: '', loading: 'lazy' }),
                    book.file,
                  ),
                  React.createElement(
                    'button',
                    { type: 'button', className: 'dsh-tv-miniBtn', title: '刪除', onClick: function () { remove(book.id) } },
                    '✕',
                  ),
                )
              }),
        ),
        React.createElement(
          'div',
          { className: 'dsh-tv-splitMain' },
          state.selected === null
            ? React.createElement('p', { className: 'dsh-tv-note' }, '從左邊選一本世界書，或按「新增世界書」。')
            : React.createElement(
                'div',
                null,
                React.createElement('div', { className: 'dsh-tv-fieldLabel' }, 'worldbooks/' + state.selected + '.json（原始 JSON）'),
                React.createElement('textarea', {
                  className: 'dsh-tv-ta',
                  rows: 16,
                  value: state.draft,
                  onChange: function (event) {
                    state.draft = event.target.value
                    render()
                  },
                }),
                React.createElement(
                  'div',
                  { className: 'dsh-tv-inlineRow', style: { marginTop: '6px' } },
                  React.createElement(MapBtn, { onClick: save, disabled: state.busy }, state.busy ? '儲存中…' : '儲存'),
                ),
                React.createElement(AssetManager, { key: 'wb-' + String(state.selected), kind: 'worldbook', owner: state.selected }),
              ),
          state.error !== '' ? React.createElement('div', { className: 'dsh-tv-err' }, state.error) : null,
          state.message !== '' ? React.createElement('div', { className: 'dsh-tv-ok' }, state.message) : null,
        ),
      )
    }

    /**
     * 對話紀錄：列出 chats/ 底下的檔案。
     *
     * v2 不在這裡跑對話，但**要能開一份新的**——以前只能從側邊欄那顆 hover 才
     * 出現的 ＋，設定頁的這個分區完全沒有動作可做，使用者找不到入口。
     */
    function MapChatFiles(props) {
      var render = useForceRender()
      var ref = React.useRef(null)
      if (ref.current === null) {
        ref.current = {
          chats: [],
          characters: [],
          error: '',
          busy: false,
          picking: false,
          message: '',
          pendingDelete: '',
        }
      }
      var state = ref.current

      function load() {
        return rpc('chat.list')
          .then(function (chats) {
            state.chats = chats
            state.error = ''
            // 清單重讀之後，原本指著某一份對話的確認狀態就沒有意義了
            // （`renderDeleteRow` 認的是 `character + '/' + name`，不存在的話誰都不會畫它）。
            state.pendingDelete = ''
            render()
          })
          .catch(function (error) {
            state.error = String((error && error.message) || error)
            render()
          })
      }

      React.useEffect(function () {
        load()
      }, [])
      useRefreshVersion(load)

      /** 開新對話要先挑角色，所以順便讀一次角色清單。 */
      function startPicking() {
        state.message = ''
        rpc('character.list')
          .then(function (cards) {
            state.characters = cards.filter(function (item) {
              return item.card !== null
            })
            state.picking = true
            render()
          })
          .catch(function (error) {
            state.error = String((error && error.message) || error)
            render()
          })
      }

      function createFor(characterId) {
        state.busy = true
        render()
        // ⚠️ 一定要帶 `id`（目前酒館）。少了它，宿主半會把 `character` 當成酒館 id，
        // 錯誤訊息變成「找不到這間酒館：老闆娘」——實際踩到過。
        var tavernId = typeof props.tavernId === 'string' ? props.tavernId : ''
        return rpc('chat.create', { id: tavernId, character: characterId })
          .then(function (created) {
            state.busy = false
            state.picking = false
            state.message = '已建立 chats/' + created.character + '/' + created.file
            render()
            // 上面的「對話」統計是 summary.counts，不主動通知就會停在 0。
            notifyWorkspaceChanged()
            return load()
          })
          .catch(function (error) {
            state.busy = false
            state.error = String((error && error.message) || error)
            render()
          })
      }

      /**
       * 刪掉一份對話（`chat.delete`）：**真的刪掉那個 `.jsonl` 檔**。
       *
       * 這跟「從酒館街移除一間酒館」不一樣——那一條只動清單、不碰檔案（有測試釘著）。
       * 所以這一顆要二次確認：`plan.md` §7.6 說這是「UI 階段的第一件事」，而它是這一頁
       * 唯一會讓使用者的資料消失的按鈕。
       *
       * 不用 `window.confirm`：這個 repo 從來沒有用過對話框（側邊欄在最底部，彈窗會被
       * 裁掉——⋯ 與 ＋ 都是為此改成不彈窗的），而且就地展開的確認列在離線測試裡看得到
       * 內容，對話框看不到。所以確認是**同一列底下展開的那一行**，不是彈窗。
       *
       * 酒館 id 在按下確認的**那一刻**才從 props 讀：呼叫端是常駐面板，
       * 使用者可能在等確認的期間切到另一間酒館。
       */
      function remove(chat) {
        state.busy = true
        state.error = ''
        state.message = ''
        render()
        var tavernId = typeof props.tavernId === 'string' ? props.tavernId : ''
        return rpc('chat.delete', { id: tavernId, character: chat.character, chat: chat.name })
          .then(function (result) {
            state.busy = false
            state.pendingDelete = ''
            state.message =
              '已刪除 ' + String(result.character) + '/' + String(result.chat) + '.jsonl' +
              '（對話室插圖留著；session 綁定也一起解掉了）'
            render()
            // 上面的「對話」統計是 summary.counts，不主動通知就會停在舊數字。
            notifyWorkspaceChanged()
            return load()
          })
          .catch(function (error) {
            state.busy = false
            state.pendingDelete = ''
            state.error = '刪除失敗：' + String((error && error.message) || error)
            render()
          })
      }

      /** 每一列的 key：`character + '/' + name` 就是這份對話的身分（`chat.file` 會變）。 */
      function chatKey(chat) {
        return String(chat.character) + '/' + String(chat.name)
      }

      /** 刪除的二次確認：就地展開在那一列底下，不彈窗。 */
      function renderDeleteRow(chat) {
        var label = chatKey(chat)
        return React.createElement(
          'div',
          { key: '__del-' + label, className: 'dsh-tv-errRow' },
          React.createElement(
            'span',
            { className: 'dsh-tv-errText' },
            '確定要刪掉 ' + label + '.jsonl 嗎？檔案會真的從磁碟上消失，救不回來。',
          ),
          React.createElement(
            MapBtn,
            { danger: true, disabled: state.busy, onClick: function () { remove(chat) } },
            '確定刪除',
          ),
          React.createElement(
            MapBtn,
            {
              disabled: state.busy,
              onClick: function () {
                state.pendingDelete = ''
                render()
              },
            },
            '取消',
          ),
        )
      }

      var header = React.createElement(
        'div',
        { style: { marginBottom: '10px' } },
        React.createElement(
          MapBtn,
          { primary: true, disabled: state.busy, onClick: startPicking },
          state.busy ? '建立中…' : '＋ 新對話',
        ),
      )

      if (state.error !== '') {
        return React.createElement(
          'div',
          null,
          header,
          React.createElement('div', { className: 'dsh-tv-err' }, state.error),
        )
      }

      // 挑角色：就地展開，不彈窗（酒館街在最底部，彈窗會被裁掉——同一個理由）。
      if (state.picking) {
        return React.createElement(
          'div',
          null,
          header,
          state.characters.length === 0
            ? React.createElement(
                'p',
                { className: 'dsh-tv-note' },
                '還沒有可用的人物卡——先在上面「🎭 人物卡」新增或匯入一張，再回來開對話。',
              )
            : React.createElement(
                'div',
                { className: 'dsh-tv-list' },
                React.createElement('p', { className: 'dsh-tv-note' }, '跟誰開始新對話？'),
                state.characters.map(function (item) {
                  // ⚠️ 要用 `!= null`（同時擋 null 與 undefined）。
                  // 寫成 `item.card !== null && item.card.name` 的話，`undefined !== null`
                  // 是 true，接著讀 `.name` 就丟錯——而 `state.characters` 裡的每個人
                  // 都保證有 `card` 欄位嗎？**不保證**（宿主半的 `listCharacters` 會回
                  // `card: null` 表示「這個檔讀不出卡片」）。同一個坑在 `cardAssets` 踩過一次。
                  var label = item.card != null && item.card.name ? item.card.name : item.id
                  return React.createElement(
                    'div',
                    {
                      key: item.id,
                      className: 'dsh-tv-listItem',
                      onClick: function () {
                        createFor(item.id)
                      },
                    },
                    React.createElement('span', { style: { flex: 1, fontSize: '12.5px' } }, label),
                  )
                }),
              ),
        )
      }

      /**
       * 每一列的內容。
       *
       * `key` 用 `character/name` 而不是 `file`：`file` 是磁碟上的檔名，
       * 而這一列的身分是「哪個角色的哪一份對話」——插圖掛載點、session 對照表
       * 用的都是這一組（`chat.assetId` 才是給資料夾用的正規化名字）。
       */
      function renderChatRow(chat) {
        var label = chatKey(chat)
        return React.createElement(
          'div',
          { key: label, className: 'dsh-tv-listItem' },
          React.createElement('span', { style: { flex: 1, fontSize: '12.5px' } }, label),
          chat.size === null || chat.size === undefined
            ? null
            : React.createElement('span', { className: 'dsh-tv-note' }, String(chat.size) + ' bytes'),
          React.createElement(
            MapBtn,
            {
              danger: true,
              disabled: state.busy,
              title: '刪除這份對話（會真的刪掉 chats/' + label + '.jsonl）',
              onClick: function () {
                // 一次只確認一份：換一列就等於把上一列的確認收掉。
                state.pendingDelete = state.pendingDelete === label ? '' : label
                state.message = ''
                render()
              },
            },
            '刪除',
          ),
        )
      }

      var rows = []
      for (var i = 0; i < state.chats.length; i += 1) {
        rows.push(renderChatRow(state.chats[i]))
        if (state.pendingDelete === chatKey(state.chats[i])) rows.push(renderDeleteRow(state.chats[i]))
      }

      return React.createElement(
        'div',
        null,
        header,
        state.message === ''
          ? null
          : React.createElement('div', { className: 'dsh-tv-ok' }, state.message),
        state.chats.length === 0
          ? React.createElement(
              'p',
              { className: 'dsh-tv-note' },
              'chats/ 裡還沒有對話。按「＋ 新對話」開一份，或把 SillyTavern 的 .jsonl 丟進 chats/<角色>/。',
            )
          : React.createElement('div', { className: 'dsh-tv-list' }, rows),
      )
    }

    function MapOverview(props) {
      var summary = props.summary
      // 同上：`counts` 也來自宿主半的回應，不是我們保證的東西。
      var counts = summary !== null && summary !== undefined && summary.counts !== null && summary.counts !== undefined ? summary.counts : {}
      // ⚠️ 不假設它一定是陣列：`loadTavernData` 是把宿主半的回應直接接上去的，
      // 而失敗路徑（或測試裡的假 RPC）可能回一個不是陣列的東西——那會在渲染期
      // 丟錯，整個 `main` 面板變成死格（`plan.md` §7.4b 那個 bug 的同型）。
      var characters = Array.isArray(props.characters) ? props.characters : []
      var usable = characters.filter(function (item) {
        return item.card !== null
      })
      var layout = summary && Array.isArray(summary.layout) ? summary.layout : ['characters', 'worldbooks', 'chats', 'art']
      /**
       * `art/` 底下依「圖是誰的」分四類。這裡列出來是因為面板其他地方
       * （插圖管理器、對話頁）都在用這些路徑，使用者要能一眼知道圖放哪裡。
       */
      var artKinds = [
        ['characters/', '角色'],
        ['worldbooks/', '世界書'],
        ['chats/', '對話室'],
        ['tavern/', '店面'],
      ]
      /**
       * 只有真的在磁碟上的檔案才顯示。
       *
       * 以前這兩個標籤是**永久硬寫**的，於是「沒有 tavern.json 的舊版殘留酒館」
       * 會同時顯示「tavern.json　這間酒館的設定」與下面的「這個資料夾裡沒有
       * tavern.json」——自己打自己。現在改成看 summary.files。
       */
      var files = summary && Array.isArray(summary.files) ? summary.files : []
      var fileTags = []
      if (files.indexOf('tavern.json') >= 0) fileTags.push(['tavern.json', '這間酒館的設定'])
      if (files.indexOf('README.txt') >= 0) fileTags.push(['README.txt', '說明'])
      if (files.indexOf('originals') >= 0) fileTags.push(['originals/', '匯入卡片的原版'])
      return React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          { className: 'dsh-tv-dash' },
          React.createElement(
            'div',
            { className: 'dsh-tv-stat' },
            React.createElement('div', { className: 'dsh-tv-statN' }, String(usable.length)),
            React.createElement('div', { className: 'dsh-tv-statL' }, '人物卡'),
          ),
          React.createElement(
            'div',
            { className: 'dsh-tv-stat' },
            React.createElement('div', { className: 'dsh-tv-statN' }, String(counts.worldbooks || 0)),
            React.createElement('div', { className: 'dsh-tv-statL' }, '世界書'),
          ),
          React.createElement(
            'div',
            { className: 'dsh-tv-stat' },
            React.createElement('div', { className: 'dsh-tv-statN' }, String(counts.chats || 0)),
            React.createElement('div', { className: 'dsh-tv-statL' }, '對話'),
          ),
          React.createElement(
            'div',
            { className: 'dsh-tv-stat' },
            React.createElement('div', { className: 'dsh-tv-statN' }, String(counts.art || 0)),
            // 不只「立繪」了：art/ 現在裝角色／世界書／對話室／店面四種圖。
            React.createElement('div', { className: 'dsh-tv-statL' }, '插圖'),
          ),
        ),
        React.createElement('div', { className: 'dsh-tv-fieldLabel' }, '資料夾位置'),
        React.createElement('p', { className: 'dsh-tv-path' }, summary ? summary.root : '（讀取中）'),
        React.createElement('div', { className: 'dsh-tv-fieldLabel', style: { marginTop: '10px' } }, '資料夾結構'),
        React.createElement(
          'div',
          { className: 'dsh-tv-layout' },
          layout.map(function (part) {
            return React.createElement(
              'span',
              { key: part, className: 'dsh-tv-chip' },
              part + '/　' + (ASSET_LABELS_BY_DIR[part] || ''),
            )
          }),
          fileTags.map(function (pair) {
            return React.createElement('span', { key: pair[0], className: 'dsh-tv-chip' }, pair[0] + '　' + pair[1])
          }),
        ),
        React.createElement(
          'div',
          { className: 'dsh-tv-fieldLabel', style: { marginTop: '12px' } },
          'art/ 底下（插圖依「圖是誰的」分四類）',
        ),
        React.createElement(
          'div',
          { className: 'dsh-tv-layout' },
          artKinds.map(function (pair) {
            return React.createElement(
              'span',
              { key: pair[0], className: 'dsh-tv-chip' },
              'art/' + pair[0] + '　' + pair[1],
            )
          }),
        ),
        React.createElement(
          'p',
          { className: 'dsh-tv-note', style: { marginTop: '12px' } },
          '全部都是普通檔案：現成的人物卡（SillyTavern 格式，PNG 或 JSON）直接丟進 characters/，' +
            '插圖直接丟進 art/ 對應的資料夾，按「重新讀取」就會出現；' +
            '整個資料夾可以直接備份、手改、傳給別人。這個插件只讀寫檔案，不會碰你的對話或模型設定。',
        ),
      )
    }

    function MapCharacters(props) {
      var render = useForceRender()
      var ref = React.useRef(null)
      /** 匯入卡片用的隱藏 file input（PNG 卡或 JSON 卡）。 */
      var importInputRef = React.useRef(null)
      if (ref.current === null) ref.current = { selected: null, draft: null, message: '', error: '', busy: false }
      var state = ref.current

      /**
       * 目前酒館的 id。
       *
       * ⚠️ **每一個 `character.*` 呼叫都要帶它。** 宿主半的參數約定是
       * `{ id: 酒館id, card: 角色id }`——`id` 一律是**酒館**。
       *
       * 這裡踩過一個跟 `chat.create` 同型的 bug：這一區以前送
       * `{ id: 角色id }`，於是宿主半拿角色名去找酒館，回
       * **「找不到這間酒館：老闆娘」**——讀取、儲存、刪除三個動作全中，
       * 而畫面看起來完全正常（只有一個紅字）。`create` 更隱蔽：它送
       * `{ card: { name } }` 而宿主半讀 `args.name`，所以永遠建立「新角色」。
       *
       * `test-client.mjs` §4c 把「每個 character.* 都要帶酒館 id」釘住了。
       */
      var tavernId = typeof props.tavernId === 'string' ? props.tavernId : ''

      function select(id) {
        state.selected = id
        state.draft = null
        state.message = ''
        state.error = ''
        render()
        // `card` 才是角色 id；`id` 是酒館。
        rpc('character.read', { id: tavernId, card: id })
          .then(function (card) {
            if (state.selected !== id) return
            state.draft = card
            render()
          })
          .catch(function (error) {
            state.error = String(error.message || error)
            render()
          })
      }

      function patch(field, value) {
        if (state.draft === null) return
        var next = {}
        for (var key in state.draft) {
          if (Object.prototype.hasOwnProperty.call(state.draft, key)) next[key] = state.draft[key]
        }
        next[field] = value
        state.draft = next
        render()
      }

      function save() {
        if (state.draft === null) return
        state.busy = true
        state.error = ''
        render()
        rpc('character.write', { id: tavernId, card: state.selected, payload: state.draft })
          .then(function (id) {
            state.selected = id
            state.busy = false
            state.message = '已儲存到 characters/' + String(id) + '.json'
            render()
            props.reload()
          })
          .catch(function (error) {
            state.busy = false
            state.error = '儲存失敗：' + String(error.message || error)
            render()
          })
      }

      function create() {
        state.error = ''
        rpc('character.create', { id: tavernId, name: '新角色' })
          .then(function (id) {
            props.reload()
            select(id)
          })
          .catch(function (error) {
            state.error = String(error.message || error)
            render()
          })
      }

      /**
       * 匯入卡片檔（PNG 或 JSON）。
       *
       * 走二進位路由（跟插圖上傳同一條），因為 PNG 卡同時是圖片也是資料：
       * 宿主半會把 tEXt chunk 裡的卡片讀出來、寫成 characters/<id>.json，
       * 順便把那張 PNG 留成原版並當成這張卡的插圖。
       */
      function importCard(file) {
        if (file === null || file === undefined) return
        state.busy = true
        state.error = ''
        state.message = '匯入中…'
        render()
        return sendFileExpectOk(
          'character.import',
          { name: file.name || '' },
          file,
          file.type || 'application/octet-stream',
        )
          .then(function (value) {
            state.busy = false
            state.message =
              '已匯入「' +
              String(value.name) +
              '」（' +
              (value.source === 'json' ? 'JSON' : String(value.source)) +
              (value.artAdded !== null && value.artAdded !== undefined ? '，插圖：' + String(value.artAdded) : '') +
              '）'
            render()
            return props.reload()
          })
          .catch(function (error) {
            state.busy = false
            state.message = ''
            state.error = '匯入失敗：' + String(error.message || error)
            render()
          })
      }

      function remove(id) {
        rpc('character.delete', { id: tavernId, card: id })
          .then(function () {
            state.selected = null
            state.draft = null
            state.message = '已刪除'
            render()
            props.reload()
          })
          .catch(function (error) {
            state.error = String(error.message || error)
            render()
          })
      }

      // 同 `MapOverview`：不假設它一定是陣列（壞掉時整個面板會變成死格）。
      var cards = Array.isArray(props.characters) ? props.characters : []
      var usable = cards.filter(function (item) {
        return item.card !== null
      })

      return React.createElement(
        'div',
        null,
        state.error ? React.createElement('div', { className: 'dsh-tv-err' }, state.error) : null,
        state.message ? React.createElement('div', { className: 'dsh-tv-ok' }, state.message) : null,
        React.createElement(
          'div',
          { className: 'dsh-tv-splitGrid' },
          React.createElement(
            'div',
            null,
            React.createElement(
              'div',
              { style: { marginBottom: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
              React.createElement(MapBtn, { primary: true, onClick: create }, '＋ 新增角色'),
              React.createElement(
                MapBtn,
                {
                  disabled: state.busy,
                  title: '匯入 SillyTavern 的 PNG 卡或 JSON 卡',
                  onClick: function () {
                    if (importInputRef.current !== null && importInputRef.current !== undefined) {
                      importInputRef.current.click()
                    }
                  },
                },
                state.busy ? '處理中…' : '📥 匯入卡片',
              ),
              React.createElement('input', {
                type: 'file',
                accept: '.png,.json,image/png,application/json',
                style: { display: 'none' },
                ref: importInputRef,
                onChange: function (event) {
                  var files = pickFiles(event)
                  if (files.length > 0) importCard(files[0])
                },
              }),
            ),
            usable.length === 0
              ? React.createElement(
                  'div',
                  { className: 'dsh-tv-note' },
                  '還沒有角色卡。按「新增角色」開始，或把現成的卡丟進工作區的 characters/ 目錄。',
                )
              : usable.map(function (item) {
                  var primary = item.assets !== undefined && item.assets !== null ? item.assets.primary : null
                  var thumb = primary === null || primary === undefined
                    ? null
                    : findAssetUrl(item.assets, primary)
                  return React.createElement(
                    'div',
                    {
                      key: item.id,
                      className: state.selected === item.id ? 'dsh-tv-listItem dsh-tv-listItemOn' : 'dsh-tv-listItem',
                      onClick: function () {
                        select(item.id)
                      },
                    },
                    thumb === null
                      ? React.createElement('span', { className: 'dsh-tv-faceEmpty' }, '🎭')
                      : React.createElement('img', { className: 'dsh-tv-face', src: thumb, alt: '', loading: 'lazy' }),
                    React.createElement('span', { style: { flex: 1, fontSize: '12.5px' } }, item.card.name || item.id),
                    item.assets !== undefined && item.assets !== null && item.assets.items.length > 1
                      ? React.createElement('span', { className: 'dsh-tv-count' }, String(item.assets.items.length))
                      : null,
                  )
                }),
          ),
          React.createElement(
            'div',
            null,
            state.draft === null
              ? React.createElement(
                  'div',
                  { className: 'dsh-tv-empty' },
                  usable.length === 0 ? '新增一張角色卡後，這裡會出現編輯器。' : '從左邊選一張角色卡開始編輯。',
                )
              : React.createElement(
                  'div',
                  null,
                  React.createElement(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '14px' } },
                    React.createElement(
                      'span',
                      { style: { flex: 1, fontSize: '14px', fontWeight: 600 } },
                      state.draft.name || '（無名）',
                    ),
                    React.createElement(MapBtn, { primary: true, onClick: save, disabled: state.busy }, state.busy ? '儲存中…' : '儲存'),
                    React.createElement(
                      MapBtn,
                      {
                        danger: true,
                        onClick: function () {
                          remove(state.selected)
                        },
                      },
                      '刪除',
                    ),
                  ),
                  React.createElement(CardAssets, { card: state.draft, id: state.selected }),
                  React.createElement(AssetManager, { key: 'ch-' + String(state.selected), kind: 'character', owner: state.selected }),
                  CARD_FIELDS.map(function (field) {
                    return React.createElement(MapField, {
                      key: field.key,
                      label: field.label,
                      hint: field.hint,
                      rows: field.rows,
                      textarea: field.textarea === true,
                      value: typeof state.draft[field.key] === 'string' ? state.draft[field.key] : '',
                      onChange: function (value) {
                        patch(field.key, value)
                      },
                    })
                  }),
                  React.createElement('p', { className: 'dsh-tv-note' }, '檔案：characters/' + String(state.selected) + '.json'),
                ),
          ),
        ),
      )
    }


    /** 下拉選單列。 */
    function MapSelect(props) {
      return React.createElement(
        'label',
        { className: 'dsh-tv-field' },
        React.createElement('span', { className: 'dsh-tv-fieldLabel' }, props.label),
        React.createElement(
          'select',
          {
            className: 'dsh-tv-in',
            value: props.value,
            onChange: function (event) {
              props.onChange(event.target.value)
            },
          },
          props.options.map(function (option) {
            return React.createElement('option', { key: option.value === '' ? '__none' : option.value, value: option.value }, option.label)
          }),
        ),
        props.hint ? React.createElement('span', { className: 'dsh-tv-fieldHint' }, props.hint) : null,
      )
    }

    /* ------------------------------ 酒館街 ------------------------------ */

    /** 原生工作區宣告的那個子座位（資料夾選擇流程住在那裡）。 */
    var WORKSPACE_FLOW_KEY = 'sidebar.workspaces.directoryFlow'

    /** 我們鏡射出來的等價座位；原生的 renderSlot 呼叫會被映射到這裡。 */
    var TAVERN_FLOW_KEY = 'dsh-tavern.workspaces.flow'

    /** 側邊欄一次顯示幾間酒館／幾個對話，其餘用原生那顆「展開其餘 N 個」收起。 */
    var TAVERN_PREVIEW = 4
    var CHAT_PREVIEW = 6

    /* ---- 圖示：照原生那一套（16px、currentColor、跟著主題變色） ---- */

    function IconChevron() {
      return React.createElement(
        'svg',
        { className: 'dsh-tv-arrow', width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
        React.createElement('path', { d: 'M5 3.2 5 10.8 10.4 7 Z', fill: 'currentColor' }),
      )
    }

    function IconDots() {
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        React.createElement('circle', { cx: 3.4, cy: 8, r: 1.3, fill: 'currentColor' }),
        React.createElement('circle', { cx: 8, cy: 8, r: 1.3, fill: 'currentColor' }),
        React.createElement('circle', { cx: 12.6, cy: 8, r: 1.3, fill: 'currentColor' }),
      )
    }

    /**
     * 對話列上 ⋯ 選單的三顆圖示。
     *
     * 形狀照原生那三顆（`IconEditOutline16` / `IconBranchOutline16` /
     * `IconTrashOutline16`）：16×16、線寬 1.2、`currentColor`。
     * 原生那三顆住在 `@deepseek-ai/dsh-client-ui-primitives`，而**客戶端 bundle
     * 的 `require` 只拿得到 `react`**（模組載入器的凍結清單），所以只能自己畫。
     */
    function IconEdit() {
      return React.createElement(
        'svg',
        {
          width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
        },
        React.createElement('path', { d: 'M11.1 2.6 13.4 4.9 5.9 12.4 3.2 12.8 3.6 10.1Z' }),
        React.createElement('path', { d: 'M9.8 3.9 12.1 6.2' }),
      )
    }

    function IconBranch() {
      return React.createElement(
        'svg',
        {
          width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.2, strokeLinecap: 'round', 'aria-hidden': 'true',
        },
        React.createElement('circle', { cx: 4.2, cy: 3.8, r: 1.7 }),
        React.createElement('circle', { cx: 4.2, cy: 12.2, r: 1.7 }),
        React.createElement('circle', { cx: 11.8, cy: 5.9, r: 1.7 }),
        React.createElement('path', { d: 'M4.2 5.5v5' }),
        React.createElement('path', { d: 'M9.4 6.6c-1.6.8-3.4.9-5.2.7' }),
      )
    }

    function IconTrash() {
      return React.createElement(
        'svg',
        {
          width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
        },
        React.createElement('path', { d: 'M2.8 4.4h10.4' }),
        React.createElement('path', { d: 'M6.6 4.4V2.9h2.8v1.5' }),
        React.createElement('path', { d: 'M4.2 4.4v8.1c0 .5.4.9.9.9h5.8c.5 0 .9-.4.9-.9V4.4' }),
        React.createElement('path', { d: 'M6.7 7.1v3.6M9.3 7.1v3.6' }),
      )
    }

    /**
     * 「進行中」的指示器——照抄 DSH 原生 `StatusDot` 的 `ongoing` 分支。
     *
     * 原生的實作（`dsh-web-frontend` 的 bundle）：
     *
     * ```js
     * const RING = [[0,0],[4,0],[8,0],[8,4],[8,8],[4,8],[0,8],[0,4]]
     * // state === 'ongoing' 時：
     * <svg width={10} height={10} viewBox="0 0 10 10" shapeRendering="crispEdges">
     *   {RING.map(([x, y], i) => <rect x={x} y={y} width="2" height="2"
     *     style={{ animationDelay: `${(i - RING.length) * 125}ms` }} />)}
     * </svg>
     * ```
     *
     * 也就是**八顆 2×2 的方格繞一圈**，用負的 `animation-delay`（-1000ms 起、
     * 每顆 +125ms）讓同一條 `dot-chase` 動畫依序跑過每一顆——看起來是一顆光點
     * 繞著方框跑。顏色是 `--dsw-static-deepseek-450`（這台是 `var(--dsh-tv-live)`）。
     *
     * 使用者：「dsh check Room 思考的時候運作中的時候會換一個思考中的圖表的動圖」
     * ——就是這一顆。**靜態的燈泡只在「想完了、可以展開看」時出現。**
     */
    var RUNNING_RING = [
      [0, 0],
      [4, 0],
      [8, 0],
      [8, 4],
      [8, 8],
      [4, 8],
      [0, 8],
      [0, 4],
    ]

    function RunningDot(props) {
      var size = props !== undefined && typeof props.size === 'number' ? props.size : 10
      return React.createElement(
        'svg',
        {
          className: 'dsh-tv-runDot',
          'data-state': 'ongoing',
          width: size,
          height: size,
          viewBox: '0 0 10 10',
          shapeRendering: 'crispEdges',
          'aria-hidden': 'true',
        },
        RUNNING_RING.map(function (cell, index) {
          return React.createElement('rect', {
            key: String(cell[0]) + '-' + String(cell[1]),
            className: 'dsh-tv-runCell',
            x: cell[0],
            y: cell[1],
            width: '2',
            height: '2',
            // 負延遲＝「已經跑了多久」，所以第一顆最亮、依序衰減——原生的算式。
            style: { animationDelay: String((index - RUNNING_RING.length) * 125) + 'ms' },
          })
        }),
      )
    }

    /**
     * 「思考」的圖示（原生是 `IconThinkOutline14`，14px）。
     *
     * 原生那一顆住在 `@deepseek-ai/dsh-client-ui-primitives`，而客戶端 bundle 的
     * `require` 只拿得到 `react`——所以照它的形狀（燈泡）自己畫一顆。
     */
    function IconThink() {
      return React.createElement(
        'svg',
        {
          width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
        },
        React.createElement('path', { d: 'M8 1.9a4 4 0 0 0-2.4 7.2c.5.4.8 1 .8 1.6v.5h3.2v-.5c0-.6.3-1.2.8-1.6A4 4 0 0 0 8 1.9Z' }),
        React.createElement('path', { d: 'M6.4 13.1h3.2' }),
        React.createElement('path', { d: 'M7 14.6h2' }),
      )
    }

    /**
     * 「思考」那一列（原生 `ReasoningRow` 的簡化版）。
     *
     * 折疊時只顯示「🧠 思考 ＋ 一小段預覽」（預覽是原生 `collapsedContent` 的做法：
     * 讓使用者知道它真的在想，而不是卡住）；點一下展開全文。
     * `running` 為真時疊一層流動的高光——那是「還在想」的唯一訊號。
     */
    function ThinkingRow(props) {
      // `useForceRender()` 是模組層級元件共用的重繪方式（原本寫在 `TavernChatPage`
      // 裡面時用的是那個元件的 `render`；搬到這一層就沒有了）。
      var render = useForceRender()
      var rowRef = React.useRef(null)
      if (rowRef.current === null) rowRef.current = { open: false }
      var row = rowRef.current
      // ⚠️ 預設收合，但**串流中自動展開**（想的時候看得到內容比較安心；
      // 使用者一旦自己點過，就尊重他的選擇——`touched`）。
      if (props.running === true && row.touched !== true) row.open = true
      var text = typeof props.text === 'string' ? props.text : ''
      var peek = text.replace(/\s+/g, ' ').slice(0, 60)
      return React.createElement(
        'div',
        { className: 'dsh-tv-thinkGroup' },
        React.createElement(
          'div',
          {
            className:
              'dsh-tv-think' +
              (row.open ? ' dsh-tv-thinkOn' : '') +
              (props.running === true ? ' dsh-tv-thinkRun' : ''),
            role: 'button',
            tabIndex: 0,
            'aria-expanded': row.open ? 'true' : 'false',
            title: row.open ? '收合思考' : '展開思考',
            onClick: function () {
              row.open = !row.open
              row.touched = true
              render()
            },
            onKeyDown: function (event) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                row.open = !row.open
                row.touched = true
                render()
              }
            },
          },
          React.createElement('span', { className: 'dsh-tv-thinkIcon' }, React.createElement(IconThink)),
          React.createElement('span', { className: 'dsh-tv-thinkLabel' }, '思考'),
          row.open ? null : React.createElement('span', { className: 'dsh-tv-thinkPeek' }, peek),
          React.createElement(
            'span',
            { className: 'dsh-tv-thinkChevron' },
            React.createElement(IconChevron),
          ),
        ),
        row.open && text !== ''
          ? React.createElement('div', { className: 'dsh-tv-thinkText' }, text)
          : null,
      )
    }


    /**
     * 「進行中」的指示器——照抄 DSH 原生 `StatusDot` 的 `ongoing` 分支。
     *
     * 八顆 2×2 的方格繞一圈，用**負的 `animation-delay`**（-1000ms 起、每顆 +125ms）
     * 讓同一條 `dot-chase` 動畫依序跑過每一顆——看起來是一顆光點繞著方框跑。
     * 顏色是 `--dsw-static-deepseek-450`（這台是 `#5686fe`）。
     */
    var RUNNING_RING = [
      [0, 0],
      [4, 0],
      [8, 0],
      [8, 4],
      [8, 8],
      [4, 8],
      [0, 8],
      [0, 4],
    ]

    function RunningDot(props) {
      var size = props !== undefined && typeof props.size === 'number' ? props.size : 10
      return React.createElement(
        'svg',
        {
          className: 'dsh-tv-runDot',
          'data-state': 'ongoing',
          width: size,
          height: size,
          viewBox: '0 0 10 10',
          shapeRendering: 'crispEdges',
          'aria-hidden': 'true',
        },
        RUNNING_RING.map(function (cell, index) {
          return React.createElement('rect', {
            key: String(cell[0]) + '-' + String(cell[1]),
            className: 'dsh-tv-runCell',
            x: cell[0],
            y: cell[1],
            width: '2',
            height: '2',
            style: { animationDelay: String((index - RUNNING_RING.length) * 125) + 'ms' },
          })
        }),
      )
    }

    /** 對話列的 ⋯ 選單三顆圖示（形狀照原生 IconEdit / IconBranch / IconTrash）。 */
    function IconEdit() {
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        React.createElement('path', { d: 'M11.1 2.6 13.4 4.9 5.9 12.4 3.2 12.8 3.6 10.1Z' }),
        React.createElement('path', { d: 'M9.8 3.9 12.1 6.2' }),
      )
    }

    function IconBranch() {
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.2, strokeLinecap: 'round', 'aria-hidden': 'true' },
        React.createElement('circle', { cx: 4.2, cy: 3.8, r: 1.7 }),
        React.createElement('circle', { cx: 4.2, cy: 12.2, r: 1.7 }),
        React.createElement('circle', { cx: 11.8, cy: 5.9, r: 1.7 }),
        React.createElement('path', { d: 'M4.2 5.5v5' }),
        React.createElement('path', { d: 'M9.4 6.6c-1.6.8-3.4.9-5.2.7' }),
      )
    }

    function IconTrash() {
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        React.createElement('path', { d: 'M2.8 4.4h10.4' }),
        React.createElement('path', { d: 'M6.6 4.4V2.9h2.8v1.5' }),
        React.createElement('path', { d: 'M4.2 4.4v8.1c0 .5.4.9.9.9h5.8c.5 0 .9-.4.9-.9V4.4' }),
        React.createElement('path', { d: 'M6.7 7.1v3.6M9.3 7.1v3.6' }),
      )
    }

    /** 「思考」的圖示（原生 IconThinkOutline14 的形狀：燈泡）。 */
    function IconThink() {
      return React.createElement(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        React.createElement('path', { d: 'M8 1.9a4 4 0 0 0-2.4 7.2c.5.4.8 1 .8 1.6v.5h3.2v-.5c0-.6.3-1.2.8-1.6A4 4 0 0 0 8 1.9Z' }),
        React.createElement('path', { d: 'M6.4 13.1h3.2' }),
        React.createElement('path', { d: 'M7 14.6h2' }),
      )
    }


    /**
     * 「思考」那一列（原生 `ReasoningRow` 的簡化版）。
     *
     * 折疊時只顯示「思考 ＋ 一小段預覽」，點一下展開全文；`running` 為真時
     * 疊一層流動的高光——那是「還在想」的唯一訊號。
     */
    function ThinkingRow(props) {
      var render = useForceRender()
      var rowRef = React.useRef(null)
      if (rowRef.current === null) rowRef.current = { open: false }
      var row = rowRef.current
      // 預設收合，但**串流中自動展開**（想的時候看得到內容比較安心；
      // 使用者一旦自己點過，就尊重他的選擇——`touched`）。
      if (props.running === true && row.touched !== true) row.open = true
      var text = typeof props.text === 'string' ? props.text : ''
      var peek = text.replace(/\s+/g, ' ').slice(0, 60)
      return React.createElement(
        'div',
        { className: 'dsh-tv-thinkGroup' },
        React.createElement(
          'div',
          {
            className:
              'dsh-tv-think' +
              (row.open ? ' dsh-tv-thinkOn' : '') +
              (props.running === true ? ' dsh-tv-thinkRun' : ''),
            role: 'button',
            tabIndex: 0,
            'aria-expanded': row.open ? 'true' : 'false',
            title: row.open ? '收合思考' : '展開思考',
            onClick: function () {
              row.open = !row.open
              row.touched = true
              render()
            },
            onKeyDown: function (event) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                row.open = !row.open
                row.touched = true
                render()
              }
            },
          },
          React.createElement('span', { className: 'dsh-tv-thinkIcon' }, React.createElement(IconThink)),
          React.createElement('span', { className: 'dsh-tv-thinkLabel' }, '思考'),
          row.open ? null : React.createElement('span', { className: 'dsh-tv-thinkPeek' }, peek),
          React.createElement('span', { className: 'dsh-tv-thinkChevron' }, React.createElement(IconChevron)),
        ),
        row.open && text !== ''
          ? React.createElement('div', { className: 'dsh-tv-thinkText' }, text)
          : null,
      )
    }

    function IconPlus() {
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        React.createElement('path', {
          d: 'M7.35 1.5h1.3v5.85H14.5v1.3H8.65V14.5h-1.3V8.65H1.5v-1.3h5.85V1.5Z',
          fill: 'currentColor',
        }),
      )
    }

    /** 角色（挑「跟誰開始新對話」時用的圖示）。 */
    function IconCharacter() {      return React.createElement(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          'aria-hidden': 'true',
        },
        React.createElement('circle', { cx: 8, cy: 5.6, r: 2.4 }),
        React.createElement('path', { d: 'M3.4 13.4c0-2.3 2-3.8 4.6-3.8s4.6 1.5 4.6 3.8' }),
      )
    }

    function IconChat() {      return React.createElement(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          'aria-hidden': 'true',
        },
        React.createElement('path', {
          d: 'M3.4 3h9.2c.8 0 1.4.6 1.4 1.4v5c0 .8-.6 1.4-1.4 1.4H7.6l-3 2.6v-2.6h-1.2c-.8 0-1.4-.6-1.4-1.4v-5C2 3.6 2.6 3 3.4 3Z',
          strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * 燈籠（酒館的預設圖示）——**有顏色**。
     *
     * 用固定色而不是 `currentColor`：單色線條在 16px 下看不出是燈籠（使用者：
     * 「現在純藍色我看不出是燈籠」）。紅燈身＋金蓋是燈籠的識別色，換主題也不會走鐘。
     */
    function IconLantern() {
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        React.createElement('path', { d: 'M8 1.1v1.1', stroke: 'var(--dsh-tv-warn)', strokeWidth: 1.3, strokeLinecap: 'round' }),
        React.createElement('rect', { x: 5.6, y: 2.1, width: 4.8, height: 1.4, rx: 0.6, fill: 'var(--dsh-tv-warn)' }),
        React.createElement('rect', { x: 4.1, y: 3.4, width: 7.8, height: 8.2, rx: 2.7, fill: 'var(--dsh-tv-danger)' }),
        React.createElement('ellipse', { cx: 8, cy: 7.4, rx: 2.5, ry: 2.9, fill: 'var(--dsh-tv-accent)', opacity: 0.55 }),
        React.createElement('path', { d: 'M8 3.7v7.6', stroke: 'var(--dsh-tv-warn)', strokeWidth: 0.9, opacity: 0.9 }),
        React.createElement('rect', { x: 5.6, y: 11.5, width: 4.8, height: 1.4, rx: 0.6, fill: 'var(--dsh-tv-warn)' }),
        React.createElement('path', { d: 'M8 12.9v1.9', stroke: 'var(--dsh-tv-warn)', strokeWidth: 1.2, strokeLinecap: 'round' }),
      )
    }

    /** 啤酒杯——「酒館街」這個區塊自己的圖示（使用者指定要用啤酒）。 */
    function IconBeer() {
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        React.createElement('path', {
          d: 'M3.1 5.2h7.4v7.8c0 .6-.5 1.1-1.1 1.1H4.2c-.6 0-1.1-.5-1.1-1.1V5.2Z',
          fill: 'var(--dsh-tv-warn)',
        }),
        React.createElement('path', {
          d: 'M10.5 6.6h1.4c.8 0 1.4.6 1.4 1.4v2.2c0 .8-.6 1.4-1.4 1.4h-1.4',
          stroke: 'var(--dsh-tv-warn)',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
        React.createElement('path', { d: 'M5 6.9v5.4', stroke: 'var(--dsh-tv-warn)', strokeWidth: 1, strokeLinecap: 'round' }),
        React.createElement('circle', { cx: 4.6, cy: 4.1, r: 1.15, fill: 'var(--dsh-tv-text-1)' }),
        React.createElement('circle', { cx: 6.7, cy: 3.3, r: 1.45, fill: 'var(--dsh-tv-text-1)' }),
        React.createElement('circle', { cx: 9.1, cy: 4.1, r: 1.15, fill: 'var(--dsh-tv-text-1)' }),
        React.createElement('path', { d: 'M3.4 5.7h6.8', stroke: 'var(--dsh-tv-text-1)', strokeWidth: 1.1, strokeLinecap: 'round' }),
      )
    }

    /** 酒館街的高度存在 localStorage（拖過一次就固定，展開時不再彈動）。 */
    var STREET_PX_KEY = 'dsh-tavern.streetPx'

    function readStreetPx() {
      try {
        var raw = window.localStorage.getItem(STREET_PX_KEY)
        var value = raw === null ? NaN : Number.parseInt(raw, 10)
        return Number.isFinite(value) && value >= 96 ? value : null
      } catch (error) {
        return null
      }
    }

    function writeStreetPx(px) {
      try {
        if (px === null) window.localStorage.removeItem(STREET_PX_KEY)
        else window.localStorage.setItem(STREET_PX_KEY, String(px))
      } catch (error) {
        /* 私密模式／被停用就算了，只是不會記住 */
      }
    }

    /** 設定頁可以挑的圖示（第一個是內建彩色燈籠＝預設）。 */
    var TAVERN_ICON_CHOICES = [
      { value: '', label: '預設燈籠' },
      { value: '🍺', label: '啤酒' },
      { value: '🍶', label: '清酒' },
      { value: '🍷', label: '紅酒' },
      { value: '☕', label: '咖啡' },
      { value: '🗡️', label: '刀劍' },
      { value: '🐈', label: '貓' },
      { value: '🌙', label: '月' },
      { value: '🔥', label: '火' },
      { value: '🎭', label: '面具' },
      { value: '📖', label: '書' },
      { value: '🏯', label: '城' },
    ]

    /**
     * 一間酒館在清單裡的圖示。
     *
     * 使用者在設定頁選的字串優先（emoji 或任何短字串），沒選就用內建的彩色燈籠
     * ——「預設好看，但每間酒館可以有自己的個性」。
     */
    function tavernIcon(tavern) {
      var icon = tavern !== null && tavern !== undefined && typeof tavern.icon === 'string' ? tavern.icon.trim() : ''
      if (icon !== '') return React.createElement('span', { className: 'dsh-tv-iconEmoji' }, icon)
      return React.createElement(IconLantern)
    }

    /**
     * 對話列（與對話頁標題）的文字：`角色名 · 對話名`。
     *
     * `character` 是資料夾名（角色 **id**），`characterName` 是卡片上的顯示名稱
     * ——有的話優先用後者，跟原生會話列顯示「工作區名」而不是路徑同一個道理。
     */
    function chatLabel(chat) {
      var who =
        typeof chat.characterName === 'string' && chat.characterName !== '' ? chat.characterName : chat.character
      return who + ' · ' + chat.name
    }

    /** 「6分钟 / 5小时 / 1天」——跟原生會話列同一種相對時間。 */
    function relativeTime(mtimeMs) {      if (typeof mtimeMs !== 'number' || mtimeMs <= 0) return ''
      var minutes = Math.floor((Date.now() - mtimeMs) / 60000)
      if (minutes < 1) return '剛剛'
      if (minutes < 60) return minutes + '分钟'
      var hours = Math.floor(minutes / 60)
      if (hours < 24) return hours + '小时'
      var days = Math.floor(hours / 24)
      if (days < 30) return days + '天'
      return Math.floor(days / 30) + '個月'
    }

    /**
     * 「酒館街」——側邊欄裡跟「工作區」上下並排的第二個區塊。
     *
     * 視覺與互動**照抄原生工作區瀏覽器那一套**（`ui-workspace` 的 Rows / 區塊標題）：
     *
     *   [ 酒館街                                            ＋ ]   ← 區塊標題（36px）＋ 新增酒館
     *   [ 🏮 預設酒館                            ⋯ ＋ ]          ← 34px 列；滑過才換成箭頭與動作
     *   [    💬 老闆娘 · 初次見面        6分钟   ]              ← 32px 會話列
     *   [    展開其餘 3 個對話                  ]              ← 28px 溢出按鈕
     *
     * 互動契約（對照原生）：
     *   - **點列本體 = 展開／收合**（原生專案列就是這樣，不是進設定）
     *   - 滑鼠移過去才顯示：資料夾圖示換成折疊三角形、右邊的 ⋯ 與 ＋
     *   - **⋯ = 這一列的動作**（開啟設定／重新命名／移除）
     *   - **＋ = 新對話**
     */
    function TavernStreet(props) {
      var render = useForceRender()
      var ref = React.useRef(null)
      if (ref.current === null) {
        ref.current = {
          busy: false,
          error: '',
          manual: '',
          showManual: false,
          // 展開的酒館 id → { open, chats, loaded, error, showAll }
          expanded: {},
          // 開著動作選單的那一列（`tavern:<id>` / `chat:<角色>/<檔名>`）
          menu: null,
          // 「重新命名」的行內輸入
          renaming: null,
          renameText: '',
          showAllTaverns: false,
        }
      }
      var state = ref.current
      /** portal 的容器（`document.body` 底下的一個 div）；用到才建，之後重複用。 */
      var menuHost = React.useRef(null)
      /** 目前掛著的關閉監聽（`{ onDown, onKey }`）；沒開選單時是 null。 */
      var menuListeners = React.useRef(null)
      /** 開選單的那一顆按鈕（用來找「側邊欄當下的主題」）。 */
      var menuAnchor = React.useRef(null)

      /* ------------------------------------------------------------------ *
       * 對話列的 ⋯ 選單（原生那一套：portal 到 body、一次只有一個開著）
       *
       * 為什麼要 portal：這是側邊欄最底部的一塊，列自己只要有 overflow 就會把
       * 絕對定位的選單裁掉。原生的 `Menu` 也是 `createPortal(…, document.body)`。
       * 客戶端 bundle 的 `require` 只拿得到 `react`（沒有 react-dom、不能
       * `createPortal`），所以這裡自己建一個 body 底下的容器，位置用**固定座標**
       * 寫在容器上——比在 React 樹裡做絕對定位穩，也不受列的高度影響。
       * ------------------------------------------------------------------ */

      /**
       * 把「側邊欄當下的主題」搬進 portal 容器。
       *
       * 為什麼需要：選單 portal 到 `document.body`，而 DSH 的主題變數定義在
       * 側邊欄那棵子樹裡（`:root` 沒有）。不搬的話，選單會用到我們自己寫的
       * **fallback 顏色**——淺色主題下就是「深色字壓深色底」，標籤等於看不到
       * （實測踩過）。
       *
       * 做法：從這一列往上找第一個**有不透明底色**的祖先（＝側邊欄本體），
       * 把它的底色與文字色，以及標籤／邊框那幾個 alias 直接寫進容器。
       * 用 `getComputedStyle` 而不是寫死色碼，所以淺色深色都跟著走。
       */
      function inheritTheme(host, anchor) {
        // ⚠️ `anchor`（按下 ⋯ 的那顆按鈕）在繪製時**可能是 null**：React 的合成事件
        // 會在處理器跑完之後清掉 `currentTarget`，而我們是之後才畫選單的。
        // 所以另外找一個可靠的錨點——側邊欄那個座位自己的容器。
        var source =
          anchor !== null && anchor !== undefined
            ? anchor
            : document.querySelector('.dsh-tv-region, .dsh-tv-street, [data-dsh-responsive-part]')
        var background = ''
        while (source !== null && source !== undefined && source !== document.body) {
          var painted = getComputedStyle(source).backgroundColor
          if (painted !== '' && painted !== 'transparent' && painted.indexOf('rgba(0, 0, 0, 0)') !== 0) {
            background = painted
            break
          }
          source = source.parentElement
        }
        var from = source === null || source === undefined ? document.body : source
        var theme = getComputedStyle(from)
        // ⚠️ **不要用 `getPropertyValue()` 拿顏色**：它回的是變數的**文字**
        // （`var(--dsw-alias-label-primary,#e6e8eb)`），不是解析後的顏色；
        // 而且在側邊欄那一區，那些 `--dsh-tv-*` 根本沒有被宣告（側邊欄用宿主變數）。
        //
        // 所以改成**直接問 DOM 的實際顏色**：側邊欄列的文字色、邊框色、
        // 以及「滑過那一列」的底色——這些都是已經解析好的 `rgb(...)`。
        var color = theme.color
        if (color !== '') host.style.color = color
        var border = ''
        var probeBorder = document.querySelector('.dsh-tv-chatRow, .dsh-tv-row, .dsh-tv-menuItem')
        if (probeBorder !== null) {
          var bc = getComputedStyle(probeBorder)
          if (bc.borderTopColor !== '' && bc.borderTopColor !== 'rgba(0, 0, 0, 0)') border = bc.borderTopColor
          if (color === '') {
            color = bc.color
            if (color !== '') host.style.color = color
          }
        }
        // 滑過那一列的底色＝選單的「hover 底」（宿主主題自己決定，我們不猜）。
        var probeHover = document.querySelector('.dsh-tv-chatRow')
        // 真的找不到有不透明底色的祖先時（主題把 canvas 寫成 `calc()`，算不出值），
        // 用文字色的明暗判斷現在是深色還是淺色主題，再挑一個安全的底色。
        // ⚠️ 這裡是**保底**，不是首選：優先仍然是用祖先真正的底色。
        if (background === '' || background === 'rgba(0, 0, 0, 0)') {
          var rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
          var dark = rgb !== null && (Number(rgb[1]) + Number(rgb[2]) + Number(rgb[3])) / 3 < 128
          background = dark ? 'var(--dsh-tv-surface-2)' : 'var(--dsh-tv-surface-1)'
        }
        return {
          background: background,
          color: color,
          border: border === '' ? color || 'currentColor' : border,
          // hover 底：由側邊欄的 CSS 決定（宿主主題），選單沿用同一個值。
          hover: probeHover === null ? '' : getComputedStyle(probeHover).backgroundColor,
        }
      }

      /**
       * portal 容器：**用到才建**（不是在 effect 裡）。
       *
       * 為什麼不用 `useEffect` 建：這樣它就不依賴「effect 一定會跑」——
       * 離線測試的假 React 沒有真的 effect，而真的瀏覽器裡也只是「第一次開選單
       * 才多一個 div」。少一個生命週期就少一個壞掉的方式。
       */
      function ensureMenuHost(anchor) {
        if (menuHost.current !== null) {
          menuAnchor.current = anchor === undefined ? menuAnchor.current : anchor
          return menuHost.current
        }
        var host = document.createElement('div')
        host.setAttribute('data-dsh-tavern', 'chat-menu')
        document.body.appendChild(host)
        menuHost.current = host
        menuAnchor.current = null
        return host
      }

      /** 關掉選單：清掉 portal 內容，並解掉這一次註冊的關閉監聽。 */
      function detachMenuListeners() {
        if (menuListeners.current === null) return
        document.removeEventListener('mousedown', menuListeners.current.onDown, true)
        document.removeEventListener('keydown', menuListeners.current.onKey, true)
        menuListeners.current = null
      }

      /** 監聽「點外面」與 Esc：選單開著的時候才掛。 */
      function attachMenuListeners() {
        if (menuListeners.current !== null) return
        var onDown = function (event) {
          var host = menuHost.current
          if (host !== null && event.target !== null && host.contains(event.target)) return
          closeChatMenu()
        }
        var onKey = function (event) {
          if (event.key === 'Escape') closeChatMenu()
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        menuListeners.current = { onDown: onDown, onKey: onKey }
      }

      function closeChatMenu() {
        detachMenuListeners()
        var host = menuHost.current
        if (host !== null) host.textContent = ''
        state.menu = null
        render()
      }

      function chatKeyOf(chat) {
        return String(chat.character) + '/' + String(chat.name)
      }

      /** 點 ⋯：把選單開在那一顆按鈕的左下角（空間不夠就往上）。 */
      function openChatMenu(chat, event) {
        var key = chatKeyOf(chat)
        if (state.menu !== null && state.menu.key === key) {
          closeChatMenu()
          return
        }
        var rect = null
        var node = event !== undefined && event !== null ? event.currentTarget : null
        if (node !== null && node !== undefined && typeof node.getBoundingClientRect === 'function') {
          rect = node.getBoundingClientRect()
        }
        var width = 136
        var height = 108
        var x = rect === null ? 12 : rect.right - width
        var y = rect === null ? 12 : rect.bottom + 4
        if (x < 8) x = 8
        if (y + height > (window.innerHeight || 800) - 8) {
          y = rect === null ? 12 : Math.max(8, rect.top - height - 4)
        }
        state.menu = { key: key, x: x, y: y, error: '', busy: false }
        state.renaming = null
        ensureMenuHost(node)
        attachMenuListeners()
        render()
      }

      /** 「改名」：行內輸入（原生也是把標題換成 input，不是彈窗）。 */
      function startRename(chat) {
        var host = menuHost.current
        if (host !== null) host.textContent = ''
        state.menu = null
        state.renaming = { key: chatKeyOf(chat), draft: String(chat.name), error: '', busy: false }
        render()
      }

      function cancelRename() {
        state.renaming = null
        render()
      }

      function commitRename(tavern, chat) {
        var renaming = state.renaming
        if (renaming === null || renaming.busy) return
        var next = renaming.draft.trim()
        if (next === '' || next === chat.name) {
          cancelRename()
          return
        }
        renaming.busy = true
        renaming.error = ''
        render()
        rpc('chat.rename', {
          id: tavern.id,
          character: chat.character,
          chat: chat.name,
          name: next,
        })
          .then(function (renamed) {
            state.renaming = null
            // 正在看那一份就換成新的座標，不然對話頁會指著一個已經不存在的檔名。
            if (currentChat !== null && chatKeyOf(currentChat) === chatKeyOf(chat)) {
              currentChat = renamed
            }
            render()
            return loadChats(tavern.id)
          })
          .catch(function (error) {
            renaming.busy = false
            renaming.error = String((error && error.message) || error)
            render()
          })
      }

      /** 「刪除」：跟設定頁那顆一樣，走已經驗過的 `chat.delete`。 */
      function deleteChat(tavern, chat) {
        var menu = state.menu
        if (menu === null || menu.busy) return
        menu.busy = true
        menu.error = ''
        render()
        rpc('chat.delete', { id: tavern.id, character: chat.character, chat: chat.name })
          .then(function () {
            if (currentChat !== null && chatKeyOf(currentChat) === chatKeyOf(chat)) currentChat = null
            closeChatMenu()
            return loadChats(tavern.id)
          })
          .catch(function (error) {
            menu.busy = false
            menu.error = String((error && error.message) || error)
            render()
          })
      }

      /**
       * 「分支」：把這份對話複製成一份新的（新的 session ＋ 新的 `.jsonl`）。
       *
       * 為什麼這條路走得通：**分支是 DSH 自己的功能**（原生會話列的 ⋯ 就是
       * 「改名／分支／封存」）。客戶端遠端介面有 `remote.session.fork`
       * （`{ sessionId, atSeq? }` → 新的 sessionId），我們只是把它接上酒館的檔案：
       *
       *   1. `remote.session.fork({ sessionId })` → 新的 sessionId
       *   2. `chat.create` 開一份新檔 → `chat.append` 把目前看到的訊息寫進去
       *      （`.jsonl` 是使用者帶得走的那一份，分支要連內容一起分出去）
       *   3. `session.bind` 把新 session 綁到新檔
       *
       * ⚠️ **兩個真實的限制**，都在選單上直說、不假裝：
       *   - 沒有綁定 → 這份對話還沒跟任何 session 連上，沒有東西可以分支。
       *     （DSH 那邊要「已經完成過至少一輪」才分得出來。）
       *   - 這台 DSH 的 remote 沒有 `fork` → 按鈕變灰並說明原因。
       */
      function forkChat(tavern, chat) {
        var menu = state.menu
        if (menu === null || menu.busy) return
        var service = sessionsService()
        if (service === null || typeof service.fork !== 'function') {
          menu.error = '這台 DSH 沒有提供對話分支'
          render()
          return
        }
        menu.busy = true
        menu.error = ''
        render()

        rpc('session.list')
          .then(function (bindings) {
            var bound = null
            for (var i = 0; i < bindings.length; i += 1) {
              if (bindings[i].character === chat.character && bindings[i].chat === chat.name) {
                bound = bindings[i]
              }
            }
            if (bound === null) {
              throw new Error('這份對話還沒跟 DSH 的 session 連上——先開啟它並說一句話，再分支')
            }
            return Promise.resolve(service.fork({ sessionId: bound.sessionId })).then(function (result) {
              var forked = unwrapRemote(result, '分支')
              return forked !== null && typeof forked === 'object' ? forked.sessionId : forked
            })
          })
          .then(function (sessionId) {
            if (typeof sessionId !== 'string' || sessionId === '') {
              throw new Error('分支沒有回傳新的 session id')
            }
            // 先讀目前的訊息（分支要把內容一起分出去），再開新檔、寫進去、綁定。
            return rpc('chat.messages', { character: chat.character, chat: chat.name })
              .catch(function () {
                return []
              })
              .then(function (messages) {
                var list = Array.isArray(messages) ? messages : []
                // 檔名交給宿主半（撞名會自動換編號，回傳的 `created.name` 才是真的名字）。
                return rpc('chat.create', { id: tavern.id, character: chat.character, name: chat.name })
                  .then(function (created) {
                    var write =
                      list.length === 0
                        ? Promise.resolve()
                        : rpc('chat.append', {
                            id: tavern.id,
                            character: created.character,
                            chat: created.name,
                            messages: list.map(function (message) {
                              return {
                                name: message.name,
                                isUser: message.isUser === true,
                                text: message.text,
                              }
                            }),
                          })
                    return write
                      .then(function () {
                        return rpc('session.bind', {
                          id: tavern.id,
                          sessionId: sessionId,
                          character: created.character,
                          chat: created.name,
                        })
                      })
                      .then(function () {
                        return created
                      })
                  })
              })
          })
          .then(function (created) {
            closeChatMenu()
            return loadChats(tavern.id).then(function () {
              // 分支完直接跳過去——使用者的意圖就是「從這裡分一份出來繼續」。
              currentChat = created
              selectPanel(TAVERN_CHAT_KEY)
            })
          })
          .catch(function (error) {
            // 選單可能已經被關掉了（例如使用者按了 Esc）：那就不要再畫錯誤。
            if (state.menu !== null && state.menu.key === chatKeyOf(chat)) {
              state.menu.busy = false
              state.menu.error = String((error && error.message) || error)
              render()
            }
          })
      }

      /* ---- ⋯ 選單的 DOM 繪製 ------------------------------------------
       * 選單住在 portal 容器裡（不是 React 樹的一部分），所以這裡用原生 DOM 畫。
       * 客戶端 bundle 的 `require` 只有 `react`，沒有 react-dom，也就沒有
       * `createPortal`；與其塞第二個 React root，不如照著樣式直接建節點
       * ——數量固定、沒有狀態，也就沒有 reconciliation 的問題。
       * ---------------------------------------------------------------- */

      function svgNode(tag, attrs) {
        var node = document.createElementNS('http://www.w3.org/2000/svg', tag)
        for (var key in attrs) {
          if (Object.prototype.hasOwnProperty.call(attrs, key)) node.setAttribute(key, String(attrs[key]))
        }
        return node
      }

      /** 選單上的三顆圖示（跟 React 版同一組線條，見 `IconEdit`／`IconBranch`／`IconTrash`）。 */
      function menuIcon(kind) {
        var svg = svgNode('svg', {
          width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
          'stroke-width': 1.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
        })
        if (kind === 'fork') {
          var dots = [[4.2, 3.8], [4.2, 12.2], [11.8, 5.9]]
          for (var d = 0; d < dots.length; d += 1) {
            svg.appendChild(svgNode('circle', { cx: dots[d][0], cy: dots[d][1], r: 1.7 }))
          }
        }
        var paths =
          kind === 'rename'
            ? ['M11.1 2.6 13.4 4.9 5.9 12.4 3.2 12.8 3.6 10.1Z', 'M9.8 3.9 12.1 6.2']
            : kind === 'fork'
              ? ['M4.2 5.5v5', 'M9.4 6.6c-1.6.8-3.4.9-5.2.7']
              : ['M2.8 4.4h10.4', 'M6.6 4.4V2.9h2.8v1.5', 'M4.2 4.4v8.1c0 .5.4.9.9.9h5.8c.5 0 .9-.4.9-.9V4.4', 'M6.7 7.1v3.6M9.3 7.1v3.6']
        for (var i = 0; i < paths.length; i += 1) {
          svg.appendChild(svgNode('path', { d: paths[i] }))
        }
        return svg
      }

      function menuButton(label, kind, options) {
        var button = document.createElement('button')
        button.type = 'button'
        button.className = 'dsh-tv-menuItem' + (kind === 'delete' ? ' dsh-tv-menuItemDanger' : '')
        if (options.title !== undefined) button.title = options.title
        if (options.disabled === true) button.disabled = true
        if (options.onClick !== undefined) button.addEventListener('click', options.onClick)
        var icon = document.createElement('span')
        icon.className = 'dsh-tv-menuIcon'
        icon.appendChild(menuIcon(kind))
        button.appendChild(icon)
        button.appendChild(document.createTextNode(label))
        return button
      }

      /** 把選單畫進 portal 容器（不是畫進側邊欄那一列）。 */
      function paintChatMenu(tavern, chat) {
        var host = ensureMenuHost(menuAnchor.current)
        var skin = inheritTheme(host, menuAnchor.current)
        var menu = state.menu
        if (menu === null || menu.key !== chatKeyOf(chat)) {
          if (host.childNodes.length > 0) host.textContent = ''
          return
        }
        host.style.position = 'fixed'
        host.style.left = String(menu.x) + 'px'
        host.style.top = String(menu.y) + 'px'

        var busy = menu.busy === true
        var service = sessionsService()
        var canFork = service !== null && typeof service.fork === 'function'
        var box = document.createElement('div')
        box.className = 'dsh-tv-menu'
        // 主題直接寫在**選單框**上（不是只寫在容器上）：容器的底色不一定會透上來，
        // 而「深字壓深底」正是這一輪踩到的 bug。
        box.style.background = skin.background
        box.style.color = skin.color
        box.style.border = '1px solid ' + skin.border
        box.style.borderRadius = 'var(--dsh-tv-radius-lg)'
        box.appendChild(
          menuButton('改名', 'rename', {
            disabled: busy,
            onClick: function () {
              startRename(chat)
            },
          }),
        )
        box.appendChild(
          menuButton(canFork ? '分支' : '分支（不支援）', 'fork', {
            disabled: busy || canFork === false,
            title: canFork
              ? '把這份對話複製成一份新的（新的 session ＋ 新的 .jsonl）'
              : '這台 DSH 沒有提供對話分支（remote.session.fork）',
            onClick: function () {
              forkChat(tavern, chat)
            },
          }),
        )
        box.appendChild(
          menuButton('刪除', 'delete', {
            disabled: busy,
            title: '刪掉 chats/' + chatKeyOf(chat) + '.jsonl',
            onClick: function () {
              deleteChat(tavern, chat)
            },
          }),
        )
        if (menu.error !== '') {
          var err = document.createElement('div')
          err.className = 'dsh-tv-menuErr'
          err.textContent = menu.error
          box.appendChild(err)
        }
        host.textContent = ''
        host.appendChild(box)
      }

      var taverns = props.taverns || []
      var active = null
      for (var i = 0; i < taverns.length; i += 1) {
        if (taverns[i].active) active = taverns[i]
      }

      function fail(error) {
        state.busy = false
        state.error = String(error && error.message ? error.message : error)
        render()
      }

      /** 新增酒館：選一個資料夾，直接收養並切換。 */
      function pickFolder() {
        state.menu = null
        state.error = ''
        state.busy = true
        render()
        var uiWorkspace = null
        try {
          uiWorkspace = ctxRef && ctxRef.get ? ctxRef.get('uiWorkspace') : null
        } catch (error) {
          uiWorkspace = null
        }
        var viaClient =
          uiWorkspace !== null && typeof uiWorkspace.pickDirectory === 'function'
            ? uiWorkspace.pickDirectory()
            : Promise.resolve(null)
        return viaClient
          .then(function (path) {
            if (typeof path === 'string' && path !== '') return adopt(path)
            return rpc('tavern.pick').then(function (result) {
              if (result.path !== null) return adopt(result.path)
              state.busy = false
              state.showManual = true
              state.error = result.reason || '沒有可用的資料夾選擇器，請貼上路徑'
              render()
            })
          })
          .catch(fail)
      }

      function adopt(path) {
        state.busy = true
        state.error = ''
        render()
        return rpc('tavern.add', { path: path })
          .then(function (listed) {
            state.busy = false
            state.showManual = false
            state.manual = ''
            render()
            // 剛加完的那一間要看得見：清單本來是收合的，這裡順便打開。
            if (typeof props.onToggle === 'function') props.onToggle(true)
            props.reload()
            if (listed !== null && listed !== undefined && typeof listed.activeId === 'string') {
              loadChats(listed.activeId)
            }
          })
          .catch(fail)
      }

      /**
       * 切換目前酒館（點另一間酒館的列時）。
       *
       * 接受 id 或整個酒館物件：`openSettings()` 先前的寫法是
       * `select(tavernById(id))`——把物件當 id 傳進去，於是 RPC 收到一個物件，
       * 宿主半回「沒有這間酒館：[object Object]」。這裡兩種都吃，
       * 讓呼叫端不必記得自己手上是 id 還是記錄（同一個坑不要留兩次）。
       */
      function select(target) {
        var id = typeof target === 'string' ? target : target !== null && target !== undefined ? target.id : ''
        if (typeof id !== 'string' || id === '') {
          state.error = '選不到這間酒館（沒有 id）'
          render()
          return Promise.resolve()
        }
        state.busy = true
        state.error = ''
        render()
        return rpc('tavern.select', { id: id })
          .then(function () {
            state.busy = false
            render()
            // 告訴設定頁／對話頁「目前酒館換了」——它們是常駐座位，不會自己重讀。
            bumpActiveVersion()
            props.reload()
          })
          .catch(fail)
      }

      /** 載入某一間酒館的對話清單。 */
      function loadChats(id) {
        var bucket = state.expanded[id]
        if (bucket === undefined) {
          bucket = { open: true, chats: [], loaded: false, error: '', showAll: false }
          state.expanded[id] = bucket
        }
        bucket.open = true
        bucket.error = ''
        render()
        return rpc('chat.list', { id: id }, 8000)
          .then(function (chats) {
            bucket.chats = chats
            bucket.loaded = true
            render()
          })
          .catch(function (error) {
            bucket.loaded = true
            bucket.error = String(error && error.message ? error.message : error)
            render()
          })
      }

      /** 點列本體：展開／收合（原生專案列的行為）。 */
      function toggle(tavern) {
        var bucket = state.expanded[tavern.id]
        if (bucket === undefined) {
          loadChats(tavern.id)
          return
        }
        bucket.open = !bucket.open
        render()
        if (bucket.open && bucket.loaded !== true) loadChats(tavern.id)
      }

      /**
       * ⋯ → **直接**進這間酒館的設定頁（不彈選單）。
       *
       * 酒館街在側邊欄最底部，彈出式選單會撞到視窗下緣／被裁掉——使用者回報
       * 「他在最底層摺疊起來你再彈彈窗就看不見東西了」。所以⋯ 就是設定本身，
       * 改名／移除那些動作都收進設定頁的「🏠 這間酒館」分區。
       */
      function openSettings(id) {
        var go = function () {
          selectPanel(TAVERN_SETTINGS_KEY)
        }
        if (active !== null && active.id === id) {
          go()
          return Promise.resolve()
        }
        return select(id).then(go)
      }

      /** ＋ → 新對話：先切到這間酒館，再挑角色開一份新的。 */
      function newChat(tavern) {
        state.error = ''
        state.pickCharacterFor = null
        var start = active !== null && active.id === tavern.id ? Promise.resolve() : select(tavern.id)
        return start.then(function () {
          return rpc('character.list')
        }).then(function (characters) {
          if (characters.length === 0) {
            state.error = '這間酒館還沒有角色卡——先在設定頁建一張，才能開始對話'
            render()
            return null
          }
          // 只有一張卡就直接開；多張卡在這一列的下面**就地**列出來挑
          // （不彈窗，理由同上：底部彈窗看不見）。
          if (characters.length === 1) {
            return createChat(tavern, characters[0].id)
          }
          state.pickCharacterFor = tavern.id
          state.characters = characters
          var bucket = state.expanded[tavern.id]
          if (bucket === undefined) {
            state.expanded[tavern.id] = { open: true, chats: [], loaded: false, error: '', showAll: false }
          } else {
            bucket.open = true
          }
          render()
          return null
        }).catch(fail)
      }

      function createChat(tavern, characterId) {
        state.busy = true
        state.pickCharacterFor = null
        render()
        return rpc('chat.create', { id: tavern.id, character: characterId })
          .then(function (created) {
            state.busy = false
            var bucket = state.expanded[tavern.id]
            if (bucket === undefined) {
              bucket = { open: true, chats: [], loaded: false, error: '', showAll: false }
              state.expanded[tavern.id] = bucket
            }
            bucket.open = true
            render()
            return loadChats(tavern.id).then(function () {
              currentChat = created
              selectPanel(TAVERN_CHAT_KEY)
            })
          })
          .catch(fail)
      }

      var rail = props.wide === false
      // 「有對話開始／結束跑」時要重畫（那顆矩陣指示器是這一頁畫的）。
      useRefreshChannelRerender(render)

      // **展開才會讀磁碟**：沒展開時連 `tavern.list` 都不打，區塊只是標題列。
      // 這是刻意的——啟動時不做任何事，使用者按了才知道哪個按鈕壞了。
      var opened = props.opened === true
      var visible = opened ? (state.showAllTaverns ? taverns : taverns.slice(0, TAVERN_PREVIEW)) : []
      var hiddenCount = taverns.length - visible.length

      /* ---- 區塊標題：照原生（36px、tertiary、右邊一顆 28px 圓形 icon 按鈕） ---- */
      /**
       * 區塊標題列。
       *
       * ⚠️ **整列可點**（使用者：「這好像是一個按鍵點擊摺疊，但下面的一層卻是整行都能夠
       * 點擊摺疊。這裏風格不一致我希望遵從下面一層的做法」）——酒館列是點列本體就
       * 展開／收合，所以標題列也照同一個規矩：**點那一列的任何地方都收合／展開**，
       * 只有右邊那顆「＋ 新增酒館」要 `stopPropagation`（不然按新增會順手把區塊收起來）。
       *
       * 按鈕留著（鍵盤與報讀器需要它），但不再是非按它不可。
       */
      var head = React.createElement(
        'div',
        {
          className: 'dsh-tv-sectionHead',
          onClick: function () {
            if (typeof props.onToggle === 'function') props.onToggle(!opened)
          },
        },
        // 區塊自己的圖示是啤酒杯（使用者指定），右邊才是「新增酒館」。
        React.createElement('span', { className: 'dsh-tv-sectionIcon' }, React.createElement(IconBeer)),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-tv-sectionToggle',
            'aria-expanded': opened ? 'true' : 'false',
            'aria-label': opened ? '收合酒館街' : '顯示酒館街',
            title: opened ? '收合酒館街' : '顯示酒館街（按了才讀取）',
            // 這一顆按鈕**切換 ＋ 擋冒泡**：切換是它自己的職責（鍵盤與報讀器靠它），
            // 擋冒泡是為了不要讓整列的 onClick 再切一次。
            onClick: function (event) {
              if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') {
                event.stopPropagation()
              }
              if (typeof props.onToggle === 'function') props.onToggle(!opened)
            },
          },
          rail ? '' : '酒館街',
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-tv-iconBtn',
            'aria-label': '新增酒館',
            title: '新增酒館（選一個資料夾）',
            disabled: state.busy,
            onClick: function (event) {
              // 這一顆是**例外**：它不該讓整列跟著收合。
              if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') {
                event.stopPropagation()
              }
              pickFolder()
            },
          },
          state.busy ? React.createElement('span', { className: 'dsh-tv-spin' }, '⋯') : React.createElement(IconPlus),
        ),
      )

      var groups = []
      for (var t = 0; t < visible.length; t += 1) {
        groups.push(renderTavern(visible[t]))
      }

      var children = opened ? [head].concat(groups) : [head]

      if (opened && props.loaded !== true) {
        children.push(
          React.createElement('div', { key: '__loading', className: 'dsh-tv-emptyRow' }, '讀取中…'),
        )
      }
      if (opened && props.error) {
        children.push(
          React.createElement('div', { key: '__err', className: 'dsh-tv-sideErr' }, String(props.error)),
        )
      }

      if (hiddenCount > 0) {
        children.push(
          React.createElement(
            'button',
            {
              key: '__more',
              type: 'button',
              className: 'dsh-tv-overflow',
              onClick: function () {
                state.showAllTaverns = true
                render()
              },
            },
            '展開其餘 ' + hiddenCount + ' 間酒館',
          ),
        )
      }

      if (taverns.length === 0 && props.loaded === true) {
        children.push(
          React.createElement(
            'div',
            { key: '__empty', className: 'dsh-tv-emptyRow' },
            '還沒有酒館——按上面的 ＋ 選一個資料夾，角色卡與對話都會放在裡面。',
          ),
        )
      }

      if (state.error !== '') {
        children.push(React.createElement('div', { key: '__err', className: 'dsh-tv-sideErr' }, state.error))
      }

      if (state.showManual) {
        children.push(
          React.createElement(
            'div',
            { key: '__manual', className: 'dsh-tv-sideManual' },
            React.createElement('input', {
              className: 'dsh-tv-sideInput',
              value: state.manual,
              placeholder: 'D:\\酒館\\鯨落',
              onChange: function (event) {
                state.manual = event.target.value
                render()
              },
              onKeyDown: function (event) {
                if (event.key !== 'Enter') return
                var path = state.manual.trim()
                if (path !== '') adopt(path)
              },
            }),
          ),
        )
      }

      return React.createElement(
        'div',
        { className: rail ? 'dsh-tv-street dsh-tv-streetRail' : 'dsh-tv-street', style: props.style },
        React.createElement('div', { className: 'dsh-tv-streetInner', title: 'dsh-tavern ' + CLIENT_BUILD }, children),
      )

      /* ---------------------------- 內部：一間酒館 ---------------------------- */

      function renderTavern(tavern) {
        var bucket = state.expanded[tavern.id]
        var open = bucket !== undefined && bucket.open === true
        var isActive = tavern.active === true

        var row = React.createElement(
          'div',
          {
            key: 'row',
            role: 'treeitem',
            'aria-expanded': open ? 'true' : 'false',
            className: 'dsh-tv-row' + (isActive ? ' dsh-tv-rowOn' : ''),
            onClick: function () {
              toggle(tavern)
            },
          },
          // 圖示：平常是燈籠，滑過換成折疊三角形（跟原生資料夾一模一樣的交換）。
          React.createElement(
            'span',
            { className: 'dsh-tv-slot' + (isActive ? ' dsh-tv-slotOn' : '') },
            // 每一間酒館可以有自己的圖示（設定頁選）；沒設定就用彩色燈籠。
            React.createElement(
              'span',
              { className: 'dsh-tv-folder' },
              tavernIcon(tavern),
            ),
            React.createElement(
              'span',
              { className: 'dsh-tv-chevron' },
              React.createElement('span', { className: open ? 'dsh-tv-arrowOpen' : '' }, React.createElement(IconChevron)),
            ),
          ),
          React.createElement(
            'span',
            { className: 'dsh-tv-projectText' },
            React.createElement('span', { className: 'dsh-tv-title', title: tavern.path }, tavern.name),
            // 舊版殘留：資料夾還在，但沒有 tavern.json，代表它不是這一版建立的。
            // 這種紀錄如果靜靜地留在清單裡，使用者會以為「按了新增就跑出兩間酒館」。
            tavern.exists === true && tavern.scaffolded === false
              ? React.createElement(
                  'span',
                  {
                    className: 'dsh-tv-legacy',
                    title: '這個資料夾沒有 tavern.json——不是這一版建立的（舊版留下來的紀錄）。按 ⋯ 進去可以把它從清單移除。',
                  },
                  '舊版殘留',
                )
              : null,
          ),
          React.createElement(
            'span',
            { className: 'dsh-tv-actions' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-tv-miniBtn',
                'aria-label': '「' + tavern.name + '」的設定',
                title: '這間酒館的設定',
                onClick: function (event) {
                  event.stopPropagation()
                  openSettings(tavern.id)
                },
              },
              React.createElement(IconDots),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-tv-miniBtn',
                'aria-label': '在「' + tavern.name + '」中新增對話',
                title: '新對話',
                onClick: function (event) {
                  event.stopPropagation()
                  newChat(tavern)
                },
              },
              React.createElement(IconPlus),
            ),
          ),
        )

        var kids = []
        if (open) {
          if (bucket === undefined || bucket.loaded !== true) {
            kids.push(React.createElement('div', { key: 'loading', className: 'dsh-tv-emptyRow' }, '讀取中…'))
          } else if (bucket.error !== '') {
            kids.push(
              React.createElement(
                'div',
                { key: 'err', className: 'dsh-tv-emptyRow' },
                bucket.error + '（宿主半改過就要重啟 dsh web）',
              ),
            )
          } else if (bucket.chats.length === 0) {
            kids.push(
              React.createElement(
                'div',
                { key: 'empty', className: 'dsh-tv-emptyRow' },
                '還沒有對話——滑到這間酒館上面按 ＋ 開一份。',
              ),
            )
          } else {
            var shown = bucket.showAll ? bucket.chats : bucket.chats.slice(0, CHAT_PREVIEW)
            for (var c = 0; c < shown.length; c += 1) {
              kids.push(renderChat(tavern, shown[c]))
            }
            var rest = bucket.chats.length - shown.length
            if (rest > 0) {
              kids.push(
                React.createElement(
                  'button',
                  {
                    key: 'more',
                    type: 'button',
                    className: 'dsh-tv-overflow',
                    onClick: function (id) {
                      return function () {
                        state.expanded[id].showAll = true
                        render()
                      }
                    }(tavern.id),
                  },
                  '展開其餘 ' + rest + ' 個對話',
                ),
              )
            }
          }
        }

        // 「＋ 新對話」要挑角色時，就地列在這一列下面（不彈窗：酒館街在側邊欄最底部，
        // 彈出式選單會被裁掉）。
        if (state.pickCharacterFor === tavern.id) {
          kids.unshift(renderCharacterPicker(tavern))
        }

        return React.createElement('div', { key: tavern.id, className: 'dsh-tv-group' }, [row].concat(kids))
      }

      /**
       * 「＋ 新對話」時挑角色：**就地**列在酒館列下面，不用彈出式選單
       * （酒館街在側邊欄最底部，彈窗會被裁掉）。
       */
      function renderCharacterPicker(tavern) {
        var characters = state.characters || []
        return React.createElement(
          'div',
          { key: 'picker', className: 'dsh-tv-nodeKids' },
          React.createElement('div', { className: 'dsh-tv-emptyRow' }, '跟誰開始新對話？'),
          characters.map(function (character) {
            var name =
              character.card !== null && character.card !== undefined && character.card.name
                ? character.card.name
                : character.id
            return React.createElement(
              'div',
              {
                key: character.id,
                role: 'treeitem',
                className: 'dsh-tv-chatRow',
                title: '開一份新的對話',
                onClick: function () {
                  createChat(tavern, character.id)
                },
              },
              React.createElement('span', { className: 'dsh-tv-slot' }, React.createElement(IconCharacter)),
              React.createElement('span', { className: 'dsh-tv-title' }, name),
            )
          }),
        )
      }

      /**
       * 一份對話的列（原生 `.sessionRow` 的形狀：slot → title → time → actions）。
       *
       * **行為也照原生**：
       *   - 滑過時時間讓位給 ⋯（CSS 做，`.dsh-tv-chatRow:hover .dsh-tv-time{display:none}`）
       *   - ⋯ 開一個 portal 到 `document.body` 的選單，裡面是改名／分支／刪除
       *   - 改名是**行內**把標題換成輸入框（原生的 `.renameInput` 也是這樣），
       *     Enter 送出、Esc 取消、失焦取消
       */
      function renderChat(tavern, chat) {
        var key = chatKeyOf(chat)
        var isCurrent =
          currentChat !== null && currentChat.file === chat.file && currentChat.character === chat.character
        var renaming = state.renaming !== null && state.renaming.key === key ? state.renaming : null
        var menuOpen = state.menu !== null && state.menu.key === key
        var slots = [
          React.createElement(
            'span',
            { key: 'slot', className: 'dsh-tv-slot' },
            (function () {
              // **這一列在跑的時候換成矩陣跑馬燈**（跟 DSH 原生會話列的「進行中」
              // 同一個指示器）——使用者：「check Room 外面的列表…運作中的時候
              // 會換一個思考中的圖表的動圖」。跑完就換回原本的圖示。
              if (chatIsRunning(chat.character, chat.name) === true) {
                return React.createElement(RunningDot)
              }
              // 有插圖就用主圖當這一列的圖示；沒有就維持原本的對話圖示。
              var primary = chat.assets !== undefined && chat.assets !== null ? chat.assets.primary : null
              var url = primary === null || primary === undefined ? null : findAssetUrl(chat.assets, primary)
              return url === null
                ? React.createElement(IconChat)
                : React.createElement('img', { className: 'dsh-tv-face', src: url, alt: '', loading: 'lazy' })
            })(),
          ),
        ]

        if (renaming !== null) {
          slots.push(
            React.createElement('input', {
              key: 'rename',
              className: 'dsh-tv-rename',
              value: renaming.draft,
              spellCheck: false,
              'aria-label': '新的對話名稱',
              // 自己聚焦，不用 `autoFocus`：這一列每次重繪都是一個**新的**元素
              // （我們的 render 是整個重畫，不是 React 的 reconciliation），
              // 而 `autoFocus` 只在掛載時有意義——重畫之後游標就掉出去了。
              ref: function (node) {
                if (node === null || renaming.focused === true) return
                renaming.focused = true
                if (typeof node.focus === 'function') node.focus()
                if (typeof node.select === 'function') node.select()
              },
              onChange: function (event) {
                renaming.draft = event.target.value
                render()
              },
              onKeyDown: function (event) {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitRename(tavern, chat)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelRename()
                }
              },
              onBlur: function () {
                // 失焦＝放棄（原生的行內改名也是這樣，不會偷偷送出）。
                if (state.renaming !== null && state.renaming.busy !== true) cancelRename()
              },
              onClick: function (event) {
                event.stopPropagation()
              },
            }),
          )
        } else {
          slots.push(React.createElement('span', { key: 'title', className: 'dsh-tv-title' }, chatLabel(chat)))
        }

        if (renaming === null) {
          slots.push(React.createElement('span', { key: 'time', className: 'dsh-tv-time' }, relativeTime(chat.mtimeMs)))
        }
        slots.push(
          React.createElement(
            'span',
            { key: 'actions', className: 'dsh-tv-actions' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-tv-miniBtn',
                'aria-label': '「' + chatLabel(chat) + '」的動作',
                'aria-haspopup': 'menu',
                'aria-expanded': menuOpen ? 'true' : 'false',
                title: '改名／分支／刪除',
                onClick: function (event) {
                  event.stopPropagation()
                  openChatMenu(chat, event)
                },
              },
              React.createElement(IconDots),
            ),
          ),
        )

        // 選單不在 React 樹裡（portal 到 body），所以在這裡把它畫上去／收掉。
        // 一次只會有一列符合 `state.menu.key`，所以不會重複繪製。
        if (menuOpen) paintChatMenu(tavern, chat)

        return React.createElement(
          'div',
          {
            key: key,
            role: 'treeitem',
            'aria-selected': isCurrent ? 'true' : 'false',
            className:
              'dsh-tv-chatRow' + (isCurrent ? ' dsh-tv-chatOn' : '') + (menuOpen ? ' dsh-tv-chatMenuOpen' : ''),
            title: 'chats/' + chat.character + '/' + chat.file,
            onClick: function () {
              if (renaming !== null) return
              currentChat = chat
              selectPanel(TAVERN_CHAT_KEY)
            },
          },
          slots,
        )
      }
    }
    function TavernSidebarRegion(props) {
      var render = useForceRender()
      var ref = React.useRef(null)
      if (ref.current === null) {
        ref.current = {
          taverns: [],
          loaded: false,
          error: '',
          // **預設是收合的**：沒展開就不讀任何東西。
          // 這個區塊一直掛在側邊欄上，如果它一掛載就打 RPC，就等於「DSH 一開啟
          // 這個插件就在做事」——使用者要的是：啟動時什麼都不做，按了才做，
          // 這樣壞掉時一眼知道是哪個按鈕壞了。
          opened: false,
          // 酒館街的高度（px）。null＝用預設比例；拖過分隔線之後就固定住，
          // 這樣展開／收合酒館時工作區清單不會跟著彈來彈去。
          streetPx: readStreetPx(),
          dragging: false,
        }
      }
      var state = ref.current
      /** 讀酒館清單（**只在使用者動作時呼叫**）。 */
      function load() {
        state.loaded = false
        state.error = ''
        render()
        return rpc('tavern.list')
          .then(function (listed) {
            state.taverns = listed.taverns
            state.loaded = true
            render()
          })
          .catch(function (error) {
            state.loaded = true
            state.error = String(error && error.message ? error.message : error)
            render()
          })
      }

      /** 使用者按了標題列：展開時才第一次讀取，收合不做任何事。 */
      function toggleOpened(next) {
        state.opened = next === true
        render()
        if (state.opened && state.loaded !== true) return load()
        return undefined
      }

      /** 新增／移除酒館之後重新讀取（清單已經在畫面上，所以直接更新）。 */
      function reload() {
        return load()
      }

      /**
       * 拖分隔線調整酒館街高度。
       *
       * 為什麼要能手動調：預設是比例（56%），展開一間酒館時內容變高，工作區清單
       * 就被推上去；使用者說「摺疊伸長時候會彈嚟彈去」。拖過一次之後高度就固定成
       * px（並記在 localStorage），之後展開／收合只會讓酒館街自己滾動。
       */
      function startDrag(event) {
        event.preventDefault()
        var region = document.querySelector('.dsh-tv-region')
        if (region === null) return
        var bottom = region.getBoundingClientRect().bottom
        state.dragging = true
        render()

        var move = function (moveEvent) {
          var next = bottom - moveEvent.clientY
          var max = Math.max(120, region.getBoundingClientRect().height - 120)
          state.streetPx = Math.max(96, Math.min(max, Math.round(next)))
          render()
        }
        var up = function () {
          state.dragging = false
          writeStreetPx(state.streetPx)
          document.removeEventListener('mousemove', move)
          document.removeEventListener('mouseup', up)
          render()
        }
        document.addEventListener('mousemove', move)
        document.addEventListener('mouseup', up)
      }

      /**
       * 指標在分隔線上移動：把那道光的中心搬到游標的位置。
       *
       * 這就是原生 `widthHandle` 的 `onPointerMove` 做的唯一一件事：
       * ```js
       * const box = e.currentTarget.getBoundingClientRect()
       * e.currentTarget.style.setProperty('--dsh-width-handle-pointer-y', `${e.clientY - box.top}px`)
       * ```
       * 它只改一個 CSS 變數，所以沒有 React 重繪的開銷——滑過去就是順的。
       */
      function trackPointer(event) {
        var node = event !== null && event !== undefined ? event.currentTarget : null
        if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return
        var box = node.getBoundingClientRect()
        if (typeof node.style.setProperty === 'function') {
          node.style.setProperty('--dsh-tv-pointer-y', String(event.clientY - box.top) + 'px')
        }
      }

      /** 雙擊分隔線＝回到預設比例。 */
      function resetDrag() {
        state.streetPx = null
        writeStreetPx(null)
        render()
      }

      var seatProps = props.seatProps !== undefined && props.seatProps !== null ? props.seatProps : {}
      var original = typeof props.original === 'function' ? props.original : null

      // 原生元件的 props＝座位給我們的 props，只有 renderSlot 要換成映射版。
      var originalProps = {}
      for (var key in seatProps) {
        if (Object.prototype.hasOwnProperty.call(seatProps, key)) originalProps[key] = seatProps[key]
      }
      if (typeof seatProps.renderSlot === 'function') {
        originalProps.renderSlot = function (slotKey, owner, opts) {
          // 原生宣告的洞 → 我們鏡射出來的洞（同名以外的都照原樣轉）。
          var mapped = slotKey === WORKSPACE_FLOW_KEY ? TAVERN_FLOW_KEY : slotKey
          return seatProps.renderSlot(mapped, owner, opts)
        }
      }

      var rail = seatProps.wide === false
      var streetStyle =
        state.streetPx === null || rail
          ? undefined
          : { height: String(state.streetPx) + 'px', maxHeight: 'none', flex: '0 0 auto' }

      return React.createElement(
        'div',
        { className: 'dsh-tv-region' },
        // 工作區：原生元件 + 它自己的 props（原封不動）。
        React.createElement(
          'div',
          { className: 'dsh-tv-regionTop' },
          original === null ? null : React.createElement(original, originalProps),
        ),
        state.loaded !== true && state.error !== ''
          ? React.createElement('div', { className: 'dsh-tv-sideErr' }, state.error)
          : null,
        // 分隔線：可以拖（跟原生側邊欄的寬度把手同一個概念）。
        React.createElement('div', {
          className: 'dsh-tv-divider' + (state.dragging ? ' dsh-tv-dividerOn' : ''),
          // `data-dragging` 跟原生一樣：拖曳中那道光是持續亮著的（不是只有 hover）。
          'data-dragging': state.dragging ? 'true' : undefined,
          role: 'separator',
          'aria-orientation': 'horizontal',
          'aria-label': '拖曳調整酒館街高度（雙擊回復預設）',
          title: '拖曳調整酒館街高度；雙擊回復預設',
          onMouseMove: trackPointer,
          onMouseDown: startDrag,
          onDoubleClick: resetDrag,
        }),
        React.createElement(TavernStreet, {
          taverns: state.taverns,
          loaded: state.loaded,
          error: state.error,
          opened: state.opened,
          onToggle: toggleOpened,
          reload: reload,
          usePanelInfo: seatProps.usePanelInfo,
          wide: seatProps.wide,
          style: streetStyle,
        }),
      )
    }


    /**
     * 酒館的每個視圖都是**自己的主面板**。
     *
     * 這是照 DSH 原生工作區的做法：側邊欄清單點一項 → `layout.selectPanel(key)`
     * → 主面板換成那個 key 的內容。所以導航只有一層（側邊欄），
     * 頁面裡不再有自己的導航列。
     *
     * `main` 是 keyed 座位，而 layout 會自動把每個註冊的 key 收進可用面板清單
     * （`retainMainPanels`），所以只要在這裡列出來，key 就自動是合法目標。
     */
    /**
     * 酒館的 main 面板。
     *
     * 只有兩個，因為導航是側邊欄那棵樹（酒館街 → 酒館 → 對話）：
     *   - `tavern`       點酒館名字 → **這間酒館的設定頁**（一頁到底，分區由上往下排）
     *   - `tavern-chats` 點一份對話 → 那份對話（階段 2 接上對話循環）
     */
    var TAVERN_SETTINGS_KEY = 'tavern'
    var TAVERN_CHAT_KEY = 'tavern-chats'

    /** 目前選中的那份對話（點對話列時記下來，對話頁要讀）。 */
    var currentChat = null

    /**
     * 一條「版本號」通道：有人 `bump`，所有訂閱者就重讀自己那份資料。
     *
     * 為什麼需要這種東西：側邊欄（`sidebar.workspaces` 座位）、主面板（`main` 座位）
     * 是**互不知道對方的座位**，而 `main` 一旦被建立就一直掛著（切換 panel 只是換
     * 顯示內容，不會卸載）。沒有跨座位的通知，面板就只會停在第一次掛載時讀到的資料。
     *
     * 去抖動：一次切換／一次內容變動可能同時通知到多個訂閱者，這裡讓每個訂閱者
     * 50ms 內只重讀一次，避免同一件事讀好幾遍。
     */
    function makeVersionChannel() {
      var version = 0
      var watchers = []

      function bump() {
        version += 1
        for (var i = 0; i < watchers.length; i += 1) {
          try {
            watchers[i](version)
          } catch (error) {
            console.warn('[dsh-tavern] 通知失敗：', error)
          }
        }
      }

      /** 訂閱；回傳取消訂閱的函式。 */
      function watch(listener) {
        watchers.push(listener)
        return function () {
          var index = watchers.indexOf(listener)
          if (index >= 0) watchers.splice(index, 1)
        }
      }

      /**
       * 掛載時訂閱，收到通知就呼叫 `reload`。
       *
       * 用 `useRef` 記住最新的 `reload`，這樣訂閱只需要建立一次
       * （`reload` 每次 render 都是新的函式，放進依賴會反覆訂閱／退訂）。
       */
      function use(reload) {
        var latest = React.useRef(reload)
        latest.current = reload
        React.useEffect(function () {
          var fired = false
          return watch(function () {
            if (fired) return
            fired = true
            setTimeout(function () {
              fired = false
            }, 50)
            if (typeof latest.current === 'function') latest.current()
          })
        }, [])
      }

      return { bump: bump, watch: watch, use: use }
    }

    /**
     * 「目前酒館被換掉了」。
     *
     * 側邊欄切換酒館時 +1；設定頁／對話頁訂閱它，版本一變就自己重讀。
     * （以前沒有這一條：使用者點了另一間酒館的 ⋯，標題還是上一間，
     * 得自己按「重新讀取」才會更新——實際回報過兩次。）
     */
    var activeChannel = makeVersionChannel()

    /**
     * 「這間酒館的內容可能要重讀了」——給**分區自己**的訂閱用。
     *
     * 跟 `activeChannel` 分開的理由：分區（世界書、對話、插圖）各自快取自己的清單，
     * 而它們不是靠 `tavern.load()` 重讀的。兩種情況要通知它們：
     *   1. 內容真的變了（別的分區新增／刪除東西）；
     *   2. 使用者按了「重新讀取」——那顆按鈕的意義就是「我剛剛在檔案總管手動丟了
     *      東西進去，全部重讀一次」。只更新上面的統計數字、下面清單不動是騙人的
     *      （實際在 GUI 上看到：重新讀取之後「世界書」還列著已經刪掉的檔案）。
     *
     * 分開還有一個好處：分區重讀**不會**再回頭 bump，不會繞成無窮迴圈。
     */
    var refreshChannel = makeVersionChannel()

    /**
     * 目前**正在跑**的對話（`角色/對話名`）。
     *
     * 為什麼是本地狀態：DSH 原生的會話列用 `node.session.running` 決定要不要顯示
     * 「進行中」的指示器，而我們的 `session.list` 只回「哪個 session 綁到哪份對話」
     * （沒有 running 欄位）。所以改成我們自己知道的那件事：
     * **對話頁送出訊息到收到結果之間，這一份對話就是「進行中」**。
     *
     * 側邊欄（`TavernStreet`）與對話頁（`TavernChatPage`）是同一個 bundle 的兩個座位，
     * 共用這一份模組層級的狀態；變動時走 `refreshChannel` 通知側邊欄重讀。
     */
    var runningChats = {}

    function chatRunKey(character, chat) {
      return String(character) + '/' + String(chat)
    }

    /** 這一份對話在跑嗎。 */
    function chatIsRunning(character, chat) {
      return runningChats[chatRunKey(character, chat)] === true
    }

    /** 開始／結束「進行中」。結束時一定通知（側邊欄要換回靜態圖示）。 */
    function setChatRunning(character, chat, on) {
      var key = chatRunKey(character, chat)
      if (on === true) runningChats[key] = true
      else delete runningChats[key]
      refreshChannel.bump()
    }


    function bumpActiveVersion() {
      activeChannel.bump()
    }

    /**
     * 「這間酒館的內容變了」通知（新增／刪除人物卡、世界書、對話、插圖）。
     *
     * 兩條通道都要 bump：統計數字（`summary.counts`）靠 `activeChannel` 讓設定頁
     * 重讀，各分區的清單靠 `refreshChannel`。少了後者，在 A 分區新增東西之後，
     * B 分區的清單不會跟著更新。
     */
    function notifyWorkspaceChanged() {
      activeChannel.bump()
      refreshChannel.bump()
    }

    /**
     * 訂閱 `refreshChannel` 但**只重畫、不重讀**。
     *
     * `useRefreshVersion(load)` 會順手把清單重讀一次；側邊欄不需要那個——
     * 「這份對話開始跑／跑完」只影響那一顆圖示，重讀六份 `.jsonl` 是浪費。
     */
    function useRefreshChannelRerender(render) {
      React.useEffect(function () {
        return refreshChannel.watch(function () {
          render()
        })
      }, [])
    }

    function watchActiveVersion(listener) {
      return activeChannel.watch(listener)
    }

    function useActiveVersion(reload) {
      return activeChannel.use(reload)
    }

    /** 分區訂閱「內容可能變了／使用者按了重新讀取」。 */
    function useRefreshVersion(reload) {
      return refreshChannel.use(reload)
    }

    /** 使用者按「重新讀取」：自己的資料重讀，也讓所有分區清單重讀。 */
    function reloadEverything(load) {
      refreshChannel.bump()
      return load()
    }


    /** 切換主面板；失敗只記錄，不讓 UI 爆掉。 */
    function selectPanel(key) {
      try {
        var layout = ctxRef === null ? null : ctxRef.get('layout')
        if (layout !== null && layout !== undefined && typeof layout.selectPanel === 'function') {
          layout.selectPanel(key)
        }
      } catch (error) {
        console.warn('[dsh-tavern] 切換面板失敗：', error)
      }
    }

    /**
     * 載入酒館資料。
     *
     * 抽成獨立函式（而不是寫在元件裡）有三個好處：
     *   1. 可以直接測——不需要模擬 React 的 ref 與非同步渲染；
     *   2. 每一步都標記「正在做什麼」，失敗訊息能直接指出是哪一支；
     *   3. 逾時與失敗一律落地（`loaded = true`），永遠不會停在「載入中…」。
     *
     * @param state - 會被原地更新的狀態物件。
     * @param call - RPC 實作 `(op, args, timeoutMs, options) => Promise`。
     * @param render - 更新後要求重繪。
     * @param options - `{ signal }`：外部取消（元件卸載）時，取消後不再套用任何結果。
     */
    function loadTavernData(state, call, render, options) {
      var signal = options !== undefined && options !== null ? options.signal : undefined
      var step = 'tavern.list'
      var cancelled = function () {
        return signal !== undefined && signal !== null && signal.aborted === true
      }
      var settle = function (message) {
        // 取消之後（元件已卸載）就不要再動狀態或要求重繪。
        if (cancelled()) return
        state.error = message
        state.loaded = true
        render()
      }

      return call('tavern.list', undefined, 8000, options)
        .then(function (listed) {
          if (cancelled()) return null
          state.taverns = listed.taverns
          state.activeId = listed.activeId
          state.error = ''
          if (listed.activeId === '') {
            state.characters = []
            state.summary = null
            state.loaded = true
            render()
            return null
          }
          step = 'character.list'
          return call('character.list', undefined, 8000, options)
        })
        .then(function (characters) {
          if (characters === null) return null
          state.characters = characters
          step = 'workspace'
          return call('workspace', undefined, 8000, options)
        })
        .then(function (summary) {
          if (summary === null || summary === undefined) return null
          if (cancelled()) return
          // 一個 workspace 呼叫就把這間酒館的概況、設定檔、清單都帶回來了。
          state.summary = summary
          state.settings = summary.settings || null
          state.chats = summary.counts && typeof summary.counts.chats === 'number' ? summary.counts.chats : 0
          state.loaded = true
          render()
        })
        .catch(function (error) {
          // 卡住或失敗都要離開「載入中…」，並說清楚是哪一步。
          settle(step + ' 失敗：' + String((error && error.message) || error))
        })
    }

    /**
     * 共用狀態：每個酒館視圖都是獨立的 main 面板，各自載入自己的資料。
     *
     * 多載幾次 `tavern.list` 是可以接受的（本機檔案、實測 3–30ms），
     * 換來的是「切換面板 = 單純渲染另一個元件」，不需要跨面板共享 store。
     */
    function useTavernData() {
      var render = useForceRender()
      var ref = React.useRef(null)
      if (ref.current === null) {
        ref.current = {
          characters: [],
          summary: null,
          settings: null,
          chats: 0,
          taverns: [],
          activeId: '',
          error: '',
          // 離線測試用：直接從「已載入」開始，才能斷言內容真的渲染出來。
          loaded: testSeed.loaded,
        }
        Object.defineProperty(ref.current, '__dshTavernPageState', { value: true, enumerable: false })
      }
      var state = ref.current
      // 載入用的取消來源：元件卸載時取消，晚回來的回應不會再動狀態。
      var loadAbort = React.useRef(null)

      var load = function () {
        if (loadAbort.current !== null && typeof loadAbort.current.abort === 'function') {
          loadAbort.current.abort()
        }
        var controller = typeof AbortController === 'function' ? new AbortController() : null
        loadAbort.current = controller
        return loadTavernData(state, rpc, render, controller === null ? undefined : { signal: controller.signal })
      }

      React.useEffect(function () {
        load()
        return function () {
          if (loadAbort.current !== null && typeof loadAbort.current.abort === 'function') {
            loadAbort.current.abort()
          }
        }
      }, [])

      /**
       * 寫回這間酒館的設定檔（`tavern.json`）。
       *
       * v2 只有這一個「設定」：名稱與備註。模型參數那一套已經拿掉
       * ——它會在 DSH 啟動與每次請求時跟核心服務打交道，是之前把 DSH 卡住的原因之一。
       */
      var commit = function (patch) {
        if (state.settings === null) return
        var next = {}
        for (var key in state.settings) {
          if (Object.prototype.hasOwnProperty.call(state.settings, key)) next[key] = state.settings[key]
        }
        for (var changed in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, changed)) next[changed] = patch[changed]
        }
        state.settings = next
        render()
        rpc('settings.write', { patch: patch }, 8000)
          .then(function (saved) {
            state.settings = saved
            state.error = ''
            render()
          })
          .catch(function (error) {
            state.error = '儲存失敗：' + String((error && error.message) || error)
            render()
          })
      }

      return { state: state, render: render, load: load, commit: commit }
    }

    /** 還沒有選定酒館時的說明（每個視圖共用）。 */
    function NoTavernNotice() {
      return React.createElement(
        'div',
        { className: 'dsh-tv-empty' },
        React.createElement('div', { style: { fontSize: '26px', marginBottom: '8px' } }, '🏮'),
        React.createElement(
          'div',
          { style: { fontWeight: 600, marginBottom: '6px', color: 'var(--dsh-tv-text-1)' } },
          '還沒有選定酒館',
        ),
        React.createElement(
          'div',
          null,
          '在左側邊欄的「酒館」區塊按 ＋，選擇一個資料夾——角色卡、世界書、對話紀錄、插圖與設定都會放在裡面。',
        ),
      )
    }

    /**
     * 這間酒館的設定頁（`main` / `tavern`）。
     *
     * 側邊欄點酒館名字 → 這裡。**一頁到底**：所有設定分區由上往下排，
     * 沒有頁內導航列（導航只有側邊欄那一層）。
     */
    function TavernSettingsPage() {
      var tavern = useTavernData()
      var state = tavern.state
      // 側邊欄換了酒館就自己重讀：這個面板是常駐的，不會因為切換 panel 而重新掛載，
      // 沒有這一條就會一直顯示上一間酒館的內容，直到使用者手動按「重新讀取」。
      useActiveVersion(tavern.load)
      var noTavern = state.taverns.length === 0 || state.activeId === ''

      // 目前酒館要在**建 body 之前**算好：`var` 會提升，先用到就拿到 undefined，
      // 而 undefined 傳進子元件會在讀 `.name` 時炸掉整個 main 面板
      // （真的發生過：`main` 變成 `data-slot-error` 的死格）。
      var activeTavern = null
      for (var t = 0; t < state.taverns.length; t += 1) {
        if (state.taverns[t].active === true) activeTavern = state.taverns[t]
      }

      var body = null
      if (!state.loaded) {
        body = React.createElement('div', { className: 'dsh-tv-empty' }, '載入中…')
      } else if (noTavern) {
        body = React.createElement(NoTavernNotice)
      } else {
        var sections = [
          React.createElement(
            'section',
            { key: 'overview', className: 'dsh-tv-sec' },
            React.createElement('h3', { className: 'dsh-tv-secTitle' }, '🏠 這間酒館'),
            React.createElement(MapOverview, { summary: state.summary, characters: state.characters }),
            // 店面／背景圖：不屬於任何一張卡，是酒館自己的樣子。
            React.createElement(AssetManager, { key: 'tavern-front', kind: 'tavern', owner: '' }),
            legacyNotice(activeTavern !== null && activeTavern.exists === true && activeTavern.scaffolded === false),
            // 改名、圖示、備註、移除都在這裡（側邊欄的 ⋯ 直接進這一頁，不彈選單）。
            // `key` 很重要：這個元件把名稱快取在 useRef 裡，切換酒館時若沒有重新掛載，
            // 欄位會繼續顯示上一間酒館的名字（實測：切到「預設酒館」後仍顯示 shop）。
            React.createElement(MapTavernActions, {
              key: 'actions-' + String(activeTavern === null ? '' : activeTavern.id),
              tavern: activeTavern,
              settings: state.settings,
              commit: tavern.commit,
              reload: function () {
                tavern.load()
              },
            }),
          ),
          React.createElement(
            'section',
            { key: 'characters', className: 'dsh-tv-sec' },
            React.createElement('h3', { className: 'dsh-tv-secTitle' }, '🎭 人物卡'),
            React.createElement(MapCharacters, {
              characters: state.characters,
              tavernId: activeTavern === null ? '' : activeTavern.id,
              reload: tavern.load,
            }),
          ),
          React.createElement(
            'section',
            { key: 'worldbooks', className: 'dsh-tv-sec' },
            React.createElement('h3', { className: 'dsh-tv-secTitle' }, '📖 世界書'),
            React.createElement(MapWorldbooks, {}),
          ),
          React.createElement(
            'section',
            { key: 'chats', className: 'dsh-tv-sec' },
            React.createElement('h3', { className: 'dsh-tv-secTitle' }, '💬 對話紀錄'),
            React.createElement(MapChatFiles, { tavernId: activeTavern === null ? '' : activeTavern.id }),
          ),
        ]
        body = React.createElement('div', null, sections)
      }

      // 標題用「這間酒館的顯示名稱」——`summary.name` 是資料夾 basename（例如
      // `.dsh/tavern` → `tavern`），不是使用者在酒館街上看到的名字。
      // （`activeTavern` 在上面就算好了，理由見那裡。）
      var heading = activeTavern !== null ? activeTavern.name + ' · 設定' : '酒館設定'

      return React.createElement(
        'div',
        { className: 'dsh-tv-view' },
        React.createElement(
          'header',
          { className: 'dsh-tv-mapHead' },
          React.createElement('h2', { className: 'dsh-tv-mapTitle' }, heading),
          React.createElement(
            MapBtn,
            {
              // 「重新讀取」不只是重讀這頁：各分區（世界書、對話、插圖）的清單
              // 都是自己快取的，要一起通知，不然手動丟進資料夾的檔案不會出現。
              onClick: function () {
                reloadEverything(tavern.load)
              },
            },
            '重新讀取',
          ),
        ),
        React.createElement(
          'div',
          { className: 'dsh-tv-mapBody' },
          state.error
            ? React.createElement(
                'div',
                { className: 'dsh-tv-errRow' },
                React.createElement('span', { className: 'dsh-tv-errText' }, state.error),
                React.createElement(
                  MapBtn,
                  {
                    onClick: function () {
                      state.loaded = false
                      state.error = ''
                      tavern.render()
                      tavern.load()
                    },
                  },
                  '重試',
                ),
              )
            : null,
          body,
        ),
      )
    }
    /**
     * 一份對話（`main` / `tavern-chats`）——**真的可以聊天的那一頁**。
     *
     * 資料有兩份，分工要清楚：
     *   - **`.jsonl`**：使用者看得到的紀錄（SillyTavern 格式，可以帶走）
     *   - **DSH session**：真正在跑對話的那個東西
     *
     * 這一頁做的事：讀 `.jsonl` 畫出來 → 送訊息給 session → 把逐字回覆貼上去 →
     * 一輪結束後把兩則都追加回 `.jsonl`。
     */
    function TavernChatPage() {
      var tavern = useTavernData()
      var state = tavern.state
      // 同設定頁：常駐面板，換酒館要自己重讀（對話頁的插圖管理器也吃這份資料）。
      useActiveVersion(tavern.load)
      var selected = currentChat

      var render = useForceRender()
      var ref = React.useRef(null)
      if (ref.current === null) {
        ref.current = {
          messages: [],
          draft: '',
          live: '',
          // 串流中的思考（reasoning）。跟 `live`（正文）分開存：
          // 思考不算正文，但「模型正在想」必須看得到。
          liveThought: '',
          sessionId: '',
          busy: false,
          loaded: false,
          error: '',
          notice: '',
        }
      }
      var chat = ref.current
      // 換一份對話 → 這個元件的狀態全部重來。`useRef` 不會因為 props 改變而重置，
      // 所以要在這裡自己比對（同 `MapTavernActions` 的 key 問題）。
      var currentKey = selected === null ? '' : selected.character + '/' + selected.name
      if (chat.key !== currentKey) {
        chat.key = currentKey
        chat.messages = []
        chat.draft = ''
        chat.live = ''
        chat.liveThought = ''
        chat.sessionId = ''
        chat.busy = false
        chat.loaded = false
        chat.error = ''
        chat.notice = ''
      }

      /* ------------------------------------------------------------------ *
       * 貼底（stick to bottom）
       *
       * 使用者：「聊天室應該要保持貼底，因為現在思考的時候我看不見思考要自己手動滾下去」。
       *
       * 我們的重繪是**指令式**的（自己叫 `render()`），所以不能在 render 裡直接
       * `scrollTop = scrollHeight`（那會在使用者往上翻紀錄時把他硬拉回底部）。
       * 規矩跟原生聊天一樣：
       *   - 內容長高之後，**只有在使用者本來就貼著底**的時候才自動捲下去
       *   - 使用者自己往上滑（離底超過 40px）就尊重他，不再搶
       *   - 他再滑回底部附近 → 恢復自動
       * `layout`（不等待）＋ `requestAnimationFrame`：貼底要跟得上**每一段**
       * 串流文字，用 `smooth` 會排隊、越跑越遠。
       * ---------------------------------------------------------------- */
      var logRef = React.useRef(null)
      var pinnedRef = React.useRef({ pinned: true, bound: null })

      function stickToBottom(force) {
        var node = logRef.current
        if (node === null || node === undefined) return
        var pinned = pinnedRef.current
        if (force !== true && pinned.pinned !== true) return
        var flush = function () {
          node.scrollTop = node.scrollHeight
        }
        flush()
        // 內容高度常常在這一輪之後才定下來（圖片、字型、換行）——再補一次。
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush)
      }

      /** 內容變動之後呼叫：黏著的那種就補到最底，翻紀錄的那種就別動。 */
      React.useEffect(function () {
        stickToBottom(false)
      })

      /** 記住「使用者是不是貼著底」，並在他捲回底部時恢復自動。 */
      function onLogScroll(event) {
        var node = event !== null && event !== undefined ? event.currentTarget : null
        if (node === null || node === undefined) return
        var distance = node.scrollHeight - node.scrollTop - node.clientHeight
        pinnedRef.current.pinned = distance < 40
      }

      /** 讀 `.jsonl`（畫面上看到的紀錄）。 */
      function loadMessages() {
        if (selected === null) return Promise.resolve()
        return rpc('chat.messages', { character: selected.character, chat: selected.name })
          .then(function (messages) {
            chat.messages = Array.isArray(messages) ? messages : []
            chat.loaded = true
            chat.error = ''
            render()
          })
          .catch(function (error) {
            chat.loaded = true
            chat.error = '讀取對話失敗：' + String((error && error.message) || error)
            render()
          })
      }

      React.useEffect(function () {
        loadMessages()
      }, [currentKey])

      /**
       * 這份對話在別的地方被刪掉了（設定頁的「💬 對話紀錄」現在有刪除鈕）怎麼辦？
       *
       * 不處理的話這一頁會繼續顯示已經不存在的紀錄，使用者一送出訊息就得到
       * 「找不到這份對話」——而且他會以為是自己弄壞的。所以收到「內容變了」的通知時
       * 確認一下檔案還在不在，不見了就退回這間酒館的設定頁並說明原因。
       */
      useRefreshVersion(function () {
        if (selected === null) return
        var gone = selected.character + '/' + selected.name
        rpc('chat.list')
          .then(function (chats) {
            var stillThere = false
            for (var i = 0; i < chats.length; i += 1) {
              if (chats[i].character === selected.character && chats[i].name === selected.name) {
                stillThere = true
              }
            }
            if (stillThere) {
              // 還在——可能只是插圖或別的東西變了，重讀一次紀錄不會吃虧。
              return loadMessages()
            }
            currentChat = null
            chat.messages = []
            chat.live = ''
            chat.sessionId = ''
            chat.loaded = true
            chat.error = '這份對話已經被刪掉了（' + gone + '.jsonl），所以回到設定頁。'
            render()
            selectPanel(TAVERN_SETTINGS_KEY)
            return null
          })
          .catch(function () {
            // 連清單都讀不到時什麼都不做：這一頁已經有它自己的錯誤顯示路徑，
            // 不在「內容變了」的副作用裡再蓋一層錯誤（會蓋掉真正的載入錯誤）。
          })
      })

      /** 這間酒館的資料夾（session 的 `cwd`，Agent 面靠它找到酒館）。 */
      function tavernRoot() {
        return state.summary !== null && typeof state.summary.root === 'string' ? state.summary.root : ''
      }

      function submit() {
        var text = chat.draft.trim()
        if (text === '' || chat.busy) return
        if (selected === null) return
        chat.busy = true
        chat.draft = ''
        chat.live = ''
        chat.liveThought = ''
        chat.error = ''
        chat.notice = ''
        render()

        var tavernId = state.activeId
        var root = tavernRoot()
        if (root === '') {
          chat.busy = false
          chat.error = '還不知道這間酒館的資料夾——先按「重新讀取」'
          render()
          return
        }
        // 先把使用者的話畫上去（不要等他跑完網路才看到自己打了什麼）。
        chat.messages = chat.messages.concat([{ name: '你', isUser: true, text: text, sendDate: '' }])
        // 側邊欄那一列的圖示換成「進行中」的跑馬燈（送出到收到結果之間）。
        setChatRunning(selected.character, selected.name, true)
        render()
        // 自己剛送出的訊息一定要看得到 → 無條件貼底（就算剛剛在翻紀錄）。
        pinnedRef.current.pinned = true
        stickToBottom(true)

        ensureChatSession(tavernId, selected.character, selected.name, root)
          .then(function (ready) {
            chat.sessionId = ready.sessionId
            if (ready.created === true) chat.notice = '已開一個新的對話 session'
            render()
            return sendChatMessage(ready.sessionId, text, {
              onReasoning: function (thought) {
                chat.liveThought += thought
                render()
              },
              onDelta: function (delta) {
                chat.live += delta
                render()
              },
            })
          })
          .then(function (result) {
            chat.busy = false
            var reasoning = typeof result.reasoning === 'string' ? result.reasoning : chat.liveThought
            chat.live = ''
            chat.liveThought = ''
            chat.messages = chat.messages.concat([
              { name: selected.character, isUser: false, text: result.text, sendDate: '', reasoning: reasoning },
            ])
            setChatRunning(selected.character, selected.name, false)
            render()
            // 寫回 `.jsonl`：**這是使用者帶得走的那一份**。寫不進去不算對話失敗，
            // 但要說出來（不然他會以為紀錄有存）。
            return rpc('chat.append', {
              id: tavernId,
              character: selected.character,
              chat: selected.name,
              messages: [
                { name: '你', isUser: true, text: text },
                { name: selected.character, isUser: false, text: result.text, reasoning: reasoning },
              ],
            }).catch(function (error) {
              chat.error = '回覆有拿到，但寫回紀錄失敗：' + String((error && error.message) || error)
              render()
            })
          })
          .catch(function (error) {
            chat.busy = false
            chat.liveThought = ''
            chat.error = String((error && error.message) || error)
            setChatRunning(selected.character, selected.name, false)
            render()
          })
      }

      /** 打斷這一輪。 */
      function stop() {
        if (chat.sessionId === '') return
        cancelChatMessage(chat.sessionId).then(function () {
          chat.busy = false
          if (selected !== null) setChatRunning(selected.character, selected.name, false)
          render()
        })
      }

      var body = null
      if (selected === null) {
        body = React.createElement('div', { className: 'dsh-tv-empty' }, '從側邊欄的「酒館街」點一份對話。')
      } else {
        var bubbles = chat.messages.map(function (message, index) {
          return React.createElement(
            'div',
            {
              key: 'm' + String(index),
              className: message.isUser ? 'dsh-tv-bubble dsh-tv-bubbleMe' : 'dsh-tv-bubble',
            },
            React.createElement('div', { className: 'dsh-tv-bubbleWho' }, message.name),
            // 這一則的思考（`.jsonl` 的 `extra.reasoning`）：畫在氣泡**上面**，
            // 跟 DSH 原生把思考放在回覆前面一致。
            typeof message.reasoning === 'string' && message.reasoning !== ''
              ? React.createElement(ThinkingRow, { key: 'r', text: message.reasoning, running: false })
              : null,
            React.createElement('div', { className: 'dsh-tv-bubbleText' }, message.text),
          )
        })
        // 串流中的那一則：**思考先出現、正文後出現**。以前 reasoning 被整段丟掉，
        // 所以模型在想的那幾秒畫面上什麼都沒有（看起來像卡住）。
        if (chat.liveThought !== '' || chat.live !== '') {
          bubbles.push(
            React.createElement(
              'div',
              { key: 'live', className: 'dsh-tv-bubble' },
              React.createElement('div', { className: 'dsh-tv-bubbleWho' }, selected.character),
              chat.liveThought !== ''
                ? React.createElement(ThinkingRow, {
                    key: 'think',
                    text: chat.liveThought,
                    // 還在想＝還沒收到正文；正文一開始流就停止流動效果。
                    running: chat.live === '',
                  })
                : null,
              chat.live === '' ? null : React.createElement('div', { className: 'dsh-tv-bubbleText' }, chat.live),
            ),
          )
        }

        body = React.createElement(
          'div',
          { className: 'dsh-tv-chatBody' },
          chat.error !== '' ? React.createElement('div', { className: 'dsh-tv-err' }, chat.error) : null,
          chat.notice !== '' ? React.createElement('div', { className: 'dsh-tv-ok' }, chat.notice) : null,
          !chatAvailable()
            ? React.createElement(
                'div',
                { className: 'dsh-tv-err' },
                '這台 DSH 沒有對話服務（remote.session）——酒館可以管理檔案，但沒有辦法在這裡聊天。',
              )
            : null,
          React.createElement(
            'div', { className: 'dsh-tv-chatLog', ref: logRef, onScroll: onLogScroll },
            chat.loaded === false
              ? React.createElement('p', { className: 'dsh-tv-note' }, '載入中…')
              : bubbles.length === 0
                ? React.createElement(
                    'p',
                    { className: 'dsh-tv-note' },
                    '還沒有訊息。在下面打字就開始——角色卡會自動變成這個對話的系統提示。',
                  )
                : bubbles,
          ),
          React.createElement(
            'div',
            { className: 'dsh-tv-chatInput' },
            React.createElement('textarea', {
              className: 'dsh-tv-ta',
              rows: 3,
              placeholder: '跟 ' + selected.character + ' 說些什麼…（Enter 送出，Shift+Enter 換行）',
              value: chat.draft,
              disabled: chat.busy,
              onChange: function (event) {
                chat.draft = event.target.value
                render()
              },
              onKeyDown: function (event) {
                if (event.key === 'Enter' && event.shiftKey !== true) {
                  event.preventDefault()
                  submit()
                }
              },
            }),
            React.createElement(
              'div',
              { className: 'dsh-tv-inlineRow', style: { marginTop: '6px' } },
              React.createElement(MapBtn, { primary: true, disabled: chat.busy, onClick: submit }, chat.busy ? '回覆中…' : '送出'),
              chat.busy
                ? React.createElement(MapBtn, { onClick: stop }, '停下來')
                : null,
              React.createElement(
                'span',
                { className: 'dsh-tv-note', style: { marginLeft: 'auto' } },
                '檔案：chats/' + selected.character + '/' + selected.file,
              ),
            ),
          ),
          // 這份對話（聊天室）自己的插圖：場景圖、房間圖都掛在這裡。
          React.createElement(AssetManager, {
            key: 'chat-' + selected.character + '/' + selected.name,
            kind: 'chat',
            owner: selected.character + '/' + selected.name,
          }),
        )
      }

      return React.createElement(
        'div',
        { className: 'dsh-tv-view' },
        React.createElement(
          'header',
          { className: 'dsh-tv-mapHead' },
          React.createElement(
            'h2',
            { className: 'dsh-tv-mapTitle' },
            selected === null ? '對話' : chatLabel(selected),
          ),
          React.createElement(
            MapBtn,
            {
              // 「重新讀取」不只是重讀這頁：各分區（世界書、對話、插圖）的清單
              // 都是自己快取的，要一起通知，不然手動丟進資料夾的檔案不會出現。
              onClick: function () {
                reloadEverything(tavern.load)
                loadMessages()
              },
            },
            '重新讀取',
          ),
        ),
        React.createElement('div', { className: 'dsh-tv-mapBody' }, body),
      )
    }



    /** 設定 → 插件 → 酒館 */
    function TavernSettingsCard() {
      var render = useForceRender()
      var ref = React.useRef(null)
      if (ref.current === null) ref.current = { summary: null, error: '', busy: false }
      var state = ref.current

      /**
       * 讀取酒館摘要。
       *
       * ⚠️ 以前這裡是「只打一次，失敗就默默吞掉（empty catch）」，所以在 DSH
       * 剛啟動、宿主半還沒掛好（或連線還沒穩）時打開設定，就會**永遠**停在
       * 「工作區讀取中…」——使用者實際回報過這個畫面。現在會退避重試，真的失敗時
       * 把錯誤顯示出來並給一顆「重新整理」。
       */
      function refresh(attempt) {
        var tries = typeof attempt === 'number' ? attempt : 0
        state.busy = true
        state.error = ''
        render()
        return rpc('workspace', undefined, 8000)
          .then(function (summary) {
            state.summary = summary
            state.busy = false
            state.error = ''
            render()
          })
          .catch(function (error) {
            // 前幾次失敗當作「還沒準備好」，退避後再試；試完才把錯誤顯示出來。
            if (tries < 4) {
              setTimeout(function () {
                refresh(tries + 1)
              }, 500 * (tries + 1))
              return
            }
            state.busy = false
            state.error = String((error && error.message) || error)
            render()
          })
      }

      React.useEffect(function () {
        refresh(0)
      }, [])

      var summary = state.summary
      var counts = summary ? summary.counts : null
      var noTavern = summary !== null && (summary.root === '' || summary.exists !== true)

      var desc = '正在讀取酒館…'
      if (state.error !== '') desc = '讀取失敗：' + state.error
      else if (noTavern) desc = '還沒有選定酒館——在側邊欄的「酒館街」按 ＋ 選一個資料夾'
      else if (counts) {
        desc = '角色卡 ' + counts.characters + ' · 世界書 ' + counts.worldbooks + ' · 對話 ' + counts.chats
      }

      return React.createElement(
        'div',
        { className: 'dsh-tv-card' },
        React.createElement(
          'div',
          { className: 'dsh-tv-cardName' },
          React.createElement('span', null, '🏮'),
          React.createElement('span', null, '酒館模式'),
        ),
        React.createElement('div', { className: 'dsh-tv-cardDesc' }, desc),
        React.createElement('p', { className: 'dsh-tv-path' }, summary && !noTavern ? summary.root : ''),
        React.createElement(
          MapBtn,
          { onClick: function () { refresh(0) }, disabled: state.busy },
          state.busy ? '讀取中…' : '重新整理',
        ),
      )
    }

    /* ---------------------------- 插件出口 ---------------------------- */

    var name = 'dsh-tavern'
    var inject = ['slots']

    function apply(ctx) {
      ctxRef = ctx

      ctx.effect(function () {
        // 兩層：**token 層**（主題、會被換掉）在前，**元件樣式**（只引用 token）在後。
        themeStyle = document.createElement('style')
        themeStyle.setAttribute('data-dsh-plugin', 'dsh-tavern')
        themeStyle.setAttribute('data-dsh-tavern-theme', 'tokens')
        themeStyle.textContent = themeTokensCss()
        document.head.appendChild(themeStyle)

        var style = document.createElement('style')
        style.setAttribute('data-dsh-plugin', 'dsh-tavern')
        style.textContent = MAP_CSS
        document.head.appendChild(style)
        return function () {
          themeStyle.remove()
          style.remove()
        }
      }, 'dsh-tavern: styles')

      var slots = ctx.get('slots')
      if (slots === undefined) return

      // 觀察渲染期崩潰。
      //
      // slot 的 boundary 會把崩掉的 entry「退位」（abdicated），然後下一個候選人接手
      // ——症狀正是「註冊成功、畫面上卻還是原生那一個」。這條路以前完全靜默，
      // 所以把每次崩潰記進 `window.__dshTavern.entryErrors`，排查不必再靠猜。
      ctx.effect(
        function () {
          if (typeof slots.onEntryError !== 'function') return undefined
          var listener = function (key, entry, error, abdicated) {
            var message = String((error && error.message) || error)
            try {
              var box = window.__dshTavern !== undefined ? window.__dshTavern : (window.__dshTavern = {})
              var list = box.entryErrors !== undefined ? box.entryErrors : (box.entryErrors = [])
              list.push({ slot: String(key), message: message, abdicated: abdicated === true })
            } catch (ignored) {
              /* 沒有 window 的環境就算了 */
            }
            console.warn('[dsh-tavern] 座位渲染失敗：' + String(key) + ' — ' + message)
          }
          var off = slots.onEntryError(listener)
          return function () {
            if (typeof off === 'function') off()
          }
        },
        'dsh-tavern: entry error watch',
      )

      // ⚠️ 這裡**刻意沒有**註冊 `sidebar.panellist`（側邊欄最上方那排全局面板圖示）。
      //
      // 曾经有一個：一顆 🏮 酒館，按下去選取 `main` / `tavern`。但酒館街成為側邊欄
      // 裡跟「工作區」並排的區塊之後，那顆圖示就是多餘的第二個入口（工作區也沒有
      // 這種圖示），而且它會在點酒館時跟著亮起來，看起來像殘留。
      // 導航只有一層：側邊欄的酒館街 → 酒館（設定）→ 對話。

      // 「酒館街」：側邊欄裡跟「工作區」並排的第二個區塊。
      //
      // 使用者的資訊架構（照他的說法）：
      //   工作區 → 具體的工作區資料夾 → 具體對話
      //   酒館街 → 酒館（點名字 = 這間酒館的設定） → 具體對話
      //
      // 所以酒館街必須在 `.regionArea`（側邊欄中間那一大塊）裡、跟工作區上下並排，
      // 而不是掛在設定旁邊。`.regionArea` 只渲染 `sidebar.workspaces` 這個 single
      // 座位，因此只能接管它——接管時有兩個必踩的細節，見 `TavernSidebarRegion`。
      ctx.effect(
        function () {
          var registered = false
          var attempts = 0
          var retry = null
          var dispose = null
          var flowDispose = null

          /** 找到原生那一筆（工作區區塊），它必須還在。 */
          var originalEntryOf = function () {
            if (slots === null || slots === undefined || typeof slots.entries !== 'function') return null
            var entries = slots.entries('sidebar.workspaces')
            for (var i = 0; i < entries.length; i += 1) {
              var entry = entries[i]
              if (entry === null || entry === undefined) continue
              if (typeof entry.component !== 'function') continue
              if (entry.component === TavernSidebarRegion) continue
              return entry
            }
            return null
          }

          /** 座位上有哪些子座位（用來鏡射），以及誰住在裡面。 */
          var flowOccupantOf = function (key) {
            try {
              if (typeof slots.entriesOfSlot !== 'function') return null
              var list = slots.entriesOfSlot(key)
              if (list.length === 0) return null
              var entry = list[0]
              return entry !== null && entry !== undefined && typeof entry.component === 'function' ? entry : null
            } catch (error) {
              return null
            }
          }

          /** entry 上的 inject / store / locale 都在**頂層**，要整組搬過去。 */
          var carryOver = function (options, entry) {
            if (entry.inject !== undefined) options.inject = entry.inject
            if (entry.store !== undefined) options.store = entry.store
            if (entry.locale !== undefined) options.locale = entry.locale
            return options
          }

          var tryRegister = function () {
            if (registered) return true
            var entry = originalEntryOf()
            if (entry === null) return false
            registered = true
            try {
              // 自己宣告一個子座位：這樣 renderer 才會發 `renderSlot` 給我們
              // （`standardKit` 只在 `entry.children !== undefined` 時給），
              // 才有東西可以映射原生那一聲 renderSlot。
              var children = {}
              children[TAVERN_FLOW_KEY] = { kind: 'single', scope: 'root' }
              var options = carryOver({ name: 'sidebar.workspaces', priority: -1, children: children }, entry)
              var original = entry.component
              var occupant = function TavernSidebarOccupant(seatProps) {
                return React.createElement(TavernSidebarRegion, { seatProps: seatProps, original: original })
              }
              occupant.__dshTavernOccupant = true
              dispose = slots.register(options, occupant)

              // 把原本住在那個洞裡的流程元件搬進我們鏡射的洞。
              var flowEntry = flowOccupantOf(WORKSPACE_FLOW_KEY)
              if (flowEntry !== null) {
                flowDispose = slots.register(carryOver({ name: TAVERN_FLOW_KEY }, flowEntry), flowEntry.component)
              }

              try {
                window.__dshTavern = {
                  build: CLIENT_BUILD,
                  mount: 'sidebar.workspaces@-1',
                  mirroredFlow: flowEntry !== null,
                }
              } catch (error) {
                /* 離線環境沒有 window */
              }
            } catch (error) {
              registered = false
              console.warn('[dsh-tavern] 酒館街區塊註冊失敗，工作區不受影響：', error)
            }
            return true
          }

          if (!tryRegister()) {
            // 原生那一筆還沒就位時重試；每次 400ms、最多約 12 秒。
            retry = setInterval(function () {
              attempts += 1
              if (tryRegister() || attempts >= 30) {
                clearInterval(retry)
                retry = null
              }
            }, 400)
          }

          return function () {
            if (retry !== null) clearInterval(retry)
            if (typeof flowDispose === 'function') flowDispose()
            if (typeof dispose === 'function') dispose()
          }
        },
        'dsh-tavern: 酒館街區塊',
      )

      // 酒館的 main 面板：只有兩個（設定頁 ＋ 對話）。
      //
      // 導航是側邊欄那棵樹（酒館街 → 酒館 → 對話），所以不需要更多 key，
      // 頁面裡也不會有自己的導航列。
      slots.inject(
        'main',
        function () {
          var disposers = [
            slots.register({ name: 'main', key: TAVERN_SETTINGS_KEY }, TavernSettingsPage),
            slots.register({ name: 'main', key: TAVERN_CHAT_KEY }, TavernChatPage),
          ]
          return function () {
            for (var i = 0; i < disposers.length; i += 1) {
              if (typeof disposers[i] === 'function') disposers[i]()
            }
          }
        },
        'dsh-tavern: tavern panels',
      )

      // 設定 → 插件 → 酒館
      slots.inject(
        'settings.plugin.item',
        function () {
          return slots.register({ name: 'settings.plugin.item', key: 'tavern' }, TavernSettingsCard)
        },
        'dsh-tavern: settings card',
      )
    }

    module.exports = {
      name: name,
      inject: inject,
      apply: apply,
      __testSeed: testSeed,
      __build: CLIENT_BUILD,
      __createRpc: createRpc,
      __setRpc: setRpc,
      __loadTavernData: loadTavernData,
      /**
       * 卡片資產 summarise。
       *
       * 匯出給測試是必要的：這一支曾經用 `card.extensions !== null` 當守衛
       * （`undefined !== null` 是 true），於是**沒有 extensions 欄位的卡片**——
       * 也就是大多數的卡——會讓整個設定頁整格消失，而且沒有任何訊息。
       */
      __cardAssets: cardAssets,
      /**
       * 對話的 session 生命週期。
       *
       * 這一組一定要能單獨驗——它是最容易「看起來有接、其實沒接」的一塊：
       * `ctx.get('remote.session')` 拿不到時我們**刻意**回報不可用而不是丟錯
       * （R2：寫進 `inject` 會讓整個 GUI 白屏），所以「沒接上」跟「這台 DSH
       * 沒有那個服務」在畫面上長得一模一樣。
       */
      __chat: {
        available: chatAvailable,
        ensure: ensureChatSession,
        send: sendChatMessage,
        cancel: cancelChatMessage,
        textDeltaOf: textDeltaOf,
        reasoningDeltaOf: reasoningDeltaOf,
        splitNarration: splitNarration,
        // 主題框架（給測試與之後的設定頁）
        FALLBACK_THEME_TOKENS: FALLBACK_THEME_TOKENS,
        themeTokensCss: themeTokensCss,
        applyTheme: applyTheme,
        currentTheme: currentTheme,
        setThemeTokens: setThemeTokens,
        themeTokens: function () {
          return themeTokens
        },
        // 「哪一份對話在跑」的狀態（側邊欄那一列的指示器靠它）——給測試用。
        chatIsRunning: chatIsRunning,
        setChatRunning: setChatRunning,
        isCommittedEnd: isCommittedEnd,
        /** 測試用：換掉 ctx（`ctx.get('remote.session')` 的來源）。 */
        setContext: function (next) {
          ctxRef = next
        },
      },
      // 檔案選擇的取值邏輯。這一條一定要能單獨驗：舊寫法在真瀏覽器裡是**靜默**
      // 失效（沒錯誤、沒訊息、按鈕看起來正常），只有把「活的 FileList」餵進來才驗得到。
      __pickFiles: pickFiles,
      // 「目前酒館換了」的通知機制。測試要能驗它——假 React 的 useEffect 是空函式，
      // 所以真實的訂閱流程在離線測試裡跑不到，只能直接驗這兩個函式。
      __watchActiveVersion: watchActiveVersion,
      __bumpActiveVersion: bumpActiveVersion,
      __useActiveVersion: useActiveVersion,
      // 分區清單那條通道（內容變了／按了重新讀取）。
      __refreshChannel: refreshChannel,
      __useRefreshVersion: useRefreshVersion,
      __reloadEverything: reloadEverything,
      __notifyWorkspaceChanged: notifyWorkspaceChanged,
      // 給離線測試直接渲染用（座位的 props 有兩種進來的方式，只有這樣才測得到
      // 「拿不到原生工作區元件時」那條降級路徑）。
      __components: {
        TavernSidebarRegion: TavernSidebarRegion,
        TavernStreet: TavernStreet,
        TavernSettingsPage: TavernSettingsPage,
        TavernChatPage: TavernChatPage,
        AssetManager: AssetManager,
        ThinkingRow: ThinkingRow,
      },
    }
    return module.exports
  },
})
