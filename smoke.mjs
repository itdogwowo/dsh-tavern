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
const assetRoute = calls.routes.find(
  (route) => route.kind === 'prefix' && route.path.startsWith('/api/dsh-tavern/'),
)
assert.ok(rpcRoute !== undefined, 'RPC 路由應已註冊')
assert.equal(rpcRoute.kind, 'exact')
assert.ok(assetRoute !== undefined, '插圖路由應已註冊')
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
  assert.equal(existsSync(join(shop, 'characters', '老闆娘.json')), true, '應該附一張老闆娘')
  assert.equal(existsSync(join(shop, 'worldbooks', '酒館.json')), true, '應該附一本世界書')
  assert.equal(existsSync(join(shop, 'worldbooks', '輸出格式.json')), true, '應該附輸出格式（預設，不是選配）')
  assert.deepEqual(
    added.value.skeleton.slice().sort(),
    ['characters/老闆娘.json', 'worldbooks/輸出格式.json', 'worldbooks/酒館.json'],
    'skeleton 要回報實際建立了什麼：' + added.value.skeleton.join(' '),
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

  const chat = await callRpc('chat.create', { character: '測試角色', name: '初次見面' })
  assert.equal(chat.ok, true, '開新對話應該成功：' + chat.error)
  assert.equal(existsSync(join(shop, 'chats', '測試角色', '初次見面.jsonl')), true)

  const saved = await callRpc('settings.write', { patch: { note: '筆記' } })
  assert.equal(saved.value.note, '筆記')
  assert.equal(JSON.parse(readFileSync(join(shop, 'tavern.json'), 'utf8')).note, '筆記')

  const summary = await callRpc('workspace')
  // 1 張預設老闆娘 ＋ 1 張測試角色；世界書同理（酒館 ＋ 輸出格式 ＋ 測試用那一本）。
  assert.deepEqual(summary.value.counts, { characters: 2, worldbooks: 3, chats: 1, art: 0 })
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

/* --- 9. 對話室與店面的插圖 ------------------------------------------------- */
{
  const chatAssets = await callRpc('assets.list', { kind: 'chat', owner: '測試角色/初次見面' })
  assert.equal(chatAssets.ok, true, '對話的插圖應該可以讀：' + chatAssets.error)
  assert.equal(chatAssets.value.owner, '測試角色/初次見面')

  const chatUpload = await callRpc('assets.write', pngBytes(4), {
    query:
      '&kind=chat&owner=' + encodeURIComponent('測試角色/初次見面') + '&name=' + encodeURIComponent('房間.png'),
  })
  assert.equal(chatUpload.ok, true, '對話室插圖應該可以上傳：' + chatUpload.error)
  assert.equal(existsSync(join(shop, 'art', 'chats', '測試角色', '初次見面', '房間.png')), true)

  // 對話清單要帶 assetId，面板才知道圖在哪個資料夾。
  const chats = await callRpc('chat.list')
  assert.equal(chats.value[0].assetId, '初次見面')

  const shopFront = await callRpc('assets.write', pngBytes(12), {
    query: '&kind=tavern&name=' + encodeURIComponent('店面.png'),
  })
  assert.equal(shopFront.ok, true, '店面圖應該可以上傳：' + shopFront.error)
  assert.equal(existsSync(join(shop, 'art', 'tavern', '店面.png')), true)
  assert.equal(shopFront.value.primary, '店面.png')
  assert.equal(shopFront.value.owner, '這間酒館')

  const summary = await callRpc('workspace')
  assert.equal(summary.value.counts.art, 4, 'art 計數要數到四張圖（角色 2 + 對話 1 + 店面 1）')
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
  const made = await callRpc('chat.create', { character: '老闆娘', name: '夜晚' })
  assert.equal(made.ok, true, '先開一份對話：' + made.error)

  const SID = 'session-aaaa1111-bbbb-2222-cccc-333344445555'
  const bound = await callRpc('session.bind', {
    sessionId: SID,
    character: '老闆娘',
    chat: made.value.name,
  })
  assert.equal(bound.ok, true, 'session.bind 應該存在而且成功：' + bound.error)
  assert.equal(bound.value.character, '老闆娘')
  assert.equal(bound.value.stamped, true, '順手要把 session id 蓋進對話檔的標頭')

  const read = await callRpc('session.read', { sessionId: SID })
  assert.equal(read.value?.chat, made.value.name, '讀得回來')

  const listed = await callRpc('session.list', {})
  assert.equal(listed.value.length, 1, '清單要有一筆')

  // 索引是索引：砍掉之後要能從對話檔的標頭重建回來。
  const removed = await callRpc('session.unbind', { sessionId: SID })
  assert.equal(removed.value.removed, true)
  assert.equal((await callRpc('session.read', { sessionId: SID })).value, null, '解綁之後讀不到')
  const rebuilt = await callRpc('session.rebuild', {})
  assert.equal(rebuilt.value.rebuilt, 1, '要從對話檔的標頭重建一筆')
  assert.equal(
    (await callRpc('session.read', { sessionId: SID })).value?.character,
    '老闆娘',
    '重建之後要指回同一個角色',
  )

  // 路徑跳脫：sessionId 會變成檔名，`../` 一定要擋下來。
  const escaped = await callRpc('session.bind', { sessionId: '../escape', character: '老闆娘', chat: '夜晚' })
  assert.equal(escaped.ok, false, '不安全的 sessionId 要被拒絕')
  assert.equal(existsSync(join(sessionShop, 'escape.json')), false, '不可以寫到資料夾外面')

  await callRpc('tavern.remove', { id: 'session-shop' })
  rmSync(sessionShop, { recursive: true, force: true })
  console.log('11b. session 對照表 OK — 綁定／讀取／解綁／重建／路徑防護')
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
  const made = await callRpc('chat.create', { character: '老闆娘', name: '要刪的' })
  assert.equal(made.ok, true, '先開一份對話：' + made.error)

  const bound = await callRpc('session.bind', {
    sessionId: 'session-smoke-delete-0000-1111-222233334444',
    character: '老闆娘',
    chat: made.value.name,
  })
  assert.equal(bound.ok, true, '先綁一個 session：' + bound.error)

  const dropped = await callRpc('chat.delete', { character: '老闆娘', chat: made.value.name })
  assert.equal(dropped.ok, true, 'chat.delete 應該存在而且成功：' + dropped.error)
  assert.deepEqual(dropped.value.unbound, ['session-smoke-delete-0000-1111-222233334444'], '要回報解掉了哪個 session')
  assert.equal((await callRpc('chat.list', {})).value.length, 0, '對話清單要空了')
  assert.equal((await callRpc('session.list', {})).value.length, 0, '綁定也要清掉')

  // 不存在的對話 → 明確報錯
  const missing = await callRpc('chat.delete', { character: '老闆娘', chat: '不存在' })
  assert.equal(missing.ok, false, '刪不存在的對話要失敗')
  assert.match(String(missing.error), /找不到這份對話/, '錯誤訊息要可行動：' + missing.error)

  await callRpc('tavern.remove', { id: 'delete-shop' })
  rmSync(deleteShop, { recursive: true, force: true })
  console.log('11d. 刪除對話 OK — 刪檔案、解綁定、不存在時明確報錯')
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
  for (const binary of ['assets.write', 'character.import']) {
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
  assert.equal(imported.value.originalKept, true, 'PNG 的原始位元組要留下來')
  assert.equal(imported.value.artAdded, 'PNG-角色.png', 'PNG 本身要變成這張卡的插圖')

  // 卡片資料真的寫成我們的格式
  const cardOnDisk = JSON.parse(readFileSync(join(cardShop, 'characters', 'PNG-角色.json'), 'utf8'))
  assert.equal(cardOnDisk.spec, 'chara_card_v2')
  assert.equal(cardOnDisk.data.description, '從 PNG 讀出來的')
  assert.equal(cardOnDisk.data.name, 'PNG 角色', '顯示名要原樣保留')
  assert.deepEqual(cardOnDisk.data.unknown_field, { keep: true }, '未知欄位要活下來')

  // 原始 PNG 留在 originals/（不在 characters/，免得污染 ST 的角色庫）
  assert.equal(existsSync(join(cardShop, 'originals', 'cards', 'PNG-角色.png')), true, '原版要留一份')
  assert.equal(
    existsSync(join(cardShop, 'characters', 'PNG-角色.png')),
    false,
    '原版不可以放在 characters/ 底下（ST 會把它當成第二個角色）',
  )

  // 插圖那一份要和原版位元組完全相同（同一張圖，不是重新編碼過的）
  const artBytes = readFileSync(join(cardShop, 'art', 'characters', 'PNG-角色', 'PNG-角色.png'))
  const originalBytes = readFileSync(join(cardShop, 'originals', 'cards', 'PNG-角色.png'))
  assert.deepEqual(artBytes, originalBytes, '插圖要跟原版位元組相同')
  const listed = await callRpc('assets.list', { kind: 'character', owner: 'PNG-角色' })
  assert.equal(listed.value.primary, 'PNG-角色.png', '匯入的第一張圖自動成為主圖')

  // ccv3 優先於 chara（SillyTavern 也是這樣挑的）
  const both = await callRpc('character.import', pngCard([['chara', v2Card], ['ccv3', v3Card]]), {
    query: '&name=' + encodeURIComponent('both.png'),
  })
  assert.equal(both.value.source, 'png:ccv3', '同時有 chara 與 ccv3 時要用 ccv3')
  assert.equal(
    JSON.parse(readFileSync(join(cardShop, 'characters', 'PNG-角色.json'), 'utf8')).data.description,
    'V3 版本',
    'ccv3 的內容要覆蓋掉 chara 的',
  )

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

  // 對話：同一個名字開三次 → 應該拿到 初次見面 / 初次見面-2 / 初次見面-3
  const first = await callRpc('chat.create', { character: '碰撞角色', name: '初次見面' })
  const second = await callRpc('chat.create', { character: '碰撞角色', name: '初次見面' })
  const third = await callRpc('chat.create', { character: '碰撞角色', name: '初次見面' })
  assert.equal(first.value.name, '初次見面')
  assert.equal(second.value.name, '初次見面-2', '撞名要自動編號')
  assert.equal(third.value.name, '初次見面-3', '而且每次都要拿到新的編號')
  for (const chat of [first, second, third]) {
    assert.equal(
      existsSync(join(shop3, 'chats', '碰撞角色', chat.value.file)),
      true,
      `檔案要真的存在：${chat.value.file}`,
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

  // 併發建立：同時打好幾次同一個名字，也只能有一個成功用原名。
  const raced = await Promise.all(
    [0, 1, 2, 3].map(() => callRpc('chat.create', { character: '碰撞角色', name: '同時' })),
  )
  const raceNames = raced.map((result) => result.value.name).sort()
  assert.deepEqual(
    raceNames,
    ['同時', '同時-2', '同時-3', '同時-4'],
    '併發也不能有兩個拿到同一個檔名：' + raceNames.join(', '),
  )
  const raceFiles = readdirSync(join(shop3, 'chats', '碰撞角色')).filter((name) => name.startsWith('同時'))
  assert.equal(raceFiles.length, 4, '四個檔案都要在')

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
  await legacy.listChats()
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
