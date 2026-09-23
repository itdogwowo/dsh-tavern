/**
 * dsh-tavern 宿主半的煙霧測試：不需要 DSH，直接把插件掛在假 ctx 上跑一遍。
 *
 * v2 的宿主半只依賴 `webServer` 一個服務，所以這裡驗的就是那兩條路由：
 *   1. 掛載時註冊了 RPC 與檔案路由（而且 inject 只有 webServer）
 *   2. **新增酒館會在選定的資料夾裡建立結構**（characters/worldbooks/chats/art
 *      + tavern.json + README.txt）——這是這個版本唯一會寫入的邏輯
 *   3. 沒有酒館時的操作會給出可行動的錯誤，而不是卡住
 *   4. 酒館街不會自動冒出任何酒館
 *
 * 用法：node smoke.mjs
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTextChunks } from './lib/pngcard.js'

// 註冊表放在 DSH home；測試一律用暫存 home，才不會碰到使用者真的酒館街。
const home = mkdtempSync(join(tmpdir(), 'tavern-smoke-home-'))
const shop = mkdtempSync(join(tmpdir(), 'tavern-smoke-shop-'))
process.env.DSH_HOME = home

const tavern = await import('./lib/index.js')

const calls = { effects: [], routes: [] }

/** 一個夠用的假 Context（只有 webServer，v2 不需要別的服務）。 */
function makeCtx() {
  return {
    logger: { info() {}, warn() {} },
    effect(fn, label) {
      calls.effects.push(label)
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    get(name) {
      if (name === 'directoryPicker') return undefined
      return undefined
    },
  }
}

const ctx = makeCtx()
ctx.webServer = {
  register(route) {
    calls.routes.push(route)
    return () => {}
  },
}

/* --- 1. 掛載 -------------------------------------------------------------- */
tavern.apply(ctx)
assert.deepEqual(tavern.inject, ['webServer'], '宿主半只應該依賴 webServer（其餘全是檔案 I/O）')
const rpcRoute = calls.routes.find((route) => route.path === '/api/dsh-tavern/rpc')
const assetRoute = calls.routes.find((route) => route.path === '/api/dsh-tavern/assets')
// 附件（房間的 `files/`）是**第二條** prefix 路由，形狀與插圖那條一樣。
const fileRoute = calls.routes.find((route) => route.path === '/api/dsh-tavern/files')
assert.ok(rpcRoute !== undefined, 'RPC 路由應已註冊')
assert.equal(rpcRoute.kind, 'exact')
assert.ok(assetRoute !== undefined, '插圖路由應已註冊')
assert.ok(fileRoute !== undefined, '附件路由應已註冊')
assert.equal(fileRoute.kind, 'prefix')
// 回歸守衛：`webServer` 的 prefix 比對是
//   pathname === prefix || pathname.startsWith(prefix + '/')
// 註冊字串結尾若多一個斜線，比對就變成 `startsWith('…assets//')`，
// 於是路由註冊成功、卻永遠比對不到（所有插圖靜默 404）。
// 這裡用真正會出現的資產 URL 形狀驗一次，而不是只比字串。
const prefixMatches = (prefix, pathname) => pathname === prefix || pathname.startsWith(prefix + '/')
assert.ok(
  prefixMatches(assetRoute.path, '/api/dsh-tavern/assets/characters/角色/立繪.png'),
  '插圖路由的註冊路徑要能比對到真實的資產 URL（結尾多一個斜線就會永遠比對不到）',
)
assert.equal(assetRoute.kind, 'prefix')
// 附件路由（`/api/dsh-tavern/files`）是同一個形狀、同一個陷阱——一起釘住。
assert.ok(
  prefixMatches(fileRoute.path, '/api/dsh-tavern/files/角色/room-1/a.txt'),
  '附件路由的註冊路徑要能比對到真實的附件 URL（結尾多一個斜線就會永遠比對不到）',
)
console.log('1. 掛載 OK — inject =', JSON.stringify(tavern.inject), '/ 兩條路由都在')

/**
 * 一個「來自本機瀏覽器」的假請求。
 *
 * 圍籬（`originFenceFailure`）會看 socket.remoteAddress 與 Host 標頭，
 * 所以測試的請求必須像真的從 127.0.0.1 打進來——這也讓「正常使用」與
 * 「被別的網頁打」在測試裡是同一條路徑上的兩種輸入，而不是兩套程式碼。
 *
 * @param overrides - 要覆寫的欄位（測試圍籬時用）
 */
function localRequest(method, url, headers, overrides) {
  return Object.assign(
    {
      method,
      url,
      headers: Object.assign({ host: '127.0.0.1:3080' }, headers ?? {}),
      socket: { remoteAddress: '127.0.0.1' },
      on() {},
      destroy() {},
    },
    overrides ?? {},
  )
}

/**
 * 走真正的 HTTP 路由，而不是直接呼叫內部函式。
 * @param payload - 字串（JSON）或 Buffer（二進位；給圖片上傳用）
 */
async function callRpc(op, payload, options) {
  const options2 = options ?? {}
  const query = options2.query ?? ''
  const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload ?? {}))
  const declared = options2.contentLength === undefined ? raw.length : options2.contentLength
  const res = {
    status: 0,
    body: '',
    headers: {},
    writeHead(status, headers) {
      res.status = status
      if (headers !== undefined) res.headers = headers
    },
    end(body) {
      res.body = body === undefined ? '' : body
    },
  }
  await rpcRoute.handler(
    localRequest('POST', '/api/dsh-tavern/rpc?op=' + op + query, { 'content-length': String(declared) }, {
      on(event, handler) {
        if (event === 'data') handler(raw)
        if (event === 'end') handler()
      },
    }),
    res,
  )
  if (Buffer.isBuffer(res.body)) return res.body
  return JSON.parse(res.body)
}

/** 一張最小但「真的是 PNG」的圖（magic bytes 正確，長度可調）。 */
function pngBytes(padding = 8) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([header, Buffer.alloc(padding, 0x42)])
}

/** 直接讀插圖路由。 */
async function fetchAsset(path, headers) {
  const res = {
    status: 0,
    body: undefined,
    headers: {},
    writeHead(status, next) {
      res.status = status
      if (next !== undefined) res.headers = next
    },
    end(body) {
      res.body = body
    },
  }
  await assetRoute.handler(localRequest('GET', '/api/dsh-tavern/assets/' + path, headers), res)
  return res
}

/** 直接讀附件路由。 */
async function fetchRoomFile(path, headers) {
  const res = {
    status: 0,
    body: undefined,
    headers: {},
    writeHead(status, next) {
      res.status = status
      if (next !== undefined) res.headers = next
    },
    end(body) {
      res.body = body
    },
  }
  await fileRoute.handler(localRequest('GET', '/api/dsh-tavern/files/' + path, headers), res)
  return res
}

/** CRC32（PNG chunk 用）。測試自己算，才不用為了造一張卡而引入套件。 */
function crc32(buffer) {
  let crc = ~0
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (~crc) >>> 0
}

/** 組一個 PNG chunk：長度 + 型別 + 資料 + CRC。 */
function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuffer = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, crc])
}

/** 組一個 tEXt chunk（keyword\0text）。 */
function textChunk(keyword, value) {
  return pngChunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')]))
}

/**
 * 造一張「真的有內嵌卡片資料」的 PNG。
 * @param entries - `[keyword, json物件或原始字串]` 的陣列
 */
function pngCard(entries) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
  ]
  for (const [keyword, payload] of entries) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    parts.push(textChunk(keyword, Buffer.from(text, 'utf8').toString('base64')))
  }
  parts.push(pngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

/* --- 2. 酒館街一開始是空的 ------------------------------------------------ */
{
  const listed = await callRpc('tavern.list')
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.value.taverns, [], '不應該自動建立任何酒館')
  assert.equal(listed.value.activeId, '')
  assert.equal(listed.value.build, tavern.TAVERN_BUILD, 'list 要回報宿主半的建置標記')
  console.log('2. 酒館街 OK — 空的，不自動建立（build =', listed.value.build + '）')
}

/* --- 3. 沒有酒館時的操作要給可行動的錯誤 --------------------------------- */
{
  const workspace = await callRpc('workspace')
  assert.equal(workspace.ok, true)
  assert.equal(workspace.value.exists, false)
  const characters = await callRpc('character.list')
  assert.equal(characters.ok, false, '沒有酒館時讀人物卡應該失敗')
  assert.ok(characters.error.includes('酒館街'), '錯誤訊息要告訴使用者去哪裡選資料夾')
  const unknown = await callRpc('nope')
  assert.equal(unknown.ok, false, '未知的 op 應該失敗')
  assert.ok(unknown.error.includes('unknown op'), '要說清楚是哪個 op 不認識')
  console.log('3. 沒有酒館時 OK —', characters.error)
}

/* --- 4. 新增酒館＝在選定的資料夾裡建立結構 -------------------------------- */
{
  const added = await callRpc('tavern.add', { path: shop })
  assert.equal(added.ok, true, '新增應該成功：' + added.error)
  assert.equal(added.value.created, true, '第一次新增')
  assert.equal(added.value.taverns.length, 1)
  assert.equal(added.value.activeId, added.value.added.id, '新增後直接切換過去')

  // 這一步就是 v2 的核心：資料夾裡真的多了東西。
  for (const part of ['characters', 'worldbooks', 'chats', 'art']) {
    assert.equal(existsSync(join(shop, part)), true, `應該建立 ${part}/`)
  }
  assert.equal(existsSync(join(shop, 'tavern.json')), true, '應該建立 tavern.json')
  assert.equal(existsSync(join(shop, 'README.txt')), true, '應該建立 README.txt')
  const settings = JSON.parse(readFileSync(join(shop, 'tavern.json'), 'utf8'))
  assert.equal(settings.version, 1)

  // 新建酒館不該是空的：附一位老闆娘、一本世界書、以及**輸出格式**（使用者要求）。
  // ⚠️ 預設角色是 **PNG 卡**（`characters/老闆娘.png`，提示詞住在 `ccv3` 裡）——
  // 使用者：「留意他的提示詞要寫進 PNG 卡片當中」。
  assert.equal(existsSync(join(shop, 'characters', '老闆娘.png')), true, '應該附一張老闆娘（PNG 卡）')
  assert.equal(
    existsSync(join(shop, 'characters', '老闆娘.json')),
    false,
    'PNG 卡就是卡，不要再寫一份 JSON（兩份真相）',
  )
  assert.equal(existsSync(join(shop, 'worldbooks', '酒館.json')), true, '應該附一本世界書')
  assert.equal(existsSync(join(shop, 'worldbooks', '輸出格式.json')), true, '應該附輸出格式（預設，不是選配）')
  // 房間的 id 是隨機的 → 先挑出來，其餘照順序比對。
  const seededRoom = added.value.skeleton.filter((item) => /^chats\//.test(item))
  assert.equal(seededRoom.length, 1, '新酒館要附一間可以直接聊的房間：' + added.value.skeleton.join(' '))
  assert.match(seededRoom[0], /^chats\/老闆娘\/[a-z0-9]+-[a-z0-9]+\/chat\.jsonl$/, seededRoom[0])
  assert.deepEqual(
    added.value.skeleton.filter((item) => !/^chats\//.test(item)).sort(),
    ['characters/老闆娘.png', 'custom.css', 'worldbooks/輸出格式.json', 'worldbooks/酒館.json'],
    'skeleton 要回報實際建立了什麼：' + added.value.skeleton.join(' '),
  )
  // 預設房間裡要有開場白（卡片的 first_mes），不然「可以直接聊」是假的。
  const roomId = seededRoom[0].split('/')[2]
  const seededChat = readFileSync(join(shop, 'chats', '老闆娘', roomId, 'chat.jsonl'), 'utf8')
  assert.match(seededChat, /銅鈴/, '預設房間要有一則開場白（老闆娘的 first_mes）')
  // 預設角色的圖就是那張卡片本身：`character.list` 要把它當成主圖回報（頭像、海報牆靠它）。
  const seededCards = (await callRpc('character.list', {})).value
  assert.equal(seededCards.length, 1, '清單要有一張卡')
  assert.equal(seededCards[0].file, '老闆娘.png', '卡片檔案是 PNG（不是 .json）')
  assert.equal(seededCards[0].name, '老闆娘', '名字從 PNG 裡的卡片讀出來')
  assert.equal(seededCards[0].assets.primary, '老闆娘.png', '卡片本體就是主圖')
  assert.equal(
    seededCards[0].assets.items[0].source,
    'card',
    '卡片本體在清單裡要標成 card（不是插圖，客戶端不給刪）',
  )
  // 「裝修」的入口要在新酒館裡就看得到：一份**整份註解掉**的 custom.css 範本
  // （沒有任何生效的規則，所以附了不會改變外觀）。
  const cssTemplate = readFileSync(join(shop, 'custom.css'), 'utf8')
  assert.match(cssTemplate, /custom\.css/, '範本要說明自己是什麼')
  assert.match(cssTemplate, /\.dsh-tv-bubble/, '範本要列出常用類別（不然使用者不知道要寫什麼）')
  assert.deepEqual(
    cssTemplate
      .split('\n')
      .filter((line) => line.trim() !== '')
      .filter((line) => !/^\s*(\/\*|\*)/.test(line)),
    [],
    '範本裡不可以有生效的規則（附了就不該改變外觀）',
  )
  console.log('4. 新增酒館 OK — 建立', added.value.skeleton.join(' '))

  // 同一條路徑再加一次不會重複、也不會重建。
  const again = await callRpc('tavern.add', { path: shop })
  assert.equal(again.value.created, false, '同一條路徑不重複加入')
  assert.equal(again.value.taverns.length, 1)
  assert.deepEqual(again.value.skeleton, [], '已經存在的結構不會重建')
  console.log('4b. 重複加入 OK — 只切換，不重複建立')
}

/* --- 5. 檔案 API --------------------------------------------------------- */
{
  const listed = await callRpc('character.list')
  assert.equal(listed.ok, true)
  // 新建酒館已經附了老闆娘，所以這裡不是空的——但只有那一張。
  assert.deepEqual(
    listed.value.map((item) => item.id),
    ['老闆娘'],
    '新酒館應該只有預設的那張卡',
  )

  const written = await callRpc('character.write', { payload: { name: '測試角色', description: '嗨' } })
  assert.equal(written.ok, true, '寫入應該成功：' + written.error)
  assert.equal(written.value, '測試角色', 'id 由 name 推導')

  const read = await callRpc('character.read', { card: '測試角色' })
  assert.equal(read.value.description, '嗨')
  assert.equal(existsSync(join(shop, 'characters', '測試角色.json')), true, '檔案真的在資料夾裡')

  const book = await callRpc('worldbook.write', { payload: { name: '測試世界', entries: {} } })
  assert.equal(book.value, '測試世界')
  assert.equal(existsSync(join(shop, 'worldbooks', '測試世界.json')), true)

  const chat = await callRpc('room.create', { character: '測試角色', name: '初次見面' })
  assert.equal(chat.ok, true, '開新對話應該成功：' + chat.error)
  // 房間＝一個資料夾（`chats/<角色>/<roomId>/`），**身分是 id、不是名字**
  // ——那正是這個佈局的目的（改名不用搬任何東西）。見 docs/room-layout.md。
  assert.equal(typeof chat.value.room, 'string', '建立要回房間 id')
  assert.equal(chat.value.name, '初次見面', '顯示名稱是使用者給的那個')
  assert.equal(
    existsSync(join(shop, 'chats', '測試角色', chat.value.room, 'chat.jsonl')),
    true,
    '對話檔在房間資料夾裡',
  )
  assert.equal(
    existsSync(join(shop, 'chats', '測試角色', chat.value.room, 'room.json')),
    true,
    '房間設定檔也在',
  )

  const saved = await callRpc('settings.write', { patch: { note: '筆記' } })
  assert.equal(saved.value.note, '筆記')
  assert.equal(JSON.parse(readFileSync(join(shop, 'tavern.json'), 'utf8')).note, '筆記')

  const summary = await callRpc('workspace')
  /**
   * 1 張預設老闆娘 ＋ 1 張測試角色；世界書同理（酒館 ＋ 輸出格式 ＋ 測試用那一本）。
   *
   * ⚠️ `chats` **不是 0**：新建酒館現在就附一間可以直接聊的房間。
   * ⚠️ `art` **是 0**：預設老闆娘是 **PNG 卡**（`characters/老闆娘.png`），
   * 那張圖是「卡片本體」而不是插圖——它不算在 `art/` 的數量裡，
   * 但 `character.list` 會把它當成主圖回報（上面 §4 釘住了）。
   */
  assert.deepEqual(summary.value.counts, { characters: 2, worldbooks: 3, chats: 2, art: 0 })
  assert.equal(summary.value.settings.note, '筆記', 'workspace 要順便帶回這間酒館的設定')
  console.log('5. 檔案 API OK —', JSON.stringify(summary.value.counts))
}

/* --- 5b. 世界書匯入（跟匯入卡片同一條二進位路）---------------------------- */
{
  const native = {
    entries: {
      0: { uid: 0, key: ['測試'], content: '匯入的內容', constant: true, order: 100 },
    },
    unknownTopLevel: { keep: true },
  }
  const imported = await callRpc('worldbook.import', Buffer.from(JSON.stringify(native)), {
    query: '&name=' + encodeURIComponent('imported-world.json'),
  })
  assert.equal(imported.ok, true, '世界書匯入應該成功：' + imported.error)
  assert.equal(imported.value.id, 'imported-world', 'id 由檔名推導')
  assert.deepEqual(
    await callRpc('worldbook.read', { book: 'imported-world' }).then((r) => r.value),
    native,
    '匯入的內容要原樣寫入，不做欄位轉換',
  )

  // 陣列形式也接受（世界書有兩種方言）
  const arrayForm = [{ uid: 1, key: ['k'], content: 'c' }]
  const arr = await callRpc('worldbook.import', Buffer.from(JSON.stringify(arrayForm)), {
    query: '&name=' + encodeURIComponent('array-world.json'),
  })
  assert.equal(arr.value.id, 'array-world')

  // 不像世界書的檔案要早點拒絕，並講清楚原因
  const notBook = await callRpc('worldbook.import', Buffer.from(JSON.stringify({ hello: 'world' })), {
    query: '&name=' + encodeURIComponent('nope.json'),
  })
  assert.equal(notBook.ok, false, '沒有 entries 也不是陣列 → 應該拒絕')
  assert.match(String(notBook.error), /世界書/, '錯誤訊息要說清楚：' + notBook.error)

  const broken = await callRpc('worldbook.import', Buffer.from('這不是 JSON'), {
    query: '&name=' + encodeURIComponent('broken.json'),
  })
  assert.equal(broken.ok, false)
  assert.match(String(broken.error), /JSON/)
  console.log('5b. 世界書匯入 OK — 原樣寫入、接受兩種方言、不像世界書就拒絕')
}

/* --- 7. 插圖：上傳／主圖／讀取／刪除 -------------------------------------- */
{
  // 「＋ 新增角色」走的是宿主半的 character.create。
  // （面板以前直接呼叫這個不存在的 op，那顆按鈕永遠回 unknown op。）
  const created = await callRpc('character.create', { name: '插圖角色' })
  assert.equal(created.ok, true, 'character.create 應該存在：' + created.error)
  assert.equal(created.value.id, '插圖角色')
  assert.equal(existsSync(join(shop, 'characters', '插圖角色.json')), true)

  const empty = await callRpc('assets.list', { kind: 'character', owner: '插圖角色' })
  assert.equal(empty.ok, true, 'assets.list 應該成功：' + empty.error)
  assert.deepEqual(empty.value.items, [], '還沒有圖')
  assert.equal(empty.value.primary, null)

  // 上傳一張圖：二進位 body + query 參數（不是 base64）。
  const uploaded = await callRpc('assets.write', pngBytes(), {
    query: '&kind=character&owner=' + encodeURIComponent('插圖角色') + '&name=' + encodeURIComponent('微笑.png'),
  })
  assert.equal(uploaded.ok, true, '上傳應該成功：' + uploaded.error)
  assert.equal(uploaded.value.written, '微笑.png')
  assert.equal(uploaded.value.primary, '微笑.png', '第一張圖自動成為主圖')
  assert.equal(existsSync(join(shop, 'art', 'characters', '插圖角色', '微笑.png')), true, '圖真的落在 art/characters/<id>/')

  // 第二張：撞名要自動編號，不能覆蓋掉前一張。
  const second = await callRpc('assets.write', pngBytes(16), {
    query: '&kind=character&owner=' + encodeURIComponent('插圖角色') + '&name=' + encodeURIComponent('微笑.png'),
  })
  assert.equal(second.value.written, '微笑-2.png', '同名要自動編號')
  assert.equal(second.value.renamed, true)
  assert.equal(second.value.items.length, 2)

  // 再上傳一張（新名字、排序在後面）：已經指定過的主圖不應該被搶走。
  const third = await callRpc('assets.write', pngBytes(20), {
    query: '&kind=character&owner=' + encodeURIComponent('插圖角色') + '&name=' + encodeURIComponent('生氣.png'),
  })
  assert.equal(third.value.written, '生氣.png')
  assert.equal(third.value.items.length, 3)
  assert.equal(third.value.primary, '微笑.png', '之後上傳的圖不會搶走已指定的主圖')

  // 換主圖。
  const promoted = await callRpc('assets.primary', {
    kind: 'character',
    owner: '插圖角色',
    name: '生氣.png',
  })
  assert.equal(promoted.ok, true, '指定主圖應該成功：' + promoted.error)
  assert.equal(promoted.value.primary, '生氣.png')
  const persisted = JSON.parse(readFileSync(join(shop, 'tavern.json'), 'utf8'))
  assert.equal(persisted.assets['character:插圖角色'], '生氣.png', '主圖存在 tavern.json 裡')

  // 內容真的讀得出來，而且 content-type 正確。
  const fetched = await fetchAsset('characters/' + encodeURIComponent('插圖角色') + '/' + encodeURIComponent('微笑.png'))
  assert.equal(fetched.status, 200)
  assert.equal(fetched.headers['content-type'], 'image/png')
  assert.deepEqual(Buffer.from(fetched.body), pngBytes(), '讀回來的位元組要和上傳的一樣')

  // 刪掉主圖：設定要跟著換掉，不能留下指向空氣的主圖。
  const afterDelete = await callRpc('assets.delete', {
    kind: 'character',
    owner: '插圖角色',
    name: '生氣.png',
  })
  assert.equal(afterDelete.ok, true, '刪圖應該成功：' + afterDelete.error)
  assert.equal(afterDelete.value.items.length, 2)
  assert.equal(
    afterDelete.value.items.some((item) => item.name === '生氣.png'),
    false,
    '刪掉的圖不該還在清單裡',
  )
  assert.equal(typeof afterDelete.value.primary, 'string', '主圖要指向還存在的一張')
  assert.equal(
    afterDelete.value.items.some((item) => item.name === afterDelete.value.primary),
    true,
    '留下來的主圖必須真的存在',
  )
  assert.equal(existsSync(join(shop, 'art', 'characters', '插圖角色', '生氣.png')), false)

  // 面板清單要帶回插圖狀態（不然縮圖畫不出來）。
  const cards = await callRpc('character.list')
  const card = cards.value.find((item) => item.id === '插圖角色')
  assert.ok(card !== undefined)
  assert.equal(card.assets.items.length, 2, 'character.list 要附上插圖狀態')
  assert.equal(card.assets.primary, afterDelete.value.primary)
  console.log('7. 插圖 OK — 上傳／自動編號／主圖／讀取／刪除都通過')

  /* --- 刪到最後一張：主圖設定要清掉，不能留一個指向空氣的 key --- */

  // 真的踩到：用 API 刪掉店面圖（那個實體的最後一張）之後 `art/tavern/` 空了，
  // 但 `tavern.json` 的 assets 還留著檔名——因為「刪掉的正好是主圖」那條分支
  // 會拿 `after.primary`（此時是 null）去呼叫 setPrimaryAsset，於是丟出
  // 「這個實體沒有這張圖：null」，而且是**在刪檔之後才丟**：
  // 檔案沒了、設定還在，面板顯示一個永遠載不出來的主圖。
  //
  // ⚠️ 用**自己的實體**來測，不要動上面那三張：後面的第 9 節要數 art 總張數。
  const drainOwner = '清空測試'
  await callRpc('assets.write', pngBytes(24), {
    query: '&kind=character&owner=' + encodeURIComponent(drainOwner) + '&name=' + encodeURIComponent('一.png'),
  })
  await callRpc('assets.write', pngBytes(25), {
    query: '&kind=character&owner=' + encodeURIComponent(drainOwner) + '&name=' + encodeURIComponent('二.png'),
  })
  const drained = await callRpc('assets.list', { kind: 'character', owner: drainOwner })
  assert.equal(drained.value.items.length, 2, '兩張都要在')
  assert.equal(drained.value.primary, '一.png', '第一張自動當主圖')

  for (const name of ['一.png', '二.png']) {
    const gone = await callRpc('assets.delete', { kind: 'character', owner: drainOwner, name })
    assert.equal(gone.ok, true, `刪 ${name} 應該成功：${gone.error}`)
  }
  const emptied = await callRpc('assets.list', { kind: 'character', owner: drainOwner })
  assert.equal(emptied.value.items.length, 0, '兩張都應該刪光了')
  assert.equal(emptied.value.primary, null, '沒有圖的時候主圖要是 null')
  const cleared = JSON.parse(readFileSync(join(shop, 'tavern.json'), 'utf8'))
  assert.equal(
    Object.prototype.hasOwnProperty.call(cleared.assets ?? {}, 'character:' + drainOwner),
    false,
    '刪光之後 tavern.json 不可以還留著指向空氣的主圖',
  )
  console.log('7b. 刪到最後一張 OK — 主圖設定會清掉，不留指向空氣的 key')
}

/* --- 8. 插圖的防護：壞內容、跳脫、錯的種類 ------------------------------- */
{
  const notImage = await callRpc('assets.write', Buffer.from('這不是圖片'), {
    query: '&kind=character&owner=' + encodeURIComponent('插圖角色') + '&name=假的.png',
  })
  assert.equal(notImage.ok, false, '內容不是圖片就該拒絕')
  assert.ok(notImage.error.includes('不是'), '錯誤訊息要說清楚：' + notImage.error)
  assert.equal(existsSync(join(shop, 'art', 'characters', '插圖角色', '假的.png')), false)

  const badKind = await callRpc('assets.list', { kind: 'nope', owner: '插圖角色' })
  assert.equal(badKind.ok, false, '不認得的種類要拒絕')

  const escape = await fetchAsset('characters/..%2F..%2F..%2Ftavern.json')
  assert.equal(escape.status, 404, '路徑跳脫要被擋下')

  const missing = await fetchAsset('characters/' + encodeURIComponent('插圖角色') + '/沒有這張.png')
  assert.equal(missing.status, 404)

  // 超大檔：宣告的 content-length 超過上限時，不必真的傳 8MB 就該被拒。
  const tooBig = await callRpc('assets.write', pngBytes(), {
    query: '&kind=character&owner=' + encodeURIComponent('插圖角色') + '&name=大.png',
    contentLength: 9_000_000,
  })
  assert.equal(tooBig.ok, false, '超過上限要拒絕')
  assert.ok(tooBig.error.includes('too large'), '要說是太大：' + tooBig.error)
  console.log('8. 防護 OK — 非圖片／壞種類／路徑跳脫／找不到／過大都被擋下')
}

/* --- 9. 房間與店面的插圖 --------------------------------------------------- */
{
  // 房間的圖**跟著房間走**：`chats/<角色>/<roomId>/art/`（**不在 `art/` 底下**）。
  // 所以 owner 要用**房間 id**，不是顯示名稱——名稱不是身分。
  const rooms = await callRpc('room.list')
  const roomId = rooms.value[0].room
  const chatOwner = '測試角色/' + roomId

  const chatAssets = await callRpc('assets.list', { kind: 'chat', owner: chatOwner })
  assert.equal(chatAssets.ok, true, '房間的插圖應該可以讀：' + chatAssets.error)
  assert.equal(chatAssets.value.owner, chatOwner)

  const chatUpload = await callRpc('assets.write', pngBytes(4), {
    query:
      '&kind=chat&owner=' + encodeURIComponent(chatOwner) + '&name=' + encodeURIComponent('房間.png'),
  })
  assert.equal(chatUpload.ok, true, '房間的插圖應該可以上傳：' + chatUpload.error)
  assert.equal(
    existsSync(join(shop, 'chats', '測試角色', roomId, 'art', '房間.png')),
    true,
    '圖要落在房間資料夾裡',
  )

  // 對話清單的每一筆現在是一間**房**：`room` 是身分（資料夾名），`name` 是顯示名稱。
  //
  // ⚠️ 房間的插圖在房間資料夾裡（`chats/<角色>/<roomId>/art/`），所以舊的
  // `art/chats/<assetId>/` 那條路會在客戶端切過去（階段 4b）之後一起換掉——
  // 這一條先釘「清單帶得出身分」。
  const chats = await callRpc('room.list')
  assert.equal(typeof chats.value[0].room, 'string', '清單要帶房間 id')
  assert.equal(chats.value[0].name, '初次見面', '顯示名稱是使用者給的那個')
  // ⚠️ `assetId` 現在仍然由**顯示名稱**那條舊規則正規化而來，而且插圖還在上傳到
  // `art/chats/...`（上一條斷言釘的就是那裡）。房間的圖搬進房間資料夾之後，
  // 這個欄位會整個拿掉——那時連同這一條一起刪。

  const shopFront = await callRpc('assets.write', pngBytes(12), {
    query: '&kind=tavern&name=' + encodeURIComponent('店面.png'),
  })
  assert.equal(shopFront.ok, true, '店面圖應該可以上傳：' + shopFront.error)
  assert.equal(existsSync(join(shop, 'art', 'tavern', '店面.png')), true)
  assert.equal(shopFront.value.primary, '店面.png')
  assert.equal(shopFront.value.owner, '這間酒館')

  const summary = await callRpc('workspace')
  // 回到 4：房間的圖在 `chats/<角色>/<roomId>/art/`，**不在 `art/` 底下**，
  // 所以計數現在**兩邊都掃**（`countArt` ＋ `countRoomArt`）——
  // 2.6.6 剛上線時只掃 `art/`，這裡的數字曾經掉到 3。
  //
  // 4 張＝測試角色的兩張 ＋ 房間的一張 ＋ 店面的一張。
  // （預設老闆娘的圖不在這裡：它是**卡片本體** `characters/老闆娘.png`，不是插圖。）
  assert.equal(summary.value.counts.art, 4, 'art 計數要數到四張圖（角色 2 + 房間 1 + 店面 1）')
  console.log('9. 對話室與店面 OK — art 計數 =', summary.value.counts.art)
}

/* --- 10. 移除只動清單 ---------------------------------------------------- */
{
  const listed = await callRpc('tavern.list')
  const id = listed.value.activeId
  const removed = await callRpc('tavern.remove', { id: id })
  assert.equal(removed.ok, true)
  assert.deepEqual(removed.value.taverns, [], '清單應該空了')
  assert.equal(existsSync(join(shop, 'characters', '測試角色.json')), true, '移除不會刪掉任何檔案')
  assert.equal(existsSync(join(shop, 'tavern.json')), true)
  assert.equal(existsSync(join(shop, 'art', 'characters', '插圖角色', '微笑.png')), true, '插圖也不會被刪掉')
  console.log('10. 移除 OK — 只從清單拿掉，資料夾、設定與插圖都還在')
}

/* --- 11. 舊版殘留的資料夾要被認出來 --------------------------------------- */
{
  // 模擬使用者實際的狀況：v1 自動建立／認養了一間「預設酒館」，資料夾裡只有
  // 四個空目錄、沒有 tavern.json，而 taverns.json 裡還留著那筆紀錄。
  // （v1 的紀錄沒有 icon 欄位——正好也是 v2 要容忍的舊格式。）
  const legacy = mkdtempSync(join(tmpdir(), 'tavern-legacy-'))
  for (const part of ['characters', 'worldbooks', 'chats', 'art']) mkdirSync(join(legacy, part))
  writeFileSync(
    join(home, 'taverns.json'),
    JSON.stringify({
      version: 1,
      activeId: 'legacy-1',
      taverns: [{ id: 'legacy-1', name: '預設酒館', path: legacy, addedAt: '2026-09-16T06:24:38.232Z' }],
    }),
    'utf8',
  )

  const listed = await callRpc('tavern.list')
  assert.equal(listed.value.taverns.length, 1)
  assert.equal(listed.value.taverns[0].exists, true, '資料夾還在')
  assert.equal(listed.value.taverns[0].scaffolded, false, '沒有 tavern.json ⇒ 不是這一版建立的（舊版殘留）')

  // 面板新增一間新酒館之後，清單會自動展開，那筆舊紀錄就會跟著出現——
  // 使用者看到的就是「按了新增卻多出兩間酒館」。這裡確認新加入的那間是
  // scaffolded，兩者可以分辨。
  const shop2 = mkdtempSync(join(tmpdir(), 'tavern-shop2-'))
  const added = await callRpc('tavern.add', { path: shop2 })
  assert.equal(added.ok, true, added.error)
  const both = added.value.taverns
  assert.equal(both.length, 2, '舊紀錄 + 新酒館')
  assert.equal(both.find((item) => item.path === shop2).scaffolded, true, '新加入的是這一版建立的')
  assert.equal(both.find((item) => item.path === legacy).scaffolded, false, '舊的仍然標成殘留')

  // 移除舊紀錄：只動清單，資料夾不動。
  const dropped = await callRpc('tavern.remove', { id: 'legacy-1' })
  assert.equal(dropped.value.taverns.length, 1)
  assert.equal(existsSync(join(legacy, 'characters')), true, '移除殘留紀錄不會刪掉資料夾')
  rmSync(legacy, { recursive: true, force: true })
  rmSync(shop2, { recursive: true, force: true })
  console.log('11. 舊版殘留 OK — 認得出來、可分辨、移除不動檔案')
}

/* --- 11b. 對話 ↔ session 的對照表（Agent 面靠它認人）---------------------- */
{
  // 這一組 op 現在只有 Agent 面在用（瀏覽器半還沒接），所以 §12 的原始碼掃描
  // 涵蓋不到——直接在這裡驗它真的存在、而且真的會寫檔。
  const sessionShop = mkdtempSync(join(tmpdir(), 'tavern-session-shop-'))
  await callRpc('tavern.add', { path: sessionShop })
  const made = await callRpc('room.create', { character: '老闆娘', name: '夜晚' })
  assert.equal(made.ok, true, '先開一份對話：' + made.error)

  const SID = 'session-aaaa1111-bbbb-2222-cccc-333344445555'
  /**
   * ⚠️ **`room` 與 `chat` 是兩個不同的東西，把它們分開才是這一節的重點。**
   *
   * 這一條以前送的是 `chat: <房間 id>`（把 id 塞進顯示名稱那一格，`room` 留空），
   * 因為當時 `session.bind` **根本沒有轉送 `args.room`**。那讓三個地方一起壞掉，
   * 而且全部是**無聲**的（2026-09-23 在真的 GUI 裡才發現）：
   *
   *   1. agent 面的 `roomJson()` 拿顯示名稱去當資料夾名 → `room.json` 永遠找不到
   *      → **每房的工具權限、「這一場的指示」、生成參數全部不生效**
   *   2. `stampChatSessionId` 走 `resolveRoom`（只認 id）→ 傳顯示名稱就丟錯、
   *      被 `catch` 吃掉 → `chat.jsonl` 的 `dsh_session_id` **從來沒被寫進去過**
   *   3. 上面那兩件事都靠 `stamped: true` 這條斷言照樣變綠（因為它傳的是 id）
   *
   * 所以這一節現在**故意用真實的形狀**：`room` 放 id、`chat` 放顯示名稱。
   */
  const displayName = made.value.name
  const bound = await callRpc('session.bind', {
    sessionId: SID,
    character: '老闆娘',
    room: made.value.room,
    chat: displayName,
  })
  assert.equal(bound.ok, true, 'session.bind 應該存在而且成功：' + bound.error)
  assert.equal(bound.value.character, '老闆娘')
  assert.equal(bound.value.room, made.value.room, 'room 要存**房間 id**（agent 面靠它讀 room.json）')
  assert.equal(bound.value.chat, displayName, 'chat 要存**顯示名稱**（清單比對用）')
  assert.notEqual(displayName, made.value.room, '⚠️ 這兩個值本來就不一樣，測試才驗得出東西')
  assert.equal(bound.value.stamped, true, '順手要把 session id 蓋進對話檔的標頭（用房間 id 蓋）')
  // 蓋進去的東西要真的在檔案裡——`stamped: true` 只是回報，這才是事實。
  const header = JSON.parse(readFileSync(join(sessionShop, 'chats', '老闆娘', made.value.room, 'chat.jsonl'), 'utf8').split('\n')[0])
  assert.equal(
    header.chat_metadata?.dsh_session_id,
    SID,
    '⚠️ 對話檔的標頭要真的有 dsh_session_id（`session.rebuild` 靠它重建索引）',
  )
  // agent 面讀每房設定的那一條路：`chats/<角色>/<room>/room.json` 必須真的存在。
  assert.equal(
    existsSync(join(sessionShop, 'chats', '老闆娘', bound.value.room, 'room.json')),
    true,
    '⚠️ 綁定的 room 要指到真的資料夾，不然每房設定永遠讀不到',
  )

  const read = await callRpc('session.read', { sessionId: SID })
  assert.equal(read.value?.room, made.value.room, '讀得回來（room）')
  assert.equal(read.value?.chat, displayName, '讀得回來（chat）')

  const listed = await callRpc('session.list', {})
  assert.equal(listed.value.length, 1, '清單要有一筆')

  // 索引是索引：砍掉之後要能從對話檔的標頭重建回來。
  const removed = await callRpc('session.unbind', { sessionId: SID })
  assert.equal(removed.value.removed, true)
  assert.equal((await callRpc('session.read', { sessionId: SID })).value, null, '解綁之後讀不到')
  const rebuilt = await callRpc('session.rebuild', {})
  assert.equal(rebuilt.value.rebuilt, 1, '要從對話檔的標頭重建一筆')
  const back = (await callRpc('session.read', { sessionId: SID })).value
  assert.equal(back?.character, '老闆娘', '重建之後要指回同一個角色')
  // ⚠️ **重建也要重建出 `room`**：只認得 `chat` 的話，重建完的索引又會退回
  //    「顯示名稱當資料夾名」那個壞掉的世界。標頭裡要留得住房間 id。
  assert.equal(back?.room, made.value.room, '⚠️ 重建之後 room 也要對（不然每房設定又壞了）')

  // 舊形狀（只有 `chat`、而且放的是房間 id）也**不可以**壞：那是已經裝好的
  // 使用者手上正在用的形狀。`stampChatSessionId` 有 `record.room || record.chat` 的退回。
  const LEGACY = 'session-bbbb2222-cccc-3333-dddd-444455556666'
  const legacyRoom = await callRpc('room.create', { character: '老闆娘', name: '舊形狀' })
  const legacyBound = await callRpc('session.bind', {
    sessionId: LEGACY,
    character: '老闆娘',
    chat: legacyRoom.value.room,
  })
  assert.equal(legacyBound.ok, true, '舊形狀（只有 chat）要繼續可用：' + legacyBound.error)
  assert.equal(legacyBound.value.room, '', '舊形狀沒有 room')
  assert.equal(legacyBound.value.stamped, true, '舊形狀要靠 `record.chat` 那條退回才蓋得進去')
  await callRpc('session.unbind', { sessionId: LEGACY })

  // 路徑跳脫：sessionId 會變成檔名，`../` 一定要擋下來。
  const escaped = await callRpc('session.bind', { sessionId: '../escape', character: '老闆娘', chat: '夜晚' })
  assert.equal(escaped.ok, false, '不安全的 sessionId 要被拒絕')
  assert.equal(existsSync(join(sessionShop, 'escape.json')), false, '不可以寫到資料夾外面')

  await callRpc('tavern.remove', { id: 'session-shop' })
  rmSync(sessionShop, { recursive: true, force: true })
  console.log('11b. session 對照表 OK — room／chat 分開、標頭真的蓋進去、重建保得住 room、舊形狀不壞')
}

/* --- 11c. 插件自己裝 preset（不在啟動時裝）------------------------------- */
{
  // 這一組讓「裝好插件就能用」成立。三個 op 都必須存在於宿主半。
  const status = await callRpc('preset.status', {})
  assert.equal(status.ok, true, 'preset.status 應該存在：' + status.error)
  assert.equal(typeof status.value.dir, 'string', '要回報 preset 目錄')
  assert.equal(status.value.dir.endsWith(join('.agent-presets', 'dsh-tavern')), true, '路徑要對：' + status.value.dir)

  const ensured = await callRpc('preset.ensure', { dshHome: home })
  assert.equal(ensured.ok, true, 'preset.ensure 應該成功：' + ensured.error)
  assert.ok(['created', 'updated', 'unchanged', 'foreign'].includes(ensured.value.action), 'action 要看得懂：' + ensured.value.action)

  const source = readFileSync(join(ensured.value.dir, 'agent.cordis.yml'), 'utf8')
  // 最要緊的一條：不可以真的掛 persona（兩個 complete section 會讓組裝失敗）
  assert.equal(/^\s*name:\s*'@deepseek-ai\/dsh-persona'/m.test(source), false, '不可以掛 dsh-persona')
  assert.equal(source.includes('tavern-agent'), true, '要指到我們的 agent 面')
  assert.equal(/name: '.*lib[\\/]agent\.js'/.test(source), true, '要指到真正的 agent.js：' + source)

  // Agent 面要真的存在（指到一個不存在的檔案＝一個開不起來的 session）
  const entry = /name: '(.*)'/.exec(source)
  assert.ok(entry !== null && existsSync(entry[1]), 'preset 指的 agent.js 要真的存在：' + String(entry?.[1]))

  // 移除只在自己確認是我們的檔案時才動手
  const gone = await callRpc('preset.remove', { dshHome: home })
  assert.equal(gone.ok, true, 'preset.remove 應該成功')
  assert.equal(gone.value.removed, true, '是我們裝的就可以移除')
  assert.equal(existsSync(join(ensured.value.dir, 'agent.cordis.yml')), false, '移除之後檔案不在了')

  console.log('11c. 插件裝 preset OK — 產生／檢查／移除，而且不掛 persona')
}

/* --- 11d. 刪除對話（宿主半的 op）---------------------------------------- */
{
  const deleteShop = mkdtempSync(join(tmpdir(), 'tavern-delete-shop-'))
  await callRpc('tavern.add', { path: deleteShop })
  const made = await callRpc('room.create', { character: '老闆娘', name: '要刪的' })
  assert.equal(made.ok, true, '先開一份對話：' + made.error)

  const bound = await callRpc('session.bind', {
    sessionId: 'session-smoke-delete-0000-1111-222233334444',
    character: '老闆娘',
    chat: made.value.name,
  })
  assert.equal(bound.ok, true, '先綁一個 session：' + bound.error)

  const dropped = await callRpc('room.delete', { character: '老闆娘', room: made.value.room })
  assert.equal(dropped.ok, true, 'room.delete 應該存在而且成功：' + dropped.error)
  assert.deepEqual(dropped.value.unbound, ['session-smoke-delete-0000-1111-222233334444'], '要回報解掉了哪個 session')
  // ⚠️ 不是 0：新建酒館本來就附一間預設房（見 §4），所以剩下的應該正好是它。
  const leftRooms = (await callRpc('room.list', {})).value
  assert.equal(leftRooms.length, 1, '只剩新建時附的那一間預設房：' + JSON.stringify(leftRooms.map((r) => r.name)))
  assert.equal(leftRooms[0].character, '老闆娘', '預設房是老闆娘的')
  assert.equal(
    leftRooms.some((room) => room.room === made.value.room),
    false,
    '被刪的那一間不該還在清單裡',
  )
  assert.equal((await callRpc('session.list', {})).value.length, 0, '綁定也要清掉')

  // 不存在的對話 → 明確報錯
  //
  // 措辭從「找不到這份對話」改成「找不到這間房」：東西現在是房間（資料夾），
  // 而契約是「明確失敗、訊息可行動」，不是那幾個字。訊息仍然帶著相對路徑。
  const missing = await callRpc('room.delete', { character: '老闆娘', room: '不存在' })
  assert.equal(missing.ok, false, '刪不存在的對話要失敗')
  assert.match(String(missing.error), /找不到這間房/, '錯誤訊息要可行動：' + missing.error)
  assert.match(String(missing.error), /chats\//, '訊息要指出是哪個路徑：' + missing.error)

  await callRpc('tavern.remove', { id: 'delete-shop' })
  rmSync(deleteShop, { recursive: true, force: true })
  console.log('11d. 刪除對話 OK — 刪檔案、解綁定、不存在時明確報錯')
}

/* --- 11e. 附件（訊息裡夾帶的檔案／圖片）--------------------------------- */
{
  // 使用者：「沒法上傳檔案」。附件有**兩份**：送給模型的那一份走 DSH 的附件服務
  // （客戶端的事，這裡驗不到），而**房間裡那一份**是這一組 op 負責的——它才是
  // 「重新整理之後還畫得出來」與「資料夾帶走就好」的那一份。
  const attachShop = mkdtempSync(join(tmpdir(), 'tavern-attach-shop-'))
  const added = await callRpc('tavern.add', { path: attachShop })
  const tavernId = added.value.added.id
  const made = await callRpc('room.create', { character: '老闆娘', name: '附件房' })
  assert.equal(made.ok, true, '先開一間房：' + made.error)
  const room = made.value.room

  const query = (name) =>
    '&id=' +
    encodeURIComponent(tavernId) +
    '&character=' +
    encodeURIComponent('老闆娘') +
    '&room=' +
    encodeURIComponent(room) +
    '&name=' +
    encodeURIComponent(name)

  // 1. 檔案（非圖片）原樣寫進 `<room>/files/`
  const note = Buffer.from('這是一份筆記\n第二行\n', 'utf8')
  const wroteNote = await callRpc('file.write', note, { query: query('筆記.txt') })
  assert.equal(wroteNote.ok, true, 'file.write 應該存在而且成功：' + wroteNote.error)
  assert.equal(
    existsSync(join(attachShop, 'chats', '老闆娘', room, 'files', '筆記.txt')),
    true,
    '附件要落在房間的 files/ 底下',
  )
  assert.equal(readFileSync(join(attachShop, 'chats', '老闆娘', room, 'files', '筆記.txt'), 'utf8'), note.toString('utf8'), '位元組要原樣')
  assert.match(wroteNote.value.url, /^\/api\/dsh-tavern\/files\//, '要回可以直接串的 URL')

  // 2. 圖片也走同一條路（附件不分種類），清單要認得出它是圖片
  const wroteImage = await callRpc('file.write', pngBytes(6), { query: query('照片.png') })
  assert.equal(wroteImage.ok, true, wroteImage.error)

  const listed = await callRpc('file.list', { character: '老闆娘', room: room })
  assert.equal(listed.ok, true, 'file.list 應該存在：' + listed.error)
  assert.equal(listed.value.length, 2)
  const byName = Object.fromEntries(listed.value.map((item) => [item.name, item]))
  assert.equal(byName['照片.png'].type, 'image', 'png 要認成圖片（訊息裡畫得出來）')
  assert.equal(byName['筆記.txt'].type, 'file', '其他一律當檔案（一顆 chip）')

  // 3. 撞名自動編號（跟插圖同一支 `uniqueName`）
  const again = await callRpc('file.write', Buffer.from('第二份'), { query: query('筆記.txt') })
  assert.equal(again.value.name, '筆記-2.txt', '同名要自動編號，不要覆蓋使用者的檔案')
  assert.equal(again.value.renamed, true)

  // 4. 讀取路由：位元組要一模一樣，而且類型不能亂猜
  const got = await fetchRoomFile('老闆娘/' + room + '/筆記.txt')
  assert.equal(got.status, 200, '附件要讀得回來')
  assert.equal(String(got.body), '這是一份筆記\n第二行\n')
  assert.match(String(got.headers['content-type']), /^text\/plain/, '副檔名對得上就用對的型別')
  assert.equal(got.headers['x-content-type-options'], 'nosniff', '任意檔案一定要 nosniff')
  assert.equal(got.headers['content-disposition'], 'attachment', '非圖片一律當下載（不要 inline 執行）')
  const gotImage = await fetchRoomFile('老闆娘/' + room + '/照片.png')
  assert.equal(gotImage.headers['content-disposition'], 'inline', '圖片才 inline')

  // 5b. ⚠️ SVG **不可以** inline（同源 inline 的 SVG 裡面的 script 會在 app 的 origin
  //     上執行）。它看起來是圖片，所以這一條特別容易寫錯。
  const wroteSvg = await callRpc('file.write', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
    query: query('向量.svg'),
  })
  assert.equal(wroteSvg.ok, true, wroteSvg.error)
  const gotSvg = await fetchRoomFile('老闆娘/' + room + '/向量.svg')
  assert.equal(gotSvg.headers['content-disposition'], 'attachment', 'SVG 要當下載，不能 inline')
  assert.equal(gotSvg.headers['content-type'], 'image/svg+xml', '型別照舊（下載時的檔名提示靠它）')
  const svgInList = (await callRpc('file.list', { character: '老闆娘', room: room })).value.find(
    (item) => item.name === '向量.svg',
  )
  assert.equal(svgInList.type, 'file', 'SVG 在清單裡也不是「圖片」（訊息裡不畫成 <img>）')

  // 5. 路徑跳脫／不存在的檔名都要被擋下（跟插圖那條同一組圍籬）
  const escape = await fetchRoomFile('老闆娘/' + room + '/' + encodeURIComponent('../room.json'))
  assert.equal(escape.status, 404, '檔名不合法要 404，不能穿出房間')
  const nope = await fetchRoomFile('老闆娘/' + room + '/沒有這個.txt')
  assert.equal(nope.status, 404)

  // 6. 訊息帶著附件 → `extra.media`（SillyTavern 的欄位），而且**沒有正文也寫得進去**
  const appended = await callRpc('room.append', {
    character: '老闆娘',
    room: room,
    messages: [{ name: '你', isUser: true, text: '', media: [{ type: 'file', url: wroteNote.value.url, name: '筆記.txt', bytes: note.length }] }],
  })
  assert.equal(appended.ok, true, appended.error)
  assert.equal(appended.value, 1, '只有附件、沒有文字的那一則也要寫進紀錄')

  const messages = await callRpc('room.messages', { character: '老闆娘', room: room })
  const withMedia = messages.value.find((message) => Array.isArray(message.media) && message.media.length > 0)
  assert.ok(withMedia !== undefined, '附件的訊息要讀得回來')
  assert.equal(withMedia.media[0].name, '筆記.txt')
  assert.equal(withMedia.media[0].type, 'file')
  assert.equal(withMedia.text, '', '沒有正文是可以的（丟一張圖不說話）')

  // 7. 壞掉的 media 不會讓整則訊息寫不進去（寬鬆解析，跟其他欄位同一個規矩）
  await callRpc('room.append', {
    character: '老闆娘',
    room: room,
    messages: [{ name: '你', isUser: true, text: '有壞資料', media: [null, { type: 'file' }, 'x'] }],
  })
  const messages2 = await callRpc('room.messages', { character: '老闆娘', room: room })
  assert.equal(messages2.value.at(-1).text, '有壞資料', '壞掉的 media 不該讓那一則消失')
  assert.deepEqual(messages2.value.at(-1).media, [], '壞掉的媒體一律當沒有')

  // 8. 刪除（明確實體刪除，跟插圖同一個哲學：不自動清理孤兒）
  const deleted = await callRpc('file.delete', { character: '老闆娘', room: room, name: '筆記-2.txt' })
  assert.equal(deleted.ok, true, deleted.error)
  assert.equal(existsSync(join(attachShop, 'chats', '老闆娘', room, 'files', '筆記-2.txt')), false)
  const after = await callRpc('file.list', { character: '老闆娘', room: room })
  assert.equal(after.value.length, 3, '剩下的三份（txt ＋ png ＋ svg）還在')

  // 9. 不存在的房間／空檔名要給可行動的錯誤
  const noRoom = await callRpc('file.list', { character: '老闆娘', room: '不存在' })
  assert.equal(noRoom.ok, false)
  assert.match(String(noRoom.error), /找不到這間房/, '錯誤要可行動：' + noRoom.error)
  const noName = await callRpc('file.write', Buffer.from('x'), { query: query('') })
  assert.equal(noName.ok, false, '檔名不可以是空的')

  await callRpc('tavern.remove', { id: tavernId })
  rmSync(attachShop, { recursive: true, force: true })
  console.log('11e. 附件 OK — 上傳／編號／列出／讀取／刪除／訊息帶 media 都通過')
}

/* --- 11f. 生成參數走真的 HTTP 一圈（數字要在 JSON 裡活著）----------------- */
{
  // 為什麼要特地繞一圈真的 route：**數字與字串在這一層最容易被弄丟**。
  // 客戶端送的是 `{ temperature: 0.8 }`（`JSON.stringify` 之後是數字），
  // 而輸入框給的是字串 `"0.8"`；兩邊都該收，但**存進檔案、再讀回來**之後
  // 必須還是同一個意思。`test-workspace.mjs` 驗的是函式層，這一條驗的是
  // 「經過 HTTP ＋ JSON 之後還是不是那個值」。
  const sampleShop = mkdtempSync(join(tmpdir(), 'tavern-sampling-shop-'))
  const added = await callRpc('tavern.add', { path: sampleShop })
  const tavernId = added.value.added.id

  // ① 數字進、數字出。
  const saved = await callRpc('settings.write', {
    id: tavernId,
    patch: { temperature: 0.8, maxTokens: 512 },
  })
  assert.equal(saved.ok, true, 'settings.write 應該成功：' + saved.error)
  assert.equal(saved.value.temperature, 0.8, 'temperature 要是數字 0.8，不是字串')
  assert.equal(saved.value.maxTokens, 512, 'maxTokens 要是數字 512')

  // ② 讀回來也一樣（`settings.read` 是另一個 op，走另一條路）。
  const read = await callRpc('settings.read', { id: tavernId })
  assert.equal(read.ok, true, 'settings.read 應該成功：' + read.error)
  assert.equal(read.value.temperature, 0.8, '讀回來還是 0.8')
  assert.equal(read.value.maxTokens, 512, '讀回來還是 512')
  assert.equal(typeof read.value.temperature, 'number', '型別也要對（不是 "0.8"）')

  // ③ 數字字串也收（`<input type="number">` 給的就是字串）。
  const fromString = await callRpc('settings.write', {
    id: tavernId,
    patch: { temperature: '1.25' },
  })
  assert.equal(fromString.value.temperature, 1.25, '數字字串要收下來並變成數字')
  assert.equal(fromString.value.maxTokens, 512, '沒送的那一欄不可以被清掉')

  // ④ 不合法 → 回報 `dropped`，**而且原本的值要活著**。
  const refused = await callRpc('settings.write', { id: tavernId, patch: { temperature: 9 } })
  assert.equal(refused.ok, true, '不合法不是「失敗」——是「這幾個值沒存」（回報在 dropped）')
  assert.equal(refused.value.temperature, 1.25, '不合法的那一欄要保留原本的值')
  assert.deepEqual(
    (refused.value.dropped ?? []).length,
    1,
    '要回報一個被丟掉的欄位：' + JSON.stringify(refused.value.dropped),
  )

  // ⑤ 清除：送 `null` ⇒ 讀回來是 `null`（不是 0、也不是欄位消失）。
  const cleared = await callRpc('settings.write', { id: tavernId, patch: { temperature: null } })
  assert.equal(cleared.value.temperature, null, 'null ＝ 沒有設定')
  const reread = await callRpc('settings.read', { id: tavernId })
  assert.equal(reread.value.temperature, null, '讀回來也要是 null')

  // ⑥ 房間層：同一條路，而且 `null` ＝ 聽酒館的（清單要原樣帶出來）。
  await callRpc('settings.write', { id: tavernId, patch: { temperature: 0.7 } })
  const room = await callRpc('room.create', { id: tavernId, character: '老闆娘', name: '參數房' })
  assert.equal(room.ok, true, '先開一間房：' + room.error)
  const roomSaved = await callRpc('room.write', {
    id: tavernId,
    character: '老闆娘',
    room: room.value.room,
    patch: { temperature: 1.3 },
  })
  assert.equal(roomSaved.value.temperature, 1.3, '房間的 temperature 要存得進去')
  assert.equal(roomSaved.value.maxTokens, null, '房間沒設的那一欄是 null（＝聽酒館的）')
  const rooms = await callRpc('room.list', { id: tavernId, character: '老闆娘' })
  const one = rooms.value.find((entry) => entry.room === room.value.room)
  assert.ok(one !== undefined, '剛開的房間要在清單裡')
  assert.equal(one.temperature, 1.3, '清單要帶房間自己的值')
  assert.equal(one.maxTokens, null, '⚠️ 清單不可以把酒館的 512 填進來（那就分不出「有沒有設」）')

  await callRpc('tavern.remove', { id: tavernId })
  rmSync(sampleShop, { recursive: true, force: true })
  console.log('11f. 生成參數 OK — 走真的 HTTP：數字／字串都收、null 來回、壞值回報且不覆蓋')
}

/* --- 11g. stop 序列走真的 HTTP 一圈（一整段文字要在 JSON 裡活著）----------- */
{
  /**
   * 為什麼 `stop` 值得自己繞一圈真的 HTTP：它是**唯一一個「客戶端送的形狀
   * 與存下來的形狀不一樣」**的欄位。
   *
   * 客戶端送的是 `<textarea>` 的**一整段文字**（`"使用者：\nUser:"`），宿主半要
   * 把它拆成陣列再存。這一段路徑上任何一環把換行、CRLF 或跳脫弄丟，症狀都是
   * **安靜的**：stop 存下來了、畫面也有，只是模型永遠不會在那裡停下來。
   * `test-workspace.mjs` 驗的是函式層，這一條驗的是「經過 HTTP ＋ JSON 之後」。
   */
  const stopShop = mkdtempSync(join(tmpdir(), 'tavern-stop-shop-'))
  const added = await callRpc('tavern.add', { path: stopShop })
  const tavernId = added.value.added.id

  // ① 一整段文字（**行尾故意混 CRLF 與 LF、中間夾空行與重複**）⇒ 乾淨的陣列。
  const saved = await callRpc('settings.write', {
    id: tavernId,
    patch: { stop: '使用者：\r\nUser:\n\n  使用者：  ' },
  })
  assert.equal(saved.ok, true, 'settings.write 應該成功：' + saved.error)
  assert.deepEqual(
    saved.value.stop,
    ['使用者：', 'User:'],
    '⚠️ 一整段文字要變成陣列：拆行、trim 頭尾、去空行、去掉完全相同的',
  )
  assert.equal(saved.value.dropped, undefined, '合法的值不該有 dropped')

  // ② 讀回來還是陣列（`settings.read` 是另一個 op，走另一條路）。
  const read = await callRpc('settings.read', { id: tavernId })
  assert.deepEqual(read.value.stop, ['使用者：', 'User:'], '讀回來也要是那個陣列')
  assert.equal(Array.isArray(read.value.stop), true, '⚠️ 型別要是陣列，不是那一整段文字')

  // ③ 陣列也收（`tavern.json` 是手改得到的）——而且**不動它**。
  const asArray = await callRpc('settings.write', { id: tavernId, patch: { stop: ['A', 'A', ' B '] } })
  assert.deepEqual(asArray.value.stop, ['A', 'B'], '陣列直接收，並且照同一條規矩正規化')

  // ④ ⚠️ 清除有**兩種寫法**，而結果只能是**一種**。
  //    `[]` 與 `null` 並存的話，讀的那一端永遠分不出「這一間是空的」與
  //    「這一間沒有設」——而那個差別決定「要不要退回酒館那一組」。
  const clearedByArray = await callRpc('settings.write', { id: tavernId, patch: { stop: [] } })
  assert.equal(clearedByArray.value.stop, null, '⚠️ 空陣列要存成 null，不是 []')
  await callRpc('settings.write', { id: tavernId, patch: { stop: ['A'] } })
  const clearedByNull = await callRpc('settings.write', { id: tavernId, patch: { stop: null } })
  assert.equal(clearedByNull.value.stop, null, 'null ＝ 清除')
  const reread = await callRpc('settings.read', { id: tavernId })
  assert.equal(reread.value.stop, null, '讀回來也要是 null')

  // ⑤ 不合法 → 回報 `dropped`，**而且原本的值要活著**（同 11f 第 ④ 條）。
  await callRpc('settings.write', { id: tavernId, patch: { stop: ['好的'] } })
  const refused = await callRpc('settings.write', {
    id: tavernId,
    patch: { stop: Array.from({ length: 17 }, (_, i) => `s${i}`) },
  })
  assert.equal(refused.ok, true, '不合法不是「失敗」——是「這一欄沒存」（回報在 dropped）')
  assert.deepEqual(refused.value.stop, ['好的'], '不合法的那一欄要保留原本的值')
  assert.match(
    String((refused.value.dropped ?? [])[0]),
    /^stop/,
    '要回報是 stop 被丟掉：' + JSON.stringify(refused.value.dropped),
  )

  // ⑥ 房間層：同一條路，而且 `null` ＝ 聽酒館的（清單要原樣帶出來）。
  await callRpc('settings.write', { id: tavernId, patch: { stop: ['酒館的'] } })
  const room = await callRpc('room.create', { id: tavernId, character: '老闆娘', name: '停止序列房' })
  assert.equal(room.ok, true, '先開一間房：' + room.error)
  const roomSaved = await callRpc('room.write', {
    id: tavernId,
    character: '老闆娘',
    room: room.value.room,
    patch: { stop: '房間的\n第二個' },
  })
  assert.deepEqual(roomSaved.value.stop, ['房間的', '第二個'], '房間的 stop 要存得進去')
  const rooms = await callRpc('room.list', { id: tavernId, character: '老闆娘' })
  const one = rooms.value.find((entry) => entry.room === room.value.room)
  assert.ok(one !== undefined, '剛開的房間要在清單裡')
  assert.deepEqual(one.stop, ['房間的', '第二個'], '⚠️ 清單要帶 stop（那一格讀的是清單）')
  // 另一間沒設 ⇒ `null`（＝聽酒館的），不是把酒館那一組抄進來。
  const other = await callRpc('room.create', { id: tavernId, character: '老闆娘', name: '沒設的房' })
  const others = await callRpc('room.list', { id: tavernId, character: '老闆娘' })
  const otherOne = others.value.find((entry) => entry.room === other.value.room)
  assert.equal(otherOne.stop, null, '⚠️ 房間層的 null 要原樣回傳，不要填成酒館的值')

  await callRpc('tavern.remove', { id: tavernId })
  rmSync(stopShop, { recursive: true, force: true })
  console.log('11g. stop 序列 OK — 走真的 HTTP：一整段文字變陣列、[]／null 同一種結果、壞值回報')
}

/* --- 11h. 回覆格式（render.json）走真的 HTTP 一圈 ------------------------- */
{
  /**
   * 這一條驗的是**「指定」那一半真的存在**——在那之前，酒館只有「解碼」：
   * 客戶端讀得懂結構化的一行，但沒有任何一份提示詞告訴模型要那樣寫。
   *
   * ⚠️ 為什麼要特地繞一圈真的 route：`render.json` 有**兩份會走散的東西**
   *   - 宿主的 `RENDER_MODES`（驗證用）
   *   - 客戶端的鏡射（畫畫面用）
   * 而中間隔著 HTTP ＋ JSON。任何一環把 `markers` 那種**物件陣列**弄丟或變形，
   * 症狀都是安靜的：檔案看起來有、畫面看起來有，只是模型永遠收不到對的指令。
   */
  const renderShop = mkdtempSync(join(tmpdir(), 'tavern-render-shop-'))
  const added = await callRpc('tavern.add', { path: renderShop })
  const tavernId = added.value.added.id

  // ① 一開始沒有 render.json ⇒ 回預設（plain）。這是「既有對話行為不變」的那一格。
  const absent = await callRpc('render.read', { id: tavernId })
  assert.equal(absent.ok, true, 'render.read 應該成功：' + absent.error)
  assert.equal(absent.value.exists, false, '新酒館沒有 render.json')
  assert.equal(absent.value.render.mode, 'plain', '⚠️ 沒設定 ⇒ plain（提示詞零指令）')

  // ② 寫一份進去，讀回來要**一模一樣**（含物件陣列那種形狀）。
  const saved = await callRpc('render.write', {
    id: tavernId,
    patch: {
      mode: 'structured',
      markers: [{ tag: '台詞', kind: 'speech', who: '老闆娘' }],
      quotes: [['《', '》']],
      choicesClickable: true,
    },
  })
  assert.equal(saved.ok, true, 'render.write 應該成功：' + saved.error)
  assert.equal(saved.value.mode, 'structured', '模式要存下來')
  const read = await callRpc('render.read', { id: tavernId })
  assert.equal(read.value.exists, true, '檔案要真的落地')
  assert.equal(read.value.render.mode, 'structured', '模式讀得回來')
  assert.deepEqual(
    read.value.render.markers,
    [{ tag: '台詞', kind: 'speech', who: '老闆娘' }],
    '⚠️ markers 是**物件陣列**，經過 JSON 之後形狀要一個字都不差',
  )
  assert.deepEqual(read.value.render.quotes, [['《', '》']], '引號的成對形狀也要活著')
  assert.equal(read.value.render.choicesClickable, true, 'choicesClickable 要記得是布林')
  // ⚠️ 它必須住在**酒館資料夾**裡（整包帶走時格式跟著走）。
  assert.equal(
    existsSync(join(renderShop, 'render.json')),
    true,
    '⚠️ render.json 要在酒館資料夾裡，不是 ~/.dsh',
  )

  // ③ 不合法 ⇒ 回報 `dropped`，而且**落回預設**（不是留著一半）。
  const refused = await callRpc('render.write', { id: tavernId, patch: { markers: [{ tag: 'x', kind: 'nope' }] } })
  assert.equal(refused.ok, true, '不合法不是「失敗」——是「這一欄沒存」（回報在 dropped）')
  assert.match(
    String((refused.value.dropped ?? [])[0]),
    /^markers/,
    '要回報是 markers 被丟掉：' + JSON.stringify(refused.value.dropped),
  )

  // ④ `workspace` 這個 op 要**順手帶回 render**（客戶端讀一次概要就要拿到全部）。
  //    漏了這一條的症狀是安靜的：對話頁永遠用內建的 plain 設定。
  const summary = await callRpc('workspace', {})
  assert.equal(summary.ok, true, 'workspace 應該成功：' + summary.error)
  assert.equal(
    summary.value.render !== null && summary.value.render !== undefined,
    true,
    '⚠️ workspace 要帶 render（不然對話頁永遠走 plain）',
  )
  assert.equal(
    typeof summary.value.render.render === 'object' && summary.value.render.render !== null,
    true,
    '⚠️ 形狀是 `{ exists, broken, render }`——客戶端要往下取一層',
  )

  await callRpc('tavern.remove', { id: tavernId })
  rmSync(renderShop, { recursive: true, force: true })
  console.log('11h. 回覆格式 OK — 走真的 HTTP：plain 預設、物件陣列活著、壞值回報、workspace 帶得回來')
}

/* --- 11i. stop 的開關走真的 HTTP 一圈 ------------------------------------- */
{
  // ⚠️ 開關是**三態**（`true`／`false`／`null`＝聽上一層），而 JSON 裡
  //    `false` 與「沒有這個鍵」長得很像——那正是這一條要驗的東西：
  //    房間說「關」要真的存成 `false`，而不是被當成「沒送」。
  const switchShop = mkdtempSync(join(tmpdir(), 'tavern-stop-switch-'))
  const added = await callRpc('tavern.add', { path: switchShop })
  const tavernId = added.value.added.id

  const on = await callRpc('settings.write', { id: tavernId, patch: { stopEnabled: true } })
  assert.equal(on.value.stopEnabled, true, '酒館層的 true 要存得下去')
  const off = await callRpc('settings.write', { id: tavernId, patch: { stopEnabled: false } })
  assert.equal(off.value.stopEnabled, false, '⚠️ false 要存得下去（不是被當成「沒送」而落回預設）')

  const room = await callRpc('room.create', { id: tavernId, character: '老闆娘', name: '開關房' })
  await callRpc('settings.write', { id: tavernId, patch: { stopEnabled: true } })
  const roomOff = await callRpc('room.write', {
    id: tavernId,
    character: '老闆娘',
    room: room.value.room,
    patch: { stopEnabled: false },
  })
  assert.equal(roomOff.value.stopEnabled, false, '⚠️ 房間層的 false 要存得下去')
  const listed = await callRpc('room.list', { id: tavernId, character: '老闆娘' })
  const one = listed.value.find((entry) => entry.room === room.value.room)
  assert.equal(one.stopEnabled, false, '⚠️ 清單要帶 stopEnabled（那一格讀的是清單）')

  // 三態的第三格：`null` ＝ 回到「聽上一層」。
  const back = await callRpc('room.write', {
    id: tavernId,
    character: '老闆娘',
    room: room.value.room,
    patch: { stopEnabled: null },
  })
  assert.equal(back.value.stopEnabled, null, '⚠️ null ＝ 聽上一層（不是 false）')

  // 壞值要回報（而且不改動原本的值）。
  await callRpc('room.write', {
    id: tavernId,
    character: '老闆娘',
    room: room.value.room,
    patch: { stopEnabled: true },
  })
  const bad = await callRpc('room.write', {
    id: tavernId,
    character: '老闆娘',
    room: room.value.room,
    patch: { stopEnabled: 'on' },
  })
  assert.equal(bad.value.stopEnabled, true, '⚠️ 壞值不可以覆蓋原本的值')
  assert.match(String((bad.value.dropped ?? [])[0]), /^stopEnabled/, '要回報是 stopEnabled 被丟掉')

  await callRpc('tavern.remove', { id: tavernId })
  rmSync(switchShop, { recursive: true, force: true })
  console.log('11i. stop 開關 OK — 走真的 HTTP：三態都存得下去、false 不會被當成「沒送」、壞值回報')
}

/* --- 11j. 世界書的注入位置走真的 HTTP 一圈（2.6.59／2.6.70）-------------- */
{
  /**
   * ⚠️ 這一條的重點是**「只改那一個欄位」**：`worldbook.position` 只動那本書的
   * `position`，其餘（ST 的幾十個欄位）一個都不能掉。
   *
   * 為什麼要繞真的 HTTP：中間隔著「整本讀出來、改一格、原子寫回去」，
   * 而任何一環把不認得的欄位弄丟，症狀都是**安靜的**——使用者只會在某一天
   * 發現自己的世界書少了東西。
   */
  const posShop = mkdtempSync(join(tmpdir(), 'tavern-wbpos-'))
  const added = await callRpc('tavern.add', { path: posShop })
  const tavernId = added.value.added.id

  const bookId = await callRpc('worldbook.write', {
    id: tavernId,
    payload: {
      name: '位置測試',
      position: 4,
      keepMe: { nested: true },
      entries: { 0: { uid: 0, content: 'SPEC', constant: true, token_budget: 400 } },
    },
  })
  assert.equal(bookId.ok, true, '寫一本世界書：' + bookId.error)

  // ① 讀：ST 的 4 映射到 in-chat，而且 `explicit` 是 true。
  const before = await callRpc('worldbook.positions', { id: tavernId })
  assert.equal(before.ok, true, 'worldbook.positions 應該成功：' + before.error)
  assert.equal(before.value.fallback, '', '酒館層的預設一開始是空的')
  const one = before.value.books.find((b) => b.id === bookId.value)
  assert.equal(one.position, 'in-chat', 'ST 的 4 ⇒ in-chat')
  assert.equal(one.explicit, true, '⚠️ ST 的數字是「明確指定」，不是「沒指定」')

  // ② 寫：改成 system-after。
  const moved = await callRpc('worldbook.position', { id: tavernId, book: bookId.value, where: 'system-after' })
  assert.equal(moved.ok, true, 'worldbook.position 應該成功：' + moved.error)
  assert.equal(moved.value.position, 'system-after', '回寫進去的值')

  // ③ ⚠️ 其餘欄位**一個都不能掉**。
  const raw = JSON.parse(readFileSync(join(posShop, 'worldbooks', `${bookId.value}.json`), 'utf8'))
  assert.equal(raw.position, 'system-after', '位置要改到')
  assert.deepEqual(raw.keepMe, { nested: true }, '⚠️ 不認得的頂層欄位不可以掉')
  assert.equal(raw.entries['0'].token_budget, 400, '⚠️ 條目裡的欄位也不可以掉')
  assert.equal(raw.entries['0'].content, 'SPEC', '內容不變')

  /**
   * ④ ⚠️ **`where: null` ＝ 把書裡的 `position` 刪掉**（2.6.70 補的三態）。
   *
   * 在那之前畫面上寫著「要回到『跟著酒館預設』，請到原始 JSON 把 position 刪掉」
   * ——那是一個**叫使用者去用別的工具**的設定。
   */
  const cleared = await callRpc('worldbook.position', { id: tavernId, book: bookId.value, where: null })
  assert.equal(cleared.ok, true, '清空位置應該成功：' + cleared.error)
  assert.equal(cleared.value.position, null, '清掉時回 null')
  const rawCleared = JSON.parse(readFileSync(join(posShop, 'worldbooks', `${bookId.value}.json`), 'utf8'))
  assert.equal('position' in rawCleared, false, '⚠️ 而且檔案裡真的沒有那個鍵了')
  assert.deepEqual(rawCleared.keepMe, { nested: true }, '清位置也不可以掉別的欄位')
  assert.equal(
    (await callRpc('worldbook.positions', { id: tavernId })).value.books.find((b) => b.id === bookId.value).explicit,
    false,
    '清掉之後 `explicit` 要回到 false（書自己沒指定了）',
  )
  // 放回去（後面的斷言要用）。
  await callRpc('worldbook.position', { id: tavernId, book: bookId.value, where: 'system-after' })

  // ⑤ 酒館層的預設（走 settings.write），而且不合法要回報。
  const saved = await callRpc('settings.write', { id: tavernId, patch: { worldbookPosition: 'system-before' } })
  assert.equal(saved.value.worldbookPosition, 'system-before', '酒館層預設存得下去')
  const badFallback = await callRpc('settings.write', { id: tavernId, patch: { worldbookPosition: 'nope' } })
  assert.equal(badFallback.value.worldbookPosition, 'system-before', '⚠️ 壞值不可以覆蓋原本的值')
  assert.match(String((badFallback.value.dropped ?? [])[0]), /^worldbookPosition/, '要回報是它被丟掉')

  // ⑥ 壞位置／不存在的書 ⇒ **明確報錯**（不是靜靜落回預設）。
  const badWhere = await callRpc('worldbook.position', { id: tavernId, book: bookId.value, where: 'nope' })
  assert.equal(badWhere.ok, false, '不合法的位置要失敗')
  assert.match(String(badWhere.error), /位置要是/, '而且要說得出合法值：' + String(badWhere.error))
  const noBook = await callRpc('worldbook.position', { id: tavernId, book: '不存在', where: 'in-chat' })
  assert.equal(noBook.ok, false, '不存在的書要失敗')
  assert.match(String(noBook.error), /找不到這本世界書/, '要說出是哪一本')

  /**
   * ⑦ ⚠️ **2.6.70 一度加過的 `worldbook.meta` 真的不在了。**
   *
   * 那一版把「書層的優先序」與位置收在同一支 op；那個優先序是**我自己發明的
   * 抽象**（使用者要的是條目自己的 `order`），所以整組拆掉了。留一句斷言是因為
   * **兩支同義的 op 在功能上完全看不出來**（同 12b 拆 `chat.*` 的理由）。
   */
  const gone = await callRpc('worldbook.meta', { id: tavernId, book: bookId.value, position: 'in-chat' })
  assert.equal(gone.ok, false, '舊 op 不該還在')
  assert.match(String(gone.error), /unknown op/, '要是「不認識這個 op」，不是「操作失敗」')
  assert.equal(
    readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8').includes("'worldbook.meta'"),
    false,
    '⚠️ 客戶端也不該還在送舊名字（宿主半拆了、客戶端還在送的症狀是「按了沒反應」）',
  )

  await callRpc('tavern.remove', { id: tavernId })
  rmSync(posShop, { recursive: true, force: true })
  console.log('11j. 世界書位置 OK — 走真的 HTTP：只改一個欄位、ST 欄位不掉、清得掉、壞值報錯')
}
/* --- 11k. 世界書位置的**房間那一層**走真的 HTTP（2.6.62）----------------- */
{
  // ⚠️ 兩支 op 答的是**不同的問題**，而拿錯那一支會顯示錯的位置（安靜的錯）：
  //   `worldbook.positions`     = 酒館層（📖 藏書 那一頁用）
  //   `worldbook.roomPositions` = 這一間房（書 → 房 → 酒館 三層一起算）
  const roomPosShop = mkdtempSync(join(tmpdir(), 'tavern-roompos-'))
  const added = await callRpc('tavern.add', { path: roomPosShop })
  const tavernId = added.value.added.id
  const bookId = (
    await callRpc('worldbook.write', {
      id: tavernId,
      payload: { name: '沒指定', entries: { 0: { uid: 0, content: 'X', constant: true } } },
    })
  ).value

  await callRpc('settings.write', { id: tavernId, patch: { worldbookPosition: 'in-chat' } })
  const room = (await callRpc('room.create', { id: tavernId, character: '老闆娘', name: '位置房' })).value.room

  // ① 房間層空 ⇒ 跟著酒館。
  const before = await callRpc('worldbook.roomPositions', { id: tavernId, character: '老闆娘', room })
  assert.equal(before.ok, true, 'worldbook.roomPositions 應該成功：' + before.error)
  assert.equal(before.value.room, '', '房間層一開始是空的')
  assert.equal(before.value.tavern, 'in-chat', '讀得到酒館層')
  assert.equal(before.value.books.find((b) => b.id === bookId).position, 'in-chat', '跟著酒館')

  // ② 寫房間層 ⇒ 蓋過酒館，而且**另一支 op 不受影響**。
  const saved = await callRpc('room.write', {
    id: tavernId,
    character: '老闆娘',
    room,
    patch: { worldbookPosition: 'system-after' },
  })
  assert.equal(saved.value.worldbookPosition, 'system-after', '房間層存得下去')
  const after = await callRpc('worldbook.roomPositions', { id: tavernId, character: '老闆娘', room })
  assert.equal(after.value.room, 'system-after', '讀得到房間層')
  assert.equal(after.value.books.find((b) => b.id === bookId).position, 'system-after', '⚠️ 房間蓋過酒館')
  const tavernSide = await callRpc('worldbook.positions', { id: tavernId })
  assert.equal(
    tavernSide.value.books.find((b) => b.id === bookId).position,
    'in-chat',
    '⚠️ 酒館那一支只看酒館的預設（房間的值不關它的事）',
  )

  // ③ 三態：`null` ＝ 聽酒館的。④ 壞值要回報。
  const back = await callRpc('room.write', {
    id: tavernId,
    character: '老闆娘',
    room,
    patch: { worldbookPosition: null },
  })
  assert.equal(back.value.worldbookPosition, null, '⚠️ null ＝ 聽酒館的（不是一個位置）')
  const bad = await callRpc('room.write', {
    id: tavernId,
    character: '老闆娘',
    room,
    patch: { worldbookPosition: 'nope' },
  })
  assert.match(String((bad.value.dropped ?? [])[0]), /^worldbookPosition/, '要回報是它被丟掉')

  /**
   * ⑤ **條目層的優先序**走真的 HTTP（2.6.70）：房間調得到、**書一個字都不會被改**。
   *
   * ⚠️ 這一條驗的是**接線**：`lib/worldbook.js` 的排序在 `test-worldbook.mjs`
   * §4b 有測試，但那一條驗不到「房間那一層的值有沒有真的走完 HTTP 一圈、
   * 有沒有寫進 room.json、有沒有動到書的檔案」。
   */
  const entryShop = join(roomPosShop, 'worldbooks', `${bookId}.json`)
  const written = await callRpc('worldbook.write', {
    id: tavernId,
    book: bookId,
    payload: {
      name: '沒指定',
      entries: {
        0: { uid: 0, comment: '普通', content: '普通條目', order: 100, constant: true },
        1: { uid: 1, comment: '重要', content: '重要條目', order: 900, constant: true },
      },
    },
  })
  assert.equal(written.ok, true, '覆寫那一本書：' + written.error)

  // ① 讀：每一條帶著**鍵**與書自己的 `order`（房間那一頁要靠鍵送 patch）。
  const entriesBefore = await callRpc('worldbook.roomEntries', {
    id: tavernId,
    character: '老闆娘',
    room,
    book: bookId,
  })
  assert.equal(entriesBefore.ok, true, 'worldbook.roomEntries 應該成功：' + entriesBefore.error)
  assert.deepEqual(entriesBefore.value.entries.map((one) => one.key), ['0', '1'], '鍵是 uid')
  assert.deepEqual(entriesBefore.value.entries.map((one) => one.order), [100, 900], '沒覆寫 ⇒ 書自己的 order')
  assert.deepEqual(entriesBefore.value.entries.map((one) => one.overridden), [false, false], '一條都沒被調過')
  assert.deepEqual(
    entriesBefore.value.entries.map((one) => one.content),
    ['普通條目', '重要條目'],
    '內容唯讀但要畫得出來（房間那一頁的「▸ 條目」）',
  )

  // ② 寫：把 uid 0 那一條拉到 950 ⇒ 讀回來要**算完**，而書的檔案**一個字都不動**。
  const savedOrder = await callRpc('room.write', {
    id: tavernId,
    character: '老闆娘',
    room,
    patch: { worldbookEntryOverrides: { [bookId]: { 0: { order: 950 } } } },
  })
  assert.deepEqual(
    savedOrder.value.worldbookEntryOverrides[bookId],
    { 0: { order: 950 } },
    '⚠️ 條目的覆寫存得下去（與 `worldbookOverrides` 是不同的鍵，互不干擾）',
  )
  const entriesAfter = await callRpc('worldbook.roomEntries', {
    id: tavernId,
    character: '老闆娘',
    room,
    book: bookId,
  })
  assert.deepEqual(entriesAfter.value.entries.map((one) => one.order), [950, 900], '這一間房算完的值')
  assert.deepEqual(entriesAfter.value.entries.map((one) => one.ownOrder), [100, 900], '書自己的值不變（還原要用它）')
  assert.deepEqual(entriesAfter.value.entries.map((one) => one.overridden), [true, false], '只有那一條被調過')
  const bookRaw = JSON.parse(readFileSync(entryShop, 'utf8'))
  assert.equal(bookRaw.entries['0'].order, 100, '⚠️ 書裡的 order **不可以**被房間改到（這是整個功能的底線）')
  assert.equal(bookRaw.entries['1'].order, 900, '別的條目也不可以')
  assert.equal('worldbookEntryOverrides' in bookRaw, false, '房間的設定不可以寫進書的檔案')

  // ③ 三態：`order: null` ＝ 還原成書自己的值。
  await callRpc('room.write', {
    id: tavernId,
    character: '老闆娘',
    room,
    patch: { worldbookEntryOverrides: { [bookId]: { 0: { order: null } } } },
  })
  const entriesReset = await callRpc('worldbook.roomEntries', {
    id: tavernId,
    character: '老闆娘',
    room,
    book: bookId,
  })
  assert.deepEqual(entriesReset.value.entries.map((one) => one.order), [100, 900], 'null ＝ 還原成書自己的值')
  // ④ 壞值：回報，而且不留一筆沒有作用的設定。
  const badOrder = await callRpc('room.write', {
    id: tavernId,
    character: '老闆娘',
    room,
    patch: { worldbookEntryOverrides: { [bookId]: { 999: { order: 1 } } } },
  })
  assert.ok(
    (badOrder.value.dropped ?? []).some((x) => String(x).includes('沒有這一條')),
    '不存在的條目要回報：' + JSON.stringify(badOrder.value.dropped),
  )
  assert.deepEqual(badOrder.value.worldbookEntryOverrides, {}, '⚠️ 壞值不可以留下一筆沒有作用的設定')

  await callRpc('tavern.remove', { id: tavernId })
  rmSync(roomPosShop, { recursive: true, force: true })
  console.log('11k. 房間的藏書 OK — 走真的 HTTP：位置三態、條目優先序（書一個字都不改）、壞值回報')
}

/* --- 12. 跨半契約：瀏覽器半呼叫的每個 op 都必須存在於宿主半 ---------------- */
{
  // 這一條是為了「＋ 新增角色」那個 bug：面板呼叫 `character.create`，
  // 宿主半卻沒有這個 op，按鈕永遠回 `unknown op`，而所有測試都還是綠的。
  // 用原始碼掃描把這類錯誤永久釘住。
  //
  // 兩種呼叫方式都要掃：一般的 JSON op 走 `rpc('op', …)`，二進位（圖片上傳、
  // PNG 卡匯入）走 `sendFile('op', …)`。少掃一種就等於留一個盲點。
  const clientSource = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const called = new Set()
  // ⚠️ 掃描必須容忍換行與空白：第一個版本的 `sendFileExpectOk(\n  'character.import'`
  // 就因為跨行而掃不到（多行呼叫是本來就會出現的寫法）。
  for (const match of clientSource.matchAll(/\b(?:rpc|sendFileExpectOk|sendFile)\s*\(\s*'([a-zA-Z][\w.]*)'/g)) {
    called.add(match[1])
  }
  assert.ok(called.size > 5, '應該掃到多個 op 呼叫（掃描邏輯要有效）')
  // 確認二進位那兩個真的有被掃到——不然這個檢查會靜靜地失去一半效力。
  for (const binary of ['assets.write', 'character.import', 'file.write']) {
    assert.ok(called.has(binary), `掃描應該要涵蓋二進位 op：${binary}`)
  }

  const missing = []
  for (const op of called) {
    const probe = await callRpc(op, {})
    // 沒有酒館時每個 op 都會失敗，但「不認識這個 op」和「操作失敗」要分得出來。
    if (probe.ok === false && String(probe.error).includes('unknown op')) missing.push(op)
  }
  assert.deepEqual(missing, [], '這些 op 面板會呼叫、宿主半卻沒有：' + missing.join(', '))
  console.log('12. 跨半契約 OK —', String(called.size), '個 rpc op 都存在於宿主半')
}

/* --- 12b. 6b：`chat.*` 那六個相容 op 已經拆掉，不可以再長回來 --------------- */
{
  // 為什麼要專門釘這一條：`chat.*` 與 `room.*` 是**等價的別名**，所以
  // 「不小心又加回一個」在功能上完全看不出來——測試會全綠、畫面也正常，
  // 悄悄回來的只有「同一個東西又有兩組名字」這件事。而它一旦回來，
  // 下一個改房間的人就有機會只改一邊。
  const LEGACY = [
    'chat.list',
    'chat.create',
    'chat.delete',
    'chat.rename',
    'chat.append',
    'chat.messages',
  ]
  const alive = []
  for (const op of LEGACY) {
    const probe = await callRpc(op, {})
    // 「不認識這個 op」才代表它真的不在了；「還沒有選定酒館」那種失敗不算。
    if (!(probe.ok === false && String(probe.error).includes('unknown op'))) alive.push(op)
  }
  assert.deepEqual(alive, [], '這幾個相容 op 應該已經不存在了：' + alive.join(', '))

  // ⚠️ **這一半才是真正的安全網**：宿主半拆了、客戶端還在送，症狀是
  // 「按了沒反應」（畫面收到 `unknown op`），而不是紅字的測試。
  const clientSource = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
  const stale = [...clientSource.matchAll(/\b(?:rpc|sendFileExpectOk|sendFile)\s*\(\s*'(chat\.[a-zA-Z]+)'/g)].map(
    (match) => match[1],
  )
  assert.deepEqual(stale, [], '客戶端還在呼叫已經拆掉的 op：' + stale.join(', '))

  // 反過來也要確認：拆掉的是**名字**，不是功能——`room.*` 這一組一個都不能少。
  const ROOMS = [
    'room.list',
    'room.create',
    'room.read',
    'room.write',
    'room.rename',
    'room.delete',
    'room.messages',
    'room.append',
  ]
  const gone = []
  for (const op of ROOMS) {
    const probe = await callRpc(op, {})
    if (probe.ok === false && String(probe.error).includes('unknown op')) gone.push(op)
  }
  assert.deepEqual(gone, [], '這幾個 room.* op 必須存在：' + gone.join(', '))
  console.log('12b. 6b 收尾 OK — chat.* 六個已拆、客戶端一個都沒在送、room.* 八個都在')
}

/* --- 13. 原子寫入：真的把行程殺掉，檔案不能壞 ---------------------------- */
{
  // 這一項不能靠「讀程式碼覺得對」——要在寫入途中把行程殺掉，再看檔案。
  // 直接寫檔在磁碟上是「截斷 → 寫入 → 完成」，中間死掉就留下半個檔案；
  // 原子寫入是「寫暫存檔 → rename」，所以舊的完整版本會活下來。
  //
  // 時機不能用「等 250ms 再殺」去猜（第一次寫這個測試就是這樣誤判的：
  // 40MB 在 250ms 內就寫完了，殺到的時候早就寫完）。改成子行程用**檔案**
  // 回報「我正要開始寫」，父行程看到那個檔案才殺——不依賴速度，也不依賴 pipe
  // （沙箱禁止行程間用 pipe 溝通，Node 的 IPC 通道會被擋）。
  const dir = mkdtempSync(join(tmpdir(), 'tavern-atomic-'))
  const target = join(dir, 'tavern.json')
  const naive = join(dir, 'naive.json')
  const original = `${JSON.stringify({ version: 1, name: '原本的酒館', note: '不能被寫壞' }, null, 2)}\n`
  const writeModule = new URL('./lib/write.js', import.meta.url).href
  writeFileSync(target, original, 'utf8')
  writeFileSync(naive, original, 'utf8')

  /** 跑一個子行程；它一寫出信號檔就立刻 SIGKILL。 */
  async function killAfterSignal(source, signalPath) {
    const child = spawn(process.execPath, ['-e', source], { stdio: 'ignore' })
    const deadline = Date.now() + 20000
    while (!existsSync(signalPath)) {
      if (Date.now() > deadline) {
        child.kill('SIGKILL')
        throw new Error('子行程沒有回報開始寫入')
      }
      if (child.exitCode !== null) throw new Error('子行程在開始寫入前就結束了')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))
  }

  /**
   * 等到「寫入真的開始」才殺。
   *
   * @param waitForTemp - true 時等到目錄裡出現 `.tmp-` 暫存檔才殺。
   *   這一條比「子行程說它要開始寫了」精確：子行程喊完之後還要載入模組、
   *   才會建立暫存檔；第一次寫這個測試就是在載入階段就被殺掉，所以沒殺到寫入中。
   *   false 時（對照組沒有暫存檔）看到信號就殺——`writeFile` 一開檔就截斷了目標。
   */
  async function killDuringWrite(source, signalPath, waitForTemp) {
    const child = spawn(process.execPath, ['-e', source], { stdio: 'ignore' })
    const deadline = Date.now() + 30000
    let sawTemp = false
    while (Date.now() < deadline) {
      if (existsSync(signalPath)) {
        if (!waitForTemp) break
        if (readdirSync(dir).some((name) => name.includes('.tmp-'))) {
          sawTemp = true
          break
        }
      }
      if (child.exitCode !== null) break
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))
    if (waitForTemp && !sawTemp) throw new Error('沒觀察到暫存檔，這個測試沒有殺到寫入中')
    return sawTemp
  }

  // 大內容由子行程自己產生——不能塞進命令列參數（Windows 的 argv 有長度上限）。
  const bigExpr = "'x'.repeat(256 * 1024 * 1024)"
  const signal1 = join(dir, 'signal-atomic')
  await killDuringWrite(
    [
      `const big = ${bigExpr}`,
      `import(${JSON.stringify(writeModule)}).then(async (m) => {`,
      `  require('node:fs').writeFileSync(${JSON.stringify(signal1)}, 'started')`,
      `  await m.atomicWrite(${JSON.stringify(target)}, big)`,
      `})`,
      'setTimeout(() => {}, 60000)',
    ].join('\n'),
    signal1,
    true,
  )

  const survived = readFileSync(target, 'utf8')
  assert.equal(survived, original, '被殺掉之後，磁碟上必須還是原本那個完整版本')
  assert.doesNotThrow(() => JSON.parse(survived), '而且必須還是合法 JSON（不是半個檔案）')

  // 崩潰會留下暫存檔（那是證據，不是 bug）。確認它「沒有蓋掉正式檔」，
  // 而且檔名看得出來是暫存檔（使用者不會誤以為那是他的資料）。
  const leftovers = readdirSync(dir).filter((name) => name.includes('.tmp-'))
  assert.ok(leftovers.length > 0, '應該留下暫存檔（證明真的寫到一半被殺）')
  assert.ok(
    leftovers.every((name) => name.startsWith('tavern.json.tmp-')),
    '暫存檔要跟正式檔明顯區分：' + leftovers.join(', '),
  )

  // 對照組：同樣在「開始寫」的瞬間殺掉，直接寫檔就會壞。
  // 這證明這個測試真的抓到了寫入中，而不是殺在寫入前或寫入後。
  const signal2 = join(dir, 'signal-naive')
  await killDuringWrite(
    [
      'const fs = require(\'node:fs\')',
      `const big = ${bigExpr}`,
      // 先同步開檔（'w' 會**立刻截斷**目標檔），再發信號，然後才開始寫。
      // 順序很重要：反過來的話父行程會在開檔前就殺掉子行程，檔案根本還沒被
      // 動到，這個對照組就什麼都證明不了（第一次寫就是這樣）。
      `const fd = fs.openSync(${JSON.stringify(naive)}, 'w')`,
      `fs.writeFileSync(${JSON.stringify(signal2)}, 'started')`,
      'fs.write(fd, big, () => {})',
      'setTimeout(() => {}, 60000)',
    ].join('\n'),
    signal2,
    false,
  )
  const naiveResult = readFileSync(naive, 'utf8')

  rmSync(dir, { recursive: true, force: true })
  assert.notEqual(
    naiveResult,
    original,
    '對照組：直接寫檔應該要被截斷（否則這個測試沒真的殺到寫入中）',
  )
  console.log(
    '13. 原子寫入 OK — 寫入中 SIGKILL：正式檔完好如初、對照組被截斷成',
    String(naiveResult.length),
    'bytes',
  )
}

/* --- 14. 來源圍籬：擋掉「別的網頁」而不是擋掉正常使用 ---------------------- */
{
  // 為什麼要測這一項：DSH 的 webServer 本身沒有任何來源檢查，
  // 而我們的 op 會建立／寫入／刪除檔案。圍籬如果只寫不測，
  // 就會變成「看起來有防、其實某一路繞得過去」。
  //
  // 每一條都對應一個真實的繞過手法，而不是隨便挑幾個標頭。
  const { originFenceFailure } = await import('./lib/index.js')
  const pass = (overrides) => originFenceFailure(localRequest('POST', '/api/dsh-tavern/rpc', {}, overrides))

  // 正常情況：本機瀏覽器打開面板 → 必須通過
  assert.equal(pass({}), null, '本機連線應該要通過')
  assert.equal(
    pass({ headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' } }),
    null,
    '帶正常 Origin 也應該通過',
  )
  assert.equal(
    pass({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { host: 'localhost:3080' } }),
    null,
    'IPv4-mapped 與 localhost 都要接受',
  )
  assert.equal(
    pass({ socket: { remoteAddress: '::1' }, headers: { host: '[::1]:3080' } }),
    null,
    'IPv6 迴圈位址也要接受',
  )

  // 各種繞過手法 → 必須全部擋下
  const blocked = [
    ['遠端連線', { socket: { remoteAddress: '192.168.1.50' } }],
    ['遠端連線（IPv6）', { socket: { remoteAddress: '2001:db8::1' } }],
    ['DNS rebinding：來源是本機但 Host 指向外部', { headers: { host: 'evil.example.com' } }],
    ['跨站請求（Sec-Fetch-Site）', { headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } }],
    ['Origin 指向別的網站', { headers: { host: '127.0.0.1:3080', origin: 'http://evil.example.com' } }],
    ['Origin 是本機但埠號不同（不同來源）', { headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:9999' } }],
    ['Origin 無法解析', { headers: { host: '127.0.0.1:3080', origin: 'not-a-url' } }],
  ]
  for (const [label, overrides] of blocked) {
    const reason = pass(overrides)
    assert.ok(reason !== null, `應該要擋下：${label}`)
  }

  // 而且真的要走過路由：被擋下的請求連 handler 都不該執行。
  const fencedRes = {
    status: 0,
    body: '',
    writeHead(status) {
      fencedRes.status = status
    },
    end(body) {
      fencedRes.body = body
    },
  }
  await rpcRoute.handler(
    localRequest('POST', '/api/dsh-tavern/rpc?op=tavern.list', {}, { socket: { remoteAddress: '10.0.0.9' } }),
    fencedRes,
  )
  assert.equal(fencedRes.status, 403, '遠端來源要回 403')
  const fencedBody = JSON.parse(fencedRes.body)
  assert.equal(fencedBody.ok, false)
  assert.ok(String(fencedBody.error).includes('本機'), '錯誤訊息要說清楚原因：' + fencedBody.error)

  // 圖片路由也要擋（圖片是使用者的私人內容）。
  const fencedAsset = {
    status: 0,
    writeHead(status) {
      fencedAsset.status = status
    },
    end() {},
  }
  await assetRoute.handler(
    localRequest('GET', '/api/dsh-tavern/assets/characters/x/y.png', {}, { socket: { remoteAddress: '10.0.0.9' } }),
    fencedAsset,
  )
  assert.equal(fencedAsset.status, 403, '讀圖路由也要擋遠端來源')

  // 刻意留的遠端出口：真的要用區網／遠端介面時，可以用環境變數放行，
  // 但「同源」那兩項仍然有效——放寬的是「只有本機」，不是「關掉防護」。
  process.env.DSH_TAVERN_ALLOW_REMOTE = '1'
  try {
    assert.equal(
      pass({ socket: { remoteAddress: '192.168.1.50' }, headers: { host: '192.168.1.10:3080' } }),
      null,
      '設了 DSH_TAVERN_ALLOW_REMOTE 之後，區網來源應該放行',
    )
    assert.ok(
      pass({ headers: { host: '192.168.1.10:3080', 'sec-fetch-site': 'cross-site' } }) !== null,
      '放行遠端之後，跨站仍然要擋',
    )
    assert.ok(
      pass({ headers: { host: '192.168.1.10:3080', origin: 'http://evil.example.com' } }) !== null,
      '放行遠端之後，別的 Origin 仍然要擋',
    )
  } finally {
    delete process.env.DSH_TAVERN_ALLOW_REMOTE
  }
  assert.ok(pass({ socket: { remoteAddress: '192.168.1.50' } }) !== null, '沒設環境變數就不該放行遠端')
  console.log('14. 來源圍籬 OK — 正常本機請求通過；遠端／跨站／DNS rebinding／不同 Origin 全部擋下')
}

/* --- 15. PNG 卡匯入 ------------------------------------------------------- */
{
  // 自己開一間酒館：前面的測試會把酒館移除／刪掉資料夾，這裡不依賴它們的狀態。
  const cardShop = mkdtempSync(join(tmpdir(), 'tavern-cards-'))
  const opened = await callRpc('tavern.add', { path: cardShop })
  assert.equal(opened.ok, true, '要有一間酒館才能測匯入：' + opened.error)

  const v2Card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: 'PNG 角色', description: '從 PNG 讀出來的', unknown_field: { keep: true } },
  }
  const v3Card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { name: 'PNG 角色', description: 'V3 版本', unknown_field: { keep: true } },
  }

  const imported = await callRpc('character.import', pngCard([['chara', v2Card]]), {
    query: '&name=' + encodeURIComponent('png-card.png'),
  })
  assert.equal(imported.ok, true, 'PNG 匯入應該成功：' + imported.error)
    // 卡片名稱有空白，而檔名不能有空白 → id 是推導出來的安全檔名（' ' → '-'）。
  // 這是刻意的分工：顯示名與路徑名分開（見 docs/storage-layout.md §5）。
  assert.equal(imported.value.id, 'PNG-角色')
  assert.equal(imported.value.name, 'PNG 角色', '顯示名要保留原樣（含空白）')
  assert.equal(imported.value.source, 'png:chara')
  assert.equal(imported.value.cardFile, 'PNG-角色.png', 'PNG 卡直接存成 characters/<id>.png')
  assert.equal(imported.value.originalKept, true, 'PNG 卡的原版就是卡片本身')

  /**
   * ⚠️ **不轉檔**（使用者：「PNG 卡直接就是卡，讀得到、寫得回去」）：
   * 位元組原封不動存在 `characters/`，所以提示詞一直住在卡片裡，
   * 而且不需要 `originals/` 或 `art/` 的第二份。
   */
  const importedBytes = readFileSync(join(cardShop, 'characters', 'PNG-角色.png'))
  assert.deepEqual(importedBytes, pngCard([['chara', v2Card]]), 'PNG 要逐位元組原樣存下來')
  assert.equal(
    existsSync(join(cardShop, 'characters', 'PNG-角色.json')),
    false,
    '不要另外寫一份 JSON（兩份真相）',
  )
  assert.equal(
    existsSync(join(cardShop, 'originals', 'cards', 'PNG-角色.png')),
    false,
    '原版就是卡片本身，不需要 originals/ 的第二份',
  )

  // 讀得到、而且是從 PNG 裡讀出來的（提示詞在卡片裡）
  const importedCard = await callRpc('character.read', { card: 'PNG-角色' })
  assert.equal(importedCard.value.description, '從 PNG 讀出來的')
  assert.equal(importedCard.value.name, 'PNG 角色', '顯示名要原樣保留')
  assert.deepEqual(importedCard.value.unknown_field, { keep: true }, '未知欄位要活下來')

  // 卡片的本體圖就是立繪（沒有另外上傳插圖時，頭像／海報牆用它）
  const importedList = await callRpc('character.list', {})
  const importedEntry = importedList.value.find((item) => item.id === 'PNG-角色')
  assert.equal(importedEntry.assets.primary, 'PNG-角色.png', '卡片本體就是主圖')
  assert.equal(importedEntry.assets.items[0].source, 'card', '標成 card（不是插圖）')
  assert.equal(importedEntry.assets.items[0].url, '/api/dsh-tavern/card/PNG-%E8%A7%92%E8%89%B2', '走卡片路由')

  // **寫得回去**：改一個欄位 → 卡片 PNG 更新，但圖的位元組不能被重新編碼。
  const edited = { ...importedCard.value, description: '改過了（寫回 PNG）' }
  const wrote = await callRpc('character.write', { card: 'PNG-角色', payload: edited })
  assert.equal(wrote.ok, true, '寫回 PNG 卡：' + wrote.error)
  const rewritten = readFileSync(join(cardShop, 'characters', 'PNG-角色.png'))
  assert.equal(rewritten.subarray(0, 4).toString('hex'), '89504e47', '寫回之後還是 PNG')
  assert.equal(
    existsSync(join(cardShop, 'characters', 'PNG-角色.json')),
    false,
    '寫回不會偷偷長出一份 JSON',
  )
  const reread = await callRpc('character.read', { card: 'PNG-角色' })
  assert.equal(reread.value.description, '改過了（寫回 PNG）', '新的內容要生效（ccv3 要真的被換掉）')
  // 卡片區塊只有一個（不是「接上去」而是「換掉」——不然讀到的還是舊的 ccv3）
  assert.equal(
    readTextChunks(rewritten).filter((chunk) => chunk.keyword === 'chara').length,
    1,
    '卡片區塊要replace、不是再接一個上去',
  )

  // ccv3 優先於 chara（SillyTavern 也是這樣挑的）
  const both = await callRpc('character.import', pngCard([['chara', v2Card], ['ccv3', v3Card]]), {
    query: '&name=' + encodeURIComponent('both.png'),
  })
  assert.equal(both.value.source, 'png:ccv3', '同時有 chara 與 ccv3 時要用 ccv3')
  /**
   * ⚠️ 匯入撞名時**自動編號**（照 SillyTavern 的規矩），不會蓋掉使用者已經有的那張卡
   * ——那個資料夾是他的。
   */
  assert.equal(both.value.id, 'PNG-角色-2', '同名要自動編號，不要覆蓋既有卡片')
  const bothCard = await callRpc('character.read', { card: both.value.id })
  assert.equal(bothCard.value.description, 'V3 版本', 'ccv3 的內容要覆蓋掉 chara 的')
  assert.equal((await callRpc('character.read', { card: 'PNG-角色' })).value.description, '改過了（寫回 PNG）', '原本那張卡不受影響')

  // 關鍵字大小寫不敏感
  const upper = await callRpc('character.import', pngCard([['CHARA', { name: '大寫角色', description: 'd' }]]), {
    query: '&name=' + encodeURIComponent('upper.png'),
  })
  assert.equal(upper.value.source, 'png:CHARA', '關鍵字要大小寫不敏感')

  // JSON 卡也能走同一條路（沒有原版要留、也沒有插圖）
  const jsonImport = await callRpc(
    'character.import',
    Buffer.from(JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'JSON 角色', x: 1 } })),
    { query: '&name=' + encodeURIComponent('card.json') },
  )
  assert.equal(jsonImport.value.source, 'json')
  assert.equal(jsonImport.value.originalKept, false, 'JSON 卡不需要留原版')
  assert.equal(jsonImport.value.artAdded, null)
  assert.equal(
    JSON.parse(readFileSync(join(cardShop, 'characters', 'JSON-角色.json'), 'utf8')).data.x,
    1,
  )
  console.log('15. PNG 匯入 OK — 資料、原版位元組、插圖三者都對，ccv3 優先、大小寫不敏感')
}

/* --- 16. PNG 解析的防護：壞檔不能害我們爆掉 -------------------------------- */
{
  // 這是這個剖析器最重要的一條：PNG 每個 chunk 開頭是 4 bytes 的長度宣告，
  // 一個惡意檔可以宣告 0xFFFFFFFF（4GB）。如果照著 allocate 就是現成的阻斷服務。
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const hugeLength = Buffer.alloc(4)
  hugeLength.writeUInt32BE(0xffffffff)
  const malicious = Buffer.concat([signature, hugeLength, Buffer.from('tEXt', 'latin1'), Buffer.alloc(16)])

  const started = Date.now()
  const rejected = await callRpc('character.import', malicious, {
    query: '&name=' + encodeURIComponent('bad.png'),
  })
  const elapsed = Date.now() - started
  assert.equal(rejected.ok, false, '宣告 4GB 的 chunk 一定要被拒絕')
  assert.ok(String(rejected.error).includes('不合法'), '要說清楚是長度不合法：' + rejected.error)
  assert.ok(elapsed < 2000, `要在瞬間拒絕，不是真的去讀（花了 ${String(elapsed)}ms）`)

  // 各種壞檔都要有可行動的錯誤訊息，而不是丟出看不懂的例外
  const cases = [
    ['不是 PNG', Buffer.from('這不是 PNG'), /不是 PNG/],
    ['沒有 tEXt', pngCard([]), /沒有 tEXt|沒有角色卡/],
    ['有 tEXt 但關鍵字不對', pngCard([['comment', '哈囉']]), /沒有角色卡資料/],
    ['base64 解不出內容', pngCard([['chara', '']]), /空的|解不出/],
    ['chara 不是合法 JSON', pngCard([['chara', '這不是 JSON']]), /不是合法 JSON/],
    ['卡片是陣列不是物件', pngCard([['chara', '[1,2,3]']]), /不是物件/],
  ]
  for (const [label, bytes, pattern] of cases) {
    const result = await callRpc('character.import', bytes, { query: '&name=' + encodeURIComponent('x.png') })
    assert.equal(result.ok, false, `應該要失敗：${label}`)
    assert.match(String(result.error), pattern, `${label} 的錯誤訊息要對：${result.error}`)
  }

  // 既不是 PNG 也不是 JSON
  const neither = await callRpc('character.import', Buffer.from('隨便的內容'), {
    query: '&name=' + encodeURIComponent('x.txt'),
  })
  assert.equal(neither.ok, false)
  assert.match(String(neither.error), /既不是 PNG 也不是合法 JSON/)

  // 沒有 name 也無法從檔名推導
  const nameless = await callRpc('character.import', Buffer.from(JSON.stringify({ description: '沒有名字' })), {
    query: '&name=.json',
  })
  assert.equal(nameless.ok, false, '沒有 name 又推導不出來時要拒絕')
  console.log('16. PNG 防護 OK — 4GB 長度宣告、壞檔、非 PNG、缺 name 都被擋下且有可行動訊息')
}

/* --- 17. 原子性（不只是「不會壞」）：併發讀者永遠看不到半個檔案 ---------- */
{
  // 第 13 項證明「被殺掉之後檔案還在」。這一項證明更強的東西：
  // **覆蓋既有檔案**的過程中，別的行程讀到的永遠是某一個完整版本，
  // 不會讀到「檔案不存在」或「內容混在一起」。
  //
  // 為什麼要另外測：如果實作變成「先刪除再 rename」，檔案會有一段時間不存在，
  // 而且那是一個**真實的資料遺失窗口**（另一個行程剛好那時讀就拿到 ENOENT）。
  // Windows 上 rename 對已存在的目的地行為和 POSIX 不同，所以這一條特別值得測。
  const dir2 = mkdtempSync(join(tmpdir(), 'tavern-atomic2-'))
  const watched = join(dir2, 'tavern.json')
  const versions = [
    `${JSON.stringify({ v: 1, payload: 'A'.repeat(200_000) })}\n`,
    `${JSON.stringify({ v: 2, payload: 'B'.repeat(200_000) })}\n`,
  ]
  writeFileSync(watched, versions[0], 'utf8')

  const watcher = await import('node:fs/promises')
  let reads = 0
  let bad = 0
  let missing = 0
  let stop = false

  // 讀者：一直讀，只看「有沒有拿到完整的其中一版」。
  const reader = (async () => {
    while (!stop) {
      reads += 1
      let text
      try {
        text = await watcher.readFile(watched, 'utf8')
      } catch (error) {
        if (error.code === 'ENOENT') missing += 1
        else bad += 1
        continue
      }
      if (text !== versions[0] && text !== versions[1]) bad += 1
      await new Promise((resolve) => setImmediate(resolve))
    }
  })()

  const { atomicWrite } = await import('./lib/write.js')
  for (let round = 0; round < 60; round += 1) {
    await atomicWrite(watched, versions[round % 2])
  }
  stop = true
  await reader

  assert.ok(reads > 20, `讀者應該要真的讀到東西（讀了 ${String(reads)} 次）`)
  assert.equal(bad, 0, `不可以讀到半個或混雜的內容（${String(bad)} 次）`)
  assert.equal(missing, 0, `覆蓋過程中檔案不可以消失（${String(missing)} 次 ENOENT）`)
  // 最後一次寫入一定是這兩個完整版本之一（哪一個取決於迴圈怎麼結束，不重要）。
  const finalText = readFileSync(watched, 'utf8')
  assert.ok(
    finalText === versions[0] || finalText === versions[1],
    '結束時檔案必須是某一個完整版本',
  )

  // 暫存檔不該留在使用者的資料夾裡。
  const strays = readdirSync(dir2).filter((name) => name !== 'tavern.json')
  rmSync(dir2, { recursive: true, force: true })
  assert.deepEqual(strays, [], '正常寫入之後不該留下暫存檔：' + strays.join(', '))
  console.log(
    '17. 原子替換 OK —',
    String(reads),
    '次併發讀取全部拿到完整版本，沒有 ENOENT、沒有殘留暫存檔',
  )
}

/* --- 18. 不覆蓋的碰撞重試：對話與插圖 ------------------------------------ */
{
  // 目標第 (2) 項要求「對話與插圖的寫入重試」。這裡把兩個都釘住。
  const shop3 = mkdtempSync(join(tmpdir(), 'tavern-collide-'))
  await callRpc('tavern.add', { path: shop3 })
  await callRpc('character.create', { name: '碰撞角色' })

  // 房間：同一個名字開三次 → **三間不同的房**（身分是 roomId，不是名字），
  // 三間的顯示名稱都叫「初次見面」。
  //
  // 這是這個佈局的核心好處：同名不再是衝突，也就不需要 `-2`／`-3` 那種自動編號
  // ——那正是「用名字當身分」才會有的問題（舊的 `createChat` 就是那樣，而且改名
  // 還要同時搬四處路徑，見 docs/room-layout.md）。
  const first = await callRpc('room.create', { character: '碰撞角色', name: '初次見面' })
  const second = await callRpc('room.create', { character: '碰撞角色', name: '初次見面' })
  const third = await callRpc('room.create', { character: '碰撞角色', name: '初次見面' })
  const ids = [first, second, third].map((one) => one.value.room)
  assert.equal(new Set(ids).size, 3, '三次都要拿到不同的房間 id')
  for (const chat of [first, second, third]) {
    assert.equal(chat.value.name, '初次見面', '顯示名稱同名是允許的（名字不是身分）')
    assert.equal(
      existsSync(join(shop3, 'chats', '碰撞角色', chat.value.room, 'chat.jsonl')),
      true,
      `對話檔要真的存在：${chat.value.room}/chat.jsonl`,
    )
  }

  // 插圖：同一個檔名上傳三次 → 微笑.png / 微笑-2.png / 微笑-3.png，
  // 而且每一張都要在（不是覆蓋到只剩一張）。
  const names = []
  for (const padding of [8, 16, 24]) {
    const uploaded = await callRpc('assets.write', pngBytes(padding), {
      query: '&kind=character&owner=' + encodeURIComponent('碰撞角色') + '&name=' + encodeURIComponent('微笑.png'),
    })
    assert.equal(uploaded.ok, true, uploaded.error)
    names.push(uploaded.value.written)
  }
  assert.deepEqual(names, ['微笑.png', '微笑-2.png', '微笑-3.png'], '插圖撞名也要自動編號')
  const listed = await callRpc('assets.list', { kind: 'character', owner: '碰撞角色' })
  assert.equal(listed.value.items.length, 3, '三張都要留下來，不能被覆蓋成兩張')
  assert.equal(listed.value.primary, '微笑.png', '主圖在第一次上傳時就定了，之後不會被搶走')

  // 併發建立：同時打好幾次同一個名字 → 四間**不同的房**（id 唯一），名字都叫「同時」。
  //
  // id 是用 `mkdir`（**不帶** `recursive`）當獨佔鎖產生的，所以併發也不會撞；
  // 而名字根本不是身分，所以同名完全不是問題。舊契約（檔名 `同時-2`…）驗的是
  // 「名字唯一」——那正是用名字當身分才會需要的東西。
  const raced = await Promise.all(
    [0, 1, 2, 3].map(() => callRpc('room.create', { character: '碰撞角色', name: '同時' })),
  )
  const raceIds = raced.map((result) => result.value.room)
  assert.equal(new Set(raceIds).size, 4, '併發下四個 id 都要不一樣：' + raceIds.join(', '))
  assert.deepEqual(
    raced.map((result) => result.value.name).sort(),
    ['同時', '同時', '同時', '同時'],
    '名字同名是允許的（名字不是身分）',
  )
  for (const id of raceIds) {
    assert.equal(
      existsSync(join(shop3, 'chats', '碰撞角色', id, 'chat.jsonl')),
      true,
      `每一間房都要有對話檔：${id}`,
    )
  }
  const raceDirs = readdirSync(join(shop3, 'chats', '碰撞角色'))
  assert.equal(raceDirs.length, 7, '先前三間 ＋ 這次四間，總共七個房間資料夾')

  rmSync(shop3, { recursive: true, force: true })
  console.log('18. 碰撞重試 OK — 對話與插圖撞名自動編號，併發建立不會有兩個同名')
}

/* --- 19. 讀取不可以改動資料夾（舊版殘留的標記不能被自己弄不見）---------- */
{
  // 這一項是實測踩到的：使用者點開「預設酒館（舊版殘留）」看它的設定，
  // 光是瀏覽就把 `tavern.json` 建出來了——因為 `workspace` / `character.list`
  // 這些**讀取**路徑呼叫了 `ensure()`。結果「舊版殘留」的標記自己消失。
  //
  // 讀取只讀；補結構是「新增酒館」與「寫入」的責任。
  //
  // 這裡直接測資料層（TavernWorkspace）而不是走 RPC：註冊表是在 `apply()` 時
  // 依當下的 DSH_HOME 建好的，測試中途換環境變數沒用；而且要釘住的保證
  // （「讀取不寫檔」）本來就在這一層。
  const { TavernWorkspace } = await import('./lib/workspace.js')
  const legacyShop = mkdtempSync(join(tmpdir(), 'tavern-readonly-'))
  for (const part of ['characters', 'worldbooks', 'chats', 'art']) mkdirSync(join(legacyShop, part))
  writeFileSync(
    join(legacyShop, 'characters', '遗留角色.json'),
    JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: '遗留角色' } }),
    'utf8',
  )
  const before = readdirSync(legacyShop).sort()
  const legacy = new TavernWorkspace(legacyShop)
  assert.equal(existsSync(join(legacyShop, 'tavern.json')), false, '前提：這是舊版殘留（沒有 tavern.json）')
  assert.equal((await legacy.summary()).scaffolded, false, '前提：判準要說它是殘留')

  // 把「讀」全部跑一輪
  await legacy.summary()
  await legacy.readSettings()
  await legacy.listCharacters()
  await legacy.listWorldbooks()
  await legacy.listAllRooms()
  await legacy.readCharacter('遗留角色')
  await legacy.describeEntityAssets('character', '遗留角色')
  await legacy.describeEntityAssets('tavern', '')

  const after = readdirSync(legacyShop).sort()
  assert.deepEqual(after, before, `讀取不該新增或刪除任何東西（前 ${before.join(',')} / 後 ${after.join(',')}）`)
  assert.equal(
    existsSync(join(legacyShop, 'tavern.json')),
    false,
    '讀取不可以替舊版殘留補上 tavern.json（否則殘留標記會自己消失）',
  )
  assert.equal(existsSync(join(legacyShop, 'README.txt')), false, '讀取也不該補 README.txt')
  assert.equal((await legacy.summary()).scaffolded, false, '讀完一輪之後仍必須是「舊版殘留」')

  // 寫入路徑還是要會補結構（不能因為修這個就讓寫入壞掉）
  await legacy.writeCharacter('', { name: '新角色' })
  assert.equal(existsSync(join(legacyShop, 'tavern.json')), true, '寫入時才補上 tavern.json')
  assert.equal(existsSync(join(legacyShop, 'characters', '新角色.json')), true)

  rmSync(legacyShop, { recursive: true, force: true })
  console.log('19. 讀取唯讀 OK — 瀏覽不會補結構（殘留標記留得住），寫入才會')
}

/* --- 20. id 型別錯誤要講清楚（不要 [object Object]）---------------------- */
{
  const wrongType = await callRpc('tavern.select', { id: { id: 'x', name: '某間酒館' } })
  assert.equal(wrongType.ok, false)
  assert.match(String(wrongType.error), /必須是字串/, '型別錯誤要直說：' + wrongType.error)
  assert.equal(
    String(wrongType.error).includes('[object Object]'),
    false,
    '不可以再把物件字串化成 [object Object]',
  )
  console.log('20. id 型別 OK — 傳錯型別會得到可行動的訊息')
}

rmSync(home, { recursive: true, force: true })
rmSync(shop, { recursive: true, force: true })

console.log('\n全部通過 ✅  side effects:', calls.effects.join(' | '))
