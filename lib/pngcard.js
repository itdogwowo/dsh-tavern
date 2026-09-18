/**
 * PNG 角色卡：把資料從 PNG 的 tEXt chunk 裡讀出來。
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
 *
 * **只做讀，不做寫。** 兩個參考專案（SillyTavern 以外的）也都只做單向：
 * PNG 內嵌是「讀別人的卡」的需求，不是「存自己的卡」的需求。我們自己的儲存格式是
 * `characters/<id>.json`（見 docs/design-comparison.md §2）。
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
