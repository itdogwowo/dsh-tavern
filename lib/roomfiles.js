/**
 * 房間的**附件**（使用者丟進對話裡的檔案與圖片）。
 *
 * 為什麼要有這一層（決策見 `docs/design-comparison.md` §5 決策 C）：
 *   - 送給模型的那一份走 DSH 的附件服務（圖片 inline、其他檔案拿 receipt），
 *     但**那一份住在 DSH 內部儲存裡**——使用者看不到、備份不到、換台機器就沒了。
 *   - 酒館的立場是「一間房＝一個資料夾，帶走就好」，所以附件**也存一份普通檔案**
 *     在房間裡（`<room>/files/`），訊息用 `extra.media` 指向它（SillyTavern 的形狀）。
 *
 * 三個刻意的決定：
 *   1. **不跟插圖共用 `art/`**：插圖是「這個實體長什麼樣」（會被海報牆、主圖、
 *      表情圖挑選器讀），附件是「這一則訊息夾帶了什麼」。混在一起會讓主圖挑到 PDF。
 *   2. **檔名保留原樣（只清危險字元）**：附件是使用者自己的檔案，改成 `file-1.bin`
 *      他就認不得了。撞名自動編號（跟插圖同一支 `uniqueName`）。
 *   3. **副檔名不白名單**：附件本來就什麼都可以（txt／pdf／zip…）。讀取路由靠
 *      `x-content-type-options: nosniff` 與明確的 content-type 擋掉「HTML 被當文件執行」。
 */
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from './write.js'
import { MAX_ASSET_BYTES, safeAssetName, uniqueName } from './assets.js'

/** 附件住的資料夾（房間底下的相對路徑）。 */
export const ROOM_FILES_DIR = 'files'

/** 單一附件上限：與插圖同一個數字，理由也一樣——超過就明確拒絕，不要默默截斷。 */
export const MAX_ROOM_FILE_BYTES = MAX_ASSET_BYTES

/** 一個房間最多幾個附件（別讓人把整個相簿倒進來讓讀取路由跟著慢）。 */
const MAX_FILES_PER_ROOM = 400

/**
 * 附件 URL 的前綴（**要帶斜線**，用來串 `<img src>`／`<a href>`）。
 *
 * 與 `assets.js` 的 `ASSET_ROUTE_PREFIX` 同一個規矩：宿主半註冊路由用的字串
 * （`index.js` 的 `TAVERN_FILE_PATH`）刻意**不帶**斜線，因為 `webServer` 的
 * prefix 比對會自己補一個再 `startsWith`。合併兩者會讓所有附件靜默 404。
 */
export const ROOM_FILE_ROUTE_PREFIX = '/api/dsh-tavern/files/'

/** `chats/<角色>/<房間 id>/files`。呼叫端給的是房間資料夾的絕對路徑。 */
export function roomFilesDir(roomDir) {
  return join(roomDir, ROOM_FILES_DIR)
}

/**
 * 把使用者給的檔名整理成安全的檔名。
 *
 * 與 `safeAssetName` 的差別只有一處：**不檢查副檔名是不是圖片**——附件什麼都可以。
 */
export function safeFileName(value) {
  return safeAssetName(value)
}

/** 資料夾／路徑片段的白名單（與 `workspace`／`assets` 同一套規則）。 */
function requireSegment(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} 不可為空`)
  const trimmed = value.trim()
  if (trimmed === '.' || trimmed === '..' || !/^[\w\u4e00-\u9fff.-]+$/.test(trimmed)) {
    throw new Error(`${label} 不合法（只接受英數、中日韓、- _ .）：${String(value)}`)
  }
  return trimmed
}

/** 確認一個檔名可以安全地當成附件名（**不限制副檔名**）。 */
export function requireRoomFileName(value) {
  const name = safeFileName(value)
  if (name === '') throw new Error(`檔名不合法：${String(value)}`)
  return name
}

/**
 * 常見附件的 MIME。
 *
 * ⚠️ **預設值是 `application/octet-stream`，不是猜的**：猜錯會讓瀏覽器把內容
 * 當成另一種東西解（例如把 `.txt` 當 HTML）。唯讀用途（圖片預覽）靠這一張表，
 * 其餘一律走下載。
 */
const MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

/** 由檔名推 content-type。 */
export function mimeTypeOf(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(typeof name === 'string' ? name : '')
  const extension = match === null ? '' : match[1].toLowerCase()
  return Object.prototype.hasOwnProperty.call(MIME_TYPES, extension)
    ? MIME_TYPES[extension]
    : 'application/octet-stream'
}

/**
 * 可以**直接 inline**（`<img src>`、點開就看）的型別。
 *
 * ⚠️ **只有點陣圖**。`image/svg+xml` 看起來也是圖片，但它是一個 XML 文件——
 * 同源 inline 開在新分頁時**裡面的 script 會在這個 app 的 origin 上執行**，
 * 等於使用者（或角色卡叫他）丟一個 SVG 進來就能對本機 DSH 發同源請求。
 * 所以 SVG 一律走 `attachment`（下載），而 `<img>` 那一側本來就不執行 SVG 的 script。
 */
const INLINE_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]

/** 這個型別可不可以 inline。 */
export function isInlineMedia(type) {
  return INLINE_MEDIA_TYPES.indexOf(type) >= 0
}

/**
 * 附件的瀏覽器 URL（絕對路徑）。
 *
 * 每一段各自 `encodeURIComponent`：角色與檔名都可能是中文，而 `/` 必須留著。
 */
export function roomFileUrl(character, room, name) {
  const parts = [character, room, name].map((part) => encodeURIComponent(String(part)))
  return ROOM_FILE_ROUTE_PREFIX + parts.join('/')
}

/**
 * 解析 `/<角色>/<房間 id>/<檔名>` 這組 URL 片段，並確認它真的落在某間房裡。
 * @returns 絕對路徑。
 * @throws 片段不合法或層數不對時丟錯。
 */
export function resolveRoomFilePath(root, segments) {
  if (!Array.isArray(segments) || segments.length !== 3) {
    throw new Error('附件路徑需要 /<角色>/<房間 id>/<檔名>')
  }
  const [character, room, name] = segments
  const who = requireSegment(character, '角色 id')
  const id = requireSegment(room, '房間 id')
  const file = requireRoomFileName(name)
  return join(root, 'chats', who, id, ROOM_FILES_DIR, file)
}

/**
 * 列出一個房間的附件。
 * @param roomDir - 房間資料夾的絕對路徑
 * @returns `[{ name, bytes, mtimeMs, url }]`（檔名排序，穩定）。
 */
export async function listRoomFiles(roomDir) {
  const dir = roomFilesDir(roomDir)
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const items = []
  for (const entry of entries) {
    if (entry.isFile() !== true) continue
    const info = await stat(join(dir, entry.name)).catch(() => undefined)
    items.push({
      name: entry.name,
      bytes: info === undefined ? 0 : info.size,
      mtimeMs: info === undefined ? 0 : info.mtimeMs,
    })
  }
  return items.sort((left, right) => left.name.localeCompare(right.name)).slice(0, MAX_FILES_PER_ROOM)
}

/**
 * 寫入一個附件。
 *
 * @param roomDir - 房間資料夾的絕對路徑
 * @param options.wantedName - 使用者給的檔名
 * @param options.bytes - 檔案位元組（**原樣**，附件不做任何轉換）
 * @param options.overwrite - true 時覆蓋同名檔
 * @returns `{ name, bytes, renamed }`
 * @throws 沒有內容、太大、或同名且未允許覆蓋時丟錯。
 */
export async function writeRoomFile(roomDir, options) {
  const given = options ?? {}
  const bytes = given.bytes
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('沒有收到檔案內容')
  if (bytes.length > MAX_ROOM_FILE_BYTES) {
    throw new Error(`檔案太大（${String(bytes.length)} bytes，上限 ${String(MAX_ROOM_FILE_BYTES)}）`)
  }
  const wanted = requireRoomFileName(given.wantedName)

  const dir = roomFilesDir(roomDir)
  await mkdir(dir, { recursive: true })
  const existing = new Set(
    (await readdir(dir, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  )
  if (existing.size >= MAX_FILES_PER_ROOM) {
    throw new Error(`這間房已經有 ${String(MAX_FILES_PER_ROOM)} 個附件了，先刪掉一些`)
  }
  if (existing.has(wanted) && given.overwrite !== true) {
    const name = uniqueName(wanted, existing)
    await atomicWrite(join(dir, name), bytes)
    return { name, bytes: bytes.length, renamed: true }
  }
  await atomicWrite(join(dir, wanted), bytes)
  return { name: wanted, bytes: bytes.length, renamed: false }
}

/** 刪除一個附件。 */
export async function deleteRoomFile(roomDir, name) {
  const key = requireRoomFileName(name)
  await rm(join(roomFilesDir(roomDir), key), { force: true })
  return key
}

/**
 * 把訊息上的 `media` 收斂成可以寫進 `extra.media` 的形狀。
 *
 * 形狀跟著 SillyTavern（`extra.media` 是 SillyTavern 自己的欄位）：
 * `[{ type, url, name, bytes }]`。壞掉的值一律**丟掉**，不要讓一行壞資料讓整則訊息寫不進去。
 */
export function normalizeMediaList(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const url = typeof item.url === 'string' ? item.url : ''
    const name = typeof item.name === 'string' ? item.name : ''
    if (url === '' && name === '') continue
    out.push({
      // 只有兩種：圖片（畫出來）與檔案（一顆 chip）。
      type: item.type === 'image' ? 'image' : 'file',
      url,
      name,
      bytes: typeof item.bytes === 'number' && item.bytes >= 0 ? item.bytes : 0,
    })
  }
  return out
}
