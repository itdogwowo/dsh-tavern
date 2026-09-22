/**
 * dsh-tavern 宿主半（v2：只有檔案）。
 *
 * 這裡**只做兩件事**：
 *   1. 酒館街的註冊表（有哪些酒館、目前在哪一間）
 *   2. 面板要用的檔案 API（人物卡／世界書／對話／設定檔的讀寫）
 *
 * 刻意移除的東西（v1 有，v2 全部拿掉）：
 *   - `settings` 命名空間與 schema（啟動時不再碰 settings 服務）
 *   - `agent/request` 覆寫與 `systemPrompt` 注入（不再介入模型請求）
 *   - `agents` 接管（不再掃描／掛載任何 agent）
 *   - 舊資料遷移、自動認養資料夾、顯示層正則引擎
 *
 * 為什麼：這些都是「DSH 一啟動就要跟核心服務打交道」的東西，任何一個卡住都會讓
 * 整個 `dsh web` 開不起來（使用者回報在 macOS 上安裝後 DSH 完全卡死）。
 * 現在宿主半只依賴 `webServer` 一個服務，其餘全是檔案 I/O。
 *
 * 所以：**任何需要模型／提示詞／agent 的功能，都應該做成另一個插件**，
 * 而不是塞回這裡。
 */
import { readFile, stat } from 'node:fs/promises'
import { TavernRegistry } from './registry.js'
import { SUBDIRS, unwrapCard, segmentFromName } from './workspace.js'
import { isPng, readCardFromPng } from './pngcard.js'
import { agentEntryPath, describePreset, ensurePreset, removePreset } from './preset.js'
import {
  ASSET_KINDS,
  IMAGE_TYPES,
  MAX_ASSET_BYTES,
  extensionOf,
  parseAssetOwner,
  deleteAsset,
  resolveAssetPath,
  writeAsset,
} from './assets.js'
import { fullTokens } from './theme.js'
import {
  MAX_ROOM_FILE_BYTES,
  deleteRoomFile,
  isInlineMedia,
  listRoomFiles,
  mimeTypeOf,
  resolveRoomFilePath,
  roomFileUrl,
  writeRoomFile,
} from './roomfiles.js'

/** 插件名稱。 */
export const name = 'dsh-tavern'

/** 宿主半只需要 webServer（要掛兩條 HTTP 路由）。 */
export const inject = ['webServer']

/**
 * 建置標記。
 *
 * 用途：DSH 的 client bundle 是**行程啟動時的快照**，所以「頁面上看到的是新是舊」
 * 很難判斷。把這個字串同時放在宿主半與 client 半，就能用 `tavern.list` 讀出宿主
 * 那半的版本，再跟磁碟上的值比對。
 */
export const TAVERN_BUILD = 'tavern-2.6.42'

/** 面板 RPC 路由。 */
const TAVERN_RPC_PATH = '/api/dsh-tavern/rpc'

/**
 * 插圖的讀取路由（`<img src>` 直接指這裡）。
 *
 * ⚠️ **結尾不可以有斜線。** `webServer` 的 prefix 比對是
 * `pathname === prefix || pathname.startsWith(prefix + '/')`；
 * 這裡若寫成 `/api/dsh-tavern/assets/`，比對就變成 `startsWith('...assets//')`，
 * 於是**永遠不成立**——路由註冊成功、卻一張圖都送不出去，
 * 而請求會落到 DSH 自己的 404（`text/plain`），看起來像「圖不存在」。
 *
 * 瀏覽器端要串 URL 用的前綴在 `assets.js` 的 `ASSET_ROUTE_PREFIX`，
 * 那個**必須**帶斜線。兩者刻意不同，不要合併。
 */
const TAVERN_ASSET_PATH = '/api/dsh-tavern/assets'

/**
 * 房間附件（`<room>/files/`）的讀取路由。
 *
 * 與 {@link TAVERN_ASSET_PATH} 同一個形狀、同一個理由（**結尾不可以有斜線**），
 * 差別只在它服務的是任意檔案而不是圖片。瀏覽器端要串 URL 用的前綴在
 * `roomfiles.js` 的 `ROOM_FILE_ROUTE_PREFIX`（那個**必須**帶斜線）。
 */
const TAVERN_FILE_PATH = '/api/dsh-tavern/files'

/**
 * 請求 body 上限（JSON 面板請求）。 */
const MAX_BODY_BYTES = 2_000_000

/**
 * 上傳圖片的上限，比 {@link MAX_ASSET_BYTES} 寬一點（表頭也要算進去），
 * 真正的檔案大小限制在 assets.js 裡判斷。
 */
const MAX_UPLOAD_BYTES = MAX_ASSET_BYTES + 100_000

/**
 * 這個位址字串是不是「本機」。
 *
 * 要處理的變體很多：`127.0.0.1`、`::1`、IPv4-mapped 的 `::ffff:127.0.0.1`
 * 與十六進位寫法 `::ffff:7f00:1`、以及使用者可能直接打 `localhost`。
 * 全部都是迴圈位址，所以都可以接受。
 */
function isLoopbackAddress(value) {
  const address = String(value ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (address === '') return false
  if (address === 'localhost' || address === '::1') return true
  if (address.startsWith('127.')) return true
  // IPv4-mapped IPv6：可能是點分十進位，也可能是十六進位（::ffff:7f00:1）。
  if (address.startsWith('::ffff:')) {
    const tail = address.slice('::ffff:'.length)
    if (tail.startsWith('127.')) return true
    if (tail.startsWith('7f')) return true
  }
  return false
}

/**
 * 來源圍籬：只接受「同一台機器、同一個來源」的請求。
 *
 * 為什麼需要它：DSH 的 `webServer` 服務**本身沒有任何來源檢查**（它只負責路由分派），
 * 所以 `POST /api/dsh-tavern/rpc` 預設是「任何連得到這個 port 的東西都能打」。
 * 而我們的 op 會**建立檔案**（`tavern.add`，路徑由呼叫端決定）、
 * **寫入檔案**（`assets.write`）、**刪除檔案**（`assets.delete`）。
 * 綁 `127.0.0.1` 只擋掉遠端，擋不掉「使用者自己開的另一個網頁」。
 *
 * 四項都檢查（照 dsh-portable-tavern 的 guard 做法），少一項就留一個繞過的縫：
 *   1. 連線來源必須是迴圈位址（這是最關鍵的一項——網頁沒辦法定這個）
 *   2. `Host` 也必須是迴圈位址（擋 DNS rebinding）
 *   3. `Sec-Fetch-Site` 不可以是 `cross-site`
 *   4. 有 `Origin` 時，它的 host 必須與 `Host` 相符
 *
 * **刻意留的遠端出口**：有些人真的會透過區網或 `dsh-webui-auth` 之類的插件從別的
 * 機器開這個介面，那時前三項必然不成立。設 `DSH_TAVERN_ALLOW_REMOTE=1` 可以放行
 * 非本機來源，但**第 3、4 項仍然有效**——也就是說別的網頁還是打不進來。
 * 這不是「關掉防護」，是「把防護從『只有本機』放寬成『只有同源』」。
 *
 * @returns 不通過時回傳原因字串，通過時回傳 null。
 */
export function originFenceFailure(req) {
  // 第 3、4 項不分遠近一律檢查。
  const site = String(req.headers?.['sec-fetch-site'] ?? '')
  if (site === 'cross-site') return '跨站請求被拒絕'

  const host = String(req.headers?.host ?? '')
  const origin = String(req.headers?.origin ?? '')
  if (origin !== '') {
    let parsed
    try {
      parsed = new URL(origin)
    } catch {
      return `Origin 無法解析（${origin}）`
    }
    if (parsed.host !== host) return 'Origin 與 Host 不相符'
  }

  // 同源已經確認過了；沒有要求「必須是本機」時就到這裡為止。
  if (String(process.env.DSH_TAVERN_ALLOW_REMOTE ?? '').trim() === '1') return null

  const remote = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? ''
  if (!isLoopbackAddress(remote)) {
    return `只接受本機連線（來源 ${remote === '' ? '未知' : remote}）；若你刻意從別的機器連，設 DSH_TAVERN_ALLOW_REMOTE=1`
  }

  const hostName = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  if (!isLoopbackAddress(hostName)) {
    return `Host 必須是本機位址（收到 ${host === '' ? '空的' : host}）`
  }

  if (origin !== '') {
    const originHostName = new URL(origin).hostname
    if (!isLoopbackAddress(originHostName)) return 'Origin 與 Host 不相符'
  }
  return null
}

/**
 * 掛載宿主半。
 * @param ctx - cordis context（已注入 webServer）
 */
export function apply(ctx) {
  const registry = TavernRegistry.fromEnv()

  /* ------------------------------ 小工具 ------------------------------ */

  const readBody = (req, options) =>
    new Promise((resolve, reject) => {
      const limit = typeof options?.limit === 'number' ? options.limit : MAX_BODY_BYTES
      const asBuffer = options?.binary === true
      const chunks = []
      let total = 0
      let done = false
      const finish = (fn, value) => {
        if (done) return
        done = true
        fn(value)
      }
      const finishReject = (error) => finish(reject, error)
      // 先看 content-length：大檔不必先收進記憶體才拒絕。
      const declared = Number(req.headers?.['content-length'] ?? '')
      if (Number.isFinite(declared) && declared > limit) {
        finishReject(new Error(`body too large（${String(declared)} > ${String(limit)}）`))
        req.destroy()
        return
      }
      req.on('data', (chunk) => {
        total += chunk.length
        if (total > limit) {
          finishReject(new Error(`body too large（超過 ${String(limit)} bytes）`))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        const buffer = Buffer.concat(chunks)
        finish(resolve, asBuffer ? buffer : buffer.toString('utf8'))
      })
      req.on('error', (error) => finishReject(error))
      // 連線被 client 中途關掉時也要收尾，否則這個 Promise 永遠不會 settle。
      req.on('close', () => finishReject(new Error('request aborted')))
    })

  const sendJson = (res, status, payload) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(payload))
  }

  /** 從查詢字串取一個參數（資產上傳用；body 是二進位，參數只能放 query）。 */
  const queryValue = (req, key) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const value = url.searchParams.get(key)
    return value === null ? '' : value
  }

  /** 把 `?kind=` 收斂成合法的資產種類。 */
  const assetKind = (req) => {
    const kind = queryValue(req, 'kind')
    if (!Object.prototype.hasOwnProperty.call(ASSET_KINDS, kind)) {
      throw new Error(`不認得的資產種類：${kind === '' ? '(空的)' : kind}`)
    }
    return kind
  }

  /** 同上，但给 JSON 請求用（種類放在 args 裡）。 */
  const requireAssetKind = (value) => {
    if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(ASSET_KINDS, value)) {
      throw new Error(`不認得的資產種類：${typeof value === 'string' && value !== '' ? value : '(空的)'}`)
    }
    return value
  }

  /** 讀一個 JSON body（面板請求都是 JSON）。 */
  const readJsonBody = async (req) => {
    const raw = await readBody(req)
    if (raw === '') return undefined
    return JSON.parse(raw)
  }

  /* ------------------------------ 插圖上傳 ------------------------------ */

  /**
   * 收下上傳的圖片並寫進 `art/`。
   *
   * 圖片用**二進位 body** 傳（不是 base64 JSON）：一張圖常常好幾 MB，
   * base64 會再多 33%，而且面板得先把整張圖轉成字串。種類、擁有者、檔名走
   * query string，因為 body 已經被檔案內容佔滿了。
   */
  const writeAssetFromRequest = async (req, args) => {
    const kind = assetKind(req)
    const owner = queryValue(req, 'owner')
    const found = await registry.requireById(args?.id)
    // 先看「本來有幾張圖」，再寫入——順序反過來的話這個判斷永遠是 false。
    const before = await found.workspace.describeEntityAssets(kind, owner)
    const bytes = await readBody(req, { binary: true, limit: MAX_UPLOAD_BYTES })
    const written = await writeAsset(found.workspace.root, kind, parseAssetOwner(kind, owner), {
      bytes,
      wantedName: queryValue(req, 'name'),
      overwrite: queryValue(req, 'overwrite') === '1',
    })
    // 只有「本來一張圖都沒有」時才自動指定主圖，不然上傳第二張會把主圖搶走。
    if (before.items.length === 0) {
      await found.workspace.setPrimaryAsset(kind, owner, written.name)
    }
    const listed = await found.workspace.describeEntityAssets(kind, owner)
    return { ...listed, written: written.name, renamed: written.renamed }
  }

  /**
   * 匯入角色卡（PNG 或 JSON）。
   *
   * 為什麼要有這條：真實世界的酒館卡**大多是一個 `.png`**，資料藏在 tEXt chunk 裡。
   * 只吃 JSON 等於「使用者從社群下載十張卡，十張都要先自己想辦法轉檔」。
   *
   * 檔案用二進位 body 傳（跟圖片上傳同一條路），因為 PNG 卡同時是圖片也是資料。
   * 行為：
   *   - 解析出卡片資料 → 寫成 `characters/<id>.json`（我們自己的儲存格式）
   *   - 如果是 PNG，**把原始 PNG 位元組留下來**（`originals/cards/`）：
   *     tEXt chunk 之外的位元組我們重建不出來，所以留下原檔才是真正無損
   *   - 把 PNG 本身當成這張卡的插圖（使用者要的那張圖就在這裡，不用再上傳一次）
   */
  const importCardFromRequest = async (req, args) => {
    const found = await registry.requireById(args?.id)
    const bytes = await readBody(req, { binary: true, limit: MAX_UPLOAD_BYTES })
    if (bytes.length === 0) throw new Error('沒有收到檔案內容')

    const wantedName = queryValue(req, 'name')
    const sourceIsPng = isPng(bytes)

    let card
    let keyword = ''
    if (sourceIsPng) {
      const parsed = readCardFromPng(bytes)
      card = unwrapCard(parsed.card)
      keyword = parsed.keyword
    } else {
      let parsed
      try {
        parsed = JSON.parse(bytes.toString('utf8'))
      } catch (error) {
        throw new Error(
          `這個檔案既不是 PNG 也不是合法 JSON（${String(error?.message ?? error)}）`,
        )
      }
      card = unwrapCard(parsed)
    }
    if (card.name === undefined || card.name === null || card.name === '') {
      // 沒有名字就沒有 id 可用；用檔名當後備，讓使用者至少能匯入。
      const fallback = queryValue(req, 'name').replace(/\.(png|json)$/i, '')
      if (fallback === '') throw new Error('這張卡沒有 name 欄位，也無法從檔名推導')
      card.name = fallback
    }

    const id = await found.workspace.writeCharacter('', card)

    // 原始位元組留一份（只有 PNG 需要——JSON 的文字就是資料本身，改寫不會失真）。
    let originalKept = false
    if (sourceIsPng) {
      originalKept = await found.workspace.keepCardOriginal(id, bytes)
    }

    // PNG 卡的那張圖就是它的插圖：直接放進這個角色的插圖資料夾。
    let artAdded = null
    if (sourceIsPng) {
      const written = await writeAsset(found.workspace.root, 'character', { id }, {
        bytes,
        wantedName: `${id}.png`,
      })
      artAdded = written.name
      const listed = await found.workspace.describeEntityAssets('character', id)
      if (listed.items.length === 1) {
        await found.workspace.setPrimaryAsset('character', id, written.name)
      }
    }

    return {
      id,
      name: typeof card.name === 'string' ? card.name : id,
      source: sourceIsPng ? `png:${keyword}` : 'json',
      originalKept,
      artAdded,
      requestedName: wantedName,
    }
  }

  /**
   * 匯入世界書檔案（`.json`）。
   *
   * 為什麼要這條：人物卡有「📥 匯入卡片」，世界書卻只能「＋ 新增世界書」生一本
   * 空白的——但世界書格式很多種（SillyTavern 的 uid 物件、卡內嵌的陣列、自訂），
   * 使用者手上通常已經有一本，手動貼進編輯器很折磨。跟卡片一樣走二進位 body。
   *
   * **不做任何欄位轉換**：解析成物件就原樣寫入，這是「原始 JSON 編輯器」的同一條原則。
   */
  const importWorldbookFromRequest = async (req, args) => {
    const found = await registry.requireById(args?.id)
    const bytes = await readBody(req, { binary: true, limit: MAX_UPLOAD_BYTES })
    if (bytes.length === 0) throw new Error('沒有收到檔案內容')

    let data
    try {
      data = JSON.parse(bytes.toString('utf8'))
    } catch (error) {
      throw new Error(`這不是合法 JSON（${String(error?.message ?? error)}）`)
    }
    if (data === null || typeof data !== 'object') throw new Error('世界書必須是 JSON 物件或陣列')
    // 陣列或 `{entries:…}` 才算世界書；其他形狀幾乎都是丟錯檔案，早點講清楚。
    const looksLikeBook =
      Array.isArray(data) || (data.entries !== undefined && data.entries !== null)
    if (!looksLikeBook) {
      throw new Error('這不像世界書（既不是陣列，也沒有 entries 欄位）')
    }

    // id 由**檔名**推導，不是由 `data.name`。
    //
    // `worldbook.write` 的內建推導會看 `data.name`，但那是 SillyTavern **內嵌**方言
    // 的欄位；**原生**世界書沒有 `name`（只有 `entries`），所以照那個走會得到
    // `worldbook-<時間>` 這種爛名字。檔名才是使用者認得的東西。
    const requested = queryValue(req, 'name').replace(/\.json$/i, '')
    const id = await found.workspace.writeWorldbook(segmentFromName(requested) || '', data)
    return { id, requestedName: queryValue(req, 'name') }
  }

  /**
   * 收下一個**附件**（使用者丟進對話裡的檔案或圖片）並寫進房間的 `files/`。
   *
   * 為什麼要存一份普通的：送給模型的那一份住在 DSH 的附件服務裡（使用者看不到、
   * 帶不走），而酒館的立場是「帶走這個資料夾就好」。所以同一份位元組在房間裡
   * 再放一份，訊息用 `extra.media` 指向它——重新整理之後畫得出來靠的就是它。
   *
   * 跟插圖上傳同一條路：**二進位 body**（base64 會再多 33%），參數放 query string，
   * 因為 body 已經被檔案內容佔滿了。
   */
  const writeRoomFileFromRequest = async (req, args) => {
    // ⚠️ 二進位 op 的 `args` 是 **undefined**（body 被檔案佔滿了），所以身分參數
    // 只能從 query string 讀——跟 `assets.write` 的 `kind`／`owner` 同一條規矩。
    const found = await registry.requireById(queryValue(req, 'id'))
    const character = queryValue(req, 'character')
    const room = await found.workspace.resolveRoom(character, queryValue(req, 'room'))
    const bytes = await readBody(req, { binary: true, limit: MAX_ROOM_FILE_BYTES + 100_000 })
    const written = await writeRoomFile(found.workspace.roomDir(character, room), {
      bytes,
      wantedName: queryValue(req, 'name'),
      overwrite: queryValue(req, 'overwrite') === '1',
    })
    return {
      character,
      room,
      name: written.name,
      bytes: written.bytes,
      renamed: written.renamed,
      url: roomFileUrl(character, room, written.name),
    }
  }

  /** 刪圖時，如果刪掉的正好是主圖，順手把主圖設定清掉（不留下指向空氣的設定）。 */
  const deleteAssetAndFixPrimary = async (args) => {
    const kind = typeof args?.kind === 'string' ? args.kind : ''
    if (!Object.prototype.hasOwnProperty.call(ASSET_KINDS, kind)) {
      throw new Error(`不認得的資產種類：${kind === '' ? '(空的)' : kind}`)
    }
    const ownerId = typeof args?.owner === 'string' ? args.owner : ''
    const name = typeof args?.name === 'string' ? args.name : ''
    const found = await registry.requireById(args?.id)
    const before = await found.workspace.describeEntityAssets(kind, ownerId)
    await deleteAsset(found.workspace.root, kind, parseAssetOwner(kind, ownerId), name)
    // 刪掉的正好是主圖時，把主圖改成還存在的那一張（而不是每次刪圖都寫一次設定）。
    //
    // ⚠️ 刪掉的是**最後一張**時 `after.primary` 是 `null`，這時要「清掉指定」而不是
    // 「指定 null」——後者會丟 `這個實體沒有這張圖：null`，而且是在**刪檔之後**才丟，
    // 於是檔案沒了、`tavern.json` 還指著它，面板繼續顯示一個不存在的主圖。
    // （這個 bug 是真的踩到的：用 API 刪掉店面圖之後 art/tavern/ 空了，
    //   tavern.json 的 assets 還留著檔名。）
    if (before.primary === name) {
      const after = await found.workspace.describeEntityAssets(kind, ownerId)
      if (typeof after.primary === 'string' && after.primary !== '') {
        await found.workspace.setPrimaryAsset(kind, ownerId, after.primary)
      } else {
        await found.workspace.clearPrimaryAsset(kind, ownerId)
      }
    }
    return found.workspace.describeEntityAssets(kind, ownerId)
  }

  /* ------------------------------ 路由表 ------------------------------ */

  const routes = {
    /* 酒館街 */
    'tavern.list': async () => {
      const listed = await registry.list()
      return { ...listed, build: TAVERN_BUILD, registryFile: registry.file, layout: SUBDIRS }
    },
    'tavern.add': async (args) => {
      const path = typeof args?.path === 'string' ? args.path.trim() : ''
      if (path === '') throw new Error('請提供資料夾路徑')
      const result = await registry.add(path, args?.name)
      return { ...(await registry.list()), created: result.created, skeleton: result.skeleton, added: result.tavern }
    },
    'tavern.remove': async (args) => {
      await registry.remove(args?.id)
      return registry.list()
    },
    'tavern.select': async (args) => {
      await registry.select(args?.id)
      return registry.list()
    },
    'tavern.update': async (args) => {
      await registry.update(args?.id, { name: args?.name, icon: args?.icon })
      return registry.list()
    },
    'tavern.rename': async (args) => {
      await registry.rename(args?.id, args?.name)
      return registry.list()
    },

    /**
     * 叫出作業系統的資料夾選擇器。
     * 只在「有人坐在這台機器前面」時可行（原生對話框）；遠端或沙箱擋住時
     * 回傳明確的訊息，面板會請使用者直接輸入路徑。
     */
    'tavern.pick': async () => {
      const picker = ctx.get('directoryPicker')
      if (picker === undefined) {
        return { path: null, reason: '這個部署沒有掛資料夾選擇器，請直接輸入路徑' }
      }
      let capability
      try {
        capability = picker.capability()
      } catch (error) {
        return { path: null, reason: `讀不到選擇器能力：${String(error?.message ?? error)}` }
      }
      if (capability?.kind !== 'native') {
        return { path: null, reason: '這個部署的選擇器不是原生對話框，請直接輸入路徑' }
      }
      try {
        const path = await capability.pick(new AbortController().signal)
        return { path: typeof path === 'string' && path !== '' ? path : null, reason: null }
      } catch (error) {
        return { path: null, reason: `開不了資料夾選擇器（${String(error?.message ?? error)}），請直接輸入路徑` }
      }
    },

    /* 目前酒館的概況 */
    workspace: async () => {
      const found = await registry.active()
      if (found === undefined) {
        const listed = await registry.list()
        return { root: '', name: '', exists: false, counts: {}, settings: null, layout: SUBDIRS, ...listed }
      }
      const summary = await found.workspace.summary()
      const settings = await found.workspace.readSettings()
      const listed = await registry.list()
      return { ...summary, settings, layout: SUBDIRS, ...listed }
    },

    /* 人物卡 */
    'character.list': async (args) => (await registry.requireById(args?.id)).workspace.listCharacters(),
    'character.read': async (args) => (await registry.requireById(args?.id)).workspace.readCharacter(args?.card),
    'character.write': async (args) =>
      (await registry.requireById(args?.id)).workspace.writeCharacter(args?.card ?? '', args?.payload),
    'character.delete': async (args) => (await registry.requireById(args?.id)).workspace.deleteCharacter(args?.card),
    /**
     * 開一張新卡。
     *
     * 面板的「＋ 新增角色」走這條——以前面板直接呼叫不存在的 `character.create`，
     * 結果那顆按鈕永遠回 `unknown op "character.create"`。寫入邏輯本身就在
     * `writeCharacter`（id 留空＝由卡片名稱推導檔名），所以這裡只負責給一個名字。
     */
    'character.create': async (args) => {
      const found = await registry.requireById(args?.id)
      const name = typeof args?.name === 'string' && args.name.trim() !== '' ? args.name.trim() : '新角色'
      const id = await found.workspace.writeCharacter('', { name })
      return { id, name }
    },
    /** 匯入卡片檔（PNG 或 JSON）；檔案用二進位 body 傳。 */
    'character.import': (args, req) => importCardFromRequest(req, args),

    /* 世界書 */
    'worldbook.list': async (args) => (await registry.requireById(args?.id)).workspace.listWorldbooks(),
    'worldbook.read': async (args) => (await registry.requireById(args?.id)).workspace.readWorldbook(args?.book),
    'worldbook.write': async (args) =>
      (await registry.requireById(args?.id)).workspace.writeWorldbook(args?.book ?? '', args?.payload),
    'worldbook.delete': async (args) => (await registry.requireById(args?.id)).workspace.deleteWorldbook(args?.book),
    /** 匯入世界書檔（.json）；檔案用二進位 body 傳。 */
    'worldbook.import': (args, req) => importWorldbookFromRequest(req, args),

    /* 酒館模式自己的 preset（使用者第一次要開對話時才裝，不在啟動時裝） */
    'preset.ensure': async (args) =>
      ensurePreset({
        dshHome: args?.dshHome,
        entry: agentEntryPath(import.meta.url),
        config: args?.config,
      }),
    'preset.status': async (args) => describePreset({ dshHome: args?.dshHome }),
    'preset.remove': async (args) => removePreset({ dshHome: args?.dshHome }),

    /* 對話紀錄 */
    /* ------------------- 對話（現在是「房間」的相容層）-------------------
     *
     * ⚠️ 這一組 op 收的是舊形狀的參數（`chat` ＝ **顯示名稱**），但實際操作的是
     * **房間資料夾**（`chats/<角色>/<roomId>/`，見 `docs/room-layout.md`）。
     *
     * 為什麼不直接把 op 換成 `room.*` 再改客戶端：客戶端有 19 個呼叫點，改一半就是
     * 「新建的房間打不開」——那不是紅的測試，是壞掉的介面。所以讓這裡兩種都收
     * （`resolveRoom` 先當 id、再當名稱），客戶端可以之後再切，而且**全程可用**。
     *
     * ⚠️ **這一組現在是純粹的別名**（與 `room.*` 等價），而且**只剩命名衛生問題**：
     * 危險的那一半（`resolveRoom` 收「顯示名稱」）已經在 2.6.7 拿掉了——現在送名字
     * 會**明確報錯**，不會默默寫進第一間同名房。
     *
     * 要收掉它得改 **約 70 處**（`lib/client.js` 15 ＋ `test-client.mjs` 43 ＋ `smoke.mjs` 12），
     * 所以不急：它不影響行為，只影響「同一個東西有兩組名字」。要做的話當成一次專門的
     * 掃描（測試就是安全網），不要順手夾帶。
     */
    // ⚠️ `chat.list` **不帶角色**（它列這間酒館的全部對話），所以接的是
    // `listAllRooms()`——那一支從 2.6.6 起就是「列出所有角色的房間」。`room.list` 才是
    // 按角色列（給未來的客戶端用）。
    'chat.list': async (args) => (await registry.requireById(args?.id)).workspace.listAllRooms(),
    'chat.create': async (args) =>
      (await registry.requireById(args?.id)).workspace.createRoom(args?.character, args?.name),
    'chat.delete': async (args) => {
      const found = await registry.requireById(args?.id)
      const room = await found.workspace.resolveRoom(args?.character, args?.chat)
      return found.workspace.deleteRoom(args?.character, room)
    },
    /**
     * 改一間房的名字。
     *
     * ⚠️ 房間的改名**只改 `room.json` 裡的 `name`，不動任何路徑**（那正是房間用 id
     * 當身分的目的）。回傳形狀與舊版一致，客戶端拿它當「目前這一份」用。
     */
    'chat.rename': async (args) => {
      const found = await registry.requireById(args?.id)
      const room = await found.workspace.resolveRoom(args?.character, args?.chat)
      const next = await found.workspace.writeRoom(args?.character, room, { name: args?.name })
      return {
        character: args?.character,
        room: room,
        name: next.name,
        file: `${room}/chat.jsonl`,
        previous: args?.chat,
        sessionIds: [],
      }
    },
    'chat.append': async (args) => {
      const found = await registry.requireById(args?.id)
      const room = await found.workspace.resolveRoom(args?.character, args?.chat)
      return found.workspace.appendRoomMessages(args?.character, room, args?.messages)
    },
    'chat.messages': async (args) => {
      const found = await registry.requireById(args?.id)
      const room = await found.workspace.resolveRoom(args?.character, args?.chat)
      return found.workspace.readRoomMessages(args?.character, room)
    },

    /* ------------------------------- 房間 -------------------------------
     *
     * 一間房＝一個資料夾（`chats/<角色>/<roomId>/`，見 `docs/room-layout.md`）。
     *
     * ⚠️ 這些是**新增**的 op，不是把上面的 `chat.*` 改掉：客戶端還在用舊的，
     * 一次只換一層。等客戶端切過來（階段 4）再把舊的拆掉（階段 5）——反過來做的話，
     * 中間那段時間介面是壞的。
     */
    /**
     * 列出房間。**帶角色就只列那個角色，不帶就列整間酒館的。**
     *
     * 為什麼讓角色參數可省略：客戶端要的那一份是「整間酒館的對話」（側邊欄／大廳／
     * 卡司的清單都是），而 `room.list` 原本只能按角色列——那正是 6b（拿掉 `chat.*`
     * 相容層）卡住的地方：沒有「列全部」的入口，客戶端就切不過去。
     *
     * ⚠️ 不帶角色時走的是 `listAllRooms()`（2.6.6 之前叫 `listChats`——名字是舊的，
     * 角色的房間」），6b 收尾時應該一起改名成 `listAllRooms`。
     */
    'room.list': async (args) => {
      const found = await registry.requireById(args?.id)
      return typeof args?.character === 'string' && args.character !== ''
        ? found.workspace.listRooms(args.character)
        : found.workspace.listAllRooms()
    },
    'room.create': async (args) =>
      (await registry.requireById(args?.id)).workspace.createRoom(args?.character, args?.name),
    'room.read': async (args) =>
      (await registry.requireById(args?.id)).workspace.readRoom(args?.character, args?.room),
    'room.write': async (args) =>
      (await registry.requireById(args?.id)).workspace.writeRoom(
        args?.character,
        args?.room,
        args?.patch,
      ),
    'room.rename': async (args) =>
      (await registry.requireById(args?.id)).workspace.renameRoom(
        args?.character,
        args?.room,
        args?.name,
      ),
    'room.delete': async (args) =>
      (await registry.requireById(args?.id)).workspace.deleteRoom(args?.character, args?.room),
    'room.messages': async (args) =>
      (await registry.requireById(args?.id)).workspace.readRoomMessages(args?.character, args?.room),
    'room.append': async (args) =>
      (await registry.requireById(args?.id)).workspace.appendRoomMessages(
        args?.character,
        args?.room,
        args?.messages,
      ),

    /* 對話 ↔ DSH session 的對照表（Agent 面靠它認出「這個 session 是誰」） */
    'session.bind': async (args) => {
      const found = await registry.requireById(args?.id)
      const record = await found.workspace.bindSession(args?.sessionId, {
        character: args?.character,
        chat: args?.chat,
      })
      // 順手把 session id 蓋進對話檔的標頭。這是**第二個地方記同一件事**，但是刻意的：
      // 對照表是索引（可以重建），對話檔裡的 `dsh_session_id` 才是跟著檔案走的那一份。
      // 蓋不進去不算失敗——有些對話檔是使用者從別的地方放進來的，格式不一定合。
      const stamped = await found.workspace
        .stampChatSessionId(record.character, record.chat, record.sessionId)
        .catch(() => false)
      return { ...record, stamped }
    },
    'session.read': async (args) => (await registry.requireById(args?.id)).workspace.readSession(args?.sessionId),
    'session.list': async (args) => (await registry.requireById(args?.id)).workspace.listSessionBindings(),
    'session.unbind': async (args) => {
      const found = await registry.requireById(args?.id)
      return { removed: await found.workspace.unbindSession(args?.sessionId) }
    },
    /** 索引掉了就重建（真相在每個 `.jsonl` 的標頭裡）。 */
    'session.rebuild': async (args) => {
      const found = await registry.requireById(args?.id)
      return { rebuilt: await found.workspace.rebuildSessionBindings() }
    },

    /* 這間酒館的主題（theme.json）：整包帶走時外觀跟著走 */
    /**
     * 讀這間酒館的主題。
     *
     * 回應裡**附上完整的預設 token 表**（`defaults`）：客戶端 bundle 沒有 ESM
     * import，拿不到 `lib/theme.js`，所以預設值只能由宿主給——這樣「預設色票」
     * 就只有一個來源，不會有兩份走散。
     */
    'theme.read': async (args) => {
      const found = await registry.requireById(args?.id)
      const read = await found.workspace.readTheme()
      return {
        ...read,
        // 「裝修」的逃生口：token 改不到的形狀／材質寫在 custom.css。
        // 原樣送出，客戶端負責用 `@scope` 包起來（宿主不解析 CSS）。
        customCss: await found.workspace.readCustomCss(),
        defaults: fullTokens(read.theme.base),
        lightDefaults: fullTokens('light'),
      }
    },
    'theme.write': async (args) =>
      (await registry.requireById(args?.id)).workspace.writeTheme(args?.patch),

    /* 這間酒館自己的設定檔（tavern.json） */
    'settings.read': async (args) => (await registry.requireById(args?.id)).workspace.readSettings(),
    'settings.write': async (args) => (await registry.requireById(args?.id)).workspace.writeSettings(args?.patch ?? {}),

    /* 插圖：清單／指定主圖／刪除（上傳走 assets.write 那條二進位路徑） */
    'assets.list': async (args) => {
      const kind = requireAssetKind(args?.kind)
      const found = await registry.requireById(args?.id)
      return found.workspace.describeEntityAssets(kind, args?.owner)
    },
    'assets.write': (args, req) => writeAssetFromRequest(req, args),
    'assets.primary': async (args) => {
      const kind = requireAssetKind(args?.kind)
      const found = await registry.requireById(args?.id)
      const wanted = typeof args?.name === 'string' ? args.name : ''
      // 空字串＝清掉指定，回到「第一張」。一定要接住這個情況，不然面板就沒有
      // 任何方法取消主圖（而且會拿到一個看起來像 bug 的錯誤）。
      if (wanted !== '') await found.workspace.setPrimaryAsset(kind, args?.owner, wanted)
      else await found.workspace.clearPrimaryAsset(kind, args?.owner)
      return found.workspace.describeEntityAssets(kind, args?.owner)
    },
    'assets.delete': (args) => deleteAssetAndFixPrimary(args),

    /* 房間的附件（使用者丟進對話裡的檔案／圖片）——上傳走 file.write 那條二進位路徑 */
    'file.list': async (args) => {
      const found = await registry.requireById(args?.id)
      const character = typeof args?.character === 'string' ? args.character : ''
      const room = await found.workspace.resolveRoom(character, args?.room)
      const items = await listRoomFiles(found.workspace.roomDir(character, room))
      return items.map((item) => ({
        ...item,
        // 只有點陣圖算「圖片」（訊息裡畫得出來）；SVG 一律當檔案（下載，不 inline）。
        type: isInlineMedia(mimeTypeOf(item.name)) ? 'image' : 'file',
        url: roomFileUrl(character, room, item.name),
      }))
    },
    'file.write': (args, req) => writeRoomFileFromRequest(req, args),
    'file.delete': async (args) => {
      const found = await registry.requireById(args?.id)
      const character = typeof args?.character === 'string' ? args.character : ''
      const room = await found.workspace.resolveRoom(character, args?.room)
      return { name: await deleteRoomFile(found.workspace.roomDir(character, room), args?.name) }
    },
  }

  /* ------------------------------ 掛路由 ------------------------------ */

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: TAVERN_RPC_PATH,
      handler: async (req, res) => {
        // 圍籬先於一切：來源不對就直接拒絕，連 body 都不讀。
        const fenced = originFenceFailure(req)
        if (fenced !== null) {
          sendJson(res, 403, { ok: false, error: fenced })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const op = url.searchParams.get('op') ?? ''
        const handler = routes[op]
        if (handler === undefined) {
          sendJson(res, 404, { ok: false, error: `unknown op "${op}"` })
          return
        }
        try {
          // 這幾個 op 的 body 是檔案本身（圖片、PNG 卡、世界書檔、房間附件），
          // 不能先當 JSON 解析。
          const binary =
            op === 'assets.write' ||
            op === 'character.import' ||
            op === 'worldbook.import' ||
            op === 'file.write'
          const args = binary ? undefined : await readJsonBody(req)
          sendJson(res, 200, { ok: true, value: await handler(args, req) })
        } catch (error) {
          // 一律回 200 + ok:false：面板只要看 ok 欄位，不用分辨 HTTP 狀態。
          sendJson(res, 200, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })
    return dispose
  }, 'dsh-tavern: rpc route')

  /* ------------------------------ 插圖讀取 ------------------------------ */

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: TAVERN_ASSET_PATH,
      handler: async (req, res) => {
        // 讀圖也套圍籬：圖片是使用者的私人內容，不該被同機的其他網頁讀走。
        const fenced = originFenceFailure(req)
        if (fenced !== null) {
          sendJson(res, 403, { ok: false, error: fenced })
          return
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const segments = url.pathname
            .slice(TAVERN_ASSET_PATH.length)
            .split('/')
            .filter((part) => part !== '')
            .map((part) => decodeURIComponent(part))
          const active = await registry.active()
          if (active === undefined) {
            sendJson(res, 404, { ok: false, error: '還沒有選定酒館' })
            return
          }
          // 逐段驗證後才組路徑；`..` 之類的跳脫在 resolveAssetPath 裡被擋下，
          // 這裡拿到的絕對路徑保證在 art/ 底下。
          const absolute = resolveAssetPath(active.workspace.root, segments)
          const info = await stat(absolute).catch(() => undefined)
          if (info === undefined || !info.isFile()) {
            sendJson(res, 404, { ok: false, error: 'not found' })
            return
          }
          const extension = extensionOf(absolute)
          const type = IMAGE_TYPES[extension] ?? 'application/octet-stream'
          // etag 用大小 + mtime：換圖就換 URL 內容，前端可以直接沿用快取。
          const etag = `W/"${String(info.size)}-${String(Math.floor(info.mtimeMs))}"`
          if (req.headers?.['if-none-match'] === etag) {
            res.writeHead(304, { etag })
            res.end()
            return
          }
          res.writeHead(200, {
            'content-type': type,
            'content-length': String(info.size),
            'cache-control': 'private, max-age=0, must-revalidate',
            etag,
            // 圖片是使用者自己的檔案：不要讓瀏覽器猜型別（避免 SVG/HTML 被當文件執行）。
            'x-content-type-options': 'nosniff',
            'content-disposition': 'inline',
          })
          res.end(req.method === 'HEAD' ? undefined : await readFile(absolute))
        } catch (error) {
          sendJson(res, 404, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })
    return dispose
  }, 'dsh-tavern: assets route')

  /* ------------------------------ 附件讀取 ------------------------------ */

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: TAVERN_FILE_PATH,
      handler: async (req, res) => {
        // 附件是使用者的私人檔案，跟插圖同一條規矩：套圍籬，不讓同機的其他網頁讀走。
        const fenced = originFenceFailure(req)
        if (fenced !== null) {
          sendJson(res, 403, { ok: false, error: fenced })
          return
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const segments = url.pathname
            .slice(TAVERN_FILE_PATH.length)
            .split('/')
            .filter((part) => part !== '')
            .map((part) => decodeURIComponent(part))
          const active = await registry.active()
          if (active === undefined) {
            sendJson(res, 404, { ok: false, error: '還沒有選定酒館' })
            return
          }
          const absolute = resolveRoomFilePath(active.workspace.root, segments)
          const info = await stat(absolute).catch(() => undefined)
          if (info === undefined || !info.isFile()) {
            sendJson(res, 404, { ok: false, error: 'not found' })
            return
          }
          const type = mimeTypeOf(absolute)
          const etag = `W/"${String(info.size)}-${String(Math.floor(info.mtimeMs))}"`
          if (req.headers?.['if-none-match'] === etag) {
            res.writeHead(304, { etag })
            res.end()
            return
          }
          res.writeHead(200, {
            'content-type': type,
            'content-length': String(info.size),
            'cache-control': 'private, max-age=0, must-revalidate',
            etag,
            // ⚠️ 這裡是使用者丟進來的任意檔案（可能是 HTML 或 SVG）。`nosniff` 加上
            // 明確的 content-type 讓瀏覽器不會「猜」成文件去執行它；而且**只有點陣圖**
            // inline（`isInlineMedia`——SVG **不算**：它的 script 會在這個 origin 上跑），
            // 其餘一律下載。
            'x-content-type-options': 'nosniff',
            'content-disposition': isInlineMedia(type) ? 'inline' : 'attachment',
          })
          res.end(req.method === 'HEAD' ? undefined : await readFile(absolute))
        } catch (error) {
          sendJson(res, 404, { ok: false, error: String(error?.message ?? error) })
        }
      },
    })
    return dispose
  }, 'dsh-tavern: room files route')

  ctx.logger?.info?.('dsh-tavern: 酒館模式已載入（只有檔案與 UI，v2）')
}
