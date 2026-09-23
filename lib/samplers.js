/**
 * 生成參數（`temperature`／`maxTokens`）：驗證、正規化，以及「誰蓋過誰」。
 *
 * ────────────────────────────────────────────────────────────────────────
 * ⚠️ **為什麼只有這兩個：DSH 的介面就只有這兩個。**
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
 * 這兩個欄位的名字（給 UI／錯誤訊息／測試共用，免得三處各寫一份字串）。
 */
export const SAMPLER_KEYS = ['temperature', 'maxTokens']

/** 值是「沒有設定」的意思嗎（`null`／`undefined`／空字串都算）。 */
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
 * @param tavern - `tavern.json` 的內容（可以是不完整的物件）。
 * @param room - `room.json` 的內容（可以是不完整的物件，也可以是 `null`）。
 * @returns `{ temperature, maxTokens }`，值可能是 `null`。
 */
export function resolveSamplers(tavern, room) {
  const from = (key) => {
    const inRoom = normalizeFrom(room, key)
    if (inRoom !== null) return inRoom
    return normalizeFrom(tavern, key)
  }
  return { temperature: from('temperature'), maxTokens: from('maxTokens') }
}

/** 從一層設定裡取出並驗一個值；不合法或沒有就回 `null`。 */
function normalizeFrom(source, key) {
  if (source === null || typeof source !== 'object') return null
  if (Object.prototype.hasOwnProperty.call(source, key) === false) return null
  return key === 'temperature'
    ? normalizeTemperature(source[key])
    : normalizeMaxTokens(source[key])
}

/**
 * 這一輪的參數裡，**真的有值**的那些（可以直接展開進請求）。
 *
 * @param resolved - `resolveSamplers()` 的結果。
 * @returns 例如 `{ temperature: 0.8 }`；兩個都沒設時是 `{}`。
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
  return out
}
