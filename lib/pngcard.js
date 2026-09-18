/**
 * PNG 角色卡：把卡片資料從 PNG 的 tEXt chunk 裡讀出來，也寫回去。
 *
 * 格式（對照 SillyTavern 的 `src/character-card-parser.js`）：
 *
 *   PNG 檔
 *   ├── IHDR
 *   ├── tEXt  keyword = "chara"  →  base64( UTF-8 JSON )   ← V2
 *   ├── tEXt  keyword = "ccv3"   →  base64( UTF-8 JSON )   ← V3
 *   └── IEND
 *
 *   - 關鍵字**不分大小寫**
 *   - **ccv3 優先**，沒有才退回 chara
 *   - 解碼鏈是 base64 → UTF-8 → JSON
 *   - ⚠️ 塞的是 **base64**，不是原始 JSON。直接塞 JSON 不會報錯，
 *     只會在讀的時候變成亂碼——這個坑踩過一次，所以 `base64` 這件事
 *     只在下面兩個函式裡出現，測試也盯著它。
 *
 * 讀與寫都在這個檔案，因為「格式長什麼樣子」只能有一個住處。
 * 寫入是**接區塊**、不是重新編碼：`tEXt` 插在 `IEND` 之前，
 * `IDAT` 的像素資料一格都不動（畫質零損失，而且不需要任何影像函式庫）。
 *
 * 我們自己的儲存格式仍然是 `characters/<id>.json`（見 docs/design-comparison.md §2）；
 * PNG 是**交換格式**——用來讀別人的卡、以及把自己的人物卡匯出成一份可以分享的檔案。
 *
 * ⚠️ 這個檔案自己走 chunk，**不相信任何長度欄位**。PNG 的每個 chunk 開頭是 4 bytes
 * 的長度，一個壞檔（或惡意檔）可以宣告 4GB，如果照著 allocate 就是一個現成的
 * 阻斷服務。所以每一步都先確認「剩下的位元組夠不夠」再往前走。
 */
import { Buffer } from 'node:buffer'

/** PNG 檔頭（8 bytes）。 */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 認得的卡片關鍵字（比對時轉小寫）。 */
const CARD_KEYWORDS = ['ccv3', 'chara']

/**
 * 單一 chunk 的資料上限。
 *
 * 真正的卡片 JSON 通常幾十 KB，就算把整本內嵌世界書算進去也很少超過幾 MB。
 * 設上限的用途是「壞檔不要害我們 allocate 一大塊」——超過就當作這個 chunk 不存在，
 * 繼續找下一個，而不是爆掉。
 */
const MAX_CHUNK_BYTES = 16 * 1024 * 1024

/** 一張卡最多掃幾個 chunk（防無限迴圈；正常 PNG 不會有幾千個 chunk）。 */
const MAX_CHUNKS = 10_000

/**
 * 這個 buffer 是不是 PNG。
 * @param bytes - 檔案內容
 */
export function isPng(bytes) {
  return (
    Buffer.isBuffer(bytes) &&
    bytes.length >= SIGNATURE.length &&
    SIGNATURE.every((byte, index) => bytes[index] === byte)
  )
}

/**
 * 走過 PNG 的 chunk，把 tEXt 的文字 chunk 收集起來。
 *
 * @param bytes - PNG 檔內容
 * @returns `[{ keyword, text }]`
 * @throws 不是 PNG，或結構壞到走不下去時丟錯
 */
export function readTextChunks(bytes) {
  if (!isPng(bytes)) throw new Error('這不是 PNG 檔（檔頭不對）')

  const chunks = []
  let offset = SIGNATURE.length
  let scanned = 0

  while (offset + 8 <= bytes.length) {
    scanned += 1
    if (scanned > MAX_CHUNKS) throw new Error('PNG 的 chunk 數量異常，停止解析')

    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const next = dataEnd + 4 // 4 bytes CRC

    // 關鍵：長度宣告的範圍必須真的落在檔案裡。不信任長度欄位就是這一行。
    if (length > MAX_CHUNK_BYTES || dataEnd > bytes.length || next > bytes.length) {
      throw new Error(`PNG 的 ${type} chunk 長度不合法（宣告 ${String(length)} bytes）`)
    }

    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataEnd)
      const separator = data.indexOf(0x00)
      if (separator > 0) {
        const keyword = data.toString('latin1', 0, separator)
        // tEXt 的內容依規範是 latin1；卡片資料是 base64 的 ASCII，所以這樣取就夠。
        const text = data.toString('latin1', separator + 1)
        chunks.push({ keyword, text })
      }
    }

    if (type === 'IEND') break
    offset = next
  }

  return chunks
}

/**
 * 從 PNG 裡讀出角色卡 JSON。
 *
 * @param bytes - PNG 檔內容
 * @returns `{ card, keyword }`；`card` 是解析後的物件，`keyword` 是它來自哪個 chunk
 * @throws 不是 PNG、沒有卡片資料、或 base64/JSON 解不開時丟錯（訊息要能直接給使用者看）
 */
export function readCardFromPng(bytes) {
  const text = findCardText(bytes)
  let parsed
  try {
    parsed = JSON.parse(text.data)
  } catch (error) {
    throw new Error(`PNG 裡的卡片資料不是合法 JSON（${text.keyword} chunk）：${String(error?.message ?? error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PNG 裡的卡片資料不是物件')
  }
  return { card: parsed, keyword: text.keyword }
}

/**
 * 找出卡片資料並解 base64。
 * @returns `{ data, keyword }`
 */
export function findCardText(bytes) {
  const chunks = readTextChunks(bytes)
  if (chunks.length === 0) throw new Error('這個 PNG 沒有 tEXt 文字區塊，裡面沒有卡片資料')

  // ccv3 優先（V3 比 V2 新，而且 SillyTavern 也是這樣挑的）。
  for (const keyword of CARD_KEYWORDS) {
    const found = chunks.find((chunk) => chunk.keyword.toLowerCase() === keyword)
    if (found !== undefined) {
      return { data: decodeBase64(found.text, found.keyword), keyword: found.keyword }
    }
  }

  const seen = chunks.map((chunk) => chunk.keyword).join(', ')
  throw new Error(`這個 PNG 沒有角色卡資料（找到的文字區塊：${seen}）`)
}

/**
 * base64 → UTF-8 字串。
 *
 * 用 `Buffer.from(..., 'base64')` 而不是寬鬆的 decodeURIComponent 組合：
 * 它對不合法的字元是**忽略**而不是丟錯，所以這裡再檢查一次「解出來是不是空的」。
 */
function decodeBase64(value, keyword) {
  const cleaned = value.replace(/\s+/g, '')
  if (cleaned === '') throw new Error(`PNG 的 ${keyword} 區塊是空的`)
  const decoded = Buffer.from(cleaned, 'base64').toString('utf8')
  if (decoded.trim() === '') throw new Error(`PNG 的 ${keyword} 區塊解不出內容`)
  return decoded
}

/* --------------------------------- 寫入 --------------------------------- */

/**
 * CRC32 查表。
 *
 * PNG 規定每個 chunk 尾巴要帶「型別＋內容」的 CRC32。讀的時候我們不驗它
 * （別人的卡不該因為一個 CRC 就讀不了），但寫出去的檔案要是合法的，
 * 否則別的軟體會拒收。
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value
  }
  return table
})()

/**
 * @param bytes - 要算 CRC 的位元組
 */
function crc32(bytes) {
  let value = -1
  for (let index = 0; index < bytes.length; index += 1) {
    value = CRC_TABLE[(value ^ bytes[index]) & 0xff] ^ (value >>> 8)
  }
  return (value ^ -1) >>> 0
}

/**
 * 組出一個 tEXt chunk（含長度、型別與 CRC）。
 *
 * @param keyword - 區塊關鍵字（`chara`／`ccv3`）
 * @param value - 區塊內容（latin1 可表示的 ASCII；卡片資料是 base64，符合規範）
 */
function textChunk(keyword, value) {
  const payload = Buffer.concat([
    Buffer.from(`${keyword}\0`, 'latin1'),
    Buffer.from(value, 'latin1'),
  ])
  const chunk = Buffer.alloc(12 + payload.length)
  chunk.writeUInt32BE(payload.length, 0)
  chunk.write('tEXt', 4, 'latin1')
  payload.copy(chunk, 8)
  chunk.writeUInt32BE(
    crc32(Buffer.concat([Buffer.from('tEXt', 'latin1'), payload])),
    8 + payload.length,
  )
  return chunk
}

/**
 * 把卡片資料接進 PNG，回傳新的 PNG。
 *
 * **不重新編碼**：`tEXt` 插在 `IEND` 之前，`IDAT` 原封不動，所以畫質零損失，
 * 也不需要任何影像函式庫。原本就有的卡片區塊會**留著**——`ccv3` 優先的規則
 * 由讀取端決定，寫入端不該偷偷改寫別人的資料。
 *
 * @param bytes - 原始 PNG 檔內容
 * @param card - 卡片物件（會被 `JSON.stringify`）
 * @param options - `{ keyword }`，預設 `chara`（V2，相容性最好的那個）
 * @returns 新的 PNG buffer
 * @throws 不是 PNG、或結構壞到找不到 `IEND` 時丟錯
 */
export function writeCardIntoPng(bytes, card, options = {}) {
  if (!isPng(bytes)) throw new Error('這不是 PNG 檔（檔頭不對）')
  const keyword = options.keyword === undefined ? 'chara' : String(options.keyword)
  const value = Buffer.from(JSON.stringify(card), 'utf8').toString('base64')

  // 走一次 chunk 找 IEND；順便套用同一套「不相信長度欄位」的檢查。
  let offset = SIGNATURE.length
  let scanned = 0
  while (offset + 8 <= bytes.length) {
    scanned += 1
    if (scanned > MAX_CHUNKS) throw new Error('PNG 的 chunk 數量異常，停止解析')
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const next = offset + 8 + length + 4
    if (length > MAX_CHUNK_BYTES || next > bytes.length) {
      throw new Error(`PNG 的 ${type} chunk 長度不合法（宣告 ${String(length)} bytes）`)
    }
    if (type === 'IEND') {
      return Buffer.concat([bytes.subarray(0, offset), textChunk(keyword, value), bytes.subarray(offset)])
    }
    offset = next
  }
  throw new Error('PNG 少了 IEND 區塊（檔案不完整）')
}
