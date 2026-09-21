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
import { join } from 'node:path'
import { collectLore, prependLore, textOfMessages } from './worldbook.js'

/** 這一面的版本標記，跟另外兩面分開（三面各自演化）。 */
export const AGENT_BUILD = 'tavern-agent-2.6.4'
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
    return { root, character }
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
/**
 * 從卡片檔的位置推出酒館的 `tavern.json`，讀出 `userName`（`{{user}}` 要換成什麼）。
 *
 * 卡片路徑固定是 `<酒館>/characters/<id>.json`，所以 `tavern.json` 就在上一層。
 * 讀不到、欄位不存在、或檔案壞掉都回空字串——呼叫端會退回 `renderCard` 的預設「你」。
 * 這裡刻意**不丟錯**：使用者名稱不該有辦法讓一整輪對話失敗。
 */
function tavernUserName(cardFile) {
  try {
    const raw = JSON.parse(readFileSync(join(dirname(cardFile), '..', 'tavern.json'), 'utf8'))
    return typeof raw?.userName === 'string' ? raw.userName.trim() : ''
  } catch {
    return ''
  }
}

export function resolveCardFile(agent, fallbackCard) {
  const binding = resolveBinding(agent)
  if (binding !== null) {
    return join(binding.root, 'characters', `${binding.character}.json`)
  }
  return typeof fallbackCard === 'string' ? fallbackCard : ''
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
  const charName = field(card, 'nickname') || field(card, 'name') || '角色'
  const user = typeof userName === 'string' && userName.trim() !== '' ? userName.trim() : DEFAULT_USER
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
 */
export function readCard(file, userName) {
  if (typeof file !== 'string' || file === '') return ''
  let stamp
  try {
    stamp = statSync(file).mtimeMs
  } catch (error) {
    cache.delete(file)
    return ''
  }
  const hit = cache.get(file)
  if (hit !== undefined && hit.stamp === stamp) return hit.text

  let text = ''
  try {
    text = renderCard(unwrapCard(JSON.parse(readFileSync(file, 'utf8'))), userName)
  } catch (error) {
    // 壞掉的 JSON 也算「這個檔案現在不能用」，但下一次 mtime 一變就會重試。
    text = ''
  }
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(file, { stamp, text })
  return text
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
        return readCard(cardFile, user === '' ? tavernUserName(cardFile) : user)
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
        if (scanText.trim() === '') return decision
        const lore = collectLore(readWorldbooks(binding.root), scanText, loreOptions)
        if (lore.text === '') return decision
        return { ...decision, messages: prependLore(decision.messages, lore.text) }
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
    ctx.inject(['tools'], (scoped) => {
      scoped.effect(() => denyInheritedTools(scoped), 'dsh-tavern: deny inherited global tools')
    })
  }
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
