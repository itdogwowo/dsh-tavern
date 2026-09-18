/**
 * 世界書的**觸發**邏輯。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 為什麼這一塊要自己寫：SillyTavern 的世界書觸發是它自己原始碼裡的一段，
 * 沒有抽成可重用的東西。我們要用就得自己實作——**照它的規則，不是自己發明**。
 * 下面每一條的語意都對應 ST 的實作（`public/scripts/world-info.js`）。
 *
 * ## 我們做哪些、刻意不做哪些
 *
 * | ST 的功能 | 我們 | 為什麼 |
 * |---|---|---|
 * | `constant`（無條件觸發） | ✅ | 最基本的一種 |
 * | `key` 單一關鍵字 | ✅ | |
 * | `keysecondary` ＋ `selectiveLogic` 四種邏輯 | ✅ | 這是「標準」等級的核心 |
 * | `caseSensitive` / `matchWholeWords` | ✅ | 便宜而且會影響正確性 |
 * | `order` 排序 | ✅ | |
 * | 預算上限 | ✅ 但用**字元數**不是 token | 見下 |
 * | `position` 八種插入位置 | ❌ **只有一種** | DSH 的 session 只給我們「使用者訊息」一個槓桿 |
 * | `depth` / `role` | ❌ | 同上 |
 * | `probability` / `sticky` / `cooldown` / `delay` | ❌ | 我們只有一種插入位置，做了也發揮不出效果 |
 * | **遞迴**（條目內容觸發下一個條目） | ❌ | 同上：複雜度高、效果有限 |
 *
 * ## 預算用字元數而不是 token
 *
 * ST 用 `world_info_budget`（預設 25% 的上下文）配 tokenizer。我們**不引入
 * tokenizer**（零執行期依賴），所以用字元數上限。這是不精確的，但：
 *   - 它只是一個「不要把上下文塞爆」的保險絲，不是精算；
 *   - 寧可保守（寧可少塞一點），不要為了精確去依賴一個 tokenizer。
 * ────────────────────────────────────────────────────────────────────────
 */

/** 掃描時最多注入多少字元（保險絲，不是精算）。 */
export const DEFAULT_BUDGET_CHARS = 6000

/** 一條條目的 `selectiveLogic` 值（跟 ST 的常數對齊）。 */
export const SELECTIVE_LOGIC = {
  AND_ANY: 0,
  NOT_ALL: 1,
  NOT_ANY: 2,
  AND_ALL: 3,
}

/**
 * 把一本世界書的 `entries` 正規化成陣列。
 *
 * 兩種方言都要吃（跟 `lib/workspace.js` 的無損往返測試對應）：
 *   - **原生**：`{ entries: { "0": {...}, "1": {...} } }`——以字串化 uid 為 key 的物件
 *   - **V2 內嵌**：`{ entries: [ {...}, {...} ] }`
 */
export function normalizeEntries(book) {
  if (book === null || typeof book !== 'object') return []
  const entries = book.entries
  if (Array.isArray(entries)) return entries.filter((entry) => entry !== null && typeof entry === 'object')
  if (entries !== null && typeof entries === 'object') {
    return Object.values(entries).filter((entry) => entry !== null && typeof entry === 'object')
  }
  return []
}

/** 取一條條目的關鍵字陣列（ST 的欄位叫 `key`；V2 方言叫 `keys`）。 */
function keysOf(entry) {
  const raw = Array.isArray(entry.key) ? entry.key : Array.isArray(entry.keys) ? entry.keys : []
  return raw.filter((key) => typeof key === 'string' && key !== '')
}

/** 取次要關鍵字陣列。 */
function secondaryKeysOf(entry) {
  const raw = Array.isArray(entry.keysecondary)
    ? entry.keysecondary
    : Array.isArray(entry.secondary_keys)
      ? entry.secondary_keys
      : []
  return raw.filter((key) => typeof key === 'string' && key !== '')
}

/** 純 ASCII 英數字的關鍵字（只有這種才適用 `\W` 邊界，見 `matchesKey`）。 */
const ASCII_WORD_KEY = /^[A-Za-z0-9_]+$/

/**
 * 單一關鍵字比對。
 *
 * ST 的規則（`matchKeys`）：
 *   - `/regex/` 形式的關鍵字**繞過**所有比對選項，直接當正則用
 *   - `caseSensitive` 決定要不要把兩邊都轉小寫
 *   - `matchWholeWords`：單字關鍵字用 `(?:^|\W)(key)(?:$|\W)`，多字關鍵字用單純的 includes
 *
 * ⚠️ **我們在 `matchWholeWords` 上偏離 ST，理由是它的實作對中文是壞的。**
 *
 * JavaScript 的 `\w` 只有 `[A-Za-z0-9_]`，所以中文一律算 `\W`。於是 ST 的
 * `(?:^|\W)酒(?:$|\W)` 在「**酒店**大亨」裡**會命中**——前一個字是 `\W`、
 * 後一個字也是 `\W`。測試 `test-worldbook.mjs` §2 把這條釘住了。
 *
 * 中文沒有空白分詞，「整詞」沒有一個可靠的定義（要正確就得引入分詞器，
 * 那是零執行期依賴的反面）。所以我們的規則是：
 *   - **純 ASCII 的關鍵字**：照 ST 用 `\W` 邊界（這一種它做對了）
 *   - **含中文（或任何非 ASCII）的關鍵字**：整詞模式**無效**，退回包含比對
 *
 * 選「無效」而不是「用壞掉的邊界」，是因為兩者的錯法不對稱：
 * 無效只是少擋了一些誤命中（多注入一點設定），壞掉的邊界則會**默默讓設定
 * 該出現時不出現**——後者使用者根本查不出來。
 */
export function matchesKey(haystack, needle, options) {
  const caseSensitive = options?.caseSensitive === true
  const text = caseSensitive ? haystack : haystack.toLowerCase()

  // `/.../` 形式：ST 讓它繞過其他選項。壞掉的正則**當作不匹配**（不是丟錯）。
  const asRegex = /^\/(.+)\/([a-z]*)$/.exec(needle)
  if (asRegex !== null) {
    try {
      return new RegExp(asRegex[1], caseSensitive ? asRegex[2].replace('i', '') : asRegex[2] || 'i').test(haystack)
    } catch (error) {
      return false
    }
  }

  const wanted = caseSensitive ? needle : needle.toLowerCase()
  if (options?.matchWholeWords !== true) return text.includes(wanted)
  // 多字關鍵字（含空白）用 includes——ST 也是這樣（用 \W 包一個片語沒有意義）。
  if (/\s/.test(wanted)) return text.includes(wanted)
  // 非 ASCII（例如中文）沒有可靠的詞邊界 → 整詞模式無效，退回包含比對。
  if (ASCII_WORD_KEY.test(wanted) === false) return text.includes(wanted)
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`).test(text)
  } catch (error) {
    return text.includes(wanted)
  }
}

/**
 * 這條條目在這次掃描中要不要觸發。
 *
 * 判斷順序照 ST（`world-info.js` 的 per-entry gates），但只保留我們支援的幾道。
 *
 * @param entry - 一條世界書條目。
 * @param scanText - 這次要掃描的文字（**已經**依大小寫敏感度處理前的原文）。
 * @param options - `{ caseSensitive, matchWholeWords }`。
 * @returns 觸發原因：`'constant'`、`'key'` 或 `null`。
 */
export function activationOf(entry, scanText, options) {
  // `disable` 是硬跳過——使用者明確關掉的東西不該因為別的原因跑出來。
  if (entry.disable === true || entry.enabled === false) return null

  // `constant`：不用關鍵字，永遠出現。
  if (entry.constant === true) return 'constant'

  const primary = keysOf(entry)
  // 沒有關鍵字又不是 constant → 永遠不會被選到（ST 也是跳過）。
  if (primary.length === 0) return null

  const hitPrimary = primary.some((key) => matchesKey(scanText, key, options))
  if (hitPrimary === false) return null

  const secondary = secondaryKeysOf(entry)
  // `selective` 關掉、或沒有次要關鍵字 → 主關鍵字中了就算中。
  if (entry.selective !== true || secondary.length === 0) return 'key'

  const hits = secondary.map((key) => matchesKey(scanText, key, options))
  const logic = typeof entry.selectiveLogic === 'number' ? entry.selectiveLogic : SELECTIVE_LOGIC.AND_ANY
  let pass
  switch (logic) {
    case SELECTIVE_LOGIC.NOT_ALL:
      pass = hits.some((hit) => hit === false)
      break
    case SELECTIVE_LOGIC.NOT_ANY:
      pass = hits.every((hit) => hit === false)
      break
    case SELECTIVE_LOGIC.AND_ALL:
      pass = hits.every((hit) => hit === true)
      break
    case SELECTIVE_LOGIC.AND_ANY:
    default:
      pass = hits.some((hit) => hit === true)
      break
  }
  return pass ? 'key' : null
}

/** 條目的顯示名（給訊息用；`comment` 是 ST 的欄位）。 */
function labelOf(entry) {
  if (typeof entry.comment === 'string' && entry.comment.trim() !== '') return entry.comment.trim()
  const keys = keysOf(entry)
  return keys.length > 0 ? keys.join('/') : `uid ${String(entry.uid ?? '?')}`
}

/**
 * 從好幾本世界書裡挑出這次要注入的條目。
 *
 * @param books - `[{ id, data }]`（`id` 是檔名，只用來除錯）。
 * @param scanText - 要掃描的文字。
 * @param options - `{ caseSensitive, matchWholeWords, budgetChars }`。
 * @returns `{ entries, text, truncated }`——`entries` 是挑中的（已排序），`text` 是接好的字。
 *
 * 排序照 ST：`order` **由大到小**（大的先出現）。相同 `order` 時用 uid 遞增，
 * 這樣同一組輸入永遠得到同一個順序（可重現，測試才有意義）。
 */
export function collectLore(books, scanText, options) {
  const budget = typeof options?.budgetChars === 'number' && options.budgetChars > 0 ? options.budgetChars : DEFAULT_BUDGET_CHARS
  const picked = []

  for (const book of Array.isArray(books) ? books : []) {
    for (const entry of normalizeEntries(book?.data)) {
      const reason = activationOf(entry, scanText, options)
      if (reason === null) continue
      const content = typeof entry.content === 'string' ? entry.content.trim() : ''
      if (content === '') continue
      picked.push({
        book: typeof book?.id === 'string' ? book.id : '',
        uid: typeof entry.uid === 'number' ? entry.uid : 0,
        order: typeof entry.order === 'number' ? entry.order : 100,
        label: labelOf(entry),
        content,
        reason,
      })
    }
  }

  picked.sort((left, right) => (right.order - left.order) || (left.uid - right.uid))

  // 預算：**先到先得**，超過就停。不切斷單一條目——半條設定比沒有更糟。
  const kept = []
  let used = 0
  let truncated = false
  for (const entry of picked) {
    if (used + entry.content.length > budget) {
      truncated = true
      continue
    }
    kept.push(entry)
    used += entry.content.length
  }

  return { entries: kept, text: kept.map((entry) => entry.content).join('\n\n'), truncated }
}

/**
 * 把注入的文字接在**最新一則使用者訊息**前面。
 *
 * ⚠️ 這是我們跟 ST 最大的差別，要說清楚：
 *   ST 的 `position` 有八種（角色定義前／後、Author's Note 上下、對話中第 N 層、
 *   範例對話開頭／結尾、outlet）。**我們只有這一種**——因為 DSH 的 session
 *   只給我們「使用者訊息」一個槓桿（系統提示是開 session 時固定的，不能每輪改）。
 *
 * 為什麼接在**最新**那一則而不是第一則：KV 快取是**前綴**快取。接在尾端只會讓
 * 尾端失效，前面的前綴照樣命中（實測第 2 輪起 77～82%）。
 *
 * @param messages - `agent/pre-step` 給的 `payload.messages`（**不要改原陣列**）。
 * @param lore - 要注入的文字。
 * @returns 新的訊息陣列；沒有使用者訊息時原樣回傳。
 */
export function prependLore(messages, lore) {
  if (typeof lore !== 'string' || lore.trim() === '') return messages
  if (Array.isArray(messages) === false || messages.length === 0) return messages

  let target = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user' && Array.isArray(messages[index].content)) {
      target = index
      break
    }
  }
  if (target < 0) return messages

  const original = messages[target]
  // **只換 content，其他欄位（id / role / source）全部保留。**
  // 這是刻意的：`id` 是耐久紀錄的識別碼，自己生一個新的有風險。
  const next = [...messages]
  next[target] = { ...original, content: [{ type: 'text', text: lore }, ...original.content] }
  return next
}

/** 把訊息陣列裡所有文字區塊接起來（給掃描用）。 */
export function textOfMessages(messages) {
  if (Array.isArray(messages) === false) return ''
  const parts = []
  for (const message of messages) {
    if (Array.isArray(message?.content) === false) continue
    for (const block of message.content) {
      if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
      }
    }
  }
  return parts.join('\n')
}
