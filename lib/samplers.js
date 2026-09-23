/**
 * 生成參數（`temperature`／`maxTokens`／`stop`）：驗證、正規化，以及「誰蓋過誰」。
 *
 * ────────────────────────────────────────────────────────────────────────
 * ⚠️ **為什麼只有這三個：DSH 的介面就只有這三個。**
 *
 * `LlmCallConfig`（`dsh-llm/lib/types/call-config.d.ts`）的欄位是
 * `provider`／`model`／`reasoningEffort`／`temperature`／`maxTokens`／`stop`——
 * **沒有 `top_p`**，底層的 `GenerateOptions` 也沒有。
 *
 * ⚠️ 而且那不是「還沒做」，是**DSH 刻意拿掉的**。它的 README 寫在
 * 「Known limitations and deferred work」那一節（`dsh-llm/README.md:154`，
 * 中文版 `README.zh.md:154`）：
 *
 *   > **`GenerateOptions` sampling is `temperature`/`maxTokens`/`stop` only**
 *   > — no `tool_choice`, `top_p`, or penalty fields
 *
 * 後面還掛著一篇設計註記叫 **`drop-inert-request-knobs`**（拿掉沒有作用的旋鈕）
 * ——也就是說「做一個存得起來但不會生效的參數」正是 DSH 自己判定要避免的事。
 * 我們跟它同一條理由，不是我們偷懶。
 *
 * 所以這裡刻意**不做 `top_p`**。做一個「存得起來、但送不出去」的欄位比沒有這個
 * 欄位更糟：使用者會調它、會存它、會以為它生效了，而模型收到的請求裡根本沒有它。
 * 這一條要留在程式碼裡，不然下一個人（或下一輪的我）會想「順手補上 top_p 吧」。
 * ────────────────────────────────────────────────────────────────────────
 *
 * 為什麼要獨立成一個模組：同一條規則有三個地方要用——
 *   1. **宿主半寫入時要驗**（`workspace.js`）：不合法的值不准進使用者的檔案
 *   2. **agent 面每一輪要算**「這一間房最後用什麼」（`agent.js`）
 *   3. **客戶端要顯示**目前的值（`settings` / `room.read` 回來的那一份）
 *
 * 抄三份的結果是「面板顯示 0.8、實際送 0.7」——這種不一致最難查，因為兩邊
 * 看起來都對。而且這一支是**純函式**，所以它可以被單獨測（`test-samplers.mjs`）。
 *
 * @module dsh-tavern/samplers
 */

/**
 * `temperature` 的合法範圍。
 *
 * 0～2 是 OpenAI 相容介面的共識（DeepSeek 自己的文件也是這個範圍）。超出範圍
 * **不夾到邊界**而是判定不合法——把 5 靜靜變成 2 會讓使用者以為自己設成功了。
 */
export const TEMPERATURE_RANGE = { min: 0, max: 2 }

/**
 * `maxTokens` 的合法範圍。
 *
 * 上限刻意寬（20 萬）：真正的上限取決於模型，而那是**提供方**的事——DSH 的
 * `prepareCall` 會拿模型自己的限制去處理。這裡只擋「明顯不是 token 數」的東西
 * （負數、0、1e9、有小數點的 3.5）。
 */
export const MAX_TOKENS_RANGE = { min: 1, max: 200000 }

/**
 * 這幾個欄位的名字（給 UI／錯誤訊息／測試共用，免得三處各寫一份字串）。
 *
 * ⚠️ **順序是「純量在前、清單在後」**，而且這個順序就是 UI 上的順序
 * （`client.js` 的 ⚙️ 設定 與 ⚙️ 房間 都照這個順序畫）。改順序＝改畫面。
 */
export const SAMPLER_KEYS = ['temperature', 'maxTokens', 'stop']

/**
 * `stop` 序列這一組的界線。
 *
 * ⚠️ **這兩個數字不是 DSH 的限制，是我們的**——DSH 的 `stop?: string[]`
 * 沒有任何數量或長度上限。借用 `package.json` 那條註解的講法：
 * 這裡的驗證**不是安全檢查**（它影響不了檔案系統），是**誠實**與**可用性**：
 *
 *   - `count`：OpenAI 相容介面普遍的上限就是 4（Anthropic 自己也是 4）。
 *     我們放到 16 是為了「酒館要擋的是模型替你說話的幾種開頭」這種用法——
 *     真的送超過提供方上限的數量出去，症狀是**整個請求被拒絕**，
 *     而那比「少一個 stop」難懂太多。
 *   - `length`：一個 stop 序列長到 64 個字元就已經比一整句話長了。
 *     再長的話模型要吐幾個字元才停得下來，那個 stop 等於沒有作用。
 *
 * ⚠️ 而且這**不是** `MAX_TOKENS_RANGE` 那一種「真正的上限在提供方」的欄位：
 * 這兩個數字是我們自己選的，所以拒絕的時候要說得出理由（見 `stopProblem`）。
 */
export const STOP_LIMITS = { count: 16, length: 64 }

/**
 * `stop` 的**開關**——以及打開時內建要送出去的那幾串。
 *
 * ────────────────────────────────────────────────────────────────────────
 * ⚠️ **為什麼要有這一組「內建」的**（而不是只讓使用者自己填）：
 *
 * 2.6.56 做出來的是一個純粹的欄位——想擋住模型替你說話，就得自己知道要填
 * 「\n使用者：」。那等於把「知道怎麼寫提示詞」變成使用這個功能的前提，
 * 而使用者要的其實只是一顆開關。
 *
 * ⚠️ **開關是「多送這幾串」，不是「取代你填的」**：開著的時候送的是
 * `內建 ＋ 你自己加的`，關掉才是全部不送。這樣「我只想用自己的那一組」
 * （把自填的寫進去、開關關掉……不行，關掉就全不送了）與
 * 「我要內建那一組再加一個」都是同一個介面——**前者請用自填欄位**。
 *
 * ⚠️ 這一組的內容**不是 DSH 的、也不是我們發明的格式**——它們就是中文與英文
 * 小說裡「換人說話」的排版本身，而那正是模型替你說話時一定會吐出來的東西。
 * 送出時帶前導換行（`\n`）是刻意的：**沒有換行的「使用者：」會誤傷**正文裡
 * 剛好提到「使用者：」的那種句子（例如角色正在讀一份說明）。
 * ────────────────────────────────────────────────────────────────────────
 */
export const STOP_PRESET = ['\n使用者：', '\nUser:', '\n我：', '\nYou:']

/**
 * 開關的欄位名。
 *
 * ⚠️ 它與 `stop` 是**兩件事**：`stopEnabled` 是「開不開」，`stop` 是
 * 「你自己還要加什麼」。合併成一個欄位（`stop: null` 或陣列）的話，
 * 「我有自填但開關關著」與「我沒有自填」就分不出來了。
 */
export const STOP_ENABLED_KEY = 'stopEnabled'

/**
 * 這一輪**真的要送出去**的 stop 清單。
 *
 * @param resolved - `resolveSamplers()` 的結果。
 * @returns 清單（可能是空的＝**不送**）。
 *
 * ⚠️ 內建與自填的**順序**在這裡決定，而且是「內建在前、自填在後」：
 * stop 的順序對模型沒有意義，但對**讀日誌的人**有意義——前幾串永遠是內建的，
 * 一眼就分得出「這是開關帶來的」還是「他自己加的」。
 */
export function effectiveStop(resolved) {
  if (resolved === null || typeof resolved !== 'object' || resolved[STOP_ENABLED_KEY] !== true) return []
  const custom = Array.isArray(resolved.stop) ? resolved.stop : []
  const out = []
  for (const one of STOP_PRESET.concat(custom)) {
    if (typeof one === 'string' && one !== '' && out.includes(one) === false) out.push(one)
  }
  return out
}

/**
 * 值是「沒有設定」的意思嗎（`null`／`undefined`／空字串都算）。
 *
 * ⚠️ **空陣列不算在裡面**，那由 `stopProblem`／`normalizeStop` 自己處理
 * ——「`[]` ＝ 沒有設定」是 `stop` 這一欄專屬的規矩，不要偷偷塞進這支共用函式
 * （那會讓 `[]` 在 `temperature` 那一邊也變成合法值）。
 */
function isUnset(value) {
  return value === null || value === undefined || value === ''
}

/**
 * `temperature` 的值有問題嗎？
 *
 * @param value - 使用者送來的值（可能是數字、數字字串、`null`、或亂七八糟的東西）。
 * @returns `''`＝沒問題（含「清除」）；否則回一句可以直接給使用者看的話。
 *
 * 為什麼接受「數字字串」：HTML 的 `<input type="number">` 在某些情況下給的是
 * 字串，而 `tavern.json` 是可以手改的。把 `"0.8"` 判成不合法只會讓使用者困惑。
 */
export function temperatureProblem(value) {
  if (isUnset(value)) return ''
  const num = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof num !== 'number' || Number.isFinite(num) === false) return '要是數字'
  if (num < TEMPERATURE_RANGE.min || num > TEMPERATURE_RANGE.max) {
    return `要在 ${TEMPERATURE_RANGE.min} 到 ${TEMPERATURE_RANGE.max} 之間`
  }
  return ''
}

/**
 * `maxTokens` 的值有問題嗎？
 *
 * @param value - 同上。
 * @returns `''`＝沒問題；否則回一句給使用者看的話。
 */
export function maxTokensProblem(value) {
  if (isUnset(value)) return ''
  const num = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof num !== 'number' || Number.isFinite(num) === false) return '要是數字'
  if (Number.isInteger(num) === false) return '要是整數'
  if (num < MAX_TOKENS_RANGE.min || num > MAX_TOKENS_RANGE.max) {
    return `要在 ${MAX_TOKENS_RANGE.min} 到 ${MAX_TOKENS_RANGE.max} 之間`
  }
  return ''
}

/**
 * 正規化成要存進檔案的形狀。
 *
 * @param value - 使用者送來的值。
 * @returns 合法的數字，或 `null`（＝沒有設定／要清除）。
 *
 * ⚠️ 不合法時回 `null`（而不是丟錯、也不是夾到邊界）：呼叫端要先問過
 * `temperatureProblem()`，把「不合法」回報給使用者；這支只負責「存什麼」。
 */
export function normalizeTemperature(value) {
  if (temperatureProblem(value) !== '') return null
  if (isUnset(value)) return null
  const num = typeof value === 'string' ? Number(value.trim()) : value
  // 兩位小數就夠了（0.85 這種），而且避免 0.1+0.2 那類浮點尾巴寫進 JSON。
  return Math.round(num * 100) / 100
}

/** 同 `normalizeTemperature()`，for `maxTokens`。 */
export function normalizeMaxTokens(value) {
  if (maxTokensProblem(value) !== '') return null
  if (isUnset(value)) return null
  return typeof value === 'string' ? Number(value.trim()) : value
}

/* --------------------------------- stop --------------------------------- */
//
// ⚠️ **`stop` 與上面兩個不是同一種東西，讀這一節之前先分清楚。**
//
// `temperature`／`maxTokens` 是**旋鈕**：一個數字，調大調小，模型的行為連續變化。
// `stop` 是**閘門**：一組字串，模型吐出其中任何一個就當場停下來，而且那個字串
// **不會出現在輸出裡**（`dsh-llm/lib/types/types.d.ts:427`：
//   > Stop sequences: generation halts as soon as the model produces any one of
//   > these strings … The stop string itself is not included in the output.
// ）。
//
// 這個差別決定了下面每一條規矩。角色扮演的典型用法是**擋住模型替你說話**：
// 例如 stop 放「\n使用者：」「\nUser:」，模型寫到那裡就會停住，不會自己接你的台詞。
//
// 為什麼「順序」要保留、為什麼「完全相同的字串」才去重：**stop 是精確比對**。
// 兩個只差一個空白的 stop 是兩個不同的閘門（模型吐的是哪一種，停的位置就不一樣），
// 所以我們**不 trim 內部的字元、也不做模糊比對**——只 trim 頭尾（那是使用者
// 從 textarea 貼進來的產物，不是他要擋的字串）。

/**
 * `stop` 的值有問題嗎？
 *
 * @param value - 使用者送來的值。**收三種形狀**：
 *   - `null`／`undefined`／`''`／`[]` ⇒ 沒問題（＝清除，見下面「三種形狀」）
 *   - `string` ⇒ 一行一個（textarea 給的就是這個）
 *   - `string[]` ⇒ 已經是一組序列
 * @returns `''`＝沒問題（含「清除」）；否則回一句可以直接給使用者看的話。
 *
 * ⚠️ **為什麼收字串**：這一欄在畫面上是一個 `<textarea>`（一行一個），
 * 而宿主半是**唯一**知道「textarea 那一份文字要怎麼變成陣列」的地方
 * ——客戶端只負責把文字原樣送過來。分兩邊各自拆行，就會出現
 * 「面板預覽是一種拆法、實際送出是另一種」那種最難查的不一致。
 *
 * ⚠️ **空白行不算錯誤，是「沒有這一個」**：使用者多按幾次 Enter 不該讓整份設定
 * 存不下去。空白的處置在 `normalizeStop()`（跳過），不在這裡（報錯）。
 */
export function stopProblem(value) {
  if (isUnset(value)) return ''
  if (Array.isArray(value)) return stopListProblem(value)
  if (typeof value === 'string') return stopListProblem(splitStopText(value))
  return '要是一組字串（一行一個）'
}

/**
 * 已經拆好的清單有問題嗎（`stopProblem` 的內核）。
 *
 * @param list - 字串陣列。
 */
function stopListProblem(list) {
  if (list.length === 0) return ''
  if (list.length > STOP_LIMITS.count) return `最多 ${STOP_LIMITS.count} 個`
  for (const item of list) {
    if (typeof item !== 'string') return '每一項都要是文字'
    const trimmed = item.trim()
    if (trimmed === '') continue
    if (trimmed.length > STOP_LIMITS.length) return `每一項最多 ${STOP_LIMITS.length} 個字`
  }
  return ''
}

/**
 * 文字 → 一行一個。**只拆行、不 trim**——trim 與去重是 `normalizeStop()` 的事。
 *
 * 兩台機器的換行都要吃：Windows 的 textarea 送出來的是 `\r\n`。
 */
function splitStopText(text) {
  return String(text).split(/\r\n|\r|\n/)
}

/**
 * 正規化成要存進檔案的形狀：**乾淨的字串陣列，或 `null`**。
 *
 * @param value - 同 `stopProblem`（`null`／`string`／`string[]`）。
 * @returns 去過頭尾空白、去掉空白項與**完全相同**的重複項之後的陣列；
 *   「沒有設定」時回 `null`。
 *
 * 回 `null` 而不是 `[]` 是刻意的：`[]` 與 `null` 在 JSON 裡看起來不一樣，
 * 但意思一樣（沒有閘門），而**兩種寫法並存就會出現「這一間是空的、那一間是沒有」**
 * 的假區別。存檔只有一種「沒有」。
 */
export function normalizeStop(value) {
  if (stopProblem(value) !== '') return null
  const list = Array.isArray(value) ? value : typeof value === 'string' ? splitStopText(value) : []
  const out = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed === '') continue
    if (out.includes(trimmed)) continue
    out.push(trimmed)
  }
  return out.length === 0 ? null : out
}

/**
 * 清單 → textarea 的文字（一行一個）。`null`／壞值回空字串。
 *
 * ⚠️ **這是 `normalizeStop()` 的反向**，但只保證對「已經正規化過的值」是
 * 一對一的（去過重、去過空白項）。畫面上要的是「讀得懂」，不是「位元組可逆」。
 */
export function stopToText(value) {
  const list = normalizeStop(value)
  return list === null ? '' : list.join('\n')
}

/**
 * 這一輪最後要用什麼。
 *
 * 優先序：**房間蓋過酒館**（與 `allowTools` 同一條規矩），而兩層都是
 * `null`（沒有設定）時回 `null`——那代表**不要碰 DSH 的決定**。
 *
 * ⚠️ 「回 null ＝ 不送這個欄位」是刻意的，不是懶：使用者沒設定的時候，
 * 模型參數應該由 DSH／提供方決定，而不是被我們塞一個自以為是的預設值
 * （塞了會**改變既有對話的行為**，也會讓 request/header 出現一次沒人要求的
 * `change`，見 `call-config.d.ts` 對快取復用的說明）。
 *
 * ⚠️ **`stop` 走的是同一條「房間蓋過酒館」，不是「兩層聯集」。** 這一條值得
 * 寫下來，因為「聯集」在這個欄位上其實說得通（兩層的閘門都想要）——但那樣會
 * 造出一個**只有這個欄位才有的規矩**，而這一支存在的全部理由就是
 * 「同一條規則只有一個來源」。要聯集的話，那是一個獨立的決定（＝要改這一頁、
 * 改測試、改 UI 文案），不是「順手」。
 *
 * @param tavern - `tavern.json` 的內容（可以是不完整的物件）。
 * @param room - `room.json` 的內容（可以是不完整的物件，也可以是 `null`）。
 * @returns `{ temperature, maxTokens, stop, stopEnabled }`，值可能是 `null`
 *   （`stop` 是陣列或 `null`；`stopEnabled` 一定是 `true`／`false`）。
 */
export function resolveSamplers(tavern, room) {
  const from = (key) => {
    const inRoom = normalizeFrom(room, key)
    if (inRoom !== null) return inRoom
    return normalizeFrom(tavern, key)
  }
  return {
    temperature: from('temperature'),
    maxTokens: from('maxTokens'),
    stop: from('stop'),
    // ⚠️ 「開關」與「自填的清單」是**兩件事**，所以它們各自走一次「房間蓋過酒館」。
    //    合併成一個欄位的話，「我有自填但開關關著」就分不出來了。
    //    ⚠️ 而它與上面三個不同：它是**三態**（`inherit`／`on`／`off`），
    //    因為房間說「關」必須能蓋過酒館的「開」（見 `triStateOf`）。
    stopEnabled: stopEnabledOf(tavern, room),
  }
}

/**
 * 開關最後是開還是關。
 *
 * ⚠️ **房間那一層有否決權，而且「關」是一個決定**：房間寫 `false` 就是要關，
 * 不管酒館寫什麼。這是三態與布林的分野——見 `triStateOf` 的說明。
 * 兩層都沒有任何人說「開」⇒ **關**（安全的那一邊）。
 */
function stopEnabledOf(tavern, room) {
  const roomState = triStateOf(room, STOP_ENABLED_KEY)
  if (roomState === 'on') return true
  if (roomState === 'off') return false
  return triStateOf(tavern, STOP_ENABLED_KEY) === 'on'
}

/** 從一層設定裡取出並驗一個值；不合法或沒有就回 `null`。 */
function normalizeFrom(source, key) {
  if (source === null || typeof source !== 'object') return null
  if (Object.prototype.hasOwnProperty.call(source, key) === false) return null
  if (key === 'temperature') return normalizeTemperature(source[key])
  if (key === 'stop') return normalizeStop(source[key])
  return normalizeMaxTokens(source[key])
}

/**
 * 三態的欄位（同一支給兩個呼叫端用，所以三態的規矩只有**一份**）。
 *
 * `stopEnabled` 是**三態**，不是布林：
 *
 *   - 沒有這個鍵 ⇒ `'inherit'`（聽上一層）
 *   - `null`      ⇒ `'inherit'`（「清除」＝聽上一層，那是房間的預設值）
 *   - `true`      ⇒ `'on'`
 *   - `false`     ⇒ **`'off'`**——⚠️ 這一格是重點：房間說「關」是一個**明確的
 *     決定**，要能蓋過酒館的「開」。把 `false` 也當成「聽上一層」的話，
 *     使用者會遇到「我明明關掉了它還是在送」——而那是這一輪最容易寫錯的一格。
 *   - 其他值      ⇒ `null`（不合法 ⇒ 當作沒設，往下退）
 */
function triStateOf(source, key) {
  if (source === null || typeof source !== 'object') return 'inherit'
  if (Object.prototype.hasOwnProperty.call(source, key) === false) return 'inherit'
  const value = source[key]
  if (value === true) return 'on'
  if (value === false) return 'off'
  return 'inherit'
}

/**
 * 這一輪的參數裡，**真的有值**的那些（可以直接展開進請求）。
 *
 * @param resolved - `resolveSamplers()` 的結果。
 * @returns 例如 `{ temperature: 0.8 }`；三個都沒設時是 `{}`。
 *
 * ⚠️ **`stop` 是唯一一個「送出去的值不是存下來的值」的欄位**：開關開著時，
 * 送出去的是 `effectiveStop()` 算出來的 `內建 ＋ 自填`，不是 `resolved.stop`
 * 本身。這一格是那個轉換**唯一**的發生地點——散在別的地方就會出現
 * 「面板顯示三串、實際送四串」。
 *
 * ⚠️ `stop` 的判斷與前兩個不同：它要**同時**檢查「不是 null」與「長度大於 0」。
 * 只檢查前者會讓「空陣列」漏出去，只檢查後者會讓 `null` 被讀 `.length` 而丟錯。
 * 而空陣列真的送出去的話，提供方收到的是「有一個 stop 欄位，但裡面沒有東西」
 * ——那與「沒有這個欄位」在日誌上長得一模一樣，但請求內容不同。
 */
export function samplerRequestFields(resolved) {
  const out = {}
  if (resolved === null || typeof resolved !== 'object') return out
  if (resolved.temperature !== null && resolved.temperature !== undefined) {
    out.temperature = resolved.temperature
  }
  if (resolved.maxTokens !== null && resolved.maxTokens !== undefined) {
    out.maxTokens = resolved.maxTokens
  }
  const stop = effectiveStop(resolved)
  if (stop.length > 0) out.stop = stop
  return out
}
