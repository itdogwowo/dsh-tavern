/**
 * dsh-tavern 的 **Agent 面**。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 這一面跟前兩面（宿主半、瀏覽器半）最大的不同：**它只在 preset 裡面跑**。
 *
 *   ~/.dsh/.agent-presets/dsh-tavern/agent.cordis.yml
 *     - id: tavern-agent
 *       name: '<絕對路徑>/lib/agent.js'
 *
 * 所以它**不在 `dsh web` 的啟動路徑上**——它是在「有人用酒館模式開一個對話」
 * 的時候才被載入的。這一面的程式碼壞掉，只有那個對話開不起來，DSH 本身沒事。
 * 風險比另外兩面低一個數量級，所以**能放這裡的東西就不要放宿主半**。
 * ────────────────────────────────────────────────────────────────────────
 *
 * 它做的事只有一件：**在每一次模型請求之前，回答「這個 session 是誰」。**
 *
 *   dsh-agent-loop 的 preStep
 *     └─ ctx.systemPrompt.assemble()
 *          └─ 我們註冊的 provider 被呼叫，收到 { agent }
 *               └─ 讀角色卡 → 回傳全文 → 那就是這個 session 的系統提示
 *
 * 為什麼可以是動態的：`PromptSection.text` 的型別是
 * `string | ((context: AssembleContext) => string)`——**每次組裝時才呼叫**
 * （`dsh-system-prompt/lib/types/index.d.ts:60`）。
 *
 * 為什麼這比「每個角色寫一個 preset 檔」好：
 *   - 一份 preset 服務所有角色，而且**永遠不用改寫**（沒有世代洩漏的問題）
 *   - **改了卡片，下一輪就生效**——跟 SillyTavern 一樣（它也是每輪重讀卡片）
 *   - 模式選單只多一筆「酒館模式」，不是每個角色一筆
 *
 * @module dsh-tavern/agent
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { collectLore, groupByPosition, prependLore, textOfEntries, textOfMessages } from './worldbook.js'
import { resolveSamplers, samplerRequestFields } from './samplers.js'
import { normalizeRender, renderDirective } from './render.js'

/** 這一面的版本標記，跟另外兩面分開（三面各自演化）。 */
export const AGENT_BUILD = 'tavern-agent-2.6.71'
/** Cordis 外掛名。 */
export const name = 'dsh-tavern-agent'

/**
 * 我們需要的服務。
 *
 * `systemPrompt` 對這一面是**硬依賴**——沒有它，這一面存在的理由就消失了。
 * 所以照 Cordis 的正規做法放進 `inject`（而不是 `ctx.get()`）。
 */
export const inject = ['systemPrompt']

/**
 * 提示詞變數的名字。
 *
 * ⚠️ **這是整個設計裡最容易踩的坑**：`renderPrompt` 對**任何**它不認得的
 * `{{...}}` 直接丟錯，而且 `dsh-system-prompt/README.md:173` 明講
 * 「沒有跳脫字面大括号的語法」。而角色卡裡到處都是 `{{char}}` 和 `{{user}}`。
 *
 * 解法就是這裡：**卡片放進變數**，section 只寫 `{{tavern_card}}`。
 * 替換進去的值不會再被掃描一次（`lib/index.js:171-172`），所以卡片裡的
 * 大括号安全。這一條在 `test-agent.mjs` 有一條測試專門餵含 `{{char}}` 的卡。
 */
const CARD_VARIABLE = 'tavern_card'

/** section 的名字。用 `:` 分命名空間，避免跟別人的 section 撞名。 */
const CARD_SECTION = 'tavern:card'

/**
 * 卡片快取：檔案路徑 → `{ stamp, text }`。
 *
 * 為什麼要有它：provider 是**同步**的（`lib/index.js:336-343` 直接呼叫，沒有 await），
 * 所以只能 `statSync` ＋ `readFileSync`。快取避免「同一個檔案每一輪都重新解析」。
 *
 * ⚠️ 這**不是**「快取起來就不再看」：每一輪都還是會 `statSync` 比對 mtime，
 * 不一樣就重讀。所以改了卡片下一輪就生效（mtime 只在真的改動時變）。
 * 命中率在實際使用中接近 100%，而沒命中的成本只是一次 `statSync`（微秒級）。
 */
const cache = new Map()

/** 世界書的快取：檔案路徑 → `{ stamp, data }`（`data` 是 `null` ＝ 不像世界書）。 */
const bookCache = new Map()

/** 快取上限：避免使用者逛過幾百張卡之後記憶體一直長。 */
const CACHE_LIMIT = 128

/** 沒設定時的使用者名稱。SillyTavern 的 `{{user}}` 對應到這個。 */
const DEFAULT_USER = '你'

/** 對照表所在的資料夾名（跟 `lib/workspace.js` 的 `SESSIONS_DIR` 必須一致）。 */
const SESSIONS_DIR = '.sessions'

/**
 * 從 Agent 身上找出「這個 session 是哪一間酒館的哪個角色」。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 兩個資訊分別來自兩個地方（都是 DSH 給的，不是我們發明的）：
 *
 *   1. **酒館資料夾** ← `agent.session.header.cwd`
 *      `SessionHeader.cwd` 是「session 建立時的絕對工作目錄」
 *      （`dsh-session/lib/types/types.d.ts`），而酒館開對話時就是用
 *      `session.create({ cwd: <酒館資料夾> })`。它是**不可變的**，所以在
 *      session 的整個生命週期裡都可靠。
 *
 *   2. **角色** ← `<cwd>/.sessions/<sessionId>.json`
 *      酒館開對話時寫下的小對照表（`lib/workspace.js` 的 `bindSession`）。
 *
 * ⚠️ 這一條在**每一次模型請求**裡被呼叫，所以：
 *   - 全部同步（provider 不能 await）
 *   - 任何一步失敗都**回 null**，不丟錯
 *   - 結果用 mtime 快取（見 `resolveCardFile`）
 * ────────────────────────────────────────────────────────────────────────
 *
 * @param agent - `AssembleContext.agent`（可能沒有，例如診斷用的組裝）。
 * @returns `{ root, character }`，或 `null`。
 */
export function resolveBinding(agent) {
  const sessionId = typeof agent?.id === 'string' ? agent.id : ''
  if (sessionId === '') return null
  const root = typeof agent?.session?.header?.cwd === 'string' ? agent.session.header.cwd : ''
  if (root === '') return null

  let raw
  try {
    raw = readFileSync(join(root, SESSIONS_DIR, `${sessionId}.json`), 'utf8')
  } catch (error) {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    const character = parsed !== null && typeof parsed === 'object' ? parsed.character : undefined
    if (typeof character !== 'string' || character === '') return null
    // `room` 是新的（房間＝資料夾），`chat` 是舊的（對話＝一個檔）。兩個都帶出去：
    // 客戶端切換的過程中舊綁定還在，認不得的那個會是 undefined。
    return { root, character, room: parsed.room, chat: parsed.chat }
  } catch (error) {
    return null
  }
}

/**
 * 決定「這個 session 要讀哪一張卡」。
 *
 * 優先序：
 *   1. **session 的綁定**（`<cwd>/.sessions/<id>.json`）——正常情況走這條，
 *      所以一份 preset 服務所有角色，而且每份對話記得自己是誰。
 *   2. **preset 那一列的 `card` 設定**——退路。給「還沒綁定的 session」
 *      （例如使用者直接在 DSH 開一個酒館模式的空白 session）一個能用的身分。
 *
 * @returns 卡片的絕對路徑，或 `''`（兩個都沒有）。
 */
export function resolveCardFile(agent, fallbackCard) {
  const binding = resolveBinding(agent)
  if (binding !== null) {
    return join(binding.root, 'characters', `${binding.character}.json`)
  }
  return typeof fallbackCard === 'string' ? fallbackCard : ''
}

/**
 * 讀酒館 `tavern.json`（**每次重讀，不快取**）。
 *
 * 卡片路徑固定是 `<酒館>/characters/<id>.json`，所以 `tavern.json` 就在上一層。
 * 讀不到、壞掉、或不是物件都回**空物件**——**不丟錯**：這些設定不該有辦法讓
 * 一整輪對話失敗。
 *
 * ⚠️ **`dirname` 一定要是 import 進來的那一個**（2.6.47 修）。它以前不在
 * `node:path` 的解構清單裡，於是這支函式**每一次都丟 `ReferenceError`**、
 * 被底下的 `catch` 吃掉、永遠回空字串——整條 `tavern.json` 的讀取路徑都是死的，
 * 而 `node --check` 看不出來（那是執行期才爆）。改這一帶之前先看
 * `test-agent.mjs` 第 10、11 節。
 *
 * ⚠️ **刻意不快取**（跟卡片、世界書不一樣）。理由：
 *   1. 這個檔案 < 1KB，`readFileSync` ＋ `JSON.parse` 是微秒級，而它一輪被讀
 *      幾次（persona／店規／工具等級／生成參數）——加起來遠小於一次 `statSync`
 *      之外的任何成本，更不用說跟一次模型呼叫比。
 *   2. 快取鍵只能是「路徑 ＋ mtime」，而 **mtime 的解析度比「使用者按兩次儲存」
 *      還粗**：同一毫秒內寫兩次會拿到舊的內容。那個 bug 的症狀是「改了設定，
 *      這一輪沒生效、下一輪才生效」——最難診斷的那一種。
 *   3. 卡片與世界書值得那樣的取捨（它們可能很大）；這一支不值得。
 */
function tavernJson(cardFile) {
  return readJsonObject(join(dirname(cardFile), '..', 'tavern.json'))
}

/** 讀酒館裡的一個字串欄位（沒有／型別不對／只有空白都當作沒有）。 */
function tavernField(cardFile, key) {
  const value = tavernJson(cardFile)[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 讀一個 JSON 檔並保證拿到物件（讀不到／壞掉／是陣列都回空物件）。
 *
 * 這是 `tavernJson` 與 `roomJson` 共用的那一行——**永遠不丟錯**，
 * 因為呼叫它的地方都在每一次模型請求的路徑上。
 */
function readJsonObject(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && Array.isArray(parsed) === false ? parsed : {}
  } catch (error) {
    return {}
  }
}

/** `{{user}}` 要換成什麼。 */
function tavernUserName(cardFile) {
  return tavernField(cardFile, 'userName')
}

/**
 * `{{char}}` 要換成什麼（v3 的 `nickname` 優先，留空才退回 `name`）。
 *
 * 抽成純函式是為了**一份真相**：`renderCard` 與 `tavernExtras` 兩邊都要這個值，
 * 各自算一次的話，改了一邊就會出現「同一份提示詞裡兩個名字不一樣」。
 */
export function charNameOf(card) {
  return field(card, 'nickname') || field(card, 'name') || '角色'
}

/** `{{user}}` 要換成什麼（留空 → `DEFAULT_USER`，也就是「你」）。 */
export function userNameOf(userName) {
  return typeof userName === 'string' && userName.trim() !== '' ? userName.trim() : DEFAULT_USER
}

/**
 * 這一間酒館的**回覆格式指令**（`<酒館>/render.json` → 提示詞）。
 *
 * ────────────────────────────────────────────────────────────────────────
 * ⚠️ **這是「指定」而不是「解碼」，而它以前完全不存在。**
 *
 * 客戶端早就有 `parseStructuredLine`／`parseMarkedRegions`（讀得懂結構化的一行
 * 與標記），但**沒有任何一份提示詞告訴模型要那樣寫**——所以實際跑起來永遠是
 * 「模型寫小說 → 我們在後面猜」，而 `choices`／`data`／`thought` 這些 kind
 * 一次都沒有出現過。`docs/reply-format.md` §1 寫的是「結構化是主線」，
 * 這一支就是那條主線的前半段。
 *
 * ⚠️ **`plain` 模式回空字串**——那時提示詞一個字都不加，與以前一字不差。
 * 這條是「既有對話的行為不變」的實作方式，不要改成「plain 也講一句」。
 *
 * ⚠️ 讀不到 `render.json` ⇒ 走預設（＝`plain`）⇒ 回空字串。**不丟錯**：
 * 格式設定壞掉不該讓一輪對話失敗。
 * ────────────────────────────────────────────────────────────────────────
 *
 * @param cardFile - 拿來找酒館資料夾（卡片在 `characters/` 底下）。
 * @returns 一段提示詞文字，或 `''`。
 */
export function renderDirectiveFor(cardFile) {
  try {
    const raw = readJsonObject(join(dirname(cardFile), '..', 'render.json'))
    return renderDirective(normalizeRender(raw).render)
  } catch (error) {
    return ''
  }
}

/**
 * 這一間酒館額外要帶進去的兩段：**你是誰（persona）** ＋ **這間店的規則**。
 *
 * 兩者都**接在角色卡後面**，不是取代它。使用者要的是「按預設就好，只要讓用戶能設」
 * ——所以它們留空時回空字串，提示詞與以前一字不差。
 *
 * ⚠️ **這兩段也要跑一次 `substitute`**（2.6.47 修）。以前沒有，於是同一份提示詞裡
 * 卡片被換、這兩段沒被換，最明顯的就是**標題本身**——`# 關於 {{user}}` 原樣送到
 * 模型。使用者自己在 persona 裡寫 `{{char}}` 也一樣：卡片的會被換、他的不會。
 *
 * @param cardFile - 拿來找 `tavern.json`（它就在上一層）。
 * @param names - `readCardNames()` 的那一組名字；**不要在這裡自己算**。
 */
function tavernExtras(cardFile, names) {
  const persona = tavernField(cardFile, 'userPersona')
  const rules = tavernField(cardFile, 'tavernPrompt')
  if (persona === '' && rules === '') return ''

  const sub = (text) => substitute(text, names.charName, names.user)
  const parts = []
  if (persona !== '') parts.push(sub('# 關於 {{user}}\n' + persona))
  if (rules !== '') parts.push(sub('# 這間店的規則\n' + rules))
  return parts.join('\n\n')
}

/**
 * 讀一間房（`chats/<角色>/<roomId>/room.json`）。
 *
 * 房間的設定**蓋過**酒館的——這是「有些設定適合精細化設定而不適合全域設定」的落地。
 * `allowTools` 用 `inherit` 表示「聽酒館的」（房間的預設值），其餘值才是這間房自己的選擇。
 *
 * ⚠️ 讀不到一律回**空物件**（**不丟錯**）：房間設定不該有辦法讓一整輪對話失敗。
 * 而且綁定可能還是舊形狀（只有 `chat`），那就當作「沒有房間設定」——回到酒館那一層。
 */
function roomJson(binding) {
  if (binding === null || binding === undefined) return {}
  const room = typeof binding.room === 'string' && binding.room !== '' ? binding.room : binding.chat
  if (typeof room !== 'string' || room === '') return {}
  return readJsonObject(join(binding.root, 'chats', binding.character, room, 'room.json'))
}

/** 讀一間房裡的一個字串欄位。 */
function roomField(binding, key) {
  const value = roomJson(binding)[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 從 `{ spec, spec_version, data }` 信封取出卡片本體。
 *
 * 跟 `lib/workspace.js` 的 `unwrapCard()` 同一個規則，但這裡刻意**不 import 它**
 * ——Agent 面是獨立的一面，不該為了三個欄位把整個資料層拉進來
 * （也讓它可以被單獨測試）。
 */
function unwrapCard(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const data = parsed.data
  if (data !== null && typeof data === 'object' && Array.isArray(data) === false) return data
  return parsed
}

/** 安全地取一個字串欄位（缺欄位、型別錯、只有空白都當作沒有）。 */
function field(card, key) {
  const value = card[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}

/**
 * 把 `{{char}}` / `{{user}}` 換掉。
 *
 * SillyTavern 的巨集比這個多得多（`{{persona}}`、`{{scenario}}`…），
 * 但那些是**它自己的模板系統**在送出去之前處理的。我們只做這兩個，
 * 因為它們是角色卡裡最常見、而且**不換掉整張卡就讀不通**的兩個。
 *
 * 刻意**不支援**其他巨集：認不得的就原樣留著，讓使用者看得見，
 * 而不是被我們默默吃掉。
 */
function substitute(text, charName, userName) {
  return text.replace(/\{\{char\}\}/gi, charName).replace(/\{\{user\}\}/gi, userName)
}

/**
 * 把一張卡組成系統提示的文字。
 *
 * **欄位順序照 SillyTavern 的預設 Prompt Manager 順序**（`openai.js` 的
 * `promptManagerDefaultPromptOrder`）：main → description → personality →
 * scenario → dialogueExamples。理由不是崇拜它，是那個順序是**被驗證過的**
 * ——社群調出來的最佳順序，我們沒有理由自己發明一套。
 *
 * @param card - 卡片本體（已經過 `unwrapCard`）。
 * @param userName - `{{user}}` 要換成什麼。
 * @returns 要當成系統提示的文字。
 */
export function renderCard(card, userName) {
  // v3 的 `nickname` **優先**：規格說 `{{char}}` 應該替換成它而不是 `name`
  // （`name` 是這張卡的標題，`nickname` 是店裡的人怎麼叫她）。留空就退回 `name`，
  // 所以 v2 的卡片行為完全不變。
  // ⚠️ 這兩個名字走 `charNameOf`／`userNameOf`——`tavernExtras` 用的是同一組，
  //    抄一份在這裡就會出現「同一份提示詞裡兩個名字不一樣」。
  const charName = charNameOf(card)
  const user = userNameOf(userName)
  const sub = (text) => substitute(text, charName, user)

  const blocks = []

  // 1. 主提示。SillyTavern 的預設就是這一句；卡片自己有 system_prompt 就整段取代它
  //    （ST 的 `prefer_character_prompt` 預設開啟，行為是「取代」不是「附加」）。
  const cardSystem = field(card, 'system_prompt')
  blocks.push(
    sub(cardSystem !== '' ? cardSystem : "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}."),
  )

  // 2-4. 卡片的三個主要欄位。ST 送出去的是**原文**，沒有加任何標題或包裝；
  //      但那是因為它把每個欄位當成獨立的 system 訊息送。
  //      我們只有一條系統提示，所以需要標題把段落分開——這是**為了合併而加的**，
  //      不是抄錯。
  const description = field(card, 'description')
  if (description !== '') blocks.push('# 人設\n' + sub(description))

  const personality = field(card, 'personality')
  if (personality !== '') blocks.push('# 性格\n' + sub(personality))

  const scenario = field(card, 'scenario')
  if (scenario !== '') blocks.push('# 場景\n' + sub(scenario))

  // 5. 對話示範。ST 把它切成 `<START>` 區塊、每行變成一條 system 訊息並跳過第一行；
  //    我們是純文字，所以只做「跳過第一行」那件事的等價處理：
  //    第一行慣例上是「This is how X should talk」的說明，不是示範本身。
  const example = field(card, 'mes_example')
  if (example !== '') blocks.push('# 對話示範\n' + sub(stripExampleHeaders(example)))

  // 6. 開場白。
  //
  // ⚠️ 這一條是**我們的模型跟 ST 不一樣**的地方，必須誠實標記：
  //    ST 把 first_mes 當成對話的第 0 則訊息（角色說的），跟著歷史一起送進去，
  //    所以模型知道「我剛剛講過這句」。但 DSH 的 `session.prompt()` **只能加
  //    使用者訊息**，加不了「角色說過的話」。
  //    所以我們把它寫進系統提示，讓模型知道自己的開場白是什麼。
  const firstMes = field(card, 'first_mes')
  if (firstMes !== '') blocks.push('# 你對使用者說的第一句話\n' + sub(firstMes))

  return blocks.join('\n\n')
}

/** 去掉 `mes_example` 裡慣例性的說明行（ST 也是跳過第一行）。 */
function stripExampleHeaders(example) {
  const lines = example.split(/\r?\n/)
  if (lines.length > 1 && /^\s*<START>\s*$/i.test(lines[0]) === false) {
    const looksLikeHeader = /^\s*(this is how|以下是|底下是)/i.test(lines[0])
    if (looksLikeHeader) return lines.slice(1).join('\n').trim()
  }
  return example
}

/**
 * 讀一張卡，必要時重讀。
 *
 * @param file - 卡片 JSON 的**絕對路徑**。
 * @param userName - 給 `{{user}}` 用。
 * @returns 卡片文字；讀不到時回空字串（**不丟錯**）。
 *
 * 為什麼讀不到不丟錯：provider 是在**每一次模型請求**裡被呼叫的。
 * 在這裡丟錯等於「卡片檔被搬到別的地方 → 每一輪都失敗」，而且錯誤會以
 * 很難懂的形式冒出來。回空字串的話，section 是空的、系統提示只剩我們的
 * 最小內容，對話仍然可以繼續，而且使用者看得見「角色不見了」。
 *
 * ⚠️ **快取鍵要連名字一起比**（2.6.47 修）。`{{user}}` 是**渲染出來的內容**，
 * 所以「名字」是這份快取的一部分。以前只比 `mtime`，於是使用者在 ⚙️ 設定
 * 改了自己的名字之後，卡片**不會重畫**——症狀是「改了名字，提示詞裡還是舊的」，
 * 而且只有去動卡片檔（或重啟）才會好。`renderCard` 的結果同時取決於
 * (檔案內容, userName)，快取鍵就必须是那兩個。
 */
export function readCard(file, userName) {
  if (typeof file !== 'string' || file === '') return ''
  const user = userNameOf(userName)
  let stamp
  try {
    stamp = statSync(file).mtimeMs
  } catch (error) {
    cache.delete(file)
    return ''
  }
  const hit = cache.get(file)
  if (hit !== undefined && hit.stamp === stamp && hit.user === user) return hit.text

  let card = null
  let text = ''
  try {
    card = unwrapCard(JSON.parse(readFileSync(file, 'utf8')))
    text = renderCard(card, user)
  } catch (error) {
    // 壞掉的 JSON 也算「這個檔案現在不能用」，但下一次 mtime 一變就會重試。
    card = null
    text = ''
  }
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(file, { stamp, user, text, card })
  return text
}

/**
 * 這一輪的兩個名字（`{{char}}` 與 `{{user}}` 各要換成什麼）。
 *
 * 為什麼要一起拿：`renderCard`、`tavernExtras`、房間的「這一場」三段都要這兩個值。
 * 各自從卡片檔算一次的話，同一份提示詞裡就可能出現兩個不同的名字。
 *
 * ⚠️ 走 `readCard` 的**同一份快取**，所以不會多讀一次檔。回傳的一定是
 * 跟 `readCard(file, userName)` 那一次渲染**同一組**名字。
 */
export function readCardNames(file, userName) {
  const user = userNameOf(userName)
  readCard(file, userName)
  const hit = cache.get(file)
  // 讀不到卡片（檔案不在／JSON 壞掉）→ 名字退回預設，但那兩段額外的文字
  // **照樣送出去**（persona 是使用者寫的，不該因為卡片檔壞掉就消失）。
  const card = hit === undefined || hit.card === null ? {} : hit.card
  return { charName: charNameOf(card), user: user }
}

/**
 * 把「**繼承來的**全域工具」全部擋掉。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 為什麼需要這一條（spike 實測發現的）：
 *
 * `complete: true` 讓系統提示只剩角色卡，**但不會**讓工具消失。DSH 自己的
 * 工具是「掛在 preset 裡」的（出貨的 web 組合把它們在主機平面停用、移到 preset
 * 後面），所以不掛就沒有。**但第三方插件不一定要遵守那個慣例**——實測時
 * 有一個第三方插件把工具註冊在**全域**，於是酒館模式的 session 照樣看得到
 * 一整套它的工具，而且**真的呼叫得動**（模型成功執行了其中一個，拿到真實回傳）。
 *
 * 對角色扮演來說那是災難：模型會開始報工具清單、想開瀏覽器、直接出戲。
 *
 * 解法用 DSH 自己的機制（`ctx.tools.restrict`，`dsh-tools/lib/index.js:2790`）：
 * 它是「**per-scope 的全域工具遮罩**」，而且**不影響 scope 自己註冊的工具**
 * （`Restrictions intersect and do not affect scoped registrations`）。
 * 所以：
 *   - 繼承來的全域工具（別人的）→ 擋掉
 *   - 我們自己掛的酒館工具（未來）→ 不受影響
 *   - 使用者要塞回來 → 之後可以用 preset 的 config 開放特定幾個
 * ────────────────────────────────────────────────────────────────────────
 *
 * @param ctx - 已經拿到 `tools` 的 context。
 * @returns 取消註冊的函式；沒東西要擋時回 `null`。
 */
function denyInheritedTools(ctx) {
  let globalNames
  try {
    // 省略 scope ＝ **全域視圖**（`schemas(scope?)` 的文件：omitted = the global view）。
    // 我們要的正是「不是我們掛的、而是繼承來的那一份」。
    globalNames = ctx.tools
      .schemas()
      .map((schema) => (schema !== null && typeof schema === 'object' ? schema.name : undefined))
      .filter((name) => typeof name === 'string' && name !== '')
      // `run_code` 是 PTC 模式的保留呈現通道，`restrict()` 明講不可以指名它。
      .filter((name) => name !== 'run_code')
  } catch (error) {
    // 拿不到清單就不要擋——**擋錯比不擋嚴重**（可能把使用者真的要用的工具擋掉）。
    return null
  }
  if (globalNames.length === 0) return null
  // ⚠️ `restrict({})`（空篩選）會丟錯，所以上面先確認不是空的。
  return ctx.tools.restrict({ deny: globalNames })
}

/**
 * 讀一間酒館裡所有的世界書。
 *
 * 跟卡片用同一套快取策略（`statSync` 比 mtime，變了才重讀重解析），
 * 因為這個函式也是**每一個模型步驟**都會被呼叫。
 *
 * @param root - 酒館資料夾。
 * @returns `[{ id, data }]`；讀不到任何東西時回空陣列（**不丟錯**）。
 */
function readWorldbooks(root) {
  if (typeof root !== 'string' || root === '') return []
  const dir = join(root, 'worldbooks')
  let files
  try {
    // 每一輪都重新列一次目錄：使用者在對話途中丟一本新書進來也該立刻生效，
    // 成本是一次 readdir（幾微秒）。
    files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  } catch (error) {
    return []
  }

  const books = []
  for (const file of files) {
    const path = join(dir, file)
    let stamp
    try {
      stamp = statSync(path).mtimeMs
    } catch (error) {
      bookCache.delete(path)
      continue
    }
    const hit = bookCache.get(path)
    if (hit !== undefined && hit.stamp === stamp) {
      if (hit.data !== null) books.push({ id: file.slice(0, -'.json'.length), data: hit.data })
      continue
    }
    let data = null
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      // 不像世界書的檔案（沒有 entries）就當作沒有——跟匯入時的判準一致。
      data = parsed !== null && typeof parsed === 'object' && parsed.entries !== undefined ? parsed : null
    } catch (error) {
      data = null
    }
    if (bookCache.size >= CACHE_LIMIT) bookCache.clear()
    bookCache.set(path, { stamp, data })
    if (data !== null) books.push({ id: file.slice(0, -'.json'.length), data })
  }
  return books
}

/**
 * 掛上這一面。
 *
 * @param ctx - 這個 preset 的 scope context（**不是** `dsh web` 的根 context）。
 * @param config - 來自 preset 那一列的 `config`。
 */
export function apply(ctx, config) {
  const settings = config !== null && typeof config === 'object' ? config : {}
  const file = typeof settings.card === 'string' ? settings.card : ''
  const user = typeof settings.user === 'string' ? settings.user : ''
  const loreOptions = {
    caseSensitive: settings.worldbookCaseSensitive === true,
    matchWholeWords: settings.worldbookWholeWords === true,
    budgetChars: typeof settings.worldbookBudgetChars === 'number' ? settings.worldbookBudgetChars : undefined,
    /**
     * ⚠️ **酒館層的預設位置**（每一輪從 `tavern.json` 重讀，不快取）。
     *
     * 這一格是「這一間酒館的書預設放哪裡」；每一本書自己的 `position`
     * 蓋過它（見 `positionOf`）。預設值刻意是「沒有」⇒ `positionOf` 會回
     * `'in-chat'`，也就是 2.6.65 以前的行為。
     */
    defaultPosition: '',
  }

  /**
   * 工具權限的套用器（由底下的 `ctx.inject(['tools'])` 填入）。
   *
   * ⚠️ **一定要宣告在 `apply()` 裡面，不能放模組層級**：這個 agent 面是**每個
   * agent 各掛一次**的（同一份 preset 服務所有角色、所有酒館），模組層級的變數
   * 會被所有 session 共用——A 店選「只讀」就會蓋掉 B 店的「全關」。
   */
  let toolLevelApplier = null

  /**
   * 這一輪要掃描的文字（給**系統提示裡**的世界書條目觸發關鍵字用）。
   *
   * ⚠️ **為什麼需要這個**：`system-before`／`system-after` 的條目住在**系統提示**
   * 裡，而那是在 `systemPrompt.assemble()` 時算出來的——那時候我們**看不到
   * messages**（那是 `agent/pre-step` 的東西）。但 `pre-step` 就在同一個回合裡、
   * 而且**比 assembly 早**（順序：`agent/pre-step` → `agent/request` → 送出去），
   * 所以把 `pre-step` 看到的文字留在這裡，assembly 就用得到**同一輪**的它。
   *
   * ⚠️ **key 是 agent id**（不能只放一個模組層級的字串）：同一份 preset 服務
   * 所有 session，共用一格會讓 A 房的關鍵字觸發 B 房的條目。
   */
  const scanCache = new Map()

  /**
   * 從快取拿這一輪的掃描文字；沒有就回空字串（＝只有 `constant` 條目會出現）。
   */
  function scanTextOf(agent) {
    const id = typeof agent?.id === 'string' ? agent.id : ''
    return id === '' ? '' : scanCache.get(id) ?? ''
  }

  /**
   * 世界書裡**要進系統提示**的那兩堆（`system-before`／`system-after`）。
   *
   * ⚠️ 這是 `CARD_VARIABLE` 的取值函式在用的，而它**每一輪**都會跑一次
   * （那是「改卡片下一輪就生效」的機制）——所以成本要小：`readWorldbooks()`
   * 有 mtime 快取，`collectLore()` 是純字串比對，micro 級。
   *
   * 任何一步失敗都回 `null`（**不丟錯**）：世界書是加分項，不該讓提示詞算不出來。
   *
   * @param cardFile - 拿來找酒館資料夾（世界書在 `worldbooks/`）。
   * @param agent - 用來拿這一輪的掃描文字（`agent/pre-step` 留下的）。
   * @returns `groupByPosition()` 的結果，或 `null`。
   */
  function systemLore(cardFile, agent) {
    try {
      const root = join(dirname(cardFile), '..')
      const books = readWorldbooks(root)
      if (books.length === 0) return null
      const binding = resolveBinding(agent)
      const lore = collectLore(books, scanTextOf(agent), {
        ...loreOptions,
        defaultPosition: worldbookPositionOf(root),
        // ⚠️ 房間那一層（位置 ＋ 逐書覆寫）在這裡也要傳——**這是系統提示那一條路**，
        // 少了它，房間把一本書關掉、或把位置改到系統提示，都不會生效。
        roomPosition: roomPositionOf(binding),
        bookOverrides: bookOverridesOf(binding),
        // ⚠️ 條目層的優先序（2.6.71）也要傳：只傳一邊的症狀是**同一輪裡兩堆
        // 條目的順序不一樣**（訊息尾巴照房間的、系統提示照書自己的）。
        entryOverrides: entryOverridesOf(binding),
      })
      if (lore.entries.length === 0) return null
      return groupByPosition(lore.entries)
    } catch (error) {
      return null
    }
  }

  /** 這一間酒館的世界書預設位置（`tavern.json` 的 `worldbookPosition`）。 */
  function worldbookPositionOf(root) {
    const value = readJsonObject(join(root, 'tavern.json')).worldbookPosition
    return typeof value === 'string' ? value : ''
  }

  /**
   * 這一間**房**的世界書預設位置（`room.json` 的 `worldbookPosition`）。
   *
   * ⚠️ **三態**：`null`／`''` ⇒ 回空字串（＝聽酒館的）——那是房間的預設值，
   * 所以既有房間的行為不變。
   */
  function roomPositionOf(binding) {
    const value = roomJson(binding).worldbookPosition
    return typeof value === 'string' ? value : ''
  }

  /**
   * 這一間房對**個別世界書**的覆寫（`room.json` 的 `worldbookOverrides`）。
   *
   * ⚠️ 形狀是 `{ "<書的 id>": { enabled, position } }`，**沒列到的書照酒館那一層**
   * （所以既有房間的行為不變）。回 `{}` 時 `collectLore` 完全不會多做工。
   */
  function bookOverridesOf(binding) {
    const value = roomJson(binding).worldbookOverrides
    return value !== null && typeof value === 'object' && Array.isArray(value) === false ? value : {}
  }

  /**
   * 這一間房對**個別條目 `order`** 的覆寫（`room.json` 的 `worldbookEntryOverrides`）。
   *
   * ⚠️ 形狀是 `{ "<書的 id>": { "<條目的鍵>": { order } } }`，**沒列到的條目照
   * 書自己的值**（所以既有房間一字不差）。回 `{}` 時 `collectLore` 不會多做工。
   *
   * ⚠️ **兩條路都要傳**（訊息尾巴 ＋ 系統提示）：只傳一邊的症狀是**同一輪裡
   * 兩堆條目的順序不一樣**，而那是安靜的（畫面看不出來）。
   */
  function entryOverridesOf(binding) {
    const value = roomJson(binding).worldbookEntryOverrides
    return value !== null && typeof value === 'object' && Array.isArray(value) === false ? value : {}
  }

  /**
   * 卡片放**變數**，section 只放參照。
   *
   * ⚠️ 順序很重要：`variable()` 必須在 `assemble()` 之前就註冊好，而
   * `renderPrompt` 對「引用了一個沒有註冊的變數」是**丟錯**的。
   * 兩個都在 `apply` 裡同步註冊，所以不會有中間狀態。
   */
  ctx.effect(
    () =>
      ctx.systemPrompt.variable(CARD_VARIABLE, (assembly) => {
        // `{{user}}` 的來源，優先序：agent 面的 `settings.user`（這一輪對話的覆寫）
        // → 酒館的 `tavern.json` 的 `userName`（「我是誰」）→ `renderCard` 裡的預設「你」。
        const cardFile = resolveCardFile(assembly?.agent, file)
        const wantedUser = user === '' ? tavernUserName(cardFile) : user
        const card = readCard(cardFile, wantedUser)
        // ⚠️ 名字只算一次（走上面那份快取），三段文字共用——各自算就會出現
        //    「同一份提示詞裡兩個名字」。
        const names = readCardNames(cardFile, wantedUser)
        const binding = resolveBinding(assembly?.agent)
        // 工具權限：**房間蓋過酒館**（`inherit`＝聽酒館的，那是房間的預設值）。
        const roomLevel = roomField(binding, 'allowTools')
        const level = roomLevel !== '' && roomLevel !== 'inherit' ? roomLevel : tavernToolLevel(cardFile)
        if (toolLevelApplier !== null) toolLevelApplier(level)
        // 酒館的兩段（你是誰 ＋ 這間店的規則）＋ **這一場的指示**。
        // 全部留空時原樣回傳，所以「按預設」的提示詞與以前一字不差。
        const parts = []
        /**
         * ⚠️ **回覆格式指令放在最前面**（就在卡片後面、persona 與店規之前）。
         *
         * 為什麼是這個位置：`render.json` 的 `structured`／`marked` 模式是
         * **這一間酒館怎麼運作**的一部分，比「你是誰」與「這家店的規矩」更基礎
         * ——它是「請你這樣回答」而不是「故事背景」。放在後面會被店規那一段
         * 蓋過注意力，而模型對**最後**那一段的遵從度最低（那是 §5.2 講的
         * 「格式掉光」的成因之一）。
         *
         * `plain` 模式回空字串 ⇒ 這一行等於沒有，提示詞與 2.6.65 一字不差。
         */
        const format = renderDirectiveFor(cardFile)
        if (format !== '') parts.push(format)
        const tavernPart = tavernExtras(cardFile, names)
        if (tavernPart !== '') parts.push(tavernPart)
        const roomPrompt = roomField(binding, 'roomPrompt')
        // 「這一場」跟 tavernExtras 一樣要換巨集（2.6.47）：使用者在這一欄寫
        // 「{{user}} 剛走進來」是很自然的寫法。
        if (roomPrompt !== '') {
          parts.push(substitute('# 這一場\n' + roomPrompt, names.charName, names.user))
        }
        /**
         * ⚠️ **世界書的另外兩個位置（2.6.65）**：`system-before` 貼在角色卡
         * **前面**、`system-after` 貼在**後面**（也就是 `parts` 之後）。
         *
         * 兩者都在**系統提示**裡，所以：
         *   - 遵從度比接在使用者訊息裡高（那是格式／規則該去的地方）
         *   - ⚠️ **代價**：系統提示每輪變一次 ⇒ **KV 快取的前綴失效**。
         *     實測第 2 輪起 77～82% 命中是靠「只動尾端」換來的，而這一條
         *     會把它抵銷。所以**預設仍然是 `in-chat`**（見 `positionOf`）。
         *
         * 掃描文字來自 `agent/pre-step`（同一個回合、比 assembly 早）。
         * ⚠️ 拿不到時只有 `constant` 條目會出現——那是安全的降級：**不會**
         * 讓關鍵字條目在不知道對話內容的情況下亂觸發。
         */
        const grouped = settings.useWorldbook === false ? null : systemLore(cardFile, assembly?.agent)
        const head = grouped === null ? '' : textOfEntries(grouped['system-before'])
        const tail = grouped === null ? '' : textOfEntries(grouped['system-after'])
        const body = parts.length === 0 ? card : card + '\n\n' + parts.join('\n\n')
        const withAfter = tail === '' ? body : body + '\n\n' + tail
        return head === '' ? withAfter : head + '\n\n' + withAfter
      }),
    'dsh-tavern: card variable',
  )

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: CARD_SECTION,
        // 放在 persona prefix 的位置（`SECTION_ORDERS.DEPLOYMENT_PERSONA_PREFIX = 0`）。
        order: 0,
        text: '{{' + CARD_VARIABLE + '}}',
        // 這一段就是**全部**的系統提示：harness 身分、工具說明、部署 persona
        // 全部不會出現。這正是我們要的——那個 session 只認得這張卡。
        // 注意：同一個 scope 只能有一個 complete section，所以這個 preset
        // **不可以**再掛 `@deepseek-ai/dsh-persona`（它也會註冊 complete）。
        complete: true,
      }),
    'dsh-tavern: card section',
  )

  // 關掉執行環境快照（沙箱政策、審批政策、委派…那些會以 user 訊息的形式
  // 出現在歷史裡）。角色扮演不需要它們，而且它們會讓對話看起來很亂。
  ctx.effect(() => ctx.systemPrompt.suppressRuntimeContext(), 'dsh-tavern: no runtime context')

  /**
   * 生成參數（`temperature`／`maxTokens`／`stop`）：**每一個請求之前**算一次。
   *
   * ────────────────────────────────────────────────────────────────────────
   * 這條 hook 的形狀是讀 `dsh-agent` 自己的實作抄來的
   * （`dsh-agent/lib/index.js` 的 `installModelSelection`）：`agent/request` 是
   * 一個 **waterfall**，`payload` 是 `{ turn, step, signal }`，而 `next()` 回傳
   * **已經解析好的 `LlmCallConfig`**（`{provider, model, reasoningEffort?, maxTokens?}`）。
   * 要改就「呼叫 `next()`，再回一份蓋過欄位的新物件」。
   *
   * ⚠️ 三個一定要知道的事：
   *
   * 1. **`next()` 一定要呼叫、而且只呼叫一次。** 這是 waterfall，跳過 `next()`
   *    就等於把其他人的決定（例如 DSH 自己的模型選擇）全部吃掉——症狀會是
   *    「選了模型卻沒生效」，而且看起來像 DSH 壞了。
   * 2. **只蓋自己有值的欄位。** 兩層都沒設（`null`）時我們**原樣回傳**，
   *    不塞任何預設值。塞了會改變既有對話的行為，而且會在 `request/header`
   *    留下一次沒人要求過的 `change`（見 `call-config.d.ts` 對快取復用的說明）。
   * 3. **`top_p` 不存在。** DSH 的 `LlmCallConfig` 沒有那個欄位，所以這裡也不做
   *    ——理由寫在 `lib/samplers.js` 的檔頭。
   *
   * ⚠️ `stop` 走的是**同一條路**（`samplerRequestFields` 一起展開），所以它不需
   * 要在這裡多寫一行：會有第二條路的欄位就是「只改了這一半」的開始。
   * ────────────────────────────────────────────────────────────────────────
   */
  ctx.effect(
    () =>
      ctx.on('agent/request', async (payload, next) => {
        const resolved = await next()
        const agent = payload?.agent
        const cardFile = resolveCardFile(agent, file)
        const binding = resolveBinding(agent)
        const fields = samplerRequestFields(resolveSamplers(tavernJson(cardFile), roomJson(binding)))
        // 什麼都沒設 → **原樣回傳同一個物件**（identity 一樣，下游看得出「沒動」）。
        if (Object.keys(fields).length === 0) return resolved
        return { ...resolved, ...fields }
      }),
    'dsh-tavern: sampling params',
  )

  /**
   * 世界書：**每一個模型步驟之前**重新掃描一次。
   *
   * 為什麼是這裡而不是系統提示（R4／R5）：世界書要不要出現取決於**你這句話講到
   * 什麼關鍵字**，所以它是動態的那一半。系統提示每輪變一次會讓 KV 快取的整段
   * 前綴失效；接在最新的使用者訊息前面只會動到尾端。
   */
  if (settings.useWorldbook !== false) {
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      // 別人的 waterfall 可能已經拒絕這一步——那就不要多事。
      if (decision === null || decision === undefined || decision.kind !== 'enter') return decision
      // 任何一步失敗都原樣放行：世界書是加分項，不是對話能不能跑的前提。
      try {
        const binding = resolveBinding(payload?.agent)
        if (binding === null) return decision
        const scanText = textOfMessages(decision.messages)
        /**
         * ⚠️ **把這一輪的文字留下來給系統提示那一邊用。**
         *
         * `system-before`／`system-after` 的條目要在 `CARD_VARIABLE` 裡算，
         * 而那時候看不到 messages——這裡（同一個回合、比 assembly 早）把它存起來，
         * 讓那一邊能對**同一輪**的內容觸發關鍵字。
         */
        const agentId = typeof payload?.agent?.id === 'string' ? payload.agent.id : ''
        if (agentId !== '') scanCache.set(agentId, scanText)
        if (scanText.trim() === '') return decision
        const lore = collectLore(readWorldbooks(binding.root), scanText, {
          ...loreOptions,
          defaultPosition: worldbookPositionOf(binding.root),
          // ⚠️ 房間那一層蓋過酒館（由窄到寬）——沒有它，「同一本書、這一場
          // 想讀得不一樣」就做不到。
          roomPosition: roomPositionOf(binding),
          bookOverrides: bookOverridesOf(binding),
          // ⚠️ 條目層的優先序（2.6.71）：房間調的「哪一條先注入」要在這裡生效。
          entryOverrides: entryOverridesOf(binding),
        })
        if (lore.entries.length === 0) return decision
        /**
         * ⚠️ **依位置分成三堆，只有 `in-chat` 那一堆接在這裡**（2.6.65）。
         *
         * 另外兩堆（`system-before`／`system-after`）走的是**系統提示**那一條路
         * ——它們在 `CARD_VARIABLE` 裡算出來（見上面 `ctx.systemPrompt.variable`），
         * 而不是改這裡的 messages。
         *
         * ⚠️ 兩個地方**必須用同一份 `collectLore` 的結果**：各算一次會出現
         * 「關鍵字命中一次、位置卻對不上」（而且多一次 readdir ＋ parse）。
         * 所以系統提示那一邊也是**每一個模型步驟**重算一次（cost 是微秒級）。
         */
        const tail = textOfEntries(groupByPosition(lore.entries)['in-chat'])
        if (tail === '') return decision
        return { ...decision, messages: prependLore(decision.messages, tail) }
      } catch (error) {
        return decision
      }
    })
  }

  /**
   * 擋掉繼承來的全域工具。
   *
   * ⚠️ 用 `ctx.inject` 而不是把它寫進 `inject` 陣列：這一條是**可選**的。
   * 萬一某個組合裡沒有 `tools` 服務，這一面的核心功能（角色卡）不該跟著陪葬。
   * 這是 Cordis 自己的機制（`ctx.plugin({inject, apply})` 的簡寫），不是我們發明的。
   */
  if (settings.denyGlobalTools !== false) {
    /**
     * 工具權限：**每一間酒館自己選**，預設「全關」——跟原本的行為一樣。
     *
     * DSH 的 `tools.restrict()` 是 **per-agent** 的（它要求 `agent.ctx`，在全域
     * context 會直接丟錯；DSH 自己的註解寫著「要擋就擋那個 agent，不要擋全部」），
     * 所以「這一間店的角色能不能讀檔」做得到，而且是每個 session 各自算。
     *
     * 用 `{ allow: [...] }` 白名單而不是自己列舉全部工具名去 `deny`：一來不必知道
     * DSH 現在有哪些工具，二來**漏列＝關著**（fail closed）。
     *
     * ⚠️ `restrict()` 的限制是**交集**，重複套用只會越縮越緊（先套 `read` 再套
     * `none` 之後就回不去了）。所以記住 `applied`，等級變了才換，換之前先解除舊的。
     */
    ctx.inject(['tools'], (scoped) => {
      // 測試與降級環境的假 `tools` 服務不一定有 `restrict`——沒有就整段跳過。
      // 這一條是可選的，不該讓角色卡那個核心功能陪葬。
      if (typeof scoped.tools?.restrict !== 'function') return

      let applied = null
      let disposer = null

      const applyLevel = (level) => {
        if (level === applied) return
        applied = level
        if (disposer !== null) {
          disposer()
          disposer = null
        }
        const allow = TOOL_LEVELS[level]
        if (allow === null) return // 'all'＝完全放行
        // `none` 走**原本那條路**（`denyInheritedTools`）：它自己會排除保留的
        // `run_code`——`restrict()` 拒收那個名字，而 `test-agent.mjs` 有一條
        // 就在釘這件事（「不可以包含保留的 run_code」）。
        if (level === 'none') {
          disposer = denyInheritedTools(scoped)
          return
        }
        // 其餘等級用白名單：不必知道 DSH 現在有哪些工具，而且**漏列＝關著**。
        try {
          disposer = scoped.tools.restrict({ allow })
        } catch (error) {
          // 清單裡有 DSH 不認識的名字（版本差異）→ **關到底**，不要默默放行。
          applied = 'none'
          disposer = denyInheritedTools(scoped)
        }
      }

      // 預設先關著：還沒讀到酒館設定之前，狀態就是「什麼都沒有」。
      applyLevel('none')

      scoped.effect(
        () => () => {
          if (disposer !== null) disposer()
        },
        'dsh-tavern: tool restrictions',
      )

      toolLevelApplier = applyLevel
    })
  }
}

/** 酒館可以選的工具等級（`tavern.json` 的 `allowTools`）。預設 `none`。 */
export const TOOL_LEVELS = {
  none: [],
  read: ['read', 'glob', 'grep'],
  write: ['read', 'glob', 'grep', 'write', 'edit'],
  web: ['read', 'glob', 'grep', 'web_search', 'web_fetch'],
  all: null, // null＝不套任何限制
}

/**
 * 這間酒館選了哪一級。讀不到、值不在表上、或檔案壞掉 → `none`（**fail closed**）。
 *
 * ⚠️ 讀的那一端也要 fail closed：`workspace.js` 寫入時已經擋掉不明的值，這裡是
 * 第二道——檔案是可以手改的。
 */
function tavernToolLevel(cardFile) {
  const level = tavernField(cardFile, 'allowTools')
  return Object.prototype.hasOwnProperty.call(TOOL_LEVELS, level) ? level : 'none'
}

/** 給測試用：把快取清掉，讓每一條測試都從乾淨的狀態開始。 */
export function __clearCache() {
  cache.clear()
  bookCache.clear()
}

/** 給測試用：直接讀一間酒館的世界書（不必先開 session）。 */
export function __readWorldbooks(root) {
  return readWorldbooks(root)
}
