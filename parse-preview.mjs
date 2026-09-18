/**
 * 顯示層解析器的預覽工具：**貼一段文字，看它被讀成什麼節點**。
 *
 * 用法：
 *   node parse-preview.mjs "海浪拍打著礁石。\n「別點燈。」"
 *   node parse-preview.mjs --file 某個檔案.txt
 *   type 某個檔案.txt | node parse-preview.mjs -
 *   node parse-preview.mjs --json "..."          # 印出原始節點樹
 *   node parse-preview.mjs --markers markers.json "..."   # 加上標記宣告再測
 *
 * 為什麼要有這一支：解析器是**純函式**，所以「它讀懂了沒」不必先接畫面就能驗。
 * 而且它驗的是**真正會跑在瀏覽器裡的那一份程式**——`lib/client.js` 的 bundle
 * 直接被載進來執行（跟 `test-client.mjs` 同一個做法），不是另外抄一份。
 *
 * ⚠️ 這裡只載 bundle 的**定義**（factory 被呼叫、拿到 exports），不跑任何
 * React 或 DOM 的東西——所以只需要一個最小的假 `window` 與空的 `react` 替身。
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
let asJson = false
let markersFile = ''
let chatFile = ''
const positional = []
for (let i = 0; i < args.length; i += 1) {
  const one = args[i]
  if (one === '--json') asJson = true
  else if (one === '--file') {
    positional.push({ file: args[i + 1] })
    i += 1
  } else if (one === '--chat') {
    chatFile = args[i + 1]
    i += 1
  } else if (one === '--markers') {
    markersFile = args[i + 1]
    i += 1
  } else positional.push({ text: one })
}

/* ------------------------- 載入 bundle（只有定義） ------------------------- */

const registrations = []
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      registrations.push(entry)
    },
  },
  addEventListener() {},
  removeEventListener() {},
  setTimeout: () => 0,
  clearTimeout() {},
  setInterval: () => 0,
  clearInterval() {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
}
const source = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
new Function('window', 'document', 'fetch', 'console', source)(
  globalThis.window,
  { head: { appendChild() {} }, body: { childNodes: [], appendChild() {}, removeChild() {} }, createElement: () => ({ setAttribute() {} }) },
  () => Promise.resolve({}),
  console,
)
const exportsObject = registrations[0].factory((spec) => {
  if (spec === 'react') return {}
  throw new Error(`未預期的 require：${spec}`)
})
const { parse, repair, DEFAULT_CONFIG } = exportsObject.__display

/* --------------------------------- 輸入 --------------------------------- */

let text = ''
const first = positional[0]
if (first === undefined && chatFile === '') {
  console.log('用法：')
  console.log('  node parse-preview.mjs --chat "chats/角色/對話.jsonl"   # 整份對話（最常用）')
  console.log('  node parse-preview.mjs "文字"                            # 單段文字')
  console.log('  node parse-preview.mjs --file 檔案.txt')
  console.log('  type 檔案.txt | node parse-preview.mjs -')
  console.log('  加上 --markers markers.json 可以測標記；--json 印原始節點樹')
  process.exit(0)
} else if (first === undefined) {
  // 只有 --chat：不需要文字輸入。
} else if (first.file !== undefined) {
  text = readFileSync(first.file, 'utf8')
} else if (first.text === '-') {
  text = readFileSync(0, 'utf8')
} else {
  text = positional.map((one) => String(one.text).replace(/\\n/g, '\n')).join(' ')
}

let config = {}
if (markersFile !== '') {
  const parsed = JSON.parse(readFileSync(markersFile, 'utf8'))
  config = Array.isArray(parsed) ? { markers: parsed } : parsed
}

/* --------------------------------- 輸出 --------------------------------- */

const result = parse(text, config)

/** 一則訊息的節點 → 一行一行的可讀輸出。 */
function printNodes(nodes, indent) {
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length))
  const tally = {}
  let lastLine = null
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    tally[node.kind] = (tally[node.kind] === undefined ? 0 : tally[node.kind]) + 1
    const who = node.who === '' || node.who === undefined ? '' : '  ← ' + node.who
    // 同一行的第二個片段用 `↳` 標出來——那正是「台詞＋旁白擠在同一行」的樣子。
    const continued = lastLine !== null && node.para === lastLine
    lastLine = node.para
    let body = node.text
    if (Array.isArray(node.rows)) {
      // 資料區塊：把 key: value 攤開印，這樣「有沒有被拆成欄位」一眼看得出來。
      body = '資料 ' + String(node.rows.length) + ' 列 → ' + node.rows.map((r) => r.key + '=' + r.value).join('、')
      if (body.length > 64) body = body.slice(0, 64) + '…'
    } else if (body === '') body = '（空行）'
    else {
      const lines = body.split('\n')
      // 區塊內容常常是多行——只印第一行，其餘用行數帶過（不然整份 dump 很貴）。
      if (lines.length > 1) body = lines[0].slice(0, 48) + '  （＋' + String(lines.length - 1) + ' 行）'
      else if (body.length > 56) body = body.slice(0, 56) + '…'
    }
    console.log(
      indent + (continued ? '   ↳ ' : String(i + 1).padStart(3) + '  ') + pad(node.kind, 10) + pad(node.source, 8) + body + who,
    )
  }
  return tally
}

function sumTally(into, one) {
  for (const key of Object.keys(one)) into[key] = (into[key] === undefined ? 0 : into[key]) + one[key]
  return into
}

/**
 * 印出檢查結果——**兩層分開**。
 *
 *   第一層（格式／語法）：標記成對、引號收尾 → 大部分可以在本地修
 *   第二層（詞彙／schema）：標記名有沒有宣告、內容符不符合約定 → 才需要模型
 */
function printProblems(problems, indent) {
  const layerName = { format: '第一層（格式／語法）', schema: '第二層（詞彙／schema）' }
  const sevName = { fatal: '致命', acceptable: '可接受' }
  if (problems.length === 0) {
    console.log(indent + '✅ 兩層都沒有問題')
    return
  }
  for (const layer of ['format', 'schema']) {
    const list = problems.filter((one) => one.layer === layer)
    if (list.length === 0) continue
    console.log(indent + '§ ' + (layerName[layer] === undefined ? layer : layerName[layer]))
    for (const one of list) {
      const sev = sevName[one.severity] === undefined ? one.severity : sevName[one.severity]
      const tag = one.tag === undefined ? '' : '  <' + one.tag + '>'
      const quote = one.quote === undefined ? '' : '  ' + one.quote
      const value = one.value === undefined ? '' : '  「' + one.value + '」'
      console.log(
        indent + '   ' + String(sev).padEnd(4) + ' ' + String(one.kind).padEnd(16) + 'line ' +
          String(one.line).padStart(3) + tag + quote + value,
      )
    }
  }
}

if (chatFile !== '') {
  /* ------------------------------ 整份對話 ------------------------------ */
  const rawChat = readFileSync(chatFile, 'utf8')
  const messages = []
  let brokenLines = 0
  for (const line of rawChat.split('\n')) {
    if (line.trim() === '') continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      // 壞行跳過——跟 `chat.messages` 同一個規矩：一行壞資料不該毀掉整份對話。
      brokenLines += 1
      continue
    }
    if (typeof parsed.mes !== 'string') continue // 標頭
    messages.push(parsed)
  }

  console.log('§ 對話：' + chatFile + '（' + String(messages.length) + ' 則訊息' + (brokenLines > 0 ? '、' + String(brokenLines) + ' 行壞掉跳過' : '') + '）')
  console.log('§ 標記：' + String(config.markers === undefined ? 0 : config.markers.length) + ' 個　引號：' + String(DEFAULT_CONFIG.quotes.length) + ' 對　括號：' + String(DEFAULT_CONFIG.parens.length) + ' 對')
  console.log('')

  const total = {}
  const sources = {}
  const allProblems = []
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    const who = typeof message.name === 'string' ? message.name : ''
    const role = message.is_user === true ? '你' : who
    const one = parse(message.mes, Object.assign({}, config, { defaultWho: who }))
    console.log('── 第 ' + String(i + 1) + ' 則 · ' + role + ' ' + '─'.repeat(Math.max(0, 40 - role.length)))
    sumTally(total, printNodes(one.nodes, '  '))
    // 空行不算「判定來源」——它們不是被判斷出來的，算進去會讓比例失真。
    for (const node of one.nodes) {
      if (node.kind === 'blank') continue
      sources[node.source] = (sources[node.source] === undefined ? 0 : sources[node.source]) + 1
    }
    for (const problem of one.problems) allProblems.push(problem)
    printProblems(one.problems, '  ')
    console.log('')
  }

  const names = { narration: '旁白', speech: '台詞', action: '動作', thought: '心聲', blank: '空行', panel: '區塊' }
  const parts = Object.keys(total).map((key) => (names[key] === undefined ? key : names[key]) + ' ' + String(total[key]))
  console.log('§ 總計：' + parts.join(' ／ '))
  console.log('§ 判定來源：' + Object.keys(sources).map((key) => key + ' ' + String(sources[key])).join(' ／ '))
  const fatal = allProblems.filter((one) => one.severity === 'fatal').length
  console.log('§ 檢查：致命 ' + String(fatal) + ' ／ 可接受 ' + String(allProblems.length - fatal))
} else if (asJson) {
  console.log(JSON.stringify(result, null, 2))
} else {
  /* ---------------------- 單段文字：原始 → 檢查 → 修復 → 結果 ---------------------- */
  console.log('§ ① 原始回覆（模型吐的，一字不動）')
  console.log('─'.repeat(52))
  console.log(text.replace(/\s+$/, ''))
  console.log('─'.repeat(52))
  console.log('§ ② 檢查（兩層）')
  printProblems(result.problems, '')

  const fixed = repair(text, result.problems, config)

  console.log('')
  console.log('§ ③ 本地修復紀錄（第一層：機械式的，不需要模型）')
  if (fixed.log.length === 0) console.log('  （沒有需要本地修的）')
  for (const entry of fixed.log) {
    console.log('  line ' + String(entry.line).padStart(3) + '  ' + String(entry.kind).padEnd(16) + entry.action)
    console.log('        before: ' + entry.before.slice(0, 68))
    console.log('        after : ' + entry.after.slice(0, 68))
  }
  if (fixed.deferred.length > 0) {
    console.log('  ⏳ 本地修不了、要交給模型的：')
    for (const one of fixed.deferred) {
      console.log('     line ' + String(one.line).padStart(3) + '  ' + one.layer + ' / ' + one.kind)
    }
  }

  const after = parse(fixed.text, config)
  console.log('')
  console.log('§ ④ 修復後的節點樹')
  printNodes(after.nodes, '')
  console.log('')
  console.log('§ 節點：修復前 ' + String(result.nodes.length) + ' 個 → 修復後 ' + String(after.nodes.length) + ' 個')
  printProblems(after.problems, '')
}
