/**
 * 工作樓：把「現在的行為」變成一張可以拆開的圖。
 *
 * ────────────────────────────────────────────────────────────────────────
 * ## 為什麼預設圖只有三個節點
 *
 * 使用者（2026-09-27）：
 *
 *   > 我們假設現在的行為就已經是一個完整的工作樓，我創建房間，然後選擇了一個角色
 *   > 進去裏面就應該是有一個預設的用戶輸入進入角色然後輸出的樓，我們直接把它拆散
 *   > 就可以了
 *
 * 所以 v1 **不發明節點型別**，而是把現在單人對話的那一條路畫出來：
 *
 *     使用者輸入（input） → 角色（cast） → 輸出（output）
 *
 * **這一張圖跑起來的結果與現在的單人對話一字不差**（同一張卡、同一個 session、
 * 同一條 `session.prompt` → 逐字串流 → 寫回 `chat.jsonl`）。多人房間、導演節點、
 * 工具節點都是「在這張圖上多接幾個節點」，不是另一套系統。
 *
 * ## 為什麼是純函式
 *
 * 這一份**不 import 任何東西**（連 `node:` 都不用）：圖的形狀、清洗、驗證、
 * 拓撲順序全部可以單獨測（`test-workflow.mjs`）。檔案的讀寫留在 `workspace.js`
 * （`workflows/<id>.json`）——那一層才是「使用者的資料」。
 *
 * ## 座標的規矩
 *
 * `at: [x, y]` 只是**畫布座標**，執行完全不看它（執行只看 `edges`）。
 * 所以使用者把節點拖到哪裡都不會改變行為——這是刻意的：**圖的位置是他的記憶，
 * 不是程式的一部分。**
 * ────────────────────────────────────────────────────────────────────────
 */

/** 圖檔住的資料夾（酒館根目錄底下，跟 `characters/`／`worldbooks/` 同一層）。 */
export const WORKFLOW_DIR = 'workflows'

/** 檔案格式版本。讀到不認得的版本時**不報錯**（見 `normalizeWorkflow`）。 */
export const WORKFLOW_VERSION = 1

/**
 * v1 的節點型別。
 *
 * ⚠️ **順序就是「執行時可能的順序」**，不是字母序——加新節點型別時把它插在
 * 對應的位置，讀的人一眼看得出來這張圖能長成什麼樣子。
 *
 * | type | 進 | 出 | 做什麼 |
 * |---|---|---|---|
 * | `input` | — | 使用者這一輪說的話 | 圖的起點；**寫入使用者的那一則** |
 * | `cast` | 上游的文字 | 這個角色的回覆 | 對「這個角色在本房的 session」送一次 prompt |
 * | `output` | 上游的文字 | — | **寫入模型產出的那一則**（＝畫面上的氣泡） |
 *
 * ⚠️ `input` 與 `output` **各自負責寫一則訊息**（一則使用者、一則模型），這正是
 * 現在送訊息那一條路在做的事（使用者的那一則先落地，模型的那一則串流完才落地）。
 * 把它拆成兩個節點是刻意的：這樣「中途失敗」的畫面跟現在一樣——使用者的話留著，
 * 上面顯示錯誤。
 */
export const NODE_TYPES = ['input', 'cast', 'output']

/** 圖的硬上限（防手改的檔案把 UI 拖死；不是安全邊界）。 */
export const WORKFLOW_LIMITS = { nodes: 64, edges: 256, idLength: 40, labelLength: 120 }

/** 節點 id 的合法字元（與 `workspace.js` 的 `SAFE_SEGMENT` 同一個字集）。 */
const SAFE_NODE_ID = /^[\w\u4e00-\u9fff.-]+$/

/** 預設圖的排版間隔（客戶端要有一份一樣的；改這裡就要改 `lib/client.js` 的常數）。 */
export const LAYOUT = { x0: 40, y0: 160, dx: 260, dy: 140 }

/**
 * 一個乾淨的節點 id。
 *
 * ⚠️ 重複的 id 要**讓路**（`cast`、`cast-2`、`cast-3`）：線是靠 id 指的，
 * 兩顆同名節點＝那條線指向誰變成運氣。
 *
 * @param base - 想要的 id（通常是型別名）。
 * @param taken - 已經用掉的 id（`Set` 或陣列）。
 * @returns 沒被用過的 id。
 */
export function uniqueNodeId(base, taken) {
  const used = taken instanceof Set ? taken : new Set(Array.isArray(taken) ? taken : [])
  const seed = typeof base === 'string' && SAFE_NODE_ID.test(base.trim()) ? base.trim() : 'node'
  if (!used.has(seed)) return seed.slice(0, WORKFLOW_LIMITS.idLength)
  for (let n = 2; n < 1000; n += 1) {
    const next = `${seed}-${String(n)}`
    if (!used.has(next)) return next.slice(0, WORKFLOW_LIMITS.idLength)
  }
  return `${seed}-${String(Date.now() % 100000)}`.slice(0, WORKFLOW_LIMITS.idLength)
}

/** 一個有限數（座標用）；不是就回 `fallback`。 */
function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 一串文字，去頭尾空白並截斷；不是字串就回 `''`。 */
function text(value, limit) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, limit)
}

/** 一個「單純的物件」（不是陣列、不是 null）。 */
function plainObject(value) {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false
}

/**
 * 一個節點的 `config`：只留單純的鍵值（字串／數字／布林／null）。
 *
 * ⚠️ **刻意不深拷貝**：`config` 是使用者會手改的地方，但也不該變成一棵樹。
 * 巢狀的東西（陣列／物件）在這裡直接丟掉並回報——「設定多到需要巢狀」是
 * 該設計成新的節點型別，而不是把 config 變成一個小資料庫。
 */
function normalizeConfig(raw, dropped, where) {
  const out = {}
  if (!plainObject(raw)) return out
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || key === '' || key.length > WORKFLOW_LIMITS.idLength) continue
    const type = typeof value
    if (value === null || type === 'string' || type === 'number' || type === 'boolean') {
      if (type === 'number' && Number.isFinite(value) === false) continue
      if (type === 'string' && value.length > WORKFLOW_LIMITS.labelLength * 8) continue
      out[key] = value
      continue
    }
    dropped.push(`${where}.config.${key}：只接受字串／數字／布林／null`)
  }
  return out
}

/**
 * 清洗一張圖。
 *
 * **壞掉的東西一律丟掉並回報**（回傳的 `dropped` 是給使用者看的中文句子），
 * 而不是丟錯：圖是使用者會手改的檔案（跟 `room.json` 同一個原則），
 * 為了一個打錯的字讓整頁打不開是最糟的失敗方式。
 *
 * @param raw - 任何東西（通常是 JSON.parse 的結果）。
 * @returns `{ workflow, dropped }`——`workflow` 一定是一張合法的形狀（可能是空的）。
 */
export function normalizeWorkflow(raw) {
  const dropped = []
  const source = plainObject(raw) ? raw : {}
  if (plainObject(raw) === false && raw !== undefined && raw !== null) {
    dropped.push('整份圖不是一個物件，已忽略')
  }

  const nodes = []
  const seen = new Set()
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : []
  if (Array.isArray(source.nodes) === false && source.nodes !== undefined) dropped.push('nodes 不是陣列，已忽略')
  for (const entry of rawNodes) {
    if (nodes.length >= WORKFLOW_LIMITS.nodes) {
      dropped.push(`節點超過 ${String(WORKFLOW_LIMITS.nodes)} 個，多的已忽略`)
      break
    }
    if (!plainObject(entry)) {
      dropped.push('有一個節點不是物件，已忽略')
      continue
    }
    const type = text(entry.type, 40)
    if (NODE_TYPES.includes(type) === false) {
      dropped.push(`節點型別不認得：${type === '' ? '(空白)' : type}`)
      continue
    }
    const wanted = text(entry.id, WORKFLOW_LIMITS.idLength)
    const id = wanted === '' || SAFE_NODE_ID.test(wanted) === false ? uniqueNodeId(type, seen) : uniqueNodeId(wanted, seen)
    if (wanted !== '' && id !== wanted) dropped.push(`節點 id「${wanted}」重複或非法，已改用「${id}」`)
    seen.add(id)
    const at = Array.isArray(entry.at) ? entry.at : []
    const column = nodes.length
    nodes.push({
      id,
      type,
      at: [
        finiteOr(at[0], LAYOUT.x0 + column * LAYOUT.dx),
        finiteOr(at[1], LAYOUT.y0),
      ],
      config: normalizeConfig(entry.config, dropped, id),
    })
  }

  const edges = []
  const wireSeen = new Set()
  const rawEdges = Array.isArray(source.edges) ? source.edges : []
  if (Array.isArray(source.edges) === false && source.edges !== undefined) dropped.push('edges 不是陣列，已忽略')
  for (const entry of rawEdges) {
    if (edges.length >= WORKFLOW_LIMITS.edges) {
      dropped.push(`線超過 ${String(WORKFLOW_LIMITS.edges)} 條，多的已忽略`)
      break
    }
    if (!plainObject(entry)) {
      dropped.push('有一條線不是物件，已忽略')
      continue
    }
    const from = text(entry.from, WORKFLOW_LIMITS.idLength)
    const to = text(entry.to, WORKFLOW_LIMITS.idLength)
    if (seen.has(from) === false || seen.has(to) === false) {
      dropped.push(`線 ${from === '' ? '(空白)' : from} → ${to === '' ? '(空白)' : to}：接不到的節點，已忽略`)
      continue
    }
    if (from === to) {
      dropped.push(`線 ${from} → ${to}：自己接自己，已忽略`)
      continue
    }
    // ⚠️ `port` 是**保留欄位**：v1 的節點只有一個輸出，所以它一定是空的；
    //    但工具節點（成功／失敗兩條線）會用到它——先留著，免得那個時候要改格式。
    const port = text(entry.port, WORKFLOW_LIMITS.idLength)
    const key = `${from}\u0000${to}\u0000${port}`
    if (wireSeen.has(key)) {
      dropped.push(`線 ${from} → ${to} 重複，已忽略`)
      continue
    }
    wireSeen.add(key)
    edges.push(port === '' ? { from, to } : { from, to, port })
  }

  const version = Number.isInteger(source.version) ? source.version : WORKFLOW_VERSION
  // ⚠️ **不報錯**：版本比我們新時照讀（多出來的鍵留著不認識就算了）。圖是使用者的
  //    資產，寧可少顯示幾個節點，也不要讓它整張打不開。
  if (version > WORKFLOW_VERSION) dropped.push(`圖的版本是 ${String(version)}（這一版只認到 ${String(WORKFLOW_VERSION)}），照讀`)

  return {
    workflow: {
      version: WORKFLOW_VERSION,
      id: text(source.id, 80),
      name: text(source.name, WORKFLOW_LIMITS.labelLength),
      nodes,
      edges,
    },
    dropped,
  }
}

/**
 * 這張圖能不能跑。
 *
 * **兩級**（這一組分法是刻意的）：
 *   - `errors`：圖**壞了**（有環、沒有起點）→ 連存都不該存。
 *   - `warnings`：圖**可以存、但現在跑不動**（例如 `cast` 還沒選角色）。
 *     編輯到一半的圖一定會處在這種狀態，所以它不能是錯誤。
 *
 * @param workflow - `normalizeWorkflow()` 的結果。
 * @returns `{ ok, errors, warnings }`；`ok` 只看 `errors`。
 */
export function validateWorkflow(workflow) {
  const errors = []
  const warnings = []
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : []
  const edges = Array.isArray(workflow?.edges) ? workflow.edges : []
  const byId = new Map()
  for (const node of nodes) byId.set(node.id, node)

  const inputs = nodes.filter((node) => node.type === 'input')
  const outputs = nodes.filter((node) => node.type === 'output')
  if (inputs.length === 0) errors.push('這張圖沒有「使用者輸入」節點——沒有起點就跑不起來')
  if (outputs.length === 0) errors.push('這張圖沒有「輸出」節點——跑出來的東西沒有地方去')
  if (inputs.length > 1) warnings.push(`有 ${String(inputs.length)} 個「使用者輸入」節點，每一輪會從全部的輸入開始`)

  for (const node of nodes) {
    if (node.type !== 'cast') continue
    const card = typeof node.config?.card === 'string' ? node.config.card.trim() : ''
    if (card === '') warnings.push(`角色節點「${node.id}」還沒選角色卡`)
  }

  const order = topoOrder(workflow)
  if (order.ok === false) errors.push(order.error)

  return { ok: errors.length === 0, errors, warnings }
}

/**
 * 拓撲順序（**分層**：同一層裡的節點互不依賴，可以並聯跑）。
 *
 * 這是工作樓的執行合約中樞：`layers[0]` 先跑，全部完成才跑 `layers[1]`，
 * 同一個 layer 裡的一起跑。所以「三個角色同時想」不需要任何額外的機制
 * ——它就是同一層裡的三個節點。
 *
 * @param workflow - 清洗過的圖。
 * @returns `{ ok, layers, error }`；有環時 `ok: false`（並指出環上的節點）。
 */
export function topoOrder(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : []
  const edges = Array.isArray(workflow?.edges) ? workflow.edges : []
  const ids = nodes.map((node) => node.id)
  const known = new Set(ids)
  const incoming = new Map(ids.map((id) => [id, 0]))
  const next = new Map(ids.map((id) => [id, []]))
  for (const edge of edges) {
    if (known.has(edge.from) === false || known.has(edge.to) === false) continue
    next.get(edge.from).push(edge.to)
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
  }

  const layers = []
  let ready = ids.filter((id) => (incoming.get(id) ?? 0) === 0)
  let placed = 0
  while (ready.length > 0) {
    layers.push(ready)
    placed += ready.length
    const following = []
    for (const id of ready) {
      for (const target of next.get(id) ?? []) {
        incoming.set(target, (incoming.get(target) ?? 0) - 1)
        if (incoming.get(target) === 0) following.push(target)
      }
    }
    ready = following
  }

  if (placed !== ids.length) {
    const stuck = ids.filter((id) => (incoming.get(id) ?? 0) > 0)
    return {
      ok: false,
      layers: [],
      error: `圖裡有循環：${stuck.join(' → ')}（工作樓不接受迴圈，請把其中一條線刪掉）`,
    }
  }
  return { ok: true, layers, error: '' }
}

/**
 * **執行計畫**：把圖壓成「照順序跑的層」，每一顆節點帶著它的上游。
 *
 * 這是宿主半與瀏覽器半之間**唯一**需要對齊的東西——而它是宿主算的，
 * 所以客戶端不需要再懂一次圖：它只是一個迴圈（跑這一層 → 等全部好了 → 跑下一層）。
 *
 * ⚠️ **為什麼不讓客戶端自己算拓撲**：客戶端是手寫的 `__ModuleLoader__` bundle，
 * 沒有 ESM、不能 import 這一支。兩邊各寫一份圖的邏輯＝兩份會走散的真相，而走散的
 * 症狀是「畫面上接的線跟實際跑的不一樣」——那比壞掉更難查。
 *
 * 每一顆節點在計畫裡長這樣：
 *
 * ```js
 * { id: 'cast', type: 'cast', config: {…}, from: ['input'] }
 * ```
 *
 * `from` **照 `edges` 的順序**（不是字母序）：上游的輸出要接起來餵給這一顆，
 * 而接的順序就是使用者在畫布上拉線的順序——那是他唯一能表達「先後」的地方。
 *
 * @param workflow - 清洗過的圖。
 * @returns `{ ok, error, layers }`；有環時 `ok: false`（那一輪不該開始跑）。
 */
export function planRun(workflow) {
  const order = topoOrder(workflow)
  if (order.ok === false) return { ok: false, error: order.error, layers: [] }

  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : []
  const edges = Array.isArray(workflow?.edges) ? workflow.edges : []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, []]))
  for (const edge of edges) {
    if (incoming.has(edge.to) === false || byId.has(edge.from) === false) continue
    incoming.get(edge.to).push(edge.from)
  }

  const layers = order.layers.map((ids) =>
    ids.map((id) => {
      const node = byId.get(id)
      return {
        id,
        type: node.type,
        config: node.config ?? {},
        from: incoming.get(id) ?? [],
      }
    }),
  )
  return { ok: true, error: '', layers }
}

/**
 * 一張圖的一行摘要（清單／卡片用；**不含**節點本身）。
 *
 * @param workflow - 清洗過的圖。
 * @returns `{ id, name, nodes, edges, cards, broken }`。
 */
export function summarizeWorkflow(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : []
  const edges = Array.isArray(workflow?.edges) ? workflow.edges : []
  const cards = []
  for (const node of nodes) {
    if (node.type !== 'cast') continue
    const card = typeof node.config?.card === 'string' ? node.config.card.trim() : ''
    if (card !== '' && cards.includes(card) === false) cards.push(card)
  }
  const check = validateWorkflow(workflow)
  return {
    id: typeof workflow?.id === 'string' ? workflow.id : '',
    name: typeof workflow?.name === 'string' ? workflow.name : '',
    nodes: nodes.length,
    edges: edges.length,
    cards,
    broken: check.ok === false,
  }
}

/**
 * **一間房的預設圖**：使用者輸入 → 這一間房的成員 → 輸出。
 *
 * 這一支是整個功能的起點：任何一間房（包含 2.7.0 以前就存在的房）打開工作樓時
 * 看到的都是這一張圖，而它跑起來與現在的單人對話**一字不差**。使用者要做的
 * 不是「學會畫圖」，而是「把這一張拆開、在中間插東西」。
 *
 * ## 多人房間（2.7.0）
 *
 * `cast` 有 N 個人就畫 N 顆角色節點，**並聯**接去輸出：
 *
 * ```
 *                  ┌─ 老闆娘 ─┐
 *   使用者輸入 ────┼─ 酒保 ───┼──→ 輸出（一人一則）
 *                  └─ 常客 ───┘
 * ```
 *
 * ⚠️ **為什麼預設是並聯不是串聯**：串聯＝「後面的角色看得到前面的發言」，那是
 * **這張圖要表達的東西**，要由使用者自己拉線決定（而且那正是「先想心理狀態、
 * 再交給導演」那一種流程的起點）。預設把它做成串聯＝我們替他決定了群聊的規則，
 * 而他第一次打開這一頁看到的就不會是「原來現在是這樣」。
 *
 * ⚠️ 單人房（`cast` 空）畫出來的就是**三個節點一條線**——與 2.6.x 的單人對話
 * 完全等價，這也是為什麼既有房間不必做任何事。
 *
 * ⚠️ **呼叫端不要把它寫進磁碟**（`docs/plan.md` 的既有規矩：讀取只讀）。
 * 只有在使用者真的改了圖之後，`workflow.write` 才會落地。
 *
 * @param options - `{ card, cast, name, id }`：房主的卡 id、成員清單（`cast` 優先）、
 *   圖的顯示名、圖的 id。
 * @returns 清洗過的圖。
 */
export function defaultWorkflow(options) {
  const card = text(options?.card, 80)
  const rawCast = Array.isArray(options?.cast) ? options.cast : []
  const members = []
  for (const one of rawCast) {
    const id = text(one, 80)
    if (id !== '' && members.includes(id) === false) members.push(id)
  }
  if (members.length === 0 && card !== '') members.push(card)
  const name = text(options?.name, WORKFLOW_LIMITS.labelLength)
  const id = text(options?.id, 80)

  // 多人時把「輸入」與「輸出」放在成員的**垂直中間**，圖才不會歪一邊。
  const span = Math.max(0, members.length - 1) * LAYOUT.dy
  const middle = LAYOUT.y0 + span / 2
  const nodes = [{ id: 'input', type: 'input', at: [LAYOUT.x0, middle], config: {} }]
  const edges = []
  const taken = new Set(['input', 'output'])
  /**
   * ⚠️ **一個成員都沒有時，還是畫一顆沒有卡的角色節點**（而且 `validateWorkflow`
   * 會為它發一個警告）。不畫的話圖會變成「使用者輸入 → 輸出」——那會把你說的
   * 那句話**當成角色的回覆寫進對話紀錄**（紀錄開始說謊），而且畫面上完全看不出來
   * 有哪裡不對。留著那顆空節點＝「還沒選人」是一個**看得見**的狀態。
   */
  const plan = members.length === 0 ? [''] : members
  plan.forEach((member, index) => {
    const nodeId = uniqueNodeId(index === 0 ? 'cast' : `cast-${String(index + 1)}`, taken)
    taken.add(nodeId)
    nodes.push({
      id: nodeId,
      type: 'cast',
      at: [LAYOUT.x0 + LAYOUT.dx, LAYOUT.y0 + index * LAYOUT.dy],
      // ⚠️ 卡 id 直接寫進 config：這是「這一張圖屬於誰」的**唯一**依據，
      //    執行時不會去猜（猜出來的東西沒辦法解釋給使用者聽）。
      config: member === '' ? {} : { card: member },
    })
    edges.push({ from: 'input', to: nodeId })
    edges.push({ from: nodeId, to: 'output' })
  })
  nodes.push({ id: 'output', type: 'output', at: [LAYOUT.x0 + LAYOUT.dx * 2, middle], config: {} })

  return normalizeWorkflow({
    version: WORKFLOW_VERSION,
    id,
    name: name === '' ? (members.length === 0 ? '預設工作樓' : `${members.join('、')}：預設工作樓`) : name,
    nodes,
    edges,
  }).workflow
}
