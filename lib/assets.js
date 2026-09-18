/**
 * 插圖／資產層。
 *
 * 設計原則（v2.2 重做）：
 *   1. **圖跟著東西走**：一張人物卡的插圖住在 `art/characters/<卡 id>/`，
 *      世界書住 `art/worldbooks/<書 id>/`，一份對話住 `art/chats/<對話 id>/`，
 *      酒館自己的店面圖住 `art/tavern/`。看到圖就知道它屬於誰，不會有孤島。
 *   2. **一個東西可以有很多張圖**：表情圖、動作圖、差分圖都放同一個資料夾，
 *      再用「主圖」指定預設要顯示哪一張。
 *   3. **不在 JSON 裡存清單**：資料夾內容就是真相（磁碟上的檔案你直接看得到、
 *      直接丟進來就生效）。只在 `tavern.json` 存極少量的中繼資料（目前只有「主圖是哪一張」）。
 *
 * 注意：這裡假設資料夾形狀和 `workspace.js` 一致（人物卡＝`characters/<id>.json`），
 * 所以模組本身不依賴 TavernWorkspace，方便單獨測試。
 */
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from './write.js'

/** 一個實體可以掛資產的種類 → `art/` 底下的資料夾名。 */
export const ASSET_KINDS = {
  character: 'characters',
  worldbook: 'worldbooks',
  chat: 'chats',
  tavern: 'tavern',
}

/**
 * 一個「擁有者」的識別（目錄 id + 人看的名字）。
 *
 * @param kind - 實體種類
 * @param parts - `character`/`worldbook` → `[id]`；`chat` → `[角色, 對話名]`
 * @returns `{ id, name }`；`id` 給路徑用，`name` 是主圖設定與訊息用的識別。
 */
export function assetOwner(kind, parts) {
  const list = Array.isArray(parts) ? parts : [parts]
  if (kind === 'tavern') return { id: '', name: '這間酒館' }
  if (kind === 'chat') {
    const character = requireIdPart(list[0], '角色 id')
    const chat = typeof list[1] === 'string' ? list[1] : ''
    if (chat === '') throw new Error('對話名稱不可為空')
    // 角色走白名單驗證（安全），對話名走正規化（可能含任意字元）。
    return { id: `${character}/${normalizeAssetId(chat)}`, name: `${character}/${chat}` }
  }
  const id = requireIdPart(list[0], kind === 'character' ? '角色 id' : '世界書 id')
  return { id, name: id }
}

/**
 * 無狀態版本的 {@link assetOwner}，用在「只算 id、不需要檢查檔案在不在」的地方。
 * 建對話的時候會用到：那時檔案還沒寫下去。
 */
export function assetIdFor(kind, id) {
  if (kind === 'tavern') return ''
  return assetOwner(kind, kind === 'chat' ? String(id ?? '').split('/') : [id]).id
}

/**
 * 由 API 傳進來的 id 解析出擁有者。
 *
 * 傳進來的形狀是**被壓平的字串**：人物卡是 `老闆娘`，對話是 `老闆娘/初次見面`
 * （對話名本身不含 `/`，所以切第一個 `/` 就夠了）。這裡是唯一懂這個格式的地方。
 */
export function parseAssetOwner(kind, id) {
  if (kind === 'tavern') return assetOwner('tavern', [])
  const text = typeof id === 'string' ? id : ''
  if (kind === 'chat') {
    const slash = text.indexOf('/')
    if (slash <= 0 || slash === text.length - 1) {
      throw new Error(`對話資產的 id 要是「角色/對話名」：${text}`)
    }
    return assetOwner('chat', [text.slice(0, slash), text.slice(slash + 1)])
  }
  return assetOwner(kind, [text])
}


/** 把任意名字正規化成可以當資料夾名的 id（保留中日韓與 . _ -）。 */
export function normalizeAssetId(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..') return ''
  const cleaned = trimmed
    .replace(/[^\w\u4e00-\u9fff.-]/g, '-')
    .replace(/-{2,}/g, '-')
    // 前後的 `-` 與 `.` 都要拿掉：`.` 開頭會變隱藏資料夾，`-` 結尾只是醜。
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '')
    .slice(0, 48)
    .replace(/[.-]+$/, '')
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? '' : cleaned
}

/**
 * 列出聊天室時用的 assetId 解析器：少數情況下兩個對話名會正規化成同一個 id
 * （例如「初次見面」和「初次見面!」），這時後面的加 `-2` 區分，
 * 讓每個對話都還是有自己獨立的插圖資料夾。
 *
 * @returns `(name) => assetId`
 */
export function makeAssetIdResolver(character) {
  const used = new Map()
  return (name) => {
    const base = normalizeAssetId(name) || 'chat'
    let candidate = base
    let n = 2
    while (used.has(candidate) && used.get(candidate) !== name) {
      candidate = `${base}-${String(n)}`
      n += 1
    }
    used.set(candidate, name)
    return candidate
  }
}

/** 副檔名 → MIME。只有這些會被當成圖片列出。 */
export const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

/** 單張圖上限（測試階段放寬；超過就明確拒絕，不要默默截斷）。 */
export const MAX_ASSET_BYTES = 8_000_000

/** 一個資料夾最多幾張圖（避免有人把整個相簿丟進來讓 UI 卡死）。 */
const MAX_ASSETS_PER_ENTITY = 400

/** 魔術數字 → 副檔名白名單（不信副檔名，信檔案內容）。 */
const MAGIC = [
  { ext: ['png'], bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: ['jpg', 'jpeg'], bytes: [0xff, 0xd8, 0xff] },
  { ext: ['gif'], bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: ['bmp'], bytes: [0x42, 0x4d] },
]

/** 由檔名取副檔名（小寫，不含點）。 */
export function extensionOf(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(name)
  return match === null ? '' : match[1].toLowerCase()
}

/** 這個檔名是不是我們認得的圖片。 */
function isImageName(name) {
  return Object.prototype.hasOwnProperty.call(IMAGE_TYPES, extensionOf(name))
}

/**
 * 驗證上傳的位元組真的是圖片。
 * @returns 正規化後的副檔名。
 * @throws 認不出來時丟錯（呼叫端顯示給使用者）。
 */
export function sniffImageExtension(bytes, declaredName) {
  for (const rule of MAGIC) {
    if (bytes.length >= rule.bytes.length && rule.bytes.every((byte, index) => bytes[index] === byte)) {
      return rule.ext[0]
    }
  }
  // WebP / AVIF 都是 RIFF/ISOBMFF 家族，開頭是長度 + 容器名。
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp'
  }
  if (bytes.length >= 12 && bytes.slice(4, 8).toString('latin1') === 'ftyp') {
    return 'avif'
  }
  const declared = extensionOf(declaredName)
  throw new Error(
    declared === ''
      ? '這不是認得的圖片格式（支援 png / jpg / webp / gif / avif / bmp）'
      : `檔案內容不是 ${declared} 圖片（副檔名和內容不符）`,
  )
}

/**
 * 把使用者給的檔名整理成安全的檔名（保留原樣盡量，只拿掉危險字元）。
 * @returns 乾淨的檔名，或空字串（無法使用時）。
 */
export function safeAssetName(value) {
  if (typeof value !== 'string') return ''
  const base = value.split(/[\\/]/).pop() ?? ''
  const trimmed = base.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..') return ''
  const cleaned = trimmed.replace(/[^\w\u4e00-\u9fff.-]/g, '-').replace(/^[.-]+/, '')
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return ''
  return cleaned.slice(0, 80)
}

/**
 * 把 `base.png` 變成不衝突的名字：`base-2.png`、`base-3.png`…
 * @returns 可以安全寫入的檔名（`taken` 回報的都已用過時，附上時間戳記）。
 */
export function uniqueName(wanted, taken) {
  if (!taken.has(wanted)) return wanted
  const dot = wanted.lastIndexOf('.')
  const stem = dot > 0 ? wanted.slice(0, dot) : wanted
  const ext = dot > 0 ? wanted.slice(dot) : ''
  for (let n = 2; n < 999; n += 1) {
    const candidate = `${stem}-${n}${ext}`
    if (!taken.has(candidate)) return candidate
  }
  return `${stem}-${Date.now().toString(36)}${ext}`
}

/** 確認一個檔名可以安全地當成資產檔名。 */
function requireAssetName(value) {
  const name = safeAssetName(value)
  if (name === '' || !isImageName(name)) {
    throw new Error(`檔名不合法（只接受圖片：png / jpg / webp / gif / avif / bmp）：${String(value)}`)
  }
  return name
}

/** 確認一個資料夾名片段安全（沿用 workspace 的白名單）。 */
function requireIdPart(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} 不可為空`)
  const trimmed = value.trim()
  if (trimmed === '.' || trimmed === '..' || !/^[\w\u4e00-\u9fff.-]+$/.test(trimmed)) {
    throw new Error(`${label} 不合法（只接受英數、中日韓、- _ .）：${String(value)}`)
  }
  return trimmed
}

/**
 * `art/<資料夾>/<擁有者 id>/` 的路徑。
 *
 * `owner` 是由 {@link assetOwner} 產生的：單層（`老闆娘`）或多層（`老闆娘/初次見面`）。
 * 每一層都逐段驗證，所以 `..` 之類的跳脫一定被擋下。
 *
 * @param kind - `character` / `worldbook` / `chat` / `tavern`
 * @param owner - 擁有者 id；`tavern` 不需要
 * @throws 種類不認得或 owner 不合法時丟錯。
 */
export function assetDir(kind, owner) {
  const bucket = ASSET_KINDS[kind]
  if (bucket === undefined) throw new Error(`不認得的資產種類：${String(kind)}`)
  if (kind === 'tavern') return `art/${bucket}`
  // owner 是 assetOwner() 給的 `{ id, name }`；也接受純字串，方便測試直接呼叫。
  const id = typeof owner === 'string' ? owner : owner?.id
  if (typeof id !== 'string' || id === '') throw new Error('資產擁有者 id 不可為空')
  const parts = id
    .split('/')
    .map((part, index) => requireIdPart(part, index === 0 ? '資產擁有者 id' : '資產擁有者子 id'))
  return `art/${bucket}/${parts.join('/')}`
}

/**
 * 列出一個實體的所有圖片。
 * @param root - 酒館資料夾
 * @param kind - 資產種類
 * @param owner - 擁有者 id（`tavern` 省略）
 * @returns `[{ name, bytes, mtimeMs, url }]`，檔名排序（穩定、可預期）。
 */
export async function listAssets(root, kind, owner) {
  const dir = join(root, assetDir(kind, owner))
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const items = []
  for (const entry of entries) {
    if (entry.isFile() !== true) continue
    if (!isImageName(entry.name)) continue
    const info = await stat(join(dir, entry.name)).catch(() => undefined)
    items.push({
      name: entry.name,
      bytes: info === undefined ? 0 : info.size,
      mtimeMs: info === undefined ? 0 : info.mtimeMs,
      url: assetUrl(kind, owner, entry.name),
    })
  }
  return items.sort((left, right) => left.name.localeCompare(right.name)).slice(0, MAX_ASSETS_PER_ENTITY)
}

/** 資產路由的前綴（宿主半註冊的實際路徑）。 */
export const ASSET_ROUTE_PREFIX = '/api/dsh-tavern/assets/'

/**
 * 資產的瀏覽器 URL（絕對路徑，可以直接塞進 `<img src>`）。
 *
 * 每一段都各自 `encodeURIComponent`：擁有者與檔名都可能是中文，而路徑的分隔
 * 字元必須留著，所以不能對整串編碼。
 */
export function assetUrl(kind, owner, name) {
  const bucket = ASSET_KINDS[kind]
  const parts = kind === 'tavern' ? [bucket, name] : [bucket, ...String(owner).split('/'), name]
  return ASSET_ROUTE_PREFIX + parts.map((part) => encodeURIComponent(part)).join('/')
}

/**
 * 解析 `art/<bucket>[/<owner…>]/<name>` 這樣一組 URL 片段，並確認它真的落在酒館裡。
 * @returns 絕對路徑。
 * @throws 片段不合法、種類不認得或層數不對時丟錯。
 */
export function resolveAssetPath(root, segments) {
  if (segments.length < 2) throw new Error('資產路徑需要 /<種類>/<檔名>')
  const [bucket, ...rest] = segments
  const kind = Object.keys(ASSET_KINDS).find((key) => ASSET_KINDS[key] === bucket)
  if (kind === undefined) throw new Error(`不認得的資產種類：${String(bucket)}`)
  const name = rest[rest.length - 1]
  const ownerParts = rest.slice(0, -1)
  if (kind === 'tavern') {
    if (ownerParts.length !== 0) throw new Error('酒館資產不該有擁有者層')
  } else if (kind === 'chat') {
    // chats/<角色>/<assetId>：剛好兩層。
    if (ownerParts.length !== 2) throw new Error('對話資產需要 /chats/<角色>/<對話 id>')
  } else if (ownerParts.length !== 1) {
    throw new Error('這個種類的資產需要一層擁有者 id')
  }
  if (!isImageName(name)) throw new Error(`不是圖片檔名：${String(name)}`)
  const owner = ownerParts.join('/')
  requireAssetName(name)
  return join(root, assetDir(kind, owner), requireAssetName(name))
}

/**
 * 寫入一張圖。
 *
 * @param root - 酒館資料夾
 * @param kind - 資產種類
 * @param owner - 擁有者 id
 * @param options.wantedName - 使用者給的檔名（會被整理成安全檔名）
 * @param options.bytes - 圖片位元組
 * @param options.overwrite - true 時覆蓋同名檔（使用者明確說要換掉）
 * @returns `{ name, bytes, renamed }`；`renamed: true` 表示因為撞名而被自動編號。
 * @throws 內容不是圖片、太大、或同名且未允許覆蓋時丟錯。
 */
export async function writeAsset(root, kind, owner, options) {
  const given = options ?? {}
  const bytes = given.bytes
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('沒有收到圖片內容')
  if (bytes.length > MAX_ASSET_BYTES) {
    throw new Error(`圖片太大（${String(bytes.length)} bytes，上限 ${String(MAX_ASSET_BYTES)}）`)
  }
  const sniffed = sniffImageExtension(bytes, given.wantedName)
  const wanted = safeAssetName(given.wantedName)
  const stem = wanted === '' ? `image-${Date.now().toString(36)}` : wanted.replace(/\.[A-Za-z0-9]+$/, '')
  // 一律用「內容嗅出來的副檔名」：宣告 jpg 但內容是 png 時，存成 .png 才不會讓
  // 瀏覽器用錯的 content-type 去解。
  const requested = `${stem === '' ? `image-${Date.now().toString(36)}` : stem}.${sniffed}`

  const dir = join(root, assetDir(kind, owner))
  await mkdir(dir, { recursive: true })
  const existing = new Set(
    (await readdir(dir, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && isImageName(entry.name))
      .map((entry) => entry.name),
  )
  if (existing.size >= MAX_ASSETS_PER_ENTITY) {
    throw new Error(`這個資料夾已經有 ${String(MAX_ASSETS_PER_ENTITY)} 張圖了，先刪掉一些`)
  }
  if (existing.has(requested) && given.overwrite !== true) {
    const name = uniqueName(requested, existing)
    await atomicWrite(join(dir, name), bytes)
    return { name, bytes: bytes.length, renamed: true }
  }
  await atomicWrite(join(dir, requested), bytes)
  return { name: requested, bytes: bytes.length, renamed: false }
}

/** 刪除一張圖。 */
export async function deleteAsset(root, kind, owner, name) {
  const key = requireAssetName(name)
  await rm(join(root, assetDir(kind, owner), key), { force: true })
  return key
}

/* ------------------------------ 主圖 ------------------------------ */

/** `tavern.json` 裡放中繼資料的欄位名。 */
export const ASSETS_FIELD = 'assets'

/** 主圖清單的形狀：`{ "<kind>:<擁有者名稱>": "<檔名>" }`。 */
export function readPrimaryMap(settings) {
  const raw = settings === null || typeof settings !== 'object' ? undefined : settings[ASSETS_FIELD]
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value !== '') out[key] = safeAssetName(value)
  }
  return out
}

/**
 * 主圖的 key。
 *
 * 用「擁有者名稱」而不是資料夾 id：名稱本來就是唯讀的識別（人物卡的檔名、
 * 世界書的檔名、`角色/對話名`），拿它當 key，就算之後改了 id 正規化規則，
 * 主圖的指定也不會跑掉。
 */
export function primaryKey(kind, ownerName) {
  return kind === 'tavern' ? 'tavern:' : `${kind}:${String(ownerName)}`
}

/**
 * 這個實體目前該顯示哪一張圖。
 *
 * 規則：`tavern.json` 指定且檔案還在 → 用它；否則用檔名排序的第一張。
 * 這樣「刪掉主圖」不會留下壞掉的畫面，也不需要使用者手動重指。
 */
export function pickPrimary(items, map, kind, ownerName) {
  if (items.length === 0) return null
  const wanted = map[primaryKey(kind, ownerName)]
  if (typeof wanted === 'string' && wanted !== '') {
    const found = items.find((item) => item.name === wanted)
    if (found !== undefined) return found
  }
  return items[0]
}

/**
 * 一次拿到某個實體的完整資產狀態。
 *
 * @param root - 酒館資料夾
 * @param kind - 資產種類
 * @param owner - 由 {@link assetOwner} 產生的 `{ id, name }`
 * @param settings - 目前 `tavern.json` 的內容（主圖設定在裡面）
 * @returns `{ kind, id, name, items, primary }`
 */
export async function describeAssets(root, kind, owner, settings) {
  const items = await listAssets(root, kind, owner.id)
  const manifest = readPrimaryMap(settings)
  const primary = pickPrimary(items, manifest, kind, owner.name)
  return {
    kind,
    id: owner.id,
    name: owner.name,
    items,
    primary: primary === null ? null : primary.name,
    primaryKey: primaryKey(kind, owner.name),
  }
}

/**
 * 算出新的主圖設定。
 * @param name - 檔名；`null` 或空字串＝清掉這個實體的主圖
 * @returns 可以直接寫進 `tavern.json` 的 assets 物件。
 */
export function nextPrimaryMap(manifest, kind, ownerName, name) {
  const key = primaryKey(kind, ownerName)
  const next = { ...manifest }
  if (name === null || name === undefined || name === '') delete next[key]
  else next[key] = name
  return next
}
