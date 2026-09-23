window.__ModuleLoader__.load({
  id: 'dsh-tavern',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    /**
     * ⚠️ **這一格宣告在最前面是刻意的，不要往下搬。**
     *
     * `TavernSettingsPage`（檔案中段）會讀它，而 `var` 的提升**只提升宣告、
     * 不提升值**——搬到使用點之後，那裡讀到的會是 `undefined`。
     *
     * 這一型踩過三次：2.6.57 的 `PARSE_DEFAULT_CONFIG`（症狀是整頁白屏）、
     * 2.6.65 的 `pendingBookOpen`（症狀是 `open(undefined)` 靜靜地什麼都不做，
     * 那一格在 2.6.68 連同「跳到某一本書」一起拿掉了）、
     * 以及同一輪裡把 `currentZone` 自己搬下去。
     */

    /** 目前選中的分區（大廳／包廂／卡司／藏書／設定）。 */
    var currentZone = 'hall'

/**
 * **DSH 自己的 UI 基本元件**（Button／Modal／圖示…）——共用資源，不要自己刻。
 *
 * ⚠️ 這個套件在磁碟上**沒有獨立目錄**：它包在預建的 app bundle 裡，由 __ModuleLoader__
 * 在記憶體註冊。所以 loader 願不願意把它給第三方模組，只能在真瀏覽器裡試。
 * 拿不到就維持 
ull，下面全部回退到酒館自己那一份——**不會壞**。
 */
/**
 * react-dom 的 createPortal——選單要 portal 到 document.body 才不會被祖先的
 * transform 帶歪（position:fixed 的 containing block 陷阱）。這個 repo 的入口選單
 * （paintChatMenu）就是這樣做的。拿不到就 
ull，選單退回原本的畫法——**不會壞**。
 */
var CREATE_PORTAL = null
try {
  var ReactDOM = require('react-dom')
  if (ReactDOM !== null && ReactDOM !== undefined && typeof ReactDOM.createPortal === 'function') {
    CREATE_PORTAL = ReactDOM.createPortal
  }
} catch (error) {
  CREATE_PORTAL = null
}

var PRIMITIVES = null
try {
  PRIMITIVES = require('@deepseek-ai/dsh-client-ui-primitives')
} catch (error) {
  PRIMITIVES = null
}

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
    var CLIENT_BUILD = 'tavern-client-2.6.71'

    /**
     * 生成參數的合法範圍——**這是 `lib/samplers.js` 的鏡射**。
     *
     * 客戶端 bundle 沒有 ESM import（它是手寫的 `__ModuleLoader__` bundle），
     * 所以拿不到那邊的常數。這個 repo 對這種情況已經有一條既定做法
     * （見 `plan.md` §7.9 的色票）：**鏡射一份最小值，然後用測試釘住兩邊一致**。
     *
     * `test-client.mjs` 會把這三個數字跟 `TEMPERATURE_RANGE`／`MAX_TOKENS_RANGE`
     * 對照——改一邊沒改另一邊就會紅。
     *
     * ⚠️ 這裡**只有兩個**：DSH 的 `LlmCallConfig` 沒有 `top_p`，所以畫面上也沒有它。
     * 理由寫在 `lib/samplers.js` 的檔頭。
     */
    var SAMPLER_RANGES = {
      temperature: { min: 0, max: 2 },
      maxTokens: { min: 1, max: 200000 },
    }

    /**
     * `stop` 序列那一組的界線——**同樣是 `lib/samplers.js` 的鏡射**
     * （`STOP_LIMITS`，`test-client.mjs` 會拿兩邊對照）。
     *
     * ⚠️ 它與 `SAMPLER_RANGES` **形狀不同**（`count`／`length` 而不是 `min`／`max`）
     * 是刻意的：那兩個是「一個數字有範圍」，這是「一個清單有數量與長度的上限」。
     * 硬塞進 `{min,max}` 只會讓人以為 `stop` 也是一個數字欄位。
     *
     * ⚠️ 這兩個數字**不是 DSH 的限制**，是我們選的（理由見 `lib/samplers.js`），
     * 所以畫面的說明文字要講得出「為什麼是這個數字」，不能只寫「最多 16 個」。
     */
    var STOP_LIMITS = { count: 16, length: 64 }

    /**
     * 內建的 `stop` 樣式（**`lib/samplers.js` 的 `STOP_PRESET` 的鏡射**）。
     *
     * ⚠️ 客戶端需要它**只為了畫那句說明**（「開關會多送這四串」）——實際送出的是
     * 宿主半算的。但兩邊必須一字不差：畫面上列的四串與真的送出去的四串不一樣
     * 是**最糟的那種不一致**（使用者會照著畫面去推理，而推理的基礎是錯的）。
     * `test-client.mjs` 會拿兩邊對照。
     */
    var STOP_PRESET = ['\n使用者：', '\nUser:', '\n我：', '\nYou:']

    /**
     * 回覆格式的三種模式（**`lib/render.js` 的 `RENDER_MODES` 的鏡射**）。
     *
     * ⚠️ `plain` 一定要在**第一個**：那是預設值，也是「與以前一字不差」的那一個。
     * 順序同時是設定頁上的順序（安全 → 精確）。
     */
    var RENDER_MODES = ['plain', 'marked', 'structured']

    /**
     * 位置 → **清單上的短標籤**。
     *
     * ⚠️ 為什麼要有短標籤：位置那一格（「放在哪裡」）住在**編輯器**裡，而編輯器
     * 要選了一本書才看得到——所以清單上看不出「哪一本被放在哪裡」，使用者
     * 也不知道有這件事（實測：使用者回報「我沒有看見設定位置的按鈕」）。
     * 清單上一行短字就解決了：一眼看得出來、也知道點進去看得到更多。
     */
    var POSITION_SHORT = {
      'system-before': '系統前',
      'system-after': '系統後',
      'in-chat': '訊息前',
    }

    /**
     * 一本書的**位置那一格要顯示的值**（空字串＝跟著酒館預設）。
     *
     * ⚠️ **顯示的是檔案裡的原始值，不是算完的結果。** 這一條很容易做錯：
     * 拿 `worldbook.positions` 回來的 `position`（已經把酒館預設算進去）去填，
     * 使用者就會看到「跟著酒館預設」變成一個具體位置——然後以為自己被改過了，
     * 於是去改一個他沒有要改的東西。
     *
     * 抽成模組層級的純函式（而不是住在 `MapWorldbooks` 裡）是為了測得到：
     * 那一區的清單是**非同步**載入的，假 React 的 `useEffect` 不會跑。
     *
     * @param info - `worldbook.positions` 的回應（可以是 `null`）。
     * @param id - 世界書 id。
     * @returns `''` 或 `WORLDBOOK_POSITIONS` 之一。
     */
    function bookPositionValue(info, id) {
      var list = info !== null && info !== undefined && Array.isArray(info.books) ? info.books : []
      var one = list.filter(function (b) {
        return b.id === id
      })[0]
      if (one === undefined) return ''
      return one.explicit === true ? one.position : ''
    }

    /**
     * 房間那一格「這一間房的『藏書放哪裡』」要顯示的值。
     *
     * ⚠️ **顯示的是 `room.json` 裡的原始值**（`''` ＝ 聽酒館的），
     * 不是算完的結果——同 `bookPositionValue` 那一條理由：顯示算完的值會讓
     * 使用者看到「聽酒館的」變成一個具體位置，然後以為自己被改過了。
     *
     * ⚠️ 守衛要用 `typeof === 'string'` ＋ `in`，**不是** `!== null`：
     * `undefined`（舊宿主沒回這一格）也要落回 `''`。
     */
    function roomBookPositionValue(room) {
      var value = room === null || room === undefined ? null : room.worldbookPosition
      return typeof value === 'string' ? value : ''
    }

    /**
     * 工具權限的選項（**一份，兩個呼叫端共用**：⚙️ 設定 與對話頁的 ⚙️ 房間）。
     *
     * ⚠️ 以前這兩處**各有一份自己的清單**，而且解釋是塞在 `label` 裡
     * （`'只讀——它可以自己翻角色卡…'`）。使用者回報那個做法不好：
     * 收合時看不到重點、選項清單也不能掃視。現在 `label` 是短名字、
     * `hint` 是解釋（只顯示選中那一項）。
     *
     * ⚠️ 兩份清單走散過的風險是真的：`value` 必須與 `lib/workspace.js` 的
     * `ROOM_TOOL_LEVELS` 一字不差，少一個值就會出現「選了卻存不進去」。
     */
    var TOOL_LEVEL_OPTIONS = [
      { value: 'none', label: '全關', hint: '它看不到你的檔案，也不能跑指令。（預設）' },
      { value: 'read', label: '只讀', hint: '可以自己翻角色卡、世界書與對話紀錄，但不會改任何檔案。' },
      { value: 'write', label: '讀＋寫', hint: '只讀那一組，加上可以新增或修改檔案（例如幫你寫世界書條目）。' },
      { value: 'web', label: '只讀＋上網', hint: '只讀那一組，加上可以上網查資料。' },
      { value: 'all', label: '全部', hint: '跟一般 agent 一樣，能用的工具全開。' },
    ]

    /** 房間那一層多一個「聽酒館的」（＝`inherit`，房間的預設值）。 */
    var ROOM_TOOL_LEVEL_OPTIONS = [
      { value: 'inherit', label: '聽酒館的', hint: '沿用 ⚙️ 設定 那一層（預設）。' },
    ].concat(TOOL_LEVEL_OPTIONS)

    /**
     * 世界書的三個注入位置（**`lib/worldbook.js` 的鏡射**）。
     *
     * ⚠️ 人話說明也一起鏡射（`WORLDBOOK_POSITION_INFO`）——畫面上寫的
     * 「放在哪裡」與宿主半真的做的事必須是同一件事。`test-client.mjs` 會對照。
     *
     * ⚠️ **`label` 是短名字（選項清單用）、`hint` 是解釋（只顯示選中那一項）**：
     * 見 `MapSelect` 的說明。
     */
    var WORLDBOOK_POSITIONS = ['system-before', 'system-after', 'in-chat']

    /**
     * 條目 `order`（優先序）的上下限（**`lib/worldbook.js` 的 `ORDER_LIMITS` 鏡射**）。
     *
     * ⚠️ 客戶端不能 import 宿主半（這一支是手寫的 bundle），所以這一組值有兩份
     * ——`test-client.mjs` 會把它們對照起來。走散的話畫面會讓使用者輸入一個
     * 宿主半一定丟掉的值（症狀：打完、看起來存了、其實被丟掉）。
     */
    var ORDER_LIMITS = { min: -9999, max: 9999 }

    var WORLDBOOK_POSITION_INFO = {
      'system-before': {
        label: '系統提示・前',
        hint: '放在角色卡**前面**。世界的背景設定——模型先讀到它，再讀到「你是誰」。',
      },
      'system-after': {
        label: '系統提示・後',
        hint:
          '放在角色卡**後面**。規則與格式該在這裡：它與角色卡同在系統提示、又在後面，' +
          '所以模型的遵從度最高。⚠️ **只有「關鍵字觸發」的條目才有代價**——命中關鍵字的' +
          '那一輪系統提示會變，那一輪的快取前綴要重算；**常駐條目沒有代價**（每輪一字不差）。',
      },
      'in-chat': {
        label: '訊息尾巴',
        hint:
          '接在**最新那則訊息前面**。關鍵字觸發的設定用這個——它不影響快取前綴' +
          '（實測第 2 輪起 77～82% 命中），代價是模型會把它讀成「使用者剛剛說的話」。',
      },
    }

    /**
     * 這一間房的工具權限選項（composer 上那一顆 chip 與 ⚙️ 房間 共用同一組值）。
     *
     * ⚠️ **`value` 必須與 `lib/workspace.js` 的 `ROOM_TOOL_LEVELS` 一字不差**，
     * 而且 `short` 是**給 chip 用的短標籤**（chip 只有 28px 高、空間有限），
     * `desc` 才是 `plan.md` 決定的那句「**它拿到什麼**」——不是工具名稱。
     *
     * `inherit` 放第一個：它是房間的預設值（「聽酒館的」），而且 ⚙️ 房間 那一格的
     * 選項順序也是這樣。
     */
    var PERMISSION_CHOICES = [
      { value: 'inherit', short: '聽酒館的', desc: '沿用 ⚙️ 設定 那一層（預設）' },
      { value: 'none', short: '全關', desc: '它看不到你的檔案，也不能跑指令' },
      { value: 'read', short: '只讀', desc: '可以自己翻角色卡、世界書與對話紀錄，不會改檔案' },
      { value: 'write', short: '讀＋寫', desc: '加上可以新增或修改檔案（例如幫你寫世界書條目）' },
      { value: 'web', short: '只讀＋上網', desc: '只讀那一組，加上可以上網查資料' },
      { value: 'all', short: '全部', desc: '跟一般 agent 一樣，能用的工具全開' },
    ]

    /** `value` → 短標籤（chip 顯示用）。查不到就當成 `inherit`。 */
    var PERMISSION_SHORT = (function () {
      var map = {}
      for (var i = 0; i < PERMISSION_CHOICES.length; i += 1) {
        map[PERMISSION_CHOICES[i].value] = PERMISSION_CHOICES[i].short
      }
      return map
    })()

    /**
     * 把訊息切成「**輪**」，回傳每一輪**起始那則訊息**的索引。
     *
     * 一輪＝一條使用者訊息 ＋ 它後面的角色回覆，所以輪的起點就是使用者訊息。
     * 開場白（角色先說、還沒有使用者訊息）**不算一輪**——它前面沒有「問題」可以跳。
     *
     * 這是給對話頁右邊那條「輪次刻度」用的（使用者貼了 DSH 的
     * `.eGxaPq_marks` 說「還有這個工具」）。抽成純函式是為了測得到：
     * 假的 React 沒有排版，量不到位置，但**分輪的規則**可以單獨驗。
     */
    function turnAnchorsOf(messages) {
      var list = Array.isArray(messages) ? messages : []
      var out = []
      for (var i = 0; i < list.length; i += 1) {
        var one = list[i]
        if (one === null || typeof one !== 'object') continue
        if (one.isUser === true) out.push(i)
      }
      return out
    }

    /**
     * 輪次刻度的三個常數——**照抄 DSH**（`dsh-client-ui-chat/lib/client.js` 的
     * `TURN_SPACING_PX`／`RAIL_INSET_PX`／`FADE_PX`）。
     *
     * ⚠️ `TURN_SPACING_PX` 是**固定間距**：刻度之間的距離與對話多長無關。
     * 第一版做成「按內容比例縮放」，6 輪就被拉成每 87px 一個（使用者：
     * 「間隔太遠了」）。
     */
    var TURN_SPACING_PX = 10
    var TURN_RAIL_INSET_PX = 6
    var TURN_FADE_PX = 24
    /** 條帶框高的上限（DSH 的 `height:min(…, 420px)`）。 */
    var TURN_RAIL_MAX_PX = 420
    /** 框高至少要比可用高度少這麼多（DSH 的 `calc(var(--turn-rail-band) - 64px)`）。 */
    var TURN_RAIL_BAND_GAP_PX = 64
    /**
     * 跳過去的時候，那一輪的開頭留在視窗頂端下面幾 px。
     *
     * ⚠️ **這個數字與「哪一輪是當前」的容差必須一致**：跳過去之後那一輪的開頭在
     * `scrollTop + 8`，如果容差只有 4，判定的結果會是**上一輪**——實測「點第 2 輪，
     * 跳過去了（scrollTop=233、錨點在 241），但刻度還亮在第 1 輪」。
     */
    var TURN_JUMP_GAP_PX = 8

    /**
     * 這一條刻度條帶要長什麼樣（**純函式**，所以測得到）。
     *
     * @param count - 有幾輪。
     * @param bandHeight - 可用高度（訊息區的可見高度）。
     * @param active - 當前是第幾輪（0 起算）。
     * @returns `{ height, offset, positions }`；`count < 2` 時回 `null`（不畫）。
     *
     * 三個數字的分工：
     *   - `positions[i]`＝第 i 個刻度在**條帶座標**裡的位置（固定間距）
     *   - `height`＝框高（條帶比框高的時候要夾住，多的靠 `offset` 滑動）
     *   - `offset`＝整條條帶往上推多少，讓**當前那一輪**留在框裡
     */
    function turnRailLayout(count, bandHeight, active) {
      if (count < 2) return null
      var strip = (count - 1) * TURN_SPACING_PX + TURN_RAIL_INSET_PX * 2
      var band = typeof bandHeight === 'number' && bandHeight > 0 ? bandHeight : strip
      var height = Math.min(strip, Math.max(0, band - TURN_RAIL_BAND_GAP_PX), TURN_RAIL_MAX_PX)
      var positions = []
      for (var i = 0; i < count; i += 1) positions.push(TURN_RAIL_INSET_PX + i * TURN_SPACING_PX)
      var offset = 0
      if (strip > height) {
        var markTop = positions[Math.max(0, Math.min(count - 1, active))]
        var viewTop = 0
        // 已經在框裡（離兩端都還有 FADE 的餘裕）就不動——DSH 也是這樣。
        var inside =
          markTop >= viewTop + TURN_FADE_PX && markTop <= viewTop + height - TURN_FADE_PX
        if (!inside) offset = Math.max(0, Math.min(markTop - height / 2, strip - height))
      }
      return { height: height, offset: offset, positions: positions }
    }

    /** `{min, max}` → `0～2`（給輸入框的 placeholder 用）。 */
    function rangeText(range) {
      return String(range.min) + '～' + String(range.max)
    }

    /**
     * 從 `tavern.json`（或 `room.json`）讀一個數字欄位給輸入框顯示。
     *
     * ⚠️ **`null`／`undefined` 要變成空字串**，不是 `"null"` 也不是 `0`：
     * 「沒有設定」在畫面上的意思就是「空的」，而那正是它的語意（不碰 DSH 的決定）。
     */
    function settingsNumber(settings, key) {
      var value = settings === null || settings === undefined ? null : settings[key]
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
    }

    /**
     * 輸入框的字 → 要送出去的 patch 值。
     *
     * 空字串送 **`null`**（＝清除／聽上一層），不是送 `''`：`null` 在 JSON 裡
     * 一眼就知道是「沒有值」，而空字串會讓人懷疑是不是打錯字。兩邊宿主都收，
     * 但送出去的那一份要能自己說明自己。
     */
    function samplerPatchValue(text) {
      if (typeof text === 'number') return text
      var raw = String(text === undefined || text === null ? '' : text).trim()
      if (raw === '') return null
      var num = Number(raw)
      return Number.isFinite(num) ? num : null
    }

    /**
     * 一個 `stop` 序列清單 → textarea 的文字（**一行一個**）。
     *
     * ⚠️ **刻意不在這裡做任何清理**（不 trim、不去空行、不去重）——那是宿主半
     * `normalizeStop()` 的事，而它必須是**唯一**一份。這一支只負責「讓人看得懂」：
     * 使用者要能一眼看出自己存了幾個、哪幾個，然後在**同一份文字**上改。
     *
     * 讀不到（`null`／壞值）⇒ 空字串，那正好是「沒有設定」在畫面上的樣子
     * （同 `settingsNumber` 對 `null` 的處置）。
     */
    function stopToText(value) {
      if (Array.isArray(value) === false) return ''
      var lines = []
      for (var i = 0; i < value.length; i += 1) {
        if (typeof value[i] === 'string') lines.push(value[i])
      }
      return lines.join('\n')
    }

    /**
     * textarea 的文字 → 要送出去的 patch 值。
     *
     * ⚠️ 送的是**一整段文字**，不是陣列：`lib/workspace.js` 的 `stopProblem()`／
     * `normalizeStop()` 收字串（一行一個）而且會負責拆行、trim、去空行與去重。
     * 客戶端自己先拆一份的結果，就是「面板預覽是一種拆法、實際送出是另一種」
     * ——這一輪刻意不要那條路。
     *
     * 空白 ⇒ `null`（＝清除／聽上一層），與 `samplerPatchValue` 同一條規矩。
     */
    function stopPatchValue(text) {
      var raw = String(text === undefined || text === null ? '' : text).trim()
      return raw === '' ? null : raw
    }

    /**
     * 一間房的 `stopEnabled` 三態 → 下拉選單的值。
     *
     * ⚠️ **`undefined`／`null` 都映射到 `'inherit'`（聽酒館的）**，而
     * `false` 映射到 `'off'`——這兩者**不可以混**：混了就會出現
     * 「我明明把這一間房關掉了，它還是在送內建的那幾串」。
     * `false` 在 JS 裡是 falsy，所以這裡一定要用 `=== false` 而不是 `!value`。
     */
    function roomStopState(room) {
      var value = room === null || room === undefined ? null : room.stopEnabled
      if (value === true) return 'on'
      if (value === false) return 'off'
      return 'inherit'
    }

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
     * 宿主半回來的錯誤 → **使用者看得懂、而且做得到的一句話**。
     *
     * ⚠️ **這一條是被真的踩出來的**（2.6.71）：`link:` 安裝時，**瀏覽器半改完
     * 重新整理頁面就生效，宿主半卻要重啟 `dsh web`**（路由表是載入時建立的常數）。
     * 所以「新前端 ＋ 舊宿主」是一個很常見的狀態，而它的症狀是：
     *
     *     讀不到內容：unknown op "worldbook.roomEntries"
     *
     * 那句話對使用者**沒有任何用處**——他不知道那是誰的問題、也不知道要做什麼。
     * `unknown op` 幾乎只有一個原因（插件改過、宿主還沒重載），所以直接說出來。
     *
     * ⚠️ 判斷字串而不是自己列一張 op 清單：清單會過期，而 `unknown op` 是宿主半
     * 自己講的話（`lib/index.js` 的路由表）。
     */
    function rpcErrorText(error) {
      var raw = error && error.error ? String(error.error) : String(error)
      if (raw.indexOf('unknown op') >= 0) {
        return (
          '⚠️ 宿主半沒有這個功能（' +
          raw +
          '）——**通常是改完插件還沒重啟 `dsh web`**。' +
          '重新整理頁面只會更新畫面那一半，功能那一半要重啟 `dsh web` 才會生效。'
        )
      }
      return raw === '' ? 'rpc failed' : raw
    }

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
              throw new Error(rpcErrorText(payload === null || payload === undefined ? 'rpc failed' : payload.error))
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
     * 從 frame 取出**這一輪的用量**（供應方回報的 `{type:'usage'}` chunk）。
     *
     * 為什麼需要它：`tokenUsage` 投影是**整份日誌**的累計，回答不了 DSH 那個對話框裡的
     * 「本輪用量」那一段。而串流裡本來就有供應方回報的這一則（`StreamChunk` 的
     * `usage` 變體），順手收下來就有。
     *
     * @returns `{inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, reasoningTokens?}`，或 `null`。
     */
    function usageOfFrame(frame) {
      if (frame === null || typeof frame !== 'object') return null
      if (frame.type !== 'chunk') return null
      var chunk = frame.chunk
      if (chunk === null || typeof chunk !== 'object') return null
      if (chunk.type !== 'usage') return null
      return chunk.usage !== null && typeof chunk.usage === 'object' ? chunk.usage : null
    }

    /**
     * 從快照的 `records` 撈出**這條路由是誰**（`{provider, model}`）。
     *
     * 為什麼要撈：DSH 那個對話框的「本輪用量」裡有一列 `提供方 / 模型`
     * （locale key `message.turnUsage.model`），值來自助理訊息的 `source`。酒館的
     * `.jsonl` 沒有那個欄位，但**開場快照的 `records` 是完整事件**——最後一則
     * `request/context` 就帶著 `provider` 與 `model`。
     *
     * 找不到就回 `null`（那一列就不出現，不要編）。
     *
     * @returns `{ provider, model }` 或 `null`。
     */
    function routeOfRecords(records) {
      if (!Array.isArray(records)) return null
      var found = null
      for (var i = 0; i < records.length; i += 1) {
        var one = records[i]
        if (one === null || typeof one !== 'object') continue
        if (one.type !== 'request/context') continue
        var data = one.data
        if (data === null || typeof data !== 'object') continue
        if (typeof data.provider === 'string' && typeof data.model === 'string') {
          // 取**最後一則**：換模型之後以最新的為準。
          found = { provider: data.provider, model: data.model }
        }
      }
      return found
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

    /* ------------------------- 解析設定與節點小工具 ------------------------- */

    /**
     * 預設的排版慣例（引號／括號）。
     *
     * ⚠️ **它必須宣告在使用它的地方之前**（`var` 的提升只提升宣告、不提升值）：
     * 這一份以前住在檔案後面，而 `activeParseConfig` 一搬上來就會在模組執行期
     * 讀到 `undefined.quotes`——症狀是**整個 client bundle 掛不起來**（白屏），
     * 而那正是 `test-client.mjs` 第一個抓到的東西。
     *
     * `quotes` 與 `parens` 都是**成對**的陣列——`wrappedBy()` 只認「整行被同一對
     * 包住」，不做巢狀或部分匹配（那正是猜錯的來源）。
     */
    var PARSE_DEFAULT_CONFIG = {
      quotes: [
        ['「', '」'],
        ['『', '』'],
        ['“', '”'],
        ['"', '"'],
      ],
      parens: [
        ['（', '）'],
        ['(', ')'],
      ],
      markers: [],
      defaultWho: '',
    }

    /**
     * 現在這一頁要用的解析設定（由對話頁在繪製時寫入）。
     *
     * ⚠️ **模組層級，不是 prop**：理由與 `currentZone`／`currentChat` 一樣
     * ——一次只有一個對話頁，而繪製是同步的。而 `renderMessage` 住在很深的地方
     * （訊息列 → 氣泡 → 正文），把它一路用 prop 傳下去要動六個元件。
     *
     * 預設值＝**只有排版慣例、沒有標記**：那正是 `render.json` 的 `plain` 模式，
     * 也正是 2.6.65 以前的行為。所以「還沒載入設定」與「使用者選 plain」
     * 在畫面上是同一件事（而那是對的）。
     */
    var activeParseConfig = { quotes: PARSE_DEFAULT_CONFIG.quotes, parens: PARSE_DEFAULT_CONFIG.parens, markers: [] }

    /**
     * 一份 `render.json` 的設定 → `parseMessage` 收的那個形狀。
     *
     * ⚠️ **這是 `lib/render.js` 的 `parseConfigFromRender()` 的鏡射**
     * （客戶端 bundle 沒有 ESM import），而它有一條**不能忘的規矩**：
     * **只有 `marked` 模式才把標記交給解析器。** 其他模式下標記是普通文字
     * ——模型在 `structured` 模式裡吐了 `<台詞>` 代表它走樣了，我們**應該看見**
     * 那些角括號（`unknown-tag` 也會回報它），不是默默畫成台詞。
     */
    function parseConfigFromRender(render, defaultWho) {
      var one = render !== null && render !== undefined && typeof render === 'object' ? render : {}
      var mode = RENDER_MODES.indexOf(one.mode) >= 0 ? one.mode : 'plain'
      return {
        quotes: Array.isArray(one.quotes) && one.quotes.length > 0 ? one.quotes : PARSE_DEFAULT_CONFIG.quotes,
        parens: Array.isArray(one.parens) && one.parens.length > 0 ? one.parens : PARSE_DEFAULT_CONFIG.parens,
        markers: mode === 'marked' && Array.isArray(one.markers) ? one.markers : [],
        defaultWho: typeof defaultWho === 'string' ? defaultWho : '',
        // ⚠️ 這一格不是給 `parseMessage` 的（它不認得），是給 `choicesNode` 的。
        choicesClickable: one.choicesClickable === true,
      }
    }

    /**
     * 一列資料（`key: value`）。
     *
     * ⚠️ **值是有單位的數字時多畫一條進度條**（`progressOf`），其餘只畫文字。
     * 判斷刻意嚴格：把「時間: 晚上 11:30」畫成一條進度條會讓整個區塊看起來像壞掉
     * ——**猜錯比不畫更糟**，所以只認 `62%` 與 `3/10` 這兩種形狀。
     */
    function dataRowNode(one, key) {
      var bar = progressOf(one.value)
      var kids = [
        React.createElement('span', { className: 'dsh-tv-dataKey' }, one.key),
        React.createElement('span', { className: 'dsh-tv-dataValue' }, one.value),
      ]
      if (bar !== null) {
        kids.push(
          React.createElement(
            'span',
            { className: 'dsh-tv-dataBar', key: 'bar' },
            React.createElement('i', {
              className: 'dsh-tv-dataBarFill',
              style: { width: String(Math.round(bar.percent * 10) / 10) + '%' },
            }),
          ),
        )
      }
      return React.createElement('div', { key: 'r' + String(key), className: 'dsh-tv-dataRow' }, kids)
    }

    /**
     * `choices` 節點 → 一排可選項。
     *
     * ⚠️ **預設不能點**（`choicesClickable`）：點了要把文字填進輸入框，而那是
     * 一個**副作用**——萬一模型的「選項」其實是它自己編的劇情大綱，使用者會
     * 莫名其妙被塞一段草稿進輸入框。要開的人自己開（`render.json`）。
     *
     * 不能點的時候畫成純文字（不是畫成按鈕卻沒反應——那是欺騙性的 UI）。
     */
    function choicesNode(node, key, cfg) {
      var items = parseChoices(node.text)
      if (items.length === 0) {
        return React.createElement('span', { key: 's' + String(key), className: 'dsh-tv-choices' }, node.text)
      }
      var clickable = cfg !== null && cfg !== undefined && cfg.choicesClickable === true
      return React.createElement(
        'div',
        { key: 'c' + String(key), className: 'dsh-tv-choices' },
        items.map(function (item, at) {
          if (!clickable) {
            return React.createElement(
              'div',
              { key: 'i' + String(at), className: 'dsh-tv-choiceFlat' },
              '・' + item,
            )
          }
          return React.createElement(
            'button',
            {
              key: 'i' + String(at),
              type: 'button',
              className: 'dsh-tv-choice',
              title: '填進輸入框（不會直接送出）',
              onClick: function () {
                // ⚠️ **只填不送**：使用者要能在送出去之前改（`docs/plan.md` 的決定）。
                //    真的送出去是不可逆的（那一則會進 .jsonl）。
                fillChatDraft(item)
              },
            },
            item,
          )
        }),
      )
    }

    /**
     * 把文字填進對話頁的輸入框。
     *
     * ⚠️ 這裡是**唯一**一個從「訊息內容」反向寫進輸入框的地方，所以它刻意很小：
     * 找得到那一格就填＋聚焦，找不到就什麼都不做（不可以丟錯——那是繪製路徑）。
     * 用 `document.querySelector` 而不是把 ref 傳進來：選項住在很深的地方，
     * 而輸入框只有一個（`aria-label` 是穩定的錨點）。
     */
    function fillChatDraft(text) {
      try {
        var box = document.querySelector('[aria-label="訊息"]')
        if (box === null || box === undefined) return
        box.value = text
        // ⚠️ React 控制的輸入框**不認**直接改 `.value`——要自己送一次 input 事件，
        // 不然畫面上的 React state 還是舊的，下一次重繪就把我們填的字蓋回去。
        // （這一招是 DOM 的標準做法，不是 React 的私有 API。）
        if (typeof Event === 'function') box.dispatchEvent(new Event('input', { bubbles: true }))
        if (typeof box.focus === 'function') box.focus()
      } catch (error) {
        /* 填不進去就算了——那是加分項，不該讓一則訊息畫不出來 */
      }
    }

    /**
     * `data` 那一行的 `rows` 欄位 → 節點用的列。
     *
     * 兩種寫法都收，因為兩種都自然：
     *   - `[{"key":"好感度","value":"62%"}]`（最精確，也是指令裡教的）
     *   - `["好感度: 62%"]`（模型很愛偷懶成字串陣列）→ 走 `parseDataRows` 拆
     *
     * @returns `[{ key, value }]` 或 `null`（不是合法的資料列）。
     */
    function structuredRows(value) {
      if (Array.isArray(value) === false || value.length === 0) return null
      var out = []
      for (var i = 0; i < value.length; i += 1) {
        var one = value[i]
        if (typeof one === 'string') {
          var parsed = parseDataRows(one)
          if (parsed === null) return null
          out = out.concat(parsed)
          continue
        }
        if (one === null || typeof one !== 'object' || Array.isArray(one)) return null
        var key = typeof one.key === 'string' ? one.key.trim() : ''
        // ⚠️ 值可以是數字（`"value": 62`）——那是最自然的寫法之一，硬要字串
        //    會讓「好感度 62」那一行整條被丟掉。畫面上它會變成沒有進度條的文字
        //    （`progressOf` 不認沒有單位的數字，那是刻意的）。
        var text = typeof one.value === 'string' ? one.value : typeof one.value === 'number' ? String(one.value) : ''
        if (key === '' || text === '') return null
        out.push({ key: key, value: text })
      }
      return out.length > 0 ? out : null
    }

    /**
     * `choices` 那一行的 `items` 欄位 → 可選項清單。
     *
     * @returns `string[]` 或 `null`（不是合法的選項清單）。
     */
    function structuredItems(value) {
      if (Array.isArray(value) === false || value.length === 0) return null
      var out = []
      for (var i = 0; i < value.length; i += 1) {
        if (typeof value[i] !== 'string') return null
        var item = value[i].trim()
        if (item === '') return null
        if (out.indexOf(item) < 0) out.push(item)
      }
      return out.length > 0 ? out : null
    }

    /**
     * 一個 `key: value` 的值 → 進度條的百分比，或 `null`（不畫）。
     *
     * ⚠️ **這是 `lib/render.js` 的 `progressOf()` 的鏡射**（客戶端 bundle 沒有
     * ESM import）。兩份必須一字不差——`test-client.mjs` 會拿兩邊對照。
     */
    function progressOf(value) {
      var text = String(value === null || value === undefined ? '' : value).trim()
      if (text === '') return null
      var percent = /^(-?\d+(?:\.\d+)?)\s*[%％]$/.exec(text)
      if (percent !== null) {
        var num = Number(percent[1])
        if (Number.isFinite(num) === false) return null
        return { percent: Math.max(0, Math.min(100, num)), label: text }
      }
      var fraction = /^(-?\d+(?:\.\d+)?)\s*[\/／]\s*(\d+(?:\.\d+)?)$/.exec(text)
      if (fraction !== null) {
        var top = Number(fraction[1])
        var total = Number(fraction[2])
        if (Number.isFinite(top) === false || Number.isFinite(total) === false) return null
        if (total <= 0) return null
        return { percent: Math.max(0, Math.min(100, (top / total) * 100)), label: text }
      }
      return null
    }

    /**
     * `choices` 區塊的原文 → 可選項清單。
     *
     * ⚠️ **同樣是 `lib/render.js` 的 `parseChoices()` 的鏡射**。
     * ⚠️ **刻意不切逗號**：中文的選項裡有逗號是常態（「去酒窖，順便拿燈」），
     * 切了會把一個選項變成兩個，而使用者只會覺得「它把我的選項弄斷了」。
     */
    function parseChoices(text) {
      // ⚠️ 同 `parseDataRows()`：字面上的 `\n`（JSON 的轉義）也是行分隔。
      var lines = String(text === null || text === undefined ? '' : text).split(/\n|\\n/)
      var out = []
      for (var i = 0; i < lines.length; i += 1) {
        var line = lines[i]
          .trim()
          .replace(/^[-*・]\s*/, '')
          .replace(/^\d+[.、)]\s*/, '')
          .trim()
        if (line === '') continue
        if (out.indexOf(line) >= 0) continue
        out.push(line)
      }
      return out
    }

    /**
     * 一則訊息 → 元素：**節點樹 → 畫面**。
     *
     * 三件事：`para` 分組（同一行的片段放進同一個區塊）、`kind` 上 class
     * （外觀由 `custom.css` 決定）、`rows`／`choices` 各自畫成自己的樣子。
     *
     * ⚠️ 這裡**不再看文字**——所有判斷都在 `parseMessage`。畫面與解析分開，
     * 所以換規則不會動到這裡，而語音、統計也讀同一棵樹。
     *
     * ⚠️ **解析設定（`activeParseConfig`）是模組層級的**，由對話頁在繪製時寫入。
     * 理由同 `currentZone`／`currentChat`：一次只有一個對話頁，而繪製是同步的。
     * 測試可以明確傳一份進來（`renderMessage(text, who, config)`），
     * 那條路是為了**不必碰模組狀態就能驗**，正式路徑走模組那一格。
     */
    function renderMessage(text, who, config) {
      var cfg = config === undefined ? activeParseConfig : config
      var parsed = parseMessage(text, {
        quotes: cfg.quotes,
        parens: cfg.parens,
        markers: cfg.markers,
        defaultWho: who,
      })
      var groups = []
      var current = null
      for (var i = 0; i < parsed.nodes.length; i += 1) {
        var node = parsed.nodes[i]
        if (current === null || node.para !== current.para) {
          current = { para: node.para, nodes: [] }
          groups.push(current)
        }
        current.nodes.push(node)
      }
      return groups.map(function (group, index) {
        return React.createElement(
          'div',
          { key: 'p' + String(index), className: 'dsh-tv-para' },
          group.nodes.map(function (node, at) {
            if (node.kind === 'blank') return React.createElement('div', { key: 'b' + String(at) }, ' ')
            if (Array.isArray(node.rows)) {
              return React.createElement(
                'div',
                { key: 'd' + String(at), className: 'dsh-tv-data' },
                node.rows.map(function (one, k) {
                  return dataRowNode(one, k)
                }),
              )
            }
            if (node.kind === 'choices') return choicesNode(node, at, cfg)
            // ⚠️ 標記區塊的內容是**多行**的，而一顆 `<span>` 留不住換行。
            // 以前所有節點都畫成 span，所以 `<面板>` 裡的內容會擠成一行
            // ——症狀是「標記設對了，但排版全亂」。多行的用 `div` ＋ `white-space:pre-wrap`。
            var multiline = node.text.indexOf('\n') >= 0
            return React.createElement(
              multiline ? 'div' : 'span',
              { key: 's' + String(at), className: 'dsh-tv-' + node.kind },
              node.text,
            )
          }),
        )
      })
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

    /* ---------------------- 顯示層：原文 → 節點樹 ---------------------- */

    /**
     * 這個字元位置在第幾行（從 1 算起）。**給人看的**——人報問題講行號，不講 offset。
     */
    function lineOf(text, at) {
      var limit = typeof at === 'number' && at > 0 ? Math.min(at, text.length) : 0
      var line = 1
      for (var i = 0; i < limit; i += 1) {
        if (text.charAt(i) === '\n') line += 1
      }
      return line
    }

    /**
     * 一條檢查結果。**兩層、兩級**——那是修復層的眼睛。
     *
     * `layer`：
     *   - `format`（語法）：標記有沒有成對、屬性引號對不對 → **大部分可以在本地修**
     *   - `schema`（詞彙）：標記名有沒有宣告、內容符不符合約定 → **這個才需要模型或規則**
     *
     * `severity`：
     *   - `fatal`：會影響後面的解析（例如未閉合會把後面吃進來）→ 值得修
     *   - `acceptable`：已經降級處理，不修也看得下去（未知標記當文字、孤兒收尾）
     *
     * 不分級的話修復會每一輪都跑（貴又慢），而你本來只是多了一個空格。
     */
    function makeProblem(layer, severity, kind, line, extra) {
      var one = { layer: layer, severity: severity, kind: kind, line: line }
      if (extra !== undefined && extra !== null) {
        for (var key in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, key)) one[key] = extra[key]
        }
      }
      return one
    }

    /**
     * 格式層：孤兒收尾標記（`</名字>` 沒有對應的開頭）。
     *
     * 已降級處理（當普通文字），所以是 `acceptable`——但它**要回報**：
     * 孤兒收尾通常代表前面那一段被別的東西吃掉了，那是走樣的第一個線索。
     */
    function reportOrphanCloses(text, cfg, problems, baseOffset, raw) {
      var base = typeof baseOffset === 'number' ? baseOffset : 0
      for (var i = 0; i < cfg.markers.length; i += 1) {
        var one = cfg.markers[i]
        if (one === null || typeof one !== 'object' || typeof one.tag !== 'string' || one.tag === '') continue
        var at = text.indexOf('</' + one.tag + '>')
        if (at < 0) continue
        problems.push(
          makeProblem('format', 'acceptable', 'orphan-close', lineOf(raw, base + at), {
            tag: one.tag,
            at: base + at,
          }),
        )
      }
    }

    /**
     * 詞彙層：**用了但沒有宣告**的標記。
     *
     * 這是走樣偵測的主力。模型最常見的錯不是語法壞，是**用了別的名字**
     * （打錯、換了寫法、記成別張卡的寫法）。沒有這一條，那些標記會靜靜地變成
     * 文字，而使用者只會覺得「卡片怎麼不見了」。
     */
    function reportUnknownTags(raw, cfg, problems) {
      var declared = {}
      for (var i = 0; i < cfg.markers.length; i += 1) {
        var one = cfg.markers[i]
        if (one !== null && typeof one === 'object' && typeof one.tag === 'string') declared[one.tag] = true
      }
      var seen = {}
      // ⚠️ 只認「開頭標籤」（`<名字>` 或 `<名字 屬性>`），**不要求成對**。
      // 第一版寫成「成對」比對，結果一個已宣告但未閉合的標記會把它後面的東西
      // 全部吃進同一個 match 裡——那些未宣告的標記就再也不會被看見（實測踩到）。
      var re = /<([A-Za-z\u4e00-\u9fff][\w\u4e00-\u9fff-]*)(\s[^>]*)?>/g
      var match = re.exec(raw)
      while (match !== null) {
        var name = match[1]
        if (declared[name] !== true && seen[name] !== true) {
          seen[name] = true
          problems.push(
            makeProblem('schema', 'acceptable', 'unknown-tag', lineOf(raw, match.index), { tag: name }),
          )
        }
        match = re.exec(raw)
      }
    }

    /** 模型可以自己指定的 kind（＝ §2 那份清單；不認得的當旁白並回報）。 */
    var PARSE_KINDS = ['speech', 'narration', 'action', 'thought', 'panel', 'data', 'title', 'choices', 'note']

    /**
     * 一行**結構化回覆** → 節點。這是 B 方案（模型直接吐結構）的入口。
     *
     * 模型只給三件：`kind`、`who`（可省略）、`text`。
     * `source`／`para`／`rows` 由**後處理**填——那三件它不需要知道，也不該知道。
     *
     * ⚠️ **一行一個物件**，不是一個大陣列。三個理由：
     *   1. 一行壞掉**只損失那一行**（大陣列是結構性的：少一個括號整包不合法）
     *   2. **修復的單位就是那一行**——「只送壞掉的那一段」才做得到
     *   3. 串流時**一行完成就能畫**，不必等整包收完
     *
     * 回傳三種：
     *   - `null`：**不是**結構化的一行 → 呼叫端走推斷
     *   - `{ broken: true, text }`：看得出來**想**吐結構但壞了 → 呼叫端**不可以**跑推斷
     *   - `{ node }`：成功
     *
     * ⚠️ 第三種那個「不可以跑推斷」很重要：JSON 行裡的引號是**語法**，不是台詞。
     * 實測踩過——一行少了大括號的 JSON 被推斷層碎成十幾個片段
     * （`{`、`"kind"`、`:`…），那比壞掉本身更難看。
     */
    function parseStructuredLine(line, cfg, problems, sourceLine) {
      var trimmed = typeof line === 'string' ? line.trim() : ''
      if (trimmed.length < 2) return null
      // 只認「開頭是 {」——判斷「是不是想吐結構」看開頭就夠了，
      // 不能要求結尾也是 `}`（那正是最常見的壞法：少了大括號）。
      if (trimmed.charAt(0) !== '{') return null

      var parsed = null
      try {
        parsed = JSON.parse(trimmed)
      } catch (error) {
        problems.push(makeProblem('format', 'fatal', 'bad-json', sourceLine, {}))
        return { broken: true, text: trimmed }
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        problems.push(makeProblem('format', 'fatal', 'bad-shape', sourceLine, {}))
        return { broken: true, text: trimmed }
      }
      // 壞掉時**盡量把 text 救回來**——讓讀者看到那句話，而不是一堆 JSON 符號。
      var salvage = typeof parsed.text === 'string' ? trimBlockText(parsed.text) : trimmed

      // 第二層（詞彙）
      var kind = typeof parsed.kind === 'string' ? parsed.kind.trim() : ''
      if (kind === '') {
        problems.push(makeProblem('schema', 'fatal', 'missing-kind', sourceLine, { text: salvage }))
        return { broken: true, text: salvage }
      }
      if (PARSE_KINDS.indexOf(kind) < 0) {
        problems.push(makeProblem('schema', 'acceptable', 'unknown-kind', sourceLine, { value: kind, text: salvage }))
        kind = 'narration'
      }

      /**
       * ⚠️ **`data`／`choices` 的內容不一定住在 `rows`／`items`。**
       *
       * 2.6.65 之前這裡是「沒有 `text` 就是 `missing-text`（fatal）」，所以
       * **`data`／`choices` 這兩行永遠解析不了**——它們的內容住在別的名字裡。
       *
       * 第一版修法是「認 `rows`／`items`」，但那**只認了一種寫法**，而實測
       * 使用者自己的世界書（`輸出格式.json`）教的是另一種：
       *
       *     {"kind":"data","text":"時間：晚上十一點\n心情：疲倦"}
       *
       * ——model 有兩種同樣自然的寫法，而我們兩種都要收。所以順序是：
       *
       *   1. `rows`／`items`（最精確，也是我們指令裡教的）
       *   2. **`text` 拆出來的**（世界書教的舊寫法，也是模型最容易寫的）
       *   3. 兩個都不成形狀 ⇒ 才降級（`missing-rows`／`missing-items`）
       *
       * ⚠️ 第 2 條之所以可行，是因為 `parseDataRows()` 現在**同時認真的換行與
       * 字面上的 `\n`**——JSON 的多行只能是轉義，所以那個 `\n` 是兩個字元。
       * 少了那一條，使用者的世界書在畫面上永遠是一行夾著看得見的 `\n` 的旁白。
       */
      var rows = null
      var items = null
      if (kind === 'data') {
        rows = structuredRows(parsed.rows)
        if (rows === null) rows = parseDataRows(parsed.text)
        if (rows === null) {
          problems.push(makeProblem('schema', 'fatal', 'missing-rows', sourceLine, { text: salvage }))
          return { broken: true, text: salvage }
        }
      } else if (kind === 'choices') {
        items = structuredItems(parsed.items)
        if (items === null) {
          // `parseChoices` 永遠回陣列（可能是空的），所以「有東西」才算成形狀。
          var fromText = typeof parsed.text === 'string' ? parseChoices(parsed.text) : []
          items = fromText.length > 0 ? fromText : null
        }
        if (items === null) {
          problems.push(makeProblem('schema', 'fatal', 'missing-items', sourceLine, { text: salvage }))
          return { broken: true, text: salvage }
        }
      } else if (typeof parsed.text !== 'string') {
        problems.push(makeProblem('format', 'fatal', 'missing-text', sourceLine, {}))
        return { broken: true, text: salvage }
      }

      var extra = []
      for (var key in parsed) {
        if (Object.prototype.hasOwnProperty.call(parsed, key) && key !== 'kind' && key !== 'who' && key !== 'text') {
          // `rows`／`items` 是**認得的**欄位（上面剛用過），不要當成走樣的證據。
          if (key === 'rows' || key === 'items') continue
          // 「相關但多餘」的欄位（語音要用的，或模型自己發明的）——留著，
          // 但**逐一分開回報**：`voice/volume` 比 `voice` 好查。
          for (var piece of String(key).split('/')) extra.push(piece)
        }
      }
      if (extra.length > 0) {
        problems.push(makeProblem('schema', 'acceptable', 'unknown-key', sourceLine, { value: extra.join('/') }))
      }

      /**
       * 節點的 `text`：
       *   - 有 `text` 就用它
       *   - `data` ⇒ 從 rows 接回 `key: value`（**這一招很重要**：不改 `text` 的
       *     語意（§8）就讓「不懂 rows 的消費者」照樣畫得出東西——漸進增強）
       *   - `choices` ⇒ 一行一個（`parseChoices` 讀得懂的那個形狀）
       */
      var nodeText = typeof parsed.text === 'string' ? trimBlockText(parsed.text) : ''
      if (kind === 'data' && nodeText === '') {
        nodeText = rows
          .map(function (one) {
            return one.key + ': ' + one.value
          })
          .join('\n')
      }
      if (kind === 'choices' && nodeText === '') nodeText = items.join('\n')

      return {
        node: {
          kind: kind,
          source: 'given',
          who: typeof parsed.who === 'string' && parsed.who !== '' ? parsed.who : cfg.defaultWho,
          text: nodeText,
          // 資料區塊的列（`data` 那一條走上面那一支填好了；其餘照舊推斷）。
          rows: rows !== null ? rows : parseDataRows(nodeText),
        },
      }
    }

    /** 兩個字串的編輯距離（給「打錯的 kind」做模糊比對用，很短）。 */
    function editDistance(a, b) {
      var prev = []
      var j
      for (j = 0; j <= b.length; j += 1) prev[j] = j
      for (var i = 1; i <= a.length; i += 1) {
        var cur = [i]
        for (j = 1; j <= b.length; j += 1) {
          var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1
          cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
        }
        prev = cur
      }
      return prev[b.length]
    }

    /**
     * 打錯的 kind → 最接近的合法 kind（距離 ≤ 2 才算）。
     *
     * 這是**本地**的修復：`speach` → `speech` 不需要問模型。
     * 距離太遠就回 `null`（交給推斷或降級成旁白）——猜太遠比不猜更糟。
     */
    function nearestKind(value) {
      var text = typeof value === 'string' ? value.trim().toLowerCase() : ''
      if (text === '') return null
      var best = null
      for (var i = 0; i < PARSE_KINDS.length; i += 1) {
        var distance = editDistance(text, PARSE_KINDS[i])
        if (best === null || distance < best.distance) best = { kind: PARSE_KINDS[i], distance: distance }
      }
      return best !== null && best.distance <= 2 ? best.kind : null
    }

    /**
     * 從文字反推 kind——**用在「模型忘了給 kind」的時候**。
     *
     * 這正好是推斷層的用途：`「…」` 是台詞、`（…）` 是動作、其餘是旁白。
     * 所以「缺 kind」不需要問模型，本地就補得回來。
     */
    function inferKindOfText(text, cfg) {
      var spans = inferLine(text, cfg === undefined ? parseConfigOf(undefined) : cfg, undefined, 0)
      return spans.length === 1 ? spans[0].kind : 'narration'
    }

    /**
     * 試著把一行壞掉的 JSON 補回來（**機械式**：少的只可能是收尾的字元）。
     *
     * 依序試「補 `}`」「補 `"}`」……（長度 1–3 的所有組合）。
     * 這涵蓋實測最常見的兩種：少收尾大括號、少收尾引號＋大括號。
     */
    function repairJsonLine(line) {
      var candidates = ['', '"', '}', '"}', '"}}', '"}"', '}}"', '}}', '"]}', '"}]']
      for (var i = 0; i < candidates.length; i += 1) {
        var attempt = line + candidates[i]
        try {
          var parsed = JSON.parse(attempt.trim())
          if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed) === false) {
            return { text: attempt.trim(), added: candidates[i] }
          }
        } catch (error) {
          // 試下一個
        }
      }
      return null
    }

    /** 把一行 JSON 的 `kind` 換掉，**其餘欄位原樣保留**（本地修復用）。 */
    function putKind(line, kind) {
      if (typeof kind !== 'string' || kind === '') return null
      try {
        var parsed = JSON.parse(String(line).trim())
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        parsed.kind = kind
        return JSON.stringify(parsed)
      } catch (error) {
        return null
      }
    }

    /**
     * **第一層（格式）的本地修復**——不需要模型、機械式的那幾種。
     *
     * ⚠️ **只修 `format` 層，而且只修「機械式」的**：
     *   - `bad-json`：補上少的收尾字元
     *   - `unclosed-quote`：補上對應的收尾引號
     *   - `orphan-close`：把孤兒收尾標記刪掉
     *
     * 不修 `schema` 層（「`speach` 是不是你想用的字」只有你或模型知道），
     * 也不修 `unclosed`（多行的標記要塞在哪裡是一個判斷，不是機械替換）。
     *
     * @returns `{ text, log, deferred }`——`deferred` 是「本地修不了、要交給模型」的那些。
     */
    function repairMessage(text, problems, config) {
      var cfg = parseConfigOf(config)
      var lines = String(text === null || text === undefined ? '' : text).split('\n')
      var log = []
      var deferred = []
      var list = Array.isArray(problems) ? problems : []
      for (var i = 0; i < list.length; i += 1) {
        var one = list[i]
        var at = one.line - 1
        if (at < 0 || at >= lines.length) continue
        var before = lines[at]
        var after = null
        var action = ''
        if (one.kind === 'bad-json') {
          var fixed = repairJsonLine(before)
          if (fixed !== null) {
            after = fixed.text
            action = '在行尾補上 ' + JSON.stringify(fixed.added)
          }
        } else if (one.kind === 'unclosed-quote' && typeof one.close === 'string') {
          after = before + one.close
          action = '在行尾補上收尾的 ' + one.close
        } else if (one.kind === 'orphan-close' && typeof one.tag === 'string') {
          after = before.split('</' + one.tag + '>').join('')
          action = '刪掉沒有開頭的 </' + one.tag + '>'
        } else if (one.kind === 'unknown-kind' || one.kind === 'missing-kind') {
          // 第二層的**本地**修復：打錯的模糊比對、缺的用推斷反推——都不需要模型。
          var guess = one.kind === 'unknown-kind' ? nearestKind(one.value) : null
          var how = '模糊比對'
          if (guess === null) {
            guess = inferKindOfText(typeof one.text === 'string' ? one.text : '', cfg)
            how = '用推斷反推'
          }
          var rewritten = putKind(before, guess)
          if (rewritten !== null) {
            after = rewritten
            action = how + '成 ' + JSON.stringify(guess)
          }
        }
        if (after === null || after === before) {
          // ⚠️ 只有「**致命**的、又修不了的」才需要交出去。
          // `acceptable` 的那些本來就降級處理過了，不需要修，也不該佔用模型的呼叫。
          if (one.severity === 'fatal') deferred.push(one)
          continue
        }
        lines[at] = after
        log.push({ line: one.line, layer: one.layer, kind: one.kind, action: action, before: before, after: after })
      }
      return { text: lines.join('\n'), log: log, deferred: deferred }
    }

    /**
     * 解析一則訊息，回傳**節點樹**。
     *
     * 為什麼要有這一層（而不是直接把文字畫出來）：台詞／旁白／動作是**語意**，
     * 畫面、語音、統計、翻譯、匯出全部要吃同一份語意。有了節點樹，那些消費者
     * 都是讀欄位，不必各自再從文字（或 HTML 字串）裡猜一次。
     *
     * ⚠️ **模型不吐 HTML、不吐 JSON**：它寫的還是普通小說，這一層負責讀懂它。
     * 所以「模型走樣」時最壞的情況只是退回純文字，不會整個畫面壞掉。
     *
     * ⚠️ **解析只發生在渲染期**：`.jsonl` 永遠存原文，所以改規則＝歷史訊息
     * 一起重畫（那是資料與呈現分離的意思）。
     *
     * 兩層，順序不能換：
     *   1. **標記**（使用者宣告的，精確）——先切出區塊
     *   2. **排版慣例**（引號＝台詞、括號＝動作、其餘＝旁白）——其餘逐行推斷
     *
     * 第 2 層**不需要模型配合**（那是中文小說的排版，模型本來就這樣寫），
     * 所以它是唯一不會隨對話變長而退化的那一層。
     *
     * @param text - 訊息原文。
     * @param config - `{ quotes, parens, markers, defaultWho }`，全部可省略。
     * @returns `{ nodes, problems }`。
     *   `problems` 是**兩層**的檢查結果（格式／詞彙），每一條都帶位置——
     *   那是「修復層」的眼睛：知道壞在哪一段、哪一種壞，才不必整包重送。
     */
    function parseMessage(text, config) {
      var raw = typeof text === 'string' ? text : ''
      var cfg = parseConfigOf(config)
      var problems = []
      if (raw === '') return { nodes: [], problems: problems }

      // ① 標記區塊（見 `parseMarkedRegions`）：已宣告的標記先切出來。
      var pieces = parseMarkedRegions(raw, cfg, problems)

      // ② 其餘的文字逐行推斷，**一行可以切成多個片段**。
      var nodes = []
      var lineNo = -1
      for (var i = 0; i < pieces.length; i += 1) {
        var piece = pieces[i]
        if (piece.marked === true) {
          lineNo += 1
          nodes.push({
            kind: piece.kind,
            source: 'marked',
            tag: piece.tag,
            who: piece.who,
            text: piece.text,
            // 資料區塊（`key: value` 全部符合時才有）——沒有就是 `null`，
            // 渲染端據此決定畫表格還是畫文字。
            rows: piece.rows === undefined ? null : piece.rows,
            para: lineNo,
          })
          continue
        }
        // 孤兒收尾標記（格式層）：開頭沒被找到，收尾留在文字裡。
        reportOrphanCloses(piece.text, cfg, problems, piece.at, raw)
        var lines = piece.text.split('\n')
        // ⚠️ 行號要用**原文的行號**，不是「第幾個節點」——修復層要拿它去原文定位，
        // 而一個多行的標記區塊只佔一個節點，兩者會越差越多（實測：報 19、實際 16）。
        var offset = typeof piece.at === 'number' ? piece.at : 0
        for (var j = 0; j < lines.length; j += 1) {
          lineNo += 1
          var sourceLine = lineOf(raw, offset)
          // 先問「這一行是結構化回覆嗎」——是就走 B，不是就走推斷（安全網）。
          var attempt = parseStructuredLine(lines[j], cfg, problems, sourceLine)
          var spans
          if (attempt === null) {
            spans = inferLine(lines[j], cfg, problems, sourceLine)
          } else if (attempt.broken === true) {
            // ⚠️ **不跑推斷**：這一行的引號是 JSON 語法，不是台詞。
            spans = [
              { kind: 'narration', source: 'plain', who: cfg.defaultWho, text: attempt.text },
            ]
          } else {
            spans = [attempt.node]
          }
          for (var k = 0; k < spans.length; k += 1) {
            spans[k].para = lineNo
            nodes.push(spans[k])
          }
          offset += lines[j].length + 1
        }
      }

      // ③ 詞彙層：用了但沒有宣告的標記（走樣偵測的主力）。
      reportUnknownTags(raw, cfg, problems)
      problems.sort(function (a, b) {
        return a.line - b.line
      })
      return { nodes: nodes, problems: problems }
    }

    /** 把使用者給的設定補成完整的一份（**缺什麼就用預設**，不要讓它半殘）。 */
    function parseConfigOf(config) {
      var given = config !== null && config !== undefined && typeof config === 'object' ? config : {}
      return {
        quotes: Array.isArray(given.quotes) && given.quotes.length > 0 ? given.quotes : PARSE_DEFAULT_CONFIG.quotes,
        parens: Array.isArray(given.parens) && given.parens.length > 0 ? given.parens : PARSE_DEFAULT_CONFIG.parens,
        markers: Array.isArray(given.markers) ? given.markers : [],
        defaultWho: typeof given.defaultWho === 'string' ? given.defaultWho : '',
      }
    }

    /**
     * 找下一個出現的「開頭符號」（引號或括號），回傳它與對應的結尾符號。
     *
     * 回傳 `{ at, open, close, kind }`；找不到回 `null`。
     */
    function findWrappedAt(text, from, cfg) {
      var groups = [
        { pairs: cfg.quotes, kind: 'speech' },
        { pairs: cfg.parens, kind: 'action' },
      ]
      var best = null
      for (var g = 0; g < groups.length; g += 1) {
        var pairs = groups[g].pairs
        for (var i = 0; i < pairs.length; i += 1) {
          var pair = pairs[i]
          if (!Array.isArray(pair) || pair.length < 2) continue
          var open = typeof pair[0] === 'string' ? pair[0] : ''
          var close = typeof pair[1] === 'string' ? pair[1] : ''
          if (open === '' || close === '') continue
          var at = text.indexOf(open, from)
          if (at < 0) continue
          if (best === null || at < best.at) best = { at: at, open: open, close: close, kind: groups[g].kind }
        }
      }
      return best
    }

    /**
     * 一行 → 一個或多個節點。
     *
     * ⚠️ **一行不一定是同一種東西。** 真實的寫法是
     * 「台詞」＋旁白＋「台詞」擠在同一行（實測在使用者的對話裡就佔三分之一），
     * 整行判成一種的話，語音會把旁白也唸出來。所以逐段掃描：
     * 引號包住的＝台詞、括號包住的＝動作、其餘＝旁白。
     *
     * 每一段都帶 `line`（同一行的片段共用同一個編號），渲染端據此把同一行
     * 放進同一個區塊——**消費者不必自己分組**。
     *
     * 沒有收尾符號時（模型很常漏）＝**吃到行尾**並記 warning：寧可多認一段台詞，
     * 也不要讓整段文字消失。
     */
    function inferLine(line, cfg, problems, sourceLine) {
      var trimmed = typeof line === 'string' ? line.trim() : ''
      if (trimmed === '') return [{ kind: 'blank', source: 'plain', who: '', text: '' }]
      var out = []
      var cursor = 0
      while (cursor < trimmed.length) {
        var found = findWrappedAt(trimmed, cursor, cfg)
        if (found === null) break
        if (found.at > cursor) {
          out.push({ kind: 'narration', source: 'plain', who: cfg.defaultWho, text: trimmed.slice(cursor, found.at) })
        }
        var closeAt = trimmed.indexOf(found.close, found.at + found.open.length)
        if (closeAt < 0) {
          if (problems !== undefined) {
            problems.push(
              makeProblem(
                'format',
                'acceptable',
                'unclosed-quote',
                typeof sourceLine === 'number' ? sourceLine : 0,
                { quote: found.open, close: found.close },
              ),
            )
          }
          out.push({ kind: found.kind, source: 'quoted', who: cfg.defaultWho, text: trimmed.slice(found.at) })
          cursor = trimmed.length
          break
        }
        // 空的一對（`「」`）＝雜訊，不是空台詞——給它一個空台詞只會畫出一個空氣泡。
        if (closeAt === found.at + found.open.length) {
          out.push({
            kind: 'narration',
            source: 'plain',
            who: cfg.defaultWho,
            text: trimmed.slice(found.at, closeAt + found.close.length),
          })
          cursor = closeAt + found.close.length
          continue
        }
        out.push({
          kind: found.kind,
          source: 'quoted',
          who: cfg.defaultWho,
          text: trimmed.slice(found.at, closeAt + found.close.length),
        })
        cursor = closeAt + found.close.length
      }
      if (cursor < trimmed.length) {
        out.push({ kind: 'narration', source: 'plain', who: cfg.defaultWho, text: trimmed.slice(cursor) })
      }
      if (out.length === 0) {
        out.push({ kind: 'narration', source: 'plain', who: cfg.defaultWho, text: trimmed })
      }
      return out
    }

    /**
     * 區塊內容 → `key: value` 的列。
     *
     * 這是「資料」那一半（跟敘事的推斷分開）：
     *   - 敘事的格式要**鬆**——壞掉只損失分類，小說還在
     *   - 資料的格式可以**嚴**——壞掉只損失那一塊
     *
     * ⚠️ **全部的非空行都要符合才算數**（有一行不符合就回 `null`）：
     * 寧可整塊當文字，也不要切出半對的資料——半對的資料畫成表格比純文字更難讀。
     *
     * 全形 `：` 優先於半形 `:`（中文的 `時間：晚上 11:30` 才不會被切成 `時間` 與 `晚上 11`）。
     *
     * ⚠️ **行分隔要同時認真的換行與「字面上的 `\n`」**——這一條是實測逼出來的：
     *
     * 結構化的一行是 JSON，而 JSON 裡的多行只能是 `\n` **轉義**。模型（與教學它的
     * 世界書）很自然地寫：
     *     {"kind":"data","text":"時間：晚上十一點\n心情：疲倦"}
     * `JSON.parse` 之後那個 `\n` 是**兩個字元**（反斜線 ＋ n），不是一個換行。
     * 只 split('\n') 的話整串會被當成**一行**，於是 `parseDataRows` 找不到合法的
     * `key: value` ⇒ 回 `null` ⇒ 那一塊降級成旁白。
     *
     * 症狀是**安靜的**：畫面上出現的是一行文字裡夾著看得見的 `\n`
     * （實測在使用者的 `輸出格式.json` 世界書上就是這樣），而不是一張表。
     * 修法就是這裡多一個分隔符——**一個地方修，兩條路（標記與結構化）都受益**。
     *
     * @param text - 區塊內容。
     * @returns `[{ key, value }]`，或 `null`（不符合）。
     */
    function parseDataRows(text) {
      var lines = String(text === null || text === undefined ? '' : text).split(/\n|\\n/)
      var rows = []
      for (var i = 0; i < lines.length; i += 1) {
        var line = lines[i].trim()
        if (line === '') continue
        var at = line.indexOf('：')
        if (at < 0) at = line.indexOf(':')
        if (at <= 0) return null
        var key = line.slice(0, at).trim()
        var value = line.slice(at + 1).trim()
        if (key === '' || /\s/.test(key)) return null
        rows.push({ key: key, value: value })
      }
      return rows.length > 0 ? rows : null
    }

    /**
     * 區塊內容的頭尾空白拿掉。
     *
     * `<面板>\n內容\n</面板>` 的內容本來就會多出頭尾換行——那是排版的雜訊，
     * 不是內容。留著會讓渲染端多出一個空的頭行／尾行。
     */
    function trimBlockText(text) {
      return String(text === null || text === undefined ? '' : text).replace(/^\s+|\s+$/g, '')
    }

    /**
     * 把已宣告的標記區塊切出來，其餘原樣留著（回傳的 `pieces` 依出現順序）。
     *
     * ⚠️ **未閉合就吃到結尾**，並記一條 warning——這不是偷懶：長對話裡模型
     * 漏掉收尾標記是最常見的走樣形狀，把它當成「壞掉」會讓那一段整塊消失，
     * 當成「開到結尾」至少還畫得出來。
     *
     * 支援 `<tag>` 與 `<tag who="名字">` 兩種開頭（屬性只認 `who`）；
     * 內容**不再遞迴解析**（第一版不做巢狀）。
     */
    function parseMarkedRegions(raw, cfg, problems) {
      var specs = []
      for (var i = 0; i < cfg.markers.length; i += 1) {
        var one = cfg.markers[i]
        if (one === null || typeof one !== 'object') continue
        var tag = typeof one.tag === 'string' ? one.tag : ''
        if (tag === '') continue
        specs.push({
          tag: tag,
          kind: typeof one.kind === 'string' && one.kind !== '' ? one.kind : 'panel',
          who: typeof one.who === 'string' ? one.who : '',
        })
      }
      if (specs.length === 0) return [{ marked: false, text: raw, at: 0 }]

      var pieces = []
      var cursor = 0
      while (cursor < raw.length) {
        var best = null
        for (var k = 0; k < specs.length; k += 1) {
          var hit = findOpenTag(raw, specs[k].tag, cursor)
          if (hit === null) continue
          if (best === null || hit.at < best.hit.at) best = { spec: specs[k], hit: hit }
        }
        if (best === null) {
          pieces.push({ marked: false, text: raw.slice(cursor), at: cursor })
          break
        }
        if (best.hit.at > cursor) pieces.push({ marked: false, text: raw.slice(cursor, best.hit.at), at: cursor })
        var close = '</' + best.spec.tag + '>'
        var innerStart = best.hit.innerStart
        var end = raw.indexOf(close, innerStart)
        var closed = end >= 0
        if (!closed) {
          // ⚠️ 未閉合時**吃到下一個標記之前**，不是吃到結尾。
          // 吃到結尾會把後面「正常閉合」的標記一起吞掉——那是比走樣更糟的結果：
          // 一個漏掉的收尾標記會讓後面整段（可能是好幾回合後的事）全部變成它的內容。
          var nextAt = raw.length
          for (var n = 0; n < specs.length; n += 1) {
            var ahead = findOpenTag(raw, specs[n].tag, innerStart)
            if (ahead !== null && ahead.at < nextAt) nextAt = ahead.at
          }
          problems.push(
            makeProblem('format', 'fatal', 'unclosed', lineOf(raw, best.hit.at), { tag: best.spec.tag }),
          )
          var openInner = trimBlockText(raw.slice(innerStart, nextAt))
          pieces.push({
            marked: true,
            tag: best.spec.tag,
            kind: best.spec.kind,
            who: best.hit.who !== '' ? best.hit.who : best.spec.who,
            text: openInner,
            rows: parseDataRows(openInner),
            at: best.hit.at,
          })
          cursor = nextAt
          if (nextAt >= raw.length) break
          continue
        }
        var closedInner = trimBlockText(raw.slice(innerStart, end))
        var closedRows = parseDataRows(closedInner)
        // 詞彙層：宣告成資料區塊，內容卻不是 `key: value`——不修也看得下去
        // （會退回純文字），但**要回報**：那代表模型的寫法已經偏了。
        if (best.spec.kind === 'data' && closedRows === null) {
          problems.push(
            makeProblem('schema', 'acceptable', 'data-mismatch', lineOf(raw, best.hit.at), { tag: best.spec.tag }),
          )
        }
        pieces.push({
          marked: true,
          tag: best.spec.tag,
          kind: best.spec.kind,
          who: best.hit.who !== '' ? best.hit.who : best.spec.who,
          text: closedInner,
          rows: closedRows,
          at: best.hit.at,
        })
        cursor = end + close.length
      }
      return pieces
    }

    /**
     * 找下一個 `<tag>` 或 `<tag who="…">`。
     *
     * ⚠️ 標籤名的下一個字元必須是 `>` 或空白，不能是別的字母——不然 `<n>` 會
     * 在 `<note>` 裡命中（這正是 SillyTavern 的 `matchWholeWords` 對中文壞掉的
     * 同型問題，見 `plan.md` §5 第 8 條）。
     */
    function findOpenTag(text, tag, from) {
      var needle = '<' + tag
      var at = text.indexOf(needle, from)
      while (at >= 0) {
        var next = text.charAt(at + needle.length)
        if (next === '>' || /\s/.test(next)) {
          var gt = text.indexOf('>', at + needle.length)
          if (gt < 0) return null
          var attrs = text.slice(at + needle.length, gt)
          var who = ''
          var match = /who\s*=\s*("([^"]*)"|'([^']*)')/.exec(attrs)
          if (match !== null) who = match[2] !== undefined ? match[2] : match[3]
          return { at: at, innerStart: gt + 1, who: who }
        }
        at = text.indexOf(needle, at + 1)
      }
      return null
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
     * ⚠️ **`room`（房間 id）與 `name`（顯示名稱）是兩個不同的東西，都要傳**（2.6.49）：
     * 綁定裡的 `room` 是**身分**（agent 面靠它讀 `room.json`：工具權限、「這一場的
     * 指示」、生成參數），`chat` 是顯示名稱（清單比對用）。以前這一支只收一個
     * `chat` 而且送的是顯示名稱，於是每一筆綁定的 `room` 都是空的——**每房設定
     * 全部無聲地不生效**。
     *
     * @param tavernId - 酒館 id。
     * @param character - 角色 id。
     * @param room - **房間 id**（資料夾名，`selected.room`）。
     * @param name - **顯示名稱**（`selected.name`；可以重複、可以改）。
     * @param root - 酒館資料夾的絕對路徑（新 session 的 `cwd`）。
     * @returns `{ sessionId, created }`。
     */
    function ensureChatSession(tavernId, character, room, name, root) {
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
            var one = list[i]
            if (one === null || typeof one !== 'object') continue
            if (one.character !== character) continue
            // 新的形狀：`room` 是房間 id（身分），比它就對了。
            if (one.room === room) return { sessionId: one.sessionId, needsRoom: false }
            // 舊的形狀：沒有 `room`，而 `chat` 放的是顯示名稱（或早期誤放的房間 id）。
            // ⚠️ 命中舊形狀要**就地補上 `room`**——不補的話 agent 面會拿顯示名稱去當
            // 資料夾名，每房設定永遠讀不到。這是自我修復，使用者不必做任何事，
            // 也不必寫遷移腳本（舊綁定只會在有 `room` 之前一直壞著）。
            if (one.chat === name || one.chat === room) {
              return { sessionId: one.sessionId, needsRoom: true }
            }
          }
          return null
        })
        .then(function (found) {
          /**
           * 把舊綁定補成新形狀（`room` ＝房間 id）。
           *
           * ⚠️ **一定要 await 它**（呼叫端在下面回傳一個 promise）。原本寫成
           * 射後不理，想的是「修補失敗不該擋住開對話」——但這一支在**送出訊息**
           * 那條路上被呼叫，而 `session.prompt` 就在後面。綁定還沒落地時 agent 面
           * 讀到的仍是舊形狀，於是症狀會是**「修好了，但這一輪的每房設定還是沒生效，
           * 下一輪才好」**——最容易被當成「有時靈有時不靈」的那一種。
           *
           * 失敗本身仍然吞掉（下面 `.catch`）：這是修補，不該讓它把「送出」弄失敗。
           */
          var patchRoom = function (sessionId) {
            if (found === null || found.needsRoom !== true) return Promise.resolve()
            return rpc('session.bind', {
              id: tavernId,
              sessionId: sessionId,
              character: character,
              room: room,
              chat: name,
            }).catch(function () {
              /* 補不起來就算了——下一次送出這一間房會再試一次 */
            })
          }
          if (found !== null) {
            // 回復：DSH 會用**當初那個 preset**重新組一次 composition。
            return sessionsService()
              .create({ sessionId: found.sessionId })
              .then(function () {
                return patchRoom(found.sessionId)
              })
              .then(function () {
                return { sessionId: found.sessionId, created: false }
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
              // 綁定：寫對照表（Agent 面靠它認出「這個 session 是誰」）。
              // ⚠️ `room`（id）與 `chat`（顯示名稱）**兩個都要送**，理由見上面。
              return rpc('session.bind', {
                id: tavernId,
                sessionId: sessionId,
                character: character,
                room: room,
                chat: name,
              }).then(function () {
                return { sessionId: sessionId, created: true }
              })
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
     * @param handlers - `{ onDelta(text), signal, content }`。
     *   `content` 是**已經組好的 prompt 內容**（附件 ＋ 文字）——有給就用它，
     *   沒有才自己包一個純文字 part。附件的部分只有呼叫端知道（它才拿得到
     *   `receiptId` 與 base64），所以組裝留在那裡，這裡只負責送。
     * @returns 這一輪的完整回覆文字。
     */
    function sendChatMessage(sessionId, text, handlers) {
      var onDelta = handlers !== null && typeof handlers === 'object' && typeof handlers.onDelta === 'function' ? handlers.onDelta : null
      var onReasoning =
        handlers !== null && typeof handlers === 'object' && typeof handlers.onReasoning === 'function'
          ? handlers.onReasoning
          : null
      /**
       * 供應方回報的用量（`{type:'usage'}` chunk）。
       *
       * 「本輪用量」那一段只有這裡拿得到：`tokenUsage` 投影是整份日誌的累計。
       * 用不到就傳 `null`，其餘一切照舊。
       */
      var onUsage =
        handlers !== null && typeof handlers === 'object' && typeof handlers.onUsage === 'function'
          ? handlers.onUsage
          : null
      var signal = handlers !== null && typeof handlers === 'object' ? handlers.signal : undefined
      // 已經組好的 prompt 內容（附件 ＋ 文字）。沒給就退回「純文字」那一條路。
      var content =
        handlers !== null && typeof handlers === 'object' && Array.isArray(handlers.content)
          ? handlers.content
          : [{ type: 'text', text: text }]

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
              // 供應方回報的用量：一整輪只會來一兩次，收下來給「本輪用量」那一段用。
              var used = usageOfFrame(inner)
              if (used !== null && onUsage !== null) onUsage(used)
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
        .prompt({ requestId: requestId, sessionId: sessionId, mode: 'queue', content: content })
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

    /**
     * `style.bubble` → 一組 CSS 變數（**不是** token）。
     *
     * 為什麼走變數而不是在每一顆氣泡上加 class：元件樣式是**靜態的一層**，
     * 而主題是「換一間酒館才換一次」。用變數就只要換那一層，
     * 不必讓每一顆氣泡知道自己是哪一種樣式。
     *
     * ⚠️ `plain` 的邊框要用 `0 solid transparent` 而**不是** `none`：
     * 尾巴那個 `::after` 靠 `border-left:inherit` 成形，`none` 會讓它整塊消失。
     */
    var BUBBLE_STYLE_VARS = {
      bubble: {
        'bubble-bg': 'var(--dsh-tv-surface-2)',
        'bubble-border': '1px solid var(--dsh-tv-line)',
        'bubble-radius': 'var(--dsh-tv-radius-md)',
        'bubble-pad': '8px 11px',
        'bubble-shadow': 'none',
        'bubble-tail': 'none',
        'bubble-me-bg': 'var(--dsh-tv-accent-soft)',
        'bubble-me-border': 'var(--dsh-tv-accent)',
      },
      plain: {
        'bubble-bg': 'transparent',
        'bubble-border': '0 solid transparent',
        'bubble-radius': '0',
        'bubble-pad': '0',
        'bubble-shadow': 'none',
        'bubble-tail': 'none',
        'bubble-me-bg': 'transparent',
        'bubble-me-border': '0 solid transparent',
      },
      tail: {
        'bubble-bg': 'var(--dsh-tv-surface-2)',
        'bubble-border': '1px solid var(--dsh-tv-line)',
        'bubble-radius': 'var(--dsh-tv-radius-md)',
        'bubble-pad': '8px 11px',
        'bubble-shadow': 'none',
        'bubble-tail': 'block',
        'bubble-me-bg': 'var(--dsh-tv-accent-soft)',
        'bubble-me-border': 'var(--dsh-tv-accent)',
      },
      paper: {
        'bubble-bg': 'linear-gradient(180deg, var(--dsh-tv-surface-1), var(--dsh-tv-surface-0))',
        'bubble-border': '1px solid var(--dsh-tv-line-soft)',
        'bubble-radius': 'var(--dsh-tv-radius-sm)',
        'bubble-pad': '10px 13px',
        'bubble-shadow':
          'inset 0 1px 0 color-mix(in srgb, var(--dsh-tv-text-1) 8%, transparent), var(--dsh-tv-shadow-1)',
        'bubble-tail': 'none',
        'bubble-me-bg': 'linear-gradient(180deg, var(--dsh-tv-surface-2), var(--dsh-tv-surface-1))',
        'bubble-me-border': 'var(--dsh-tv-line)',
      },
    }

    /** 目前生效的 `style`（給測試與之後的設定頁看）。 */
    var activeStyle = null

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
    /** 這間酒館的 `custom.css` 那一層（排在元件樣式**後面**，所以它蓋得過去）。 */
    var customStyle = null
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
      var key
      for (key in themeTokens) {
        if (Object.prototype.hasOwnProperty.call(themeTokens, key)) {
          lines.push('  --dsh-tv-' + key + ': ' + themeTokens[key] + ';')
        }
      }
      // `style.*` 推導出來的那一組（見 `BUBBLE_STYLE_VARS`）。跟 token 同一層、
      // 同一個 `<style>`，所以換酒館時是**整層**換掉，不會有新舊混搭的中間狀態。
      var preset =
        activeStyle !== null && activeStyle !== undefined && BUBBLE_STYLE_VARS[activeStyle.bubble] !== undefined
          ? BUBBLE_STYLE_VARS[activeStyle.bubble]
          : BUBBLE_STYLE_VARS.bubble
      for (key in preset) {
        if (Object.prototype.hasOwnProperty.call(preset, key)) {
          lines.push('  --dsh-tv-' + key + ': ' + preset[key] + ';')
        }
      }
      return ':root{\n' + lines.join('\n') + '\n}'
    }

    /**
     * 注入這間酒館的 `custom.css`（「裝修」的逃生口）。
     *
     * ⚠️ **一定要用 `@scope (.dsh-tv-view)` 包起來**，不是直接把使用者的 CSS
     * 丟進 `<head>`：SillyTavern 的 `* { text-shadow: … }` 污染整個宿主 DOM
     * 是前例（`design-language.md` §0）。包起來之後它只碰得到酒館自己的面板。
     *
     * 不支援 `@scope` 的瀏覽器會**整段忽略**——那是刻意的降級（自訂樣式沒生效，
     * 但不會壞掉），不是相容性破口。
     */
    /**
     * 把使用者的 CSS 包成 `@scope (.dsh-tv-view)` 區塊。
     *
     * 抽成純函式是為了測得到——`customStyle` 那個 `<style>` 元素在離線測試裡
     * 碰不到（假的 `document.head.appendChild` 是空的）。
     *
     * @param text - 使用者寫的 CSS（可能是空的）。
     * @returns 要注入的內容；空的就是空字串（**不要**注入一個空的 `@scope`）。
     */
    function scopeCustomCss(text) {
      var css = typeof text === 'string' ? text.trim() : ''
      return css === '' ? '' : '@scope (.dsh-tv-view) {\n' + css + '\n}\n'
    }

    function applyCustomCss(text) {
      if (customStyle === null || customStyle === undefined) return
      customStyle.textContent = scopeCustomCss(text)
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
     * @param theme - `{ base, tokens, style }`，或 `null`（＝用預設）。
     * @param defaults - 深色基底的完整 token 表。
     * @param lightDefaults - 淺色基底的完整表。
     * @param customCss - 這間酒館的 `custom.css`（沒有就空字串）。
     */
    function applyTheme(theme, defaults, lightDefaults, customCss) {
      activeTheme = theme
      activeStyle = theme !== null && theme !== undefined && theme.style !== undefined ? theme.style : null
      var isLight = theme !== null && theme !== undefined && theme.base === 'light'
      var base = isLight && lightDefaults !== undefined ? lightDefaults : defaults
      if (base !== undefined) {
        setThemeTokens(base, theme === null || theme === undefined ? {} : theme.tokens)
      }
      if (themeStyle === null || themeStyle === undefined) return
      themeStyle.textContent = themeTokensCss()
      applyCustomCss(customCss)
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
          applyTheme(body.theme, body.defaults, body.lightDefaults, body.customCss)
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
      /* 分區切換列（`redesign.md` §3.2）。只准用 token：這一區是酒館自己的空間。 */
      '.dsh-tv-zones{display:flex;gap:2px;flex:none;padding:0 20px;border-bottom:1px solid var(--dsh-tv-line)}',
      '.dsh-tv-zone{appearance:none;background:0 0;border:0;border-bottom:2px solid transparent;font:inherit;font-size:12.5px;',
      'color:var(--dsh-tv-text-2);padding:9px 12px 8px;margin-bottom:-1px;cursor:pointer;white-space:nowrap;',
      'transition:color var(--dsh-tv-speed-fast) var(--dsh-tv-ease),border-color var(--dsh-tv-speed-fast) var(--dsh-tv-ease)}',
      '.dsh-tv-zone:hover{color:var(--dsh-tv-text-1)}',
      '.dsh-tv-zone:focus-visible{outline:2px solid var(--dsh-tv-accent);outline-offset:-2px}',
      '.dsh-tv-zoneOn{color:var(--dsh-tv-accent);border-bottom-color:var(--dsh-tv-accent);font-weight:600}',
      /* 分區裡的段落節奏。`.dsh-tv-sec` / `.dsh-tv-secTitle` 以前**根本沒有樣式**，
         所以標題長得跟瀏覽器預設的 h3 一樣——那是「簡陋感」的來源之一。 */
      '.dsh-tv-sec{margin-bottom:24px}',
      '.dsh-tv-sec:last-child{margin-bottom:0}',
      '.dsh-tv-secTitle{margin:0 0 10px;font-size:13px;font-weight:600;color:var(--dsh-tv-text-1)}',
      /* 「進階」＝收合的破壞性動作（`plan.md` §7.5：不要跟「重新命名」並排）。 */
      '.dsh-tv-adv{margin-top:20px;padding-top:12px;border-top:1px solid var(--dsh-tv-line-soft)}',
      '.dsh-tv-advToggle{appearance:none;background:0 0;border:0;padding:0;font:inherit;font-size:11.5px;',
      'color:var(--dsh-tv-text-3);cursor:pointer}',
      '.dsh-tv-advToggle:hover{color:var(--dsh-tv-text-2)}',
      '.dsh-tv-advBody{margin-top:10px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}',
      /* 🏠 大廳的快速入口：一間酒館＝四個分區，大廳要能一眼跳去其他三個。 */
      '.dsh-tv-quick{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px}',
      '.dsh-tv-quickBtn{display:flex;flex-direction:column;gap:2px;align-items:flex-start;text-align:left;',
      'border:1px solid var(--dsh-tv-line);background:var(--dsh-tv-surface-1);border-radius:var(--dsh-tv-radius-md);',
      'padding:9px 14px;font:inherit;cursor:pointer;color:var(--dsh-tv-text-1);',
      'transition:border-color var(--dsh-tv-speed-fast) var(--dsh-tv-ease),background var(--dsh-tv-speed-fast) var(--dsh-tv-ease)}',
      '.dsh-tv-quickBtn:hover{border-color:var(--dsh-tv-accent);background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-quickLabel{font-size:12.5px;font-weight:600}',
      '.dsh-tv-quickHint{font-size:10.5px;color:var(--dsh-tv-text-3)}',
      /* 🎭 卡司：海報牆（找卡）與編輯器（改卡）分開，見 `redesign.md` §3.2。 */
      '.dsh-tv-toolRow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}',
      '.dsh-tv-backRow{margin-bottom:14px}',
      '.dsh-tv-wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px}',
      '.dsh-tv-poster{display:flex;flex-direction:column;padding:0;overflow:hidden;cursor:pointer;font:inherit;text-align:left;',
      'border:1px solid var(--dsh-tv-line);background:var(--dsh-tv-surface-1);border-radius:var(--dsh-tv-radius-lg);',
      'transition:border-color var(--dsh-tv-speed-fast) var(--dsh-tv-ease)}',
      '.dsh-tv-poster:hover{border-color:var(--dsh-tv-accent)}',
      '.dsh-tv-poster:focus-visible{outline:2px solid var(--dsh-tv-accent);outline-offset:2px}',
      '.dsh-tv-posterArt{width:100%;aspect-ratio:3 / 4;object-fit:cover;display:block;background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-posterEmpty{width:100%;aspect-ratio:3 / 4;display:flex;align-items:center;justify-content:center;',
      // 房間（對話）用的卡面：**橫式**。
      //
      // 角色是「人」，卡面是 3:4 直式；房間是「地方」，圖通常是橫的場景圖——
      // 把橫的塞進直式框（`object-fit:cover`）會裁掉一大半，看起來就是「不貼合」。
      // 所以房間自己一組比例，名稱列沿用 `.dsh-tv-posterName`（同一套視覺）。
      '.dsh-tv-roomArt{width:100%;aspect-ratio:16 / 10;object-fit:cover;display:block;background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-roomEmpty{width:100%;aspect-ratio:16 / 10;display:flex;align-items:center;justify-content:center;',
      'background:var(--dsh-tv-surface-2);color:var(--dsh-tv-text-3)}',
      'font-size:26px;background:var(--dsh-tv-surface-2);color:var(--dsh-tv-text-3)}',
      '.dsh-tv-posterName{display:flex;align-items:center;gap:6px;padding:8px 10px;font-size:12.5px;color:var(--dsh-tv-text-1)}',
      // 包廂的「選卡」用的密度：比卡司的海報牆小一號，因為它只是表單裡的一個欄位，
      // 而且通常只有個位數張卡。選取狀態沿用既有的 focus 視覺（accent 外框），
      // 用負的 outline-offset 畫在內側，所以不會推動版面。
      '.dsh-tv-cardPick{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}',
      '.dsh-tv-posterOn{border-color:var(--dsh-tv-accent);outline:2px solid var(--dsh-tv-accent);outline-offset:-2px}',
      '.dsh-tv-posterCount{margin-left:auto;font-size:10.5px;color:var(--dsh-tv-text-3)}',
      /* 📖 藏書：條目清單（不要只有一大塊 JSON）。 */
      '.dsh-tv-entries{display:flex;flex-direction:column;gap:10px}',
      '.dsh-tv-entry{display:flex;flex-direction:column;gap:6px;padding:10px;',
      'border:1px solid var(--dsh-tv-line);background:var(--dsh-tv-surface-1);border-radius:var(--dsh-tv-radius-md)}',
      '.dsh-tv-btn{border:1px solid var(--dsh-tv-line);background:var(--dsh-tv-surface-2);',
      'color:var(--dsh-tv-text-1);font:inherit;font-size:12px;padding:5px 12px;border-radius:var(--dsh-tv-radius-pill);cursor:pointer;white-space:nowrap}',
      '.dsh-tv-btn:hover{border-color:var(--dsh-tv-accent)}',
      '.dsh-tv-btnPrimary{background:var(--dsh-tv-accent);border-color:transparent;color:var(--dsh-tv-surface-0);font-weight:600}',
      '.dsh-tv-btnDanger:hover{border-color:var(--dsh-tv-danger);color:var(--dsh-tv-danger)}',
      '.dsh-tv-empty{border:1px dashed var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-md);padding:26px 20px;text-align:center;',
      'color:var(--dsh-tv-text-2);font-size:12.5px}',
      '.dsh-tv-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}',
      '.dsh-tv-fieldLabel{font-size:11.5px;color:var(--dsh-tv-text-2);display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
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
      // ⚠️ `display:flex` ＋ `align-items:center` 是為了讓**位置短標籤**（2.6.65）
      // 貼在檔名右邊。那個標籤有 `flex:none`，而它只在 flex 容器裡才生效
      // ——少了這一行，它會擠在檔名後面跟著 ellipsis 一起被吃掉。
      'display:flex;align-items:center;gap:6px;',
      'cursor:pointer;color:inherit;padding:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}',
      '.dsh-tv-listName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // 房間那一頁「📖 藏書」的一列：開關／書名／位置／標籤 擠在同一條。
      // 用 `flex-wrap` 而不是硬擠——面板變窄時它自己折行，不會把書名壓成一個字。
      // （外框照 `.dsh-tv-entry` 的樣子，但**這裡是橫的**，所以不共用那個 class：
      //  它明寫著 `flex-direction:column`，而兩條同分特異度的規則誰贏要看檔案順序。）
      '.dsh-tv-bookRow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;',
      'border:1px solid var(--dsh-tv-line);background:var(--dsh-tv-surface-1);border-radius:var(--dsh-tv-radius-md)}',
      /**
       * 書名：**純文字**，不是按鈕。
       *
       * ⚠️ 2.6.66 曾經把它做成一顆連結（點了跳到酒館那一頁去改），2.6.68 收回來了
       * ——使用者的原話：
       *
       *   > 房間中原本也不預期改動，我實際上只需要管理啟動與否和位置就可以了，
       *   > 所有藏書都會同一在酒館中修改設定。
       *
       * 所以房間這一頁＝**開關**（用不用這本書、放在哪），內容預覽是唯讀的順手看一下
       * （使用者：「還有摺疊內容我都要」），**要改**一律在酒館那一層。
       */
      '.dsh-tv-bookName{flex:1;min-width:80px;font-size:12.5px;color:var(--dsh-tv-text-1);',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // 擠在一列裡的位置選單。
      //
      // ⚠️ 這裡**不用 `MapSelect`**：它是「標籤在上、選單在下」的一整格
      // （`label.dsh-tv-field`），塞進這一條會把書名擠掉，而且標籤寫的正是左邊
      // 那個書名——同一句話出現兩次。所以用一顆沒有標籤的 `select`，
      // 由 `aria-label`／`title` 交代它是什麼。
      '.dsh-tv-inInline{width:auto;flex:none;font-size:11.5px;padding:3px 6px}',
      /**
       * 「▸ 內容」展開的書（唯讀預覽）。
       *
       * ⚠️ `flex-basis:100%` 是給**橫的** flex 容器用的（`.dsh-tv-bookRow` 是
       * `flex-wrap:wrap`）：它讓展開那一塊自己佔滿一整行，掛在那一列的下面。
       * （2.6.65 它掛在 `flex-direction:column` 的容器裡，那裡 `flex-basis`
       * 管的是高度——同一個值、不同的意思。）
       */
      '.dsh-tv-bookPeek{flex-basis:100%;margin-top:2px;padding:6px 8px;',
      'border-left:2px solid var(--dsh-tv-line);background:var(--dsh-tv-surface-1)}',
      '.dsh-tv-peekEntry{margin-bottom:8px}',
      '.dsh-tv-peekHead{font-size:11.5px;font-weight:600;color:var(--dsh-tv-text-2);display:flex;gap:4px;align-items:center}',
      '.dsh-tv-peekBodyText{font-size:12px;line-height:1.7;color:var(--dsh-tv-text-3);white-space:pre-wrap;word-break:break-word}',
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
      // 「卡片」那一格：那是 `characters/<id>.png` 本體（不是插圖），顏色要跟「主圖」分得開。
      '.dsh-tv-thumbTagCard{left:0;right:0;bottom:auto;top:0;border-top-right-radius:0;border-bottom-right-radius:6px;',
      'background:var(--dsh-tv-surface-3);color:var(--dsh-tv-text-2);font-weight:500}',
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
      '.dsh-tv-chatBody{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0}',
      /**
       * 對話頁的 `mapBody`：**內容撐滿、輸入框沉底**。
       *
       * 使用者：「對話框區域可以沉底現在,不好看」。原本的排版是——
       *   - `.dsh-tv-chatBody` 沒有 `flex`（＝依內容高）
       *   - `.dsh-tv-chatLog` 有 `max-height:52vh`（訊息區**永遠只用到半個視窗**）
       * 兩者加起來：訊息少的時候（或視窗高的時候）整塊內容浮在面板上半部，
       * 輸入框**不會**貼著底部，底下留一大片空白。
       *
       * 現在：`mapBody` 變 flex 容器、訊息區 `flex:1`（吃掉所有剩餘高度）、
       * 輸入框與統計那兩排在尾端。訊息區自己捲（`overflow:auto`），外層不再捲——
       * 跟 DSH 自己的對話頁同一個形狀。
       *
       * ⚠️ 這一組**只加在對話分頁**（`dsh-tv-mapBodyFill`）：另外三個分頁
       * （⚙️ 房間／🖼️ 插圖／📄 檔案）是很長的表單，它們靠外層 `mapBody` 的
       * `overflow-y:auto` 捲動。`overflow:hidden` 套到它們身上會**捲不動**。
       */
      '.dsh-tv-mapBodyFill{display:flex;flex-direction:column;overflow-y:auto;padding:18px 20px 20px}',
      // 訊息少的對話：`max-height:52vh` 讓訊息區只用到半個視窗，其餘留白。
      // 改成讓它吃掉剩餘高度（`flex:1`），上限交給容器。
      '.dsh-tv-chatLog{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0;overflow:auto;padding:2px;position:relative;scrollbar-width:none}',
      '.dsh-tv-chatLog::-webkit-scrollbar{width:0;height:0;display:none}',
      /**
       * 對話頁右邊那條「輪次刻度」（使用者貼了 DSH 的 `.eGxaPq_marks` 說
       * 「還有這個工具」）。**尺寸數字照抄 DSH 的 `TurnNavigator.module.css`**
       * （`dsh-client-ui-chat/lib/client.js`）：刻度是一條 12×2px 的短槓，靠右對齊；
       * 滑過變 18px、**當前那一輪**變 20px 而且用最亮的文字色。
       *
       * ⚠️ **圓角走設計 token、不照抄 DSH 的 `8px`／`2px`**：這個 repo 的規矩是
       * 「圓角只有四階、而且只准用 `var(--dsh-tv-radius-*)`」（`test-client.mjs`
       * 第 15 項會掃，寫死就紅）。2px 高的短槓用 `radius-pill` 端點是圓的，
       * 跟 DSH 的 2px 幾乎看不出差別。
       *
       * ⚠️ 兩件事跟 DSH 一樣是**成對**的，不可以只做一半：
       *   1. 刻度要取代原生捲軸 → 所以 `.dsh-tv-chatLog` 把捲軸藏起來
       *      （`scrollbar-width:none` ＋ `::-webkit-scrollbar{display:none}`）。
       *      藏了卻沒畫刻度＝**使用者再也看不到自己在哪裡**。
       *   2. 刻度是 `position:absolute` 疊在訊息區上面，所以訊息區要
       *      `position:relative` 當它的定位祖先。
       */
      /**
       * ⚠️ **刻度住在訊息區外面、但疊在它上面**——這一條是**實測抓到的**。
       *
       * 第一版把刻度直接 `position:absolute` 放進 `.dsh-tv-chatLog`
       * （`overflow:auto`）裡：絕對定位在捲動容器裡**會跟著內容捲**。
       * 量到的數字：`scrollTop=0` 時看得見，`scrollTop=900` 時跑到 **`-769..-263`**
       * ——整個在畫面外。也就是說「一往下捲，刻度就不見了」，而那正是最需要它的時候。
       *
       * 第二版照 DSH 用 `position:sticky` 插槽，**還是錯**：sticky 是相對
       * **自然流位置**，而插槽排在內容最後面 → 它的自然位置在內容底部，
       * 只有捲到最底才會「黏」住（`scrollTop=0` 時量到 `1560..2077`，畫面外）。
       * DSH 的那個插槽排在**最前面**才成立。
       *
       * 第三版（現在這個）不靠 sticky、也不靠排列順序：外面多一層
       * **不捲動的定位容器**，訊息區在裡面捲、刻度是它的兄弟節點。
       * 高度用 `height:100%` 就等於訊息區的高度，不必從 JS 傳。
       *
       * ⚠️ 這一層不是「多包一層 div」的地雷（`client.js` 下面那句警告講的是
       * 沒有 flex 屬性的裸 div）：它自己 `flex:1;min-height:0;display:flex`，
       * 訊息區在裡面照樣撐得開——量過 `scrollHeight=1429 / clientHeight=517`。
       */
      '.dsh-tv-logWrap{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}',
      /**
       * ⚠️ **刻度是「固定間距的清單」，不是「按內容比例縮放的迷你地圖」。**
       *
       * 第一版我做成後者（`pos = offsetTop / scrollHeight * 可見高度`），
       * 使用者看了就說「間隔太遠了」。差別在這裡：
       *
       *   第一版：6 輪散在 517px 上 → 每 87px 一個
       *   DSH：`itemPosition(index) = index * TURN_SPACING_PX`（**固定 10px**）
       *
       * 重點是：**刻度之間的距離與內容多長無關**，永遠 10px。條帶的自然高度是
       * `(count-1)*10 + 12`，框高再夾成 `min(自然高度, 可用高度-64, 420px)`。
       * 輪數多的時候條帶比框高，DSH 用一個**同步捲動的內層 scroller** 讓當前那一輪
       * 留在視野裡（`markTop` 跑出 `FADE_PX=24` 的邊界就把它置中）。
       *
       * 這個 repo 沒有那個內層 scroller，改用同一個算式的**位移**（`offset`）＋
       * `overflow:hidden` 夾住——可見結果一樣，而且少一層要同步的東西。
       * 數字全部照抄 `dsh-client-ui-chat/lib/client.js` 的
       * `TURN_SPACING_PX`／`RAIL_INSET_PX`／`FADE_PX`。
       */
      '.dsh-tv-turnRail{position:absolute;top:50%;right:0;width:28px;transform:translateY(-50%);pointer-events:none;overflow:hidden}',
      '.dsh-tv-turnMark{position:absolute;right:0;left:auto;width:20px;height:10px;padding:0;border:0;border-radius:var(--dsh-tv-radius-sm);background:0 0;cursor:pointer;pointer-events:auto;transform:translateY(-50%);transition:top .22s cubic-bezier(.2,.8,.2,1)}',
      '.dsh-tv-turnMark::before{content:"";position:absolute;top:50%;right:0;width:12px;height:2px;border-radius:var(--dsh-tv-radius-pill);background:var(--dsh-tv-line);transform:translateY(-50%);transition:width .14s,background-color .14s}',
      /**
       * ⚠️ **只有兩階：12px（一般）與 20px（當前）——這是照原版，不是漏做。**
       *
       * 原版有**四個**寬度，但那是**狀態**不是距離。這一組數字是**在真的 DSH
       * 對話上量到的**（13 輪、pitch 固定 10px、frame 高 132px）：
       *
       *   第 1–8 輪   8px  `rgba(0,0,0,.16)` opacity .6   `markUnloaded` ← 內容還沒載進來
       *   第 9–12 輪  12px `rgba(0,0,0,.16)`               `mark`
       *   第 13 輪    20px `rgb(15,17,21)`                 `markActive`
       *
       * 使用者看到的那個「坡度」就是 **8 → 12 → 20** 的交接處（舊的未載入、
       * 近的已載入、當前最長），**不是**「離當前越遠越短」。
       *
       * 我 2.6.54 自己加了一階「隔壁＝18px」，使用者說「還是覺得原版的比較好」
       * ——那一階**原版沒有**，已移除。
       *
       * ⚠️ 酒館**沒有「未載入」這一種狀態**：`room.messages` 一次把整個
       * `chat.jsonl` 讀進來、每一則都畫成氣泡。所以 8px 那一階在酒館裡沒有誠實的
       * 意思——而一份**全部已載入**的對話在原版裡也正好只呈現 12px ＋ 20px 兩階。
       * 要真的做出第三階，得先做「只渲染最近 N 輪、舊的點了才載」那個功能。
       */
      '.dsh-tv-turnMark:hover::before,.dsh-tv-turnMark:focus-visible::before{background:var(--dsh-tv-text-2);width:18px}',
      '.dsh-tv-turnMarkOn::before{background:var(--dsh-tv-text-1);width:20px}',
      /* 氣泡的形狀由 `style.bubble` 推導出來的那組變數決定（見 `BUBBLE_STYLE_VARS`），
         所以四種樣式不需要四份規則，也不必在畫面上掛多餘的 class。 */
      '.dsh-tv-bubble{max-width:78%;align-self:flex-start;position:relative;',
      'border:var(--dsh-tv-bubble-border,1px solid var(--dsh-tv-line));',
      'border-radius:var(--dsh-tv-bubble-radius,var(--dsh-tv-radius-md));',
      'padding:var(--dsh-tv-bubble-pad,8px 11px);',
      'background:var(--dsh-tv-bubble-bg,var(--dsh-tv-surface-2));',
      'box-shadow:var(--dsh-tv-bubble-shadow,none)}',
      /* 尾巴：`style.bubble: "tail"` 會把 --dsh-tv-bubble-tail 設成 block。 */
      '.dsh-tv-bubble::after{content:"";display:var(--dsh-tv-bubble-tail,none);position:absolute;',
      'left:-4px;top:12px;width:8px;height:8px;background:inherit;border-left:inherit;',
      'border-bottom:inherit;transform:rotate(45deg)}',
      '.dsh-tv-bubbleMe{align-self:flex-end;border-color:var(--dsh-tv-bubble-me-border,var(--dsh-tv-accent));',
      'background:var(--dsh-tv-bubble-me-bg,var(--dsh-tv-accent-soft))}',
      '.dsh-tv-bubbleMe::after{left:auto;right:-4px;border-left:0;border-bottom:0;',
      'border-right:inherit;border-top:inherit}',
      /* 節點樹 → 畫面（`renderMessage`）：`para` 分組、`kind` 決定 class。 */
      '.dsh-tv-para{display:block;margin:0 0 4px}',
      '.dsh-tv-para:last-child{margin-bottom:0}',
      '.dsh-tv-data{display:flex;flex-direction:column;gap:2px;margin:4px 0;',
      'border-left:2px solid var(--dsh-tv-line);padding-left:10px}',
      '.dsh-tv-dataRow{display:flex;gap:8px;font-size:12.5px;line-height:1.7;align-items:center}',
      '.dsh-tv-dataKey{flex:none;min-width:4em;color:var(--dsh-tv-text-3)}',
      '.dsh-tv-dataValue{color:var(--dsh-tv-text-1)}',
      // 進度條：**只在值是帶單位的數字時出現**（`lib/render.js` 的 `progressOf`）。
      // 寬度由行內 style 給（那是資料，不是樣式），這裡只管樣子。
      '.dsh-tv-dataBar{flex:1 1 auto;min-width:36px;max-width:120px;height:5px;border-radius:var(--dsh-tv-radius-pill);',
      'background:var(--dsh-tv-surface-2);overflow:hidden;display:block}',
      '.dsh-tv-dataBarFill{display:block;height:100%;background:var(--dsh-tv-accent);',
      // ⚠️ 走 token，不寫 `inherit`（測試會掃「圓角只准用 var(--dsh-tv-radius-*)」）。
      'border-radius:var(--dsh-tv-radius-pill)}',
      // `choices`：可選項。開著（choicesClickable）才是按鈕——關著的時候畫成
      // 純文字，**不要畫成按鈕卻沒反應**（那是欺騙性的 UI）。
      '.dsh-tv-choices{display:flex;flex-direction:column;gap:4px;margin:6px 0;align-items:flex-start}',
      '.dsh-tv-choiceFlat{color:var(--dsh-tv-text-2);font-size:13px}',
      '.dsh-tv-choice{display:block;text-align:left;font:inherit;font-size:13px;cursor:pointer;',
      'padding:5px 12px;border-radius:var(--dsh-tv-radius-pill);border:1px solid var(--dsh-tv-line);',
      'background:var(--dsh-tv-surface-1);color:var(--dsh-tv-text-1)}',
      '.dsh-tv-choice:hover{border-color:var(--dsh-tv-accent);color:var(--dsh-tv-accent)}',
      // 世界書清單上的位置短標籤（系統前／系統後／訊息前）。
      '.dsh-tv-posTag{flex:none;margin-left:6px;font-size:10.5px;line-height:1.5;padding:0 5px;',
      'border-radius:var(--dsh-tv-radius-sm);border:1px solid var(--dsh-tv-line);color:var(--dsh-tv-text-3)}',
      // 欄位標籤那顆「?」——TrueNAS 的做法（使用者指定的）：平時只有標籤，
      // 想知道的人按一下才展開。
      // ⚠️ `display:flex` 是為了讓 `?` 貼在標籤右邊、而展開的說明獨佔一整行。
      //    它**併進 `.dsh-tv-fieldLabel` 原本那一條**（同一個 class 不准定義兩次
      //    ——那會讓後面的規則半途蓋掉前面的，測試會紅）。
      '.dsh-tv-help{flex:none;width:15px;height:15px;padding:0;line-height:1;font-size:10.5px;font-weight:700;',
      'cursor:pointer;border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-pill);',
      'background:var(--dsh-tv-surface-2);color:var(--dsh-tv-text-3)}',
      '.dsh-tv-help:hover{border-color:var(--dsh-tv-accent);color:var(--dsh-tv-accent)}',
      '.dsh-tv-help[aria-expanded="true"]{border-color:var(--dsh-tv-accent);color:var(--dsh-tv-accent)}',
      // 展開的說明**必須獨佔一整行**（`flex-basis:100%`），不然它會擠在標籤旁邊。
      '.dsh-tv-helpBody{flex-basis:100%;font-size:11.5px;line-height:1.7;color:var(--dsh-tv-text-3);',
      'padding:4px 0 2px 0}',
      // ⚠️ 這個容器在 `<label>` 裡（`MapSelect`），點它會**順便把下拉選單打開**
      // ——滑過去看說明結果選單彈出來。整塊不吃滑鼠事件就不會。
      '.dsh-tv-fieldLabelText,.dsh-tv-helpBody{pointer-events:none}',
      // 「一個東西兩個來源」那種警告——**低調但看得見**（它是提醒，不是錯誤）。
      '.dsh-tv-warn{margin:6px 0;padding:7px 10px;border-radius:var(--dsh-tv-radius-sm);',
      'border:1px solid var(--dsh-tv-warn);color:var(--dsh-tv-text-2);font-size:12px;line-height:1.6}',
      '.dsh-tv-orderIn{width:5em;flex:none}',
      /**
       * 書層優先序那一格（2.6.71）。
       *
       * ⚠️ **比 `.dsh-tv-orderIn` 寬，而且是量出來的**：那裡的內容是條目的
       * `order`（兩三個數字），這裡要放得下 `placeholder`（「書自己 3」／
       * 「不指定（0）」）。實測 5em 會把「不指定（0）」截成「不指」
       * ——**被截掉的說明比沒有說明更糟**（使用者看到一格看不懂的字）。
       */
      '.dsh-tv-priorityIn{width:8em;flex:none}',
      /**
       * 優先序那一格「這個數字是借來的」的樣子（2.6.71）。
       *
       * ⚠️ 那一格**永遠有數字**（沒指定就顯示書自己的值／0），所以「是不是我設的」
       * 只能靠顏色說——灰＝跟著書自己的，正常色＝這一間房指定的。
       * 用文字色 token（`--dsh-tv-text-3`）而不是 `opacity`：主題覆寫色票時跟著走。
       */
      '.dsh-tv-prioInherit{color:var(--dsh-tv-text-3)}',
      '.dsh-tv-bubbleWho{font-size:10.5px;font-weight:600;margin-bottom:3px;color:var(--dsh-tv-text-3)}',
      // 訊息列＝頭像 ＋ 氣泡，跟通訊軟體一樣。氣泡本身完全沒動（外框、尾巴、
      // 主題覆寫變數都還在同一顆 `.dsh-tv-bubble` 上），只是在外面多一列。
      // 「我的」那一列用 `row-reverse` 把頭像翻到右邊——不要用兩個 `order`，
      // 那樣在氣泡尾巴的定位上會多一種情況要顧。
      '.dsh-tv-msg{display:flex;gap:8px;align-items:flex-start}',
      '.dsh-tv-msgMe{flex-direction:row-reverse}',
      '.dsh-tv-msgBody{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;align-items:flex-start}',
      '.dsh-tv-msgMe .dsh-tv-msgBody{align-items:flex-end}',
      // 頭像是圓的（使用者要求）。設計語言的圓角檢查裡，`border-radius:50%` 是
      // **唯一允許的例外**——頭像本來就不該跟介面其餘的圓角同一套。
      // 想換形狀不用改程式：`custom.css` 寫 `.dsh-tv-avatar{border-radius:8px}` 就蓋掉了。
      '.dsh-tv-avatar{width:30px;height:30px;flex:0 0 auto;display:block;border-radius:50%;',
      'object-fit:cover;background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-avatarText{display:flex;align-items:center;justify-content:center;box-sizing:border-box;',
      'border:1px solid var(--dsh-tv-line);font-size:12px;font-weight:600;color:var(--dsh-tv-text-2)}',
      '.dsh-tv-bubbleText{font-family:var(--dsh-tv-font-reading);font-size:15.5px;line-height:1.9;',
      'max-width:34em;white-space:pre-wrap;word-break:break-word;',
      'color:var(--dsh-tv-text-1)}',
      '.dsh-tv-narration{color:var(--dsh-tv-text-1)}',
      // 訊息底下那兩個小標籤（用量／用时）——DSH 把它們掛在訊息上，樣式跟 pill 同一套語言。
      '.dsh-tv-msgMeta{display:flex;flex-wrap:wrap;align-items:center;gap:2px 12px;margin-top:4px;font-size:12px;line-height:18px;color:var(--dsh-tv-text-3)}',
      '.dsh-tv-msgMetaBtn{font:inherit;color:inherit;background:none;border:none;padding:0;cursor:pointer}',
      '.dsh-tv-msgMetaBtn:hover{color:var(--dsh-tv-text-1)}',
      '.dsh-tv-msgPanel{width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-md);background:var(--dsh-tv-surface-1);font-size:12px;line-height:20px;color:var(--dsh-tv-text-3)}',
      '.dsh-tv-msgMetaItem{display:inline-flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}',
      '.dsh-tv-speech{color:var(--dsh-tv-text-1);background:var(--dsh-tv-accent-soft);',
      'border-radius:var(--dsh-tv-radius-sm);padding:0 4px}',
      '.dsh-tv-action{color:var(--dsh-tv-text-2);font-weight:400}',
      '.dsh-tv-thought{color:var(--dsh-tv-text-3);border-left:2px solid var(--dsh-tv-line);padding-left:12px}',
      // 輸入區＝**一張卡**（使用者：「有一些欺騙性的 UI，例如假裝是在同一個對話框，
      // 現在所有東西都是分開的」）。度量照抄 DSH 自己的 composer（`.uV2eYG_card`）：
      //   **沒有邊框**，靠**底色 ＋ 柔和陰影 ＋ 大圓角**圍出一張卡；輸入區在卡片裡面
      //   **沒有自己那一圈框**（`.uV2eYG_input` 也是 `outline:none`），按鈕列、檔案路徑
      //   與用量 pill 全部掛在**同一張卡**裡——這樣才不會看起來是四件分開的東西。
      //   圓角走酒館的 token（`radius-lg`＝10px；DSH 那邊是寫死的 22px）。
      '.dsh-tv-chatInput{box-sizing:border-box;position:relative;width:100%;margin-top:10px;flex:none;display:flex;flex-direction:column;gap:2px;',
      'background:var(--dsh-tv-surface-1);border:0;border-radius:var(--dsh-tv-radius-lg);padding:8px 8px 6px}',
      '.dsh-tv-chatInput .dsh-tv-ta{border:none;background:none;padding:4px 6px 0 6px;min-height:52px;resize:none}',
      '.dsh-tv-chatInput .dsh-tv-ta:focus{border:none}',
      // 上下文環：28×28 圓鈕（DSH 的 .JObwrW_trigger），貼在送出鍵左邊。
      '.dsh-tv-usageRing{margin-left:auto;width:28px;height:28px;flex:none;display:grid;place-items:center;padding:0;border:none;border-radius:var(--dsh-tv-radius-pill);background:none;color:var(--dsh-tv-text-3);cursor:pointer}',
      '.dsh-tv-usageRing:hover{color:var(--dsh-tv-text-1)}',
      '.dsh-tv-composerRow{display:flex;flex-wrap:wrap;align-items:center;gap:12px;min-width:0;padding:2px 6px 4px}',
      '.dsh-tv-composerNote{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // 送出鍵：34×34 圓形主色按鈕，貼齊右下（DSH 的 .uV2eYG_primary：同尺寸、
      // order-radius:999px、	ransform:translateY(-2px)）。忙碌時同一顆變成停止。
      '.dsh-tv-composerTrail{margin-left:auto;display:inline-flex;align-items:center;gap:8px}',
      // 📎 附件鈕：DSH 的工具鈕是 28×28 的安靜圓鈕（不是主色那顆送出鍵）。
      '.dsh-tv-attachBtn{box-sizing:border-box;width:28px;height:28px;flex:none;display:grid;place-items:center;',
      'padding:0;border:none;border-radius:var(--dsh-tv-radius-pill);background:none;',
      'color:var(--dsh-tv-text-3);cursor:pointer}',
      '.dsh-tv-attachBtn:hover:not(:disabled){color:var(--dsh-tv-text-1);background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-attachBtn:disabled{opacity:.5;cursor:default}',
      // 待送的附件列：卡片裡、輸入框上面，橫向捲動（很多個也不會把卡片撐開）。
      '.dsh-tv-attachRow{display:flex;flex-wrap:wrap;gap:6px;padding:4px 6px 0}',
      '.dsh-tv-attachChip{display:inline-flex;align-items:center;gap:6px;max-width:100%;',
      'padding:2px 4px 2px 6px;border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-pill);',
      'background:var(--dsh-tv-surface-2);font-size:12px;line-height:18px;color:var(--dsh-tv-text-2)}',
      '.dsh-tv-attachChipErr{border-color:var(--dsh-tv-danger);color:var(--dsh-tv-danger)}',
      '.dsh-tv-attachThumb{width:20px;height:20px;flex:none;border-radius:var(--dsh-tv-radius-sm);object-fit:cover}',
      '.dsh-tv-attachIcon{flex:none;font-size:12px}',
      '.dsh-tv-attachName{max-width:15em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-tv-attachSize{flex:none;font-size:10.5px;color:var(--dsh-tv-text-3);font-variant-numeric:tabular-nums}',
      '.dsh-tv-attachDrop{width:18px;height:18px;flex:none;display:grid;place-items:center;padding:0;border:none;',
      'border-radius:var(--dsh-tv-radius-pill);background:none;color:var(--dsh-tv-text-3);cursor:pointer}',
      '.dsh-tv-attachDrop:hover{color:var(--dsh-tv-danger);background:var(--dsh-tv-surface-1)}',
      // 訊息裡的附件：圖片畫出來（上限 220px 高，不要讓一張圖吃掉整個畫面）、
      // 其他檔案是一顆可以點開的 chip。
      '.dsh-tv-msgMedia{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;max-width:100%}',
      '.dsh-tv-msgImgLink{display:block;line-height:0}',
      '.dsh-tv-msgImg{max-width:220px;max-height:220px;border-radius:var(--dsh-tv-radius-md);',
      'border:1px solid var(--dsh-tv-line);object-fit:cover;display:block}',
      '.dsh-tv-fileChip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 9px;',
      'border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-pill);',
      'background:var(--dsh-tv-surface-1);font-size:12px;line-height:18px;color:var(--dsh-tv-text-2);',
      'text-decoration:none}',
      '.dsh-tv-fileChip:hover{border-color:var(--dsh-tv-accent);color:var(--dsh-tv-text-1)}',
      '.dsh-tv-fileChipName{max-width:18em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // 「只送給模型、沒有存進房間」的那一種：一樣的 chip，但**不是連結**（不要假裝點得開）。
      '.dsh-tv-fileChipFlat{opacity:.75;border-style:dashed}',
      '.dsh-tv-fileChipSize{flex:none;font-size:10.5px;color:var(--dsh-tv-text-3);font-variant-numeric:tabular-nums}',

      '.dsh-tv-send{box-sizing:border-box;width:34px;height:34px;flex:none;display:grid;place-items:center;border:none;border-radius:var(--dsh-tv-radius-pill);background:var(--dsh-tv-accent);color:var(--dsh-tv-surface-0);cursor:pointer;transform:translateY(-2px)}',
      '.dsh-tv-send:hover:not(:disabled){filter:brightness(1.08)}',
      '.dsh-tv-send:disabled{opacity:.5;cursor:default}',
      '.dsh-tv-sendStop{width:10px;height:10px;border-radius:3px;background:currentColor}',
      // 用量那一列：**卡片裡面**、整排置中。度量照抄 DSH 自己那排統計與那顆計量環
      // （`dsh-client-ui-chat` 的 `.bOPqQW_*`、`dsh-client-ui-conversation` 的 `.JObwrW_*`）：
      //   pill 是 `button`：`background:0 0;border:none;border-radius:24px;padding:1px 8px`，
      //   圖示與文字 `gap:6px`；群組之間 `gap:12px`；`·` 自己帶左右 6px；
      //   字級 13px／行高 20px。只有顏色換成酒館自己的 token。
      // 右下那一組（DSH 的 uV2eYG_trailing）＋ 模型 chip 與它的選單。
      //
      // ⚠️ **這一整段是照 DSH 的 `ui-model-selection` 抄的**（讀它的 `client.js` 與
      // `ModelSelect.module.css`，不是看圖猜的）。它那顆 chip 的結構是：
      //
      //   ._7KE1Ra_root            position:relative（選單掛在這裡）
      //     button._7KE1Ra_trigger  28px、膠囊圓角、gap 4、padding 0 4px 0 8px、13／500
      //       svg._7KE1Ra_triggerIcon  16×16（模型圖示）
      //       span._7KE1Ra_triggerLabel  模型**顯示名稱**（不是 id）
      //       span._7KE1Ra_triggerEffort 推理等級（可以壓縮：flex-shrink:1000）
      //       svg._7KE1Ra_chevron        14×14，開啟時轉 180 度
      //     ._7KE1Ra_menu            選單（position:fixed ＋ portal；酒館改成 root 內絕對定位）
      //
      // 「root 包住 trigger、選單也在 root 裡」是關鍵：選單用 `right:0` 就**精準貼齊
      // chip 的右緣**，不必量座標、不必 portal（那兩招在這個 repo 都失敗過，見下方註解）。
      '.dsh-tv-modelRoot{position:relative;display:inline-flex;min-width:0}',
      // ⚠️ `max-width` 要照 DSH 給得**夠寬**（它是 `min(360px,45cqw)`）：太小會先把
      // 「推理等級」那一格擠成一個字（實測 `Max` → `M`）。等級那一格有 `flex-shrink:1000`，
      // 所以真的不夠寬時它會先讓位、模型名再省略——那才是 DSH 的優先序。
      '.dsh-tv-modelChip{min-width:0;max-width:min(320px,45vw);height:28px;display:inline-flex;align-items:center;gap:4px;padding:0 4px 0 8px;border:none;border-radius:var(--dsh-tv-radius-pill);background:none;color:var(--dsh-tv-text-3);font:inherit;font-size:13px;font-weight:500;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}',
      '.dsh-tv-modelChip:hover{color:var(--dsh-tv-text-1)}',
      '.dsh-tv-modelChip:disabled{opacity:.5;cursor:default}',
      // 模型圖示（DSH 的 `IconDataOutline16`）。空間不夠時 DSH 只留圖示、把文字收起來；
      // 酒館的 chip 有 180px 上限，兩段字一起出現沒問題，所以圖示固定顯示。
      '.dsh-tv-modelIcon{flex:none;display:block;color:var(--dsh-tv-text-3)}',
      // chip 上的兩段字：模型名（`triggerLabel`）＋ 推理等級（`triggerEffort`）。
      // 等級那一格比模型名淡一級，而且**可以壓縮**（DSH 的 `flex-shrink:1000`）——
      // 空間不夠時先讓等級讓位，不是把模型名切掉。
      '.dsh-tv-modelLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-tv-modelEffortTag{min-width:0;flex-shrink:1000;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsh-tv-text-3);opacity:.9;font-weight:400}',
      '.dsh-tv-modelChip:hover .dsh-tv-modelEffortTag{color:var(--dsh-tv-text-2)}',
      '.dsh-tv-modelChevron{flex:none;color:var(--dsh-tv-text-3);transition:transform .12s}',
      '.dsh-tv-modelChevronOpen{transform:rotate(180deg)}',
      // 選單本體：照 DSH 的 ._7KE1Ra_menu（border-radius:20px、padding:4px、
      // width:max-content、min-width:min(240px,100vw-32px)、max-width:min(420px,100vw-32px)、
      // max-height:min(360px,100vh-96px)）。
      //
      // ⚠️ **不 portal、不用 position:fixed**：DSH 對 `document.body` 開 portal 是因為它的
      // composer 住在有 overflow 的容器裡；酒館的卡片沒有那個問題，而 portal＋fixed
      // 在這裡**試過兩次都失敗**（fixed 的祖先帶 transform 時基準會跑掉；自己算座標
      // 算出來是負的 → 面板被丟到畫面外＝使用者「完全看不見」）。
      // 現在掛在 `._7KE1Ra_root` 對應的 `.dsh-tv-modelRoot` 裡，`right:0` 就貼齊 chip。
      // ⚠️ **兩顆 chip 在相反的兩側，所以選單要往相反的方向長。**
      //
      // 模型 chip 在 composer 的**右邊** → `right:0`，選單貼右緣往左長（沒問題）。
      // 工具權限 chip 在**左邊**（📎 右邊）→ 它也 `right:0` 的話會往左長**出去**，
      // 被 `.dsh-tv-mapBody` 的 `overflow:auto` **裁掉**：實測 chip 在 x=354、
      // 面板 302px 寬 → 左緣跑到 x=147，也就是**越過主面板左界（280）133px**，
      // 而 `scrollWidth === clientWidth`（連捲都捲不到）→ 只看得到 169px。
      // 使用者回報：「選單框出界不在 windows 中」。
      //
      // ⚠️ 驗證的時候**不可以只跟視窗比**：面板確實「在視窗內」（147 > 0），
      // 但它在**捲動祖先**的界外。真正的邊界是 `.dsh-tv-mapBody` 的 rect。
      '.dsh-tv-usagePanel.dsh-tv-modelPanel{left:auto;right:0;transform:none;width:max-content;min-width:min(240px,calc(100vw - 40px));max-width:min(320px,calc(100vw - 40px));max-height:min(360px,calc(100vh - 96px));overflow:hidden;padding:4px;border-radius:var(--dsh-tv-radius-lg)}',
      '.dsh-tv-usagePanel.dsh-tv-permPanel{left:0;right:auto;transform:none;width:max-content;min-width:min(240px,calc(100vw - 40px));max-width:min(320px,calc(100vw - 40px));max-height:min(360px,calc(100vh - 96px));overflow:hidden;padding:4px;border-radius:var(--dsh-tv-radius-lg)}',
      // ── 工具權限那一顆 chip（酒館版的「訪問模式」）────────────────────────
      //
      // ⚠️ **它不是 DSH 的訪問模式**，是**酒館自己的工具權限**（`tavern.json`／
      // `room.json` 的 `allowTools`）搬到 composer 上。兩者是**不同的軸**：
      // 訪問模式＝沙箱邊界 ＋ 要不要問你（宿主半的 permission preset）；
      // 工具權限＝**模型看得到哪些工具**（`ctx.tools.restrict` 的遮罩）。
      // 疊在一起會變成兩套很像但效果不同的控制——所以只做後面那一個。
      '.dsh-tv-permRoot{position:relative;display:inline-flex;min-width:0;flex:none}',
      '.dsh-tv-permChip{min-width:0;max-width:min(240px,38vw);height:28px;display:inline-flex;align-items:center;gap:4px;padding:0 4px 0 6px;border:none;border-radius:var(--dsh-tv-radius-pill);background:var(--dsh-tv-surface-2);color:var(--dsh-tv-text-2);font:inherit;font-size:12.5px;line-height:1;cursor:pointer}',
      '.dsh-tv-permChip:hover{color:var(--dsh-tv-text-1)}',
      '.dsh-tv-permChip:disabled{opacity:.5;cursor:default}',
      '.dsh-tv-permLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // 「聽酒館的」時，右邊那一小格顯示**實際生效**的那一級（DSH 的 chip 也是
      // 「圖示 ＋ 標籤 ＋ 值 ＋ 箭頭」，所以形狀一致）。
      '.dsh-tv-permTag{min-width:0;flex-shrink:1000;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsh-tv-text-3)}',
      '.dsh-tv-permChip:hover .dsh-tv-permTag{color:var(--dsh-tv-text-2)}',
      '.dsh-tv-permDesc{color:var(--dsh-tv-text-3);font-size:12px;line-height:16px}',
      // 第一層（DSH 的 `._7KE1Ra_cell`）：一列 40px，「標籤靠左、目前的值靠右、右邊箭頭」。
      '.dsh-tv-modelCell{box-sizing:border-box;width:auto;min-width:100%;height:40px;display:flex;align-items:center;gap:8px;padding:0 10px;border:none;border-radius:var(--dsh-tv-radius-sm);background:none;color:var(--dsh-tv-text-1);font:inherit;font-size:14px;line-height:22px;text-align:left;cursor:pointer}',
      '.dsh-tv-modelCell:hover{background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-modelCellLabel{flex:none;white-space:nowrap}',
      '.dsh-tv-modelCellValue{flex:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsh-tv-text-3)}',
      '.dsh-tv-modelCellChevron{flex:none;color:var(--dsh-tv-text-3);transform:rotate(-90deg)}',
      '.dsh-tv-modelList{display:flex;flex-direction:column;min-height:0;overflow-y:auto}',
      // 一個提供方一段（DSH 的 `._7KE1Ra_group`：`section` ＋ 自己的 groupTitle）。
      '.dsh-tv-modelSection{display:flex;flex-direction:column}',
      '.dsh-tv-modelSection+.dsh-tv-modelSection{margin-top:4px}',
      // 分組標題：DSH 讓它 sticky 在頂端（捲動時還知道自己在哪個提供方底下）。
      '.dsh-tv-modelGroup{position:sticky;top:0;z-index:1;margin-top:4px;background:var(--dsh-tv-surface-1);color:var(--dsh-tv-text-3);padding:5px 8px 3px;font-size:12px;font-weight:500;line-height:18px}',
      '.dsh-tv-modelGroup:first-child{margin-top:0}',
      // 選項：min-height:38px、圓角 10px、gap 8（._7KE1Ra_option）。模型與等級**同一種列**。
      // 工具權限那六個選項**共用同一組樣式**（多一個 class 只是為了在原始碼裡看得出
      // 誰是誰）——另開一組只會慢慢走散。
      '.dsh-tv-modelItem,.dsh-tv-permItem{box-sizing:border-box;width:auto;min-width:100%;min-height:38px;display:flex;align-items:center;gap:8px;padding:6px 8px;border:none;border-radius:var(--dsh-tv-radius-sm);background:none;color:var(--dsh-tv-text-1);font:inherit;text-align:left;cursor:pointer}',
      '.dsh-tv-modelItem:hover,.dsh-tv-permItem:hover{background:var(--dsh-tv-surface-2)}',
      '.dsh-tv-modelItem:disabled,.dsh-tv-permItem:disabled{color:var(--dsh-tv-text-3);cursor:default}',
      // 模型名：14px／500（._7KE1Ra_modelName）——我先前用 12px，難怪不像。
      '.dsh-tv-modelCopy{flex:1;min-width:0;display:flex;flex-direction:column}',
      '.dsh-tv-modelId{color:var(--dsh-tv-text-3);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-tv-modelName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px}',
      // 選中的那一顆用**打勾**（._7KE1Ra_check：18px、label-primary），不是「目前」兩個字。
      // 空狀態（`empty.efforts` 那類）：padding 10、13px／20（._7KE1Ra_empty）。
      '.dsh-tv-modelCheck{flex:0 0 18px;display:grid;place-items:center;color:var(--dsh-tv-text-1)}',
      '.dsh-tv-modelEmpty{padding:10px;font-size:13px;line-height:20px;color:var(--dsh-tv-text-3)}',
      '.dsh-tv-usage{position:relative;flex:none;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px 12px;margin-top:6px;font-size:13px;line-height:20px;color:var(--dsh-tv-text-3)}',
      '.dsh-tv-usagePill{box-sizing:border-box;max-width:100%;display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border:none;border-radius:var(--dsh-tv-radius-pill);background:none;font:inherit;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--dsh-tv-text-3);cursor:pointer}',
      '.dsh-tv-usagePill:hover{color:var(--dsh-tv-text-1)}',
      '.dsh-tv-usageSep{color:var(--dsh-tv-line);margin:0 6px}',
      '.dsh-tv-usageNum{color:var(--dsh-tv-text-1);font-variant-numeric:tabular-nums}',
      '.dsh-tv-usageRingTrack{fill:none;stroke:var(--dsh-tv-line);stroke-width:2px}',
      '.dsh-tv-usageRingFill{fill:none;stroke:var(--dsh-tv-text-3);stroke-width:2px;stroke-linecap:round}',
      '.dsh-tv-usageRingWarn{stroke:var(--dsh-tv-warn)}',
      '.dsh-tv-usageRingCrit{stroke:var(--dsh-tv-danger)}',
      // 點開的面板：照 DSH 那顆計量環的面板（12px 字、20px 行高、一條組成的分段條）。
      // 面板**往上開**（DSH 那顆計量環的面板就是 position:absolute;bottom:calc(100% + 8px)）
      // ——輸入框貼在對話頁底部，往下長一定會被切掉（實際踩到）。
      '.dsh-tv-usagePanel{box-sizing:border-box;position:absolute;z-index:100;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);width:330px;max-width:calc(100vw - 40px);max-height:52vh;overflow-y:auto;padding:10px 12px;border:1px solid var(--dsh-tv-line);border-radius:var(--dsh-tv-radius-md);background:var(--dsh-tv-surface-1);font-size:12px;line-height:20px;color:var(--dsh-tv-text-3);cursor:default}',
      '.dsh-tv-usageBreak{display:flex;height:4px;border-radius:3px;overflow:hidden;background:var(--dsh-tv-line);margin:2px 0 8px}',
      '.dsh-tv-usageBreakSystem{background:var(--dsh-tv-accent)}',
      '.dsh-tv-usageBreakTools{background:var(--dsh-tv-warn)}',
      '.dsh-tv-usageBreakMessages{background:var(--dsh-tv-text-3)}',
      // 面板的段落與列：**照 DSH 那個對話框**（標籤靠左、數字靠右；它那顆環的面板用的
      // 也是 margin-left:auto 的數字）。
      '.dsh-tv-usageSection{margin-top:10px}',
      '.dsh-tv-usageSection:first-child{margin-top:0}',
      '.dsh-tv-usageTitle{color:var(--dsh-tv-text-2);font-weight:600;margin-bottom:2px}',
      '.dsh-tv-usageLine{display:flex;align-items:baseline;gap:12px}',
      '.dsh-tv-usageFig{margin-left:auto;color:var(--dsh-tv-text-1);font-variant-numeric:tabular-nums}',
      '.dsh-tv-usageReload{font:inherit;color:var(--dsh-tv-text-3);background:none;border:none;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}',
      '.dsh-tv-usageReload:hover{color:var(--dsh-tv-text-1)}',
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

    /**
     * 一個標準欄位（標籤 ＋ 輸入框或 textarea）。
     *
     * ⚠️ 標籤走 `FieldLabel`（2.6.65）：有 `hint` 時多一顆 `?`，
     * **說明平時摺疊起來**（使用者的要求，見 `FieldLabel` 的註解）。
     */
    function MapField(props) {
      return React.createElement(
        'label',
        { className: 'dsh-tv-field' },
        React.createElement(FieldLabel, { text: props.label, hint: props.hint }),
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
        // ⚠️ 說明**不在這裡**了——它由標籤那顆 `?` 控制展開。畫在兩個地方
        // 會變成同一份說明出現兩次。
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
     * 資產 URL 的前綴。**宿主半的 `assets.js` 也有一份**（`ASSET_ROUTE_PREFIX`）——
     * 瀏覽器半是一支手寫的 bundle，不能 import 宿主半的模組，所以兩邊各一份常數；
     * `test-client.mjs` 會比對兩者一致。
     */
    var ASSET_PREFIX = '/api/dsh-tavern/assets/'

    /**
     * 把資產 URL 變成瀏覽器真的拿得到的形狀：**多補一個斜線**。
     *
     * DSH 的 `webServer` 比對規則是
     *     pathname === prefix || pathname.startsWith(prefix + '/')
     * ——它**自己會補一個斜線**再比。2.6.1 之前的宿主半把路由註冊成
     * `/api/dsh-tavern/assets/`（**結尾帶斜線**），於是實際吃得進的是
     * `startsWith('…/assets/' + '/')`，也就是 `…/assets//…`；
     * 正常的單斜線 URL 會落到 DSH 自己的 fallback（curl 看到 401、瀏覽器看到 404），
     * 症狀看起來完全像「圖不存在」，但檔案一直都在。
     *
     * `…/assets//…` 這個形狀**新舊宿主都吃**：
     *   舊（註冊 `…/assets/`）→ `startsWith('…/assets//')` ✓
     *   新（註冊 `…/assets`，2.6.1 起）→ `startsWith('…/assets/')` ✓
     * 所以補這一個斜線是安全的，而且**這是唯一同時相容兩者的形狀**。
     *
     * 為什麼修在這裡而不是修宿主：URL 是宿主半產生、隨 `assets.list` 傳過來的，
     * 改宿主對「已經在跑的舊宿主」沒有用；瀏覽器半才是即時生效的那一半。
     * 等沒有舊宿主在外面跑之後，這個函式就可以整支拿掉。
     */
    function assetSrc(url) {
      if (typeof url !== 'string') return url
      if (url.indexOf(ASSET_PREFIX) !== 0) return url
      return ASSET_PREFIX + '/' + url.slice(ASSET_PREFIX.length)
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
          if (assets.items[i].name === name && typeof assets.items[i].url === 'string') return assetSrc(assets.items[i].url)
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
      // 以下是 v2／v3 有、而先前沒有開出來的欄位。判準是 CCv3 的 `data` 介面
      // （character-card-spec-v3）：
      //   - 最該補的是 `alternate_greetings`：「＋ 新對話」的開場白選單**就是讀它**，
      //     而編輯器編不了它——那個功能等於只能靠外面的檔案餵。
      //   - `group_only_greetings` 是規格裡**寫死 MUST** 的欄位，開出來才進得了檔案
      //     （我們沒有群組對話，所以留空即可，但不能沒有）。
      //   - **刻意不開**：`source` 與 `creation_date`／`modification_date`
      //     （規格說 SHOULD NOT 由使用者編輯）、`assets`（插圖管理器負責）、
      //     `character_book`（那是獨立世界書）、`extensions`（原樣保存，見 CardAssets）。
      { key: 'nickname', label: '暱稱 nickname', hint: 'v3。{{char}} 替換時用它而不是 name；留空就用 name' },
      { key: 'creator_notes', label: '作者的話 creator_notes', rows: 3, textarea: true, hint: '給人看的說明，不會進提示詞' },
      { key: 'tags', label: '標籤 tags', rows: 2, textarea: true, lines: true, hint: '一行一個' },
      { key: 'alternate_greetings', label: '其他開場白 alternate_greetings', rows: 5, textarea: true, lines: true, hint: '一行一個。「＋ 新對話」的開場白選單就是讀這裡' },
      { key: 'group_only_greetings', label: '群組開場白 group_only_greetings', rows: 3, textarea: true, lines: true, hint: 'v3 寫死必填的欄位（群組對話用；目前沒有群組對話，留空即可）' },
      { key: 'creator', label: '作者 creator', hint: '誰做的這張卡' },
      { key: 'character_version', label: '卡片版本 character_version', hint: '這張卡自己的版本，跟規格版本無關' },
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
        /**
         * ⚠️ **卡片本體不是插圖**（`source: 'card'`）：那是 `characters/<id>.png`，
         * 不是 `art/` 底下的檔案——所以**不給刪**（`assets.delete` 只會去刪 `art/` 裡
         * 一個不存在的东西），也不能用插圖的規矩理解它。它仍然可以被指定為主圖。
         */
        var isCard = item.source === 'card'
        return React.createElement(
          'div',
          { key: item.name, className: isPrimary ? 'dsh-tv-thumb dsh-tv-thumbOn' : 'dsh-tv-thumb' },
          React.createElement('img', {
            src: assetSrc(item.url),
            alt: item.name,
            title:
              item.name +
              '（' +
              formatBytes(item.bytes) +
              (isCard ? '，這是卡片本體' : '') +
              '）',
            loading: 'lazy',
            onClick: function () {
              setPrimary(item.name)
            },
          }),
          isPrimary ? React.createElement('span', { className: 'dsh-tv-thumbTag' }, '主圖') : null,
          isCard
            ? React.createElement('span', { className: 'dsh-tv-thumbTag dsh-tv-thumbTagCard' }, '卡片')
            : React.createElement(
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
                  src: assetSrc(item.url),
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
          // 「進階」預設收合：破壞性動作不該攤在畫面上等人誤按。
          advanced: false,
        }
      }
      var state = ref.current

      /**
       * 這一間酒館目前的回覆格式（`render.json`）。
       *
       * ⚠️ `props.render` 是**那一份設定本身**（`{ mode, markers, quotes, parens,
       * choicesClickable }`），不是宿主回的外層信封——`loadTavernData` 已經拆過一層。
       * 沒有它（舊宿主、或還沒載入）就用預設值，而預設值與 `lib/render.js` 的
       * `defaultRender()` 同一條：`mode: 'plain'`。
       */
      function currentRender() {
        var one = props.render !== null && props.render !== undefined && typeof props.render === 'object' ? props.render : {}
        return {
          mode: RENDER_MODES.indexOf(one.mode) >= 0 ? one.mode : 'plain',
          markers: Array.isArray(one.markers) ? one.markers : [],
          choicesClickable: one.choicesClickable === true,
        }
      }

      /**
       * 寫回覆格式。
       *
       * ⚠️ **`render.write` 是整份寫入，不是 patch**（同 `theme.write`）——
       * 所以要送的是「目前這一刻的完整一份」。送一個片段過去會把沒送到的欄位
       * 全部清成預設值（同一型的 `theme.write` 實測踩過：先寫 `radius-md`、
       * 再寫一個打錯的 key → token 變成 `{}`）。
       */
      function commitRender(patch) {
        var base = currentRender()
        var next = {
          mode: patch.mode === undefined ? base.mode : patch.mode,
          choicesClickable: patch.choicesClickable === undefined ? base.choicesClickable : patch.choicesClickable,
          markers: Array.isArray(patch.markers) ? patch.markers : base.markers,
        }
        state.busy = true
        state.error = ''
        state.message = ''
        render()
        rpc('render.write', { id: props.tavern.id, patch: next })
          .then(function (saved) {
            state.busy = false
            // ⚠️ 同 `commit()`：宿主半會把「不合法所以沒存下來」的欄位放在
            // `dropped` 裡。**不回報就等於沒驗**——使用者會以為格式設好了。
            if (saved !== null && saved !== undefined && Array.isArray(saved.dropped) && saved.dropped.length > 0) {
              state.error = '這幾項沒有存下來：' + saved.dropped.join('、')
            } else {
              state.message = '已更新回覆格式'
            }
            render()
            if (typeof props.reload === 'function') props.reload()
          })
          .catch(function (error) {
            state.busy = false
            state.error = String((error && error.message) || error)
            render()
          })
      }

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
        // `{{user}}` 要換成什麼。存在 tavern.json 的 `userName`——它是「你是誰」，
        // 跨對話不該變，所以放酒館層級而不是每個對話。
        // ⚠️ 讀它的是 **agent 面**（宿主半），所以改完要**重啟 `dsh web`** 才會
        // 反映到提示詞裡；這一行字是故意留的，免得又出現「設了但沒生效」。
        React.createElement(
          'div',
          { className: 'dsh-tv-fieldLabel', style: { marginTop: '10px' } },
          '你的名字（{{user}}，存在 tavern.json）',
        ),
        React.createElement('input', {
          className: 'dsh-tv-in',
          'aria-label': '你的名字',
          value:
            state.userName === undefined
              ? (props.settings && props.settings.userName) || ''
              : state.userName,
          placeholder: '留空就用「你」（agent 面的預設值）',
          onChange: function (event) {
            state.userName = event.target.value
            render()
          },
        }),
        React.createElement(
          'div',
          { className: 'dsh-tv-inlineRow', style: { marginTop: '6px' } },
          React.createElement(
            MapBtn,
            {
              onClick: function () {
                props.commit({
                  userName:
                    state.userName === undefined
                      ? (props.settings && props.settings.userName) || ''
                      : state.userName,
                })
              },
              disabled: state.busy || typeof props.commit !== 'function',
            },
            '儲存名字',
          ),
        ),
        // 工具權限：這個角色能不能讀檔／改檔／上網。**預設全關**。
        // 這是安全開關，所以選項直接寫出「它拿到什麼」，不給模糊的「一些工具」。
        // ⚠️ 讀它的是 agent 面（宿主半），改完要**重啟 `dsh web`** 才生效。
        React.createElement(MapSelect, {
          label: '這個角色能用哪些工具（預設全關）',
          value:
            state.allowTools === undefined
              ? (props.settings && props.settings.allowTools) || 'none'
              : state.allowTools,
          hint: '全關＝它看不到也改不了你的檔案。開放之後它就跟你自己的 agent 一樣能動那些工具。',
          options: TOOL_LEVEL_OPTIONS,
          onChange: function (value) {
            state.allowTools = value
            if (typeof props.commit === 'function') props.commit({ allowTools: value })
          },
        }),
        // 這兩欄是**輸入**：agent 面會接在角色卡後面一起送進去。
        // 跟下面的「備註」不一樣——`note` 只給人看，不會進提示詞。
        // ⚠️ 讀它們的是 agent 面（宿主半），改完要**重啟 `dsh web`** 才會生效。
        React.createElement(
          'div',
          { className: 'dsh-tv-fieldLabel', style: { marginTop: '10px' } },
          '你是誰（persona，接在角色卡後面）',
        ),
        React.createElement('textarea', {
          className: 'dsh-tv-ta',
          rows: 3,
          'aria-label': '你是誰',
          placeholder: '例：我是巡迴的藥商，話不多，習慣先觀察再說。',
          value:
            state.userPersona === undefined
              ? (props.settings && props.settings.userPersona) || ''
              : state.userPersona,
          onChange: function (event) {
            state.userPersona = event.target.value
            render()
          },
        }),
        React.createElement(
          'div',
          { className: 'dsh-tv-fieldLabel', style: { marginTop: '10px' } },
          '這間店的規則（每輪都會帶進去）',
        ),
        React.createElement('textarea', {
          className: 'dsh-tv-ta',
          rows: 3,
          'aria-label': '這間店的規則',
          placeholder: '例：店裡沒有現代科技；她不會主動說出自己的來歷。',
          value:
            state.tavernPrompt === undefined
              ? (props.settings && props.settings.tavernPrompt) || ''
              : state.tavernPrompt,
          onChange: function (event) {
            state.tavernPrompt = event.target.value
            render()
          },
        }),
        React.createElement(
          'div',
          { className: 'dsh-tv-inlineRow', style: { marginTop: '6px' } },
          React.createElement(
            MapBtn,
            {
              onClick: function () {
                props.commit({
                  userPersona:
                    state.userPersona === undefined
                      ? (props.settings && props.settings.userPersona) || ''
                      : state.userPersona,
                  tavernPrompt:
                    state.tavernPrompt === undefined
                      ? (props.settings && props.settings.tavernPrompt) || ''
                      : state.tavernPrompt,
                })
              },
              disabled: state.busy || typeof props.commit !== 'function',
            },
            '儲存這兩項',
          ),
        ),
        /**
         * 回覆格式（`<酒館>/render.json`）。
         *
         * ⚠️ **這一格以前不存在，而少的就是「指定」那一半。**
         * 客戶端早就讀得懂結構化的一行（`parseStructuredLine`）與標記
         * （`parseMarkedRegions`），但**沒有任何提示詞告訴模型要那樣寫**——
         * 所以永遠是「模型寫小說、我們在後面猜」，而 `choices`／`data` 這些
         * kind 一次都沒有出現過。選了模式之後，agent 面會把格式指令接進提示詞。
         *
         * ⚠️ `plain` 是預設，而且它**一個字都不加**——那是「既有對話行為不變」
         * 的實作方式，不要為了「一致性」讓 plain 也講一句。
         */
        React.createElement(MapSelect, {
          label: '回覆格式（存進這間酒館的 render.json）',
          value: currentRender().mode,
          hint:
            '這一格決定**我們怎麼跟模型說「請這樣回」**。plain＝一個字都不加（與以前完全一樣）；' +
            'marked＝教它用標記（好讀、省 token）；structured＝教它一行一個 JSON（最精確，' +
            'who／選項／數值狀態才可靠）。⚠️ 改完**下一輪對話**就生效（它進的是系統提示）。',
          options: [
            {
              value: 'plain',
              label: '不用（純文字）',
              hint: '一個字都不加——模型照平常寫小說，我們靠排版慣例讀（引號＝台詞、括號＝動作）。與以前完全一樣。',
            },
            {
              value: 'marked',
              label: '標記',
              hint: '教它用標記分類（<台詞>、<旁白>…）。好讀、便宜，壞掉只損失一個區塊。',
            },
            {
              value: 'structured',
              label: 'JSON（一行一個）',
              hint:
                '教它一行一個 JSON 物件。最精確——**誰說的**、**選項**、**數值狀態** 才可靠；' +
                '代價是每一行多約 30 個字元。',
            },
          ],
          onChange: function (value) {
            commitRender({ mode: value })
          },
        }),
        /**
         * ⚠️ **「一個東西兩個來源」的警告。**
         *
         * 格式指令可以有兩個老師：**世界書**（`constant` 條目，住在訊息裡）與
         * **這一格**（plugin 送進系統提示）。兩個同時開著就會給模型**兩份規格**
         * （例如 `data` 一邊說用 `text`、一邊說用 `rows`），而模型會挑一個
         * ——你看到的是「有時候是表格、有時候是一行文字」。
         *
         * 兩邊其實都吃得下（`parseDataRows` 兩種寫法都認），但**只有一份**才是
         * 可預期的。所以這裡直接講出來，並說清楚兩個選項各自要做什麼。
         */
        formatWarning(props, currentRender()),
        /**
         * ⚠️ **「補上／更新預設內容」**（2.6.65）。
         *
         * 新建酒館會自動拿到出貨的預設（老闆娘、世界書、格式說明）；**既有的不會**
         * ——`seed()` 只在建立時跑一次。所以出貨內容的修正（例如新的
         * 「哪種內容用哪個 kind」那一條）到不了舊酒館手上，而使用者的感想
         * 會是「更新了但沒變」。
         *
         * ⚠️ **做成按鈕而不是自動的**：讀取路徑不寫檔是這個 repo 的硬規則
         * （讀取順手補結構曾經讓「舊版殘留」的標記自己消失）。按了之後
         * **把動了什麼講出來**——不藏在背景。
         */
        React.createElement(
          'div',
          { className: 'dsh-tv-inlineRow', style: { marginTop: '10px' } },
          React.createElement(
            MapBtn,
            {
              disabled: state.busy,
              title:
                '把出貨的預設補進這一間酒館：缺的世界書會建、沒改過的格式說明會更新成出貨版本。' +
                '你改過的東西一律不動。',
              onClick: function () {
                state.busy = true
                state.error = ''
                state.message = ''
                render()
                rpc('tavern.repair', { id: props.tavern.id })
                  .then(function (result) {
                    state.busy = false
                    var changed = result !== null && result !== undefined && Array.isArray(result.changed) ? result.changed : []
                    var skipped = result !== null && result !== undefined && Array.isArray(result.skipped) ? result.skipped : []
                    state.message =
                      changed.length === 0
                        ? '沒有東西要補（已經是最新的）' + (skipped.length > 0 ? '；' + skipped.join('、') : '')
                        : '已補上：' + changed.join('、') + (skipped.length > 0 ? '；保留：' + skipped.join('、') : '')
                    render()
                    if (typeof props.reload === 'function') props.reload()
                  })
                  .catch(function (error) {
                    state.busy = false
                    state.error = '補預設失敗：' + String((error && error.message) || error)
                    render()
                  })
              },
            },
            '🧩 補上／更新預設內容',
          ),
        ),
        // `choices` 可不可以點（點了只填進輸入框，不直接送出）。
        // ⚠️ 預設**關**：模型的「選項」有可能是它自己編的劇情大綱，
        //    自動塞一段草稿進輸入框會讓人莫名其妙。
        React.createElement(MapToggle, {
          label: '讓「選項」可以點（點了填進輸入框，不會直接送出）',
          checked: currentRender().choicesClickable,
          disabled: state.busy,
          hint: '模型用 `choices` 給選項時（structured 模式的 {"kind":"choices"}，或 marked 模式的對應標記）。',
          onChange: function (next) {
            commitRender({ choicesClickable: next })
          },
        }),
        // 生成參數（temperature／maxTokens）。
        //
        // ⚠️ **留空＝不設定**，不是「用 0」也不是「用某個我們覺得好的預設」。
        // 我們沒設定的時候，那些值應該由 DSH 與提供方決定——塞一個自己的預設值
        // 會**改變既有對話的行為**，而使用者根本沒有要求過。
        //
        // ⚠️ **沒有 top_p，這是刻意的。** DSH 的 `LlmCallConfig` 只有
        // provider／model／reasoningEffort／temperature／maxTokens／stop
        // （`dsh-llm/lib/types/call-config.d.ts`）。做一個存得起來、送不出去的
        // 欄位比沒有這個欄位更糟——所以畫面上也不會出現它。
        React.createElement(
          'div',
          { className: 'dsh-tv-fieldLabel', style: { marginTop: '10px' } },
          '生成參數（留空＝讓 DSH 自己決定）',
        ),
        React.createElement(
          'div',
          { className: 'dsh-tv-inlineRow' },
          React.createElement('input', {
            className: 'dsh-tv-in',
            type: 'number',
            min: SAMPLER_RANGES.temperature.min,
            max: SAMPLER_RANGES.temperature.max,
            step: '0.05',
            'aria-label': '溫度',
            placeholder: '溫度（' + rangeText(SAMPLER_RANGES.temperature) + '）',
            value:
              state.temperature === undefined
                ? settingsNumber(props.settings, 'temperature')
                : state.temperature,
            onChange: function (event) {
              state.temperature = event.target.value
              render()
            },
          }),
          React.createElement('input', {
            className: 'dsh-tv-in',
            type: 'number',
            min: SAMPLER_RANGES.maxTokens.min,
            max: SAMPLER_RANGES.maxTokens.max,
            step: '1',
            'aria-label': '最多回幾個 token',
            placeholder: '最多 token（留空＝不指定）',
            value:
              state.maxTokens === undefined
                ? settingsNumber(props.settings, 'maxTokens')
                : state.maxTokens,
            onChange: function (event) {
              state.maxTokens = event.target.value
              render()
            },
          }),
        ),
        React.createElement(
          'div',
          { className: 'dsh-tv-fieldHint' },
          '溫度低＝收斂、穩定；高＝放得開。這裡的值會蓋過 DSH 自己的決定，' +
            '但**只在這一間酒館**。⚠️ DSH 的介面沒有 top_p，所以這一版也沒有（不是漏掉）。',
        ),
        // stop 序列（一行一個）。
        //
        // ⚠️ 與上面兩個數字欄位**不是同一種東西**：那兩個是旋鈕（連續變化），
        // 這一欄是**閘門**——模型吐出其中任何一個就當場停下來，而且那個字串
        // 不會出現在回覆裡。角色扮演最實用的用法是**擋住模型替你說話**。
        //
        // ⚠️ 留空＝沒有閘門（不是「用預設的幾個」）。與上面同一條規矩：
        // 我們沒設定的時候不碰 DSH 的決定。
        React.createElement(
          'div',
          { className: 'dsh-tv-fieldLabel', style: { marginTop: '10px' } },
          '停止序列（一行一個，留空＝不設）',
        ),
        // ⚠️ **開關決定「要不要送內建的那幾串」，下面的欄位是「你還要加什麼」。**
        //    這是兩個欄位而不是一個：合併的話「我有自填但不想開內建」就表達不出來。
        React.createElement(MapToggle, {
          label: '擋住它替你說話（送出內建的停止序列）',
          checked:
            state.stopEnabled === undefined
              ? (props.settings && props.settings.stopEnabled) === true
              : state.stopEnabled,
          disabled: state.busy,
          hint:
            '內建送這幾串：' +
            STOP_PRESET.map(function (one) {
              return JSON.stringify(one)
            }).join('、') +
            '——模型吐到其中一串就停，而且那一串不會出現在回覆裡。',
          onChange: function (next) {
            props.commit({ stopEnabled: next })
          },
        }),
        React.createElement('textarea', {
          className: 'dsh-tv-ta',
          rows: 3,
          'aria-label': '停止序列',
          placeholder: '例如：\n使用者：\n\\nUser:',
          value:
            state.stop === undefined
              ? stopToText(props.settings && props.settings.stop)
              : state.stop,
          onChange: function (event) {
            state.stop = event.target.value
            render()
          },
        }),
        React.createElement(
          'div',
          { className: 'dsh-tv-fieldHint' },
          '模型吐出這幾串字的任何一個就會停下來，而且那一串**不會出現在回覆裡**' +
            '——最常用的時機是擋住它替你說話。⚠️ 最多 ' +
            String(STOP_LIMITS.count) +
            ' 個、每個最多 ' +
            String(STOP_LIMITS.length) +
            ' 個字；完全相同的會去掉，順序照你寫的。',
        ),
        React.createElement(
          'div',
          { className: 'dsh-tv-inlineRow', style: { marginTop: '6px' } },
          React.createElement(
            MapBtn,
            {
              onClick: function () {
                props.commit({
                  temperature: samplerPatchValue(
                    state.temperature === undefined
                      ? settingsNumber(props.settings, 'temperature')
                      : state.temperature,
                  ),
                  maxTokens: samplerPatchValue(
                    state.maxTokens === undefined
                      ? settingsNumber(props.settings, 'maxTokens')
                      : state.maxTokens,
                  ),
                  stop: stopPatchValue(
                    state.stop === undefined
                      ? stopToText(props.settings && props.settings.stop)
                      : state.stop,
                  ),
                })
              },
              disabled: state.busy || typeof props.commit !== 'function',
            },
            '儲存生成參數',
          ),
        ),
        // 這間酒館自己的設定檔（tavern.json）——備註是自由欄位。
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
        legacyNotice(props.legacy === true),
        // ⚠️ 「移除」是破壞性動作，**不要跟「重新命名」並排**（`plan.md` §7.5）。
        // 它收在最後的「進階」裡，而且那句「只會從清單拿掉」要跟著它——
        // 以前說明在頁尾、按鈕在標題列，兩者隔了整個畫面。
        React.createElement(
          'div',
          { className: 'dsh-tv-adv' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-tv-advToggle',
              'aria-expanded': state.advanced === true ? 'true' : 'false',
              onClick: function () {
                state.advanced = state.advanced !== true
                render()
              },
            },
            (state.advanced === true ? '▾' : '▸') + ' 進階',
          ),
          state.advanced === true
            ? React.createElement(
                'div',
                { className: 'dsh-tv-advBody' },
                React.createElement(
                  'div',
                  { className: 'dsh-tv-fieldHint' },
                  '「移除」只會把這間酒館從清單拿掉，資料夾與裡面所有檔案都不會被刪除。',
                ),
                React.createElement(
                  MapBtn,
                  { onClick: remove, disabled: state.busy, danger: true, title: '只從酒館街移除，不會刪除資料夾裡的任何檔案' },
                  '從酒館街移除',
                ),
              )
            : null,
        ),
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
    /**
     * 世界書：把原始 JSON 文字解析成物件。
     *
     * 壞掉時回 `null` 而**不是丟錯**：使用者正在打字，中途一定是壞的 JSON，
     * 丟錯會讓整個 `main` 面板變成死格（`plan.md` §7.4b 那個型別的 bug）。
     *
     * ⚠️ **頂層是陣列也要回 `null`**：`typeof [] === 'object'`，但世界書的頂層
     * 一定是 `{ entries: … }`。少了這一條，一份 `[1,2]` 會被當成「這本世界書
     * 還沒有條目」——那是錯的訊息（測試釘著這一條）。
     */
    function worldbookParse(text) {
      try {
        var parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        return parsed
      } catch (error) {
        return null
      }
    }

    /**
     * 條目清單。**兩種形狀都要吃**（跟 `lib/worldbook.js` 的 `normalizeEntries` 一致）：
     *   - 原生：`{ entries: { "0": {…} } }`——以字串化 uid 為 key 的物件
     *   - V2 內嵌：`{ entries: [ {…} ] }`
     *
     * `label` 是穩定的識別（物件 key 或陣列索引）。
     * ⚠️ **不要用物件參考去認條目**：每次改動都會重新 `JSON.parse`，參考每次都不一樣。
     */
    function worldbookEntries(book) {
      var out = []
      if (book === null || book === undefined || typeof book !== 'object') return out
      var entries = book.entries
      if (Array.isArray(entries)) {
        for (var i = 0; i < entries.length; i += 1) {
          if (entries[i] !== null && typeof entries[i] === 'object') {
            out.push({ label: String(i), ref: entries[i] })
          }
        }
        return out
      }
      if (entries !== null && entries !== undefined && typeof entries === 'object') {
        var keys = Object.keys(entries)
        for (var k = 0; k < keys.length; k += 1) {
          var one = entries[keys[k]]
          if (one !== null && typeof one === 'object') out.push({ label: keys[k], ref: one })
        }
      }
      return out
    }

    /** 條目的關鍵字（原生用 `key`、V2 用 `keys`）。 */
    function worldbookKeysOf(entry) {
      if (Array.isArray(entry.key)) return entry.key
      if (Array.isArray(entry.keys)) return entry.keys
      return []
    }

    /** 關鍵字要寫回哪一個欄位名——**不要**擅自把 `keys` 改成 `key`，那是別人的格式。 */
    function worldbookKeyField(entry) {
      return Array.isArray(entry.keys) === true && Array.isArray(entry.key) === false ? 'keys' : 'key'
    }

    /**
     * 改一個條目的欄位，回傳**新的原始文字**（純函式，所以離線測得到）。
     *
     * 走「重新解析 → 用 label 找到同一個條目 → 改它 → 重新序列化」：
     * `uid`／`order`／`selective`／我們還不認識的欄位都原樣保留，不會被吃掉。
     * 解析不了或找不到那一條 → 回 `null`（呼叫端據此不動狀態）。
     * 代價是排版會被重新格式化——要精確控制排版時走原始模式。
     */
    function worldbookPatch(text, label, field, value) {
      var book = worldbookParse(text)
      if (book === null) return null
      var list = worldbookEntries(book)
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].label !== label) continue
        list[i].ref[field] = value
        return JSON.stringify(book, null, 2) + '\n'
      }
      return null
    }

    function MapWorldbooks(props) {
      var render = useForceRender()
      var ref = React.useRef(null)
      if (ref.current === null) {
        ref.current = {
          books: [],
          selected: null,
          draft: '',
          message: '',
          error: '',
          busy: false,
          raw: false,
          // 每一本書的注入位置（`worldbook.positions` 的回應）。`null`＝還沒讀到
          // ——那時候位置那一格顯示「跟著酒館預設」，而那是**安全**的預設值。
          positions: null,
        }
      }
      var state = ref.current
      /** 匯入世界書用的隱藏 file input。 */
      var importInputRef = React.useRef(null)

      function loadList() {
        return rpc('worldbook.list')
          .then(function (books) {
            state.books = books
            render()
            /**
             * ⚠️ **順手把位置也讀回來。**
             *
             * 位置住在每一本書的檔案裡（不是清單的一部分），所以要多一趟。
             * 兩趟的順序不重要（清單先畫、位置後到），但**失敗要吞掉**：
             * 舊宿主沒有這個 op，而「位置讀不到」不該讓整份清單變錯誤。
             */
            return rpc('worldbook.positions')
              .then(function (info) {
                state.positions = info !== null && info !== undefined && Array.isArray(info.books) ? info : { fallback: '', books: [] }
                render()
              })
              .catch(function () {
                /* 舊宿主／暫時失敗：位置那一格顯示「跟著酒館預設」 */
              })
          })
          .catch(function (error) {
            state.error = String((error && error.message) || error)
            render()
          })
      }

      /**
       * 清單上那一顆位置短標籤（`null`＝還沒讀到位置，就不畫）。
       *
       * ⚠️ **`in-chat` 也要畫**（它是預設值）——不畫的話使用者會以為「沒有標籤
       * ＝沒有設定」，而實際上那是「放在訊息前面」。三種狀態都要看得見。
       */
      function positionTag(store, id) {
        var list =
          store.positions !== null && store.positions !== undefined && Array.isArray(store.positions.books)
            ? store.positions.books
            : []
        if (list.length === 0) return null
        var one = list.filter(function (b) {
          return b.id === id
        })[0]
        if (one === undefined) return null
        return React.createElement(
          'span',
          { className: 'dsh-tv-posTag', title: '放在模型的哪裡：' + WORLDBOOK_POSITION_INFO[one.position].label },
          POSITION_SHORT[one.position] ?? one.position,
        )
      }

      /**
       * 這一本書現在放在哪裡。
       *
       * ⚠️ **值域是「空字串 ＋ 三個位置」**：空字串＝跟著酒館預設
       * （那本書的檔案裡沒有 `position`）。所以這一格顯示的是**檔案裡的原始值**，
       * 而不是算完的結果——不然使用者會看到「跟著酒館預設」變成一個具體位置，
       * 然後以為自己被改過了。
       */
      function positionValueOf(id) {
        return bookPositionValue(state.positions, id)
      }

      /**
       * 改一本書的**注入位置**（只送那一個欄位，宿主半只改它）。
       *
       * ⚠️ **`null` ＝ 把 `position` 刪掉**（2.6.71 才有這個三態）：在那之前
       * 「回到跟著酒館預設」是一句**做不到的指示**——畫面上寫著「請自己到原始
       * JSON 把 position 刪掉」，那是叫使用者去用別的工具。
       *
       * ⚠️ 失敗要**說出來**：這一格顯示的是「檔案裡的值」，靜靜失敗會讓畫面
       * 與磁碟不一致（使用者以為設好了）。
       */
      function setBookPosition(id, where) {
        state.error = ''
        state.message = ''
        var cleared = where === '' || where === null
        rpc('worldbook.position', { book: id, where: cleared ? null : where })
          .then(function () {
            state.message = cleared
              ? '已把這一本書改回「跟著酒館預設」'
              : '已把這一本書放到「' + WORLDBOOK_POSITION_INFO[where].label + '」'
            render()
            return loadList()
          })
          .catch(function (error) {
            state.error = '改位置失敗：' + String((error && error.message) || error)
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

      /** 這一本的解析結果；`null`＝現在的草稿是壞的 JSON。 */
      var book = worldbookParse(state.draft)
      var entryList = worldbookEntries(book)

      /** 改一個欄位 → 寫回草稿（`worldbookPatch` 是純函式，回 `null` 就什麼都不做）。 */
      function patchEntry(label, field, value) {
        var next = worldbookPatch(state.draft, label, field, value)
        if (next === null) return
        state.draft = next
        render()
      }

      return React.createElement(
        'div',
        { className: 'dsh-tv-splitGrid' },
        React.createElement(
          'div',
          { className: 'dsh-tv-list' },
          /**
           * ⚠️ **這一間酒館的預設位置**（2.6.65）。
           *
           * 放在最上面而不是 ⚙️ 設定：它在**這裡**才有意義（「這裡全部的書預設
           * 放哪裡」），而 ⚙️ 設定 是「店本身的事」。每一本書自己的位置蓋過它。
           */
          React.createElement(MapSelect, {
            label: '這裡的世界書預設放在哪',
            value: typeof props.settings?.worldbookPosition === 'string' ? props.settings.worldbookPosition : '',
            options: [{ value: '', label: '訊息尾巴', hint: '沒有指定的書一律接在最新那則訊息前面（與以前一樣）。' }].concat(
              WORLDBOOK_POSITIONS.map(function (one) {
                return { value: one, label: WORLDBOOK_POSITION_INFO[one].label, hint: WORLDBOOK_POSITION_INFO[one].hint }
              }),
            ),
            onChange: function (value) {
              if (typeof props.commit !== 'function') return
              props.commit({ worldbookPosition: value })
              // 存完要把位置重讀（書的顯示會跟著預設走）。
              loadList()
            },
          }),
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
                    /**
                     * ⚠️ 檔名要包在**自己的元素**裡：外層是 flex 容器，而 flex 容器
                     * 裡的**裸文字節點**沒有東西可以承接 `text-overflow`——
                     * 檔案一長就會把位置標籤擠出去。
                     */
                    React.createElement('span', { className: 'dsh-tv-listName' }, book.file),
                    /**
                     * ⚠️ **清單上就要看得出來這本書放在哪**（2.6.65）。
                     *
                     * 位置那一格在編輯器裡，而編輯器要選了書才看得到——所以
                     * 沒打開任何一本書的時候，使用者完全不知道有「位置」這件事
                     * （實測回報：「我沒有看見設定位置的按鈕」）。
                     */
                    positionTag(state, book.id),
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
                /**
                 * ⚠️ **這本書要放在模型的哪裡**（2.6.65）。
                 *
                 * 這是一格**很重要的設定**，因為它決定模型把這段字讀成什麼：
                 * `system-after`（角色卡後面）＝規則與格式，遵從度最高；
                 * `in-chat`（接在最新訊息前）＝會被讀成「使用者剛剛說的話」；
                 * `system-before`＝世界背景。
                 *
                 * ⚠️ 它寫進**這本書的檔案**（`position` 欄位，與 SillyTavern 同一個
                 * 欄位名），不是酒館的設定檔——所以整包帶走時它跟著走。
                 */
                React.createElement(MapSelect, {
                  label: '放在哪裡',
                  value: positionValueOf(state.selected),
                  options: [{ value: '', label: '跟著酒館預設', hint: '沿用上面那一格「這裡的世界書預設放在哪」。' }].concat(
                    WORLDBOOK_POSITIONS.map(function (one) {
                      return { value: one, label: WORLDBOOK_POSITION_INFO[one].label, hint: WORLDBOOK_POSITION_INFO[one].hint }
                    }),
                  ),
                  onChange: function (value) {
                    // ⚠️ 空字串是**選得下去的**（2.6.71）：它＝把書裡的 `position`
                    // 刪掉，回到「跟著酒館預設」。見 `setBookPosition`。
                    setBookPosition(state.selected, value === '' ? null : value)
                  },
                }),
                React.createElement(
                  'p',
                  { className: 'dsh-tv-note', style: { marginTop: '4px' } },
                  '⚠️ 「放在哪裡」是**這一本書**的（整本書一起搬到那個位置）；' +
                    '下面每一條條目自己的「優先序」才是**同一本書裡**誰先注入。',
                ),
                React.createElement(
                  'div',
                  { className: 'dsh-tv-fieldLabel' },
                  '條目（' + String(entryList.length) + '）',
                ),
                // 「條目清單」是主要編輯方式（`plan.md` §7.5：不要只有一大塊 JSON）。
                // 只放**常用欄位**：標題、關鍵字、常駐、內容。其餘欄位原樣保留。
                book === null
                  ? React.createElement(
                      'p',
                      { className: 'dsh-tv-note' },
                      '這份 JSON 現在解析不了（可能正在編輯中）——改用下面的原始模式。',
                    )
                  : entryList.length === 0
                    ? React.createElement('p', { className: 'dsh-tv-note' }, '這本世界書還沒有條目。')
                    : React.createElement(
                        'div',
                        { className: 'dsh-tv-entries' },
                        entryList.map(function (one) {
                          var entry = one.ref
                          return React.createElement(
                            'div',
                            { key: one.label, className: 'dsh-tv-entry' },
                            React.createElement('input', {
                              className: 'dsh-tv-in',
                              'aria-label': '條目標題',
                              placeholder: '標題（顯示用，不是給模型的）',
                              value: typeof entry.comment === 'string' ? entry.comment : '',
                              onChange: function (event) {
                                patchEntry(one.label, 'comment', event.target.value)
                              },
                            }),
                            React.createElement('input', {
                              className: 'dsh-tv-in',
                              'aria-label': '觸發關鍵字',
                              placeholder: '觸發關鍵字（逗號分隔；留空＝不主動出現）',
                              value: worldbookKeysOf(entry).join(', '),
                              onChange: function (event) {
                                patchEntry(
                                  one.label,
                                  worldbookKeyField(entry),
                                  event.target.value
                                    .split(/[,，、]/)
                                    .map(function (word) {
                                      return word.trim()
                                    })
                                    .filter(function (word) {
                                      return word !== ''
                                    }),
                                )
                              },
                            }),
                            React.createElement(
                              'label',
                              { className: 'dsh-tv-check' },
                              React.createElement('input', {
                                type: 'checkbox',
                                checked: entry.constant === true,
                                onChange: function (event) {
                                  patchEntry(one.label, 'constant', event.target.checked)
                                },
                              }),
                              '常駐（不用關鍵字，每一輪都出現）',
                            ),
                            // 優先序（`order`）：**大的先注入**，而且預算是先到先得——
                            // 排後面的可能整條進不去（`collectLore` 的 `truncated`）。
                            // 這是使用者唯一能控制「哪些重要」的旋鈕，所以要給。
                            React.createElement(
                              'div',
                              { className: 'dsh-tv-inlineRow' },
                              React.createElement(
                                'label',
                                { className: 'dsh-tv-check', style: { flex: 'none' } },
                                React.createElement('input', {
                                  type: 'number',
                                  className: 'dsh-tv-in dsh-tv-orderIn',
                                  'aria-label': '優先序（order）',
                                  value: String(typeof entry.order === 'number' ? entry.order : 100),
                                  onChange: function (event) {
                                    var next = parseInt(event.target.value, 10)
                                    if (isNaN(next)) return
                                    patchEntry(one.label, 'order', next)
                                  },
                                }),
                                '優先序',
                              ),
                              React.createElement(
                                'span',
                                { className: 'dsh-tv-fieldHint' },
                                '大的先注入（900+ 每輪必在／100 設定／20–99 場景／0–19 補充）',
                              ),
                            ),
                            React.createElement('textarea', {
                              className: 'dsh-tv-ta',
                              rows: 4,
                              'aria-label': '條目內容',
                              placeholder: '這一條要讓模型知道的內容',
                              value: typeof entry.content === 'string' ? entry.content : '',
                              onChange: function (event) {
                                patchEntry(one.label, 'content', event.target.value)
                              },
                            }),
                          )
                        }),
                      ),
                // 原始模式：解析不了的時候**一定要看得到**，其餘時候收起來。
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-tv-advToggle',
                    style: { marginTop: '16px' },
                    'aria-expanded': book === null || state.raw === true ? 'true' : 'false',
                    onClick: function () {
                      state.raw = state.raw !== true
                      render()
                    },
                  },
                  (book === null || state.raw === true ? '▾' : '▸') + ' 原始 JSON（直接改整份檔案）',
                ),
                book === null || state.raw === true
                  ? React.createElement(
                      'div',
                      { className: 'dsh-tv-advBody' },
                      React.createElement(
                        'div',
                        { className: 'dsh-tv-fieldLabel' },
                        'worldbooks/' + state.selected + '.json',
                      ),
                      React.createElement('textarea', {
                        className: 'dsh-tv-ta',
                        rows: 16,
                        value: state.draft,
                        onChange: function (event) {
                          state.draft = event.target.value
                          render()
                        },
                      }),
                    )
                  : null,
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
        return rpc('room.list')
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

      /**
       * 卡片的**本體**。
       *
       * 磁碟上的檔案是 SillyTavern 的信封（`{spec, spec_version, data}`），但
       * `character.list` 回來的 `card` 有沒有拆過信封並不保證——兩種都吃。
       * 漏了這一層，`first_mes` 就是 `undefined`，開場白會整個靜靜地失效。
       */
      function cardBody(item) {
        if (item === null || item === undefined) return {}
        var card = item.card
        if (card === null || card === undefined || typeof card !== 'object') return {}
        return card.data !== null && card.data !== undefined && typeof card.data === 'object'
          ? card.data
          : card
      }

      /** 卡片顯示用的名字；沒有名字就退回檔名（＝id）。 */
      function cardNameOf(item) {
        var body = cardBody(item)
        if (typeof body.name === 'string' && body.name !== '') return body.name
        return item !== null && item !== undefined && typeof item.id === 'string' ? item.id : ''
      }

      /**
       * 這張卡可以選的開場白：`first_mes` 加上 `alternate_greetings`。
       *
       * 空字串的濾掉——留一個按了等於沒事的選項，比沒有這個選項更糟。
       *
       * @returns `[{ label, text }]`，順序就是選項的順序（索引同時是 draft 的值）。
       */
      function greetingsOf(item) {
        var body = cardBody(item)
        var out = []
        if (typeof body.first_mes === 'string' && body.first_mes.trim() !== '') {
          out.push({ label: '卡片的第一則', text: body.first_mes })
        }
        var extra = Array.isArray(body.alternate_greetings) ? body.alternate_greetings : []
        for (var i = 0; i < extra.length; i += 1) {
          if (typeof extra[i] === 'string' && extra[i].trim() !== '') {
            out.push({ label: '其他 ' + String(i + 1), text: extra[i] })
          }
        }
        return out
      }

      /** 開新對話要先挑角色，所以順便讀一次角色清單。 */
      function startPicking() {
        state.message = ''
        state.error = ''
        rpc('character.list')
          .then(function (cards) {
            state.characters = cards.filter(function (item) {
              return item.card !== null
            })
            // 預設選第一張卡。名稱跟著卡片名走——但使用者在表單裡改過之後就不再覆寫
            // （改名是使用者的決定，不該被下一次點選蓋掉，所以只在他還沒動過時跟）。
            var first = state.characters.length > 0 ? state.characters[0] : null
            state.draft = {
              character: first === null ? '' : first.id,
              name: first === null ? '' : cardNameOf(first),
              greeting: 0,
            }
            state.picking = true
            render()
          })
          .catch(function (error) {
            state.error = String((error && error.message) || error)
            render()
          })
      }

      /** 換一張卡：更新選取、把開場白選回第一則，並跟著換掉「還沒被改過」的名稱。 */
      function pickCard(item) {
        if (state.draft === null) return
        var previousDefault = ''
        for (var i = 0; i < state.characters.length; i += 1) {
          if (state.characters[i].id === state.draft.character) previousDefault = cardNameOf(state.characters[i])
        }
        if (state.draft.name === '' || state.draft.name === previousDefault) {
          state.draft.name = cardNameOf(item)
        }
        state.draft.character = item.id
        state.draft.greeting = 0
        state.error = ''
        render()
      }

      /**
       * 建立對話：先開檔，再把選定的開場白寫成第一則訊息。
       *
       * ⚠️ append 要用**宿主半回傳的** `created.room`，不是我們送進去的名字：
       * 名字只是顯示名稱（撞不撞名都不影響路徑），而 `room.append` 只認房間 id。
       * `room.rename` 的註解也寫著同一條規矩。
       */
      function build() {
        if (state.draft === null) return Promise.resolve()
        var tavernId = typeof props.tavernId === 'string' ? props.tavernId : ''
        var chosen = null
        for (var i = 0; i < state.characters.length; i += 1) {
          if (state.characters[i].id === state.draft.character) chosen = state.characters[i]
        }
        if (chosen === null) {
          state.error = '先選一張角色卡'
          render()
          return Promise.resolve()
        }
        var greetings = greetingsOf(chosen)
        var index = state.draft.greeting
        var opening = index >= 0 && index < greetings.length ? greetings[index].text : ''

        state.busy = true
        state.error = ''
        render()
        return rpc('room.create', { id: tavernId, character: chosen.id, name: state.draft.name })
          .then(function (created) {
            if (opening === '') return created
            return rpc('room.append', {
              id: tavernId,
              character: created.character,
              // ⚠️ 用 create 回傳的 **room id**，不是名字。名字只是顯示名稱，
              // 同一個角色可以有兩間同名房（預設名稱就是角色名），而宿主半的
              // `resolveRoom` **只認 id**——送名字會明確報錯（2.6.7 起）。
              room: created.room,
              messages: [{ name: cardNameOf(chosen), isUser: false, text: opening }],
            }).then(function () {
              return created
            })
          })
          .then(function (created) {
            state.busy = false
            state.picking = false
            state.draft = null
            state.message =
              '已建立 chats/' + String(created.character) + '/' + String(created.name) + '.jsonl' +
              (opening === '' ? '（沒有開場白）' : '，並寫入開場白')
            render()
            // 上面的「對話」統計是 summary.counts，不主動通知就會停在 0。
            notifyWorkspaceChanged()
            // 建立完就**直接進去**（使用者：「創建好的時候順便幫我跳過去」）
            // ——以前建完只是回到列表，還要自己再找一次那一列，而那一列當時根本點不進去。
            // 同 `renderChatRow`：就地寫，不要抽成外層小工具（作用域理由見那裡）。
            // 這是全新的對話，不可能「已經是目前這一份」，所以不必比對 key。
            // ⚠️ **一定要帶 `room`**：對話頁的訊息讀寫用 `selected.room`（房間 id）。
            // 少了它的下場是「讀取對話失敗：房間 不可為空」——實際踩到。
            currentChat = {
              character: created.character,
              room: created.room,
              name: created.name,
              file: created.file,
            }
            bumpActiveVersion()
            selectPanel(TAVERN_CHAT_KEY)
            return load()
          })
          .catch(function (error) {
            state.busy = false
            state.error = String((error && error.message) || error)
            render()
          })
      }

      /**
       * 刪掉一份對話（`room.delete`，2.6.46 前叫 `chat.delete`）：**真的刪掉那個 `.jsonl` 檔**。
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
        return rpc('room.delete', { id: tavernId, character: chat.character, room: chat.room })
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

      // 開新對話＝**一張設定卡**，就地展開，不彈窗（酒館街在最底部，彈窗會被裁掉——
      // 同一個理由；而且就地展開的內容在離線測試裡看得到）。
      //
      // 以前這裡只是一串名字，點下去就建檔。但「開一份對話」其實要決定三件事：
      // 用哪張卡、這份對話叫什麼、要不要開場白——而開場白是卡片裡本來就有的資料
      // （`first_mes` ＋ `alternate_greetings`），之前完全沒有被用到。
      if (state.picking) {
        var draft = state.draft === null || state.draft === undefined
          ? { character: '', name: '', greeting: 0 }
          : state.draft
        var current = null
        for (var ci = 0; ci < state.characters.length; ci += 1) {
          if (state.characters[ci].id === draft.character) current = state.characters[ci]
        }
        var greetings = current === null ? [] : greetingsOf(current)
        var opening = draft.greeting >= 0 && draft.greeting < greetings.length ? greetings[draft.greeting].text : ''

        var picker = state.characters.map(function (item) {
          var on = item.id === draft.character
          var primary = item.assets !== undefined && item.assets !== null ? item.assets.primary : null
          var art = findAssetUrl(item.assets, primary)
          return React.createElement(
            'button',
            {
              key: item.id,
              type: 'button',
              className: on ? 'dsh-tv-poster dsh-tv-posterOn' : 'dsh-tv-poster',
              'aria-pressed': on ? 'true' : 'false',
              title: cardNameOf(item),
              onClick: function () {
                pickCard(item)
              },
            },
            art === null
              ? React.createElement('span', { className: 'dsh-tv-posterEmpty' }, '🎭')
              : React.createElement('img', {
                  className: 'dsh-tv-posterArt',
                  src: art,
                  alt: '',
                  loading: 'lazy',
                }),
            React.createElement('span', { className: 'dsh-tv-posterName' }, cardNameOf(item)),
          )
        })

        var greetingRow = []
        for (var gi = 0; gi < greetings.length; gi += 1) {
          greetingRow.push(
            React.createElement(
              MapBtn,
              {
                key: 'greeting-' + String(gi),
                primary: draft.greeting === gi,
                disabled: state.busy,
                // 迴圈變數要用 IIFE 夾住：`var` 是函式作用域，直接寫 `gi` 的話
                // 每一顆按鈕按下去都會是最後一個索引（經典的閉包陷阱）。
                onClick: (function (index) {
                  return function () {
                    draft.greeting = index
                    render()
                  }
                })(gi),
              },
              greetings[gi].label,
            ),
          )
        }
        greetingRow.push(
          React.createElement(
            MapBtn,
            {
              key: 'greeting-none',
              primary: draft.greeting === -1,
              disabled: state.busy,
              onClick: function () {
                draft.greeting = -1
                render()
              },
            },
            '不要開場白',
          ),
        )

        return React.createElement(
          'div',
          null,
          header,
          state.characters.length === 0
            ? React.createElement(
                'p',
                { className: 'dsh-tv-note' },
                '還沒有可用的人物卡——先在「🎭 卡司」分區新增或匯入一張，再回來開對話。',
              )
            : React.createElement(
                'div',
                null,
                React.createElement(
                  'div',
                  { className: 'dsh-tv-field' },
                  React.createElement('div', { className: 'dsh-tv-fieldLabel' }, '跟誰'),
                  React.createElement('div', { className: 'dsh-tv-cardPick' }, picker),
                ),
                React.createElement(
                  'div',
                  { className: 'dsh-tv-field' },
                  React.createElement('div', { className: 'dsh-tv-fieldLabel' }, '對話名稱'),
                  React.createElement('input', {
                    className: 'dsh-tv-in',
                    value: draft.name,
                    'aria-label': '對話名稱',
                    placeholder: cardNameOf(current === null ? {} : current),
                    onChange: function (event) {
                      draft.name = event.target.value
                      render()
                    },
                    onKeyDown: function (event) {
                      if (event.key === 'Enter') build()
                    },
                  }),
                  React.createElement(
                    'div',
                    { className: 'dsh-tv-fieldHint' },
                    'chats/<角色>/<這個名字>.jsonl。撞名不會覆蓋，會自動變成 -2。',
                  ),
                ),
                React.createElement(
                  'div',
                  { className: 'dsh-tv-field' },
                  React.createElement('div', { className: 'dsh-tv-fieldLabel' }, '開場白'),
                  React.createElement('div', { className: 'dsh-tv-inlineRow' }, greetingRow),
                  React.createElement(
                    'div',
                    { className: 'dsh-tv-fieldHint' },
                    opening === ''
                      ? greetings.length === 0
                        ? '這張卡沒有開場白可以選，會直接從你的第一句話開始。'
                        : '不寫入開場白，直接從你的第一句話開始。'
                      : opening,
                  ),
                ),
                React.createElement(
                  'div',
                  { className: 'dsh-tv-inlineRow' },
                  React.createElement(
                    MapBtn,
                    { primary: true, disabled: state.busy, onClick: build },
                    state.busy ? '建立中…' : '建立對話',
                  ),
                  React.createElement(
                    MapBtn,
                    {
                      disabled: state.busy,
                      onClick: function () {
                        state.picking = false
                        state.draft = null
                        render()
                      },
                    },
                    '取消',
                  ),
                ),
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
          {
            key: label,
            className: 'dsh-tv-listItem',
            title: '開啟 chats/' + label + '.jsonl',
            // 點一列就**進到那份對話**（使用者：「選擇列表選擇並無法直接進入」）。
            // 以前這一列只有右邊那顆「刪除」，沒有進去的方法。
            //
            // ⚠️ 這段刻意寫在這裡，**不要抽成共用的小工具**：`currentChat` 宣告在外層，
            // 而 `chatKeyOf`／`bumpActiveVersion`／`selectPanel` 都在內層，放外層的
            // 小工具會看不到它們（實際下場：`chatKeyOf is not defined`，被測試抓到）。
            onClick: function () {
              var same =
                currentChat !== null &&
                currentChat.character === chat.character &&
                currentChat.name === chat.name
              currentChat = chat
              if (same === false) bumpActiveVersion()
              selectPanel(TAVERN_CHAT_KEY)
            },
          },
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
              onClick: function (event) {
                // 這一顆住在可點的列裡面：不擋下來的話，按「刪除」會順手幫你進入
                // 那份對話（`MapBtn` 會把事件傳進來，同一個元件在酒館列也這樣用）。
                if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') {
                  event.stopPropagation()
                }
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

    /**
     * `summary.counts` 來自宿主半的回應，**不是我們保證的東西**。
     *
     * 抽成一支是因為它有三個呼叫點（概況、大廳的快速入口、插件卡片），
     * 而每一處都要擋 `null`／`undefined`——漏一處就是渲染期丟錯、
     * 整個 `main` 面板變成死格（`plan.md` §7.4b 那兩個 bug 的同型）。
     */
    function summaryCounts(summary) {
      return summary !== null && summary !== undefined && summary.counts !== null && summary.counts !== undefined
        ? summary.counts
        : {}
    }

    /**
     * 大廳的房間清單：**直接列出對話，點一列就進去**。
     *
     * 使用者：「最下低那層不需要，可以換成真的聊天對話框，讓我直接選進去」。
     * 原本底部是三個入口按鈕（包廂／卡司／藏書）＋份數，等於「先跳去包廂再挑一次」；
     * 這裡直接把門擺在大廳。
     *
     * 資料要 `room.list`，而它不在 `useTavernData` 那條鏈上（那份只給
     * `counts.chats` 這個**數字**），所以在這裡自己載一次。載入住在 `useEffect`，
     * 離線的假 React 不跑它——所以測試只驗「沒有資料時畫得出東西」，
     * 真的清單在瀏覽器裡看。
     */
    /**
     * 沒有圖的房間：畫一個**門**。
     *
     * 使用者：「🚪根本就不貼合」——emoji 在不同平台的形狀、大小、基線都不同，
     * 塞進固定比例的卡面就會忽大忽小、偏一邊。這個 repo 的介面圖示一直都是自己畫
     * SVG（跟原生那批同一個做法），所以這裡也自己畫：門板 ＋ 門把 ＋ 門框線，
     * 用 `currentColor` 吃文字色，尺寸由 `viewBox` 決定，永遠貼得進框。
     */
    function RoomDoorIcon() {
      return React.createElement(
        'svg',
        { width: 34, height: 34, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
        React.createElement('path', {
          d: 'M5 3.5h10.5A1.5 1.5 0 0 1 17 5v14a1.5 1.5 0 0 1-1.5 1.5H5z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinejoin: 'round',
        }),
        React.createElement('path', {
          d: 'M5 3.5v17',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
        }),
        React.createElement('circle', { cx: '14.4', cy: '12', r: '1.15', fill: 'currentColor' }),
      )
    }

    function HallRooms(props) {
      // 房間屬於某個角色，所以「這間房沒有自己的插圖」時可以退回那個角色的主圖。
      var characters = Array.isArray(props.characters) ? props.characters : []
      var render = useForceRender()
      var ref = React.useRef(null)
      if (ref.current === null) ref.current = { chats: [], loaded: false, error: '' }
      var state = ref.current
      React.useEffect(function () {
        rpc('room.list')
          .then(function (chats) {
            state.chats = Array.isArray(chats) ? chats : []
            state.loaded = true
            render()
          })
          .catch(function (error) {
            state.error = String((error && error.message) || error)
            state.loaded = true
            render()
          })
      }, [])

      // 房間用**跟角色卡一樣的卡片**，不是一行文字列。
      //
      // 使用者：「房間是應該可以有插圖的，所以你這樣一行過的顯示方式可能就讓這件事
      // 變得複雜了，最好像角色卡一樣是卡片」。一行式只有 30px 高的小圖示，
      // 放不下真的插圖；卡片用的是 `.dsh-tv-poster*` 那一組（跟卡司的海報牆同一套），
      // 所以邊框、底色、主圖比例、名稱列全部與角色卡一致——
      // 連「邊框看不見」這個問題也一起解掉了（那組樣式本來就是為了看清楚而調的）。
      var cards = state.chats.map(function (chat) {
        var primary = chat.assets !== undefined && chat.assets !== null ? chat.assets.primary : null
        var art = findAssetUrl(chat.assets, primary)
        // 沒有房間插圖 → 用**那個角色的主圖**（房間是屬於誰的，比一個通用圖示有意義）
        // → 都沒有才畫門。
        if (art === null) {
          for (var ci = 0; ci < characters.length; ci += 1) {
            if (characters[ci].id !== chat.character) continue
            var owned = characters[ci].assets
            if (owned !== null && owned !== undefined) art = findAssetUrl(owned, owned.primary)
          }
        }
        var key = String(chat.character) + '/' + String(chat.name)
        return React.createElement(
          'button',
          {
            key: key,
            type: 'button',
            className: 'dsh-tv-poster',
            title: '進去 ' + key,
            onClick: function () {
              // 同一套導覽，就地寫。理由見 `renderChatRow`：`currentChat` 宣告在外層，
              // 而 `bumpActiveVersion`／`selectPanel`／`TAVERN_CHAT_KEY` 都在內層，
              // 抽成外層的小工具會看不到它們。
              currentChat = chat
              bumpActiveVersion()
              selectPanel(TAVERN_CHAT_KEY)
            },
          },
          art === null
            ? React.createElement('span', { className: 'dsh-tv-roomEmpty' }, React.createElement(RoomDoorIcon))
            : React.createElement('img', {
                className: 'dsh-tv-roomArt',
                src: art,
                alt: '',
                loading: 'lazy',
              }),
          React.createElement('span', { className: 'dsh-tv-posterName' }, String(chat.name)),
        )
      })

      return React.createElement(
        'div',
        { className: 'dsh-tv-field' },
        React.createElement('div', { className: 'dsh-tv-fieldLabel' }, '房間'),
        state.error !== ''
          ? React.createElement('p', { className: 'dsh-tv-note' }, '讀不到對話清單：' + state.error)
          : state.loaded === false
            ? React.createElement('p', { className: 'dsh-tv-note' }, '讀取中…')
            : cards.length === 0
              ? React.createElement(
                  'p',
                  { className: 'dsh-tv-note' },
                  '還沒有房間。到「💬 包廂」開一份對話。',
                )
              : // 跟卡司的海報牆同一組格線（132px 起跳），所以兩邊的卡片一樣大。
                React.createElement('div', { className: 'dsh-tv-wall' }, cards),
      )
    }

    function MapOverview(props) {
      var summary = props.summary
      // 同上：`counts` 也來自宿主半的回應，不是我們保證的東西。
      var counts = summaryCounts(summary)
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
      var dash = React.createElement(
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
        )
      /**
       * `compact`：只要那四個數字。
       *
       * 使用者在大廳看到「資料夾位置／資料夾結構／art 分類／長說明」之後說
       * 「只留這些」（指那四個數字）。那些參考資料**查得到就好**，不是每次進酒館
       * 都要讀一遍的東西——所以它們搬去 ⚙️ 設定，而這個元件的另外兩個呼叫點
       * （設定頁的插件卡片）仍然要完整版，因此用 prop 區分而不是砍掉。
       */
      if (props.compact === true) return dash
      return React.createElement(
        'div',
        null,
        dash,
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
       * 這裡踩過一個跟 `room.create` 同型的 bug：這一區以前送
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

      /**
       * 從編輯器回到海報牆（「找卡」與「改卡」分開）。
       *
       * 只清本地狀態——**不動任何檔案**。沒有這一條的話，唯一的回頭路是切去別的
       * panel 再回來，而這個面板是常駐的，回來還是同一張卡。
       */
      function clearSelection() {
        state.selected = null
        state.draft = null
        state.message = ''
        state.error = ''
        render()
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
       * 匯出成 PNG 卡：**主圖 ＋ `ccv3` 區塊，一個檔案就是一張卡**。
       *
       * ⚠️ 這件事**完全在瀏覽器半做完**，沒有新增任何宿主路由或 RPC。理由不只是
       * 省事：圖已經在瀏覽器裡、卡片資料也已經讀過了，匯出只是把兩份已經在手上的
       * 東西接成一個檔——繞去 Node 再回來等於把好幾 MB 搬兩趟。而且宿主半的新路由
       * 要**重啟 `dsh web`** 才會生效，那正是插圖折騰了兩輪的原因。
       */
      function exportPng() {
        if (state.draft === null || state.selected === '') {
          state.error = '先選一張卡'
          render()
          return
        }
        state.busy = true
        state.error = ''
        state.message = '匯出中…'
        render()
        return rpc('assets.list', { kind: 'character', owner: state.selected })
          .then(function (assets) {
            var primary = assets === null || assets === undefined ? null : assets.primary
            var url = primary === null || primary === undefined ? null : findAssetUrl(assets, primary)
            if (url === null) {
              throw new Error('這張卡還沒有主圖——PNG 卡要有一張圖，先在下面的插圖區加一張，或匯入一張 PNG 卡。')
            }
            return fetch(url).then(function (response) {
              if (response.ok !== true) throw new Error('讀不到主圖（HTTP ' + String(response.status) + '）')
              return response.arrayBuffer()
            }).then(function (buffer) {
              var png = spliceCardChunk(new Uint8Array(buffer), v3Card(state.draft), 'ccv3')
              download(state.selected + '.png', new Blob([png], { type: 'image/png' }))
              state.busy = false
              state.message =
                '已匯出 ' + state.selected + '.png（' + String(Math.round(png.length / 1024)) +
                ' KB，卡片資料在 ccv3 區塊裡，圖沒有重新編碼）'
              render()
            })
          })
          .catch(function (error) {
            state.busy = false
            state.error = '匯出失敗：' + String((error && error.message) || error)
            render()
          })
      }

      /** 匯出 JSON 卡：同一份 V3 信封，只是不包進圖裡。 */
      function exportJson() {
        if (state.draft === null || state.selected === '') {
          state.error = '先選一張卡'
          render()
          return
        }
        var text = JSON.stringify(v3Card(state.draft), null, 2)
        download(state.selected + '.json', new Blob([text], { type: 'application/json' }))
        state.error = ''
        state.message = '已匯出 ' + state.selected + '.json（V3 信封）'
        render()
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
            /**
             * ⚠️ PNG 卡**不再複製一份插圖**（`artAdded` 永遠是 null）：卡片本身就是那張圖，
             * 所以訊息要說的是「卡片存成什麼檔案」。留著舊的「插圖：…」字樣會讓人以為
             * 有第二份檔案，然後去 `art/` 找不到。
             */
            var where = typeof value.cardFile === 'string' && value.cardFile !== '' ? '，' + value.cardFile : ''
            state.message =
              '已匯入「' +
              String(value.name) +
              '」（' +
              (value.source === 'json' ? 'JSON' : String(value.source)) +
              where +
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
        // 工具列拉出兩欄之外：海報牆與編輯器都用得到它。
        React.createElement(
          'div',
          { className: 'dsh-tv-toolRow' },
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
              // 匯出：PNG 卡（主圖 ＋ ccv3 區塊）與 JSON 卡。兩個都在瀏覽器半完成。
              React.createElement(
                MapBtn,
                {
                  disabled: state.busy || state.draft === null,
                  title: '把這張卡存成一個 PNG 檔：主圖 ＋ 卡片資料（ccv3 區塊），可以直接分享或匯入別的軟體',
                  onClick: exportPng,
                },
                '📤 匯出 PNG 卡',
              ),
              React.createElement(
                MapBtn,
                {
                  disabled: state.draft === null,
                  title: '同一份卡片資料的 JSON 版（V3 信封）',
                  onClick: exportJson,
                },
                '📤 匯出 JSON',
              ),
            ),
        // 「找卡」與「改卡」分開（`redesign.md` §3.2）：還沒選卡是**海報牆**，
        // 選了才進編輯器。以前是「左邊一條窄清單 ＋ 右邊編輯器」，兩件事擠在一起，
        // 而那一條清單只有 230px，主圖根本看不出來是誰。
        usable.length === 0
          ? React.createElement(
              'div',
              { className: 'dsh-tv-note' },
              '還沒有角色卡。按「新增角色」開始，或把現成的卡丟進工作區的 characters/ 目錄。',
            )
          : state.draft === null
            ? React.createElement(
                'div',
                { className: 'dsh-tv-wall' },
                usable.map(function (item) {
                  var primary = item.assets !== undefined && item.assets !== null ? item.assets.primary : null
                  var poster = primary === null || primary === undefined ? null : findAssetUrl(item.assets, primary)
                  var shots =
                    item.assets !== undefined && item.assets !== null && Array.isArray(item.assets.items)
                      ? item.assets.items.length
                      : 0
                  return React.createElement(
                    'button',
                    {
                      key: item.id,
                      type: 'button',
                      className: 'dsh-tv-poster',
                      title: item.card.name || item.id,
                      onClick: function () {
                        select(item.id)
                      },
                    },
                    poster === null
                      ? React.createElement('span', { className: 'dsh-tv-posterEmpty' }, '🎭')
                      : React.createElement('img', {
                          className: 'dsh-tv-posterArt',
                          src: poster,
                          alt: '',
                          loading: 'lazy',
                        }),
                    React.createElement(
                      'span',
                      { className: 'dsh-tv-posterName' },
                      item.card.name || item.id,
                      shots > 1
                        ? React.createElement('span', { className: 'dsh-tv-posterCount' }, String(shots))
                        : null,
                    ),
                  )
                }),
              )
            : React.createElement(
                'div',
                null,
                React.createElement(
                  'div',
                  { className: 'dsh-tv-backRow' },
                  React.createElement(MapBtn, { onClick: clearSelection }, '← 全部角色'),
                ),
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
                    // 陣列欄位（`tags`／開場白…）在畫面上是「一行一個」的文字，
                    // 存檔時才切成陣列。規格要的是**陣列**——存成字串的話，
                    // 別的前端讀到的是一個字串而不是清單（而且我們的開場白選單
                    // 會直接讀不到東西）。
                    var raw = state.draft[field.key]
                    var text = Array.isArray(raw)
                      ? raw.join('\n')
                      : typeof raw === 'string'
                        ? raw
                        : ''
                    return React.createElement(MapField, {
                      key: field.key,
                      label: field.label,
                      hint: field.hint,
                      rows: field.rows,
                      textarea: field.textarea === true,
                      value: text,
                      onChange: function (value) {
                        if (field.lines !== true) {
                          patch(field.key, value)
                          return
                        }
                        // 空行直接丟掉：`tags: ['']` 送到別的前端會變成一個空標籤，
                        // 而且沒有人是故意要留它的。
                        var out = []
                        var parts = String(value).split('\n')
                        for (var i = 0; i < parts.length; i += 1) {
                          if (parts[i].trim() !== '') out.push(parts[i].trim())
                        }
                        patch(field.key, out)
                      },
                    })
                  }),
                  React.createElement('p', { className: 'dsh-tv-note' }, '檔案：characters/' + String(state.selected) + '.json'),
                ),
      )
    }


    /**
     * 「格式指令有兩個來源」的警告（沒有衝突時回 `null`，不佔畫面）。
     *
     * ⚠️ **只在真的會衝突時說話**：世界書在教格式 **而且** plugin 也在送指令
     * （＝模式不是 `plain`）。`plain` 模式下 plugin 一個字都不加，所以那時候
     * 世界書就是唯一的老師——**那是完全可以的**，不該被警告。
     *
     * 抽成一支純函式（輸入 props ＋ render，回元素或 `null`）是為了測得到：
     * 「什麼時候說話」是它唯一的邏輯，而那正是最容易被改成「永遠說話」的地方
     * ——永遠說話的警告等於沒有警告。
     */
    function formatWarning(props, render) {
      var books = Array.isArray(props.formatBooks) ? props.formatBooks : []
      if (books.length === 0) return null
      // `plain` ⇒ plugin 沒送指令 ⇒ 世界書是唯一的老師，不用警告。
      if (render.mode === 'plain') return null
      var names = books
        .map(function (one) {
          return one.id
        })
        .join('、')
      return React.createElement(
        'div',
        { className: 'dsh-tv-warn', role: 'status' },
        '⚠️ 現在有兩個地方在教回覆格式：世界書（' +
          names +
          '）與上面這一格，所以模型會收到兩份規格。' +
          '要只留一份的話：把上面那一格改回 plain（讓世界書當唯一的老師），' +
          '或者到 📖 藏書 把那一本的格式條目關掉。',
      )
    }

    /** 下拉選單列。 */
    /**
     * 下拉選單列。
     *
     * ────────────────────────────────────────────────────────────────────────
     * ⚠️ **選項只有名字，解釋放在下面**（2.6.65 使用者回報後改的）。
     *
     * 原本我把解釋**塞進選項的文字**（`'只讀——它可以自己翻角色卡…'`），
     * 使用者的評語是：
     *
     *   > 你很多東西都是一大段一大段的，正常的做法應該是**名字加解釋**，
     *   > 這樣按鈕區域沒有一個統一的名稱就很麻煩，直接提高了溝通成本
     *
     * 兩個問題他一次講清楚了：
     *   1. **收合的時候看不到**——`<select>` 關著只顯示那一條長字串，
     *      而使用者要的是「一眼知道現在選的是哪一個」
     *   2. **沒有統一的名字**——選項清單本身變得不能掃視
     *
     * 所以規矩是：`options[].label` 是**短名字**（2～8 個字），
     * `options[].hint` 是那一項的解釋，而**只有「現在選中的那一項」的解釋
     * 會顯示在下面**。這也讓「解釋」跟「選項」永遠對得上——不必在每個呼叫端
     * 自己寫一份會走樣的 `hint` 字串。
     * ────────────────────────────────────────────────────────────────────────
     */
    function MapSelect(props) {
      var options = Array.isArray(props.options) ? props.options : []
      var selected = options.filter(function (one) {
        return String(one.value) === String(props.value)
      })[0]
      // 呼叫端給的 `hint` 優先（那是「這一格整體在幹什麼」），
      // 沒給就用**選中那一項**的說明。
      var hint = props.hint !== undefined && props.hint !== null && props.hint !== '' ? props.hint : selected !== undefined ? selected.hint : ''
      return React.createElement(
        'label',
        { className: 'dsh-tv-field' },
        React.createElement(FieldLabel, {
          text: props.label,
          hint: hint,
        }),
        React.createElement(
          'select',
          {
            className: 'dsh-tv-in',
            value: props.value,
            // ⚠️ `aria-label` 放在 **select 本身**（不是外層那個 `<label>`）：
            // 外層的文字節點不是無障礙名稱，而測試也需要一個穩定的錨點
            // ——用「選項裡有沒有 inherit」去找會命中**工具權限**那一格
            // （它也有 `inherit`），實測踩過一次。
            'aria-label': props.label,
            onChange: function (event) {
              props.onChange(event.target.value)
            },
          },
          props.options.map(function (option) {
            return React.createElement('option', { key: option.value === '' ? '__none' : option.value, value: option.value }, option.label)
          }),
        ),
        // ⚠️ 說明**不在這裡**：它交給上面的 `FieldLabel`，由那顆 `?` 控制展開
        // （使用者要的是「平時摺疊起來」）。畫在兩個地方會變成一份說明出現兩次。
      )
    }

    /* ---------------------- 欄位說明（`?` 展開／收起）---------------------- */

    /**
     * 哪幾格說明是展開的。
     *
     * ⚠️ **模組層級的一格，不是每個元件的 `useState`**：`MapSelect`／`FieldLabel`
     * 是**共用元件**，而離線測試的假 React 把 `useState` 的 setter 做成空的
     * （`() => {}`）——用 `useState` 的話**測試驗不到展開**，而展開正是這一格
     * 唯一的行為。
     *
     * ⚠️ key 一定要**穩定**（用欄位標籤當 key）：拿索引當 key 的話，
     * 展開一格之後清單重畫（例如多了一本書）會讓說明跳到別格去。
     */
    var helpOpen = Object.create(null)

    /** 目前還活著的元件重繪函式（展開／收起時叫它們重畫）。 */
    var helpRenderers = []

    /**
     * 把「這一格的說明是開的嗎」與「切換它」交給呼叫端。
     *
     * ⚠️ 用 `useForceRender()`（它只依賴 `useState`）而不是自己存一格：
     * 那一支是這個 repo 既有的重繪慣例，而且在真的 React 裡是安全的
     * ——**在渲染期只註冊、不呼叫 setter**（呼叫會是「渲染期改狀態」的警告）。
     */
    function useHelpToggle(key) {
      var render = useForceRender()
      var name = typeof key === 'string' ? key : ''
      React.useEffect(function () {
        // ⚠️ 註冊在 effect 裡（不是渲染期）：渲染期註冊會讓 StrictMode 的
        //    兩次渲染留下兩份，而卸載時只清掉一份。
        helpRenderers.push(render)
        return function () {
          var at = helpRenderers.indexOf(render)
          if (at >= 0) helpRenderers.splice(at, 1)
        }
      }, [])
      return {
        open: name !== '' && helpOpen[name] === true,
        toggle: function () {
          if (name === '') return
          helpOpen[name] = helpOpen[name] !== true
          var list = helpRenderers.slice()
          for (var i = 0; i < list.length; i += 1) list[i]()
        },
      }
    }

    /**
     * 欄位標籤 ＋ **可展開的說明**（`?`）。
     *
     * ────────────────────────────────────────────────────────────────────────
     * ⚠️ 這是使用者的要求（2.6.65）：
     *
     *   > 在附近有沒有解釋？我以前玩 TrueNAS，附近有個**問號**讓我能夠看看
     *   > 是什麼意思，**平時就摺疊起來**
     *
     * 這比「把說明塞進欄位標籤」或「永遠攤開一段小字」都好：
     *   - 平時畫面上只有標籤（乾淨、可以掃視）
     *   - 想知道的人按一下就看得到（不必離開頁面去找文件）
     *   - `aria-expanded` 讓它是一個真的可存取的控件，不是一個裝飾
     *
     * ⚠️ **沒有 `props.hint` 時完全不畫那顆 `?`**——一個按了沒東西的問號
     * 比沒有問號更糟（那是欺騙性的 UI，這個 repo 已經有一條同樣的規矩）。
     * ────────────────────────────────────────────────────────────────────────
     *
     * @param props - `{ text, hint, open, onToggle }`。
     */
    function FieldLabel(props) {
      var text = React.createElement('span', { className: 'dsh-tv-fieldLabelText' }, props.text)
      var hint = typeof props.hint === 'string' ? props.hint : ''
      if (hint === '') return React.createElement('div', { className: 'dsh-tv-fieldLabel' }, text)
      // ⚠️ 這一格**自己管展開狀態**（key 用標籤文字）——所以呼叫端不必為每一格
      //    準備 `open`／`onToggle` 兩個 prop。要覆寫的呼叫端仍然可以傳。
      var own = useHelpToggle(String(props.text))
      var open = props.open === undefined ? own.open : props.open === true
      var toggle = typeof props.onToggle === 'function' ? props.onToggle : own.toggle
      return React.createElement(
        'div',
        { className: 'dsh-tv-fieldLabel' },
        text,
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-tv-help',
            // ⚠️ 標籤用**欄位名**（不是「說明」）——螢幕閱讀器唸出來才知道
            // 是哪一格的說明。
            'aria-label': '「' + props.text + '」是什麼意思',
            'aria-expanded': open ? 'true' : 'false',
            title: open ? '收起說明' : '這是什麼意思？',
            onClick: function (event) {
              // ⚠️ 標籤包在 `<label>` 裡（`MapSelect` 就是），不擋的話
              // 點問號會**順便把下拉選單打開**。
              if (event !== null && event !== undefined && typeof event.preventDefault === 'function') {
                event.preventDefault()
              }
              if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') {
                event.stopPropagation()
              }
              if (typeof toggle === 'function') toggle()
            },
          },
          '?',
        ),
        open ? React.createElement('div', { className: 'dsh-tv-helpBody' }, hint) : null,
      )
    }

    /**
     * 一個開關（checkbox ＋ 標籤）。
     *
     * ⚠️ 用**原生 checkbox**而不是自己畫一顆：這一頁有好幾個開關（stop、choices
     * 可點），而假裝成開關的按鈕會失去鍵盤操作與 `.checked` 這種可測的狀態
     * ——`test-client.mjs` 就是靠 `type==='checkbox'` 與 `checked` 驗的。
     */
    function MapToggle(props) {
      return React.createElement(
        'label',
        { className: 'dsh-tv-toggle' },
        React.createElement('input', {
          type: 'checkbox',
          checked: props.checked === true,
          disabled: props.disabled === true,
          'aria-label': props.label,
          onChange: function (event) {
            props.onChange(event.target.checked === true)
          },
        }),
        React.createElement('span', { className: 'dsh-tv-toggleText' }, props.label),
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
        rpc('room.rename', {
          id: tavern.id,
          character: chat.character,
          // id（不是名字）：同名的房可以有兩間，用名字會改錯那一次。
          room: chat.room,
          name: next,
        })
          .then(function (renamed) {
            state.renaming = null
            // 正在看那一份就換成新的座標，不然對話頁會指著一個已經不存在的檔名。
            // ⚠️ **合併，不要取代**：`room.rename` 只回 `{character, room, name}`，
            // 直接換掉會讓對話頁手上的 `roomPrompt`／`allowTools`／`file` 消失
            // （改名不是重讀，其他欄位沒有理由被清掉）。
            if (currentChat !== null && chatKeyOf(currentChat) === chatKeyOf(chat)) {
              currentChat = Object.assign({}, currentChat, renamed)
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

      /** 「刪除」：跟設定頁那顆一樣，走已經驗過的 `room.delete`。 */
      function deleteChat(tavern, chat) {
        var menu = state.menu
        if (menu === null || menu.busy) return
        menu.busy = true
        menu.error = ''
        render()
        rpc('room.delete', { id: tavern.id, character: chat.character, room: chat.room })
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
       *   2. `room.create` 開一份新檔 → `room.append` 把目前看到的訊息寫進去
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
            return rpc('room.messages', { character: chat.character, room: chat.room })
              .catch(function () {
                return []
              })
              .then(function (messages) {
                var list = Array.isArray(messages) ? messages : []
                // 檔名／房間 id 交給宿主半（回傳的 `created.room` 才是真的身分；
                // 顯示名稱是 `created.name`，兩者不可以混用——同名可以有兩間房）。
                return rpc('room.create', { id: tavern.id, character: chat.character, name: chat.name })
                  .then(function (created) {
                    var write =
                      list.length === 0
                        ? Promise.resolve()
                        : rpc('room.append', {
                            id: tavern.id,
                            character: created.character,
                            room: created.room,
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
                          // ⚠️ 兩個都要送（2.6.49）：`room`＝**房間 id**（身分，agent 面
                          // 靠它讀 `room.json`：每房設定），`chat`＝**顯示名稱**。
                          // 以前這裡把房間 id 塞進 `chat`、而 `room` 留空——兩種形狀
                          // 同時存在（另一個呼叫點送的是顯示名稱），讀的那一端只好兩種都認。
                          room: created.room,
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
        return rpc('room.list', { id: id }, 8000)
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
       * 改名／移除那些動作都收進設定頁的「🏠 大廳」分區。
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

      /**
       * ＋ → **切到那間酒館的「💬 包廂」**，不在這裡建立任何東西。
       *
       * ⚠️ 2026-09-18 改的，理由不是美觀而是**資料模型**：
       * 原本的 ＋ 會直接開一份「某個角色的對話」，而那是**單卡**的流程
       * ——一間酒館有多張卡，而一份對話可能**同時有多個角色**。
       * 「開一份對話」是一個配置（選誰參與），所以它該在包廂裡做，
       * 不該由側邊欄一顆按鈕替你決定。
       *
       * 包廂裡本來就有自己的「＋ 新對話」，所以拿掉這一顆不會少功能。
       */
      function newChat(tavern) {
        state.error = ''
        state.pickCharacterFor = null
        // ＋ 是**來回鍵**，不是單程票。
        //
        // 使用者回報：「＋ 會幫我跳轉到創建頁面，但有時我手多就想快速回去，
        // 重新點擊 ＋ 不會跳回去」——他要的是**已經在包廂裡的時候，再按一次就回頭**。
        // 所以：
        //   在別的地方按 → 去那間酒館的「💬 包廂」（原本的行為，不變）
        //   已經在包廂裡按 → 回到剛剛在看的那份對話
        //
        // 判斷條件用「同一個主面板 ＋ 同一個分區」，不是「上一次按了什麼」——
        // 後者要維護一堆清除點（換分區、點別的面板…漏一個就會把人送去奇怪的地方）。
        // 包廂裡本來就有自己的「＋ 新對話」，所以拿掉單程票不會少功能。
        var inRooms =
          currentZone === 'rooms' &&
          shownPanel === TAVERN_SETTINGS_KEY &&
          active !== null &&
          active.id === tavern.id
        // 沒有對話可以回的時候（他還沒點進任何一間房）就留在包廂：那一下「回去」
        // 沒有目標，硬跳只會把人送去空頁。
        if (inRooms && currentChat !== null) {
          selectPanel(TAVERN_CHAT_KEY)
          return Promise.resolve()
        }
        var start = active !== null && active.id === tavern.id ? Promise.resolve() : select(tavern.id)
        return start.then(function () {
          // 切到包廂那一區，再把面板指過去——兩件事都要做：
          // 只換分區不改面板，使用者還停在別的地方；只換面板不改分區，他會看到大廳。
          currentZone = 'rooms'
          // 分區是**模組層級的狀態**，不是 props：主面板已經停在這一頁的時候，
          // 重畫側邊欄不會讓它跟著重畫，那顆 ＋ 看起來就像壞了（按了沒反應）。
          // 借 refreshChannel 通知那一頁重畫（只重畫，不重讀——它自己的資料沒變）。
          refreshChannel.bump()
          render()
          selectPanel(TAVERN_SETTINGS_KEY)
          return null
        }).catch(fail)
      }

      function createChat(tavern, characterId) {
        state.busy = true
        state.pickCharacterFor = null
        render()
        return rpc('room.create', { id: tavern.id, character: characterId })
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
      // ⚠️ 這裡原本只傳 `render` 進去——**只重畫、不重讀**，
      // 理由是「這份對話開始跑／跑完」只影響那一顆圖示，重讀六份 `.jsonl` 很浪費。
      //
      // 但**同一個通道也承載「內容變了」**（`notifyWorkspaceChanged`）：在包廂建立
      // 一間新房之後，側邊欄不知道要重讀，於是**要重新整理才看得到**
      // （使用者回報：「建立房間後不會馬上出現，要 refresh」）。
      //
      // 所以重畫之後**順手重讀展開中的酒館**：沒展開的清單本來就是空的，讀了也浪費，
      // 所以只讀開著的那些。
      useRefreshChannelRerender(function () {
        render()
        var ids = Object.keys(state.expanded)
        for (var i = 0; i < ids.length; i += 1) {
          if (state.expanded[ids[i]].open === true) loadChats(ids[i])
        }
      })

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
              // ⚠️ 空狀態**自己做按鈕**，不要叫使用者去 hover 找那顆 ＋。
              //
              // 使用者回報「新增對話鈕看不到」——原因不是壞了：`.dsh-tv-actions`
              // 平常是 `display:none`（照抄原生的 hover 才顯示），所以那顆 ＋ 在
              // 沒有滑過去的話**真的不在畫面上**。提示寫「滑到上面按 ＋」等於叫他
              // 去找一個看不見的東西。整行可點，就不必找。
              React.createElement(
                'div',
                {
                  key: 'empty',
                  className: 'dsh-tv-emptyRow',
                  style: { cursor: 'pointer' },
                  onClick: function () {
                    newChat(tavern)
                  },
                },
                '還沒有對話——按這裡開一份。',
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
              var same = currentChat !== null && chatKeyOf(currentChat) === chatKeyOf(chat)
              currentChat = chat
              if (same === false) {
                // 換了一份對話：面板 key 是同一個（`main:tavern-chats`），DSH 不會重繪，
                // 所以一定要另外通知（不然畫面留在上一份）。
                bumpActiveVersion()
                // 側邊欄也要重繪，不然那一列沒有 active 標記。
                render()
              }
              // ⚠️ **`selectPanel` 一定要執行，不能因為「同一份對話」就跳過。**
              // 使用者實際情境：點了一間房 → 切去別的 AI 對話 → 再點同一間房，
              // 這時候 `currentChat` 沒變，但**主面板還停在別的地方**，
              // 跳過它就切不回來（2026-09-18 實測回報）。
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
            /**
             * 「裝修」要在**看得到的第一眼**就生效：側邊欄比主面板早出現（面板要使用者
             * 點進去才掛載），所以這裡也讀一次主題——不然展開酒館街時還是內建色票。
             * `ensureTheme` 自己按酒館 id 去重，讀過就不再讀。
             */
            ensureTheme(listed.activeId)
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
     * 對話頁的載入函式（由 `TavernChatPage` 在渲染時填入）。
     *
     * 為什麼要留這個把手：那一頁的載入住在 `React.useEffect` 裡，而離線測試的假
     * React **不跑 effect**——所以訊息列（頭像、氣泡、名稱）一直到現在都沒有專屬
     * 測試，這是欠最久的一筆技術債。有了它，測試叫 `__loadChat()` 就能驅動。
     */
    var chatLoader = null

    /** 同上，但讀的是「這一間房的用量」（`__loadUsage()`）。 */
    var usageLoader = null

    /**
     * 房間那一頁「📖 藏書」的載入函式（由 `RoomBooksPane` 在渲染時填入）。
     *
     * 同 `chatLoader` 的理由：那一頁的清單住在 `React.useEffect` 裡，而離線測試的
     * 假 React 不跑 effect——沒有這個把手，那一列的**書名是不是一顆連結**
     * （也就是「去改它」有沒有接上）就只能靠掃原始碼驗。
     */
    var roomBooksLoader = null

    /**
     * token 數字的顯示格式：`34210` → `34.2K`。
     *
     * 跟 DSH 自己那排統計同一種寫法（K／M、一位小數），因為使用者要的就是
     * 「跟我自己的 web UI 一樣」——而且小數位在這裡是**刻意的**：他要看的是趨勢，
     * 不是精確到個位的數字（精確值在 `title` 裡）。
     */
    function fmtTokens(n) {
      if (typeof n !== 'number' || isNaN(n)) return '—'
      if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M'
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
      return String(Math.round(n))
    }

    /**
     * session 的三個投影 → 對話頁那一列要的形狀。
     *
     * 三個鍵都是**宿主算好的**（`@deepseek-ai/dsh-token-meter` 的投影單元）：
     *   - `contextPressure`  ：下一個請求的提示詞規模 ＋ 這條路由的容量
     *   - `tokenUsage`       ：供應方回報的四個桶（未命中輸入／快取讀／快取寫／輸出，
     *                          **互不重疊**，所以加起來就是提示詞側的總量）
     *   - `contextBreakdown` ：提示詞的粗略組成（啟發式，會低估中文——標「近似」）
     *
     * 一個都讀不到就回 `null`（那一列整個不出現），而不是畫一排 0 騙人。
     * 這是**純函式**：投影的形狀改了就從這裡紅，不必開瀏覽器。
     */
    function usageOfProjections(values) {
      if (values === null || values === undefined || typeof values !== 'object') return null
      var pressure = values.contextPressure
      var usage = values.tokenUsage
      var breakdown = values.contextBreakdown
      var used = null
      if (pressure !== null && pressure !== undefined) {
        if (typeof pressure.projectedTokens === 'number') used = pressure.projectedTokens
        else if (typeof pressure.pressureTokens === 'number') used = pressure.pressureTokens
      }
      var win =
        pressure !== null && pressure !== undefined && typeof pressure.contextWindow === 'number'
          ? pressure.contextWindow
          : null
      var tokens = null
      if (usage !== null && usage !== undefined) {
        var read = typeof usage.cacheReadTokens === 'number' ? usage.cacheReadTokens : 0
        var write = typeof usage.cacheWriteTokens === 'number' ? usage.cacheWriteTokens : 0
        var uncached = typeof usage.uncachedInputTokens === 'number' ? usage.uncachedInputTokens : 0
        var output = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0
        tokens = {
          input: uncached + read + write,
          output: output,
          cacheRead: read,
          cacheWrite: write,
          // 「未快取輸入」是 DSH 那個對話框會單獨列出來的一格，所以留著。
          uncached: uncached,
        }
      }
      var parts = null
      if (breakdown !== null && breakdown !== undefined) {
        parts = {
          system: typeof breakdown.systemTokens === 'number' ? breakdown.systemTokens : 0,
          tools: typeof breakdown.toolsTokens === 'number' ? breakdown.toolsTokens : 0,
          messages: typeof breakdown.messageTokens === 'number' ? breakdown.messageTokens : 0,
        }
      }
      // 輪數／步數／各種用時／解碼速度——**跟 DSH 自己那排統計與那個對話框同一個來源**
      // （`sessionStats` 投影）。DSH 的「會話統計」那一段就是這幾個數字。
      var stats = null
      if (values.sessionStats !== null && values.sessionStats !== undefined) {
        var one = values.sessionStats
        var decodeMs = typeof one.decodeMs === 'number' ? one.decodeMs : 0
        var decodeTokens = typeof one.decodeTokens === 'number' ? one.decodeTokens : 0
        var ttftSteps = typeof one.ttftSteps === 'number' ? one.ttftSteps : 0
        var ttftMs = typeof one.ttftMs === 'number' ? one.ttftMs : 0
        stats = {
          turns: typeof one.turns === 'number' ? one.turns : 0,
          steps: typeof one.steps === 'number' ? one.steps : 0,
          tokPerSec: decodeMs > 0 && decodeTokens > 0 ? (decodeTokens / decodeMs) * 1000 : null,
          llmMs: typeof one.llmMs === 'number' ? one.llmMs : 0,
          toolMs: typeof one.toolMs === 'number' ? one.toolMs : 0,
          // 「首 token 平均（TTFT）」＝總 TTFT ÷ 有回報 TTFT 的步數（DSH 也是取平均）。
          avgTtftMs: ttftSteps > 0 ? ttftMs / ttftSteps : null,
        }
      }
      if (used === null && tokens === null && parts === null && stats === null) return null
      return { contextWindow: win, baselineTokens: used, usage: tokens, parts: parts, stats: stats }
    }

    /*
     * 下面三個是那一列的圖示。前兩個是**照抄 DSH 自己那排統計**用的圖示
     * （`dsh-client-ui-chat` 的 StatsPills：16×16、`stroke: currentColor`、`stroke-width: 1.25`），
     * 第三個是它那顆上下文計量環（`dsh-client-ui-conversation` 的 ContextMeter：
     * 14×14、半徑 5.5、`stroke-width: 2`、從 12 點鐘方向開始畫）。
     * 路徑與數字都是從它的 DOM 與 CSS 直接抄下來的，不是自己畫的。
     */

    /**
     * 時間的顯示格式——**照 DSH 那個對話框的寫法**：不到一分鐘寫 `2.4秒`，
     * 超過就寫 `152分41秒`／`2分01秒`（秒數補零到兩位）。
     */
    function fmtDuration(ms) {
      if (typeof ms !== 'number' || isNaN(ms) || ms < 0) return '—'
      if (ms < 60000) return (ms / 1000).toFixed(1) + '秒'
      var minutes = Math.floor(ms / 60000)
      var seconds = Math.round((ms % 60000) / 1000)
      // 四捨五入到 60 秒就進位，不要出現「2分60秒」。
      if (seconds === 60) {
        minutes += 1
        seconds = 0
      }
      return String(minutes) + '分' + (seconds < 10 ? '0' + String(seconds) : String(seconds)) + '秒'
    }

    /**
     * 本輪的輸出速度（tok/s）＝本輪輸出 token ÷ 本輪秒數。
     *
     * 跟 DSH 同一條公式（`deriveTurnMetrics`：`outputTokens / (decodeMs / 1e3)`），
     * 差別只在分母：這裡用**整輪的牆上時間**（串流沒有把解碼時間單獨報給客戶端），
     * 所以它比 DSH 那個數字略低——寧可低估也不要假裝精確。
     *
     * @returns tok/s，或 `null`（沒有用量／時間為零）。
     */
    function turnSpeedOf(usage, ms) {
      if (usage === null || usage === undefined || typeof ms !== 'number' || ms <= 0) return null
      var out = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0
      if (out <= 0) return null
      return out / (ms / 1000)
    }

    /** 時鐘：那一輪花了多久（DSH 訊息上「用时 3分28秒」那一顆的圖示）。 */
    function IconClock() {
      if (PRIMITIVES !== null && PRIMITIVES.IconClockOutline16 !== undefined) {
        return React.createElement(PRIMITIVES.IconClockOutline16)
      }
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        React.createElement('circle', {
          cx: 8,
          cy: 8,
          r: 6.375,
          stroke: 'currentColor',
          strokeWidth: 1.25,
        }),
        React.createElement('path', {
          d: 'M8 4.4V8.3L10.7 9.85',
          stroke: 'currentColor',
          strokeWidth: 1.25,
        }),
      )
    }

    /**
     * 用量面板／訊息面板共用的一列：**標籤靠左、數字靠右**。
     *
     * 這是 DSH 那個對話框的排版（它那顆環的面板用的也是 `margin-left:auto` 的數字）。
     * 抽到模組層是因為**兩個地方都要用**：輸入框那排 pill 的面板，以及訊息上
     * 「用量」那個標籤點開的面板。
     */
    function usageLine(key, label, text) {
      return React.createElement(
        'div',
        { className: 'dsh-tv-usageLine', key: key },
        React.createElement('span', null, label),
        React.createElement('span', { className: 'dsh-tv-usageFig' }, text),
      )
    }

    /** 同上：一個段落（標題 ＋ 幾列）。 */
    function usageSection(key, title, lines) {
      return React.createElement(
        'div',
        { className: 'dsh-tv-usageSection', key: key },
        React.createElement('div', { className: 'dsh-tv-usageTitle' }, title),
        lines,
      )
    }

    /** 千分位（DSH 那個對話框寫 `775,465 tok`，不是 `775K`）。 */
    function grouped(n) {
      return String(typeof n === 'number' ? n : 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    /**
     * 供應方回報的那一輪用量 → 存進訊息裡的形狀。
     *
     * 兩個地方的欄位名不一樣是**刻意的**：串流來的是 provider 的
     * `{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens}`，
     * 而存進 `chat.jsonl` 的 `extra.usage` 用短名字（那是我們自己的欄位，會跟著檔案走，
     * 短一點比較好讀）。找不到的欄位一律 0。
     */
    function turnUsageForMessage(turn) {
      if (turn === null || turn === undefined || typeof turn !== 'object') return null
      var num = function (value) {
        return typeof value === 'number' && value >= 0 ? value : 0
      }
      return {
        input: num(turn.inputTokens),
        output: num(turn.outputTokens),
        cacheRead: num(turn.cacheReadTokens),
        cacheWrite: num(turn.cacheWriteTokens),
        reasoning: num(turn.reasoningTokens),
      }
    }

    /* ---------------------------- 附件（上傳／送出） ----------------------------
     *
     * 使用者：「沒法上傳檔案」。酒館的對話頁以前只有插圖那幾個 `<input type="file">`
     * （那是「這一間房的插圖」），**送訊息時沒有任何附件鈕**——這一組就是補那一塊。
     *
     * 兩條路，照 DSH 自己的 composer 分（讀 `dsh-client-ui-conversation` 的
     * `sendSession` 得到的，不是猜的）：
     *   - **圖片**：`{type:'image', mediaType, data(base64), name}` 直接跟著 prompt 送，
     *     宿主會把它變成耐用附件——**只有這樣模型才真的看得到那張圖**。
     *   - **其他檔案**：先 `fileUpload.upload(sessionId, …)` 拿 `receiptId`，
     *     prompt 裡放 `{type:'file', receiptId}`（那是一次性憑證，綁在那個 session 上）。
     *
     * 另外兩份都要在**房間裡**留一份普通檔案（`<room>/files/`）：DSH 那一份住在它的
     * 內部儲存裡，使用者看不到、帶不走，而酒館的立場是「這個資料夾帶走就好」。
     */

    /** DSH 的附件只認這四種圖片（`ImageMediaType`）。 */
    var ATTACHMENT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

    /** 這個 MIME 是不是走「圖片」那條路。 */
    function attachmentKindOf(mediaType) {
      return ATTACHMENT_IMAGE_TYPES.indexOf(mediaType) >= 0 ? 'image' : 'file'
    }

    /**
     * 待送附件 → 寫進訊息、也寫進 `chat.jsonl` 的形狀。
     *
     * ⚠️ **名字在就留著，即使還沒有 URL**：附件存進房間是送出之後的事（要等 session），
     * 而「這一則帶了什麼」在按下送出的那一刻就該看得到。真的存不進去（太大、宿主還沒
     * 重啟）時，畫面上是一顆**不能點**的 chip——比什麼都不畫誠實。
     */
    function mediaOfAttachments(list) {
      var items = Array.isArray(list) ? list : []
      var out = []
      for (var i = 0; i < items.length; i += 1) {
        var one = items[i]
        if (one === null || typeof one !== 'object') continue
        var url = typeof one.url === 'string' ? one.url : ''
        var name = typeof one.name === 'string' ? one.name : ''
        if (url === '' && name === '') continue
        out.push({
          type: one.kind === 'image' ? 'image' : 'file',
          url: url,
          name: name,
          bytes: typeof one.bytes === 'number' && one.bytes >= 0 ? one.bytes : 0,
        })
      }
      return out
    }

    /**
     * 組出這一輪的 prompt content。
     *
     * ⚠️ **附件在前面、文字在後面**——這是 DSH 自己的順序（`serializeAttachments()`
     * 先展開，`text` 才 push 進去）。反過來的話模型先讀到問題、後讀到圖，
     * 對「這張圖是什麼」這種問法差很多。
     *
     * @param encoded - `[{kind:'image', mediaType, data, name}]` 或 `[{kind:'file', receiptId}]`
     * @param text - 使用者打的字（可以是空的：只丟圖不說話是合法的）
     */
    function buildPromptContent(encoded, text) {
      var parts = []
      var list = Array.isArray(encoded) ? encoded : []
      for (var i = 0; i < list.length; i += 1) {
        var one = list[i]
        if (one === null || typeof one !== 'object') continue
        if (one.kind === 'image' && typeof one.data === 'string' && one.data !== '') {
          var imagePart = { type: 'image', mediaType: one.mediaType, data: one.data }
          if (typeof one.name === 'string' && one.name !== '') imagePart.name = one.name
          parts.push(imagePart)
          continue
        }
        if (one.kind === 'file' && typeof one.receiptId === 'string' && one.receiptId !== '') {
          parts.push({ type: 'file', receiptId: one.receiptId })
        }
      }
      if (typeof text === 'string' && text.trim() !== '') parts.push({ type: 'text', text: text })
      return parts
    }

    /**
     * 送出**當下**那一則訊息的附件（畫面上的那一份）。
     *
     * 跟 {@link mediaOfAttachments} 共用同一個形狀，差別只有一個：那時候還沒存進房間，
     * 所以優先用本輪的預覽 object URL（圖片才有）。
     */
    function previewMediaOf(list) {
      var items = Array.isArray(list) ? list : []
      var out = []
      for (var i = 0; i < items.length; i += 1) {
        var one = items[i]
        if (one === null || typeof one !== 'object') continue
        var url = typeof one.previewUrl === 'string' && one.previewUrl !== '' ? one.previewUrl : one.url
        var name = typeof one.name === 'string' ? one.name : ''
        if (typeof url !== 'string' || (url === '' && name === '')) continue
        out.push({
          type: one.kind === 'image' ? 'image' : 'file',
          url: url,
          name: name,
          bytes: typeof one.bytes === 'number' && one.bytes >= 0 ? one.bytes : 0,
        })
      }
      return out
    }

    /* --------------------------- 模型與推理等級 ---------------------------
     *
     * 這一組是純函式，形狀照 **DSH 自己的 `ui-model-selection`**（讀它的 `client.js`
     * 得到的事實，不是猜的）：
     *
     *   choices          = 目錄裡每個模型一個，selection 帶著該模型的 `defaultEffort`
     *   currentChoice    = 以 **provider ＋ model** 兩個欄位比對（只看 model 會撞）
     *   effectiveEffort  = `current.reasoningEffort ?? reasoning.defaultEffort`
     *   effortLabel      = 那個等級的 name；沒有等級可報時是「提供方預設」
     *   effortChoices    = **只有模型沒有 defaultEffort 時**才多一列「提供方預設」
     *
     * 抽成純函式是為了測得到——先前這一整段住在 render 裡，於是「目錄的形狀不如預期」
     * 直接變成**整頁空白**（那個 bug 真的發生過兩次）。
     */

    /** 一個選項的識別：`provider/model`。兩個欄位都要，缺一不可。 */
    function modelKeyOf(selection) {
      if (selection === null || selection === undefined) return ''
      var provider = typeof selection.provider === 'string' ? selection.provider : ''
      var model = typeof selection.model === 'string' ? selection.model : ''
      if (provider === '' || model === '') return ''
      return provider + '/' + model
    }

    /** 這個模型的推理等級清單（形狀壞掉就當沒有）。 */
    function effortsOfModel(model) {
      if (model === null || model === undefined) return []
      var reasoning = model.reasoning
      if (reasoning === null || reasoning === undefined) return []
      return Array.isArray(reasoning.efforts) ? reasoning.efforts : []
    }

    /** 這個模型的預設等級（沒有就 `undefined`——**跟空字串不一樣**，見上面那段）。 */
    function defaultEffortOfModel(model) {
      if (model === null || model === undefined) return undefined
      var reasoning = model.reasoning
      if (reasoning === null || reasoning === undefined) return undefined
      return typeof reasoning.defaultEffort === 'string' ? reasoning.defaultEffort : undefined
    }

    /**
     * 目前生效的等級：**使用者挑的優先，否則模型的預設**（DSH 的 `??` 語意）。
     * @returns 等級 id，或 `undefined`（＝沒有指定，交給提供方）
     */
    function effectiveEffortOf(model, selection) {
      var wanted =
        selection !== null && selection !== undefined && typeof selection.effort === 'string'
          ? selection.effort
          : ''
      if (wanted !== '') return wanted
      return defaultEffortOfModel(model)
    }

    /**
     * chip 上那一格要寫什麼（DSH 的 `effortLabel`）。
     *
     * ⚠️ 判斷的是 **`reasoning` 這一層在不在**，不是「有沒有等級」：DSH 是
     * `reasoning === undefined ? undefined : (… ?? t('effort.providerDefault'))`
     * ——所以 `reasoning: {}`（存在但空的）**會**顯示「提供方預設」，完全沒有這一層的
     * 模型則連那一格都不出現。
     *
     * @returns 字串；**空字串＝這個模型沒有推理等級，那一格不要出現**
     */
    function effortLabelOf(model, selection) {
      if (model === null || model === undefined) return ''
      var reasoning = model.reasoning
      if (reasoning === null || reasoning === undefined) return ''
      var effective = effectiveEffortOf(model, selection)
      if (effective === undefined || effective === '') return '提供方預設'
      var efforts = effortsOfModel(model)
      for (var i = 0; i < efforts.length; i += 1) {
        var one = efforts[i]
        if (one === null || one === undefined) continue
        if (String(one.id) === String(effective)) {
          return typeof one.name === 'string' && one.name !== '' ? one.name : String(effective)
        }
      }
      return String(effective)
    }

    /**
     * 這個模型可以選的等級（DSH 的 `effortChoices`）。
     *
     * ⚠️ 兩條規矩都照 DSH：
     *   1. **完全沒有 `reasoning` 這一層 → 沒有等級可選**（那一格也不顯示）。
     *   2. 「提供方預設」那一列**只在模型沒有 `defaultEffort` 時**出現——模型自己有
     *      預設時，預設就是基準，再給一列「不指定」只是把同一個結果講兩次。
     */
    function effortOptionsOf(model) {
      if (model === null || model === undefined) return []
      var reasoning = model.reasoning
      if (reasoning === null || reasoning === undefined) return []
      var out = []
      if (defaultEffortOfModel(model) === undefined) out.push({ id: '', name: '提供方預設' })
      var efforts = effortsOfModel(model)
      for (var i = 0; i < efforts.length; i += 1) {
        var one = efforts[i]
        if (one === null || one === undefined || typeof one.id !== 'string' || one.id === '') continue
        out.push({
          id: one.id,
          name: typeof one.name === 'string' && one.name !== '' ? one.name : one.id,
          description: typeof one.description === 'string' ? one.description : '',
        })
      }
      return out
    }

    /**
     * 把「使用者挑的等級」收斂成這條路由真的吃得下的值。
     *
     * 換模型時尤其重要：上一個模型的等級（例如 `max`）在新模型上可能不存在，
     * 直接送過去會被宿主拒絕或默默忽略。**不收斂就會出現「選了卻沒生效」**。
     * @returns 等級 id，或 `''`（不指定）
     */
    function resolveEffortFor(model, wanted) {
      var options = effortOptionsOf(model)
      if (options.length === 0) return ''
      var text = typeof wanted === 'string' ? wanted : ''
      if (text === '') {
        // 沒挑過 → 用模型自己的預設（沒有就「不指定」）。
        var fallback = defaultEffortOfModel(model)
        return fallback === undefined ? '' : fallback
      }
      for (var i = 0; i < options.length; i += 1) {
        if (options[i].id === text) return text
      }
      var fallback2 = defaultEffortOfModel(model)
      return fallback2 === undefined ? '' : fallback2
    }

    /** 目錄裡找一個模型（找不到回 `null`）——**provider 與 model 都要對**。 */
    function findCatalogModel(catalog, selection) {
      if (catalog === null || catalog === undefined || !Array.isArray(catalog.groups)) return null
      var key = modelKeyOf(selection)
      if (key === '') return null
      for (var g = 0; g < catalog.groups.length; g += 1) {
        var group = catalog.groups[g]
        if (group === null || group === undefined) continue
        if (String(group.id) !== String(selection.provider)) continue
        var models = Array.isArray(group.models) ? group.models : []
        for (var m = 0; m < models.length; m += 1) {
          var one = models[m]
          if (one === null || one === undefined) continue
          if (String(one.id) === String(selection.model)) return one
        }
      }
      return null
    }

    /**
     * chip 上的模型名稱（DSH 的 `triggerLabel`）。
     *
     * ⚠️ 是**顯示名稱**，不是 id（`deepseek-chat` 之於「DeepSeek Chat」）。目錄還沒讀到
     * 或找不到時退回 id——**看得到比好看重要**。
     */
    function modelLabelOf(catalog, selection) {
      var key = modelKeyOf(selection)
      if (key === '') return ''
      var found = findCatalogModel(catalog, selection)
      if (found !== null && typeof found.name === 'string' && found.name !== '') return found.name
      return String(selection.model)
    }

    /**
     * chip 上要寫什麼（DSH 的 `modelLabel`／`triggerLabel`／`triggerAria`）。
     *
     * 照它那三行的規則：
     *   - 目錄還在讀、而且還不知道用哪個 → 「正在載入模型…」
     *   - 目錄已經讀到、這一間房也有 selection → 目錄裡的**顯示名稱**
     *   - 完全不知道 → 「選擇模型」
     *   - 目錄裡找不到這個模型（例如被下架了）→ 老實寫 `provider/model`
     *   - `triggerLabel` ＝ `模型名 · 等級`（**中間是 `·`**，不是一整句中文）
     *
     * 抽成純函式是為了測得到：這幾行分支不少，而寫錯的症狀是「chip 上出現一句
     * 看起來像 debug 的字」——不會丟錯，只會很難看。
     */
    function chipTextOf(state) {
      var loading = state.loading === true
      var selection = state.selection
      var known = state.known === true
      var modelLabel = state.modelLabel
      var effortLabel = state.effortLabel
      var label
      if (loading) label = '正在載入模型…'
      else if (selection === null || selection === undefined) label = '選擇模型'
      else if (known) label = modelLabel
      else label = String(selection.provider) + '/' + String(selection.model)
      var title = effortLabel === '' ? label : label + ' · ' + effortLabel
      var aria
      if (loading) aria = '正在載入模型…'
      else if (selection === null || selection === undefined) aria = '選擇模型'
      else if (effortLabel === '') aria = '選擇模型，目前 ' + label
      else aria = '選擇模型，目前 ' + label + '，推理等級 ' + effortLabel
      return { label: label, title: title, aria: aria }
    }

    /** 送出鍵的箭頭——DSH 的 `.uV2eYG_primary` 就是這一顆（34×34 圓形、往上）。 */
    function IconSendArrow() {
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        React.createElement('path', {
          d: 'M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z',
          fill: 'currentColor',
        }),
      )
    }

    /** 碼錶：幾輪幾步、跑多快。 */
    function IconStopwatch() {
      // 共用資源優先：DSH 自己那顆碼錶（拿不到才用下面手刻的）。
      if (PRIMITIVES !== null && PRIMITIVES.IconAlarmClockOutline16 !== undefined) {
        return React.createElement(PRIMITIVES.IconAlarmClockOutline16)
      }
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        React.createElement('path', {
          d: 'M3.49 13.26A6.375 6.375 0 1 1 12.51 13.26',
          stroke: 'currentColor',
          strokeWidth: 1.25,
        }),
        React.createElement('path', {
          d: 'M8 8.75L11.4 5.35',
          stroke: 'currentColor',
          strokeWidth: 1.25,
        }),
        React.createElement('circle', { cx: 8, cy: 8.75, r: 1.55, fill: 'currentColor' }),
      )
    }

    /** 資料庫：累計 token 與快取命中。 */
    function IconDatabase() {
      if (PRIMITIVES !== null && PRIMITIVES.IconDatabaseOutline16 !== undefined) {
        return React.createElement(PRIMITIVES.IconDatabaseOutline16)
      }
      return React.createElement(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        React.createElement('ellipse', {
          cx: 8,
          cy: 3.6,
          rx: 5.75,
          ry: 2.4,
          stroke: 'currentColor',
          strokeWidth: 1.25,
        }),
        React.createElement('path', {
          d: 'M2.25 3.6V12.3A5.75 2.4 0 0 0 13.75 12.3V3.6',
          stroke: 'currentColor',
          strokeWidth: 1.25,
        }),
        React.createElement('path', {
          d: 'M2.25 7.95A5.75 2.4 0 0 0 13.75 7.95',
          stroke: 'currentColor',
          strokeWidth: 1.25,
        }),
      )
    }

    /**
     * 📎 附件鈕。
     *
     * 共用資源優先：DSH 自己的 composer 用的就是 `IconPaperclipOutline16`
     * （`dsh-client-ui-conversation` 的 `client.js`：`(0, primitives.IconPaperclipOutline16,
     * { size: 14 })`），所以拿得到就用它，拿不到才用下面手刻的迴紋針。
     */
    function IconPaperclip() {
      if (PRIMITIVES !== null && PRIMITIVES.IconPaperclipOutline16 !== undefined) {
        return React.createElement(PRIMITIVES.IconPaperclipOutline16, { size: 14 })
      }
      return React.createElement(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        React.createElement('path', {
          d: 'M10.9 4.6 5.6 9.9a1.9 1.9 0 0 0 2.7 2.7l5.3-5.3a3.8 3.8 0 0 0-5.4-5.4L3.5 6.6a5.7 5.7 0 0 0 0 8.1',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinecap: 'round',
        }),
      )
    }

    /**
     * 選單上「目前是這一個」的那個勾。
     *
     * ⚠️ 抽出來是因為**它本來有兩份**（模型清單與推理等級各寫了一次同樣的三元式），
     * 而新加的工具權限那一顆會是第三份。優先用 DSH 的共用圖示，沒有才退回字元的 ✓
     * ——這個 repo 的圖示一律先找 `PRIMITIVES`（`plan.md` §2.6.41：能讀原始碼就不要猜）。
     */
    function CheckMark() {
      if (PRIMITIVES !== null && PRIMITIVES.IconCheckOutline16 !== undefined) {
        return React.createElement(PRIMITIVES.IconCheckOutline16)
      }
      return React.createElement('span', null, '✓')
    }

    /**
     * 工具權限那一顆 chip 的圖示——**盾牌**（照 DSH 訪問模式那顆的形狀，
     * 但畫成這個 repo 的線條風格：16 格、`stroke-width:1.25`、`currentColor`）。
     */
    function PermIcon() {
      return React.createElement(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        React.createElement('path', {
          d: 'M8 1.9 13.6 4v4.1c0 3.3-2.3 5.6-5.6 6.9-3.3-1.3-5.6-3.6-5.6-6.9V4L8 1.9Z',
          stroke: 'currentColor',
          strokeWidth: 1.25,
          strokeLinejoin: 'round',
        }),
      )
    }

    /** 附件 chip 上那顆「拿掉」（同樣先找 DSH 的共用圖示）。 */
    function IconAttachRemove() {
      if (PRIMITIVES !== null && PRIMITIVES.IconCloseOutline16 !== undefined) {
        return React.createElement(PRIMITIVES.IconCloseOutline16, { size: 12 })
      }
      return React.createElement(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        React.createElement('path', {
          d: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      )
    }

    /**
     * 上下文佔用環。
     *
     * ⚠️ 圓周長是 `2πr`（r=5.5）＝34.56，DSH 就是用這個數字當 `stroke-dasharray` 的
     * 第二個值、第一個值是 `佔用比例 × 圓周長`，再 `rotate(-90 7 7)` 讓它從 12 點鐘
     * 方向開始。照抄才不會「看起來差不多但比例不對」。
     */
    function ContextRing(props) {
      var circumference = 2 * Math.PI * 5.5
      var share = typeof props.share === 'number' ? Math.max(0, Math.min(1, props.share)) : 0
      var cls =
        'dsh-tv-usageRingFill' +
        (share >= 0.95 ? ' dsh-tv-usageRingCrit' : share >= 0.8 ? ' dsh-tv-usageRingWarn' : '')
      return React.createElement(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
        React.createElement('circle', { className: 'dsh-tv-usageRingTrack', cx: 7, cy: 7, r: 5.5 }),
        React.createElement('circle', {
          className: cls,
          cx: 7,
          cy: 7,
          r: 5.5,
          strokeDasharray:
            (share * circumference).toFixed(2) + ' ' + circumference.toFixed(2),
          transform: 'rotate(-90 7 7)',
        }),
      )
    }

    /**
     * 用 DSH 自己的「用…開啟」把一個資料夾打開。
     *
     * 走 DSH 的原生路由（`dsh-host-open-in-app`），所以**不需要我們自己的宿主半程式碼**：
     *   `GET  /open-in-app/apps` → `{ apps: [id…] }`（只有「這台真的可用」的）
     *   `POST /open-in-app/open` → `{ app, path }`
     *     —— `app` 必須在清單裡且可用、`path` 必須是**指到存在目錄的絕對路徑**
     *     （DSH 會用它自己的訊息拒絕，例如 `directory does not exist: …`）。
     *
     * 為什麼優先挑檔案管理器而不是清單第一筆：清單裡也可能有編輯器之類的東西，
     * 拿第一筆去開資料夾會開錯應用。認不得就退回第一筆（至少能用），失敗照實回報。
     *
     * @param path - 要打開的絕對路徑。
     * @param done - `done('')` 成功、`done(訊息)` 失敗。
     */
    function openFolder(path, done) {
      var preferred = ['explorer', 'finder', 'dolphin', 'nautilus', 'files', 'open', 'xdg-open']
      fetch('/open-in-app/apps', { credentials: 'same-origin' })
        .then(function (response) {
          if (response.ok !== true) {
            throw new Error('拿不到可用清單（HTTP ' + String(response.status) + '）')
          }
          return response.json()
        })
        .then(function (payload) {
          var apps = payload !== null && Array.isArray(payload.apps) ? payload.apps : []
          if (apps.length === 0) throw new Error('這台沒有可用的「開啟」應用')
          var pick = null
          for (var i = 0; i < preferred.length && pick === null; i += 1) {
            if (apps.indexOf(preferred[i]) >= 0) pick = preferred[i]
          }
          if (pick === null) pick = apps[0]
          return fetch('/open-in-app/open', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ app: pick, path: path }),
          })
        })
        .then(function (response) {
          if (response.ok !== true) {
            throw new Error('開啟失敗（HTTP ' + String(response.status) + '）')
          }
          done('')
        })
        .catch(function (error) {
          done(String((error && error.message) || error))
        })
    }

    /**
     * 對話頁的分頁（使用者：「進階設定就像大廳一樣，用分頁來完成」）。
     *
     * 以前插圖管理器、檔案路徑這些「不是聊天本身」的東西全部疊在訊息下面——
     * 對話一長，下面那一坨就被推到看不見的地方，而且它們跟訊息混在同一個捲動區裡。
     * 分頁之後預設永遠是乾淨的對話畫面，要看房間的圖或檔案再切過去。
     *
     * 用模組層級的變數而不是 `useState`，理由同 `currentZone`：這個面板是常駐的，
     * 而且離線測試的假 React 不跑 setState，靠它驗不到切換。
     */
    var CHAT_TABS = [
      { key: 'chat', label: '💬 對話' },
      { key: 'art', label: '🖼️ 插圖' },
      // 每間房自己的設定：它**蓋過**酒館那一層（使用者：「有些設定適合精細化設定
      // 而不適合全域設定」）。寫進 `chats/<角色>/<roomId>/room.json`。
      { key: 'room', label: '⚙️ 房間' },
      /**
       * ⚠️ **這一間房的藏書管理**（2.6.65）。使用者：
       *   > 房間也要世界書管理頁面，酒館的是預設所有房間都會是預設，
       *   > 房間的時候其微調可以自己在整理兩層，所以要加一個新標籤
       *
       * 所以它是一個**獨立分頁**，不是 ⚙️ 房間 裡的一格：藏書是清單（一本一列），
       * 塞進設定那一頁會變成一大塊。而「酒館的是預設、房間是微調」正是
       * 我們的三層優先序（書 → 房 → 酒館）。
       */
      { key: 'books', label: '📖 藏書' },
      { key: 'file', label: '📄 檔案' },
    ]
    var currentChatTab = 'chat'

    /* ------------------------ 角色卡的匯出（純函式） ------------------------ */
    //
    // ⚠️ **這一段必須留在外層作用域。**
    //
    // 它一開始被我放在卡片編輯器裡面（用起來比較「近」），結果測試要用時是
    // `v3Card is not defined`——編輯器在內層，而匯出物件在外層，看不到它。
    // 這個 repo 裡「內層看得到外層、外層看不到內層」已經絆倒過兩次（另一次是
    // `openChat`／`chatKeyOf`），所以純函式一律放這一層。
    //
    // 這些同時是**跨面契約**的實作端：宿主半有一份對應的讀取端（`lib/pngcard.js`），
    // 測試拿這裡產生的位元組交給那裡讀——只有 base64、CRC 與 chunk 佈局全部正確
    // 才會一致。兩邊刻意各有一份（瀏覽器半不能 import 宿主半的模組）。

    /** CRC32 查表。PNG 規定每個區塊尾巴要帶「型別＋內容」的 CRC32。 */
    var CRC_TABLE = (function () {
      var table = []
      for (var n = 0; n < 256; n += 1) {
        var c = n
        for (var k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
      }
      return table
    })()

    function crc32(bytes) {
      var value = -1
      for (var i = 0; i < bytes.length; i += 1) {
        value = (CRC_TABLE[(value ^ bytes[i]) & 0xff] ^ (value >>> 8)) >>> 0
      }
      return (value ^ -1) >>> 0
    }

    /** UTF-8 字串 → base64（`btoa` 只吃 latin1，所以要先把位元組攤開）。 */
    function base64OfUtf8(text) {
      var bytes = new TextEncoder().encode(text)
      var binary = ''
      for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
      return btoa(binary)
    }

    /**
     * 把卡片資料接進 PNG（`tEXt` 區塊），回傳新的位元組。
     *
     * **接區塊，不是重新編碼**：插在 `IEND` 之前，`IDAT` 一格都不動，所以畫質零
     * 損失，也不需要任何影像函式庫。格式說明在 `lib/pngcard.js`。
     *
     * @param bytes - 原始 PNG（`Uint8Array`）
     * @param card - 卡片物件
     * @param keyword - `ccv3`（V3）或 `chara`（V2）
     */
    function spliceCardChunk(bytes, card, keyword) {
      var head = keyword + '\u0000' + base64OfUtf8(JSON.stringify(card))
      var payload = new Uint8Array(head.length)
      for (var i = 0; i < head.length; i += 1) payload[i] = head.charCodeAt(i) & 0xff

      var chunk = new Uint8Array(12 + payload.length)
      var view = new DataView(chunk.buffer)
      view.setUint32(0, payload.length)
      chunk[4] = 116 // t
      chunk[5] = 69 //  E
      chunk[6] = 88 //  X
      chunk[7] = 116 // t
      chunk.set(payload, 8)
      var crcInput = new Uint8Array(4 + payload.length)
      crcInput.set([116, 69, 88, 116], 0)
      crcInput.set(payload, 4)
      view.setUint32(8 + payload.length, crc32(crcInput))

      var source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      var at = 8
      while (at + 8 <= bytes.length) {
        var length = source.getUint32(at)
        var type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
        if (type === 'IEND') {
          var out = new Uint8Array(bytes.length + chunk.length)
          out.set(bytes.subarray(0, at), 0)
          out.set(chunk, at)
          out.set(bytes.subarray(at), at + chunk.length)
          return out
        }
        at += 12 + length
      }
      throw new Error('這個檔案不是完整的 PNG（找不到 IEND 區塊）')
    }

    /**
     * 把編輯器裡的欄位包成 **V3 信封**。
     *
     * 匯出用 V3（區塊關鍵字 `ccv3`）而不是 V2：規格最新的一版，SillyTavern 也優先
     * 讀它。V3 有幾個**寫死必填**的欄位一定要補齊——`group_only_greetings` 少了一定
     * 會被嚴格的實作退貨（`verify.mjs` 也盯著出貨範例有沒有它）。
     */
    function v3Card(inner) {
      var data = {}
      for (var key in inner) {
        if (Object.prototype.hasOwnProperty.call(inner, key)) data[key] = inner[key]
      }
      if (Array.isArray(data.group_only_greetings) === false) data.group_only_greetings = []
      if (Array.isArray(data.alternate_greetings) === false) data.alternate_greetings = []
      // 規格給的預設值：`ccdefault:` 指的是「這張 PNG 自己」。
      if (Array.isArray(data.assets) === false) {
        data.assets = [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }]
      }
      data.spec = 'chara_card_v3'
      data.spec_version = '3.0'
      return { spec: 'chara_card_v3', spec_version: '3.0', data: data }
    }

    /** 把一段位元組存成檔案。 */
    function download(name, blob) {
      var url = URL.createObjectURL(blob)
      var link = document.createElement('a')
      link.href = url
      link.download = name
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(function () {
        URL.revokeObjectURL(url)
      }, 1000)
    }

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


    /**
     * 我們**上一次要求**的主面板 key。
     *
     * `layout.selectPanel()` 只有 setter，沒有 getter，所以側邊欄沒辦法問
     * 「現在主面板是哪一個」。而 ＋ 要判斷「我是不是已經在包廂裡了」——
     * 沒有這一格就只能猜。所有面板切換都經過 `selectPanel`，所以在這裡記一份就夠。
     */
    var shownPanel = ''

    /** 切換主面板；失敗只記錄，不讓 UI 爆掉。 */
    function selectPanel(key) {
      try {
        var layout = ctxRef === null ? null : ctxRef.get('layout')
        if (layout !== null && layout !== undefined && typeof layout.selectPanel === 'function') {
          layout.selectPanel(key)
          // 真的切了才記（`layout` 還沒就緒時呼叫等於沒發生）。
          shownPanel = key
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
          /**
           * 「裝修」：把這間酒館的 `theme.json` ＋ `custom.css` 套上去。
           *
           * ⚠️ **這一行以前不存在**（2026-09-22 才發現）：`ensureTheme()` →
           * `theme.read` → `applyTheme()` 整條鏈**從來沒有被呼叫過**，所以
           * `theme.json` 與 `custom.css` 一直是死的——畫面用的永遠是 client 內建的
           * fallback 色票，而「裝修」只在測試裡活著。
           *
           * 同一個酒館只讀一次（`themeForTavern` 守衛）；換酒館會重讀，
           * 所以「改完重新載入頁面」是文件上那條規矩。
           */
          ensureTheme(listed.activeId)
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
          /**
           * 回覆格式（`<酒館>/render.json`）。
           *
           * ⚠️ **`summary.render` 是 `{ exists, broken, render }`**（宿主半的
           * `readRender()` 回傳值），不是那一份設定本身——所以要往下取一層。
           * 取錯的症狀是**安靜的**：`state.render` 變成一個有 `render` 鍵的物件，
           * 而每一處讀 `render.mode` 都拿到 `undefined` ⇒ 永遠走 `plain`。
           */
          state.render = summary.render && summary.render.render ? summary.render.render : null
          /**
           * ⚠️ **哪幾本世界書也在教回覆格式**（宿主半掃出來的）。
           *
           * 設定頁用它顯示「一個東西兩個來源」的警告——格式指令可以有兩個老師
           * （世界書住在訊息裡、`render.json` 住在系統提示），兩個同時開著就會
           * 給模型兩份規格。那一件事**不能靠使用者記得**。
           */
          state.formatBooks = Array.isArray(summary.formatBooks) ? summary.formatBooks : []
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
        // 離線測試可以**逐欄**餵資料進來（`testSeed` 是匯出的物件）。
        // 正式路徑永遠是 `{ loaded: false }`，所以每一欄都要有自己的預設值
        // ——`undefined` 而不是空陣列會讓下面的 `.length` 直接炸掉整個面板。
        ref.current = {
          characters: Array.isArray(testSeed.characters) ? testSeed.characters : [],
          summary: testSeed.summary !== undefined ? testSeed.summary : null,
          settings: testSeed.settings !== undefined ? testSeed.settings : null,
          // 回覆格式（`render.json` 的那一份設定本身，不是外層的信封）。
          render: testSeed.render !== undefined ? testSeed.render : null,
          // 哪幾本世界書也在教格式（宿主半掃的；設定頁的警告用）。
          formatBooks: Array.isArray(testSeed.formatBooks) ? testSeed.formatBooks : [],
          chats: typeof testSeed.chats === 'number' ? testSeed.chats : 0,
          taverns: Array.isArray(testSeed.taverns) ? testSeed.taverns : [],
          activeId: typeof testSeed.activeId === 'string' ? testSeed.activeId : '',
          error: typeof testSeed.error === 'string' ? testSeed.error : '',
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
            // ⚠️ 宿主半會把「不合法所以沒有存下來」的欄位放在 `dropped` 裡
            // （`lib/samplers.js` 的範圍檢查）。**不回報就等於沒驗**——
            // 使用者的體驗會是「我輸入了 5、按了儲存、畫面看起來成功了，
            // 但提示詞裡的溫度根本沒變」。那正是這一組欄位最糟的失敗方式。
            if (saved !== null && saved !== undefined && Array.isArray(saved.dropped) && saved.dropped.length > 0) {
              state.error = '這幾個值沒有存下來（超出範圍或格式不對）：' + saved.dropped.join('、')
            }
            render()
          })
          .catch(function (error) {
            state.error = '儲存失敗：' + String((error && error.message) || error)
            render()
          })
      }

      return { state: state, render: render, load: load, commit: commit }
    }

    /**
     * 📖 **這一間房的藏書管理**（2.6.65）。
     *
     * 使用者：
     *   > 房間也要世界書管理頁面，酒館的是預設所有房間都會是預設，
     *   > 房間的時候其微調可以自己在整理兩層，所以要加一個新標籤
     *
     * 這一頁有四件事：**這一間房的預設位置**、**每一本書的開／關**、
     * **每一本書的位置**、以及（2.6.71）**展開之後每一條條目的優先序**。
     * 前三件的優先序（`房間指定的那一本 → 書自己 → 這一間房的預設 → 酒館的預設`）
     * 由宿主半算，這一頁只顯示與送 patch。
     *
     * ⚠️ **`explicit`（書自己指定了位置）的那一列要標出來**：那一本的位置
     * **不選就用它自己的**，所以空選項的標籤要寫「書自己的（…）」而不是
     * 「聽這一間房的」——不然使用者會以為它跟著房間的預設。
     *
     * ⚠️ **2.6.71 的條目優先序是「房間調得到、書一個字都不會被改」**：
     * 值存在 `room.json` 的 `worldbookEntryOverrides`，讀的是
     * `worldbook.roomEntries`（**鍵由宿主半算**，客戶端不自己推）。
     */
    function RoomBooksPane(props) {
      var selected = props.selected
      var rpc = props.rpc
      var render = useForceRender()
      var ref = React.useRef(null)
      if (ref.current === null) {
        ref.current = {
          info: null,
          error: '',
          notice: '',
          busy: false,
          loaded: false,
          key: '',
          content: null,
          contentBusy: '',
          /**
           * 條目優先序那一格**正在打、還沒送出去**的字，鍵是 `書 id + '/' + 條目鍵`。
           *
           * ⚠️ 要有一格暫存，不然每一個按鍵都會送一次 `room.write`
           * （整份覆寫寫回磁碟）。沒有那個鍵 ＝ 沒有未提交的編輯。
           */
          draft: {},
        }
      }
      var state = ref.current
      var key = selected === null || selected === undefined ? '' : selected.character + '/' + selected.room

      var load = function () {
        if (selected === null || selected === undefined) return Promise.resolve()
        return rpc('worldbook.roomPositions', { character: selected.character, room: selected.room })
          .then(function (info) {
            state.info = info
            state.error = ''
            state.loaded = true
            render()
          })
          .catch(function (error) {
            state.error = String((error && error.message) || error)
            state.loaded = true
            render()
          })
      }
      // 換一間房 ⇒ 重讀（`useRef` 不會因為 props 改變而重置）。
      if (state.key !== key) {
        state.key = key
        state.info = null
        state.loaded = false
        // ⚠️ 沒送出去的草稿要跟著換房間清掉——留著會把 A 房打到一半的數字
        //    送進 B 房（而那是**安靜的**：使用者只會看到 B 房多了一個值）。
        state.draft = {}
      }
      // 把載入函式留在模組層級，讓離線測試叫得到（見 `roomBooksLoader` 的註解）。
      roomBooksLoader = load
      React.useEffect(function () {
        load()
      }, [key])

      /**
       * 讀一本書的條目（**按「▸ 條目」才讀**，讀到就記在 state 裡）。
       *
       * ⚠️ **兩個函式，不要合成一個**：`fetchContent` 只讀，`loadContent` 是
       * 「按下去」的行為（已經開著就收起）。寫完之後要**重讀**那一本時要用
       * `fetchContent`——用 `loadContent` 會把展開的那一本**收起來**
       * （使用者剛調完一條，畫面就折回去了）。
       *
       * ⚠️ **走 `worldbook.roomEntries`，不是 `worldbook.read`**：
       * 前者把「這一間房的優先序」與**每一條的鍵**一起算好回來（鍵是宿主半的
       * 規則，客戶端自己推就會走散）。條目的**內容仍然是唯讀**的。
       */
      var fetchContent = function (bookId) {
        state.contentBusy = bookId
        render()
        return rpc('worldbook.roomEntries', { character: selected.character, room: selected.room, book: bookId })
          .then(function (data) {
            state.contentBusy = ''
            state.content = {
              id: bookId,
              entries: data !== null && data !== undefined && Array.isArray(data.entries) ? data.entries : [],
            }
            render()
          })
          .catch(function (error) {
            state.contentBusy = ''
            state.error = '讀不到內容：' + String((error && error.message) || error)
            render()
          })
      }

      /** 按「▸ 條目」：沒開就讀、開著就收起（**收起不打第二次 rpc**）。 */
      var loadContent = function (bookId) {
        if (state.content !== null && state.content !== undefined && state.content.id === bookId) {
          state.content = null
          render()
          return Promise.resolve()
        }
        return fetchContent(bookId)
      }


      /**
       * 這一本書在這一間房的位置那一格要顯示什麼。
       *
       * ⚠️ **顯示的是「這一間房的指定」，不是算完的結果**：空字串 ＝ 這一間房
       * 不指定它（那時候用什麼，由下面那張選單的第一個選項老實寫出來）。
       * 顯示算完的結果會讓「跟酒館的」變成一個具體位置，使用者會以為自己被改過。
       */
      var roomBookPositionValueOf = function (one) {
        var overrides =
          state.info !== null && state.info !== undefined && state.info.overrides !== undefined ? state.info.overrides : {}
        var mine = overrides[one.id]
        // 壞值當成「沒有指定」（宿主半也會把它丟掉）——不要拿一個認不得的字串去填 `<select>`。
        if (mine !== null && mine !== undefined && WORLDBOOK_POSITIONS.indexOf(mine.position) >= 0) return mine.position
        return ''
      }

      /**
       * 條目優先序那一格的提交（**離開欄位或按 Enter 才送**）。
       *
       * 使用者要的行為（**在書層那一版就定下來了，這裡同一套**）：
       *
       *   > 不設定就設定預設的數字，現在不設定就直接零，那麼我輕輕一改就無法復原
       *
       * 所以那一格**永遠是一個數字**（這一間房的覆寫 → 書自己的 → 100），
       * 「還原」＝**把書自己的數字打回去**（送 `order: null` ⇒ 把那個鍵刪掉）。
       *
       * ⚠️ 清空＝**不改**（不是 0）：那一格一定要有數字，手滑刪掉不該變成一次寫入。
       * ⚠️ 打錯的字不送出去而且**要說出來**（靜靜地不送＝使用者以為存好了）。
       */
      var commitEntryOrder = function (bookId, entry) {
        var draftKey = bookId + '/' + entry.key
        var text = state.draft[draftKey]
        if (text === undefined) return
        delete state.draft[draftKey]
        render()
        var trimmed = String(text).trim()
        if (trimmed === '') return
        var wanted = Number(trimmed)
        if (Number.isInteger(wanted) === false) {
          state.error = '優先序要是整數（收到「' + trimmed + '」）——沒有送出去。'
          render()
          return
        }
        // 打回書自己的值 ⇒ 還原（把這一間房的覆寫刪掉）。
        if (wanted === entry.ownOrder) {
          if (entry.overridden === true) patchEntryOrder(bookId, entry.key, null)
          return
        }
        if (entry.overridden === true && entry.order === wanted) return
        patchEntryOrder(bookId, entry.key, wanted)
      }

      /**
       * 送一次條目覆寫（**整份 `worldbookEntryOverrides` 送出去**——宿主半是整份取代）。
       *
       * ⚠️ **只動給的那一條**：其他書、其他條目的覆寫原樣帶著。漏帶的症狀是
       * 「調了 B，A 的設定自己消失」。
       *
       * ⚠️ 鍵都刪光 ⇒ 刪掉那一本書的整包（不留 `{}`）。
       */
      var patchEntryOrder = function (bookId, entryKey, order) {
        if (selected === null || selected === undefined) return
        state.busy = true
        state.error = ''
        state.notice = ''
        render()
        var next = {}
        var current =
          state.info !== null && state.info !== undefined && state.info.entryOverrides !== undefined
            ? state.info.entryOverrides
            : {}
        for (var id in current) {
          if (Object.prototype.hasOwnProperty.call(current, id)) next[id] = current[id]
        }
        var base =
          current[bookId] !== null && current[bookId] !== undefined && typeof current[bookId] === 'object' ? current[bookId] : {}
        var bag = {}
        for (var kept in base) {
          if (Object.prototype.hasOwnProperty.call(base, kept)) bag[kept] = base[kept]
        }
        if (order === null) delete bag[entryKey]
        else bag[entryKey] = { order: order }
        if (Object.keys(bag).length === 0) delete next[bookId]
        else next[bookId] = bag
        rpc('room.write', {
          character: selected.character,
          room: selected.room,
          patch: { worldbookEntryOverrides: next },
        })
          .then(function (saved) {
            state.busy = false
            if (saved !== null && saved !== undefined && Array.isArray(saved.dropped) && saved.dropped.length > 0) {
              state.error = '這幾項沒有存下來：' + saved.dropped.join('、')
            } else {
              state.notice = '已更新這一間房的條目優先序'
            }
            render()
            // ⚠️ 重讀展開的那一本（不然畫面還留著舊的數字與灰字狀態）。
            //    用 `fetchContent`（只讀）——用 `loadContent` 會把它收起來。
            var opened = state.content !== null && state.content !== undefined ? state.content.id : null
            return load().then(function () {
              return opened === null ? undefined : fetchContent(opened)
            })
          })
          .catch(function (error) {
            state.busy = false
            state.error = String((error && error.message) || error)
            render()
          })
      }

      /**
       * 不指定這一本書的時候，它最後會用哪一個位置（給第一個選項的標籤用）。
       *
       * ⚠️ **這一個字串必須老實**：它答的是「我什麼都不選的話，它會去哪」。
       * 順位是「書自己指定的 → 這一間房的預設 → 酒館的預設 → 訊息尾巴」
       * （房間**指定的那一本**已經在上面那一格了，所以這裡不談它）。
       */
      var fallbackLabelOf = function (one) {
        var own = typeof one.ownPosition === 'string' ? one.ownPosition : ''
        if (own !== '' && WORLDBOOK_POSITION_INFO[own] !== undefined) {
          return '書自己的（' + WORLDBOOK_POSITION_INFO[own].label + '）'
        }
        return '聽這一間房的'
      }

      /**
       * 送一次覆寫 patch（**只動那一本書，而且只動給的那幾個鍵**）。
       *
       * ⚠️ **合併，不是整格取代**（2.6.71 修掉的舊行為）。以前是
       * `next[bookId] = patch`，所以「關掉再打開」會把位置一起清掉：
       * 使用者只按了開關，卻順手丟掉另一個設定——而且**畫面不會說**。
       * 現在 `null`／`''` 的值才是「刪掉那個鍵」，其他鍵原樣帶著。
       *
       * ⚠️ 鍵都刪光 ⇒ **刪掉這一本書的覆寫**（回到「照圖書館那一層」）。
       * 留一個 `{}` 在檔案裡是「有一筆沒有作用的設定」，這個 repo 不吃這種東西。
       */
      var patchBook = function (bookId, changes) {
        if (selected === null || selected === undefined) return
        state.busy = true
        state.error = ''
        state.notice = ''
        render()
        // ⚠️ 送**完整的一份覆寫**（宿主半的 `worldbookOverrides` 是整份取代）：
        //    只送被改的那一本會把其他本的覆寫清掉。
        var next = {}
        var current = state.info !== null && state.info !== undefined && state.info.overrides !== undefined ? state.info.overrides : {}
        for (var id in current) {
          if (Object.prototype.hasOwnProperty.call(current, id)) next[id] = current[id]
        }
        var base =
          current[bookId] !== null && current[bookId] !== undefined && typeof current[bookId] === 'object' ? current[bookId] : {}
        var merged = {}
        for (var kept in base) {
          if (Object.prototype.hasOwnProperty.call(base, kept)) merged[kept] = base[kept]
        }
        for (var key in changes) {
          if (Object.prototype.hasOwnProperty.call(changes, key) === false) continue
          var value = changes[key]
          if (value === null || value === undefined || value === '') delete merged[key]
          else merged[key] = value
        }
        if (Object.keys(merged).length === 0) delete next[bookId]
        else next[bookId] = merged
        rpc('room.write', {
          character: selected.character,
          room: selected.room,
          patch: { worldbookOverrides: next },
        })
          .then(function (saved) {
            state.busy = false
            if (saved !== null && saved !== undefined && Array.isArray(saved.dropped) && saved.dropped.length > 0) {
              state.error = '這幾項沒有存下來：' + saved.dropped.join('、')
            } else {
              state.notice = '已更新這一間房的藏書設定'
            }
            render()
            return load()
          })
          .catch(function (error) {
            state.busy = false
            state.error = String((error && error.message) || error)
            render()
          })
      }

      if (selected === null || selected === undefined) {
        return React.createElement('p', { className: 'dsh-tv-note' }, '先從包廂選一份對話。')
      }
      if (state.loaded !== true) {
        return React.createElement('p', { className: 'dsh-tv-note' }, '載入中…')
      }

      var books = state.info !== null && state.info !== undefined && Array.isArray(state.info.books) ? state.info.books : []
      var kids = []
      // ① 這一間房的預設位置（三態）。
      kids.push(
        React.createElement(MapSelect, {
          key: 'room-default',
          label: '這一間房的藏書預設放在哪',
          value:
            state.info !== null && state.info !== undefined && typeof state.info.room === 'string' && state.info.room !== ''
              ? state.info.room
              : '',
          options: [{ value: '', label: '聽酒館的', hint: '沿用 📖 藏書 最上面那一格（酒館層的預設）。' }].concat(
            WORLDBOOK_POSITIONS.map(function (one) {
              return { value: one, label: WORLDBOOK_POSITION_INFO[one].label, hint: WORLDBOOK_POSITION_INFO[one].hint }
            }),
          ),
          onChange: function (value) {
            state.busy = true
            render()
            rpc('room.write', {
              character: selected.character,
              room: selected.room,
              patch: { worldbookPosition: value === '' ? null : value },
            })
              .then(function () {
                state.busy = false
                state.notice = '已儲存這一間房的藏書位置'
                render()
                return load()
              })
              .catch(function (error) {
                state.busy = false
                state.error = String((error && error.message) || error)
                render()
              })
          },
        }),
      )
      // ② 每一本書一列。
      kids.push(
        React.createElement('div', { className: 'dsh-tv-fieldLabel', key: 'label' }, '這一間房會用到哪些書'),
      )
      if (books.length === 0) {
        kids.push(React.createElement('p', { className: 'dsh-tv-note', key: 'empty' }, 'worldbooks/ 裡還沒有 .json。'))
      }
      kids.push(
        React.createElement(
          'div',
          { className: 'dsh-tv-entries', key: 'list' },
          books.map(function (one) {
            var head = []
            // 開／關（這一間房不要這本書）。
            head.push(
              React.createElement(MapToggle, {
                key: 'on',
                label: '用這本書',
                checked: one.enabled !== false,
                disabled: state.busy,
                onChange: function (next) {
                  // ⚠️ 打開 ＝ **刪掉那一項**（＝照酒館那一層），不是寫 `enabled: true`
                  //    ——留一筆沒有作用的設定在檔案裡只會讓下一個人困惑。
                  // ⚠️ `patchBook` 是**合併**：關掉它不會順手把位置與優先序清掉
                  //    （2.6.71 修掉的舊行為）。
                  patchBook(one.id, { enabled: next === false ? false : null })
                },
              }),
            )
            /**
             * 書名：**純文字**。
             *
             * ⚠️ 2.6.66 曾經把它做成一顆連結（點了跳到酒館那一頁去改），2.6.68 收回來了
             * ——使用者的原話：
             *
             *   > 房間中原本也不預期改動，我實際上只需要管理啟動與否和位置就可以了，
             *   > 所有藏書都會同一在酒館中修改設定。
             */
            head.push(React.createElement('span', { className: 'dsh-tv-bookName', key: 'name' }, one.id))
            /**
             * ⚠️ **「書自訂」標籤排在這一排按鈕的最左邊**（＝位置選單前面）。
             *
             * 使用者驗收時要求的原話（先說「最右邊」，下一則自己更正）：
             *
             *   > 「書自己指定」這個字眼礙事，有些有有些沒有不要排在中間排在最右邊
             *   > 說錯了左右，應該放在哪排按鈕的最左邊，這樣按鈕就不會錯位
             *
             * **為什麼左邊才對**（真瀏覽器量到的數字）：這一列是 `flex` 而且書名
             * `flex:1`，所以右邊那一排是**貼著列右緣**排的。標籤只要在那一排的
             * **右端**，整排就會被推向左邊——實測 ▸ 內容 的右緣 **1233 → 1176**
             * （差 57px），優先序那一格 **1070 → 1012**。放在那一排的**最左邊**
             * 就只會讓那一排往左長，右緣與每一格的相對位置全部不動。
             *
             * 字也縮短了（「書自己指定」→「書自訂」）：它擠的是位置選單旁邊的位置。
             */
            if (one.explicit === true) {
              head.push(
                React.createElement(
                  'span',
                  {
                    className: 'dsh-tv-posTag',
                    key: 'explicit',
                    title:
                      '這一本書的**檔案裡**指定了位置（' +
                      (WORLDBOOK_POSITION_INFO[one.ownPosition] === undefined
                        ? String(one.ownPosition)
                        : WORLDBOOK_POSITION_INFO[one.ownPosition].label) +
                      '）——沒在上面選的話就用它',
                  },
                  '書自訂',
                ),
              )
            }
            // 位置：這一間房指定的值（空＝不指定）。
            /**
             * ⚠️ **每一本都改得動**（2.6.69）。
             *
             * 2.6.67–2.6.68 這裡是鎖住的：那時候的優先序是「書自己指定的 → 房間」，
             * 所以書自己指定過的那一本，房間怎麼選都不會生效——能改卻改不動的選單
             * 是騙人的，只好鎖起來。使用者要的是「房間可以設定位置」，
             * 所以順位改成「**房間指定的 → 書自己 → 這一間房的預設 → 酒館的預設**」，
             * 鎖就沒有理由存在了。
             *
             * ⚠️ 空格子的標籤要**老實**：不指定時它會用書自己的那一個（如果書有），
             * 所以那一本的標籤寫「書自己的（系統提示・後）」，不是「聽這一間房的」。
             */
            head.push(
              React.createElement(
                'select',
                {
                  key: 'pos',
                  className: 'dsh-tv-in dsh-tv-inInline',
                  value: roomBookPositionValueOf(one),
                  'aria-label': one.id + ' 放在哪',
                  title: one.id + '：這一本書在這一間房放在哪（空的那一項＝不在這裡指定）',
                  onChange: function (event) {
                    var value = event.target.value
                    patchBook(one.id, { position: value === '' ? null : value })
                  },
                },
                [
                  { value: '', label: fallbackLabelOf(one) },
                ]
                  .concat(
                    WORLDBOOK_POSITIONS.map(function (where) {
                      return { value: where, label: WORLDBOOK_POSITION_INFO[where].label }
                    }),
                  )
                  .map(function (option) {
                    return React.createElement(
                      'option',
                      { key: option.value === '' ? '__none' : option.value, value: option.value },
                      option.label,
                    )
                  }),
              ),
            )
            /**
             * 「▸ 內容」＝**就地展開**：看這一本書的每一條，並調**這一間房**的優先序。
             *
             * 使用者：「還有摺疊內容我都要」——所以它回來了，但**只做這一件事**：
             * 展開／收起。它不會離開這一頁、也不會改到書（改了沒反應的按鈕比
             * 沒有更糟，這個 repo 有一條同樣的規矩）。
             * `▸`／`▾` 是為了讓它看起來像**摺疊**而不是動作。
             *
             * ⚠️ **2.6.71 起展開之後多一件事**：每一條條目有自己的「優先序」
             * （ST 的 `order`），而**這一間房調得動它**（值存 `room.json`，
             * 書的檔案一個字都不會被改）。使用者要的正是這個：
             *
             *   > 我看見世界書裏面有不同的項目設定次序，我說的是那個
             *
             * ⚠️ **條目的內容仍然是唯讀的**（畫出來給你對照，不能改）。
             */
            var opened = state.content !== null && state.content !== undefined && state.content.id === one.id
            head.push(
              React.createElement(
                'button',
                {
                  key: 'peek',
                  type: 'button',
                  className: 'dsh-tv-btn',
                  title: opened
                    ? '收起這一本的條目'
                    : '展開這一本的條目——順便調**這一間房**的優先序（內容唯讀；要改內容請到酒館的「📖 藏書」）',
                  'aria-expanded': opened ? 'true' : 'false',
                  onClick: function () {
                    loadContent(one.id)
                  },
                },
                state.contentBusy === one.id ? '讀取中…' : opened ? '▾ 條目' : '▸ 條目',
              ),
            )
            /**
             * ⚠️ **標籤在最左邊**（見上面那一段的實測數字）——所以這裡不再有東西
             * 排在那顆按鈕後面：**每一列的最後一個都是它**，按鈕才對得齊。
             */
            // 展開的條目掛在那一列下面（`flex-basis:100%` 讓它自己佔一行）。
            if (opened) {
              var entries = Array.isArray(state.content.entries) ? state.content.entries : []
              head.push(
                React.createElement(
                  'div',
                  { className: 'dsh-tv-bookPeek', key: 'peekBody' },
                  React.createElement(
                    'p',
                    { className: 'dsh-tv-note' },
                    '⚠️ 下面是這一本書的條目。**內容唯讀**；「優先序」是**這一間房**的' +
                      '（大的先注入、預算先到先得），**書的檔案一個字都不會被改**。' +
                      '灰字＝跟書自己的值，打回那個數字就還原。',
                  ),
                  entries.length === 0
                    ? React.createElement('p', { className: 'dsh-tv-note' }, '這本書沒有條目。')
                    : entries.map(function (entry, at) {
                        var draftKey = one.id + '/' + entry.key
                        return React.createElement(
                          'div',
                          { key: 'e' + String(at), className: 'dsh-tv-peekEntry' },
                          React.createElement(
                            'div',
                            { className: 'dsh-tv-peekHead' },
                            entry.label,
                            entry.constant ? React.createElement('span', { className: 'dsh-tv-posTag' }, '常駐') : null,
                            entry.disabled ? React.createElement('span', { className: 'dsh-tv-posTag' }, '已關閉') : null,
                          ),
                          /**
                           * 這一條在**這一間房**的優先序。
                           *
                           * ⚠️ **永遠是一個數字**（使用者要的：不要空格子，
                           * 空格子會讓人「輕輕一改就無法復原」）：沒調過就顯示
                           * 書自己的值，而**灰色的**那一種＝那個數字是書的。
                           * 打回書自己的數字 ⇒ 把這一間房的覆寫刪掉（真的還原）。
                           */
                          React.createElement(
                            'div',
                            { className: 'dsh-tv-inlineRow', style: { marginTop: '4px' } },
                            React.createElement(
                              'label',
                              { className: 'dsh-tv-check', style: { flex: 'none' } },
                              '優先序',
                              React.createElement('input', {
                                className:
                                  'dsh-tv-in dsh-tv-priorityIn' + (entry.overridden === true ? '' : ' dsh-tv-prioInherit'),
                                type: 'number',
                                min: ORDER_LIMITS.min,
                                max: ORDER_LIMITS.max,
                                step: '1',
                                'aria-label': one.id + '／' + entry.label + ' 的優先序',
                                title:
                                  entry.label +
                                  '：這一條在這一間房的優先序（越大越先注入；預算是先到先得，' +
                                  '排在後面的可能整條進不去）。' +
                                  (entry.overridden === true
                                    ? '現在是**這一間房指定的**；打回 ' + String(entry.ownOrder) + ' 就還原成書自己的值。'
                                    : '現在顯示的是**書自己的值**（不在這一間房指定）。'),
                                disabled: state.busy,
                                value:
                                  state.draft[draftKey] === undefined ? String(entry.order) : String(state.draft[draftKey]),
                                onChange: function (event) {
                                  state.draft[draftKey] = event.target.value
                                  render()
                                },
                                onBlur: function () {
                                  commitEntryOrder(one.id, entry)
                                },
                                onKeyDown: function (event) {
                                  if (event.key === 'Enter') commitEntryOrder(one.id, entry)
                                },
                              }),
                            ),
                          ),
                          React.createElement('div', { className: 'dsh-tv-peekBodyText' }, entry.content),
                        )
                      }),
                ),
              )
            }
            return React.createElement('div', { key: one.id, className: 'dsh-tv-bookRow' }, head)
          }),
        ),
      )
      kids.push(
        React.createElement(
          'p',
          { className: 'dsh-tv-note', key: 'hint' },
          '⚠️ 這一頁只有三件事：**這一間房用不用它**、**它放在哪**、' +
            '以及（展開「▸ 條目」之後）**每一條條目的優先序**。' +
            '位置的空格＝不在這裡指定（書自己指定的 → 這一間房的預設 → 酒館的預設）。' +
            '優先序那一格**永遠是一個數字**：灰字＝書自己的值，改掉就是這一間房指定的，' +
            '打回原來那個數字就還原——而**書的檔案一個字都不會被改**。' +
            '「▸ 條目」裡面的**內容是唯讀的**——要改內容，到酒館的「📖 藏書」。',
        ),
      )
      if (state.error !== '') {
        kids.push(React.createElement('div', { className: 'dsh-tv-err', key: 'err' }, state.error))
      }
      if (state.notice !== '') {
        kids.push(React.createElement('div', { className: 'dsh-tv-ok', key: 'ok' }, state.notice))
      }
      return React.createElement('div', null, kids)
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
     * 主面板的四個分區（`redesign.md` §3.2）。
     *
     * 一間酒館＝**一張** DSH panel（`main:tavern`），分區住在面板裡面。
     * 這樣 DSH 不需要知道酒館裡有幾個分區，而主面板以內我們完全自由。
     *
     * `key` 只進 class 名與測試；`label` 才是顯示文字。
     */
    var TAVERN_ZONES = [
      { key: 'hall', label: '🏠 大廳' },
      { key: 'rooms', label: '💬 包廂' },
      { key: 'cast', label: '🎭 卡司' },
      { key: 'books', label: '📖 藏書' },
      // 第五區：設定。使用者：「我實際上想模擬的視覺是一個真的酒館大廳，而不是
      // 一堆設定集」——所以設定從大廳搬出來自成一個分區，大廳留給「店的樣子」。
      { key: 'settings', label: '⚙️ 設定' },
    ]

    /**
     * 目前選中的分區。
     *
     * ⚠️ **刻意用模組層級的變數，不是 `useState`。** 兩個理由：
     *   1. 這個面板是常駐的——切去別的 panel 再回來、或切換酒館，
     *      分區不該被悄悄重置回大廳。
     *   2. 離線測試的假 React 把 `useState` 的 setter 做成空的（`() => {}`），
     *      所以任何靠 `useState` 的狀態轉移在那裡都驗不到。模組變數 ＋
     *      `useForceRender()` 讓測試可以真的切過去再重繪。
     *
     * ⚠️ **宣告在最上面**（`factory` 的開頭，`CHAT_TABS` 之前）：
     * `MapWorldbooks`（比較早）就會用到它，而 `var` 的提升只提升宣告、不提升值。
     */

    /**
     * 這間酒館的設定頁（`main` / `tavern`）。
     *
     * 側邊欄點酒館名字 → 這裡。**四個分區在同一個面板裡切換**：
     * 標題列下面一條分區列，底下只畫**選中的那一個**分區。
     * 導航仍然只有側邊欄那一層——分區不是 DSH 的 panel。
     */
    function TavernSettingsPage() {
      // 分區切換要自己重繪（理由見 `currentZone`：刻意不用 useState）。
      var renderPage = useForceRender()
      var tavern = useTavernData()
      var state = tavern.state
      // 側邊欄換了酒館就自己重讀：這個面板是常駐的，不會因為切換 panel 而重新掛載，
      // 沒有這一條就會一直顯示上一間酒館的內容，直到使用者手動按「重新讀取」。
      useActiveVersion(tavern.load)
      // 側邊欄那顆 ＋ 按下來的時候會直接改 `currentZone`（模組層級狀態），而**重畫
      // 側邊欄不會重畫這一頁**——主面板已經停在這裡時，那顆按鈕看起來就像沒反應
      // （使用者回報：「重新點擊 ＋ 不會跳回去」）。
      // 訂閱 refreshChannel 只為了重畫：這一頁的資料沒變，變的是分區。
      useRefreshChannelRerender(renderPage)
      var noTavern = state.taverns.length === 0 || state.activeId === ''

      // 目前酒館要在**建 body 之前**算好：`var` 會提升，先用到就拿到 undefined，
      // 而 undefined 傳進子元件會在讀 `.name` 時炸掉整個 main 面板
      // （真的發生過：`main` 變成 `data-slot-error` 的死格）。
      var activeTavern = null
      for (var t = 0; t < state.taverns.length; t += 1) {
        if (state.taverns[t].active === true) activeTavern = state.taverns[t]
      }

      var body = null
      var zoneBar = null
      if (!state.loaded) {
        body = React.createElement('div', { className: 'dsh-tv-empty' }, '載入中…')
      } else if (noTavern) {
        body = React.createElement(NoTavernNotice)
      } else {
        var tavernId = activeTavern === null ? '' : activeTavern.id

        if (currentZone === 'rooms') {
          // 💬 包廂＝跟誰、在哪裡。
          body = React.createElement(MapChatFiles, { tavernId: tavernId })
        } else if (currentZone === 'cast') {
          // 🎭 卡司＝這裡有誰。
          body = React.createElement(MapCharacters, {
            characters: state.characters,
            tavernId: tavernId,
            reload: tavern.load,
          })
        } else if (currentZone === 'books') {
          // 📖 藏書＝這個世界的設定。⚠️ 傳 `settings`／`commit` 進去：那一頁有一格
          // 「這裡的世界書預設放在哪」，而它寫的是 `tavern.json`（酒館層的預設）。
          body = React.createElement(MapWorldbooks, { settings: state.settings, commit: tavern.commit })
        } else if (currentZone === 'settings') {
          // ⚙️ 設定＝酒館本身的東西：名字、圖示、你的名字、備註、店面圖、移除。
          // 使用者要求「設定放進去其他地方，新開一張分頁」，所以它不在大廳裡。
          body = React.createElement(
            'div',
            null,
            // 完整的概況（含資料夾位置、結構、art 分類、說明）留在這裡：
            // 大廳只要四個數字，這些是「查得到就好」的參考資料。
            React.createElement(MapOverview, { summary: state.summary, characters: state.characters }),
            // 改名、圖示、**你的名字（{{user}}）**、備註、以及（收合的）移除酒館。
            // 側邊欄的 ⋯ 也直接進這一頁，不彈選單。
            // `key` 很重要：這個元件把名稱快取在 useRef 裡，切換酒館時若沒有重新掛載，
            // 欄位會繼續顯示上一間酒館的名字（實測：切到「預設酒館」後仍顯示 shop）。
            React.createElement(MapTavernActions, {
              key: 'actions-' + String(tavernId),
              tavern: activeTavern,
              settings: state.settings,
              // 回覆格式（`render.json`）——`MapTavernActions` 那一區有它的兩格。
              render: state.render,
              commit: tavern.commit,
              reload: function () {
                tavern.load()
              },
            }),
            // 店面圖不屬於任何一張卡（是酒館自己的樣子）。它在大廳是主角，
            // 在這裡是「換一張」的地方——所以兩邊都給，語意不同。
            React.createElement(AssetManager, { key: 'tavern-front', kind: 'tavern', owner: '' }),
            legacyNotice(
              activeTavern !== null && activeTavern.exists === true && activeTavern.scaffolded === false,
            ),
          )
        } else {
          // 🏠 大廳＝**這間店現在長什麼樣、有誰在、有哪些房間**。
          //
          // 使用者：「我實際上想模擬的視覺是一個真的酒館大廳，而不是一堆設定集」。
          // 所以這一頁只留視覺與入口：店面圖（店的樣子）→ 有誰 → 房間。
          // 任何「設定」都不在這裡（搬去 ⚙️ 設定分區了）。
          var counts = summaryCounts(state.summary)
          var cards = Array.isArray(state.characters) ? state.characters : []
          body = React.createElement(
            'div',
            null,
            // 只要那四個數字（使用者：「只留這些」）。
            // 店面圖的管理介面（「＋ 加入插圖／檔案位置」那種管理員的東西）在 ⚙️ 設定
            // ——它不是「店的樣子」，是設定。各種路徑與結構說明也一起搬過去了。
            React.createElement(MapOverview, {
              summary: state.summary,
              characters: state.characters,
              compact: true,
            }),
            React.createElement(
              'p',
              { className: 'dsh-tv-note' },
              '店面圖、資料夾結構與其他設定在「⚙️ 設定」分區。',
            ),
            // 有誰：直接畫出來，不是只寫「3 張卡」。
            React.createElement(
              'div',
              { className: 'dsh-tv-field' },
              React.createElement('div', { className: 'dsh-tv-fieldLabel' }, '這裡有誰'),
              cards.length === 0
                ? React.createElement(
                    'p',
                    { className: 'dsh-tv-note' },
                    '還沒有角色。到「🎭 卡司」新增一張，或把 SillyTavern 的 PNG／JSON 卡丟進去。',
                  )
                : React.createElement(
                    'div',
                    { className: 'dsh-tv-cardPick' },
                    cards.slice(0, 12).map(function (item) {
                      var primary =
                        item.assets !== undefined && item.assets !== null ? item.assets.primary : null
                      var art = findAssetUrl(item.assets, primary)
                      return React.createElement(
                        'button',
                        {
                          key: item.id,
                          type: 'button',
                          className: 'dsh-tv-poster',
                          title: '到「🎭 卡司」看 ' + item.id,
                          onClick: function () {
                            currentZone = 'cast'
                            renderPage()
                          },
                        },
                        art === null
                          ? React.createElement('span', { className: 'dsh-tv-posterEmpty' }, '🎭')
                          : React.createElement('img', {
                              className: 'dsh-tv-posterArt',
                              src: art,
                              alt: '',
                              loading: 'lazy',
                            }),
                        React.createElement('span', { className: 'dsh-tv-posterName' }, item.id),
                      )
                    }),
                  ),
            ),
            // 房間：**真的對話清單**，點一列直接進去。
            // 使用者：「最下低那層不需要，可以換成真的聊天對話框，讓我直接選進去」
            // ——那三個入口按鈕（包廂／卡司／藏書）拿掉了，它只是叫人多跳一次。
            React.createElement(HallRooms, { characters: state.characters }),
          )
        }

        // 分區列只在「真的有酒館」時出現——沒有酒館時它四個都按不動，只是噪音。
        zoneBar = React.createElement(
          'nav',
          { className: 'dsh-tv-zones', role: 'tablist', 'aria-label': '酒館分區' },
          TAVERN_ZONES.map(function (zone) {
            var on = currentZone === zone.key
            return React.createElement(
              'button',
              {
                key: zone.key,
                type: 'button',
                role: 'tab',
                'aria-selected': on ? 'true' : 'false',
                className: on ? 'dsh-tv-zone dsh-tv-zoneOn' : 'dsh-tv-zone',
                onClick: function () {
                  if (currentZone === zone.key) return
                  currentZone = zone.key
                  renderPage()
                },
              },
              zone.label,
            )
          }),
        )
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
        zoneBar,
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
      // 附件鈕要按的那個隱藏 `<input type="file">`。
      var attachInput = React.useRef(null)
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
          // 「⚙️ 房間」分頁那幾個還沒送出的輸入框，以及改名進行中。
          roomName: undefined,
          roomPrompt: undefined,
          roomTools: undefined,
          /** 這一間房的藏書位置（`null` ＝ 聽酒館的）。 */
          roomBookPosition: undefined,
          // 工具權限那一顆 chip：選單開著嗎、以及「正在寫」。
          // ⚠️ 與 `roomTools` **共用同一格**——composer 那顆 chip 與 ⚙️ 房間 那一格
          // 是同一個值（`room.json` 的 `allowTools`），分成兩格就會出現
          // 「這裡改、那裡沒跟著變」。
          permMenu: false,
          roomToolsBusy: false,
          // 右邊那條輪次刻度（`null`＝還沒量／不到兩輪不用畫）。
          // `{ signature, marks: [{index, pos}], active }`——`signature` 是為了讓
          // `syncTurnRail()` 收斂（不重複重繪）。
          turnRail: null,
          renaming: false,
          // 這一間房的用量（宿主半 `room.usage` 算的）。`null`＝還沒有／讀不到。
          usage: null,
          usageBusy: false,
          // 哪一顆按鈕的面板開著：'' | 'ctx' | 'stats' | 'tokens'——**每一顆開自己那一份**。
          usagePanel: '',
          // 哪一則訊息的「本輪用量」面板開著（-1＝沒有）。訊息上的用量細節住這裡。
          msgPanel: -1,
          // 模型 chip 與它的選單（目錄讀一次就快取）。
          modelMenu: false,
          models: null,
          modelBusy: false,
          // 選單現在住在 chip 的 `.dsh-tv-modelRoot` 裡（`right:0` 就貼齊），不需要量座標。
          // 選單開到第幾層：`'root'`（模型／推理等級兩列）→ `'model'` / `'effort'`。
          modelPane: 'root',
          // 目錄自己的 default（最低優先的後備；`currentSelection()` 的最後一位）。
          modelDefault: null,
          // 「我知道這一間房現在用什麼」——使用者挑的、或從 session 的 `modelSelection`
          // 讀到的。**這一格最準**，`currentSelection()` 第一個就看它。
          modelCurrent: null,
          modelEffort: undefined,
          // 「本輪用量／本輪用時」：只有跑過一輪之後才有值。
          // 用量來自串流裡的 `usage` chunk（供應方回報），用時是從送出到收到完整回覆。
          turnUsage: null,
          turnMs: null,
          turnStartedAt: null,
          // 還沒送出的附件（圖片／檔案）。送出去之後就清空——它們會跟著那一則訊息走。
          attachments: [],
          attachBusy: false,
        }
      }
      var chat = ref.current
      /**
       * ⚠️ **把這一間酒館的解析設定交給畫面。**
       *
       * `activeParseConfig` 是模組層級的（理由見它的註解），而 `renderMessage`
       * 住在很深的地方——所以這裡是唯一一個「設定 → 畫面」的接點。
       * 少了這一行，`render.json` 的 `marked` 模式**完全沒有作用**：
       * 模型乖乖吐 `<台詞>`，而我們把它當普通文字畫出來（角括號全露在氣泡裡）。
       *
       * `plain`（或還沒載入）時它是「只有排版慣例」——也就是 2.6.65 以前的行為。
       */
      activeParseConfig = parseConfigFromRender(state.render, '')
      chat.parseConfig = activeParseConfig
      // 換一份對話 → 這個元件的狀態全部重來。`useRef` 不會因為 props 改變而重置，
      // 所以要在這裡自己比對（同 `MapTavernActions` 的 key 問題）。
      //
      // ⚠️ 身分用**房間 id**，不是名字。名字只是顯示名稱：在房間裡改個名就把
      // 訊息、草稿、session 全部清掉是錯的（改名前後還是同一間房）。
      var currentKey =
        selected === null
          ? ''
          : selected.character + '/' + (selected.room === undefined ? selected.name : selected.room)
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
        // 半途打了一半的房間設定屬於上一間房，不能跟著過來。
        chat.roomName = undefined
        chat.roomPrompt = undefined
        chat.roomTools = undefined
        chat.renaming = false
        chat.usage = null
        chat.usageBusy = false
        chat.usagePanel = ''
        chat.msgPanel = -1
        chat.modelMenu = false
        chat.models = null
        chat.modelBusy = false
        // ⚠️ 目錄是**全 app 共用**的，換房間不必重讀；但「這一間房現在用什麼」一定要清掉
        // ——否則新房間會沿用上一間的模型名（而那是**另一條 session** 的選擇）。
        chat.modelDefault = null
        chat.modelEffort = undefined
        chat.modelCurrent = null
        chat.modelPane = 'root'
        chat.turnUsage = null
        chat.turnMs = null
        chat.turnStartedAt = null
        // 換房間時把還沒送出的附件收掉（連同它們的 object URL 一起釋放）。
        dropAttachments()
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
        // 輪次刻度要在**排版之後**才量得到位置（`offsetTop`），所以放在這裡。
        syncTurnRail()
      })

      /**
       * 量一次輪次刻度：每一輪在捲動區裡的**相對位置**，以及**現在在哪一輪**。
       *
       * 座標系有兩個，不要混：
       *   - `offsetTop` 是**內容座標**（訊息在整份紀錄裡的位置）
       *   - 刻度畫在**可見高度**上（`clientHeight`）
       * 所以位置要換算：`pos = offsetTop / scrollHeight * clientHeight`。
       *
       * ⚠️ 這一支會被 `useEffect`（每次重繪之後）呼叫，而它在算完之後可能要
       * `render()`——**所以它必須收斂**：算出來的簽章與上一次相同就直接返回，
       * 不然就是無限重繪。以前這個 repo 在別的地方踩過同一型的迴圈。
       */
      function syncTurnRail() {
        var log = logRef.current
        if (log === null || log === undefined) return
        var nodes = log.querySelectorAll('[data-turn]')
        var total = log.scrollHeight
        var view = log.clientHeight
        // 少於兩輪就沒有「跳來跳去」可言——不畫（也讓單輪對話乾淨）。
        if (nodes.length < 2 || total <= view) {
          if (chat.turnRail !== null) {
            chat.turnRail = null
            render()
          }
          return
        }
        var scrollTop = log.scrollTop
        /**
         * 哪一輪是「當前」：最後一個已經捲過視窗頂端的錨點。
         *
         * ⚠️ **捲到底的時候要算最後一輪**：能捲的距離通常小於最後幾輪的開頭位置
         * （實測 6 輪、可捲 912px、第 5 輪在 957、第 6 輪在 1196），所以不加這一條
         * 的話「捲到最底之下還停在第 4 輪」——而畫面上明明就是最新的那一輪。
         */
        var active = -1
        for (var i = 0; i < nodes.length; i += 1) {
          // 容差用 `TURN_JUMP_GAP_PX`（跟跳過去的留白同一個數字）——不然跳過去之後
          // 判定會落在上一輪（見那個常數的註解）。
          if (nodes[i].offsetTop <= scrollTop + TURN_JUMP_GAP_PX) active = i
        }
        if (active < 0) active = 0
        if (total - view - scrollTop < 4) active = nodes.length - 1
        // 位置與框高交給純函式（規則在那裡，測也在那裡）。
        var layout = turnRailLayout(nodes.length, view, active)
        if (layout === null) {
          if (chat.turnRail !== null) {
            chat.turnRail = null
            render()
          }
          return
        }
        var signature =
          String(active) + '|' + String(layout.height) + '|' + String(layout.offset) + '|' + String(nodes.length)
        if (chat.turnRail !== null && chat.turnRail.signature === signature) return
        chat.turnRail = {
          signature: signature,
          active: active,
          height: layout.height,
          // 刻度：`{index}` 是**訊息索引**（點了要跳過去），`top` 是條帶座標扣掉位移。
          marks: layout.positions.map(function (pos, ordinal) {
            return {
              index: Number(nodes[ordinal].getAttribute('data-turn')),
              top: pos - layout.offset,
              ordinal: ordinal,
            }
          }),
        }
        render()
      }

      /** 跳到第 `index` 則訊息（刻度被點的時候）。 */
      function scrollToTurn(index) {
        var log = logRef.current
        if (log === null || log === undefined) return
        var node = log.querySelector('[data-turn="' + String(index) + '"]')
        if (node === null || node === undefined) return
        log.scrollTop = Math.max(0, node.offsetTop - TURN_JUMP_GAP_PX)
      }

      /** 右邊那條刻度。畫不出來時回 `null`（＝什麼都不加）。 */
      function turnRail() {
        var rail = chat.turnRail
        if (rail === null || rail === undefined) return null
        return React.createElement(
          'div',
          // ⚠️ **不要**給這條加 `aria-hidden`：裡面的刻度是有 `aria-label` 的按鈕
          // （「跳到第 N 輪」），把它們藏起來等於把功能從輔助技術裡拿掉。
          // 它們不在 Tab 順序裡（`tabIndex: -1`），所以不會吵到鍵盤使用者。
          { className: 'dsh-tv-turnRail', role: 'group', 'aria-label': '跳到某一輪', style: { height: String(rail.height) + 'px' } },
          rail.marks.map(function (one) {
            return React.createElement('button', {
              key: one.index,
              type: 'button',
              className:
                one.ordinal === rail.active ? 'dsh-tv-turnMark dsh-tv-turnMarkOn' : 'dsh-tv-turnMark',
              style: { top: String(one.top) + 'px' },
              tabIndex: -1,
              'aria-label': '跳到第 ' + String(one.ordinal + 1) + ' 輪',
              onClick: function () {
                scrollToTurn(one.index)
              },
            })
          }),
        )
      }

      /** 記住「使用者是不是貼著底」，並在他捲回底部時恢復自動。 */
      function onLogScroll(event) {
        var node = event !== null && event !== undefined ? event.currentTarget : null
        if (node === null || node === undefined) return
        var distance = node.scrollHeight - node.scrollTop - node.clientHeight
        pinnedRef.current.pinned = distance < 40
        syncTurnRail()
      }

      /**
       * 這一間房接的是哪一個 session（酒館自己的綁定表，`session.list`）。
       *
       * ⚠️ **兩種都要比對**：新綁定有 `room`（房間 id）；**舊綁定沒有 `room`，而它的
       * `chat` 放的是顯示名稱**。只用 id 比對的話，那些房間永遠找不到 session——
       * 實際回報就是「那一列一直是空的」。
       */
      function boundSessionId() {
        return rpc('session.list', { id: state.activeId }).then(function (bindings) {
          var list = Array.isArray(bindings) ? bindings : []
          for (var i = 0; i < list.length; i += 1) {
            var one = list[i]
            if (one === null || typeof one !== 'object') continue
            if (one.character !== selected.character) continue
            if (one.room === selected.room) return one.sessionId
            if (one.chat === selected.name || one.chat === selected.room) return one.sessionId
          }
          return null
        })
      }

      /**
       * 讀那個 session 的用量：跟著串流拿**第一個 snapshot** 就收工。
       *
       * 為什麼是這條路（而不是叫宿主半算）：
       *   1. `tokenUsage`／`contextPressure`／`contextBreakdown` 本來就是**宿主算好、
       *      給瀏覽器讀的**（DSH 自己的計量環讀同一份），跟在串流的開場快照裡一起送來；
       *      我們跟著讀，就不會出現「同一份日誌的第二個答案」。
       *   2. 它**不需要那個 session 活在宿主的記憶體裡**——開場快照來自持久日誌，
       *      重啟之後照樣讀得到。（原本那條路走 `ctx.sessions.get()`，重啟後是空的，
       *      所以畫面一直是空的。）
       *   3. 純客戶端＝不必再重啟 `dsh web`。
       *
       * 拿完一定收掉串流（abort ＋ `return()`），不要留一條連線在背景。
       */
      function readUsage(sessionId) {
        var service = sessionsService()
        if (service === null || typeof service.follow !== 'function') return Promise.resolve(null)
        var controller = typeof AbortController === 'function' ? new AbortController() : null
        var stream = null
        try {
          // ⚠️ 這幾個欄位是**試出來的**，兩個都不能亂改：
          //   `assistantStream` 不可以送 `false`——宿主會直接用
          //     `session/follow rejected "request"` 把請求打回，而我們是靜靜吞掉的，
          //     畫面上只會看到「那一列不見了」（實際踩過）。
          //   **不送**它就對了：不送＝純日誌串流，開場快照（帶著 projections）會來；
          //     送 `true` 就只等助理逐字稿，開場快照不會來（也踩過）。
          stream = service.follow(
            { address: { kind: 'session', sessionId: sessionId }, assistantStream: true },
            controller === null ? undefined : controller.signal,
          )
        } catch (error) {
          return Promise.resolve(null)
        }
        if (
          stream === null ||
          typeof stream !== 'object' ||
          typeof stream[Symbol.asyncIterator] !== 'function'
        ) {
          return Promise.resolve(null)
        }
        var iterator = stream[Symbol.asyncIterator]()
        var close = function () {
          if (controller !== null) controller.abort()
          if (typeof iterator.return === 'function') {
            try {
              iterator.return()
            } catch (error) {
              // 收不掉就算了——不讓收尾的失敗蓋掉真正的結果。
            }
          }
        }
        /**
         * 往後讀 frame，直到找到帶著 `projections` 的那一個（開場快照）。
         *
         * ⚠️ `projections` 在 **frame 自己身上**（`type: 'snapshot'` 那一則），不是包在
         * `page` 底下——這是實際在瀏覽器裡把 frame 印出來才看到的。先前照型別推成
         * `frame.page.projections`，於是**永遠讀不到，而且完全無聲**（那一列就是不出現）。
         */
        var look = function (left) {
          if (left <= 0) return Promise.resolve(null)
          return iterator.next().then(function (next) {
            if (next === null || next === undefined || next.done === true) return null
            var frame = next.value
            var baseline = null
            if (frame !== null && typeof frame === 'object') {
              if (frame.projections !== undefined) baseline = frame.projections
              else if (frame.page !== undefined) baseline = frame.page.projections
            }
            var values = baseline === null || baseline === undefined ? null : baseline.values
            if (values !== null && values !== undefined) {
              // 順手把「這條路由是誰」也帶走（同一個 frame 的 `records` 裡就有）——
              // 面板的「提供方 / 模型」那一列靠它。
              return { values: values, route: routeOfRecords(frame.records) }
            }
            return look(left - 1)
          })
        }
        return Promise.race([
          look(8),
          // 串流是「有東西才會來」的：真的沒有開場快照時，不要讓這一頁一直在等。
          new Promise(function (resolve) {
            if (typeof setTimeout !== 'function') return
            setTimeout(function () {
              resolve(null)
            }, 2500)
          }),
        ])
          .then(function (found) {
            close()
            if (found === null || found === undefined) return null
            var value = usageOfProjections(found.values)
            // 量不到數字但知道是哪條路由時，還是把那條路由留著（面板少幾列而已）。
            // 兩個都要擋：undefined 會穿過 !== null 的守衛，之後在它身上讀 .model 就炸。
            if (value !== null && found.route !== null && found.route !== undefined) {
              value.route = found.route
            }
            return value
          })
          .catch(function (error) {
            close()
            return null
          })
      }

      /**
       * 「這一間房的 session 現在選了哪個模型」——**這裡才是權威來源**。
       *
       * DSH 自己的 chip 就是讀這一個（`dsh-client-ui-model-selection` 的
       * `sessions.binding(sessionId).session.projections.faceOf("modelSelection")`
       * → `getSnapshot()` → `next ?? lastUsed`）。酒館跟著讀同一份，所以：
       *   - 重新整理之後 chip 還是對的（不需要靠訊息裡的 `extra.route` 猜）
       *   - 在別的地方（DSH 原生介面）換過模型也看得到
       *
       * ⚠️ 這一整段**必須包在 try/catch 裡**：投影的形狀是 DSH 內部的東西，版本一換
       * 就可能不是這個樣子。讀不到就回 `null`，呼叫端自動退回「訊息裡的路由」那條路
       * ——**不要讓一個選配的資訊來源把整個對話頁弄倒**。
       */
      function readSessionSelection(sessionId) {
        try {
          var sessions = ctxRef.get('sessions')
          if (sessions === null || sessions === undefined) return null
          if (typeof sessions.binding !== 'function') return null
          var binding = sessions.binding(sessionId)
          if (binding === null || binding === undefined) return null
          var session = binding.session
          if (session === null || session === undefined) return null
          var projections = session.projections
          if (projections === null || projections === undefined) return null
          if (typeof projections.faceOf !== 'function') return null
          var face = projections.faceOf('modelSelection')
          if (face === null || face === undefined) return null
          // 它是 observable（DSH 用 `getSnapshot()`）；保險起見 `.get()` 與純值都試。
          var value =
            typeof face.getSnapshot === 'function'
              ? face.getSnapshot()
              : typeof face.get === 'function'
                ? face.get()
                : face
          if (value === null || typeof value !== 'object') return null
          var picked = value.next !== null && value.next !== undefined ? value.next : value.lastUsed
          if (picked === null || picked === undefined || typeof picked !== 'object') return null
          if (typeof picked.provider !== 'string' || typeof picked.model !== 'string') return null
          return {
            provider: picked.provider,
            model: picked.model,
            effort:
              typeof picked.reasoningEffort === 'string' ? picked.reasoningEffort : '',
          }
        } catch (error) {
          return null
        }
      }

      /**
       * 讀這一間房的用量（輸入框上面那一列）。
       *
       * 讀不到就靜靜留空：還沒開始聊（沒有綁定）、那個 session 已經被刪掉、或者這台 DSH
       * 沒有對話服務——都不是錯誤。那一列是裝飾，不該讓對話頁冒出紅字。
       */
      function loadUsage() {
        if (selected === null) return Promise.resolve()
        var room = selected.room
        chat.usageBusy = true
        return boundSessionId()
          .then(function (sessionId) {
            /**
             * ⚠️ **還沒有 session 的房也要讀目錄**（真頁面上抓到的）：那一頁的 chip
             * 停在「正在載入模型…」，但其實**沒有任何東西在載**——`loadModels()` 原本
             * 只掛在「有 session」那條路上，而全新的房（新建酒館附的預設房就是）
             * 一進去就是那個狀態。
             *
             * 讀了之後 `currentSelection()` 會落到目錄的 default，chip 就有名字與
             * 推理等級——那也正是 DSH 對「未設定的 session」的做法
             * （`projected.next ?? catalog.default`）。
             */
            if (sessionId === null) {
              if (chat.models === null || chat.models === undefined) loadModels()
              return null
            }
            /**
             * 順手把「這一間房的 session 現在選了什麼」同步過來（同步讀，不是另一個
             * 非同步流程——開場那一條 effect 已經有兩個非同步讀取，不要再塞第三個）。
             *
             * ⚠️ 這裡**不覆蓋**使用者剛剛挑的：`pickModel` 成功之後寫的值與 session
             * 的讀值一致；不一致時（例如他挑完還沒送出）以 session 為準才是對的，
             * 而 `pickModel` 也已經把同一個值寫進 session 了。
             */
            var projected = readSessionSelection(sessionId)
            if (projected !== null) chat.modelCurrent = projected
            /**
             * 順手把目錄讀起來（**只讀一次**，之後快取）。
             *
             * 為什麼要：chip 上的「顯示名稱」與「思考強度」都**只有目錄知道**
             * （`effortLabel = current.reasoningEffort ?? reasoning.defaultEffort`，
             * 而等級的 name 住在目錄裡）。不讀的話重新整理之後 chip 只能寫 id、
             * 也看不到思考強度——那正是使用者回報「這些還未做好」的其中一半。
             *
             * ⚠️ 2.6.40 曾經在這裡踩到「進房就整頁空白」：那時 `loadModels()` 會把目錄的
             * default 寫進 `modelCurrent`，接著 chip 的 title 從 **null 的 route** 讀欄位
             * → render 直接丟錯。**兩個原因現在都拆掉了**（default 有自己的格子；
             * title 只從 `selection` 取值），所以這裡可以安全地讀。仍在真頁面上量過。
             */
            if (chat.models === null || chat.models === undefined) loadModels()
            return readUsage(sessionId)
          })
          .then(function (value) {
            // 讀的期間使用者可能已經換房間了——那就不要套用（他看的是另一間）。
            if (selected === null || selected.room !== room) return
            chat.usageBusy = false
            chat.usage = value
            render()
          })
          .catch(function () {
            if (selected === null || selected.room !== room) return
            chat.usageBusy = false
            chat.usage = null
            render()
          })
      }

      /**
       * 輸入框上面那一列：上下文用量／緩衝／快取命中／token 帳。
       *
       * 使用者要的是「上下文大小、使用、token、緩衝、命中」——所以每一格都寫出**單位與
       * 來源**，不畫只有自己看得懂的圖示。數字全部來自宿主半（見 `loadUsage`）。
       *
       * 只畫拿得到的那幾格：宿主可能只回得到一部分（例如供應方還沒回報用量），
       * 那就少一格，而不是畫一個 0 騙人。
       */
      /**
       * 輸入框上面那一列用量。
       *
       * ⚠️ **長相是照抄 DSH 自己那排統計**（使用者：「你可以參考一下 dsh 自己的 ui 是怎樣
       * 設計的」）。它那一排的規矩是：
       *   - 小字、灰階（標籤更淡、數字稍亮），**沒有框、沒有底色**——不是一排膠囊按鈕；
       *   - 一「組」裡的數字用 `·` 連起來（`125 輪 1396 步 · 253 tok/s`），組與組之間
       *     只留空白；
       *   - 一眼看不到的細節**收進點開的面板**（DSH 那顆計量環就是這樣）。
       * 所以這裡也是兩層：一行摘要 ＋ 點一下展開的細節。
       */
      /**
       * 輸入框下面那一列：三顆 pill（DSH 自己那排統計的長相）。
       *
       * 三顆對應它的兩顆再加一顆上下文：
       *   [環]     上下文 1.1K / 1.00M（27%） · 緩衝 93.8K
       *   [碼錶]   126 輪 1434 步 · 254 tok/s
       *   [資料庫] 1.2K tok · 快取命中 78%
       * 點任何一顆展開細節——DSH 那顆計量環點開也是一個面板（12px 字、一條分段條）。
       */
      /**
       * 上下文環——輸入框那一列最右邊、**緊貼送出鍵前面**的圓形按鈕。
       *
       * ⚠️ 這是 DSH 的分法（`dsh-client-ui-conversation` 的 `.JObwrW_trigger`：28×28、
       * `border-radius:999px`、`display:grid;place-items:center`）：**環在 composer 那一列
       * 裡，統計 pill 在卡片外面**——兩件事分開。點它跟點 pill 一樣開同一個面板。
       */
      function usageRing() {
        var u = chat.usage
        if (u === null || u === undefined) return null
        var used = typeof u.baselineTokens === 'number' ? u.baselineTokens : null
        var win = typeof u.contextWindow === 'number' ? u.contextWindow : null
        var share = used !== null && win !== null && win > 0 ? used / win : 0
        var label =
          used === null
            ? '上下文用量'
            : '上下文已用 ' +
              String(Math.round(share * 100)) +
              '%（' +
              (win === null ? fmtTokens(used) : fmtTokens(used) + ' / ' + fmtTokens(win)) +
              '）'
        return React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-tv-usageRing',
            'aria-label': label,
            title: label + '——點一下看細節',
            'aria-expanded': chat.usagePanel === 'ctx' ? 'true' : 'false',
            onClick: function () {
              // 每一顆按鈕開自己那一份：點自己＝收起來、點別顆＝換過去。
              chat.usagePanel = chat.usagePanel === 'ctx' ? '' : 'ctx'
              // 一次只開一個（DSH 也是這樣）：開這個就把訊息上的收掉。
              chat.msgPanel = -1
              render()
            },
          },
          React.createElement(ContextRing, { share: share }),
        )
      }

      /**
       * 模型 chip：輸入框那一列、**環的左邊**（DSH 的順序是 model → 環 → 送出）。
       *
       * 外觀照 `_7KE1Ra_*`（`dsh-client-ui-model-selection`）：28px 高、`border-radius:24px`、
       * `padding:0 4px 0 8px`、字級 13／500、`gap:4px`，右邊一個會轉 180 度的 chevron。
       *
       * 「目前選的是什麼」＝ `currentSelection()`（session 投影 → 用量快照 → 目錄預設）。
       */
      /**
       * chevron：DSH 共用的那一顆（`IconChevronDownOutline14`），拿不到才自己畫。
       *
       * `cell` 模式是第一層選單用的：同一個路徑**轉 -90 度**就是「往右」的箭頭
       * （DSH 在那裡用的是 `IconChevronRightOutline14`，形狀就是這一顆轉過來）。
       */
      function ModelChevron(props) {
        var cls =
          props !== null && props !== undefined && props.cell === true
            ? 'dsh-tv-modelCellChevron'
            : props !== null && props !== undefined && props.open === true
              ? 'dsh-tv-modelChevron dsh-tv-modelChevronOpen'
              : 'dsh-tv-modelChevron'
        if (PRIMITIVES !== null && PRIMITIVES.IconChevronDownOutline14 !== undefined) {
          return React.createElement(PRIMITIVES.IconChevronDownOutline14, { className: cls })
        }
        return React.createElement(
          'svg',
          {
            width: 14,
            height: 14,
            viewBox: '0 0 14 14',
            fill: 'none',
            'aria-hidden': 'true',
            className: cls,
          },
          React.createElement('path', {
            d: 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732C6.59876 8.24849C6.74023 8.3623C6.87291 8.46904C6.92272 8.47813C6.9375 8.48047C6.97895 8.48703C7.02105 8.48703C7.0625 8.48047C7.07728 8.47813C7.12709 8.46904C7.25977 8.3623C7.40124 8.24849C7.57405 8.07732C7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z',
            fill: 'currentColor',
          }),
        )
      }
      /**
       * 「這一間房現在用什麼」——三個來源排優先序。
       *
       *   1. `chat.modelCurrent`：使用者挑的、或從 **session 的 `modelSelection`** 讀到的
       *      （最準；重新整理之後也對）。
       *   2. `chat.usage.route`：用量列從開場快照讀到的 `request/context`。
       *   3. `chat.modelDefault`：目錄自己的 default（DSH 對未設定的 session 就是用它）。
       */
      function currentSelection() {
        if (chat.modelCurrent !== null && chat.modelCurrent !== undefined) return chat.modelCurrent
        var route = chat.usage !== null && chat.usage !== undefined ? chat.usage.route : null
        if (route !== null && route !== undefined && typeof route.model === 'string') {
          return {
            provider: typeof route.provider === 'string' ? route.provider : '',
            model: route.model,
            effort: typeof route.effort === 'string' ? route.effort : '',
          }
        }
        if (chat.modelDefault !== null && chat.modelDefault !== undefined) return chat.modelDefault
        return null
      }

      /** 模型圖示：DSH 用的是 `IconDataOutline16`（共用的那一顆），拿不到才退回手刻的。 */
      function ModelIcon() {
        if (PRIMITIVES !== null && PRIMITIVES.IconDataOutline16 !== undefined) {
          return React.createElement(PRIMITIVES.IconDataOutline16, {
            className: 'dsh-tv-modelIcon',
            size: 16,
          })
        }
        return React.createElement(
          'span',
          { className: 'dsh-tv-modelIcon' },
          React.createElement(IconDatabase),
        )
      }

      function modelChip() {
        var selection = currentSelection()
        // ⚠️ **絕對不可以從 `route` 讀欄位**：`selection` 有值但 `route` 是 null 是常態
        // （全新的房、還沒讀到用量），而先前就是 `String(route.provider)` 直接丟
        // `Cannot read properties of null` → **整個 main 面板消失**（實測重現，第三次）。
        var state = chat.models
        var loading =
          (state === null || state === undefined || state.status === 'loading') && selection === null
        var model = findCatalogModel(state, selection)
        var effortLabel = selection === null ? '' : effortLabelOf(model, selection)
        var text = chipTextOf({
          loading: loading,
          selection: selection,
          known: model !== null,
          modelLabel: modelLabelOf(state, selection),
          effortLabel: effortLabel,
        })
        var open = chat.modelMenu === true
        return React.createElement(
          // ⚠️ **root 包住 chip，選單也住在 root 裡**（DSH 的 `._7KE1Ra_root` 就是這個角色）。
          // 選單因此可以用 `right:0` **精準貼齊 chip**——不必 portal、不必量座標，
          // 也就不會再出現「座標算成負的 → 面板被丟到畫面外」那一類事故。
          'div',
          { className: 'dsh-tv-modelRoot' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-tv-modelChip',
              'aria-label': text.aria,
              'aria-haspopup': 'menu',
              'aria-expanded': open ? 'true' : 'false',
              title: text.title,
              onClick: function () {
                chat.modelMenu = !open
                // 一次只開一個（跟其他面板同一條規矩）。
                chat.usagePanel = ''
                chat.msgPanel = -1
                // 每次打開都回到第一層（DSH 的 pane 也是這樣：關掉再開＝從 root 開始）。
                chat.modelPane = 'root'
                if (chat.modelMenu === true) loadModels()
                render()
              },
            },
            React.createElement(ModelIcon),
            React.createElement('span', { className: 'dsh-tv-modelLabel' }, text.label),
            // 等級那一格：**沒有就不出現**（不是寫「無」）。
            effortLabel === ''
              ? null
              : React.createElement('span', { className: 'dsh-tv-modelEffortTag' }, effortLabel),
            React.createElement(ModelChevron, { open: open }),
          ),
          modelMenu(),
        )
      }

      /**
       * 工具權限那一顆 chip（composer 上，📎 右邊）。
       *
       * 使用者貼了 DSH composer 的 `.uV2eYG_tools`（`+指令`／`📎`／**訪問模式**）
       * 說「這個區域還未做完」。**做的是酒館自己的工具權限，不是 DSH 的訪問模式**
       * ——兩者是不同的軸（見 CSS 那一段的說明），照抄會變成兩套很像的控制。
       *
       * 三條規矩：
       *   1. **改的是這一間房**（`room.json` 的 `allowTools`），跟 ⚙️ 房間 那一格
       *      是同一個值——只是搬到手邊。`inherit`＝聽酒館的（房間的預設）。
       *   2. **選了就馬上送**（`room.write`），不必再按儲存：那是安全開關，
       *      多一個「還沒按儲存」的中間狀態就多一次「我以為已經關掉了」。
       *   3. 文案照 `plan.md` 的決定：講「**它拿到什麼**」，不是工具名稱。
       *
       * ⚠️ 值一律從 `selected`（`room.list` 回來的投影）讀，不在這裡自己算
       * 「聽酒館的」到底等於哪一級——那是 agent 面的事（`lib/samplers.js` 的
       * `resolveSamplers` 同一條精神：規則只有一個來源）。所以 chip 只顯示
       * **房間自己的設定**，酒館那一層用 ⚙️ 設定 管。
       */
      function permissionChip() {
        var own =
          chat.roomTools === undefined ? selected.allowTools || 'inherit' : chat.roomTools
        var short = PERMISSION_SHORT[own] === undefined ? PERMISSION_SHORT.inherit : PERMISSION_SHORT[own]
        var open = chat.permMenu === true
        var rows = []
        for (var i = 0; i < PERMISSION_CHOICES.length; i += 1) {
          var choice = PERMISSION_CHOICES[i]
          var current = choice.value === own
          rows.push(
            React.createElement(
              'button',
              {
                type: 'button',
                key: choice.value,
                role: 'menuitemradio',
                'aria-checked': current ? 'true' : 'false',
                className: 'dsh-tv-permItem',
                disabled: chat.roomToolsBusy === true,
                onClick: (function (value) {
                  return function () {
                    setRoomTools(value)
                  }
                })(choice.value),
              },
              React.createElement(
                'span',
                { className: 'dsh-tv-modelCopy' },
                React.createElement('span', { className: 'dsh-tv-modelName' }, choice.short),
                React.createElement('span', { className: 'dsh-tv-permDesc' }, choice.desc),
              ),
              current
                ? React.createElement(
                    'span',
                    { className: 'dsh-tv-modelCheck', 'aria-hidden': 'true' },
                    React.createElement(CheckMark),
                  )
                : null,
            ),
          )
        }
        return React.createElement(
          'div',
          { className: 'dsh-tv-permRoot' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-tv-permChip',
              // 形狀照 DSH 那顆（`aria-label="访问模式，当前：工作区内修改"`）。
              'aria-label': '工具權限，目前：' + short,
              'aria-haspopup': 'menu',
              'aria-expanded': open ? 'true' : 'false',
              title: '這一間房的工具權限——它拿到什麼（改了馬上生效）',
              disabled: chat.roomToolsBusy === true,
              onClick: function () {
                chat.permMenu = !open
                // 一次只開一個（跟其他面板同一條規矩）。
                chat.usagePanel = ''
                chat.msgPanel = -1
                chat.modelMenu = false
                render()
              },
            },
            React.createElement(PermIcon),
            React.createElement('span', { className: 'dsh-tv-permLabel' }, short),
            React.createElement(ModelChevron, { open: open }),
          ),
          open
            ? React.createElement(
                'div',
                {
                  className: 'dsh-tv-usagePanel dsh-tv-permPanel',
                  role: 'menu',
                  'aria-label': '這一間房的工具權限',
                },
                React.createElement('div', { className: 'dsh-tv-modelList' }, rows),
              )
            : null,
        )
      }

      /**
       * 改這一間房的工具權限。
       *
       * 抽成一支是為了 `permissionChip()` 讀得懂，而且**錯誤要有人接**：
       * 寫不進去時把 `chat.roomTools` 退回原值——不然畫面會停在一個「看起來
       * 已經改好了」的狀態，而磁碟上根本沒動（那正是這一輪在別的地方抓到的病）。
       */
      function setRoomTools(value) {
        /**
         * ⚠️ **比對的基準是「畫面上現在顯示的那一個」，不是 `selected` 的快照。**
         *
         * 這裡踩過一次（真的在瀏覽器上才看出來）：`selected.allowTools` 是
         * `room.list` 回來的**舊快照**，改過一次之後它不會跟著更新。拿它當
         * 「目前的值」的話——
         *   1. 從 `inherit` 改成 `read`（送出去了、檔案也變了）
         *   2. 再點回「聽酒館的」→ `value === previous`（兩者都是舊的 `inherit`）
         *      → 被當成「點已經選中的那一個」→ **不送請求**
         * 於是**改不回原本的值**，而畫面顯示的是 `inherit`（`chat.roomTools` 有更新）
         * 與磁碟上的 `read` 不一致——最糟的那一種：畫面說一套、檔案是另一套。
         *
         * 所以基準要用 `chat.roomTools`（畫面顯示的那一個）。
         */
        var own =
          chat.roomTools === undefined ? selected.allowTools || 'inherit' : chat.roomTools
        var previous = own
        // ⚠️ **點已經選中的那一個＝只關掉選單**（不送請求、不跳通知）——這是
        // `plan.md` §2.6.43 為模型 chip 定下的規矩，同一種控制項就該同一種行為。
        // 而且它讓「開啟 → 看一下 → 關掉」不會在磁碟上留下一次沒意義的寫入。
        if (value === own) {
          chat.permMenu = false
          render()
          return
        }
        chat.permMenu = false
        chat.roomTools = value
        chat.roomToolsBusy = true
        render()
        rpc('room.write', {
          character: selected.character,
          room: selected.room,
          patch: { allowTools: value },
        })
          .then(function () {
            chat.roomToolsBusy = false
            chat.notice = '已儲存這一間房的工具權限'
            render()
          })
          .catch(function (error) {
            chat.roomToolsBusy = false
            chat.roomTools = previous
            chat.notice = ''
            chat.error = String((error && error.message) || error)
            render()
          })
      }

      /**
       * 讀模型目錄（點 chip 才讀，讀到就快取）。
       *
       * 來源是 DSH 自己的遠端方法 `remote.session.modelCatalog()`——它的
       * `ModelCatalogDirectory.load()` 做的就是這一個呼叫。回 `{ok, value}` 或
       * `{ok:false, error}`：**兩種都要好好講出來**，不要讓使用者按半天不知道為什麼沒反應。
       */
      function loadModels() {
        if (chat.models !== null && chat.models !== undefined && chat.models.status === 'ready') {
          return Promise.resolve()
        }
        var service = sessionsService()
        if (service === null || typeof service.modelCatalog !== 'function') {
          chat.models = { status: 'error', error: '這台 DSH 沒有提供模型目錄', groups: [] }
          render()
          return Promise.resolve()
        }
        chat.models = { status: 'loading', error: '', groups: [] }
        render()
        return service
          .modelCatalog()
          .then(function (response) {
            if (response === null || response === undefined || response.ok !== true) {
              var why =
                response !== null && response !== undefined && response.error !== undefined
                  ? String(response.error.code) + '：' + String(response.error.message)
                  : '讀不到模型目錄'
              chat.models = { status: 'error', error: why, groups: [] }
              render()
              return
            }
            var value = response.value
            var groups =
              value !== null && value !== undefined && Array.isArray(value.groups)
                ? value.groups
                : []
            chat.models = { status: 'ready', error: '', groups: groups }
            // ⚠️ 目錄的 default 存成**獨立的一格**（`chat.modelDefault`），**不要**寫進
            // `chat.modelCurrent`。先前寫進去，於是「一開選單就把目錄預設當成這一間房
            // 正在用的模型」——蓋掉 `loadMessages` 從訊息裡讀到的真實路由（順序是先開選單
            // 就中），而且那條路徑會在 `route` 還是 null 時直接讓 render 丟錯（第三次空白頁）。
            // 它只是**最低優先的後備**，放在 `currentSelection()` 的最後一位。
            if (
              value !== null &&
              value !== undefined &&
              value.default !== null &&
              value.default !== undefined &&
              typeof value.default.provider === 'string' &&
              typeof value.default.model === 'string'
            ) {
              chat.modelDefault = {
                provider: value.default.provider,
                model: value.default.model,
                effort:
                  typeof value.default.reasoningEffort === 'string'
                    ? value.default.reasoningEffort
                    : '',
              }
            }
            render()
          })
          .catch(function (error) {
            chat.models = {
              status: 'error',
              error: String((error && error.message) || error),
              groups: [],
            }
            render()
          })
      }

      /**
       * 換這一間房用的模型（或只換思考強度）。
       *
       * 走 DSH 自己的 `sessions.selectModel({sessionId, provider, model, reasoningEffort?})`
       * ——`ModelDirectory.selectModel` 用的就是這一個（回 `{ok}` 或 `{ok:false, error}`）。
       * 成功之後重讀用量列：路由真的換了，`request/context` 也會跟著變。
       *
       * ⚠️ **全新的房（還沒有 session）也要能選**：房間 ↔ session 是一對一，而模型選擇
       * 是**記在 session 上**的（`modelSelection` 投影），所以這裡先確保 session 存在
       * ——不然使用者得一開始先送一句話才能挑模型，那是很怪的順序。
       *
       * @param effort - 明確挑的等級；`undefined`＝只換模型，等級照新模型的規則收斂
       */
      function pickModel(provider, model, effort) {
        // 注意：selectModel 跟 modelCatalog 是**同一個命名空間**（remote.session），
        // 不是 sessions。先前掛在 sessions 上，於是永遠拿到 undefined——錯誤訊息就是
        // 「這台 DSH 沒有提供模型切換」。
        var service = sessionsService()
        if (service === null || typeof service.selectModel !== 'function') {
          // 不要只說「沒有」——把**真的有那些方法**列出來（跟查 primitives 同一招：
          // 能列出來就不要猜）。下次回報貼這一行就能直接定位。
          var keys = []
          try {
            keys = service === null ? [] : Object.keys(service).sort()
          } catch (error) {
            keys = ['（列不出來：' + String((error && error.message) || error) + '）']
          }
          chat.error =
            '這台 DSH 的 remote.session 沒有 selectModel；它有的是：' +
            (keys.length === 0 ? '（空——它可能是 Proxy，用 Object.keys 看不到）' : keys.join(', '))
          render()
          return Promise.resolve()
        }

        var selection = { provider: String(provider), model: String(model) }
        /**
         * 已經選的就是這一個 → **只把選單關掉**（DSH 的 `choose`：不送多餘的一次請求，
         * 也不跳一張重複的通知）。等級那一列同理。
         */
        var sameModel = modelKeyOf(chat.modelCurrent) === modelKeyOf(selection)
        var currentEffort =
          chat.modelCurrent !== null && chat.modelCurrent !== undefined && typeof chat.modelCurrent.effort === 'string'
            ? chat.modelCurrent.effort
            : ''
        if (sameModel && (typeof effort !== 'string' || effort === currentEffort)) {
          chat.modelMenu = false
          render()
          return Promise.resolve()
        }
        var catalogModel = findCatalogModel(chat.models, selection)
        /**
         * 等級怎麼來（跟 DSH 一樣）：
         *   - 從等級那一列挑的 → 用它（收斂過才送）
         *   - 只挑模型（`undefined`）→ 保留**目前那一級**，但要在新模型上合法，否則用新模型的預設
         */
        var wanted =
          typeof effort === 'string'
            ? effort
            : chat.modelCurrent !== null && chat.modelCurrent !== undefined
              ? chat.modelCurrent.effort
              : ''
        var nextEffort = resolveEffortFor(catalogModel, wanted)

        chat.modelBusy = true
        chat.error = ''
        render()
        return sessionForModelPick()
          .then(function (sessionId) {
            var request = { sessionId: sessionId, provider: selection.provider, model: selection.model }
            if (nextEffort !== '') request.reasoningEffort = nextEffort
            return service.selectModel(request)
          })
          .then(function (result) {
            chat.modelBusy = false
            if (result === null || result === undefined || result.ok !== true) {
              var why =
                result !== null && result !== undefined && result.error !== undefined
                  ? String(result.error.code) + '：' + String(result.error.message)
                  : '切換失敗'
              throw new Error(why)
            }
            chat.modelMenu = false
            // 換完**記住**現在用什麼（含推理等級）——不然 chip 只會一直顯示「模型」，
            // 使用者就看不到自己剛換了什麼。
            chat.modelCurrent = {
              provider: selection.provider,
              model: selection.model,
              effort: nextEffort,
            }
            // `chat.modelEffort`＝**使用者明確挑的**那一級（挑「提供方預設」時是空字串，
            // 跟「還沒挑過」（undefined）不一樣）。
            chat.modelEffort = typeof effort === 'string' ? effort : nextEffort
            var label = modelLabelOf(chat.models, chat.modelCurrent)
            var effortLabel = effortLabelOf(catalogModel, chat.modelCurrent)
            chat.notice =
              '已把這一間房換成 ' +
              (label === '' ? selection.model : label) +
              (effortLabel === '' ? '' : '（推理等級 ' + effortLabel + '）')
            render()
            return loadUsage()
          })
          .catch(function (error) {
            chat.modelBusy = false
            chat.error = '換模型失敗：' + String((error && error.message) || error)
            render()
          })
      }

      /**
       * 挑模型時要用的 session id：有就用，**沒有就開一個**（見 `pickModel` 的說明）。
       *
       * 開 session 是 `ensureChatSession` 那一條路（`preset.ensure` → `create` → `session.bind`），
       * 跟第一次送訊息時走的是同一個入口——**不要在模型這一側另寫一套**。
       */
      function sessionForModelPick() {
        return boundSessionId().then(function (sessionId) {
          if (sessionId !== null) return sessionId
          if (selected === null) throw new Error('還沒選定一份對話')
          var root = tavernRoot()
          if (root === '') throw new Error('還不知道這間酒館的資料夾——先按「重新讀取」')
          return ensureChatSession(
            state.activeId,
            selected.character,
            // ⚠️ 房間 id（身分）與顯示名稱是**兩個參數**，不要只傳一個（2.6.49）。
            selected.room,
            selected.name,
            root,
          ).then(function (ready) {
            chat.sessionId = ready.sessionId
            // ⚠️ 這裡**不要**寫 `chat.notice`（換模型成功那一則會蓋掉它），
            // session 是順手開的，不是使用者要的結果。
            return ready.sessionId
          })
        })
      }

      /**
      /**
       * 模型選單（點 chip 之後）。
       *
       * ⚠️ **兩層，照 DSH 的 `ModelSelect`**（讀它的 `client.js` 得到的事實）：
       *
       *   第一層 root  ：兩列 `cell`——「模型  <目前的值>  ›」與「推理等級  <目前的值>  ›」
       *   第二層 model ：依提供方分組的模型清單（`role=menuitemradio` ＋ 打勾）
       *   第二層 effort：這個模型的推理等級清單（同一種列，打勾的是**生效中**那一級）
       *
       * 先前是「選中的模型底下縮排展開等級」——那是把兩層壓成一層，看起來擠、
       * 而且等級那一層只有在「剛好選中那個模型」時才長得出來（全新的房根本看不到）。
       *
       * ⚠️ 選單**往上開**（輸入框貼在頁面底部，往下一定被裁掉），而且它住在
       * `.dsh-tv-modelRoot` 裡，`right:0` 就貼齊 chip（不必量座標、不必 portal）。
       */
      function modelMenu() {
        if (chat.modelMenu !== true) return null
        var state = chat.models
        var pane = chat.modelPane === 'model' || chat.modelPane === 'effort' ? chat.modelPane : 'root'
        var selection = currentSelection()
        var model = findCatalogModel(state, selection)
        var effortLabel = selection === null ? '' : effortLabelOf(model, selection)
        var modelLabel = modelLabelOf(state, selection)
        var loaded = state !== null && state !== undefined && state.status === 'ready'
        var rows = []

        /** 目前生效的等級（`current.reasoningEffort ?? reasoning.defaultEffort`）。 */
        var effectiveEffort = selection === null ? undefined : effectiveEffortOf(model, selection)

        if (pane === 'root') {
          // 第一層：兩列 cell。值要跟 chip 上顯示的一致（DSH 也是同一個 `modelLabel`／`effortLabel`）。
          rows.push(
            React.createElement(
              'button',
              {
                type: 'button',
                role: 'menuitem',
                className: 'dsh-tv-modelCell',
                key: 'cell-model',
                onClick: function () {
                  chat.modelPane = 'model'
                  render()
                },
              },
              React.createElement('span', { className: 'dsh-tv-modelCellLabel' }, '模型'),
              React.createElement(
                'span',
                { className: 'dsh-tv-modelCellValue' },
                modelLabel === '' ? '選擇模型' : modelLabel,
              ),
              React.createElement(ModelChevron, { open: false, cell: true }),
            ),
          )
          // 第二列只在這個模型**有推理等級**時出現（DSH 的 `reasoning !== undefined &&`）。
          if (selection !== null && effortLabel !== '') {
            rows.push(
              React.createElement(
                'button',
                {
                  type: 'button',
                  role: 'menuitem',
                  className: 'dsh-tv-modelCell',
                  key: 'cell-effort',
                  onClick: function () {
                    chat.modelPane = 'effort'
                    render()
                  },
                },
                React.createElement('span', { className: 'dsh-tv-modelCellLabel' }, '推理等級'),
                React.createElement('span', { className: 'dsh-tv-modelCellValue' }, effortLabel),
                React.createElement(ModelChevron, { open: false, cell: true }),
              ),
            )
          }
        }

        if (pane === 'model') {
          if (state === null || state === undefined || state.status === 'loading') {
            rows.push(
              React.createElement('div', { className: 'dsh-tv-modelEmpty', key: 'loading' }, '正在重新整理模型清單…'),
            )
          } else if (state.status === 'error') {
            rows.push(React.createElement('div', { className: 'dsh-tv-err', key: 'err' }, state.error))
          } else {
            /**
             * 「現在選的是哪一個」＝ **provider ＋ model 兩個欄位都比**。
             *
             * ⚠️ 先前只比 `chat.usage.route.model`，於是：同一個 model id 出現在兩個提供方
             * 底下時兩列都打勾；而且**全新的房根本沒有 route**，所以一列都不打勾。
             */
            var nowKey = modelKeyOf(selection)
            for (var g = 0; g < state.groups.length; g += 1) {
              var group = state.groups[g]
              if (group === null || group === undefined) continue
              var models = Array.isArray(group.models) ? group.models : []
              var kids = [
                React.createElement(
                  'div',
                  { className: 'dsh-tv-modelGroup', key: 'gt' + String(g) },
                  // ⚠️ 真的是 { id, name, models }——先前寫成 group.provider（undefined），
                  // 那種「照型別推」的錯就是點開變空白的原因。
                  group.name !== undefined ? String(group.name) : String(group.id),
                ),
              ]
              for (var m = 0; m < models.length; m += 1) {
                var one = models[m]
                if (one === null || one === undefined) continue
                var id = typeof one.id === 'string' ? one.id : ''
                if (id === '') continue
                var name = typeof one.name === 'string' && one.name !== '' ? one.name : id
                var provider = String(group.id)
                var current = nowKey !== '' && nowKey === provider + '/' + id
                kids.push(
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      role: 'menuitemradio',
                      'aria-checked': current ? 'true' : 'false',
                      className: 'dsh-tv-modelItem',
                      key: 'm' + String(g) + '-' + String(m),
                      disabled: chat.modelBusy === true,
                      title: provider + '/' + id,
                      onClick: (function (p, mm) {
                        return function () {
                          // 只挑模型：等級交給 `pickModel` 收斂（保留目前那一級，不合法就用新模型的預設）
                          pickModel(p, mm)
                        }
                      })(provider, id),
                    },
                    React.createElement(
                      'span',
                      { className: 'dsh-tv-modelCopy' },
                      React.createElement('span', { className: 'dsh-tv-modelName' }, name),
                      // 使用者：「選單也看不見模型的 id」——DSH 的選項是兩行（optionCopy 是
                      // column），第二行就是路由本身；照它把 provider/id 寫出來。
                      React.createElement('span', { className: 'dsh-tv-modelId' }, provider + '/' + id),
                    ),
                    React.createElement(
                      'span',
                      { className: 'dsh-tv-modelCheck' },
                      current ? React.createElement(CheckMark) : null,
                    ),
                  ),
                )
              }
              rows.push(
                React.createElement('section', { role: 'group', className: 'dsh-tv-modelSection', key: 'g' + String(g) }, kids),
              )
            }
            if (state.groups.length === 0) {
              rows.push(
                React.createElement('div', { className: 'dsh-tv-modelEmpty', key: 'none' }, '沒有可用的模型。'),
              )
            }
          }
        }

        if (pane === 'effort') {
          var options = effortOptionsOf(model)
          if (selection === null || options.length === 0) {
            rows.push(
              React.createElement(
                'div',
                { className: 'dsh-tv-modelEmpty', key: 'no-effort' },
                '這個模型沒有提供推理等級。',
              ),
            )
          } else {
            for (var e = 0; e < options.length; e += 1) {
              var option = options[e]
              // 生效中的那一級打勾（「提供方預設」＝沒有指定，也就是 effective 是空的）
              var on =
                option.id === ''
                  ? effectiveEffort === undefined || effectiveEffort === ''
                  : String(effectiveEffort) === option.id
              rows.push(
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitemradio',
                    'aria-checked': on ? 'true' : 'false',
                    className: 'dsh-tv-modelItem',
                    key: 'e' + String(e),
                    disabled: chat.modelBusy === true,
                    title: option.description !== '' ? option.description : option.name,
                    onClick: (function (p, mm, effortId) {
                      return function () {
                        pickModel(p, mm, effortId)
                      }
                    })(selection.provider, selection.model, option.id),
                  },
                  React.createElement(
                    'span',
                    { className: 'dsh-tv-modelCopy' },
                    React.createElement('span', { className: 'dsh-tv-modelName' }, option.name),
                  ),
                  React.createElement(
                    'span',
                    { className: 'dsh-tv-modelCheck' },
                    on ? React.createElement(CheckMark) : null,
                  ),
                ),
              )
            }
          }
        }

        return React.createElement(
          'div',
          {
            className: 'dsh-tv-usagePanel dsh-tv-modelPanel',
            role: 'menu',
            'aria-label': '模型與推理等級',
            'aria-busy': loaded === false ? 'true' : 'false',
          },
          React.createElement('div', { className: 'dsh-tv-modelList' }, rows),
        )
      }


      /**
       * 輸入框**外面**、下面那一排：兩顆 pill ＋ 點開的面板。
       *
       * 兩顆**就是 DSH 的那兩顆**（碼錶＝幾輪幾步·tok/s、資料庫＝累計 tok·快取命中）；
       * 上下文不在這裡——它是輸入框那一列裡的圓環（`usageRing()`）。
       *
       * 面板的四段**照 DSH 那個對話框**（使用者把它整份貼過來）：會話統計／Token 用量／
       * 本輪用量／本輪用時；每一列都是「標籤靠左、數字靠右」（它那顆環的面板用的也是
       * `margin-left:auto` 的數字）。
       */
      function usageRow() {
        var u = chat.usage
        if (u === null || u === undefined) return null
        var value = function (text) {
          return React.createElement('span', { className: 'dsh-tv-usageNum' }, text)
        }
        var sep = function (key) {
          return React.createElement(
            'span',
            { className: 'dsh-tv-usageSep', key: key, 'aria-hidden': 'true' },
            '·',
          )
        }
        // ⚠️ **每一顆按鈕開自己那一份**（使用者：「顯示資料他會分多個按鈕分開顯示」）：
        // 環→上下文、碼錶→會話統計、資料庫→Token 用量。`chat.usagePanel` 記的是
        // 「哪一顆開著」，空字串＝都關著。點同一顆＝收起來，點別顆＝換過去。
        var openPanel = typeof chat.usagePanel === 'string' ? chat.usagePanel : ''
        var pill = function (panelKey, title, kids) {
          return React.createElement(
            'button',
            {
              type: 'button',
              key: panelKey,
              className: 'dsh-tv-usagePill',
              title: title,
              'aria-label': title,
              'aria-expanded': openPanel === panelKey ? 'true' : 'false',
              onClick: function () {
                chat.usagePanel = openPanel === panelKey ? '' : panelKey
                chat.msgPanel = -1
                render()
              },
            },
            kids,
          )
        }

        var used = typeof u.baselineTokens === 'number' ? u.baselineTokens : null
        var win = typeof u.contextWindow === 'number' ? u.contextWindow : null
        var kids = []

        // ⚠️ 這裡**只有兩顆**（碼錶／資料庫）——上下文那一顆不是 pill，是輸入框那一列最右邊
        // 的**圓環按鈕**（見 `usageRing()`）。DSH 就是這樣分的：`JObwrW_trigger` 在
        // composer 的 trailing 裡（緊貼送出鍵前面），`.bOPqQW_root` 那兩顆在卡片**外面**。

        // 第一顆：幾輪幾步、多快（速度＝輸出 token ÷ 解碼秒數，跟 DSH 同一條公式）。
        var stats = u.stats
        if (stats !== null && stats !== undefined) {
          var run = [React.createElement(IconStopwatch, { key: 'icon' }), value(String(stats.turns)), ' 輪']
          if (stats.steps > 0) {
            run.push(' ')
            run.push(value(String(stats.steps)))
            run.push(' 步')
          }
          if (typeof stats.tokPerSec === 'number' && stats.tokPerSec > 0) {
            run.push(sep('s2'))
            run.push(value(String(Math.round(stats.tokPerSec))))
            run.push(' tok/s')
          }
          kids.push(
            pill(
              'stats',
              '這一場對話的輪數、步數與解碼速度（跟 DSH 自己那排統計同一個來源）。點一下看細節。',
              run,
            ),
          )
        }

        // 第二顆：累計 token 與快取命中。
        var usage = u.usage
        var hit = null
        if (usage !== null && usage !== undefined) {
          var input = typeof usage.input === 'number' ? usage.input : 0
          var read = typeof usage.cacheRead === 'number' ? usage.cacheRead : 0
          var output = typeof usage.output === 'number' ? usage.output : 0
          if (input > 0) {
            // 命中率＝快取讀 ÷ 輸入（DSH 自己那顆統計同一條公式）。差一點點就滿的時候
            // 留一位小數，不要謊報 100%。
            var hitShare = read / input
            hit =
              hitShare >= 1
                ? '100%'
                : hitShare * 100 > 99.5
                  ? (hitShare * 100).toFixed(1) + '%'
                  : String(Math.round(hitShare * 100)) + '%'
          }
          var toks = [
            React.createElement(IconDatabase, { key: 'icon' }),
            value(fmtTokens(input + output)),
            ' tok',
          ]
          if (hit !== null) {
            toks.push(sep('s3'))
            toks.push('快取命中 ')
            toks.push(value(hit))
          }
          kids.push(
            pill(
              // ⚠️ 這個 key 要跟上面那個 `openPanel === 'tokens'` **一模一樣**——
              // 不一致的話那一顆按鈕點開只會看到一個空面板（實際踩到）。
              'tokens',
              '整份對話的累計用量（供應方回報值），不是這一輪。點一下看細節。',
              toks,
            ),
          )
        }

        if (kids.length === 0) return null

        var rows = kids
        if (openPanel !== '') {
          var line = function (key, label, text) {
            return React.createElement(
              'div',
              { className: 'dsh-tv-usageLine', key: key },
              React.createElement('span', null, label),
              React.createElement('span', { className: 'dsh-tv-usageFig' }, text),
            )
          }
          var part = function (key, title, lines) {
            return React.createElement(
              'div',
              { className: 'dsh-tv-usageSection', key: key },
              React.createElement('div', { className: 'dsh-tv-usageTitle' }, title),
              lines,
            )
          }
          var sections = []

          // 1. 上下文——**只有點環才組**（點環開的就是這一份）。
          var ctxLines = []
          if (used !== null) {
            ctxLines.push(line('used', '提示詞', String(used).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' tok'))
          }
          if (win !== null) {
            ctxLines.push(line('win', '模型上限', String(win).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' tok'))
            if (used !== null) {
              ctxLines.push(
                line(
                  'buf',
                  '緩衝',
                  String(Math.max(0, win - used)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' tok',
                ),
              )
            }
          }
          var parts = u.parts
          if (parts !== null && parts !== undefined) {
            var total = parts.system + parts.tools + parts.messages
            var width = function (n) {
              return total > 0 ? (n / total) * 100 + '%' : '0%'
            }
            ctxLines.push(
              React.createElement(
                'div',
                { className: 'dsh-tv-usageBreak', key: 'break' },
                React.createElement('span', {
                  className: 'dsh-tv-usageBreakSystem',
                  style: { width: width(parts.system) },
                }),
                React.createElement('span', {
                  className: 'dsh-tv-usageBreakTools',
                  style: { width: width(parts.tools) },
                }),
                React.createElement('span', {
                  className: 'dsh-tv-usageBreakMessages',
                  style: { width: width(parts.messages) },
                }),
              ),
            )
            ctxLines.push(line('system', '系統', fmtTokens(parts.system)))
            ctxLines.push(line('tools', '工具', fmtTokens(parts.tools)))
            ctxLines.push(line('messages', '訊息', fmtTokens(parts.messages)))
          }
          if (openPanel === 'ctx' && ctxLines.length > 0) sections.push(part('ctx', '上下文', ctxLines))

          // 2. 會話統計——**只有點碼錶才組**（含本輪用時，都在同一顆按鈕裡）。
          if (openPanel === 'stats' && stats !== null && stats !== undefined) {
            var statLines = [
              line('run', '輪 · 步', String(stats.turns) + ' · ' + String(stats.steps)),
            ]
            if (stats.llmMs > 0) statLines.push(line('llm', '模型用時', fmtDuration(stats.llmMs)))
            if (stats.toolMs > 0) {
              statLines.push(line('tool', '工具呼叫用時', fmtDuration(stats.toolMs)))
            }
            if (stats.avgTtftMs !== null) {
              statLines.push(line('ttft', '首 token 平均（TTFT）', fmtDuration(stats.avgTtftMs)))
            }
            if (stats.tokPerSec !== null) {
              statLines.push(
                line('tps', '輸出速度（TPS）', String(Math.round(stats.tokPerSec)) + ' tok/s'),
              )
            }
            sections.push(part('stats', '會話統計', statLines))
          }

          // 3. Token 用量——**只有點資料庫才組**（累計 ＋ 本輪，都在同一顆按鈕裡）。
          if (openPanel === 'tokens' && usage !== null && usage !== undefined) {
            var tokLines = [
              line(
                'total',
                '合計',
                String((usage.input + usage.output)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' tok',
              ),
            ]
            if (hit !== null) tokLines.push(line('hit', '快取命中', hit))
            tokLines.push(
              line(
                'uncached',
                '未快取輸入',
                String(usage.uncached).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' tok',
              ),
            )
            tokLines.push(
              line(
                'read',
                '快取讀取',
                String(usage.cacheRead).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' tok',
              ),
            )
            if (usage.cacheWrite > 0) {
              tokLines.push(
                line(
                  'write',
                  '快取寫入',
                  String(usage.cacheWrite).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' tok',
                ),
              )
            }
            tokLines.push(
              line(
                'out',
                '輸出',
                String(usage.output).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' tok',
              ),
            )
            sections.push(part('tokens', 'Token 用量（累計）', tokLines))
          }

          sections.push(
            React.createElement(
              'div',
              { className: 'dsh-tv-usageSection', key: 'foot' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsh-tv-usageReload',
                  onClick: function () {
                    loadUsage()
                  },
                },
                '重新讀取',
              ),
            ),
          )
          rows = kids.concat([
            React.createElement('div', { className: 'dsh-tv-usagePanel', key: 'panel' }, sections),
          ])
        }

        return React.createElement('div', { className: 'dsh-tv-usage' }, rows)
      }

      /** 讀 `.jsonl`（畫面上看到的紀錄）。 */
      function loadMessages() {
        if (selected === null) return Promise.resolve()
        // ⚠️ 用 **`selected.room`（房間 id）**，不是 `selected.name`。
        // 名字只是顯示名稱：同一個角色可以有兩間同名房（`room.create` 的預設名稱
        // 就是角色名），而宿主半的 `resolveRoom` **只認 id**——送名字會明確報錯
        // （2.6.7 起；在那之前它會命中**第一間**同名房，症狀是新開的房訊息全跑進舊的）。
        return rpc('room.messages', { character: selected.character, room: selected.room })
          .then(function (messages) {
            chat.messages = Array.isArray(messages) ? messages : []
            // 一進房就顯示「目前用哪個模型」——DSH 的 ModelDirectory 也是這樣（它一進
            // session 就從 modelSelection 投影讀目前選什麼）。這裡不必新 API：**上一次那個
            // 模型就記在最後一則有記錄的訊息裡**（xtra.route，我們自己存的），
            // 往前掃最後一則有的就是它。已經自己換過（chat.modelCurrent 有值）就不覆蓋。
            if (chat.modelCurrent === null || chat.modelCurrent === undefined) {
              for (var mi = chat.messages.length - 1; mi >= 0; mi -= 1) {
                var one = chat.messages[mi]
                if (one === null || one === undefined) continue
                if (one.route === null || one.route === undefined) continue
                if (typeof one.route.provider !== 'string' || typeof one.route.model !== 'string') continue
                chat.modelCurrent = {
                  provider: one.route.provider,
                  model: one.route.model,
                  effort: typeof one.route.effort === 'string' ? one.route.effort : '',
                }
                if (chat.modelCurrent.effort !== '') chat.modelEffort = chat.modelCurrent.effort
                break
              }
            }
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
        // 用量跟訊息一起讀：換一間房就是換一個 session，兩份資料必須同時到位。
        loadUsage()
        // ⚠️ **不要在進房時自動讀目錄**（2026-09-22 撤回）：加了這一行之後我在瀏覽器上量到
        // 整個 app 都不再渲染（連 [data-slot="main"] 都不見），而前一版同樣的頁面還在——
        // 嫌疑最大的就是它。目錄**改成點開選單時才讀**（原本的行為，已驗過），
        // 代價只是 chip 要點一次才會從「模型」變成模型名。
        // 「看得見優先」：凡是可能讓畫面消失的巧思，先撤回再說。
      }, [currentKey])

      /**
       * 點面板**外面**就收起來。
       *
       * 使用者：「現在要重複點擊才會縮回去，我應該點擊外面就會縮回去」——那三顆按鈕自己的
       * onClick 只管切換，關閉交給這一條。點在面板／pill／環上面**不算外面**（它們自己有
       * onClick，這裡再關一次會變成「點一下開了又立刻關」）。
       *
       * ⚠️ 只在有面板開著時掛 listener，收起或卸載一定拆掉——不然會留一個永遠在監聽的
       * handler（這一頁是常駐面板，不會因為切走就重新掛載）。
       */
      React.useEffect(
        function () {
          if (
            chat.usagePanel === '' &&
            chat.msgPanel < 0 &&
            chat.modelMenu !== true &&
            chat.permMenu !== true
          ) {
            return undefined
          }
          var onDown = function (event) {
            var target = event !== null && event !== undefined ? event.target : null
            if (
              target !== null &&
              target !== undefined &&
              typeof target.closest === 'function'
            ) {
              if (target.closest('.dsh-tv-usagePanel') !== null) return
              if (target.closest('.dsh-tv-usagePill') !== null) return
              if (target.closest('.dsh-tv-usageRing') !== null) return
              if (target.closest('.dsh-tv-msgMeta') !== null) return
              if (target.closest('.dsh-tv-msgPanel') !== null) return
              if (target.closest('.dsh-tv-modelChip') !== null) return
              if (target.closest('.dsh-tv-modelPanel') !== null) return
              // 工具權限那一顆（`permissionChip()`）：點它的面板裡面不算「外面」，
              // 不然選項會在 mousedown 的當下就被關掉、點擊落空。
              if (target.closest('.dsh-tv-permChip') !== null) return
              if (target.closest('.dsh-tv-permPanel') !== null) return
            }
            chat.usagePanel = ''
            chat.msgPanel = -1
            chat.modelMenu = false
            chat.permMenu = false
            render()
          }
          document.addEventListener('mousedown', onDown)
          return function () {
            document.removeEventListener('mousedown', onDown)
          }
        },
        [chat.usagePanel, chat.msgPanel, chat.modelMenu, chat.permMenu],
      )

      /**
       * 這份對話在別的地方被刪掉了（設定頁的「💬 包廂」現在有刪除鈕）怎麼辦？
       *
       * 不處理的話這一頁會繼續顯示已經不存在的紀錄，使用者一送出訊息就得到
       * 「找不到這份對話」——而且他會以為是自己弄壞的。所以收到「內容變了」的通知時
       * 確認一下檔案還在不在，不見了就退回這間酒館的設定頁並說明原因。
       */
      useRefreshVersion(function () {
        if (selected === null) return
        /**
         * ⚠️ **這一輪還在跑的時候不要重讀**（實際踩到）。
         *
         * `setChatRunning()`（送出時標記「這一間房在跑」）自己就會 bump 這個通道，
         * 而重讀是拿**磁碟上的內容**蓋掉手上的訊息——磁碟還沒有剛剛送出的那一則
         * （要等跑完才寫回），所以使用者按下送出的**同一瞬間**，自己那則訊息連同
         * 附件就從畫面上消失了；那一輪失敗時的錯誤訊息也會被 `loadMessages` 的成功
         * 分支（`chat.error = ''`）蓋掉，變成「按了送出，什麼都沒發生」。
         *
         * `chat.writing` 是**寫回 `.jsonl` 那一段**（`chat.busy` 那時已經是 false 了）：
         * 這段時間磁碟同樣還沒有這一輪，重讀一樣會讓它消失。
         */
        if (chat.busy === true || chat.writing === true) return
        var gone = selected.character + '/' + selected.name
        rpc('room.list')
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

      /* ------------------------------ 附件 ------------------------------ */

      /** 下一次附件的編號（用來當 key，不用檔名——同名兩個檔是合法的）。 */
      var attachSeq = 0

      /** 把還沒送出的附件全部收掉（連同預覽用的 object URL 一起釋放）。 */
      function dropAttachments() {
        var list = Array.isArray(chat.attachments) ? chat.attachments : []
        for (var i = 0; i < list.length; i += 1) {
          var one = list[i]
          if (one !== null && typeof one === 'object' && typeof one.previewUrl === 'string' && one.previewUrl !== '') {
            try {
              URL.revokeObjectURL(one.previewUrl)
            } catch (error) {
              // 釋放失敗不該影響收尾。
            }
          }
        }
        chat.attachments = []
      }

      /** 使用者挑了檔案（或拖進來的）→ 變成待送的附件。 */
      function addAttachments(files) {
        var list = Array.isArray(files) ? files : []
        var next = Array.isArray(chat.attachments) ? chat.attachments.slice() : []
        for (var i = 0; i < list.length; i += 1) {
          var file = list[i]
          if (file === null || typeof file !== 'object') continue
          attachSeq += 1
          var mediaType = typeof file.type === 'string' ? file.type : ''
          var kind = attachmentKindOf(mediaType)
          var previewUrl = ''
          if (kind === 'image' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            try {
              previewUrl = URL.createObjectURL(file)
            } catch (error) {
              previewUrl = ''
            }
          }
          next.push({
            key: 'a' + String(attachSeq),
            kind: kind,
            mediaType: mediaType,
            file: file,
            name: typeof file.name === 'string' && file.name !== '' ? file.name : 'attachment',
            bytes: typeof file.size === 'number' && file.size >= 0 ? file.size : 0,
            previewUrl: previewUrl,
            // 存進房間之後才有：訊息畫的是它（`previewUrl` 只在這一輪活著）。
            url: '',
            status: 'ready',
            error: '',
          })
        }
        chat.attachments = next
        chat.error = ''
        chat.notice = ''
        render()
      }

      /** 拿掉一個還沒送出的附件。 */
      function removeAttachment(key) {
        var list = Array.isArray(chat.attachments) ? chat.attachments : []
        for (var i = 0; i < list.length; i += 1) {
          if (list[i].key !== key) continue
          var gone = list.splice(i, 1)[0]
          if (typeof gone.previewUrl === 'string' && gone.previewUrl !== '') {
            try {
              URL.revokeObjectURL(gone.previewUrl)
            } catch (error) {
              // 同上：釋放失敗不影響結果。
            }
          }
          break
        }
        render()
      }

      /**
       * 把一個附件**存進房間**（`<room>/files/`）。
       *
       * 這是「使用者的那一份」：DSH 的附件服務看不到、帶不走，所以同一份位元組在房間裡
       * 再放一份，訊息用 `extra.media` 指向它——重新整理之後畫得出來靠的就是它。
       * 存失敗不算失敗：那一則訊息還是送得出去，只是重新整理之後只剩檔名。
       */
      function storeAttachmentInRoom(tavernId, attachment) {
        return sendFileExpectOk(
          'file.write',
          {
            id: tavernId,
            character: selected.character,
            room: selected.room === undefined ? selected.name : selected.room,
            name: attachment.name,
          },
          attachment.file,
          attachment.mediaType,
        )
          .then(function (saved) {
            attachment.url = typeof saved.url === 'string' ? saved.url : ''
            if (typeof saved.name === 'string' && saved.name !== '') attachment.name = saved.name
            return attachment
          })
          .catch(function () {
            return attachment
          })
      }

      /** 圖片 → base64（DSH 的 `{type:'image'}` part 要的是純 base64，不是 data URL）。 */
      function readBase64(file) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader()
          reader.onerror = function () {
            reject(new Error('讀不到這個檔案'))
          }
          reader.onload = function () {
            var text = typeof reader.result === 'string' ? reader.result : ''
            var comma = text.indexOf(',')
            resolve(comma < 0 ? '' : text.slice(comma + 1))
          }
          reader.readAsDataURL(file)
        })
      }

      /**
       * 一個附件 → 送給模型的那一份。
       *
       * 圖片走 base64（**只有這樣模型才真的看得到那張圖**），其他走 DSH 的
       * `fileUpload.upload` 拿 `receiptId`。兩者都必須綁在**同一個 session** 上，
       * 所以順序是「先確定 session，再編碼，再送出」。
       */
      function encodeAttachmentForModel(sessionId, attachment) {
        if (attachment.kind === 'image') {
          return readBase64(attachment.file).then(function (data) {
            return { kind: 'image', mediaType: attachment.mediaType, data: data, name: attachment.name }
          })
        }
        var context = ctxRef.get('fileUpload')
        if (context === null || context === undefined || typeof context.upload !== 'function') {
          return Promise.reject(
            new Error('這台 DSH 沒有檔案上傳服務（fileUpload）——只能送出文字與圖片'),
          )
        }
        return context
          .upload(sessionId, attachment.file, attachment.name, undefined, function (progress) {
            if (progress === null || typeof progress !== 'object') return
            attachment.uploaded = typeof progress.loaded === 'number' ? progress.loaded : attachment.uploaded
            render()
          })
          .then(function (result) {
            if (result === null || typeof result !== 'object' || result.ok !== true) {
              throw new Error(
                result && result.error && result.error.message
                  ? String(result.error.message)
                  : '上傳失敗',
              )
            }
            return { kind: 'file', receiptId: result.value.receiptId }
          })
      }

      /** 這一輪要送出去的內容（附件先、文字後）。失敗時丟錯，呼叫端顯示訊息。 */
      function contentForTurn(sessionId, text, list) {
        var jobs = []
        for (var i = 0; i < list.length; i += 1) jobs.push(encodeAttachmentForModel(sessionId, list[i]))
        return Promise.all(jobs).then(function (encoded) {
          return buildPromptContent(encoded, text)
        })
      }

      function submit() {
        var text = chat.draft.trim()
        var pending = Array.isArray(chat.attachments) ? chat.attachments.slice() : []
        // 只有附件、沒有文字是合法的（丟一張圖不說話）；兩者都空才是不送。
        if ((text === '' && pending.length === 0) || chat.busy) return
        if (selected === null) return
        chat.busy = true
        chat.draft = ''
        chat.live = ''
        chat.liveThought = ''
        chat.error = ''
        chat.notice = ''
        // 「本輪用量／本輪用時」是**這一輪**的事，上一輪的留著只會誤導。
        chat.turnUsage = null
        chat.turnMs = null
        chat.turnStartedAt = Date.now()
        render()

        var tavernId = state.activeId
        var root = tavernRoot()
        if (root === '') {
          chat.busy = false
          chat.error = '還不知道這間酒館的資料夾——先按「重新讀取」'
          render()
          return
        }
        // 先把使用者的話（與附件）畫上去（不要等他跑完網路才看到自己打了什麼）。
        // ⚠️ 圖片先用**本輪的 object URL** 畫：存進房間是等一下的事，而使用者按了送出
        // 就該立刻看到那張圖。
        chat.messages = chat.messages.concat([
          {
            name: '你',
            isUser: true,
            text: text,
            sendDate: '',
            media: previewMediaOf(pending),
          },
        ])
        // 附件已經交出去了：清空待送列（那一則訊息自己帶著它們）。
        chat.attachments = []
        // 側邊欄那一列的圖示換成「進行中」的跑馬燈（送出到收到結果之間）。
        setChatRunning(selected.character, selected.name, true)
        render()
        // 自己剛送出的訊息一定要看得到 → 無條件貼底（就算剛剛在翻紀錄）。
        pinnedRef.current.pinned = true
        stickToBottom(true)

        ensureChatSession(tavernId, selected.character, selected.room, selected.name, root)
          .then(function (ready) {
            chat.sessionId = ready.sessionId
            if (ready.created === true) chat.notice = '已開一個新的對話 session'
            render()
            // 附件先處理：存一份進房間（`extra.media` 指的那一份）、再編碼成模型讀得懂
            // 的 part。**順序不能反**——`receiptId` 綁在 session 上，要先有 session。
            var stored = []
            for (var si = 0; si < pending.length; si += 1) {
              stored.push(storeAttachmentInRoom(tavernId, pending[si]))
            }
            return Promise.all(stored)
              .then(function () {
                // 存好之後把畫面上的預覽換成**房間那一份**（object URL 這一輪結束就沒了）。
                var media = mediaOfAttachments(pending)
                if (media.length > 0) {
                  var last = chat.messages.length - 1
                  if (last >= 0 && chat.messages[last].isUser === true) chat.messages[last].media = media
                }
                render()
                return contentForTurn(ready.sessionId, text, pending)
              })
              .then(function (content) {
                return sendChatMessage(ready.sessionId, text, {
                  content: content,
                  onReasoning: function (thought) {
                    chat.liveThought += thought
                    render()
                  },
                  onDelta: function (delta) {
                    chat.live += delta
                    render()
                  },
                  // 供應方回報的這一輪用量（DSH 那個對話框的「本輪用量」就是它）。
                  onUsage: function (usage) {
                    chat.turnUsage = usage
                  },
                })
              })
          })
          .then(function (result) {
            chat.busy = false
            // 本輪總用時：從按下送出到收到完整回覆。
            if (typeof chat.turnStartedAt === 'number') {
              chat.turnMs = Date.now() - chat.turnStartedAt
              chat.turnStartedAt = null
            }
            var reasoning = typeof result.reasoning === 'string' ? result.reasoning : chat.liveThought
            chat.live = ''
            chat.liveThought = ''
            // 這一輪的用量與用時**跟著訊息走**（DSH 就是在訊息上顯示那兩個）：
            // 記憶體這一份現在畫，`extra.usage`／`extra.ms` 那一份活得過重新整理。
            var turnUsage = turnUsageForMessage(chat.turnUsage)
            var turnMs = typeof chat.turnMs === 'number' ? chat.turnMs : null
            // 這條路由是誰（同一間房的用量列讀到的 request/context 事件）——記在訊息上，
            // 面板的「提供方 / 模型」那一列才活得過重新整理。
            var turnRoute =
              chat.modelCurrent !== null && chat.modelCurrent !== undefined
                ? chat.modelCurrent
                : chat.usage !== null &&
                    chat.usage !== undefined &&
                    chat.usage.route !== null &&
                    chat.usage.route !== undefined
                  ? chat.usage.route
                  : null
            chat.messages = chat.messages.concat([
              {
                name: selected.character,
                isUser: false,
                text: result.text,
                sendDate: '',
                reasoning: reasoning,
                usage: turnUsage,
                ms: turnMs,
                route: turnRoute,
              },
            ])
            setChatRunning(selected.character, selected.name, false)
            render()
            // 這一輪跑完，用量一定變了（提示詞長高、快取讀增加）——順手重讀那一列。
            loadUsage()
            // 寫回 `.jsonl`：**這是使用者帶得走的那一份**。寫不進去不算對話失敗，
            // 但要說出來（不然他會以為紀錄有存）。
            // 附件用**房間那一份的 URL**（`extra.media`）——預覽的 object URL 這一輪
            // 結束就失效了，寫進紀錄會留下一張永遠打不開的圖。
            // `chat.writing`：這一段磁碟還沒有這一輪，重讀會讓剛送出的訊息消失
            // （`useRefreshVersion` 的守衛會看它）。
            chat.writing = true
            return rpc('room.append', {
              id: tavernId,
              character: selected.character,
              room: selected.room,
              messages: [
                { name: '你', isUser: true, text: text, media: mediaOfAttachments(pending) },
                {
                  name: selected.character,
                  isUser: false,
                  text: result.text,
                  reasoning: reasoning,
                  usage: turnUsage,
                  ms: turnMs,
                  route: turnRoute,
                },
              ],
            })
              .then(function (count) {
                chat.writing = false
                return count
              })
              .catch(function (error) {
                chat.writing = false
                chat.error = '回覆有拿到，但寫回紀錄失敗：' + String((error && error.message) || error)
                render()
              })
          })
          .catch(function (error) {
            chat.busy = false
            chat.writing = false
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

      /**
       * 角色頭像的 URL＝那張卡的**主圖**。
       *
       * `useTavernData` 已經把 `character.list` 讀進同一份 state 了，所以這裡
       * 不需要再多一次 RPC。找不到卡、或那張卡沒有插圖就回 null，由字母頭像接手。
       */
      function characterAvatarUrl() {
        if (selected === null || !Array.isArray(state.characters)) return null
        for (var i = 0; i < state.characters.length; i += 1) {
          var item = state.characters[i]
          if (item.id !== selected.character) continue
          var assets = item.assets
          if (assets === null || assets === undefined) return null
          return findAssetUrl(assets, assets.primary)
        }
        return null
      }

      /**
       * 頭像上要放的字。
       *
       * `unused` 是宿主半沒收到名字時寫進 `.jsonl` 的佔位字串（SillyTavern 也這樣寫），
       * 直接取第一個字會得到「u」——所以在這裡換成「你」。
       */
      function avatarLetter(label, me) {
        var text = typeof label === 'string' ? label.trim() : ''
        if (text === '' || text === 'unused') return me ? '你' : '？'
        return text.slice(0, 1)
      }

      /** 這一則要顯示的稱呼（頭像的字與氣泡上的名字共用同一個來源）。 */
      function labelOf(message) {
        var text = typeof message.name === 'string' ? message.name.trim() : ''
        if (text !== '' && text !== 'unused') return text
        if (message.isUser === true) return '你'
        return selected === null ? '' : selected.character
      }

      /**
       * 一則訊息的頭像。
       *
       * 角色用卡片主圖；沒有圖、或這一則是你自己說的，就用**名字的第一個字**——
       * 通訊軟體的做法，而且永遠畫得出來。這一排不該因為「這張卡沒有插圖」
       * 就整排少一塊。
       */
      function avatarNode(url, label, me) {
        if (url !== null) {
          return React.createElement('img', { className: 'dsh-tv-avatar', src: url, alt: '', loading: 'lazy' })
        }
        return React.createElement(
          'span',
          { className: 'dsh-tv-avatar dsh-tv-avatarText' },
          avatarLetter(label, me),
        )
      }

      /**
       * 一則訊息：頭像 ＋（名字／思考／氣泡）。
       *
       * 氣泡本身還是原本那顆 `.dsh-tv-bubble`——主題的 `style.bubble` 四種預設、
       * 尾巴、以及 `--dsh-tv-bubble-*` 覆寫全部照舊，只是在外面包了一列。
       */
      /**
       * 訊息底下那兩個小標籤：**用量 X tok**、**用时 Y**。
       *
       * ⚠️ 位置是照 DSH 的：它把那兩個掛在**訊息上**（`message.turnUsage.*`／
       * `message.ranFor` 這一整組 locale key 都是 `message.` 開頭），不是掛在對話框上。
       *
       * 而且**整份「本輪用量」都在這裡**（使用者：「還有這些資訊你剛才放錯位置了」）：
       * 點「用量」那一顆就展開那一輪的細節——合計／提供方 · 模型／快取命中／未快取輸入／
       * 快取讀取／輸出（其中推理），加上「本輪用時和速度」。
       */
      function msgMeta(message, index) {
        if (message === null || message === undefined) return null
        if (message.isUser === true) return null
        var usage = message.usage
        var hasUsage = usage !== null && usage !== undefined && typeof usage === 'object'
        var ms = typeof message.ms === 'number' && message.ms >= 0 ? message.ms : null
        if (!hasUsage && ms === null) return null

        var total = hasUsage
          ? (typeof usage.input === 'number' ? usage.input : 0) +
            (typeof usage.output === 'number' ? usage.output : 0)
          : 0
        var open = chat.msgPanel === index
        var kids = []

        if (total > 0) {
          var input = typeof usage.input === 'number' ? usage.input : 0
          var output = typeof usage.output === 'number' ? usage.output : 0
          var read = typeof usage.cacheRead === 'number' ? usage.cacheRead : 0
          var write = typeof usage.cacheWrite === 'number' ? usage.cacheWrite : 0
          var reason = typeof usage.reasoning === 'number' ? usage.reasoning : 0
          kids.push(
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-tv-msgMetaItem dsh-tv-msgMetaBtn',
                key: 'use',
                'aria-expanded': open ? 'true' : 'false',
                title: open ? '點一下收起這一輪的細節' : '點一下看這一輪的細節',
                onClick: function () {
                  chat.msgPanel = open ? -1 : index
                  // 一次只開一個：開訊息這邊就把輸入框那排的收掉。
                  chat.usagePanel = ''
                  render()
                },
              },
              React.createElement(IconDatabase),
              '用量 ' + fmtTokens(total) + ' tok',
            ),
          )
          if (open) {
            var rows = [
              usageLine('total', '合計', grouped(total) + ' tok'),
            ]
            // 「提供方 / 模型」（DSH 的 `message.turnUsage.model`）——送出的那一刻記下來的；
            // 舊訊息沒有就不列。
            if (message.route !== null && message.route !== undefined) {
              rows.push(
                usageLine(
                  'model',
                  '提供方 / 模型',
                  String(message.route.provider) + '/' + String(message.route.model),
                ),
              )
            }
            if (input > 0) {
              rows.push(usageLine('hit', '快取命中', String(Math.round((read / input) * 100)) + '%'))
            }
            rows.push(usageLine('uncached', '未快取輸入', grouped(input) + ' tok'))
            rows.push(usageLine('read', '快取讀取', grouped(read) + ' tok'))
            if (write > 0) rows.push(usageLine('write', '快取寫入', grouped(write) + ' tok'))
            rows.push(
              usageLine(
                'out',
                '輸出',
                grouped(output) + ' tok' + (reason > 0 ? '（其中推理 ' + grouped(reason) + ' tok）' : ''),
              ),
            )
            kids.push(
              React.createElement(
                'div',
                { className: 'dsh-tv-msgPanel', key: 'panel' },
                usageSection('turn', '本輪用量', rows),
              ),
            )
          }
        }

        if (ms !== null) {
          kids.push(
            React.createElement(
              'span',
              { className: 'dsh-tv-msgMetaItem', key: 'time', title: '這一輪從送出到收到完整回覆' },
              React.createElement(IconClock),
              '用时 ' + fmtDuration(ms),
            ),
          )
          if (open) {
            var speed = turnSpeedOf(
              { outputTokens: hasUsage && typeof usage.output === 'number' ? usage.output : 0 },
              ms,
            )
            var timeRows = [usageLine('total', '本輪總用時', fmtDuration(ms))]
            if (speed !== null) {
              timeRows.push(usageLine('tps', '本輪輸出速度', String(Math.round(speed)) + ' tok/s'))
            }
            kids.push(
              React.createElement(
                'div',
                { className: 'dsh-tv-msgPanel', key: 'timePanel' },
                usageSection('time', '本輪用時和速度', timeRows),
              ),
            )
          }
        }

        if (kids.length === 0) return null
        return React.createElement('div', { className: 'dsh-tv-msgMeta' }, kids)
      }

      /**
       * 一則訊息夾帶的附件（圖片畫出來、其他檔案變一顆 chip）。
       *
       * 來源是 `.jsonl` 的 `extra.media`（SillyTavern 的欄位）——**重新整理之後還在**，
       * 因為它指的是房間裡那一份普通檔案（`<room>/files/`），不是 DSH 內部的附件。
       */
      function messageMedia(message) {
        var list = message !== null && message !== undefined && Array.isArray(message.media) ? message.media : []
        if (list.length === 0) return null
        var kids = []
        for (var i = 0; i < list.length; i += 1) {
          var one = list[i]
          if (one === null || typeof one !== 'object') continue
          var url = typeof one.url === 'string' ? one.url : ''
          var name = typeof one.name === 'string' ? one.name : ''
          if (url === '' && name === '') continue
          if (one.type === 'image' && url !== '') {
            kids.push(
              // 圖片本身不進 `.jsonl`（只有 URL）：附件是房間裡的真檔案，點開就是原圖。
              React.createElement(
                'a',
                {
                  key: 'i' + String(i),
                  className: 'dsh-tv-msgImgLink',
                  href: url,
                  target: '_blank',
                  rel: 'noreferrer',
                  title: name,
                },
                React.createElement('img', {
                  className: 'dsh-tv-msgImg',
                  src: url,
                  alt: name === '' ? '附件圖片' : name,
                  loading: 'lazy',
                }),
              ),
            )
            continue
          }
          // 檔案（以及「还没存進房間」的圖片）：一顆 chip。
          // ⚠️ 沒有 URL 時**不要畫成連結**——點下去只會得到 404，而且使用者會以為檔案不見了。
          var chipBody = [
            React.createElement(
              'span',
              { className: 'dsh-tv-fileChipName', key: 'n' },
              name === '' ? '附件' : name,
            ),
            React.createElement(
              'span',
              { className: 'dsh-tv-fileChipSize', key: 's' },
              formatBytes(one.bytes),
            ),
          ]
          kids.push(
            url === ''
              ? React.createElement(
                  'span',
                  {
                    key: 'f' + String(i),
                    className: 'dsh-tv-fileChip dsh-tv-fileChipFlat',
                    title: '這一份只送給模型，沒有存進房間的 files/（見「📄 檔案」分頁）',
                  },
                  chipBody,
                )
              : React.createElement(
                  'a',
                  {
                    key: 'f' + String(i),
                    className: 'dsh-tv-fileChip',
                    href: url,
                    target: '_blank',
                    rel: 'noreferrer',
                    title: name,
                  },
                  chipBody,
                ),
          )
        }
        if (kids.length === 0) return null
        return React.createElement('div', { className: 'dsh-tv-msgMedia' }, kids)
      }

      function messageRow(key, message, avatarUrl, thinking, index, turnAnchor) {
        var me = message.isUser === true
        var label = labelOf(message)
        var hasText = message.text !== ''
        var media = messageMedia(message)
        var props = { key: key, className: me ? 'dsh-tv-msg dsh-tv-msgMe' : 'dsh-tv-msg' }
        // 只有「這一輪的第一則」帶 `data-turn`（輪次刻度量位置用的錨點）。
        if (typeof turnAnchor === 'number') props['data-turn'] = String(turnAnchor)
        return React.createElement('div', props,
          avatarNode(me ? null : avatarUrl, label, me),
          React.createElement(
            'div',
            { className: 'dsh-tv-msgBody' },
            // 名稱在氣泡**外面**、氣泡上面（使用者要求）——通訊軟體的做法，
            // 氣泡裡只放內容。所以 `bubbleWho` 是 `msgBody` 的子節點，不是氣泡的。
            React.createElement('div', { className: 'dsh-tv-bubbleWho' }, label),
            // 沒有正文、沒有思考、也沒有附件時，不要畫一個空的框。
            thinking === null && !hasText && media === null
              ? null
              : React.createElement(
                  'div',
                  { className: me ? 'dsh-tv-bubble dsh-tv-bubbleMe' : 'dsh-tv-bubble' },
                  thinking,
                  media,
                  hasText
                    ? React.createElement(
                        'div',
                        { className: 'dsh-tv-bubbleText' },
                        // ⚠️ 把這一頁的解析設定**明確傳進去**（而不是讓 `renderMessage`
                        //    去讀模組層級那一格）：同一則訊息在同一次繪製裡要拿到同一份
                        //    設定，而模組那一格是「最後一次繪製」寫進去的值。
                        renderMessage(message.text, label, chat.parseConfig || activeParseConfig),
                      )
                    : null,
                ),
            // 那一輪的「用量 … tok」「用时 …」——在氣泡**下面**（DSH 也掛在訊息底下）。
            msgMeta(message, typeof index === 'number' ? index : -1),
          ),
        )
      }

      // 把載入函式留在模組層級，讓離線測試叫得到（見 `chatLoader` 的註解）。
      chatLoader = loadMessages
      usageLoader = loadUsage

      var body = null
      if (selected === null) {
        body = React.createElement('div', { className: 'dsh-tv-empty' }, '從側邊欄的「酒館街」點一份對話。')
      } else {
        var avatarUrl = characterAvatarUrl()
        /**
         * 哪幾則是「某一輪的第一則」（`turnAnchorsOf()` 是純函式，規則在那裡）。
         * 用物件當集合查——`indexOf` 在每一則訊息上跑一次是 O(n²)。
         */
        var turnStarts = {}
        var anchors = turnAnchorsOf(chat.messages)
        for (var ti = 0; ti < anchors.length; ti += 1) turnStarts[anchors[ti]] = true

        var bubbles = chat.messages.map(function (message, index) {
          // 這一則的思考（`.jsonl` 的 `extra.reasoning`）：畫在氣泡**裡面、正文之前**，
          // 跟 DSH 原生把思考放在回覆前面一致。
          return messageRow(
            'm' + String(index),
            message,
            avatarUrl,
            typeof message.reasoning === 'string' && message.reasoning !== ''
              ? React.createElement(ThinkingRow, { key: 'r', text: message.reasoning, running: false })
              : null,
            index,
            // ⚠️ **每一輪的第一則**掛 `data-turn`——右邊那條輪次刻度靠它量位置
            // （`syncTurnRail()` 用 `offsetTop`）。分輪的規則在 `turnAnchorsOf()`。
            turnStarts[index] === true ? index : null,
          )
        })
        // 串流中的那一則：**思考先出現、正文後出現**。以前 reasoning 被整段丟掉，
        // 所以模型在想的那幾秒畫面上什麼都沒有（看起來像卡住）。
        if (chat.liveThought !== '' || chat.live !== '') {
          bubbles.push(
            messageRow(
              'live',
              { name: selected.character, isUser: false, text: chat.live, reasoning: '' },
              avatarUrl,
              chat.liveThought !== ''
                ? React.createElement(ThinkingRow, {
                    key: 'think',
                    text: chat.liveThought,
                    // 還在想＝還沒收到正文；正文一開始流就停止流動效果。
                    running: chat.live === '',
                  })
                : null,
            ),
          )
        }

        /**
         * 在房間裡改名。
         *
         * 使用者：「改名應該房間內都可以改，不一定要在出面」——以前只有側邊欄那一列的
         * ⋯ 選單可以改，人已經在房間裡了卻要退出去才改得動名字。
         *
         * ⚠️ 改名**只動 `room.json` 裡的 `name`**，資料夾、`chat.jsonl`、`art/`、
         * session 綁定全部照舊（身分是房間 id）。所以改完只有兩件事要做：
         *   1. 換掉手上的座標，但**用合併的**——`room.rename` 只回
         *      `{character, room, name}`，直接取代會把 `roomPrompt`／`allowTools`／
         *      `file` 弄丟，這一頁的欄位就空了。改名不是重讀。
         *   2. 通知側邊欄重讀：那一列還掛著舊名字。
         */
        function renameSelf() {
          if (chat.renaming === true) return
          var next = String(chat.roomName === undefined ? selected.name : chat.roomName).trim()
          if (next === '' || next === selected.name) {
            chat.roomName = undefined
            render()
            return
          }
          chat.renaming = true
          chat.error = ''
          chat.notice = ''
          render()
          rpc('room.rename', {
            character: selected.character,
            room: selected.room,
            name: next,
          })
            .then(function (renamed) {
              chat.renaming = false
              chat.roomName = undefined
              currentChat = Object.assign({}, selected, renamed)
              chat.notice =
                '已改名為「' + renamed.name + '」——資料夾還是 chats/' +
                selected.character + '/' + selected.room
              render()
              notifyWorkspaceChanged()
            })
            .catch(function (error) {
              chat.renaming = false
              chat.error = '改名失敗：' + String((error && error.message) || error)
              render()
            })
        }

        // 分頁列：跟四個分區同一組樣式（`.dsh-tv-zone*`），所以兩處的切換手感一致。
        var tabRow = React.createElement(
          'div',
          { className: 'dsh-tv-zones', role: 'tablist', 'aria-label': '對話頁分頁' },
          CHAT_TABS.map(function (tab) {
            var on = tab.key === currentChatTab
            return React.createElement(
              'button',
              {
                key: tab.key,
                type: 'button',
                role: 'tab',
                'aria-selected': on ? 'true' : 'false',
                className: on ? 'dsh-tv-zone dsh-tv-zoneOn' : 'dsh-tv-zone',
                onClick: function () {
                  currentChatTab = tab.key
                  render()
                },
              },
              tab.label,
            )
          }),
        )

        // ⚠️ 分頁的內容是**同一層的兄弟節點**，不是再包一層 div。
        // `.dsh-tv-chatLog` 的高度是靠父層的 flex 撐出來的，多包一層就會讓
        // 訊息區的捲動高度算錯（`createElement` 會把陣列攤平，所以這樣等價）。
        var panes =
          currentChatTab === 'room'
            ? [
                chat.error !== '' ? React.createElement('div', { className: 'dsh-tv-err' }, chat.error) : null,
                chat.notice !== '' ? React.createElement('div', { className: 'dsh-tv-ok' }, chat.notice) : null,
                // 這一間房自己的設定。放在對話頁而不是 ⚙️ 設定，因為它們是「這一場」
                // 的事——酒館那一層管的是「這間店」。
                //
                // 名字放第一個：房間的身分是 id，名字只是標籤，但在外面那一列看得到的是
                // 名字，所以在房間裡也要能改（使用者：「改名應該房間內都可以改」）。
                React.createElement(
                  'div',
                  { className: 'dsh-tv-field' },
                  React.createElement('div', { className: 'dsh-tv-fieldLabel' }, '這間房的名字'),
                  React.createElement(
                    'div',
                    { className: 'dsh-tv-inlineRow' },
                    React.createElement('input', {
                      className: 'dsh-tv-in',
                      value: chat.roomName === undefined ? selected.name || '' : chat.roomName,
                      spellCheck: false,
                      'aria-label': '這間房的名字',
                      placeholder: selected.name || '',
                      onChange: function (event) {
                        chat.roomName = event.target.value
                        render()
                      },
                      onKeyDown: function (event) {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          renameSelf()
                        }
                      },
                    }),
                    React.createElement(
                      MapBtn,
                      {
                        primary: true,
                        disabled: chat.renaming === true || chat.busy === true,
                        onClick: renameSelf,
                      },
                      chat.renaming === true ? '儲存中…' : '儲存名字',
                    ),
                  ),
                  React.createElement(
                    'div',
                    { className: 'dsh-tv-fieldHint' },
                    '只改顯示名稱。資料夾與對話紀錄用的是房間 id（' +
                      (selected.room || '') +
                      '），所以改名不會搬動任何檔案，也不會影響已經綁好的對話。',
                  ),
                ),
                React.createElement(
                  'div',
                  { className: 'dsh-tv-field' },
                  React.createElement('div', { className: 'dsh-tv-fieldLabel' }, '這一場的指示'),
                  React.createElement('textarea', {
                    className: 'dsh-tv-ta',
                    rows: 3,
                    'aria-label': '這一場的指示',
                    placeholder: '例：這一場下著雨，她已經知道你是誰。',
                    value:
                      chat.roomPrompt === undefined ? selected.roomPrompt || '' : chat.roomPrompt,
                    onChange: function (event) {
                      chat.roomPrompt = event.target.value
                      render()
                    },
                  }),
                  React.createElement(
                    'div',
                    { className: 'dsh-tv-fieldHint' },
                    '接在角色卡與酒館規則後面，只在這一間房生效。留空＝與以前一字不差。',
                  ),
                ),
                React.createElement(MapSelect, {
                  label: '這一間房的工具權限',
                  value:
                    chat.roomTools === undefined ? selected.allowTools || 'inherit' : chat.roomTools,
                  hint:
                    '「聽酒館的」＝沿用 ⚙️ 設定 那一層（預設是「全關」）。選了就馬上生效——' +
                    '這裡寫的是「它拿到什麼」，不是工具名稱。',
                  // ⚠️ 與 ⚙️ 設定 那一格**共用同一份選項**（`ROOM_TOOL_LEVEL_OPTIONS`
                  // 只是在前面多一個「聽酒館的」）——兩份清單走散過的代價是
                  // 「選了卻存不進去」。
                  options: ROOM_TOOL_LEVEL_OPTIONS,
                  onChange: function (value) {
                    chat.roomTools = value
                    rpc('room.write', {
                      character: selected.character,
                      room: selected.room,
                      patch: { allowTools: value },
                    })
                      .then(function () {
                        chat.notice = '已儲存這一間房的工具權限'
                        render()
                      })
                      .catch(function (error) {
                        chat.error = String((error && error.message) || error)
                        render()
                      })
                  },
                }),
                /**
                 * ⚠️ **這一間房的「藏書放哪裡」**（2.6.65）。
                 *
                 * 使用者：「酒館的藏書應該是有分酒館 global 以及房間，所以要有
                 * 兩個設定位置，現在只有酒館沒能在房間中仔細設定」。
                 *
                 * 三態：`null`／空字串 ＝ 聽酒館的（房間的預設值）；
                 * 三個位置名之一 ＝ 這一間房自己的選擇。
                 * ⚠️ 它是**這一間房的預設**，不是「強制覆蓋全部」：書自己指定過的那一本
                 * 蓋過它（書 → 房預設 → 酒館）。要蓋過某一本書，用上面 📖 藏書 那一頁
                 * 對那一本書的指定（那個排在最前面）。
                 */
                React.createElement(MapSelect, {
                  label: '這一間房的「藏書放哪裡」',
                  value:
                    chat.roomBookPosition === undefined
                      ? roomBookPositionValue(selected)
                      : chat.roomBookPosition === null
                        ? ''
                        : chat.roomBookPosition,
                  options: [{ value: '', label: '聽酒館的', hint: '沿用 📖 藏書 最上面那一格（酒館層的預設）。' }].concat(
                    WORLDBOOK_POSITIONS.map(function (one) {
                      return { value: one, label: WORLDBOOK_POSITION_INFO[one].label, hint: WORLDBOOK_POSITION_INFO[one].hint }
                    }),
                  ),
                  onChange: function (value) {
                    var previous = chat.roomBookPosition
                    chat.roomBookPosition = value === '' ? null : value
                    render()
                    rpc('room.write', {
                      character: selected.character,
                      room: selected.room,
                      patch: { worldbookPosition: chat.roomBookPosition },
                    })
                      .then(function (saved) {
                        chat.notice = '已儲存這一間房的藏書位置'
                        if (saved !== null && saved !== undefined && Array.isArray(saved.dropped) && saved.dropped.length > 0) {
                          chat.notice = ''
                          chat.error = '這幾項沒有存下來：' + saved.dropped.join('、')
                        }
                        render()
                      })
                      .catch(function (error) {
                        // ⚠️ 失敗要把畫面改回去（同工具權限那一條）：留著一個
                        // 「看起來選了、磁碟上沒有的值」比報錯更糟。
                        chat.roomBookPosition = previous
                        chat.error = String((error && error.message) || error)
                        render()
                      })
                  },
                }),
                // 這一間房的生成參數：**留空＝聽酒館的**（與工具權限同一條規矩）。
                // 逐欄位蓋：只填溫度就只蓋溫度，token 上限沿用 ⚙️ 設定 那一層。
                React.createElement(
                  'div',
                  { className: 'dsh-tv-fieldLabel', style: { marginTop: '10px' } },
                  '這一間房的生成參數（留空＝聽酒館的）',
                ),
                React.createElement(
                  'div',
                  { className: 'dsh-tv-inlineRow' },
                  React.createElement('input', {
                    className: 'dsh-tv-in',
                    type: 'number',
                    min: SAMPLER_RANGES.temperature.min,
                    max: SAMPLER_RANGES.temperature.max,
                    step: '0.05',
                    'aria-label': '這一間房的溫度',
                    placeholder: '溫度（留空＝聽酒館的）',
                    value:
                      chat.roomTemperature === undefined
                        ? settingsNumber(selected, 'temperature')
                        : chat.roomTemperature,
                    onChange: function (event) {
                      chat.roomTemperature = event.target.value
                      render()
                    },
                  }),
                  React.createElement('input', {
                    className: 'dsh-tv-in',
                    type: 'number',
                    min: SAMPLER_RANGES.maxTokens.min,
                    max: SAMPLER_RANGES.maxTokens.max,
                    step: '1',
                    'aria-label': '這一間房的最多 token',
                    placeholder: '最多 token（留空＝聽酒館的）',
                    value:
                      chat.roomMaxTokens === undefined
                        ? settingsNumber(selected, 'maxTokens')
                        : chat.roomMaxTokens,
                    onChange: function (event) {
                      chat.roomMaxTokens = event.target.value
                      render()
                    },
                  }),
                ),
                // stop 序列：與 ⚙️ 設定 那一格同一件事，只是這一層蓋過酒館那一層。
                //
                // ⚠️ **開關是這一間房的「聽酒館的／開／關」三態**，不是布林——
                // 房間說「關」必須能蓋過酒館的「開」（`lib/samplers.js` 的
                // `triStateOf`）。用一顆 checkbox 的話就表達不出「聽酒館的」，
                // 而那是房間的**預設值**：既有房間一個字都不會被改到。
                React.createElement(MapSelect, {
                  label: '這一間房的「擋住它替你說話」',
                  value:
                    chat.roomStopEnabled === undefined
                      ? roomStopState(selected)
                      : chat.roomStopEnabled === null
                        ? 'inherit'
                        : chat.roomStopEnabled === true
                          ? 'on'
                          : 'off',
                  options: [
                    { value: 'inherit', label: '聽酒館的', hint: '沿用 ⚙️ 設定 那一格的開關（預設）。' },
                    { value: 'on', label: '開', hint: '這一間房也送內建的停止序列。' },
                    { value: 'off', label: '關', hint: '這一間房不要送——即使酒館那一層開著。' },
                  ],
                  onChange: function (value) {
                    // ⚠️ 三態在檔案裡就是三態：`'inherit'` ⇒ `null`（清除＝聽上一層）、
                    // `'on'`／`'off'` ⇒ 真的布林。送字串進去的話宿主半會說
                    // 「stopEnabled（要是 true 或 false）」而**不會存**。
                    var previous = chat.roomStopEnabled
                    chat.roomStopEnabled = value === 'inherit' ? null : value === 'on'
                    render()
                    rpc('room.write', {
                      character: selected.character,
                      room: selected.room,
                      patch: { stopEnabled: chat.roomStopEnabled },
                    })
                      .then(function (saved) {
                        chat.notice = '已儲存這一間房的停止序列開關'
                        if (saved !== null && saved !== undefined && Array.isArray(saved.dropped) && saved.dropped.length > 0) {
                          chat.notice = ''
                          chat.error = '這幾項沒有存下來：' + saved.dropped.join('、')
                        }
                        render()
                      })
                      .catch(function (error) {
                        // ⚠️ 失敗要把畫面改回去（同 chip 那一條）：留著一個
                        // 「看起來選了、磁碟上沒有的值」比報錯更糟。
                        chat.roomStopEnabled = previous
                        chat.error = String((error && error.message) || error)
                        render()
                      })
                  },
                }),
                React.createElement(
                  'div',
                  { className: 'dsh-tv-fieldLabel', style: { marginTop: '10px' } },
                  '這一間房的停止序列（一行一個，留空＝聽酒館的）',
                ),
                React.createElement('textarea', {
                  className: 'dsh-tv-ta',
                  rows: 3,
                  'aria-label': '這一間房的停止序列',
                  placeholder: '例如：\n使用者：',
                  value:
                    chat.roomStop === undefined
                      ? stopToText(selected.stop)
                      : chat.roomStop,
                  onChange: function (event) {
                    chat.roomStop = event.target.value
                    render()
                  },
                }),
                React.createElement(
                  'div',
                  { className: 'dsh-tv-inlineRow', style: { marginTop: '6px' } },
                  React.createElement(
                    MapBtn,
                    {
                      onClick: function () {
                        rpc('room.write', {
                          character: selected.character,
                          room: selected.room,
                          patch: {
                            temperature: samplerPatchValue(
                              chat.roomTemperature === undefined
                                ? settingsNumber(selected, 'temperature')
                                : chat.roomTemperature,
                            ),
                            maxTokens: samplerPatchValue(
                              chat.roomMaxTokens === undefined
                                ? settingsNumber(selected, 'maxTokens')
                                : chat.roomMaxTokens,
                            ),
                            stop: stopPatchValue(
                              chat.roomStop === undefined
                                ? stopToText(selected.stop)
                                : chat.roomStop,
                            ),
                          },
                        })
                          .then(function (saved) {
                            chat.notice = '已儲存這一間房的生成參數'
                            // 同 `commit`：不合法的那幾個要說出來（見那裡的註解）。
                            if (saved !== null && saved !== undefined && Array.isArray(saved.dropped) && saved.dropped.length > 0) {
                              chat.notice = ''
                              chat.error = '這幾個值沒有存下來（超出範圍或格式不對）：' + saved.dropped.join('、')
                            }
                            render()
                          })
                          .catch(function (error) {
                            chat.error = String((error && error.message) || error)
                            render()
                          })
                      },
                    },
                    '儲存這一間房的生成參數',
                  ),
                ),
                React.createElement(
                  'div',
                  { className: 'dsh-tv-inlineRow' },
                  React.createElement(
                    MapBtn,
                    {
                      primary: true,
                      onClick: function () {
                        var text =
                          chat.roomPrompt === undefined ? selected.roomPrompt || '' : chat.roomPrompt
                        rpc('room.write', {
                          character: selected.character,
                          room: selected.room,
                          patch: { roomPrompt: text },
                        })
                          .then(function () {
                            chat.notice = '已儲存這一場的指示'
                            render()
                          })
                          .catch(function (error) {
                            chat.error = String((error && error.message) || error)
                            render()
                          })
                      },
                    },
                    '儲存這一場的指示',
                  ),
                  React.createElement(
                    'span',
                    { className: 'dsh-tv-note', style: { marginLeft: 'auto' } },
                    'chats/' + selected.character + '/' + selected.room + '/room.json',
                  ),
                ),
              ]
            : currentChatTab === 'art'
            ? [
                // 這一間房自己的插圖：場景圖、房間圖都掛在這裡，而檔案**住在房間資料夾裡**
                // （`chats/<角色>/<roomId>/art/`，見 `assets.js` 的 `assetDir`）。
                // ⚠️ owner 要用**房間 id**：送顯示名稱的話會指向 `chats/<角色>/<名字>/art/`
                // ——一個不存在的資料夾，於是這一頁永遠是「0 張」而且上傳會落到錯的地方。
                React.createElement(AssetManager, {
                  key: 'chat-' + selected.character + '/' + selected.room,
                  kind: 'chat',
                  owner: selected.character + '/' + selected.room,
                }),
              ]
            : currentChatTab === 'books'
              ? [
                  /**
                   * ⚠️ **這一間房的藏書管理**（2.6.65）。
                   *
                   * 「酒館的是預設、房間是微調」——所以這一頁列的是**每一本書在
                   * 這一間房最後會怎樣**，而每一列可以：
                   *   - 打開／關掉（這一間房不要這本書）
                   *   - 改位置（**蓋過書自己指定的**；沒指定的話照書自己的 → 房間預設 → 酒館）
                   *   - 看內容（唯讀展開）
                   *
                   * ⚠️ 它**只調「這一場怎麼讀」**，書的內容一個字都不會被改
                   * （那是使用者的 ST 檔）。
                   */
                  React.createElement(RoomBooksPane, {
                    key: 'room-books-' + selected.character + '/' + selected.room,
                    rpc: rpc,
                    selected: selected,
                    settings: state.settings,
                  }),
                ]
            : currentChatTab === 'file'
              ? [
                  // 「我也要能改」——所以要給**可以貼進檔案總管的絕對路徑**，
                  // 而不是只有相對路徑。這些都是普通檔案，改壞了也看得出來。
                  React.createElement(
                    'div',
                    { className: 'dsh-tv-fieldLabel' },
                    '這一間房的資料夾',
                  ),
                  React.createElement(
                    'p',
                    { className: 'dsh-tv-path' },
                    (state.summary && state.summary.root ? state.summary.root : '（讀取中）') +
                      '/chats/' +
                      selected.character +
                      '/' +
                      selected.room,
                  ),
                  React.createElement(
                    'div',
                    { className: 'dsh-tv-inlineRow' },
                    // 主鍵：**帶你去**（用 DSH 原生的「用…開啟」）。
                    // 「複製路徑」留著當次要——有時候你就是想貼到別的地方。
                    React.createElement(
                      MapBtn,
                      {
                        primary: true,
                        onClick: function () {
                          var target =
                            (state.summary && state.summary.root ? state.summary.root : '') +
                            '/chats/' +
                            selected.character +
                            '/' +
                            selected.room
                          openFolder(target, function (problem) {
                            chat.error = problem === '' ? '' : '打不開資料夾：' + problem
                            chat.notice = problem === '' ? '已交給系統開啟' : ''
                            render()
                          })
                        },
                      },
                      '📂 打開資料夾',
                    ),
                    React.createElement(
                      MapBtn,
                      {
                        onClick: function () {
                          var text =
                            (state.summary && state.summary.root ? state.summary.root : '') +
                            '/chats/' +
                            selected.character +
                            '/' +
                            selected.room
                          var board =
                            typeof navigator !== 'undefined' && navigator.clipboard !== undefined
                              ? navigator.clipboard
                              : null
                          // 沒有剪貼簿就**照實說**，不要假裝複製成功。
                          if (board === null) {
                            chat.notice = '這個瀏覽器不給複製，請自己選取上面的路徑'
                            render()
                            return
                          }
                          board.writeText(text).then(
                            function () {
                              chat.notice = '已複製路徑'
                              render()
                            },
                            function () {
                              chat.notice = '複製失敗，請自己選取上面的路徑'
                              render()
                            },
                          )
                        },
                      },
                      '複製路徑',
                    ),
                  ),
                  React.createElement(
                    'p',
                    { className: 'dsh-tv-note' },
                    'room.json —— 這一間房的設定（「⚙️ 房間」分頁改的就是它）',
                  ),
                  React.createElement(
                    'p',
                    { className: 'dsh-tv-note' },
                    'chat.jsonl —— 對話本身，SillyTavern 格式，一行一則，可以直接備份',
                  ),
                  React.createElement('p', { className: 'dsh-tv-note' }, 'art/ —— 這一間房的插圖'),
                  React.createElement(
                    'p',
                    { className: 'dsh-tv-note' },
                    'files/ —— 訊息裡夾帶的附件（圖片／檔案）',
                  ),
                  React.createElement(
                    'p',
                    { className: 'dsh-tv-note' },
                    '角色卡：characters/' + selected.character + '.json',
                  ),
                  React.createElement(
                    'p',
                    { className: 'dsh-tv-note' },
                    '改名在「⚙️ 房間」分頁（房間裡就能改）；刪除到「💬 包廂」。改名只動 room.json 裡的名字，資料夾不會變。',
                  ),
                ]
              : [
                  chat.error !== '' ? React.createElement('div', { className: 'dsh-tv-err' }, chat.error) : null,
                  chat.notice !== '' ? React.createElement('div', { className: 'dsh-tv-ok' }, chat.notice) : null,
                  !chatAvailable()
                    ? React.createElement(
                        'div',
                        { className: 'dsh-tv-err' },
                        '這台 DSH 沒有對話服務（remote.session）——酒館可以管理檔案，但沒有辦法在這裡聊天。',
                      )
                    : null,
                  // ⚠️ 訊息區外面這一層是**必要的**：輪次刻度要不隨內容捲動，
                  // 就得有一個不捲動的定位祖先當它的兄弟節點（見 CSS 那一段）。
                  React.createElement(
                    'div',
                    { className: 'dsh-tv-logWrap' },
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
                    // 輪次刻度疊在訊息區右邊（不隨內容捲動）。
                    turnRail(),
                  ),
                  React.createElement(
                    'div',
                    { className: 'dsh-tv-chatInput' },
                    // 待送的附件：在輸入框**上面**、同一張卡裡（送出之後就清空，
                    // 它們會跟著那一則訊息走）。
                    chat.attachments !== undefined && chat.attachments.length > 0
                      ? React.createElement(
                          'div',
                          { className: 'dsh-tv-attachRow' },
                          chat.attachments.map(function (item) {
                            return React.createElement(
                              'span',
                              {
                                key: item.key,
                                className:
                                  item.status === 'error'
                                    ? 'dsh-tv-attachChip dsh-tv-attachChipErr'
                                    : 'dsh-tv-attachChip',
                                title: item.error === '' ? item.name : item.error,
                              },
                              item.kind === 'image' && item.previewUrl !== ''
                                ? React.createElement('img', {
                                    className: 'dsh-tv-attachThumb',
                                    src: item.previewUrl,
                                    alt: item.name,
                                  })
                                : React.createElement('span', { className: 'dsh-tv-attachIcon' }, '📄'),
                              React.createElement(
                                'span',
                                { className: 'dsh-tv-attachName' },
                                item.name,
                              ),
                              React.createElement(
                                'span',
                                { className: 'dsh-tv-attachSize' },
                                formatBytes(item.bytes),
                              ),
                              React.createElement(
                                'button',
                                {
                                  type: 'button',
                                  className: 'dsh-tv-attachDrop',
                                  'aria-label': '拿掉這個附件',
                                  title: '拿掉',
                                  onClick: function () {
                                    removeAttachment(item.key)
                                  },
                                },
                                React.createElement(IconAttachRemove),
                              ),
                            )
                          }),
                        )
                      : null,
                    // 隱藏的分岔入口：附件鈕按的就是它（同插圖／匯入卡片那一套）。
                    React.createElement('input', {
                      type: 'file',
                      multiple: true,
                      ref: attachInput,
                      style: { display: 'none' },
                      onChange: function (event) {
                        // ⚠️ 先複製成真陣列再清 value——`event.target.files` 是**活的**
                        // FileList，清 value 會就地把它清空（見 `pickFiles` 的註解）。
                        addAttachments(pickFiles(event))
                      },
                    }),
                    React.createElement('textarea', {
                      className: 'dsh-tv-ta',
                      rows: 3,
                      // ⚠️ 這個 `aria-label` 不只是無障礙：`fillChatDraft()`（可點的
                      // 「選項」把文字填進來）就是用它當錨點找這一格的。改名字
                      // 會讓那個功能**安靜地**失效（點了沒反應、沒有錯誤）。
                      'aria-label': '訊息',
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
                      { className: 'dsh-tv-composerRow' },
                      // 左邊放酒館自己的資訊（DSH 那一列左邊是工具鈕），右邊一組是
                      // **環 ＋ 送出**（DSH 的 `.uV2eYG_trailing`：`margin-left:auto`，
                      // 順序是 model → 環 → 送出）。
                      // 📎 附件鈕在**最左邊**（DSH 的工具鈕也在那一側），按了開檔案的挑選器。
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-tv-attachBtn',
                          'aria-label': '加入附件（圖片或檔案）',
                          title: '加入附件（圖片會直接給模型看；其他檔案先上傳）',
                          disabled: chat.busy,
                          onClick: function () {
                            if (attachInput.current === null || attachInput.current === undefined) return
                            attachInput.current.click()
                          },
                        },
                        React.createElement(IconPaperclip),
                      ),
                      // 工具權限那一顆（酒館版的「訪問模式」）。
                      //
                      // ⚠️ 位置照 DSH 的 `.uV2eYG_tools`：`[+指令] [📎] [modes]`
                      // ——所以它在 📎 **右邊**、在檔案路徑**左邊**（檔案路徑是酒館
                      // 自己的資訊，不屬於那一組工具鈕）。
                      permissionChip(),
                      React.createElement(
                        'span',
                        { className: 'dsh-tv-note dsh-tv-composerNote' },
                        '檔案：chats/' + selected.character + '/' + selected.file,
                      ),
                      React.createElement(
                        'div',
                        { className: 'dsh-tv-composerTrail' },
                        // 順序照 DSH 的 trailing：model → 環 → 送出。
                        modelChip(),
                        usageRing(),
                        React.createElement(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-tv-send',
                            'aria-label': chat.busy ? '停下來' : '送出',
                            title: chat.busy ? '停下來' : '送出（Enter）',
                            onClick: chat.busy ? stop : submit,
                          },
                          chat.busy
                            ? React.createElement('span', { className: 'dsh-tv-sendStop' })
                            : React.createElement(IconSendArrow),
                        ),
                      ),
                    ),
                    // 模型選單**不在這裡**：它住在 `modelChip()` 的 `.dsh-tv-modelRoot` 裡
                    // （那個 root 是 `position:relative`、只有 chip 那麼寬，所以選單
                    // `right:0` 就精準貼齊 chip——不必量座標）。在這裡再畫一次會變成兩份。
                  ),
                  // ⚠️ 統計 pill 在**卡片外面**（DSH 的 `.bOPqQW_root` 也是卡片外面的一個
                  // 區塊，寬度對齊、整排置中）——上下文環在卡片裡那一列，兩件事**分開**。
                  usageRow(),
                ]

        body = React.createElement('div', { className: 'dsh-tv-chatBody' }, tabRow, panes)
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
        /**
         * ⚠️ `dsh-tv-mapBodyFill` **只加在對話那一個分頁**：它讓訊息區吃掉剩餘高度、
         * 輸入框沉底（使用者：「對話框區域可以沉底現在,不好看」）。
         * 另外三個分頁是很長的表單，靠外層的 `overflow-y:auto` 捲動——套上去會捲不動。
         */
        React.createElement(
          'div',
          { className: 'dsh-tv-mapBody' + (currentChatTab === 'chat' ? ' dsh-tv-mapBodyFill' : '') },
          body,
        ),
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

        // 第三層：這間酒館的 `custom.css`（**排在元件樣式後面**，所以它蓋得過去）。
        // 內容是使用者寫的，用 `@scope` 包住才注入（見 `applyCustomCss`）。
        customStyle = document.createElement('style')
        customStyle.setAttribute('data-dsh-plugin', 'dsh-tavern')
        customStyle.setAttribute('data-dsh-tavern-theme', 'custom')
        document.head.appendChild(customStyle)

        return function () {
          themeStyle.remove()
          style.remove()
          customStyle.remove()
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
                  // 共用資源探測：拿不拿得到 DSH 的 UI 基本元件、裡面有什麼（下一輪照這個換）。
                  primitives:
                    PRIMITIVES === null || PRIMITIVES === undefined
                      ? null
                      : Object.keys(PRIMITIVES).sort(),
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
      /**
       * 客戶端鏡射的生成參數範圍。
       *
       * 匯出給測試是必要的：客戶端 bundle 沒有 ESM import，所以 `SAMPLER_RANGES`
       * 是從 `lib/samplers.js` **手抄**的一份，而 `test-client.mjs` 會拿兩邊對照。
       * 沒有這一條，改了一邊就會走散（`plan.md` §7.9 的色票就是這樣壞過一次）。
       */
      __samplerRanges: SAMPLER_RANGES,
      /**
       * `stop` 序列的界線（同樣是 `lib/samplers.js` 的 `STOP_LIMITS` 的鏡射）。
       *
       * ⚠️ 它與 `__samplerRanges` **分開匯出**：形狀不同（`count`／`length`
       * 而不是 `min`／`max`），混在一個物件裡會讓「哪幾個是範圍、哪幾個是上限」
       * 看不出來——而那正是這個鏡射最容易被改壞的地方。
       */
      __stopLimits: STOP_LIMITS,
      /**
       * 工具權限那一顆 chip 的選項（`value` 要與 `lib/workspace.js` 的
       * `ROOM_TOOL_LEVELS` 一字不差）。匯出給測試對照——那是**跨半契約**，
       * 少一個值就會出現「選了卻存不進去」（`writeRoom` 會落回 `inherit`）。
       */
      __permissionChoices: PERMISSION_CHOICES,
      /**
       * 分輪的規則（右邊那條輪次刻度用的）。匯出給測試：假的 React 沒有排版，
       * 量不到位置，但「哪幾則算一輪的開頭」可以單獨驗。
       */
      __turnAnchors: turnAnchorsOf,
      /**
       * 刻度條帶的排版算式（固定間距、框高、讓當前那一輪留在框裡的位移）。
       * 匯出給測試：這三個數字是「看起來對不對」的全部，而且它可以純算。
       */
      __turnRailLayout: turnRailLayout,
      __sampleHelpers: { rangeText: rangeText, settingsNumber: settingsNumber, samplerPatchValue: samplerPatchValue },
      /**
       * `stop` 序列那一欄的兩個純函式（清單 ↔ textarea 的文字）。
       *
       * 匯出給測試：這一組的**整個重點**就是「客戶端不自己拆行」——拆行、trim、
       * 去重全部在宿主半的 `normalizeStop()`。所以測試要能證明
       * 「`stopPatchValue` 把一整段文字原樣送出去」與「`stopToText` 讀得懂陣列」。
       * 而那一條規矩的價值在於：兩邊各拆一份＝面板預覽與實際送出遲早不一致。
       */
      __stopHelpers: { stopToText: stopToText, stopPatchValue: stopPatchValue },
      /**
       * `stop` 的內建清單（**`lib/samplers.js` 的 `STOP_PRESET` 的鏡射**）。
       *
       * 匯出給測試對照：畫面上那句「內建送這幾串」列的就是它，而真的送出去的是
       * 宿主半算的。兩邊不一樣＝使用者照著畫面推理、而推理的基礎是錯的。
       */
      __stopPreset: STOP_PRESET,
      /**
       * 世界書的注入位置（**`lib/worldbook.js` 的鏡射**）。
       *
       * 匯出給測試對照：畫面上寫的「角色卡後面」與宿主半真的把字放到哪裡
       * 必須是同一件事——走散的話使用者會設定一個位置、而它去別的地方。
       */
      __worldbookPositions: WORLDBOOK_POSITIONS,
      __worldbookPositionInfo: WORLDBOOK_POSITION_INFO,
      /** 清單上的位置短標籤（「系統前／系統後／訊息前」）。 */
      __positionShort: POSITION_SHORT,
      /** 一本書的位置那一格要顯示什麼（純函式）。 */
      __bookPositionValue: bookPositionValue,
      /**
       * 宿主半的錯誤 → 使用者看得懂的一句話（純函式）。
       *
       * ⚠️ 匯出給測試是必要的：`unknown op` 那一條只有真的踩過一次才會知道它多沒用
       * （見 `rpcErrorText` 的註解），而它**不會**在離線測試裡自己出現。
       */
      __rpcErrorText: rpcErrorText,
      /**
       * 條目 `order` 的上下限（**`lib/worldbook.js` 的 `ORDER_LIMITS` 鏡射**）。
       *
       * ⚠️ 兩邊必須一致：客戶端的 `<input min max>` 只是提示，真正擋下來的是
       * 宿主半（`normalizeOrder`）——但畫面上寫的範圍與宿主半收的範圍不一樣
       * 就是騙人，所以測試會對照這兩份。
       */
      __orderLimits: ORDER_LIMITS,
      /**
       * 回覆格式那一組：模式清單、鏡射的純函式、以及「一份 render 設定 →
       * `parseMessage` 的設定」的轉換。
       *
       * 匯出給測試是必要的：`parseConfigFromRender` 有一條**只靠讀程式碼看不出來**
       * 的規矩——只有 `marked` 模式才把標記交給解析器（其他模式要讓角括號露出來，
       * 因為那代表模型走樣了）。那一條錯了會是**安靜的**：畫面照樣畫得出來，
       * 只是把走樣的輸出當成正常格式。
       */
      __render: {
        modes: RENDER_MODES,
        parseConfigFromRender: parseConfigFromRender,
        progressOf: progressOf,
        parseChoices: parseChoices,
        /**
         * 節點樹 → 畫面。匯出給測試：這一段的輸入輸出都是純資料
         * （原文 → React 元素），所以不必把非同步的訊息載入拉進來當前置條件
         * ——而「解析對了但畫不出來」是**安靜的**失敗（畫面照樣有字、只是形狀不對）。
         */
        renderMessage: renderMessage,
        /**
         * `key: value` 的列（`data` 區塊用的）。
         *
         * 匯出給測試：它有**一條只有實測才會發現的規矩**——行分隔要同時認
         * 真的換行與**字面上的 `\n`**（JSON 的轉義）。那一條錯了會是安靜的：
         * 整塊資料降級成一行夾著看得見的 `\n` 的旁白，而不是一張表。
         */
        dataRows: parseDataRows,
        parseMessage: parseMessage,
      },
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
        // 這一輪的用量（DSH 那個對話框的「本輪用量」）——只有串流裡那一則拿得到。
        usageOfFrame: usageOfFrame,
        // 本輪的輸出速度（純函式），以及「這條路由是誰」（快照的 records 裡就有）。
        turnSpeedOf: turnSpeedOf,
        routeOfRecords: routeOfRecords,
        splitNarration: splitNarration,
        // 主題框架（給測試與之後的設定頁）
        FALLBACK_THEME_TOKENS: FALLBACK_THEME_TOKENS,
        themeTokensCss: themeTokensCss,
        applyTheme: applyTheme,
        currentTheme: currentTheme,
        // `style.*`（對話框樣式）與 `custom.css`——兩個都要能單獨驗：
        // 它們的值直接進 CSS，寫錯的話畫面會壞得很安靜。
        BUBBLE_STYLE_VARS: BUBBLE_STYLE_VARS,
        currentStyle: function () {
          return activeStyle
        },
        applyCustomCss: applyCustomCss,
        scopeCustomCss: scopeCustomCss,
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
      /**
       * 📖 藏書的條目編輯：解析、列舉、改一個欄位。
       *
       * 這三支是**純函式**（不碰 React、不碰 state），所以離線測得到完整行為——
       * `MapWorldbooks` 的清單是在 `useEffect` 裡非同步載入的，而假 React 的
       * `useEffect` 是空函式（跟刪除對話那條同一個限制）。
       */
      __worldbook: {
        parse: worldbookParse,
        entries: worldbookEntries,
        keysOf: worldbookKeysOf,
        keyField: worldbookKeyField,
        patch: worldbookPatch,
      },
      /**
       * 顯示層的解析：原文 → 節點樹。
       *
       * 這一支是**整個顯示層的地基**（畫面、語音、統計、匯出都讀它），而且是純函式
       * ——所以它能單獨驗、也能在終端機裡貼一段文字進去看結果
       * （`node parse-preview.mjs`），不必先接畫面。
       */
      __display: {
        parse: parseMessage,
        repair: repairMessage,
        DEFAULT_CONFIG: PARSE_DEFAULT_CONFIG,
        findOpenTag: findOpenTag,
        dataRows: parseDataRows,
      },
      /**
       * 主面板的分區切換（大廳／包廂／卡司／藏書）。
       *
       * 一定要能單獨驗：假 React 的 `useState` setter 是空函式，所以切換刻意走
       * 模組層級的 `currentZone`。測試直接設它、再重繪 `TavernSettingsPage`，
       * 就能驗「切過去真的只畫那一區」——那是純靠 `useState` 做不到的。
       */
      __setZone: function (key) {
        currentZone = key
      },
      __currentZone: function () {
        return currentZone
      },
      /**
       * 對話頁的分頁。同 `__setZone` 的理由：常駐面板 ＋ 假的 React 不跑 setState，
       * 所以切換走模組層級的變數，測試直接設它、再重繪 `TavernChatPage`。
       */
      __setChatTab: function (key) {
        currentChatTab = key
      },
      __chatTabs: CHAT_TABS,
      /** 指定「現在在看哪一份對話」（測試用：正常入口是側邊欄點一列）。 */
      __selectChat: function (chat) {
        currentChat = chat
      },
      /** 讀回「現在在看哪一份對話」（測試用：驗改名之後座標有沒有換對）。 */
      __currentChat: function () {
        return currentChat
      },
      /**
       * 我們上一次要求的主面板（測試用）。
       *
       * ＋ 是不是「來回鍵」就靠這一格判斷，而 `layout.selectPanel` 只有 setter。
       */
      __shownPanel: function () {
        return shownPanel
      },
      /**
       * 驅動對話頁的載入（測試用）。
       *
       * 那一頁的載入住在 `useEffect`，假 React 不跑它——所以訊息列的測試要自己叫。
       * 還沒渲染過元件時回一個已完成的 Promise（呼叫端不必分辨）。
       */
      __loadChat: function () {
        return chatLoader === null ? Promise.resolve() : chatLoader()
      },
      /** 同上：讀「這一間房的用量」（那一列也只有 effect 會叫它）。 */
      __loadUsage: function () {
        return usageLoader === null ? Promise.resolve() : usageLoader()
      },
      /**
       * 房間那一頁「📖 藏書」的清單（測試用）。
       *
       * 同 `__loadChat`：載入住在 effect，假 React 不跑它——所以測試要自己叫。
       */
      __loadRoomBooks: function () {
        return roomBooksLoader === null ? Promise.resolve() : roomBooksLoader()
      },
      /**
       * 投影 → 那一列的形狀（純函式）。
       *
       * 一定要能單獨驗：那三個鍵的形狀來自 DSH 的投影單元，改版時這裡會先紅，
       * 而不是等到「使用者說那一列怎麼不見了」。
       */
      __usageOfProjections: usageOfProjections,
      /**
       * 匯出用的純函式。
       *
       * `spliceCardChunk` 是**跨面契約**的實作端：宿主半有一份對應的讀取端
       * （`lib/pngcard.js`），測試拿這裡產生的位元組交給那裡讀——只有 base64、
       * CRC 與 chunk 佈局全部正確才會一致。
       */
      __exportCard: {
        v3Card: v3Card,
        spliceCardChunk: spliceCardChunk,
        crc32: crc32,
      },
      __zones: TAVERN_ZONES,
      /**
       * 附件：挑檔案之後，一個檔案怎麼變成「送給模型的那一份」與「畫在訊息上的那一份」。
       *
       * 這幾支是**純函式**（不碰 React、不碰 state、不碰 FileReader），所以離線測得到
       * 完整的組裝邏輯——而「組錯」的症狀是**模型收到空的內容**或**畫出一顆點不開的
       * chip**，兩者都不會丟錯，只有驗得到形狀才擋得住。
       */
      __attach: {
        kindOf: attachmentKindOf,
        formatBytes: formatBytes,
        mediaOf: mediaOfAttachments,
        previewMediaOf: previewMediaOf,
        buildPromptContent: buildPromptContent,
        IMAGE_TYPES: ATTACHMENT_IMAGE_TYPES,
      },
      __notifyWorkspaceChanged: notifyWorkspaceChanged,
      /**
       * 模型與推理等級（純函式）。
       *
       * 這一組一定要能單獨驗：它原本整段住在 render 裡，而「目錄的形狀不如預期」在
       * 那裡是**整頁空白**（真的發生過，而且不只一次）。抽出來之後每一條規則都能釘住：
       * 用哪兩個欄位比對「現在選的是哪個」、等級什麼時候出現、換模型時等級怎麼收斂。
       */
      __model: {
        keyOf: modelKeyOf,
        findModel: findCatalogModel,
        labelOf: modelLabelOf,
        effortsOf: effortsOfModel,
        defaultEffortOf: defaultEffortOfModel,
        effectiveEffortOf: effectiveEffortOf,
        effortLabelOf: effortLabelOf,
        effortOptionsOf: effortOptionsOf,
        resolveEffortFor: resolveEffortFor,
        chipTextOf: chipTextOf,
      },
      // 給離線測試直接渲染用（座位的 props 有兩種進來的方式，只有這樣才測得到
      // 「拿不到原生工作區元件時」那條降級路徑）。
      __components: {
        TavernSidebarRegion: TavernSidebarRegion,
        TavernStreet: TavernStreet,
        TavernSettingsPage: TavernSettingsPage,
        TavernChatPage: TavernChatPage,
        AssetManager: AssetManager,
        ThinkingRow: ThinkingRow,
        /**
         * 酒館設定那一區（名字、圖示、persona、生成參數、**回覆格式**、
         * 以及那兩顆開關）。
         *
         * 匯出給測試：它有兩個「**送給 `props.commit` 的值**」要驗，
         * 而那些值不是 `rpc` 的參數（`commit` 才是送 rpc 的那一層）
         * ——驗 rpc 的那一條看不到它們。
         */
        MapTavernActions: MapTavernActions,
        /**
         * 📖 藏書那一區。匯出給測試：它有兩格位置選單（酒館層的預設、以及
         * 每一本書自己的），而**書那一格要顯示檔案裡的原始值**（沒指定時是
         * 空字串）——顯示算完的結果會讓使用者以為自己被改過了。
         */
        MapWorldbooks: MapWorldbooks,
        /**
         * 欄位那顆「?」的實作（`FieldLabel` ＋ 它的容器 `MapSelect`）。
         *
         * 匯出給測試：展開／收起是**模組層級的狀態**（不是 `useState`），
         * 而離線測試只看得到「第一次渲染」，所以「按了會展開」只能靠
         * 直接呼叫那個按鈕的 `onClick` 再重畫來驗。
         */
        MapSelect: MapSelect,
        FieldLabel: FieldLabel,
        /**
         * 房間那一頁「📖 藏書」。
         *
         * 匯出給測試：那一列有兩個入口要驗——**書名是「去改它」的連結**（按了要真的
         * 換分區又換面板）與「▸ 內容」是就地展開。清單載入靠 `__loadRoomBooks()`。
         */
        RoomBooksPane: RoomBooksPane,
      },
    }
    return module.exports
  },
})
