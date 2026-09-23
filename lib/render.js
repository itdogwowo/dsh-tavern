/**
 * 回覆格式（`<酒館>/render.json`）：**我們怎麼告訴模型「請這樣回」**，以及
 * 我們怎麼讀懂它。
 *
 * ────────────────────────────────────────────────────────────────────────
 * ⚠️ **這一支存在的理由，是「解碼」與「指定」的差別。**
 *
 * 2.6.43–2.6.56 之間，酒館的畫面**已經**讀得懂結構化的一行了
 * （`lib/client.js` 的 `parseStructuredLine`／`parseMarkedRegions`），
 * 但**我們從來沒有告訴模型要那樣寫**——沒有任何一份提示詞提過格式。
 * 所以實際跑起來永遠是「模型寫小說 → 我們在後面猜」：
 *
 *   1. 台詞／旁白／動作是**猜**出來的（引號、括號的排版慣例）
 *   2. `choices`／`data`／`thought` 這些 kind **一次都沒有出現過**
 *      ——它們只能由標記或結構化的一行產生，而兩者都沒被啟用
 *   3. 猜錯的時候沒有申訴管道（模型根本不知道我們在猜）
 *
 * `docs/reply-format.md` §1 早就寫著「**乙、結構化是主線，甲、純文字是安全網**」，
 * 而這一支就是那個「主線」的**前半段**：把格式寫成指令，交給 agent 面放進提示詞。
 * 後半段（解析）已經在了。
 * ────────────────────────────────────────────────────────────────────────
 *
 * 三種模式（`mode`）：
 *
 *   - `plain`（安全的預設）：**一個字都不加**。行為與以前一字不差，靠排版慣例推斷。
 *   - `marked`：教模型用**標記**（`<台詞>…</台詞>`）。可讀性最好、成本低、
 *     壞掉只損失一個區塊。適合不喜歡 JSON 的模型與使用者。
 *   - `structured`：教模型**一行一個 JSON 物件**。最精確（`who` 可靠、
 *     `choices` 與 `data` 才畫得出來），代價是每行約 30 個字元。
 *
 * ⚠️ **為什麼要有 `plain`（而不是預設就開結構化）**：格式說明是**每一輪都要付的
 * token**，而且它會改變模型的寫法。既有對話的使用者沒有要求過這件事，
 * 所以預設必須是「與以前一字不差」。`docs/reply-format.md` §5.2 也講得很直白：
 * **修復率是提示詞的健康指標**——先給對的格式，再談修復。
 *
 * @module dsh-tavern/render
 */

/** 三種模式。順序＝設定頁上的順序（安全 → 精確）。 */
export const RENDER_MODES = ['plain', 'marked', 'structured']

/**
 * 回覆格式的設定檔（**存在酒館資料夾裡**）。
 *
 * ⚠️ 與 `THEME_FILE`（`theme.json`）分開是刻意的：那個管外觀、這個管
 * 「怎麼讀訊息」，而兩者改的時機完全不同。整包帶走時兩個都跟著走。
 */
export const RENDER_FILE = 'render.json'

/**
 * 使用者可以宣告的顯示語意（`docs/reply-format.md` §2 那份清單）。
 *
 * ⚠️ **這一份是 `lib/client.js` 的 `PARSE_KINDS` 的鏡射**，而兩邊要一字不差：
 * 宿主半拿它驗證 render.json（不合法的不准進使用者的檔案），客戶端拿它解析。
 * `test-render.mjs` 會拿兩邊對照——改一邊沒改另一邊就會紅。
 */
export const RENDER_KINDS = [
  'speech',
  'narration',
  'action',
  'thought',
  'panel',
  'data',
  'title',
  'choices',
  'note',
]

/** 上限。不是安全檢查（影響不了檔案系統），是**可用性**：太多標記會讓模型記不住。 */
export const RENDER_LIMITS = {
  markers: 12,
  tag: 24,
  quotes: 8,
  parens: 6,
}

/**
 * 內建的排版慣例（引號／括號）——**與 `lib/client.js` 的 `PARSE_DEFAULT_CONFIG`
 * 同一組**。使用者沒設定時用它，而且它不進 render.json（見 `normalizeRender`）。
 */
export const DEFAULT_QUOTES = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['"', '"'],
]

export const DEFAULT_PARENS = [
  ['（', '）'],
  ['(', ')'],
]

/**
 * `marked` 模式的預設標記組。
 *
 * ⚠️ **標籤名用中文**（`<台詞>` 而不是 `<speech>`）：這是給中文小說用的，
 * 而模型在中文語境裡對中文標籤的遵從度更好、也更容易看出壞掉。
 * 想用英文的人自己改 render.json——那正是這個檔案存在的目的。
 *
 * `who` 只有 `<台詞>` 有：那是唯一一個「誰說的」會變的 kind（見 §6 的語音）。
 */
export const DEFAULT_MARKERS = [
  { tag: '台詞', kind: 'speech', who: '' },
  { tag: '旁白', kind: 'narration', who: '' },
  { tag: '動作', kind: 'action', who: '' },
  { tag: '心聲', kind: 'thought', who: '' },
  { tag: '面板', kind: 'panel', who: '' },
  { tag: '狀態', kind: 'data', who: '' },
  { tag: '選項', kind: 'choices', who: '' },
]

/**
 * 預設的一份設定。
 *
 * ⚠️ `mode: 'plain'` 是**刻意**的（理由見檔頭）：這一版上線時，
 * 既有對話的提示詞一個字都不變。
 */
export function defaultRender() {
  return {
    version: 1,
    mode: 'plain',
    markers: DEFAULT_MARKERS.map((one) => ({ tag: one.tag, kind: one.kind, who: one.who })),
    quotes: DEFAULT_QUOTES.map((pair) => [pair[0], pair[1]]),
    parens: DEFAULT_PARENS.map((pair) => [pair[0], pair[1]]),
    choicesClickable: false,
  }
}

/** 值是「沒有設定」的意思嗎。 */
function isUnset(value) {
  return value === null || value === undefined || value === ''
}

/**
 * 一組「成對符號」（引號或括號）合法嗎？
 *
 * @returns `''`＝合法；否則回一句給使用者看的話。
 */
function pairProblem(value) {
  if (!Array.isArray(value) || value.length !== 2) return '要是一對（兩個字串）'
  const [open, close] = value
  if (typeof open !== 'string' || typeof close !== 'string') return '兩個都要是文字'
  if (open === '' || close === '') return '不可以是空的'
  if (open === close) return '開頭與結尾不可以一樣（會被當成同一邊）'
  return ''
}

/**
 * 一份標記宣告合法嗎？
 *
 * @returns `''`＝合法；否則回一句給使用者看的話。
 */
function markerProblem(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return '要是一個物件'
  const tag = typeof value.tag === 'string' ? value.tag.trim() : ''
  if (tag === '') return '要有 tag（標籤名）'
  if (tag.length > RENDER_LIMITS.tag) return `標籤名最多 ${RENDER_LIMITS.tag} 個字`
  // ⚠️ 標籤名不可以有空白或 `<`／`>`：解析器是拿它去 `indexOf('<'+tag+'>')` 的，
  // 含這些字元的話會產生一個**永遠對不上**的標記，而症狀是「設了但沒生效」。
  if (/[\s<>/]/.test(tag)) return '標籤名不可以有空白或 < > /'
  if (typeof value.kind !== 'string' || RENDER_KINDS.includes(value.kind) === false) {
    return `kind 要是這幾種之一：${RENDER_KINDS.join('、')}`
  }
  if (value.who !== undefined && typeof value.who !== 'string') return 'who 要是文字'
  return ''
}

/**
 * 正規化一份 `render.json`。
 *
 * 與 `lib/theme.js` 的 `normalizeTheme()` 同一條規矩：
 *   - 壞掉的欄位**落回預設**（不是丟錯）——設定檔壞掉不該讓酒館打不開
 *   - 但**要回報**（`dropped`），不然使用者會以為自己設定成功了
 *
 * @param raw - 檔案內容（或使用者送來的 patch）。
 * @returns `{ render, dropped }`；`render` 永遠是完整的一份。
 */
export function normalizeRender(raw) {
  const base = defaultRender()
  const dropped = []
  const given = raw !== null && typeof raw === 'object' && Array.isArray(raw) === false ? raw : {}

  if (given.mode !== undefined) {
    if (isUnset(given.mode)) base.mode = 'plain'
    else if (RENDER_MODES.includes(given.mode)) base.mode = given.mode
    else dropped.push(`mode（要是 ${RENDER_MODES.join('／')} 其中之一）`)
  }

  if (given.markers !== undefined) {
    if (!Array.isArray(given.markers)) {
      dropped.push('markers（要是一個陣列）')
    } else if (given.markers.length === 0) {
      // ⚠️ 空陣列是**合法**的，而且有明確的意思：這個模式沒有標記（等於不宣告）。
      base.markers = []
    } else if (given.markers.length > RENDER_LIMITS.markers) {
      dropped.push(`markers（最多 ${RENDER_LIMITS.markers} 個）`)
    } else {
      const next = []
      const seen = {}
      let bad = ''
      for (const one of given.markers) {
        const problem = markerProblem(one)
        if (problem !== '') {
          bad = problem
          break
        }
        const tag = one.tag.trim()
        // ⚠️ 同一個標籤名宣告兩次 ⇒ **後面的贏**（與 JS 的宣告同一條規矩）。
        // 不這樣做的話 `parseMarkedRegions` 會拿到兩份規格，而第一個命中永遠勝出
        // ——症狀是「改了 kind，沒反應」。
        if (seen[tag] === true) {
          const at = next.findIndex((item) => item.tag === tag)
          next[at] = { tag, kind: one.kind, who: typeof one.who === 'string' ? one.who : '' }
          continue
        }
        seen[tag] = true
        next.push({ tag, kind: one.kind, who: typeof one.who === 'string' ? one.who : '' })
      }
      if (bad !== '') dropped.push(`markers（${bad}）`)
      else base.markers = next
    }
  }

  for (const key of ['quotes', 'parens']) {
    if (given[key] === undefined) continue
    if (!Array.isArray(given[key])) {
      dropped.push(`${key}（要是一個陣列）`)
      continue
    }
    const next = []
    let bad = ''
    for (const pair of given[key]) {
      const problem = pairProblem(pair)
      if (problem !== '') {
        bad = problem
        break
      }
      next.push([pair[0], pair[1]])
    }
    const limit = key === 'quotes' ? RENDER_LIMITS.quotes : RENDER_LIMITS.parens
    if (bad !== '') dropped.push(`${key}（${bad}）`)
    else if (next.length > limit) dropped.push(`${key}（最多 ${limit} 對）`)
    else if (next.length > 0) base[key] = next
  }

  if (given.choicesClickable !== undefined) {
    base.choicesClickable = given.choicesClickable === true
  }

  return { render: base, dropped }
}

/**
 * 現在這一輪要用的解析設定（給 `lib/client.js` 的 `parseMessage`）。
 *
 * ⚠️ **只有 `marked` 模式才把標記交給解析器。** 其他模式下標記是「普通文字」
 * ——這一點很重要：模型在 `structured` 模式下如果真的吐了 `<台詞>`，
 * 那代表它走樣了，而我們**應該看見那些角括號**（`unknown-tag` 也會回報它），
 * 不是默默把它畫成台詞。反過來說，`marked` 模式下的引號／括號推斷照樣留著
 * ——它是安全網（§1），不是要被取代的東西。
 *
 * @param render - `normalizeRender()` 的 `render`（或任何殘缺的物件）。
 * @returns `{ quotes, parens, markers, defaultWho }`——`parseMessage` 收的形狀。
 */
export function parseConfigFromRender(render, defaultWho) {
  const one = render !== null && typeof render === 'object' ? render : {}
  const mode = RENDER_MODES.includes(one.mode) ? one.mode : 'plain'
  return {
    quotes: Array.isArray(one.quotes) && one.quotes.length > 0 ? one.quotes : DEFAULT_QUOTES,
    parens: Array.isArray(one.parens) && one.parens.length > 0 ? one.parens : DEFAULT_PARENS,
    markers: mode === 'marked' && Array.isArray(one.markers) ? one.markers : [],
    defaultWho: typeof defaultWho === 'string' ? defaultWho : '',
    // ⚠️ 這一格**不是給 `parseMessage` 的**（它不認得，也不會看）——是給畫面
    // 決定「`choices` 要不要畫成按鈕」的。放在同一份設定裡是因為畫面與解析
    // 讀的是同一份 `render.json`，分成兩份就會出現「解析按 A、畫面按 B」。
    // ⚠️ 只有**真的是 `true`** 才算：`'true'`（字串）不算——那個值可以被手改，
    // 而手改出來的 `"true"` 不該讓一個會產生副作用的行為被打開。
    choicesClickable: one.choicesClickable === true,
  }
}

/* ------------------------------ 指令的文字 ------------------------------ */
//
// ⚠️ **這幾段是提示詞，不是文件。** 改它們的時候要記得三件事：
//   1. 它們**每一輪都會被送出**（在系統提示裡），所以長度就是成本。
//      DSH 的 KV 快取會讓重複的前綴變便宜，但**第一次**要付。
//   2. 模型對「一行一個」的遵從度比對「一個大陣列」高很多——那不是美感，
//      是實測（`docs/reply-format.md` §1 那三個理由）。
//   3. **不可以提到我們自己的實作**（`kind` 的白名單要講，但不要講
//      「我們會後處理填 source／para」——模型不需要知道，也不該知道）。

/** `structured` 模式：一行一個 JSON 物件。 */
const STRUCTURED_RULES = [
  '# 回覆格式',
  '請用**一行一個 JSON 物件**的格式回覆，每一行都是一個獨立的片段：',
  '{"kind":"speech","who":"角色名","text":"台詞內容"}',
  '規則：',
  '- `kind` 只能是：speech（台詞）、narration（旁白）、action（動作）、thought（心聲）。',
  '- `who` 只有 speech 需要（說這句話的人）。',
  '- `text` 是原文，不要加引號或括號——要加的話它們會變成內容的一部分。',
  '- 一行一個物件，不要包成陣列、不要加 markdown 程式碼區塊。',
  '- 需要提出選項時，額外給一行：{"kind":"choices","items":["選項一","選項二"]}',
  '- 需要交代數值狀態時，額外給一行：{"kind":"data","rows":[{"key":"好感度","value":"62%"}]}',
  '- 旁白與台詞交替時，就交替給行；不要把所有台詞擠進一行。',
].join('\n')

/** `marked` 模式：用標記。 */
function markedRules(markers) {
  const lines = ['# 回覆格式', '請用下列標記把不同性質的文字分開：']
  for (const one of markers) {
    lines.push(`- \`<${one.tag}>…</${one.tag}>\` ＝ ${one.kind}`)
  }
  lines.push('規則：')
  lines.push('- 標記要成對。忘記收尾會讓後面整段被吃進同一個區塊。')
  lines.push('- 標記裡面直接寫原文，不要再多加一層引號。')
  lines.push('- 沒有標記的文字會被當成旁白——所以不想分類時就照平常寫。')
  if (markers.some((one) => one.kind === 'choices')) {
    lines.push('- 提出選項時，一行一個選項，整段包在對應的標記裡。')
  }
  return lines.join('\n')
}

/* --------------------------- 「誰在教格式」的偵測 --------------------------- */

/**
 * 看得出來這一段文字是在**教回覆格式**嗎？
 *
 * ⚠️ 這是**啟發式**，而且是刻意保守的：只認兩種幾乎不會誤判的形狀——
 *   1. `"kind"` 這個鍵（JSON 的結構化寫法一定會提到它）
 *   2. 同一段文字裡同時出現多個 kind 的名字（`speech`／`narration`／`action`…）
 *      ——那是在列舉格式，不是在講故事
 *
 * 只用「有沒有 `{`」或「有沒有 JSON」會誤判（卡片描述裡提到 JSON 是常態）。
 *
 * @param text - 一段世界書條目的內容。
 * @returns `true`＝看起來是在教格式。
 */
export function looksLikeFormatSpec(text) {
  const raw = typeof text === 'string' ? text : ''
  if (raw === '') return false
  if (raw.includes('"kind"') || raw.includes("'kind'")) return true
  // 「列舉 kind」的那一種：同一段裡出現兩個以上。
  const named = ['speech', 'narration', 'action', 'thought', 'choices']
  let hits = 0
  for (const one of named) {
    if (raw.includes(one)) hits += 1
  }
  return hits >= 2
}

/**
 * 這個世界書的資料裡，有哪些條目在教格式？
 *
 * ⚠️ **為什麼要問這一題**：格式指令有**兩個可能的老師**——世界書（`constant`
 * 條目，住在訊息裡）與 `render.json`（plugin 送進系統提示）。兩個同時開著
 * 會給模型**兩份規格**（例如 `data` 一邊說用 `text`、一邊說用 `rows`），
 * 而「一個東西兩個來源」正是這個 repo 一路在避免的事。
 *
 * 所以設定頁要**看得見**這件事，而不是靠使用者記得。
 *
 * @param data - 一本世界書的原始 JSON。
 * @returns 命中的條目說明（`comment`／`name`，取得到就用它）。
 */
export function formatSpecEntries(data) {
  const out = []
  if (data === null || typeof data !== 'object') return out
  const entries = data.entries
  const list = Array.isArray(entries)
    ? entries
    : entries !== null && typeof entries === 'object'
      ? Object.values(entries)
      : []
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue
    // 已經關掉的條目不算——那是使用者明確的決定（`worldbook.js` 也照這個跳過）。
    if (entry.disable === true || entry.enabled === false) continue
    if (looksLikeFormatSpec(entry.content) === false) continue
    const label = typeof entry.comment === 'string' && entry.comment.trim() !== ''
      ? entry.comment.trim()
      : typeof entry.name === 'string' && entry.name.trim() !== ''
        ? entry.name.trim()
        : '（沒有標題）'
    out.push(label)
  }
  return out
}

/**
 * 這一輪要接在提示詞後面的**格式指令**。
 *
 * @param render - `normalizeRender()` 的 `render`。
 * @returns 一段文字；`plain` 模式回**空字串**（＝一個字都不加）。
 */
export function renderDirective(render) {
  const one = render !== null && typeof render === 'object' ? render : {}
  const mode = RENDER_MODES.includes(one.mode) ? one.mode : 'plain'
  if (mode === 'plain') return ''
  if (mode === 'structured') return STRUCTURED_RULES
  const markers = Array.isArray(one.markers) ? one.markers : []
  // 宣告了 `marked` 模式卻一個標記都沒有 ⇒ 指令是空的，那就**不要加**
  // （加一段「請用下列標記：」後面什麼都沒有，比不加更糟）。
  if (markers.length === 0) return ''
  return markedRules(markers)
}

/**
 * `choices` 節點的內容 → 可選項清單。
 *
 * 兩種寫法都收，因為兩種都自然：
 *   - 一行一個（最常見，模型也最不容易寫壞）
 *   - `- ` / `* ` / `1. ` 開頭的清單（模型很愛加項目符號）
 *
 * ⚠️ **刻意不切逗號**：中文的選項裡有逗號是常態（「去酒窖，順便拿燈」），
 * 切了會把一個選項變成兩個，而使用者只會覺得「它把我的選項弄斷了」。
 *
 * @param text - `choices` 區塊的原文。
 * @returns `string[]`（可能是空的）。
 */
export function parseChoices(text) {
  // ⚠️ 行分隔要**同時認真的換行與字面上的 `\n`**——同 `lib/client.js` 的
  // `parseDataRows()`：結構化的一行是 JSON，而 JSON 裡的多行只能是 `\n`
  // 轉義，所以 `{"kind":"choices","text":"A\nB"}` 的那個 `\n` 是**兩個字元**。
  // 只 split('\n') 的話兩個選項會黏成一個（實測在使用者的世界書格式上踩到，
  // 同一型的問題在 `data` 那邊讓整塊降級成旁白）。
  const lines = String(text === null || text === undefined ? '' : text).split(/\n|\\n/)
  const out = []
  for (const raw of lines) {
    // 去掉項目符號與編號，但**只去開頭那一小段**（`1. 去酒窖` → `去酒窖`）。
    const line = raw
      .trim()
      .replace(/^[-*・]\s*/, '')
      .replace(/^\d+[.、)]\s*/, '')
      .trim()
    if (line === '') continue
    if (out.includes(line)) continue
    out.push(line)
  }
  return out
}

/**
 * 一個 `key: value` 的值 → 進度條要用的百分比（0～100），或 `null`（不畫）。
 *
 * ⚠️ **判斷要嚴格，因為猜錯比不畫更糟**：把「時間: 晚上 11:30」畫成一條
 * 進度條會讓整個區塊看起來像壞掉。所以只認兩種形狀：
 *   1. 帶百分號：`62%`／`62 ％`
 *   2. 帶分數：`3/10`（含全形斜線）
 *
 * 「好感度 62」這種沒有單位的**不畫**——我們不知道 62 滿分是 100 還是 1000，
 * 而畫錯的長度比不畫更具誤導性。
 *
 * @param value - 值的原文。
 * @returns `{ percent, label }` 或 `null`。
 */
export function progressOf(value) {
  const text = String(value === null || value === undefined ? '' : value).trim()
  if (text === '') return null
  const percent = /^(-?\d+(?:\.\d+)?)\s*[%％]$/.exec(text)
  if (percent !== null) {
    const num = Number(percent[1])
    if (Number.isFinite(num) === false) return null
    return { percent: Math.max(0, Math.min(100, num)), label: text }
  }
  const fraction = /^(-?\d+(?:\.\d+)?)\s*[/／]\s*(\d+(?:\.\d+)?)$/.exec(text)
  if (fraction !== null) {
    const num = Number(fraction[1])
    const total = Number(fraction[2])
    if (Number.isFinite(num) === false || Number.isFinite(total) === false) return null
    if (total <= 0) return null
    return { percent: Math.max(0, Math.min(100, (num / total) * 100)), label: text }
  }
  return null
}
