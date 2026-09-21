/**
 * 瀏覽器半的離線測試。
 *
 * 用假的 window / document / React 把 bundle 跑起來，驗證：
 *   1. bundle 註冊的 id 與 factory 匯出
 *   2. apply() 註冊的座位（酒館街、七個面板…）沒有重複註冊
 *   3. 酒館街的樹（酒館列／對話列／圖示／動作）照原生度量
 *   4. 每個面板都渲染得出東西（不是空白）
 *   5. 設定卡片不會「失敗就靜默卡在讀取中」
 *   6. v2 的契約：**沒有任何長連線、不碰 settings／agent**
 *
 * 用法：node test-client.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* ------------------------------ 假的瀏覽器環境 ------------------------------ */

const registrations = []
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      registrations.push(entry)
    },
  },
  addEventListener() {},
  removeEventListener() {},
  setTimeout: (fn) => 0,
  clearTimeout() {},
  setInterval: () => 0,
  clearInterval() {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
}
globalThis.document = {
  head: { appendChild() {} },
  body: { childNodes: [], appendChild(child) { this.childNodes.push(child); child.parentNode = this }, removeChild(child) { const at = this.childNodes.indexOf(child); if (at >= 0) this.childNodes.splice(at, 1); child.parentNode = null }, contains: () => false },
  createElement: () => makeFakeElement(),
  createElementNS: () => makeFakeElement(),
  createTextNode: (text) => ({ nodeType: 3, textContent: String(text), childNodes: [], find: () => [] }),
  // ⚠️ `querySelector`／`getComputedStyle` 是 `inheritTheme()` 需要的：選單 portal 到
  // `document.body` 之後，顏色只能從側邊欄當下的 computed style 取得。這裡回一個
  // 「什麼都沒定義」的最小實作——於是 `inheritTheme` 走它的保底路徑（用文字色判斷
  // 深淺），選單仍然畫得出來，測試驗的是結構而不是顏色。
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
}
globalThis.getComputedStyle = () => ({
  color: 'rgb(29, 37, 57)',
  backgroundColor: 'rgb(242, 245, 250)',
  getPropertyValue: () => '',
})

/**
 * 極簡 DOM 元素：只需要「建節點、掛子節點、加 class、寫屬性」。
 *
 * 會需要這個是因為 **⋯ 選單是 portal 到 `document.body` 的**（原生也是），
 * 它不在 React 樹裡，而是用原生 DOM 畫的（客戶端 bundle 的 `require` 只有
 * `react`，沒有 react-dom，所以不能用 `createPortal`）。測試要能 inspect 它。
 */
function makeFakeElement() {
  const node = {
    childNodes: [],
    children: [],
    style: {},
    attrs: {},
    listeners: {},
    textContent: '',
    parentNode: null,
    className: '',
    setAttribute(name, value) {
      node.attrs[name] = String(value)
    },
    getAttribute(name) {
      return node.attrs[name]
    },
    appendChild(child) {
      node.childNodes.push(child)
      node.children.push(child)
      child.parentNode = node
      return child
    },
    removeChild(child) {
      const at = node.childNodes.indexOf(child)
      if (at >= 0) node.childNodes.splice(at, 1)
      const at2 = node.children.indexOf(child)
      if (at2 >= 0) node.children.splice(at2, 1)
      child.parentNode = null
      return child
    },
    contains(target) {
      if (target === node) return true
      for (const child of node.childNodes) {
        if (child !== null && typeof child.contains === 'function' && child.contains(target)) return true
      }
      return false
    },
    addEventListener(type, fn) {
      if (node.listeners[type] === undefined) node.listeners[type] = []
      node.listeners[type].push(fn)
    },
    removeEventListener(type, fn) {
      const list = node.listeners[type]
      if (list === undefined) return
      const at = list.indexOf(fn)
      if (at >= 0) list.splice(at, 1)
    },
    focus() {},
    select() {},
    classList: {
      contains(name) {
        return String(node.className)
          .split(/\s+/)
          .filter((part) => part !== '')
          .includes(name)
      },
    },
    /** 遞迴收集這個子樹裡符合條件的節點（給選單用）。 */
    find(predicate, out = []) {
      for (const child of node.childNodes) {
        if (predicate(child)) out.push(child)
        if (typeof child.find === 'function') child.find(predicate, out)
      }
      return out
    },
  }
  return node
}

/** 這個子樹的文字（給選單斷言用）。 */
function fakeText(node) {
  if (node === null || node === undefined) return ''
  const own = typeof node.textContent === 'string' ? node.textContent : ''
  const kids = Array.isArray(node.childNodes) ? node.childNodes.map(fakeText).join('') : ''
  return own + kids
}
/** 送出過的請求（用來釘住「啟動時不做任何事」這條契約）。 */
const requests = []
globalThis.fetch = (url, options) => {
  requests.push({ url: String(url), body: (options && options.body) || '' })
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true, value: { taverns: [], activeId: '', build: 'test' } }),
    text: () => Promise.resolve(''),
  })
}

/**
 * 極簡 React：只提供 hook 與 createElement。
 *
 * **每個元件一組 hook 槽**，同一個元件的每一次渲染都拿到同一個 `ref.current`
 * ——互動才驗得出來（按下去之後畫面變成什麼樣）。這也是為什麼一定要走
 * `renderComponent`：它負責告訴假的 React「現在跑的是哪一個元件」。
 *
 * 反過來說：**元件不可以直接呼叫**，否則它會拿到上一個元件的槽。實測踩過：
 * `TavernSidebarRegion` 與 `TavernStreet` 共用一組槽，第二個元件的
 * `ref.current` 直接變成第一個元件的狀態（`state.expanded` 讀到 undefined）。
 */
function makeReact() {
  /**
   * hook 槽：**每一個元件函式一組**。
   *
   * 同一個元件的每一次渲染都拿到同一個 `ref.current`（互動才驗得出來），
   * 不同元件不會互相污染。`enter(fn)` 負責宣告「現在跑的是誰」——
   * `renderComponent`、`flatten`、`collect` 都會呼叫它。
   */
  const perComponent = new Map()
  const active = []
  const slotsFor = () => {
    const key = active.length > 0 ? active[active.length - 1] : '__anonymous__'
    if (!perComponent.has(key)) perComponent.set(key, { slots: [], cursor: 0 })
    return perComponent.get(key)
  }
  const slot = (initial) => {
    const bucket = slotsFor()
    const at = bucket.cursor
    bucket.cursor += 1
    if (bucket.slots[at] === undefined) {
      bucket.slots[at] = { value: typeof initial === 'function' ? initial() : initial }
    }
    return bucket.slots[at]
  }
  return {
    useState: (initial) => [slot(initial).value, () => {}],
    useRef: (initial) => slot({ current: initial }).value,
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    createElement: (type, props, ...children) => ({
      type,
      props: Object.assign({}, props ?? {}, { children: children.length === 1 ? children[0] : children }),
    }),
    /** 跑一個元件：宣告「現在是誰」，並把它的 hook 游標歸零。 */
    enter: (key) => {
      active.push(key === undefined ? '__anonymous__' : key)
      slotsFor().cursor = 0
    },
    leave: () => {
      active.pop()
    },
    /** 忘掉所有元件的 hook 狀態（＝全部重新掛載）。 */
    resetHooks: () => {
      perComponent.clear()
      active.length = 0
    },
  }
}

const reactImpl = makeReact()
/**
 * 呼叫一個元件（＝一次渲染）。
 *
 * 一定要走這裡，不要直接呼叫元件函式：假的 React 靠它知道「現在跑的是誰」，
 * 才不會把兩個元件的 hook 槽搞混（見 `makeReact`）。
 */
function renderComponent(fn, props) {
  reactImpl.enter(fn)
  try {
    return fn(props)
  } finally {
    reactImpl.leave()
  }
}
/**
 * 受測的原始碼。
 *
 * ⚠️ **一定要先把換行統一成 `\n`。**
 *
 * 這個檔案裡的斷言會用 `\n` 去比對**跨行**的程式碼（例如
 * `pinnedRef.current.pinned = true\n\s*stickToBottom(true)`）。而 `lib/client.js`
 * 在 Windows 上被編輯器寫成 **CRLF**——那時候 `true` 後面接的是 `\r\n`，
 * `\n` 就對不上，斷言會說「找不到這段程式碼」，但那段程式碼**明明就在那裡**。
 *
 * 這一條實際發生過：`npm test` 卡在「送出訊息時要無條件貼底」，查了半天才發現
 * 程式碼是對的、問題是行尾。統一之後，這個測試檔在任何平台的任何編輯器下
 * 都得到同樣的結果。
 *
 * 順帶一提：同一棵樹裡 `smoke.mjs`／`verify.mjs` 是 LF、`lib/*.js` 是 CRLF，
 * 所以**不能假設任何一支檔案的換行**——要跨行比對就先正規化。
 */
const source = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/**
 * 去掉註解（保留字串裡的內容）之後的原始碼。
 *
 * 為什麼需要：好幾條「不可以再出現某種寫法」的斷言，而解釋那個 bug 的註解裡
 * **一定會寫出那個寫法**（不寫出來沒人看得懂在防什麼）。直接掃原始碼就會掃到
 * 自己的註解——這個測試檔已經因此誤判過兩次。
 *
 * 為什麼不能用 regex：`accept: 'image/*'` 這個字串裡的註解開頭字元會被當成真的
 * 註解開頭，非貪婪的結束字元一路吃到很遠的下一個結束字元，把中間一大段程式碼
 * 整個吃掉（第一版就是這樣寫的，結果少算了一個呼叫點）。所以這裡逐字元走，
 * 追蹤「現在在字串裡還是註解裡」。
 */
function stripComments(code) {
  let out = ''
  let i = 0
  let quote = null
  /**
   * 上一個「有意义的字元」——用來判斷 `/` 是除法還是**正則字面值的開頭**。
   *
   * 為什麼需要：正則字面值裡的引號（例如 `/^[「『"“]/`）會被當成字串開頭，
   * 於是「字串還沒結束」的狀態一路延續，後面整段註解都不會被剝掉。
   * 這個剝離器踩過的第三個坑（前兩個：註解裡的 backtick、字串裡的 `//`）。
   */
  let lastSignificant = ''
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (quote !== null) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i += 1
      continue
    }
    // ⚠️ **註解只在字串外面判斷**。兩個都踩過：
    //   1. 註解裡的 backtick（我們的註解大量用 `` ` ``）被當成樣板字串的開頭，
    //      於是「註解還沒結束」的狀態一路延續，後面整段程式碼被吃成字串。
    //   2. 字串裡的 `//`（例如網址 `https://…`）被當成註解開頭，引號狀態從此亂掉
    //      ——症狀是後面某個 doc comment 不再被剝掉，字串比對跟著失準。
    // 所以：先看是不是在字串裡（上面那個 `quote !== null` 分支已經處理），
    // 不在字串裡才判斷註解。
    if (quote === null && ch === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i += 1
      continue
    }
    if (quote === null && ch === '/' && next === '*') {
      i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    // 正則字面值：`/…/flags`。只在「表達式開頭」的位置才可能是它
    // （前面是運算子、括號、逗號、等號、return…），不然就是除法。
    if (quote === null && ch === '/' && /[=(,:[!&|?{};+\-*%<>~^]|return|typeof|\b/.test(lastSignificant) === false) {
      // 前面是識別字或數字 → 除法，照原樣輸出。
      out += ch
      i += 1
      lastSignificant = ch
      continue
    }
    if (quote === null && ch === '/') {
      // 掃到下一個沒被跳脫的 `/`（中間的 `\/` 不算），並吃掉 flags。
      let j = i + 1
      let inClass = false
      while (j < code.length) {
        const cj = code[j]
        if (cj === '\\') {
          j += 2
          continue
        }
        if (cj === '[') inClass = true
        else if (cj === ']') inClass = false
        else if (cj === '/' && inClass === false) break
        else if (cj === '\n') break
        j += 1
      }
      out += code.slice(i, j + 1)
      i = j + 1
      lastSignificant = '/'
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      out += ch
      i += 1
      continue
    }
    // ⚠️ **backtick 不當字串開頭**：我們的註解大量用 `` ` `` 標示程式碼與檔名，
    // 而這個 bundle 是「`new Function` 的參數」，不是 template literal——
    // 所以原始碼裡的 backtick 永遠只是註解裡的字元。把它當字串開頭的話，
    // 註解會被誤判成「字串還沒結束」，後面整段註解都不會被剝掉，
    // 依賴 codeSource 的斷言就跟著失準（實際踩到：pickFiles 的守衛突然紅了）。
    if (ch === '`') {
      out += ch
      i += 1
      continue
    }
    out += ch
    if (/\S/.test(ch)) lastSignificant = ch
    i += 1
  }
  return out
}

/** 去註解後的原始碼；掃「不可以出現某種寫法」時一律用這一份。 */
const codeSource = stripComments(source)

new Function('window', 'document', 'fetch', 'console', source)(
  globalThis.window,
  globalThis.document,
  globalThis.fetch,
  console,
)
assert.equal(registrations.length, 1, '應該只註冊一個模組')
const entry = registrations[0]
assert.equal(entry.id, 'dsh-tavern', 'bundle id 應為 dsh-tavern')
const exportsObject = entry.factory((spec) => {
  if (spec === 'react') return reactImpl
  throw new Error(`未預期的 require：${spec}`)
})
assert.equal(typeof exportsObject.apply, 'function')
assert.ok(typeof exportsObject.__build === 'string' && exportsObject.__build.length > 0, '應匯出建置標記')
assert.ok(source.includes(exportsObject.__build), '建置標記要存在於原始碼中')
console.log('1. bundle OK — id =', entry.id, '/ build =', exportsObject.__build)

/* --------------------------------- apply --------------------------------- */

const injections = []
const slotEntries = new Map()
const declaredSlots = new Set()
const registerCount = new Map()

const fakeCtx = {
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  get(name) {
    if (name === 'slots') {
      return {
        register(options, component) {
          const cell = options.name + '#' + String(options.key ?? options.id ?? '') + '@' + String(options.priority ?? 0)
          const seen = (registerCount.get(cell) ?? 0) + 1
          registerCount.set(cell, seen)
          if (seen > 1) throw new Error('座位 ' + cell + ' 被註冊兩次（會讓頁面卡死）')
          const record = { options, component }
          injections.push(record)
          const list = slotEntries.get(options.name) ?? []
          list.push(record)
          slotEntries.set(options.name, list)
          if (!declaredSlots.has(options.name)) {
            declaredSlots.add(options.name)
            for (const waiter of pending.slice()) {
              if (waiter.key === options.name) waiter.run()
            }
          }
          return () => {
            registerCount.set(cell, (registerCount.get(cell) ?? 1) - 1)
          }
        },
        entries(key) {
          return slotEntries.get(key) ?? []
        },
        entriesOfSlot(key) {
          return slotEntries.get(key) ?? []
        },
        inject(key, callback) {
          if (declaredSlots.has(key)) {
            const dispose = callback()
            return typeof dispose === 'function' ? dispose : () => {}
          }
          const waiter = { key, run: () => callback() }
          pending.push(waiter)
          return () => {
            const at = pending.indexOf(waiter)
            if (at >= 0) pending.splice(at, 1)
          }
        },
      }
    }
    if (name === 'layout') return { selectPanel() {} }
    // 挑資料夾：原生對話框的公開面（`pickDirectory()`）。沒有它，按「＋ 新增酒館」
    // 會落到「退回手動貼路徑」那條路，而那條路只是換畫面、不是錯誤。
    if (name === 'uiWorkspace') return { pickDirectory: () => Promise.resolve(null) }
    return undefined
  },
}
const pending = []

// 真實系統裡這些座位在插件掛載前就宣告好了。
for (const key of ['sidebar.workspaces', 'sidebar.footer.action', 'main', 'settings.plugin.item']) {
  declaredSlots.add(key)
  slotEntries.set(key, [])
}
// 原生工作區那一筆（我們要轉呼叫它）。
function FakeWorkspaceBrowser(props) {
  return reactImpl.createElement('div', null, '工作區原始內容')
}
const fakeInject = () => ({ hooks: { hostInfo: () => ({ home: 'x' }) } })
slotEntries.get('sidebar.workspaces').push({
  options: { name: 'sidebar.workspaces' },
  component: FakeWorkspaceBrowser,
  inject: fakeInject,
  store: { create: () => ({}) },
  locale: 'workspace',
})
function FakeFlow() {
  return reactImpl.createElement('div', null, '流程')
}
slotEntries.set('sidebar.workspaces.directoryFlow', [
  { options: { name: 'sidebar.workspaces.directoryFlow' }, component: FakeFlow, inject: () => ({}) },
])

exportsObject.apply(fakeCtx)

const seats = injections.map((item) => `${item.options.name}:${item.options.id ?? item.options.key ?? '(single)'}`).sort()
assert.deepEqual(
  seats,
  ['dsh-tavern.workspaces.flow:(single)', 'main:tavern', 'main:tavern-chats', 'settings.plugin.item:tavern', 'sidebar.workspaces:(single)'],
  '座位清單',
)
assert.deepEqual([...registerCount.entries()].filter(([, n]) => n > 1), [], '不該重複註冊')
const seatsDone = requests.length
console.log('2. apply OK —', seats.length, '個座位')

/* ------------------------------ 測試用的小工具 ------------------------------ */

function flatten(node, depth = 0) {
  if (depth > 60 || node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child) => flatten(child, depth + 1)).join(' ')
  if (typeof node === 'object' && node.props !== undefined) {
    if (typeof node.type === 'function') {
      reactImpl.enter(node.type)
      try {
        return flatten(node.type(node.props), depth + 1)
      } finally {
        reactImpl.leave()
      }
    }
    return flatten(node.props.children, depth + 1)
  }
  return ''
}

function collect(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out)
    return out
  }
  if (node.props !== undefined) {
    if (predicate(node)) out.push(node)
    if (typeof node.type === 'function') {
      reactImpl.enter(node.type)
      try {
        collect(node.type(node.props), predicate, out)
      } finally {
        reactImpl.leave()
      }
    } else {
      collect(node.props.children, predicate, out)
    }
  }
  return out
}

function findButton(node, label) {
  return collect(node, (el) => el.type === 'button' && String(el.props['aria-label']).includes(label))[0] ?? null
}

const { TavernStreet, TavernSettingsPage, TavernChatPage } = exportsObject.__components
const TAVERNS = [
  { id: 't1', name: '預設酒館', path: 'C:\\Users\\x\\tavern', active: true, icon: '' },
  { id: 't2', name: '鯨落', path: 'D:\\酒館\\鯨落', active: false, icon: '🍺' },
]
const renderStreet = (extra = {}) =>
  renderComponent(TavernStreet, { taverns: TAVERNS, loaded: true, reload: () => {}, wide: true, opened: true, ...extra })

/* ------------------------ 啟動時不做任何事，按了才做 ------------------------ */

{
  assert.equal(seatsDone, 0, 'apply() 期間不可以送出任何請求')

  const region = injections.find((record) => record.options.name === 'sidebar.workspaces')
  assert.ok(region !== undefined, '側邊欄座位存在')
  reactImpl.enter()
  const regionTree = region.component({ wide: true, renderSlot: () => null })

  // 側邊欄區塊一直掛在畫面上，所以「掛載」等於「DSH 一開啟」。
  assert.equal(requests.length, 0, '側邊欄掛載時不可以送出任何請求')
  assert.ok(flatten(regionTree).includes('酒館街'), '收合狀態仍要看得到區塊標題')

  const toggle = findButton(regionTree, '顯示酒館街')
  assert.ok(toggle !== null, '要有「顯示酒館街」的按鈕（收合狀態）')
  assert.equal(toggle.props['aria-expanded'], 'false', '預設要是收合的')

  // 沒展開的區塊不可以列出酒館，也不可以出現「讀取中…」。
  assert.equal(flatten(regionTree).includes('讀取中'), false, '還沒按就不該假裝在讀取')

  toggle.props.onClick({ preventDefault() {} })
  const asked = requests.map((request) => request.url)
  assert.equal(requests.length, 1, `按了「顯示酒館街」剛好送出 1 個請求，實際 ${requests.length} 個`)
  assert.ok(asked[0].includes('op=tavern.list'), `按了才讀清單，實際請求 ${asked[0]}`)

  // 酒館列的動作與展開仍然只在使用者按下去時才動。
  requests.length = 0
  const openStreet = renderStreet({ opened: true })
  assert.equal(requests.length, 0, '光是展開酒館街不該再送出請求（清單已經有了）')
  const rowToggle = collect(
    openStreet,
    (el) => typeof el.props.className === 'string' && el.props.className.split(' ').includes('dsh-tv-row'),
  )[0]
  assert.equal(requests.length, 0, '列出酒館列本身不該讀磁碟')
  assert.ok(typeof rowToggle.props.onClick === 'function', '酒館列要能點開')
  console.log('2b. 惰性載入 OK — apply 與掛載 0 個請求，按「顯示酒館街」才讀清單')
}

/* --------------------------- 酒館街（照原生度量） --------------------------- */

{
  const text = flatten(renderStreet())
  assert.ok(text.includes('酒館街'), '區塊標題')
  for (const tavern of TAVERNS) assert.ok(text.includes(tavern.name), `要列出 ${tavern.name}`)

  const rows = collect(renderStreet(), (el) => typeof el.props.className === 'string' && el.props.className.split(' ').includes('dsh-tv-row'))
  assert.equal(rows.length, 2, '每間酒館一列（34px 專案列）')
  for (const row of rows) assert.ok(row.props['aria-expanded'] !== undefined, '列要有 aria-expanded')

  const actions = collect(renderStreet(), (el) => typeof el.props.className === 'string' && el.props.className.split(' ').includes('dsh-tv-actions'))
  for (const box of actions) {
    const buttons = collect(box, (el) => el.type === 'button').map((b) => String(b.props['aria-label']))
    assert.ok(buttons.some((l) => l.includes('設定')), '⋯ = 直接進設定')
    assert.ok(buttons.some((l) => l.includes('新增對話')), '＋ = 新對話')
  }

  const emoji = collect(renderStreet(), (el) => typeof el.props.className === 'string' && el.props.className.split(' ').includes('dsh-tv-iconEmoji'))
  assert.equal(emoji.length, 1, '自訂圖示那一間要顯示 emoji')
  assert.equal(flatten(emoji[0]), '🍺')

  const iconBtn = collect(renderStreet(), (el) => typeof el.props.className === 'string' && el.props.className.split(' ').includes('dsh-tv-iconBtn'))
  assert.equal(iconBtn[0].props['aria-label'], '新增酒館', '標題列的 ＋ 是新增酒館')
  // 使用者：「這好像是一個按鍵點擊摺疊，但下面的一層卻是整行都能夠點擊摺疊。
  // 這裏風格不一致我希望遵從下面一層的做法」——所以標題列要**整列可點**。
  {
    const seen = []
    const tree = renderComponent(TavernStreet, {
      taverns: TAVERNS,
      loaded: true,
      reload: () => {},
      wide: true,
      opened: true,
      onToggle: (next) => seen.push(next),
    })
    const head = collect(tree, (el) => typeof el.props.className === 'string' && el.props.className.split(' ').includes('dsh-tv-sectionHead'))[0]
    assert.ok(head !== undefined, '要有區塊標題列')
    assert.equal(typeof head.props.onClick, 'function', '標題列本身要接得上點擊（不是只有那顆按鈕）')
    head.props.onClick({})
    assert.deepEqual(seen, [false], '點標題列＝收合（現在是展開的）')

    // 摺疊按鈕留著（鍵盤／報讀器），但**不再自己切換**（不然會切兩次）
    const toggle = collect(head, (el) => el.props['aria-label'] === '收合酒館街')[0]
    assert.ok(toggle !== undefined, '摺疊按鈕要留著')
    // 按鈕自己切換 ＋ 擋冒泡（鍵盤與報讀器靠它；擋冒泡是為了不要被整列再切一次）
    let toggleStopped = 0
    toggle.props.onClick({ stopPropagation: () => { toggleStopped += 1 } })
    assert.equal(toggleStopped, 1, '按鈕要擋冒泡（不然會切兩次）')
    assert.deepEqual(seen, [false, false], '按鈕本身也要能切換')

    // 例外：那顆「＋ 新增酒館」不可以讓整列跟著收合
    const plus = collect(head, (el) => el.props['aria-label'] === '新增酒館')[0]
    assert.ok(plus !== undefined, '要有新增酒館的按鈕')
    const beforePlus = seen.length
    let stopped = 0
    plus.props.onClick({ stopPropagation: () => { stopped += 1 } })
    assert.equal(stopped, 1, '按鈕要 stopPropagation（不然按新增會順手把區塊收起來）')
    assert.equal(seen.length, beforePlus, '按新增不該再觸發一次收合')
  }

  console.log('3. 酒館街 OK — 列、圖示、動作、新增酒館（標題列整列可點）')
}

/* ------------- 對話列照原生：hover 出 ⋯、選單是 body 底下的 portal ------------- */

{
  /**
   * 使用者貼了兩段 HTML 來比對，問題一眼就看得出來：
   *
   *   原生會話列  `<div class="…sessionRow">…<span class="…_rowActions"><button
   *                class="…_iconButton">⋯</button></span></div>`
   *   酒館對話列  `<div class="dsh-tv-chatRow">…<span class="dsh-tv-time">剛剛</span></div>`
   *
   * **CSS 早就為 ⋯ 寫好了**（`.dsh-tv-chatRow:hover .dsh-tv-time{display:none}`、
   * `.dsh-tv-chatRow:hover .dsh-tv-actions{display:inline-flex}`），但**沒有任何程式碼
   * 渲染那個 span**——所以「滑過時時間讓位給動作」這個原生行為永遠不會發生。
   *
   * 這一條釘住：那個 span 真的在、原生那四個部分（slot／title／time／actions）
   * 一個都不少、而且選單是 portal 到 `document.body`（不然會被側邊欄的 overflow 裁掉）。
   */
  reactImpl.resetHooks()
  const { TavernStreet } = exportsObject.__components
  const { __setRpc, __chat } = exportsObject

  // 「分支」那一項要看得到 `remote.session` 才不会是「不支援」——第 8 段測試
  // 把它清掉了，這裡補一個最小的假服務。
  __chat.setContext({
    get: (key) => (key === 'remote.session' ? { fork: () => Promise.resolve({ ok: true, value: { sessionId: 's' } }) } : undefined),
  })

  const chats = [
    { character: '老闆娘', name: '夜晚', file: '夜晚.jsonl', assetId: '夜晚', size: 120, mtimeMs: 1, assets: null },
  ]
  const called = []
  __setRpc((op, args) => {
    called.push({ op, args })
    if (op === 'chat.list') return Promise.resolve(chats)
    if (op === 'tavern.list') {
      return Promise.resolve({ taverns: [{ id: 't1', name: '酒館', path: '/x', active: true, icon: '' }], activeId: 't1' })
    }
    return Promise.resolve({})
  })

  const SIDEBAR = { taverns: [{ id: 't1', name: '酒館', path: '/x', active: true, icon: '' }], loaded: true, reload: () => {}, wide: true, opened: true, onToggle: () => {} }
  const first = renderComponent(TavernStreet, SIDEBAR)
  // 展開那一間（`state.expanded` 是空的，所以按下去會觸發 chat.list）。
  const row = collect(first, (el) => typeof el.props.className === 'string' && el.props.className.split(' ').includes('dsh-tv-row'))[0]
  row.props.onClick()
  // 非同步的 chat.list 要跑完才有對話列。
  await new Promise((resolve) => setTimeout(resolve, 0))

  const tree = renderComponent(TavernStreet, SIDEBAR)
  const chatRows = collect(tree, (el) => typeof el.props.className === 'string' && el.props.className.split(' ').includes('dsh-tv-chatRow'))
  assert.equal(chatRows.length, 1, '展開之後要有一列對話')
  const chatRow = chatRows[0]
  const parts = collect(chatRow, () => true)
    .filter((el) => typeof el.props.className === 'string')
    .map((el) => el.props.className.split(' ')[0])
  for (const needed of ['dsh-tv-slot', 'dsh-tv-title', 'dsh-tv-time', 'dsh-tv-actions']) {
    assert.ok(parts.includes(needed), `對話列要有 ${needed}（原生那四個部分一個都不能少）`)
  }
  const dots = collect(chatRow, (el) => el.type === 'button').filter((el) => String(el.props['aria-label']).includes('的動作'))
  assert.equal(dots.length, 1, '⋯ 按鈕要在（hover 的顯示交給 CSS）')
  assert.equal(dots[0].props['aria-haspopup'], 'menu', '⋯ 要宣告它開的是選單')
  assert.equal(dots[0].props['aria-expanded'], 'false', '沒開的時候 aria-expanded 是 false')

  // 按下去 → 選單畫進 body 底下的 portal（不是畫進那一列）
  // portal 容器是**用到才建**的：還沒開選單之前它不該存在（少一個一直在畫面上的節點）。
  assert.equal(globalThis.document.body.childNodes.length, 0, '還沒開選單之前不該有 portal 容器')
  // 真的 React 會因為 setState 自己重繪；假的 React 不會，所以要自己再渲染一次
  // （`render()` 在真的瀏覽器裡就是那一次重繪）。
  dots[0].props.onClick({ stopPropagation() {}, currentTarget: null })
  const tree2 = renderComponent(TavernStreet, SIDEBAR)
  const dots2 = collect(tree2, (el) => el.type === 'button').filter((el) => String(el.props['aria-label']).includes('的動作'))
  assert.equal(dots2[0].props['aria-expanded'], 'true', '開著的時候 aria-expanded 要是 true')
  // ⚠️ 這個 `host` 是**重繪時元件自己指到的那一個**，不一定是 body 的最後一個
  // （`collect` 會再跑一次元件，假的 React 的 effect 沒有 deps 記憶，會多建容器）。
  // 元件繪製時用的就是這一個，所以要驗它。
  const hosts = globalThis.document.body.childNodes
  const host = hosts[hosts.length - 1]
  assert.ok(host !== undefined, '按了 ⋯ 之後要有 portal 容器')
  const menu = host.childNodes[0]
  assert.ok(menu !== undefined && menu.className === 'dsh-tv-menu', '按了 ⋯ 要畫出選單')
  assert.equal(host.style.position, 'fixed', '選單用固定座標（不受側邊欄 overflow 影響）')
  const items = menu.find((el) => el.className !== undefined && String(el.className).includes('dsh-tv-menuItem'))
  assert.equal(items.length, 3, '選單要有三項：改名／分支／刪除')
  assert.deepEqual(
    items.map((el) => fakeText(el)),
    ['改名', '分支', '刪除'],
    '名稱與順序照原生那三顆（改名／分支／刪除）',
  )
  const again = renderComponent(TavernStreet, SIDEBAR)
  const dotsAgain = collect(again, (el) => el.type === 'button').filter((el) => String(el.props['aria-label']).includes('的動作'))
  assert.equal(dotsAgain[0].props['aria-expanded'], 'true', '開著的時候 aria-expanded 要是 true')
  assert.ok(
    String(collect(again, (el) => typeof el.props.className === 'string' && el.props.className.includes('dsh-tv-chatRow '))[0]?.props.className ?? '').includes('dsh-tv-chatMenuOpen') ||
      collect(again, (el) => String(el.props.className).includes('dsh-tv-chatMenuOpen')).length === 1,
    '開著的列要有 menuOpen class（時間才會讓位）',
  )
  __chat.setContext(null)
  __setRpc(null)
  console.log('12. 對話列 OK — slot／title／time／actions 四部分齊全、⋯ 開 body 底下的選單')

  /* ---- 分隔線的「動態感」：照原生 widthHandle（游標到哪，光就在哪）---- */
  {
    // 使用者貼了原生的 `widthHandle` 並說「這裏能夠動態調整至中」——原生不是畫一條
    // 固定的線，而是用 `:after` 畫一段**以游標位置為中心**的漸層光條，中心點由 JS
    // 寫進 `--dsh-width-handle-pointer-y`（`e.clientY - box.top`）。我們照抄。
    assert.match(
      source,
      /getBoundingClientRect\(\)[\s\S]{0,200}?--dsh-tv-pointer-y/,
      '分隔線要把游標位置寫進 --dsh-tv-pointer-y（原生 widthHandle 的做法）',
    )
    assert.match(
      source,
      /onMouseMove: trackPointer/,
      '分隔線要接上 onMouseMove（不然光不會跟著手走）',
    )
    assert.match(
      source,
      /linear-gradient\(to bottom,transparent calc\(var\(--dsh-tv-pointer-y,50%\)/,
      ':after 要用以 --dsh-tv-pointer-y 為中心的漸層（±6px 淡出）',
    )
    assert.match(
      source,
      /'data-dragging': state\.dragging/,
      '拖曳中要標記 data-dragging（跟原生一樣持續亮著）',
    )
  }

  /* ---- 聊天室要貼底（思考的時候不能要自己手動滾下去）---- */
  {
    // 我們的重繪是指令式的，所以規矩要自己寫：**只有使用者本來就貼著底**才自動捲，
    // 他往上翻就尊重他，送出自己的訊息時無條件貼底。
    assert.ok(/function stickToBottom\(/.test(source), '要有 stickToBottom')
    assert.match(
      source,
      /if \(force !== true && pinned\.pinned !== true\) return/,
      '翻紀錄時不該被硬拉回底部（只有貼著底才自動捲）',
    )
    assert.match(
      source,
      /distance < 40/,
      '要用「離底 40px 內算貼底」的判定',
    )
    assert.match(
      source,
      /'div', \{ className: 'dsh-tv-chatLog', ref: logRef, onScroll: onLogScroll \}/,
      '對話紀錄那一段要接上 ref 與 onScroll',
    )
    assert.match(
      source,
      /pinnedRef\.current\.pinned = true\n\s*stickToBottom\(true\)/,
      '送出訊息時要無條件貼底（自己剛說的話一定看得到）',
    )
  }

  /**
   * ⚠️ 這一條是為了釘住一個**真的發生過**的 bug：同一個 class 名被兩處定義，
   * 而其中一條帶著 `flex-direction:column`——於是側邊欄的對話列被壓成**直的**，
   * 圖示／標題／時間互相重疊、一行顯示不全（使用者回報「打直顯示，一行根本顯示不全」）。
   *
   * 成因是 `.dsh-tv-chat` 既是 v1 的「對話頁訊息容器」（要直的）又是「側邊欄對話列」
   * （要橫的）。兩條同分特異度、後者勝出，但 `flex-direction` 不在後者的
   * `display:flex;gap:0` 裡，所以它留了下來。
   *
   * 現在拆成 `.dsh-tv-chatBody`（容器）與 `.dsh-tv-chatRow`（列）。
   * 這一條掃出「同一個 class 被定義兩次」——同名的 CSS 規則幾乎一定是bug。
   */
  {
    const rules = (codeSource.match(/'\.dsh-tv-[a-zA-Z]+\{[^']*'/g) || []).map((one) => one.slice(1, one.indexOf('{')))
    const seen = new Map()
    const duplicated = []
    for (const cls of rules) {
      if (seen.has(cls)) duplicated.push(cls)
      seen.set(cls, true)
    }
    assert.deepEqual(duplicated, [], '同一個 dsh-tv class 不該被定義兩次（會讓後面的規則半途蓋掉前面的）：' + duplicated.join(', '))
    // 對話列一定要是橫的：`flex-direction:row` 要明寫在列自己的規則裡。
    // ⚠️ 這一條的 regex 要跨行：`.dsh-tv-chatRow{…}` 那一條規則被折成兩行字串
    // （`'…height:32px;display:flex;',` ＋ `'flex-direction:row;…'`），
    // 第一版寫成 `[^']*` 就直接失配。
    // 中間允許換行：`codeSource` 是**去過註解**的原始碼，而那一條規則上面有 `//` 註解，
    // 去掉之後兩行字串之間會留下空白與換行（第一版沒考慮到，直接失配）。
    assert.match(
      codeSource,
      /'\.dsh-tv-chatRow\{[^']*',\s*'flex-direction:row/,
      '對話列的規則要明寫 flex-direction:row（不要只靠 display:flex）',
    )
    assert.equal(/\.dsh-tv-chat\{/.test(codeSource), false, '不要再有 .dsh-tv-chat 這個名字（容器用 chatBody、列用 chatRow）')

    // ⚠️ 選單 portal 到 `document.body`，而 `--dsw-alias-bg-elevated` 這個變數
    // **在 DSH 的主題裡不存在**（`:root` 與 body 都沒有）——寫死它就會落到我們自己
    // 的 fallback 顏色，淺色主題下變成「深字壓深底」，標籤等於看不到（實際踩過）。
    // 底色改由 `inheritTheme()` 從側邊欄當下的 computed style 取得。
    // ⚠️ 這一條以前是掃 `--dsw-alias-bg-elevated` 這個**名字**；token 遷移之後
    // 正確的判準改變了：**元件樣式不准再引用宿主的 `--dsw-*` 顏色**（掃 MAP_CSS，
    // 那是元件樣式的範圍），而 `inheritTheme()` 負責把側邊欄當下的值複製過來。
    // ⚠️ **兩個區，規矩相反**（使用者：「酒館街是建在 DSH 當中，應該跟從系統；
    // 不同風格是指具體酒館就像酒館有不同的裝修風格」）：
    //   側邊欄（酒館街）＝DSH 的導航 → **必須**用宿主的 `--dsw-*`，才會跟著 DSH 主題
    //   主面板（大廳／包廂／卡司／藏書）＝酒館自己的空間 → **不准**用宿主變數，
    //     要全部走 `--dsh-tv-*`，這樣 `theme.json` 才換得動
    const sidebarSelectors = [
      '.dsh-tv-street', '.dsh-tv-section', '.dsh-tv-iconBtn', '.dsh-tv-region',
      '.dsh-tv-row', '.dsh-tv-slot', '.dsh-tv-folder', '.dsh-tv-chevron',
      '.dsh-tv-projectText', '.dsh-tv-chatRow', '.dsh-tv-chatOn', '.dsh-tv-chatMenuOpen',
      '.dsh-tv-actions', '.dsh-tv-miniBtn', '.dsh-tv-emptyRow', '.dsh-tv-sideErr',
      '.dsh-tv-sideManual', '.dsh-tv-sideInput', '.dsh-tv-overflow', '.dsh-tv-divider',
      '.dsh-tv-cardName', '.dsh-tv-cardDesc', '.dsh-tv-tavernDot', '.dsh-tv-tavernName',
      '.dsh-tv-spin', '.dsh-tv-face', '.dsh-tv-count', '.dsh-tv-rename', '.dsh-tv-menu',
    ]
    const mapLines = codeSource
      .slice(
        codeSource.indexOf('var MAP_CSS = ['),
        codeSource.indexOf("].join('')", codeSource.indexOf('var MAP_CSS = [')),
      )
      .split('\n')
    let inSidebar = false
    let inMain = false
    const mainUsage = []
    const sideUsage = []
    for (const line of mapLines) {
      const t = line.trim()
      if (t.startsWith("'.")) {
        const brace = t.indexOf('{')
        const selector = brace > 0 ? t.slice(1, brace) : ''
        inSidebar = sidebarSelectors.some((one) => selector.startsWith(one))
        inMain = inSidebar === false
      }
      if (inSidebar && /var\(--dsw-/.test(line)) sideUsage.push(1)
      if (inMain && /var\(--dsw-/.test(line)) mainUsage.push(t.slice(0, 50))
    }
    assert.deepEqual(
      mainUsage,
      [],
      '主面板（酒館自己的空間）不該引用宿主變數——要全部走 token，theme.json 才換得動：' +
        mainUsage.join(' ｜ '),
    )
    assert.ok(
      sideUsage.length >= 5,
      '側邊欄（酒館街）要用宿主的 --dsw-* 變數，才會跟著 DSH 主題走（目前 ' + sideUsage.length + ' 處）',
    )
    assert.equal(
      /var\(--dsw-alias-bg-elevated/.test(codeSource),
      false,
      '不要用不存在的 --dsw-alias-bg-elevated 當顏色（會落到 fallback → 深字壓深底）',
    )
    assert.ok(/function inheritTheme\(/.test(codeSource), '選單要有 inheritTheme（portal 到 body 時的唯一顏色來源）')
    assert.ok(
      /box\.style\.background = skin\.background/.test(codeSource),
      '主題要寫在**選單框**上，不是只寫在 portal 容器上（容器底色不一定透上來）',
    )
  }
}

/* ------------------- ⋯ 選單的三個動作真的接上 op（改名／分支／刪除） ------------------- */

/**
 * 這一段測「按了選單上的動作之後，真的送了正確的 op」。
 *
 * ⚠️ 寫法上的一個重點：**每一個動作都用一段自己的測試**（`resetHooks()` 讓元件
 * 回到全新狀態），不要在一個元件實例上連續開三次選單。假的 React 不會因為
 * setState 自動重繪，狀態又會在整段之間延續，連續操作很容易驗到一半的狀態
 * ——第一版就是這樣寫的，除錯花了很久。每一段自己從頭來，就沒有這個問題。
 */
async function menuItemsFor(sidebar) {
  reactImpl.resetHooks()
  const tree = renderComponent(TavernStreet, sidebar)
  const row = collect(tree, (el) => typeof el.props.className === 'string' && el.props.className.split(' ').includes('dsh-tv-row'))[0]
  row.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const shown = renderComponent(TavernStreet, sidebar)
  const dots = collect(shown, (el) => el.type === 'button').filter((el) => String(el.props['aria-label']).includes('的動作'))
  assert.equal(dots.length, 1, '要有一顆 ⋯ 可以按：' + flatten(shown).slice(0, 120))
  dots[0].props.onClick({ stopPropagation() {}, currentTarget: null })
  const painted = renderComponent(TavernStreet, sidebar)
  assert.ok(flatten(painted).length > 0, '重繪之後畫面還在')
  for (const candidate of globalThis.document.body.childNodes.slice().reverse()) {
    const menu = candidate.childNodes[0]
    if (menu !== undefined && String(menu.className).includes('dsh-tv-menu')) {
      return menu.find((el) => String(el.className).includes('dsh-tv-menuItem'))
    }
  }
  throw new Error('找不到畫出來的選單')
}

const MENU_SIDEBAR = { taverns: [{ id: 't1', name: '酒館', path: '/x', active: true, icon: '' }], loaded: true, reload: () => {}, wide: true, opened: true, onToggle: () => {} }
const A_CHAT = [{ character: '老闆娘', name: '夜晚', file: '夜晚.jsonl', assetId: '夜晚', size: 120, mtimeMs: 1, assets: null }]

/** 裝一個假的宿主半；`extra` 可以覆寫特定 op。 */
function spyRpc(seen, extra) {
  exportsObject.__setRpc((op, args) => {
    seen.push({ op, args })
    if (op === 'chat.list') return Promise.resolve(A_CHAT)
    if (op === 'tavern.list') {
      return Promise.resolve({ taverns: [{ id: 't1', name: '酒館', path: '/x', active: true, icon: '' }], activeId: 't1' })
    }
    if (op === 'session.list') return Promise.resolve([{ sessionId: 'session-1', character: '老闆娘', chat: '夜晚' }])
    if (extra !== undefined && extra[op] !== undefined) return Promise.resolve(extra[op](args))
    return Promise.resolve({})
  })
}

/* ── 改名：按「改名」不送 op，改成行內輸入；Enter 才送 chat.rename ── */
{
  const seen = []
  const { TavernStreet } = exportsObject.__components
  // 「分支」那一項要看得到 remote.session 才不是「不支援」。
  exportsObject.__chat.setContext({
    get: (key) => (key === 'remote.session' ? { fork: () => Promise.resolve({ ok: true, value: { sessionId: 's' } }) } : undefined),
  })
  spyRpc(seen, { 'chat.rename': () => ({ character: '老闆娘', name: '白天', file: '白天.jsonl', previous: '夜晚', sessionIds: [] }) })

  const items = await menuItemsFor(MENU_SIDEBAR)
  assert.deepEqual(items.map((el) => fakeText(el)), ['改名', '分支', '刪除'], '名稱與順序照原生那三顆（改名／分支／刪除）')
  items[0].listeners.click[0]()
  assert.equal(seen.filter((one) => one.op === 'chat.rename').length, 0, '按「改名」不該馬上送 op')

  const tree = renderComponent(TavernStreet, MENU_SIDEBAR)
  const input = collect(tree, (el) => el.type === 'input')[0]
  assert.ok(input !== undefined && input.props.className === 'dsh-tv-rename', '標題要換成行內輸入框')
  assert.equal(input.props.value, '夜晚', '輸入框要先填現在的名字')
  input.props.onChange({ target: { value: '白天' } })
  input.props.onKeyDown({ key: 'Enter', preventDefault() {} })
  await new Promise((resolve) => setTimeout(resolve, 0))

  const call = seen.filter((one) => one.op === 'chat.rename').pop()
  assert.ok(call !== undefined, 'Enter 之後要送 chat.rename')
  assert.deepEqual(
    [call.args.id, call.args.character, call.args.chat, call.args.name],
    ['t1', '老闆娘', '夜晚', '白天'],
    'chat.rename 的參數：酒館 id／角色／**現在**的名字／新的名字',
  )
  exportsObject.__chat.setContext(null)
  console.log('13a. 改名 OK — 按鈕只開行內輸入，Enter 才送 chat.rename（四個參數都對）')
}

/* ── 刪除：走已經驗過的 chat.delete ── */
{
  const seen = []
  spyRpc(seen)
  const items = await menuItemsFor(MENU_SIDEBAR)
  items[2].listeners.click[0]()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const call = seen.filter((one) => one.op === 'chat.delete').pop()
  assert.ok(call !== undefined, '「刪除」要送 chat.delete')
  assert.deepEqual(
    [call.args.id, call.args.character, call.args.chat],
    ['t1', '老闆娘', '夜晚'],
    '刪除的三個參數都要對',
  )
  console.log('13b. 刪除 OK — 選單上的刪除送 chat.delete（三個參數都對）')
}

/* ── 分支：remote.session.fork → 新檔 → 把訊息寫過去 → 綁定 ── */
{
  const seen = []
  exportsObject.__chat.setContext({
    get: (key) =>
      key === 'remote.session'
        ? {
            fork: (request) => {
              seen.push({ op: 'remote.session.fork', args: request })
              return Promise.resolve({ ok: true, value: { sessionId: 'session-forked' } })
            },
          }
        : undefined,
  })
  spyRpc(seen, {
    'chat.create': () => ({ character: '老闆娘', name: '夜晚-2', file: '夜晚-2.jsonl' }),
    'chat.messages': () => [{ name: '你', isUser: true, text: '嗨' }],
  })

  const items = await menuItemsFor(MENU_SIDEBAR)
  items[1].listeners.click[0]()
  await new Promise((resolve) => setTimeout(resolve, 0))

  const forkCall = seen.filter((one) => one.op === 'remote.session.fork').pop()
  assert.ok(forkCall !== undefined, '「分支」要呼叫 remote.session.fork')
  assert.equal(forkCall.args.sessionId, 'session-1', '要分的是這份對話綁定的那個 session')
  const bindCall = seen.filter((one) => one.op === 'session.bind').pop()
  assert.ok(bindCall !== undefined, '分支完要把新 session 綁到新檔')
  assert.equal(bindCall.args.sessionId, 'session-forked', '綁的是分支出來的新 session')
  assert.equal(bindCall.args.chat, '夜晚-2', '綁的是新開的那份檔（不是原本的）')
  const appendCall = seen.filter((one) => one.op === 'chat.append').pop()
  assert.ok(appendCall !== undefined, '分支要把目前看到的訊息一起分出去')
  assert.equal(appendCall.args.messages.length, 1, '一則訊息就寫一則')
  exportsObject.__chat.setContext(null)
  console.log('13c. 分支 OK — remote.session.fork → 新檔 → 寫訊息 → 綁定新 session')
}


/* ------------------------------ 設定頁與對話頁 ------------------------------ */

{
  exportsObject.__testSeed.loaded = true
  // 這一段是第一段渲染「設定頁」的地方：假 React 的 hook 槽在同一個元件之間沿用，
  // 沒有歸零就會拿到上一段別的元件留下的狀態（`props.characters` 變成 undefined，
  // 面板直接爆掉）。每一段自己開頭歸零是最省事的做法。
  reactImpl.resetHooks()
  const settings = flatten(renderComponent(TavernSettingsPage, {}))
  assert.ok(
    settings.includes('還沒有選定酒館'),
    '沒有酒館時，設定頁要說「還沒有選定酒館」而不是留一格空白',
  )
  assert.ok(flatten(renderComponent(TavernChatPage, {})).includes('對話'), '對話頁要有標題')
  console.log('4. 面板 OK — 沒有酒館的空狀態與對話頁都渲染得出來')
}

/* --------------- 主面板的四個分區（plan.md §7.5、redesign.md §3.2）--------------- */

{
  // ⚠️ 這一段**真的餵一間酒館進去**。
  //
  // 舊版沒有餵，所以「設定頁要有四個分區」那條斷言其實是**空跑**的：畫面只渲染了
  // 「還沒有選定酒館」，而那段說明文字剛好含「對話紀錄」——斷言一直是綠的，
  // 卻連一個分區都沒驗到。`useTavernData` 現在支援逐欄餵種子就是為了補這個洞。
  Object.assign(exportsObject.__testSeed, {
    loaded: true,
    taverns: [{ id: 'tv-1', name: '測試酒館', active: true, exists: true, scaffolded: true, icon: '🍺' }],
    activeId: 'tv-1',
    characters: [],
    summary: { name: 'tavern', counts: {}, files: [], layout: [] },
    settings: { name: '測試酒館', note: '' },
  })

  const labels = exportsObject.__zones.map((one) => one.label)
  assert.deepEqual(
    labels,
    ['🏠 大廳', '💬 包廂', '🎭 卡司', '📖 藏書'],
    '四個分區的名字要跟 redesign.md §3.2 一致',
  )

  const renderZone = (key) => {
    reactImpl.resetHooks()
    exportsObject.__setZone(key)
    return flatten(renderComponent(TavernSettingsPage, {}))
  }

  reactImpl.resetHooks()
  exportsObject.__setZone('hall')
  const hallTree = renderComponent(TavernSettingsPage, {})
  const hall = flatten(hallTree)
  // ⚠️ 分區列要用**元素**來驗，不要用文字：大廳的「快速入口」也會寫「💬 包廂」，
  // 用 `includes` 的話，就算分區列整條不見了這條斷言照樣是綠的。
  const tabs = collect(
    hallTree,
    (el) => el.type === 'button' && String(el.props.className || '').indexOf('dsh-tv-zone') === 0,
  )
  assert.deepEqual(tabs.map((one) => one.props.children), labels, '分區列要是那四個分頁')
  assert.ok(hall.includes('店面圖'), '🏠 大廳要有店面圖（酒館自己的樣子）')

  // 一次只畫一個分區——這是「分區」的定義，不是實作細節。
  const cast = renderZone('cast')
  assert.ok(cast.includes('匯入卡片'), '🎭 卡司要有「匯入卡片」')
  assert.equal(cast.includes('店面圖'), false, '切到卡司之後，大廳的內容不該還在畫面上')
  assert.ok(cast.includes('🎭 卡司'), '分區列在每一區都要在（那是切換的入口）')

  assert.ok(renderZone('books').includes('匯入世界書'), '📖 藏書要有「匯入世界書」')
  assert.ok(renderZone('rooms').includes('新對話'), '💬 包廂要有「＋ 新對話」')

  // 還原：後面的段落不該被這裡的種子與分區狀態影響。
  reactImpl.resetHooks()
  exportsObject.__setZone('hall')
  for (const key of ['taverns', 'activeId', 'characters', 'summary', 'settings']) {
    delete exportsObject.__testSeed[key]
  }
  console.log('4f. 四分區 OK — 分區列、一次只畫一區、切換真的換內容')
}

/* --------- 🏠 大廳：快速入口，以及收合的破壞性動作（plan.md §7.5）--------- */

{
  Object.assign(exportsObject.__testSeed, {
    loaded: true,
    taverns: [{ id: 'tv-1', name: '測試酒館', active: true, exists: true, scaffolded: true, icon: '🍺' }],
    activeId: 'tv-1',
    characters: [],
    summary: { name: 'tavern', counts: { characters: 2, worldbooks: 3, chats: 4, art: 0 }, files: [], layout: [] },
    settings: { name: '測試酒館', note: '' },
  })
  reactImpl.resetHooks()
  exportsObject.__setZone('hall')
  const hallTree = renderComponent(TavernSettingsPage, {})
  const hallText = flatten(hallTree)

  // 「移除」是破壞性動作，不可以跟「重新命名」並排——它要躲在收合的「進階」後面。
  assert.ok(hallText.includes('進階'), '🏠 大廳要有「進階」開關')
  assert.equal(
    hallText.includes('從酒館街移除'),
    false,
    '破壞性動作預設不可以攤在畫面上，要收在「進階」裡',
  )

  // 快速入口要**帶著數量**，而且要真的跳得過去。
  const quick = collect(
    hallTree,
    (el) => el.type === 'button' && el.props.className === 'dsh-tv-quickBtn',
  )
  assert.equal(quick.length, 3, '快速入口三個：包廂／卡司／藏書')
  assert.ok(hallText.includes('4 份對話'), '快速入口要顯示對話數量（來自 summary.counts）')
  quick[0].props.onClick()
  assert.equal(exportsObject.__currentZone(), 'rooms', '按快速入口要真的切到那一區')

  // 展開之後才看得到——這一條是「收合」的定義。
  reactImpl.resetHooks()
  exportsObject.__setZone('hall')
  const toggles = collect(
    renderComponent(TavernSettingsPage, {}),
    (el) => el.type === 'button' && el.props.className === 'dsh-tv-advToggle',
  )
  assert.equal(toggles.length, 1, '「進階」只有一個開關')
  toggles[0].props.onClick()
  const opened = flatten(renderComponent(TavernSettingsPage, {}))
  assert.ok(opened.includes('從酒館街移除'), '展開「進階」之後才出現「從酒館街移除」')
  assert.ok(opened.includes('資料夾與裡面所有檔案都不會被刪除'), '說明要跟著按鈕一起出現')

  reactImpl.resetHooks()
  exportsObject.__setZone('hall')
  for (const key of ['taverns', 'activeId', 'characters', 'summary', 'settings']) {
    delete exportsObject.__testSeed[key]
  }
  console.log('4g. 大廳 OK — 快速入口會跳區、破壞性動作收在「進階」裡')
}

/* ---------- 🎭 卡司：海報牆（找卡）與編輯器（改卡）分開（redesign §3.2）---------- */

{
  const cardOf = (id, name, primary) => ({
    id,
    file: id + '.json',
    card: { name },
    assets: {
      items: primary === null ? [] : [{ name: primary, url: '/api/dsh-tavern/assets/character/' + id + '/' + primary }],
      primary,
      owner: id,
    },
  })
  Object.assign(exportsObject.__testSeed, {
    loaded: true,
    taverns: [{ id: 'tv-1', name: '測試酒館', active: true, exists: true, scaffolded: true }],
    activeId: 'tv-1',
    characters: [cardOf('老闆娘', '老闆娘', 'a.png'), cardOf('酒保', '酒保', null)],
    summary: { name: 'tavern', counts: { characters: 2 }, files: [], layout: [] },
    settings: { name: '測試酒館', note: '' },
  })
  exportsObject.__setRpc((op) =>
    Promise.resolve(op === 'character.read' ? { name: '酒保', description: '看櫃檯的。' } : {}),
  )

  reactImpl.resetHooks()
  exportsObject.__setZone('cast')
  const wallTree = renderComponent(TavernSettingsPage, {})
  const wallText = flatten(wallTree)
  // 「找卡」與「改卡」要能分開看：還沒選卡時畫的是海報牆，不是編輯器。
  assert.equal(wallText.includes('檔案：characters/'), false, '還沒選卡時不該畫編輯器')

  const posters = collect(
    wallTree,
    (el) => el.type === 'button' && el.props.className === 'dsh-tv-poster',
  )
  assert.deepEqual(posters.map((one) => one.props.title), ['老闆娘', '酒保'], '兩張卡＝兩張海報')
  // 資產 URL 必須是「**多一個斜線**」的形狀。DSH 的 prefix 比對自己會補一個 `/`
  // 再 `startsWith`，所以 2.6.1 之前註冊成 `…/assets/` 的宿主半只吃得進 `…/assets//…`；
  // 單斜線的 URL 會落到 DSH 自己的 fallback（curl 401、瀏覽器 404），
  // 症狀看起來完全像「圖不存在」，但檔案一直都在。`…/assets//…` 新舊宿主都吃。
  assert.equal(
    collect(posters[0], (el) => el.type === 'img')[0].props.src,
    '/api/dsh-tavern/assets//character/老闆娘/a.png',
    '海報的圖要指向新舊宿主都吃得到的 URL 形狀',
  )

  const withArt = posters.filter((one) => collect(one, (el) => el.type === 'img').length === 1)
  assert.deepEqual(withArt.map((one) => one.props.title), ['老闆娘'], '有主圖的那一張要用 <img>')
  const noArt = posters.filter(
    (one) => collect(one, (el) => el.props.className === 'dsh-tv-posterEmpty').length === 1,
  )
  assert.deepEqual(noArt.map((one) => one.props.title), ['酒保'], '沒有主圖的要給佔位符，不要破圖')

  // 點一張海報 → 讀卡（非同步）→ 進編輯器。
  posters[1].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const editTree = renderComponent(TavernSettingsPage, {})
  assert.ok(
    flatten(editTree).includes('檔案：characters/酒保.json'),
    '選了卡要進編輯器（改卡）',
  )

  // 返回鍵要回得到海報牆——「找卡」與「改卡」之間要有回頭路。
  const backRow = collect(editTree, (el) => el.props.className === 'dsh-tv-backRow')
  assert.equal(backRow.length, 1, '編輯器要有返回鍵')
  const backBtn = collect(backRow[0], (el) => el.type === 'button')[0]
  assert.ok(backBtn !== undefined, '返回鍵要是一顆按鈕')
  backBtn.props.onClick()
  assert.equal(
    flatten(renderComponent(TavernSettingsPage, {})).includes('檔案：characters/'),
    false,
    '按返回要回到海報牆',
  )

  reactImpl.resetHooks()
  exportsObject.__setZone('hall')
  for (const key of ['taverns', 'activeId', 'characters', 'summary', 'settings']) {
    delete exportsObject.__testSeed[key]
  }
  console.log('4h. 卡司 OK — 海報牆（有圖／沒圖）、點進編輯器、返回鍵回得去')
}

/* ---------- 💬 包廂：開新對話＝一張設定卡（跟誰／名稱／開場白）---------- */

{
  const cardOf = (id, name, firstMes, alternates) => ({
    id,
    file: id + '.json',
    // 磁碟上是 SillyTavern 的信封，而 `character.list` 回來的形狀並不保證拆過——
    // 開場白讀的是 `data.first_mes`，所以這一條同時在驗「信封有被拆開」。
    card: {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name, first_mes: firstMes, alternate_greetings: alternates },
    },
    assets: {
      items: [{ name: 'a.png', url: '/api/dsh-tavern/assets/character/' + id + '/a.png' }],
      primary: 'a.png',
      owner: id,
    },
  })
  Object.assign(exportsObject.__testSeed, {
    loaded: true,
    taverns: [{ id: 'tv-1', name: '測試酒館', active: true, exists: true, scaffolded: true }],
    activeId: 'tv-1',
    characters: [
      cardOf('老闆娘', '老闆娘', '門上的銅鈴響了一聲。', ['外頭在下雨。']),
      cardOf('酒保', '酒保', '他擦著杯子。', []),
    ],
    summary: { name: 'tavern', counts: { characters: 2 }, files: [], layout: [] },
    settings: { name: '測試酒館', note: '' },
  })

  const seen = []
  // 「建立完要跳進那份對話」是可驗的：切換主面板走 `layout.selectPanel(key)`，
  // 所以在測試裡放一個假的 layout 服務，看它有沒有被叫、被叫去哪裡。
  const panels = []
  exportsObject.__chat.setContext({
    get: (key) => (key === 'layout' ? { selectPanel: (name) => panels.push(name) } : undefined),
  })
  spyRpc(seen, {
    'character.list': () => exportsObject.__testSeed.characters,
    // 回音：`chat.create` 回傳的名字才是真正用的（撞名會換編號），
    // 所以讓 mock 照著 args 回，才驗得到「append 用的是回傳值」。
    'chat.create': (args) => ({ character: args.character, name: args.name, file: args.name + '.jsonl' }),
  })

  // ⚠️ 重繪**不可以** `resetHooks()`。
  //
  // `MapChatFiles` 的狀態住在 `React.useRef` 裡（`ref.current` 只在第一次填），
  // 而重置 hook 槽等於把那個 ref 清掉——`picking` 會跟著歸零，表單永遠打不開。
  // 這一條踩過：斷言說「每張卡都要是一張可以選的海報」，拿到的是空陣列。
  const renderRooms = () => {
    exportsObject.__setZone('rooms')
    return renderComponent(TavernSettingsPage, { tavernId: 'tv-1' })
  }
  const byLabel = (tree, label) =>
    collect(tree, (el) => el.props !== undefined && el.props.children === label)[0]
  const posterOf = (tree, name) =>
    collect(
      tree,
      (el) => el.type === 'button' && el.props.title === name && el.props['aria-pressed'] !== undefined,
    )[0]
  const nameField = (tree) =>
    collect(tree, (el) => el.type === 'input' && el.props['aria-label'] === '對話名稱')[0]
  const openForm = async () => {
    byLabel(renderRooms(), '＋ 新對話').props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    return renderRooms()
  }

  reactImpl.resetHooks()

  // 1. 表單：一張卡一張海報，預設選第一張。
  let form = await openForm()
  const picks = collect(
    form,
    (el) => el.type === 'button' && el.props['aria-pressed'] !== undefined,
  )
  assert.deepEqual(picks.map((one) => one.props.title), ['老闆娘', '酒保'], '每張卡都要是一張可以選的海報')
  assert.match(picks[0].props.className, /dsh-tv-posterOn/, '預設要選第一張卡')
  assert.equal(picks[1].props.className.includes('dsh-tv-posterOn'), false, '沒選到的不能也亮著')
  // 有圖用圖、沒圖用佔位符——跟卡司的海報牆同一套。
  assert.equal(collect(form, (el) => el.props.className === 'dsh-tv-posterArt').length, 2, '兩張卡都有主圖')

  // 2. 名稱要跟著卡片走。
  assert.equal(nameField(form).props.value, '老闆娘', '名稱預設跟卡片名')

  // 3. 開場白：卡片的第一則 ＋ 其他 1 ＋ 不要開場白。
  assert.ok(byLabel(form, '卡片的第一則') !== undefined, '要有卡片的第一則開場白')
  assert.ok(byLabel(form, '其他 1') !== undefined, 'alternate_greetings 要列出來')
  assert.ok(byLabel(form, '不要開場白') !== undefined, '要能選「不要開場白」')
  assert.ok(flatten(form).includes('門上的銅鈴響了一聲。'), '要顯示目前選的開場白內容（預覽）')

  // 4. 換開場白 → 預覽跟著換。
  byLabel(form, '其他 1').props.onClick()
  form = renderRooms()
  assert.ok(flatten(form).includes('外頭在下雨。'), '換一則開場白，預覽要跟著換')

  // 5. 換卡 → 名稱跟著換（還沒被手改過）、開場白退回第一則、選項數量跟著卡片。
  posterOf(form, '酒保').props.onClick()
  form = renderRooms()
  assert.equal(nameField(form).props.value, '酒保', '換卡要把「還沒改過」的名稱一起換掉')
  assert.ok(flatten(form).includes('他擦著杯子。'), '換卡要把開場白退回第一則')
  assert.equal(byLabel(form, '其他 1'), undefined, '酒保沒有 alternate_greetings，就不該有「其他 1」')

  // 6. 建立 → 先開檔，再把開場白寫成第一則訊息。
  byLabel(form, '建立對話').props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  let create = seen.filter((one) => one.op === 'chat.create').pop()
  assert.equal(create.args.id, 'tv-1', 'chat.create 一定要帶酒館 id（少了它會拿角色當酒館）')
  assert.equal(create.args.character, '酒保')
  assert.equal(create.args.name, '酒保', '名稱要送出去')
  let append = seen.filter((one) => one.op === 'chat.append').pop()
  assert.ok(append !== undefined, '選了開場白就要把它寫進檔案')
  assert.equal(append.args.character, '酒保', 'append 用的是 create 回傳的角色')
  assert.equal(append.args.chat, '酒保', 'append 用的是 create 回傳的名字，不是自己送的那個')
  assert.equal(append.args.messages[0].text, '他擦著杯子。', '寫進去的要是選的那一則')
  assert.equal(append.args.messages[0].isUser, false, '開場白是角色的訊息，不是使用者的')

  // 6b. 建立完要**直接跳進那份對話**（使用者：「創建好的時候順便幫我跳過去」）。
  const errBox = collect(renderRooms(), (el) => el.props.className === 'dsh-tv-err')[0]
  assert.deepEqual(
    panels,
    ['tavern-chats'],
    '建立完要切到對話面板（不然只會回到列表，還要自己再找一次那一列）' +
      '／錯誤框：' + (errBox === undefined ? '（沒有）' : flatten(errBox)),
  )

  // 7. 手改過的名稱不可以被下一次點卡蓋掉。
  form = await openForm()
  const custom = nameField(form)
  custom.props.onChange({ target: { value: '第一次來' } })
  form = renderRooms()
  posterOf(form, '酒保').props.onClick()
  form = renderRooms()
  assert.equal(nameField(form).props.value, '第一次來', '使用者改過的名字不該被點卡蓋掉')

  // 8.「不要開場白」→ 檔案是空的，不該有 append。
  const before = seen.filter((one) => one.op === 'chat.append').length
  byLabel(form, '不要開場白').props.onClick()
  form = renderRooms()
  byLabel(form, '建立對話').props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  create = seen.filter((one) => one.op === 'chat.create').pop()
  assert.equal(create.args.name, '第一次來', '建立要用表單裡的名字')
  assert.equal(
    seen.filter((one) => one.op === 'chat.append').length,
    before,
    '選了「不要開場白」就不該寫入任何訊息',
  )

  exportsObject.__chat.setContext(null)
  reactImpl.resetHooks()
  exportsObject.__setZone('hall')
  for (const key of ['taverns', 'activeId', 'characters', 'summary', 'settings']) {
    delete exportsObject.__testSeed[key]
  }
  console.log('4k. 開新對話 OK — 選卡（有圖）、名稱跟著卡但不蓋手改、開場白寫進檔案、建完直接進去')
}

/* --------- 📖 藏書：條目編輯器（純函式，所以離線驗得到完整行為）--------- */

{
  const wb = exportsObject.__worldbook
  // 原生格式：`entries` 是**以字串化 uid 為 key 的物件**；第二條故意用 V2 的 `keys`。
  const native = JSON.stringify({
    entries: {
      0: { uid: 0, key: ['鳳梨'], keysecondary: [], content: '鳳梨不進貨。', comment: '鳳梨', constant: false, order: 100 },
      1: { uid: 1, keys: ['雨'], content: '下雨天不開門。', comment: '', constant: true },
    },
    rome: 'extra',
  })

  assert.deepEqual(
    wb.entries(wb.parse(native)).map((one) => one.label),
    ['0', '1'],
    '原生格式（uid 物件）要列得出來',
  )
  assert.deepEqual(
    wb.entries(wb.parse('{"entries":[{"comment":"a"},{"comment":"b"}]}')).map((one) => one.label),
    ['0', '1'],
    'V2 內嵌格式（陣列）也要列得出來',
  )
  assert.deepEqual(wb.entries(wb.parse('{}')), [], '沒有 entries → 空的，不要丟錯')
  assert.deepEqual(wb.entries(wb.parse('這不是 JSON')), [], '壞掉的 JSON → 空的，不要丟錯')
  assert.equal(wb.parse('這不是 JSON'), null, '解析不了要回 null（呼叫端據此不動狀態）')
  assert.equal(wb.parse('[1,2]'), null, '不是物件也要回 null')

  // 只改指定的那一條，其他欄位、其他條目、entries 以外的欄位全部原樣保留。
  const patched = wb.parse(wb.patch(native, '0', 'content', '鳳梨罐頭可以。'))
  assert.equal(patched.entries['0'].content, '鳳梨罐頭可以。', '改到那一條了')
  assert.equal(patched.entries['0'].uid, 0, 'uid 要原樣保留')
  assert.equal(patched.entries['0'].order, 100, 'order 要原樣保留')
  assert.deepEqual(patched.entries['0'].keysecondary, [], '不認識的欄位也要留著')
  assert.equal(patched.entries['1'].content, '下雨天不開門。', '別的條目不能被動到')
  assert.equal(patched.rome, 'extra', 'entries 以外的欄位也要留著')

  // ⚠️ `keys`（V2）不可以被我們擅自改成 `key`——那是別人檔案的格式。
  assert.equal(wb.keyField({ keys: ['雨'] }), 'keys')
  assert.equal(wb.keyField({ key: ['雨'] }), 'key')
  assert.equal(wb.keyField({}), 'key', '兩個都沒有 → 用原生的 key')
  assert.deepEqual(wb.keysOf({ keys: ['雨'] }), ['雨'])
  assert.deepEqual(wb.keysOf({}), [])
  const entryOne = wb.entries(wb.parse(native))[1].ref
  const kept = wb.parse(wb.patch(native, '1', wb.keyField(entryOne), ['雨', '雷']))
  assert.deepEqual(kept.entries['1'].keys, ['雨', '雷'], 'V2 的 keys 要寫回 keys')
  assert.equal(kept.entries['1'].key, undefined, '不要無中生有一個 key')
  assert.equal(kept.entries['1'].constant, true, 'constant 要留著')

  // 找不到那一條／文字壞掉 → 回 null（呼叫端就不會動狀態，畫面不會爆）。
  assert.equal(wb.patch(native, '不存在', 'content', 'x'), null, '找不到條目要回 null')
  assert.equal(wb.patch('壞掉的 JSON', '0', 'content', 'x'), null, '解析不了要回 null')

  console.log('4i. 藏書 OK — 條目吃得下兩種格式、只改那一條、keys 不會被改名')
}

/* ---------- 顯示層解析：原文 → 節點樹（推斷優先、容錯）---------- */

{
  const parse = exportsObject.__display.parse
  const kindsOf = (result) => result.nodes.filter((n) => n.kind !== 'blank').map((n) => [n.kind, n.source])

  // 1. 排版慣例：**不需要模型配合的那一層**（也是唯一不會隨對話變長而退化的）。
  assert.deepEqual(
    kindsOf(parse('她抬起頭。\n「你終於來了。」\n（她把布放下。）')),
    [
      ['narration', 'plain'],
      ['speech', 'quoted'],
      ['action', 'quoted'],
    ],
    '引號＝台詞、括號＝動作、其餘＝旁白',
  )

  // ⚠️ 只有「整行被包住」才算台詞——「行內有引號」是猜錯的主要來源。
  assert.equal(parse('他說：「你好」然後就走了。').nodes[0].kind, 'narration', '行內的引號不算台詞')
  assert.equal(parse('「」').nodes[0].kind, 'narration', '空引號不算台詞')
  // 原文照留（不前處理）——所以複製、搜尋、匯出都拿到原樣的字。
  assert.equal(parse('「你好」').nodes[0].text, '「你好」', '原文要一字不動')
  assert.equal(parse('  「你好」  ').nodes[0].text, '「你好」', '只去頭尾空白')

  // 2. 標記優先於推斷，而且**兩者可以混用**（走樣時最需要的性質）。
  const cfg = { markers: [{ tag: '台詞', kind: 'speech' }, { tag: '面板', kind: 'panel' }] }
  assert.deepEqual(
    kindsOf(parse('她抬起頭。\n<台詞>你終於來了。</台詞>\n（她把布放下。）', cfg)),
    [
      ['narration', 'plain'],
      ['speech', 'marked'],
      ['action', 'quoted'],
    ],
    '有標記走標記、沒有的走推斷',
  )

  // who：標記帶的優先，沒帶就用這一則的預設（＝訊息本身的角色名）。
  assert.equal(parse('<台詞 who="她">走吧。</台詞>', cfg).nodes[0].who, '她', '要讀得出標記的 who')
  assert.equal(parse('「走吧。」', { defaultWho: '老闆娘' }).nodes[0].who, '老闆娘', '沒標記就用預設')

  // 3. ⚠️ 走樣：**未閉合的標記不可以吃掉後面正常閉合的標記**。
  //    一個漏掉的收尾標記若吞掉後面整段，那是比走樣更糟的結果。
  const broken = parse('<面板>\n心情：累\n\n<台詞>走吧。</台詞>\n她點頭。', cfg)
  assert.deepEqual(
    kindsOf(broken),
    [
      ['panel', 'marked'],
      ['speech', 'marked'],
      ['narration', 'plain'],
    ],
    '未閉合要停在下一個標記之前',
  )
  assert.equal(broken.problems.length, 1, '未閉合要回報一條問題')
  assert.equal(broken.problems[0].layer, 'format', '未閉合是**格式層**')
  assert.equal(broken.problems[0].severity, 'fatal', '未閉合是致命的（它會把後面的內容吃進來）')
  assert.equal(broken.problems[0].kind, 'unclosed')
  assert.equal(broken.problems[0].tag, '面板')
  assert.ok(broken.problems[0].line >= 1, '要帶行號——修復層才知道要送哪一段')

  // 孤兒收尾標記：不該爆，也不該讓文字消失。
  const orphan = parse('她點頭。</台詞>然後走了。', cfg)
  assert.equal(orphan.nodes.length, 1, '孤兒收尾標記不該多出節點')
  assert.ok(orphan.nodes[0].text.includes('然後走了。'), '文字要留著（不可以整段不見）')

  // 區塊內容的頭尾空白要拿掉——不然渲染端會多出一個空的頭行／尾行。
  assert.equal(parse('<面板>\n心情：累\n</面板>', cfg).nodes[0].text, '心情：累', '區塊內容要去頭尾空白')

  // ⚠️ **一行不一定是同一種東西。** 真實的寫法會把「台詞＋旁白＋台詞」擠在同一行
  //    （實測在使用者的對話裡佔三分之一）。整行判成一種的話，語音會把旁白也唸出來。
  const inline = parse('「第一次來的，我通常不給酒單。」她轉身拿下兩只杯子，「你會站在門口猶豫一下。」')
  assert.deepEqual(
    inline.nodes.map((n) => n.kind),
    ['speech', 'narration', 'speech'],
    '同一行要切成台詞／旁白／台詞三段',
  )
  assert.ok(inline.nodes[0].text.startsWith('「第一次來的'), '台詞要含引號本身（原文照留）')
  assert.ok(inline.nodes[1].text.startsWith('她轉身拿下'), '中間那一段是旁白')
  assert.equal(inline.nodes[0].para, inline.nodes[1].para, '同一行的片段共用 para 編號')
  assert.equal(inline.nodes[1].para, inline.nodes[2].para, '同一行的片段共用 para 編號')

  // 引號沒有收尾（模型很常漏）＝吃到行尾 + warning。**不要讓整段文字消失。**
  const unclosedQuote = parse('她說：「你先坐一下。')
  assert.equal(unclosedQuote.nodes.length, 2, '旁白 ＋ 台詞')
  assert.equal(unclosedQuote.nodes[1].kind, 'speech', '沒有收尾的引號當作台詞')
  assert.ok(
    unclosedQuote.problems.some((one) => one.kind === 'unclosed-quote'),
    '要回報引號沒收尾（格式層，可接受）',
  )

  // 空的一對引號不是空台詞（那會畫出一個空氣泡）。
  assert.equal(parse('「」').nodes[0].kind, 'narration', '空引號是雜訊，不是台詞')

  // ---- 資料區塊（`key: value`）：那一半**可以嚴**，因為壞掉只損失那一塊 ----
  const data = parse('<面板>\n時間：晚上十一點\n心情：疲倦\n</面板>', cfg).nodes[0]
  assert.deepEqual(
    data.rows,
    [
      { key: '時間', value: '晚上十一點' },
      { key: '心情', value: '疲倦' },
    ],
    '全部符合就要拆成欄位',
  )
  assert.ok(data.text.includes('時間：晚上十一點'), '原文要留著（不支援 rows 的渲染端照樣畫得出來）')

  // 半形冒號也吃，但**全形優先**（不然 `時間：晚上 11:30` 會被切成 `晚上 11`）。
  assert.deepEqual(parse('<面板>\nHP: 47\n</面板>', cfg).nodes[0].rows, [{ key: 'HP', value: '47' }], '半形冒號')
  assert.deepEqual(
    parse('<面板>\n時間：晚上 11:30\n</面板>', cfg).nodes[0].rows,
    [{ key: '時間', value: '晚上 11:30' }],
    '全形冒號優先',
  )

  // ⚠️ 只要有一行不符合，就**整塊當文字**——半對的資料畫成表格比純文字更難讀。
  assert.equal(
    parse('<面板>\n心情：累\n今晚的帳還沒結\n</面板>', cfg).nodes[0].rows,
    null,
    '有一行不符合就整塊當文字',
  )
  assert.equal(parse('<面板>\n只是普通的一段話\n</面板>', cfg).nodes[0].rows, null, '沒有冒號就不是資料')

  // ---- 第二層（詞彙）：用了但**沒宣告**的標記——走樣偵測的主力 ----
  // 模型最常見的錯不是語法壞，是用了別的名字（打錯、換寫法、記成別張卡）。
  // 沒有這一條，那些標記會靜靜地變成文字，而使用者只覺得「卡片怎麼不見了」。
  const unknown = parse('<狀態欄>心情：累</狀態欄>', cfg)
  assert.equal(unknown.problems.length, 1, '未宣告的標記要回報一條')
  assert.equal(unknown.problems[0].layer, 'schema', '那是**詞彙層**')
  assert.equal(unknown.problems[0].kind, 'unknown-tag')
  assert.equal(unknown.problems[0].tag, '狀態欄')
  assert.equal(unknown.problems[0].severity, 'acceptable', '不修也看得下去（當文字）')
  assert.equal(unknown.nodes[0].source, 'plain', '未宣告的標記要當普通文字')

  // 格式層：孤兒收尾標記（通常代表前面那一段被別的東西吃掉了）
  const orphanClose = parse('她點頭。</台詞>然後走了。', cfg)
  assert.ok(
    orphanClose.problems.some((one) => one.kind === 'orphan-close' && one.layer === 'format'),
    '要回報孤兒收尾',
  )

  // 詞彙層：宣告成資料區塊，內容卻不是 `key: value`
  const mismatch = parse('<面板>\n今天很累\n</面板>', { markers: [{ tag: '面板', kind: 'data' }] })
  assert.ok(
    mismatch.problems.some((one) => one.kind === 'data-mismatch' && one.layer === 'schema'),
    '要回報內容不符約定',
  )

  // 乾淨的輸入不該誤報
  assert.deepEqual(parse('她抬起頭。\n「你終於來了。」', cfg).problems, [], '正常輸入不該有問題')

  /* ---- B 方案：一行一個物件（模型直接吐結構）---- */

  const given = parse('{"kind":"speech","who":"老闆娘","text":"你終於來了。"}')
  assert.equal(given.nodes[0].kind, 'speech')
  assert.equal(given.nodes[0].source, 'given', '結構化的來源是 given')
  assert.equal(given.nodes[0].who, '老闆娘', 'who 由模型指定，不是推斷')
  assert.deepEqual(given.problems, [], '好的結構不該有問題')

  // **後處理填的**：模型只給 kind/who/text，rows 由內容拆出來。
  assert.deepEqual(
    parse('{"kind":"panel","text":"時間：晚上十一點\\n心情：疲倦"}').nodes[0].rows,
    [
      { key: '時間', value: '晚上十一點' },
      { key: '心情', value: '疲倦' },
    ],
    'rows 是後處理填的，模型不需要知道它',
  )

  // ⚠️ 壞掉的一行＝**一個問題、一個節點**。不可以被推斷碎成十幾個片段
  //    （JSON 行裡的引號是語法，不是台詞——實測踩過）。
  const badJson = parse('{"kind":"speech","who":"老闆娘","text":"沒有收尾"')
  assert.equal(badJson.nodes.length, 1, '壞掉的一行只能是一個節點')
  assert.equal(badJson.nodes[0].kind, 'narration', '降級成旁白')
  assert.equal(badJson.problems.length, 1, '一個問題')
  assert.equal(badJson.problems[0].kind, 'bad-json')
  assert.equal(badJson.problems[0].layer, 'format', '那是格式層')
  assert.equal(badJson.problems[0].severity, 'fatal', '值得修')

  // 詞彙層：不認得的 kind → 當旁白並回報，但**文字要救回來**
  const badKind = parse('{"kind":"speach","text":"打錯字"}')
  assert.equal(badKind.nodes[0].kind, 'narration', '不認得的 kind 當旁白')
  assert.equal(badKind.nodes[0].text, '打錯字', '文字要救回來，不是丟掉')
  assert.equal(badKind.problems[0].kind, 'unknown-kind')
  assert.equal(badKind.problems[0].layer, 'schema', '那是詞彙層')
  assert.equal(badKind.problems[0].value, 'speach', '要說出是哪個值')

  // 安全網：不是 JSON 的行照樣走推斷（舊訊息、模型忘了吐結構）
  assert.equal(parse('「這一行有引號。」').nodes[0].source, 'quoted', '不是 JSON 就走推斷')

  /* ---- 本地修復（第一層）：機械式的，不需要模型 ---- */

  const brokenJson = '{"kind":"speech","who":"老闆娘","text":"沒有收尾"'
  const brokenParsed = parse(brokenJson)
  assert.equal(brokenParsed.problems[0].kind, 'bad-json')

  const repaired = exportsObject.__display.repair(brokenJson, brokenParsed.problems)
  assert.equal(repaired.log.length, 1, '要有一條修復紀錄')
  assert.equal(repaired.log[0].line, 1, '紀錄要說是哪一行')
  assert.equal(repaired.log[0].kind, 'bad-json', '紀錄要說是哪一種問題')
  assert.ok(repaired.log[0].action.includes('}'), '紀錄要說修了什麼')
  assert.equal(repaired.log[0].before, brokenJson, '紀錄要留原文')
  assert.equal(repaired.text, brokenJson + '}', '補上少的收尾大括號')
  assert.deepEqual(parse(repaired.text).problems, [], '修完就不該再有問題')
  assert.equal(parse(repaired.text).nodes[0].source, 'given', '修完要真的變成結構化節點')
  assert.equal(parse(repaired.text).nodes[0].who, '老闆娘', '而且要讀得出 who')

  // ⚠️ **第二層也能本地修**——打錯的模糊比對、缺的用推斷反推，都不需要模型。
  const typo = '{"kind":"speach","text":"x"}'
  const typoFixed = exportsObject.__display.repair(typo, parse(typo).problems)
  assert.equal(typoFixed.log.length, 1, '打錯的 kind 要本地修好')
  assert.equal(JSON.parse(typoFixed.text).kind, 'speech', 'speach → speech（模糊比對）')
  assert.equal(typoFixed.deferred.length, 0, '修好了就不該交給模型')

  const noKind = '{"who":"老闆娘","text":"「台詞。」"}'
  const noKindFixed = exportsObject.__display.repair(noKind, parse(noKind).problems)
  assert.equal(JSON.parse(noKindFixed.text).kind, 'speech', '缺 kind 用推斷反推（有引號＝台詞）')

  // 只有「**致命又修不了**」的才交給模型——`missing-text` 是唯一那一種。
  const noText = '{"kind":"narration"}'
  const noTextFixed = exportsObject.__display.repair(noText, parse(noText).problems)
  assert.equal(noTextFixed.log.length, 0, '沒有內容可修')
  assert.equal(noTextFixed.deferred.length, 1, '要列進交給模型')
  assert.equal(noTextFixed.deferred[0].kind, 'missing-text')

  // ⚠️ `acceptable` 的那些**不該**佔用模型的呼叫（它們已經降級處理過了）。
  const extraKey = '{"kind":"narration","text":"x","mood":"開心"}'
  assert.equal(
    exportsObject.__display.repair(extraKey, parse(extraKey).problems).deferred.length,
    0,
    '可接受的問題不必修、也不必交給模型',
  )

  // 4. 標籤名的邊界：`<n>` **不可以**在 `<note>` 裡命中。
  //    （SillyTavern 的 `matchWholeWords` 對中文壞掉是同型問題，見 plan.md §5 第 8 條）
  assert.equal(
    parse('<note>這不是短標記</note>', { markers: [{ tag: 'n', kind: 'narration' }] }).nodes[0].source,
    'plain',
    '短標籤不該在長標籤裡命中',
  )

  // 5. 壞輸入不該讓整個面板爆掉（同 §7.4b 那個型別的 bug）。
  for (const bad of ['', null, undefined, 123]) {
    assert.deepEqual(parse(bad).nodes, [], `壞輸入要回空節點樹：${String(bad)}`)
  }
  assert.deepEqual(parse('沒有標記也沒有引號').nodes[0].kind, 'narration', '一般文字就是旁白')

  console.log('4j. 顯示解析 OK — 推斷優先、標記可混用、走樣不會吃掉後面的訊息')
}

/* ----------------- 設定頁文案要跟上功能（實測被抓到的缺口）----------------- */

{
  // 使用者實際回報：「window 設定 ui 你可能未幫我更新」。
  // 查下去發現三個真缺口，都是文案沒跟上功能：
  //   1. 統計卡寫「立繪」，但 art/ 現在裝四種圖（角色／世界書／對話室／店面）
  //   2. tavern.json 與 README.txt 標籤**永久硬寫**，於是舊版殘留酒館會
  //      同時顯示「有 tavern.json」與下面的「這個資料夾裡沒有 tavern.json」
  //   3. 說明文字只提 characters/，沒提插圖與原版
  const { MapOverview } = (function () {
    // MapOverview 沒有掛在 __components 上，用原始碼斷言 + 直接渲染兩條路都做。
    return {}
  })()

  // (1) 舊名詞不該再出現在設定頁
  assert.equal(source.includes("art: '立繪'"), false, '統計卡不該再叫「立繪」')
  // 抓「'立繪'」出現在字串常值裡（註解不算）
  const rendered = flatten(renderComponent(TavernSettingsPage, {}))
  assert.equal(rendered.includes('立繪'), false, '設定頁不該再出現「立繪」')
  assert.ok(rendered.includes('插圖') || rendered.includes('還沒有選定酒館'), '應該改叫「插圖」')

  // (2) 檔案標籤要依 summary.files 決定，不能無條件渲染
  assert.ok(source.includes('summary.files'), '資料夾結構要讀 summary.files')
  assert.ok(source.includes('files.indexOf('), '要逐項檢查檔案真的存在')
  // 舊寫法是無條件塞兩個標籤，這裡確認那種寫法已經不在
  assert.equal(
    /React\.createElement\('span', \{ className: 'dsh-tv-tag' \}, 'tavern\.json/.test(source),
    false,
    'tavern.json 標籤不可以再無條件渲染',
  )
  assert.equal(
    /React\.createElement\('span', \{ className: 'dsh-tv-tag' \}, 'README\.txt/.test(source),
    false,
    'README.txt 標籤不可以再無條件渲染',
  )

  // (3) art/ 的四個掛載點要被說明
  for (const kind of ['characters/', 'worldbooks/', 'chats/', 'tavern/']) {
    assert.ok(source.includes("['" + kind + "'"), `設定頁要說明 art/${kind} 是什麼`)
  }
  console.log('4b. 設定頁文案 OK — 「插圖」、art/ 四類、檔案標籤依實際存在顯示')
}

/* --------- 需要酒館 id 的 op 一定要帶 id（實測踩到的錯誤）--------------- */

{
  // 症狀：設定頁按「＋ 新對話」→ 選了角色 → 回「找不到這間酒館：老闆娘」。
  // 原因：`chat.create` 需要 `{ id, character }`，只送 `character` 的話
  // 宿主半會把它當成酒館 id。這一條把「所有 chat.create 都要帶 id」釘死。
  const calls = [...source.matchAll(/rpc\(\s*'chat\.create'\s*,\s*\{([^}]*)\}/g)].map((m) => m[1])
  assert.ok(calls.length >= 2, `應該找得到 chat.create 的呼叫點（找到 ${String(calls.length)} 個）`)
  for (const args of calls) {
    assert.match(args, /\bid\s*:/, `chat.create 一定要帶酒館 id，否則會拿角色當酒館：{${args.trim()}}`)
  }

  // 設定頁要把目前酒館的 id 傳給對話分區，不然它無從得知。
  assert.ok(
    source.includes('MapChatFiles, { tavernId:'),
    '設定頁要把 tavernId 傳進對話紀錄分區',
  )

  /* --- 同一型的 bug：character.* 也要帶酒館 id（實測在 GUI 裡踩到）--------- */

  // 症狀：卡片編輯器按「儲存」→ 回「找不到這間酒館：老闆娘」。
  // 原因跟上面一模一樣，但更隱蔽——這一區送的是 `{ id: 角色id }`，
  // 而宿主半的約定是 `{ id: 酒館id, card: 角色id }`。**四個動作全中**：
  //   read／write／delete 拿角色名去找酒館；create 更慘，送 `{card:{name}}`
  //   但宿主半讀 `args.name`，所以永遠建立「新角色」。
  // 畫面看起來完全正常（只有一個紅字），所以這條一定要用測試釘住。
  const characterOps = ['character.read', 'character.write', 'character.delete', 'character.create']
  for (const op of characterOps) {
    const pattern = new RegExp(`rpc\\(\\s*'${op.replace('.', '\\.')}'\\s*,\\s*\\{([^}]*)\\}`, 'g')
    const found = [...source.matchAll(pattern)].map((m) => m[1])
    assert.ok(found.length >= 1, `應該找得到 ${op} 的呼叫點`)
    for (const args of found) {
      assert.match(
        args,
        /\bid\s*:/,
        `${op} 一定要帶酒館 id，否則宿主半會拿角色當酒館：{${args.trim()}}`,
      )
    }
  }
  // read／write／delete 一定要用 `card` 傳角色 id（不是 `id`）
  for (const op of ['character.read', 'character.write', 'character.delete']) {
    const pattern = new RegExp(`rpc\\(\\s*'${op.replace('.', '\\.')}'\\s*,\\s*\\{([^}]*)\\}`, 'g')
    for (const match of source.matchAll(pattern)) {
      assert.match(match[1], /\bcard\s*:/, `${op} 要用 card 傳角色 id：{${match[1].trim()}}`)
    }
  }
  // write 的卡片本體叫 payload（宿主半讀 `args.payload`，不是 `args.card`）
  const writeCall = /rpc\(\s*'character\.write'\s*,\s*\{([^}]*)\}/.exec(source)
  assert.match(writeCall[1], /payload\s*:/, 'character.write 要用 payload 傳卡片本體')
  // create 的名字叫 name（宿主半讀 `args.name`）
  const createCall = /rpc\(\s*'character\.create'\s*,\s*\{([^}]*)\}/.exec(source)
  assert.match(createCall[1], /name\s*:/, 'character.create 要用 name 傳名稱')

  // 設定頁要把酒館 id 傳進人物卡分區。
  //
  // ⚠️ 這一條以前是掃原始碼字串（`tavernId: activeTavern === null`）：驗的是**寫法**，
  // 所以純重構（把重複三次的算式抽成一個區域變數）就會讓它變紅，而行為其實一樣。
  // 現在改成**真的渲染一次、檢查子元件拿到的 props**——那是這一條真正想講的事。
  Object.assign(exportsObject.__testSeed, {
    loaded: true,
    taverns: [{ id: 'tv-77', name: '測試酒館', active: true, exists: true, scaffolded: true }],
    activeId: 'tv-77',
    characters: [],
    summary: { name: 'tavern', counts: {}, files: [], layout: [] },
    settings: { name: '測試酒館', note: '' },
  })
  reactImpl.resetHooks()
  exportsObject.__setZone('cast')
  const castTree = renderComponent(TavernSettingsPage, {})
  const gotId = collect(castTree, (el) => el.props !== undefined && el.props.tavernId !== undefined)
  assert.ok(gotId.length >= 1, '人物卡分區要收到 tavernId')
  assert.equal(
    gotId[0].props.tavernId,
    'tv-77',
    '傳進分區的要是**目前這間酒館的 id**，不是空字串或別間',
  )
  reactImpl.resetHooks()
  exportsObject.__setZone('hall')
  for (const key of ['taverns', 'activeId', 'characters', 'summary', 'settings']) {
    delete exportsObject.__testSeed[key]
  }

  console.log('4c. op 參數 OK — chat.create 與四個 character.* 都帶了酒館 id')
}

/* ---------- 內容變動後要重算上方統計（GUI 上看到數字不動）----------- */

{
  // 症狀：設定頁上方那排「人物卡／世界書／對話／插圖」是 `summary.counts`，
  // 只在掛載時讀一次。在下面分區開了一份新對話，清單出現了，上面還是寫「對話 0」。
  // 修法：每個「會改變檔案數量」的動作成功後都通知一次，讓訂閱者重讀 workspace。
  assert.ok(source.includes('function notifyWorkspaceChanged'), '要有「內容變了」的通知函式')
  const helper = source.slice(
    source.indexOf('function notifyWorkspaceChanged'),
    source.indexOf('function watchActiveVersion'),
  )
  assert.ok(
    helper.includes('activeChannel.bump()') && helper.includes('refreshChannel.bump()'),
    '通知兩條通道都要 bump：統計數字一條、分區清單一條',
  )

  // 逐個元件切出實作範圍，數「通知」的接線點——少一條就是有一個動作不會更新統計。
  const sliceOf = (from, to) => source.slice(source.indexOf(from), source.indexOf(to))
  const counts = {
    AssetManager: sliceOf('function AssetManager(props)', 'function MapTavernActions(props)'),
    MapWorldbooks: sliceOf('function MapWorldbooks()', 'function MapChatFiles(props)'),
    MapChatFiles: sliceOf('function MapChatFiles(props)', 'function MapOverview(props)'),
  }
  const notifyTimes = (text) => (text.match(/notifyWorkspaceChanged\(\)/g) || []).length
  assert.equal(notifyTimes(counts.AssetManager), 3, '插圖：上傳、多張上傳、刪除各要通知一次')
  assert.equal(notifyTimes(counts.MapWorldbooks), 3, '世界書：新增、刪除、匯入各要通知一次')
  assert.equal(notifyTimes(counts.MapChatFiles), 2, '對話：建立與刪除各要通知一次')
  // 人物卡分區走的是 `props.reload`，數字本來就會更新；確認它還在。
  const chars = sliceOf('function MapCharacters(props)', 'function MapSelect(props)')
  assert.ok(notifyTimes(chars) === 0 && chars.includes('props.reload()'), '人物卡分區用既有的 props.reload')
  console.log('4d. 統計更新 OK — 插圖／世界書／對話／人物卡的變動都會重算上方數字')
}

/* ---------- 檔案選擇：先複製再清 value（三個 input 都靜默失效過）----------- */

{
  // 症狀：按「＋ 加入插圖」／「📥 匯入卡片」／「📥 匯入世界書」選了檔案之後
  // 什麼都沒發生，也沒有任何錯誤——因為 `event.target.files` 是**活的** FileList，
  // `event.target.value = ''`（用來讓同一個檔案能再選一次）會就地把同一個物件清空，
  // 於是後面讀 `files.length` 得到 0，檔案從來沒被送出去。
  // （在真的 Chrome 裡量到：before=1、sameRef=true、清完 after=0。）
  const { __pickFiles } = exportsObject
  assert.equal(typeof __pickFiles, 'function', 'picker 要匯出給測試')

  const fakeEvent = {
    target: {
      value: 'C:\\fakepath\\a.json',
      files: { length: 2, 0: { name: 'a.json' }, 1: { name: 'b.json' } },
    },
  }
  const picked = __pickFiles(fakeEvent)
  // 最關鍵的一條：清 value 之後清單還是滿的。舊寫法在這裡會拿到 []。
  assert.equal(picked.length, 2, '清 value 之後檔案還是要在（先複製再清）')
  assert.deepEqual(
    picked.map((f) => f.name),
    ['a.json', 'b.json'],
    '順序與內容要原樣保留',
  )
  assert.equal(fakeEvent.target.value, '', 'value 還是要清掉，同一個檔案才能再選一次')

  // 真的用一個「清 value 就變空」的假 FileList 來驗——這才是瀏覽器的行為。
  let live = [{ name: 'x' }, { name: 'y' }]
  const liveEvent = {
    target: {
      value: 'x',
      get files() {
        return {
          get length() {
            return live.length
          },
          0: live[0],
          1: live[1],
        }
      },
      set value(next) {
        if (next === '') live = []
      },
    },
  }
  assert.equal(__pickFiles(liveEvent).length, 2, '活的 FileList 被清空也要拿得到檔案')

  // 三個 input 都要走這條路，不可以再自己寫 `event.target.files` + 清 value。
  //
  // ⚠️ 這條要**去註解之後**再比對：`pickFiles` 的說明註解裡就示範了舊的壞寫法
  // （不寫出來沒人看得懂在防什麼）。`stripComments` 是字串感知的，
  // 因為 `accept: 'image/*'` 這種字串會騙過純 regex 的版本。
  assert.equal(
    (codeSource.match(/var files = pickFiles\(event\)/g) || []).length,
    3,
    '插圖、匯入卡片、匯入世界書三個 input 都要用 pickFiles',
  )
  // 清 value 這件事只准發生在 pickFiles 裡面（那裡已經先複製過了）。
  const pickerStart = codeSource.indexOf('function pickFiles(event)')
  const pickerEnd = codeSource.indexOf('function assetFolderHint(')
  assert.ok(pickerStart > 0 && pickerEnd > pickerStart, '應該找得到 pickFiles 的實作')
  const pickerBody = codeSource.slice(pickerStart, pickerEnd)
  assert.ok(pickerBody.includes("event.target.value = ''"), 'pickFiles 自己要清 value')
  const outsidePicker = codeSource.slice(0, pickerStart) + codeSource.slice(pickerEnd)
  assert.equal(
    /event\.target\.value = ''/.test(outsidePicker),
    false,
    '不可以再有「先清 value 再讀 files」的寫法',
  )
  assert.equal(
    /event\.target\.files/.test(outsidePicker),
    false,
    '不可以再直接抓 event.target.files（那是活的 FileList）',
  )
  console.log('4e. 檔案選擇 OK — 先複製再清 value，三個 input 都不會靜默失效')
}

/* --------------------- v2 契約：不碰核心服務、不開長連線 --------------------- */

{
  assert.equal(/new EventSource|new WebSocket/.test(source), false, '瀏覽器半不應該開任何長連線')
  for (const banned of ["'get'", "'set'", 'card.preview', 'agent/request', 'systemPrompt']) {
    assert.equal(source.includes(banned), false, `不應該再呼叫 ${banned}`)
  }
  const host = readFileSync(new URL('./lib/index.js', import.meta.url), 'utf8')
  for (const banned of ['settings', 'systemPrompt', 'agents', 'agent/request', 'schemastery']) {
    assert.equal(host.includes(`'${banned}'`), false, `宿主半不應該再碰 ${banned}`)
  }
  console.log('5. v2 契約 OK — 沒有長連線，也不碰 settings／agent／systemPrompt')
}

/* --------------- 切換酒館要通知常駐面板（實測被絆到兩次）--------------- */

{
  // 症狀：側邊欄點了另一間酒館的 ⋯，主面板標題還是上一間，要自己按「重新讀取」。
  // 原因：`main` 座位一旦建立就一直掛著，切換 panel 不會卸載元件，
  // 所以 TavernSettingsPage 只在第一次掛載時讀資料。
  const { __watchActiveVersion, __bumpActiveVersion, __useActiveVersion } = exportsObject

  // 通知機制本身會動
  let hits = 0
  const off = __watchActiveVersion(() => {
    hits += 1
  })
  __bumpActiveVersion()
  __bumpActiveVersion()
  assert.equal(hits, 2, '每次切換都要通知訂閱者')
  off()
  __bumpActiveVersion()
  assert.equal(hits, 2, '取消訂閱之後不該再收到通知')
  assert.equal(typeof __useActiveVersion, 'function', 'hook 要匯出給測試')

  // ⚠️ 這裡**驗不到**真實的訂閱流程：假 React 的 `useEffect` 是空函式，
  // 所以 hook 不會真的註冊 listener。能驗的是「機制可用」與「接線正確」，
  // 真正的端到端驗證要在真瀏覽器裡做（這個 bug 就是在真瀏覽器裡發現的）。
  assert.ok(source.includes('useActiveVersion(tavern.load)'), '設定頁與對話頁都要訂閱酒館切換')
  assert.equal(
    (source.match(/useActiveVersion\(tavern\.load\)/g) || []).length,
    2,
    '設定頁與對話頁各要訂閱一次',
  )
  assert.ok(source.includes('bumpActiveVersion()'), '側邊欄切換酒館成功後要通知（在 select 裡）')

  /* ---------- 分區清單也要跟著更新（內容變了／按了重新讀取）---------- */

  // 症狀：在「世界書」新增一本，上面的統計數字變成 2，但「對話紀錄」那份清單
  // 不會知道；反過來，按「重新讀取」只重讀統計數字，已經被刪掉的世界書還列在清單上
  // （實際在 GUI 上看到）。原因是每個分區都自己快取清單，只有掛載時讀一次。
  const { __refreshChannel, __reloadEverything, __useRefreshVersion } = exportsObject
  assert.equal(typeof __refreshChannel.bump, 'function', '分區通道要能用')
  assert.equal(typeof __useRefreshVersion, 'function', '分區要有訂閱用的 hook')
  assert.equal(typeof __reloadEverything, 'function', '「重新讀取」要能一次通知全部')

  let refreshHits = 0
  const stopRefresh = __refreshChannel.watch(() => {
    refreshHits += 1
  })
  __refreshChannel.bump()
  assert.equal(refreshHits, 1, 'bump 要通知到分區')
  stopRefresh()
  __refreshChannel.bump()
  assert.equal(refreshHits, 1, '取消訂閱之後不該再收到')

  // 「內容變了」兩條通道都要 bump：統計數字與分區清單各靠一條。
  let activeHitsViaNotify = 0
  let refreshHitsViaNotify = 0
  const stopA = __watchActiveVersion(() => {
    activeHitsViaNotify += 1
  })
  const stopR = __refreshChannel.watch(() => {
    refreshHitsViaNotify += 1
  })
  exportsObject.__notifyWorkspaceChanged()
  stopA()
  stopR()
  assert.equal(activeHitsViaNotify, 1, '內容變了要讓統計數字重讀')
  assert.equal(refreshHitsViaNotify, 1, '內容變了也要讓分區清單重讀')

  // 「重新讀取」要先通知分區、再重讀自己。
  const order = []
  const stopOrder = __refreshChannel.watch(() => {
    order.push('refresh')
  })
  __reloadEverything(() => {
    order.push('load')
  })
  stopOrder()
  assert.deepEqual(order, ['refresh', 'load'], '重新讀取要通知分區之後才重讀自己')

  // 三個分區都要真的訂閱（少一個就是那個分區的清單永遠不會更新），
  // 加上對話頁自己那一條（它要靠這個發現「我正在看的對話被刪掉了」），
  // 再加上 hook 本身的宣告。
  // 這個數字包含**一行文件註解裡的提及**（`useRefreshChannelRerender` 的說明裡
  // 拿它對比）——所以是 5 個真的訂閱點 ＋ 1 行註解。
  assert.equal(
    (source.match(/useRefreshVersion\(/g) || []).length,
    6,
    '插圖、世界書、對話三個分區、對話頁自己（4）＋ hook 宣告（1）＋ 註解裡的提及（1）',
  )
  // 側邊欄訂閱「只重畫、不重讀」那一條：對話開始／結束跑時要換圖示，
  // 但不必為了一顆圖示重讀六份 `.jsonl`。
  assert.equal(
    (source.match(/useRefreshChannelRerender\(/g) || []).length,
    2,
    '側邊欄要用 useRefreshChannelRerender（宣告 ＋ 酒館街那一處）',
  )
  assert.ok(
    /function useRefreshChannelRerender\(/.test(source) && /refreshChannel\.watch\(/.test(source),
    'useRefreshChannelRerender 要真的訂閱 refreshChannel',
  )
  assert.equal(
    (source.match(/reloadEverything\(tavern\.load\)/g) || []).length,
    2,
    '設定頁與對話頁的「重新讀取」都要走 reloadEverything',
  )
  console.log('6b. 切換通知 OK — 訂閱／通知／取消訂閱機制可用，兩個面板都接上')
  console.log('6c. 分區更新 OK — 內容變動與「重新讀取」都會讓分區清單重讀')
}

/* --------------------- 設定卡片不能卡在「讀取中」 --------------------- */

{
  const card = source.slice(source.indexOf('function TavernSettingsCard'), source.indexOf('/* ---------------------------- 插件出口'))
  assert.ok(card.includes('tries < 4'), '讀取失敗要退避重試，不能只打一次')
  assert.ok(card.includes('讀取失敗'), '真的失敗時要把錯誤顯示出來')
  assert.equal(card.includes('.catch(function () {})'), false, '不可以再出現吞掉錯誤的空 catch')
  console.log('6. 設定卡片 OK — 退避重試、失敗顯示錯誤')
}

/* --------------- 對話的 session 生命週期（最容易「看起來有接」的一塊）------ */

{
  const { __chat, __setRpc } = exportsObject
  assert.equal(typeof __chat.ensure, 'function', 'session 控制器要匯出給測試')

  // ⚠️ R2：**絕對不能**把 remote.session 寫進 inject。
  //    客戶端插件的 inject 等不到服務時，DSH 的啟動核心會把整個 GUI 判成
  //    「沒掛起來」→ 白屏，不是「酒館壞掉」。
  const injectBlock = /var inject = \[[^\]]*\]/.exec(source)
  assert.ok(injectBlock !== null, '應該找得到 inject 宣告')
  assert.equal(/remote/.test(injectBlock[0]), false, 'R2：remote.* 不可以出現在 inject 陣列裡（會讓整個 GUI 白屏）')
  assert.ok(source.includes("ctxRef.get('remote.session')"), '要用 ctx.get 惰性取得')

  // 沒有 ctx / 沒有那個服務 → 回報不可用，**不是**丟錯
  __chat.setContext(null)
  assert.equal(__chat.available(), false, '沒有 ctx 時不可用')
  __chat.setContext({ get: () => undefined })
  assert.equal(__chat.available(), false, 'ctx 裡沒有那個服務時不可用')
  __chat.setContext({
    get: () => {
      throw new Error('service missing')
    },
  })
  assert.equal(__chat.available(), false, 'ctx.get 丟錯時也要回 false（R11）')

  const calls = { created: [], binds: [] }
  const fakeService = {
    create: (request) => {
      calls.created.push(request)
      return Promise.resolve({
        ok: true,
        value: { sessionId: request.sessionId === undefined ? 'session-new-0001' : request.sessionId },
      })
    },
    prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }),
    follow: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) }),
    cancel: () => Promise.resolve({ ok: true, value: { accepted: true } }),
  }
  __chat.setContext({ get: (key) => (key === 'remote.session' ? fakeService : undefined) })
  assert.equal(__chat.available(), true, '有服務時可用')

  /** 假的宿主半。 */
  const fakeRpc = (op, args) => {
    if (op === 'preset.ensure') return Promise.resolve({ created: true })
    if (op === 'session.list') return Promise.resolve(fakeRpc.bindings)
    if (op === 'session.bind') {
      calls.binds.push(args)
      return Promise.resolve({ sessionId: args.sessionId })
    }
    return Promise.reject(new Error('未預期的 op：' + op))
  }
  fakeRpc.bindings = []
  __setRpc(fakeRpc)

  // ── 沒有綁定 → 新開一個 ＋ 綁定 ──
  const opened = await __chat.ensure('tavern-1', '老闆娘', '夜晚', 'C:\\tavern')
  assert.equal(opened.created, true, '沒有綁定時要新開')
  assert.equal(opened.sessionId, 'session-new-0001')
  assert.equal(calls.created.length, 1, '要呼叫一次 session.create')
  assert.equal(calls.created[0].cwd, 'C:\\tavern', 'cwd 要指酒館資料夾（Agent 面靠它找酒館）')
  assert.equal(calls.created[0].agentPreset, 'dsh-tavern', '要指名酒館模式的 preset')
  assert.equal(calls.binds.length, 1, '要寫下對照表')
  assert.equal(calls.binds[0].character, '老闆娘')
  assert.equal(calls.binds[0].chat, '夜晚')

  // ── 已經有綁定 → 回復，不要重開（重開會讓對話紀錄斷掉）──
  fakeRpc.bindings = [{ sessionId: 'session-old-0002', character: '老闆娘', chat: '夜晚' }]
  calls.created.length = 0
  calls.binds.length = 0
  const resumed = await __chat.ensure('tavern-1', '老闆娘', '夜晚', 'C:\\tavern')
  assert.equal(resumed.created, false, '有綁定時要用回復的')
  assert.equal(resumed.sessionId, 'session-old-0002')
  assert.equal(calls.created[0].sessionId, 'session-old-0002', '要用 sessionId 回復')
  assert.equal(calls.created[0].agentPreset, undefined, '回復時不該再指名 preset')
  assert.equal(calls.binds.length, 0, '回復不該重寫對照表')

  // 綁定的是**別份**對話 → 不能誤用
  fakeRpc.bindings = [{ sessionId: 'session-other', character: '酒保', chat: '打烊後' }]
  calls.created.length = 0
  const other = await __chat.ensure('tavern-1', '老闆娘', '夜晚', 'C:\\tavern')
  assert.equal(other.created, true, '別份對話的綁定不可以拿來用')

  console.log('8. session 控制器 OK — 惰性取得、新開、回復、不誤用別份對話的綁定')
}

/* ------------------------- 送訊息與逐字串流 ------------------------------- */

{
  const { __chat, __setRpc } = exportsObject

  // frame 形狀的判讀（DSH 的 StreamChunk 只有 text-delta 是我們要的）
  assert.equal(__chat.textDeltaOf({ type: 'chunk', chunk: { type: 'text-delta', text: '嗨' } }), '嗨')
  assert.equal(__chat.textDeltaOf({ type: 'chunk', chunk: { type: 'reasoning', text: '想' } }), '', '思考不算回覆')
  assert.equal(__chat.textDeltaOf({ type: 'chunk', chunk: null }), '', '壞 chunk 回空字串')
  assert.equal(__chat.textDeltaOf({ type: 'start' }), '', 'start 沒有文字')
  assert.equal(__chat.textDeltaOf(null), '', 'null 回空字串')
  assert.equal(__chat.isCommittedEnd({ type: 'end', outcome: { kind: 'committed' } }), true)
  assert.equal(__chat.isCommittedEnd({ type: 'end', outcome: { kind: 'abandoned' } }), false, '放棄不算完成')
  assert.equal(__chat.isCommittedEnd({ type: 'chunk' }), false)
  assert.equal(__chat.isCommittedEnd(null), false)

  const frames = [
    { type: 'snapshot', records: [] },
    { type: 'assistant-stream', frame: { type: 'start' } },
    { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: '自己' } } },
    { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: '看板子。' } } },
    // 思考是 `reasoning-delta`（跟 `text-delta` 同層的 chunk 型別，DSH 原生的
    // `isTokenDelta()` 也是這樣認的）。以前這一條被整段丟掉，於是模型在想的那幾秒
    // 畫面上什麼都沒有——看起來像卡住。
    { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text: '（先想一下）' } } },
    { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text: '他問的是酒。' } } },
    // 不認識的型別依然要忽略（不要亂猜）。
    { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'tool-call-delta', name: 'x' } } },
    { type: 'assistant-stream', frame: { type: 'end', outcome: { kind: 'committed' } } },
  ]
  const prompts = []
  const service = {
    create: () => Promise.resolve({ ok: true, value: { sessionId: 's' } }),
    follow: () => {
      let index = 0
      return {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            index >= frames.length
              ? Promise.resolve({ done: true, value: undefined })
              : Promise.resolve({ done: false, value: frames[index++] }),
        }),
      }
    },
    prompt: (request) => {
      prompts.push(request)
      return Promise.resolve({ ok: true, value: { accepted: true } })
    },
    cancel: () => Promise.resolve({ ok: true, value: { accepted: true } }),
  }
  __chat.setContext({ get: () => service })
  __setRpc(() => Promise.resolve({}))

  const deltas = []
  const thoughts = []
  const result = await __chat.send('s', '今天有什麼酒？', {
    onDelta: (text) => deltas.push(text),
    onReasoning: (text) => thoughts.push(text),
  })
  assert.equal(result.text, '自己看板子。', '要接起所有文字增量（思考不可以混進正文）')
  assert.deepEqual(deltas, ['自己', '看板子。'], '串流的每一段都要即時回報（逐字顯示用）')
  assert.deepEqual(thoughts, ['（先想一下）', '他問的是酒。'], '思考要即時回報（思考列的流動效果靠它）')
  assert.equal(result.reasoning, '（先想一下）他問的是酒。', '思考要一起回傳（呼叫端要寫進 .jsonl 的 extra）')
  assert.equal(prompts.length, 1, '只送一次')
  assert.equal(prompts[0].sessionId, 's')
  assert.equal(prompts[0].mode, 'queue', '排隊模式')
  assert.equal(prompts[0].content[0].type, 'text')
  assert.equal(prompts[0].content[0].text, '今天有什麼酒？')
  assert.equal(typeof prompts[0].requestId, 'string', '要有 requestId（DSH 用它去重複）')
  assert.ok(prompts[0].requestId.startsWith('tavern-'), 'requestId 要看得出來源')

  // 送不出去 → 明確的錯誤訊息（不是靜默什麼都不做）
  __chat.setContext({
    get: () => ({
      ...service,
      prompt: () => Promise.resolve({ ok: false, error: { code: 'gateway/cancelled', message: '被取消了' } }),
    }),
  })
  await assert.rejects(() => __chat.send('s', '喂', {}), /送出訊息失敗：被取消了/, 'ok:false 要變成可行動的錯誤')

  // 沒有服務 → 拒絕並說清楚（而不是丟一個 undefined 的 TypeError）
  __chat.setContext(null)
  await assert.rejects(() => __chat.send('s', '喂', {}), /沒有對話服務/, '沒有服務時要說清楚')
  await assert.rejects(() => __chat.ensure('t', 'c', 'x', 'C:\\t'), /沒有對話服務/, 'ensure 也一樣')

  console.log('9. 送訊息 OK — 逐字串流、requestId、失敗時有可行動的訊息')
}

/* ------------------- 思考列（reasoning）：DSH 也有那一列 ------------------- */

{
  // 使用者：「思考的時候應該是有些圖標的，我看 dsh 也有」。沒錯——DSH 原生的
  // 回覆前面有一列「思考」（`IconThinkOutline14` ＋ 可折疊 ＋ 串流時流動的高光），
  // 而酒館以前把 `reasoning-delta` **整段丟掉**，所以模型在想的那幾秒畫面上
  // 什麼都沒有，看起來像卡住。
  const { __chat } = exportsObject
  const { reasoningDeltaOf } = __chat
  assert.equal(typeof reasoningDeltaOf, 'function', '要有 reasoningDeltaOf（思考的來源）')

  // 只認 reasoning-delta，其他一律不認（不認識的東西不要亂猜）。
  // ⚠️ 參數是**內層** frame（`frame.frame`），不是 `assistant-stream` 外層——
  // 跟 `textDeltaOf` 同一個約定（第一版傳錯層級，直接失配）。
  const inner = (chunk) => ({ type: 'chunk', chunk: chunk })
  assert.equal(reasoningDeltaOf(inner({ type: 'reasoning-delta', text: '想一下' })), '想一下')
  assert.equal(reasoningDeltaOf(inner({ type: 'text-delta', text: '正文' })), '', '正文不是思考')
  assert.equal(reasoningDeltaOf(inner({ type: 'reasoning', text: '舊形狀' })), '', '不認得的型別不要猜')
  assert.equal(reasoningDeltaOf(inner({ type: 'tool-call-delta', name: 'x' })), '')
  assert.equal(reasoningDeltaOf(inner({ type: 'reasoning-delta' })), '', '沒有 text 欄位時回空字串')
  assert.equal(reasoningDeltaOf(null), '', 'null 不炸')
  assert.equal(reasoningDeltaOf({ type: 'snapshot' }), '', '不是 chunk frame 也不炸')

  // 串流時思考要**即時**回報（思考列的流動效果靠它），而且不混進正文
  const frames = [
    { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'reasoning-delta', text: '（想）' } } },
    { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: '答案' } } },
    { type: 'assistant-stream', frame: { type: 'end', outcome: { kind: 'committed' } } },
  ]
  __chat.setContext({
    get: () => ({
      follow: () => {
        let index = 0
        return {
          [Symbol.asyncIterator]: () => ({
            next: () =>
              index >= frames.length
                ? Promise.resolve({ done: true, value: undefined })
                : Promise.resolve({ done: false, value: frames[index++] }),
          }),
        }
      },
      prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }),
      create: () => Promise.resolve({ ok: true, value: { sessionId: 's' } }),
      cancel: () => Promise.resolve({ ok: true, value: { accepted: true } }),
    }),
  })
  exportsObject.__setRpc(() => Promise.resolve({}))
  const order = []
  const sent = await __chat.send('s', '喂', {
    onReasoning: () => order.push('think'),
    onDelta: () => order.push('text'),
  })
  assert.deepEqual(order, ['think', 'text'], '思考要在正文之前出現（原生的順序）')
  assert.equal(sent.reasoning, '（想）', '思考要跟著結果回傳，才能寫進 .jsonl')
  assert.equal(sent.text, '答案', '正文不受影響')

  // ── 真的把那一列渲染出來（不是只驗回呼）──
  {
    reactImpl.resetHooks()
    const { ThinkingRow } = exportsObject.__components
    assert.equal(typeof ThinkingRow, 'function', 'ThinkingRow 要匯出（這一條驗的就是畫面）')

    // 收合：標題「思考」＋一段預覽（原生 `collapsedContent` 的做法——讓使用者知道
    // 它真的在想，而不是卡住）。串流中預設展開。
    const running = flatten(renderComponent(ThinkingRow, { text: '他問的是酒。\n先看庫存。', running: true }))
    assert.ok(running.includes('思考'), '要有「思考」這個標籤（跟 DSH 同一組字）')
    assert.ok(running.includes('先看庫存'), '串流中要顯示內容（不然看起來像卡住）')

    // ⚠️ 每次要驗「另一個實例」之前都要 `resetHooks()`——假的 React 讓同一個元件
    // 的 `useRef` 在同段測試裡沿用，不歸零就會拿到上一段的展開狀態（實際踩到）。
    reactImpl.resetHooks()
    const collapsed = renderComponent(ThinkingRow, { text: '他問的是酒。\n先看庫存。', running: false })
    const text = flatten(collapsed)
    assert.ok(text.includes('思考'), '收合時也要看得到「思考」')
    assert.ok(text.includes('他問的是酒。'), '收合時顯示一小段預覽')

    // 有圖示（使用者：「思考的時候應該是有些圖標的」）＋可以展開
    const icon = collect(collapsed, (el) => el.type === 'svg')
    assert.ok(icon.length >= 1, '思考列要有一顆圖示（原生的 IconThinkOutline14）')

    reactImpl.resetHooks()
    const toggle = collect(collapsed, (el) => el.props.role === 'button')[0]
    assert.ok(toggle !== undefined, '整列要可以點（原生 expandOnRowClick）')
    assert.equal(toggle.props['aria-expanded'], 'false', '預設收合')
    // 「點一下會展開」的**狀態轉移**在假的 React 下測不穩（它不會因為 setState 重繪，
    // 而我們要靠「再渲染一次」去觀察那個 useRef 的變化——中間只要有任何一次
    // `collect`/`flatten` 走進元件就會多跑一次、把狀態攪亂）。
    // 所以這裡驗**可靠的部分**：整列接得上、預設收合、展開後的全貌長什麼樣。
    // 真實的點擊行為照 §7.4b 的規矩在瀏覽器裡走一遍。
    reactImpl.resetHooks()
    const expanded = flatten(renderComponent(ThinkingRow, { text: '他問的是酒。\n先看庫存。', running: false }))
    assert.ok(expanded.includes('思考'), '展開後仍要有「思考」標籤')
    const toggle2 = collect(
      renderComponent(ThinkingRow, { text: '他問的是酒。\n先看庫存。', running: false }),
      (el) => el.props.role === 'button',
    )[0]
    assert.equal(typeof toggle2.props.onClick, 'function', '整列要接得上點擊（原生 expandOnRowClick）')
    assert.equal(typeof toggle2.props.onKeyDown, 'function', '鍵盤也要能操作')

    // ⚠️ **「進行中」的動畫在側邊欄那一列**（使用者：「check Room 外面的列表…
    // 運作中的時候會換一個思考中的圖表的動圖」）。原型是 DSH 的 `StatusDot`：
    // 八顆 2×2 方格繞一圈，用負的 `animation-delay`（-1000ms 起、每顆 +125ms）
    // 讓同一條動畫依序跑過每一顆。
    reactImpl.resetHooks()
    // 這一顆指示器本身（側邊欄那一列在「進行中」時用它）。
    // ThinkingRow 現在只畫靜態燈泡，所以要另外驗它——它是模組層級的一部分，
    // 而側邊欄那一列的選擇邏輯（`chatIsRunning` → `RunningDot`）在下面的區塊驗。
    reactImpl.resetHooks()
    const probe = renderComponent(ThinkingRow, { text: '想一下', running: false })
    assert.equal(
      collect(probe, (el) => el.type === 'svg' && el.props.viewBox === '0 0 10 10').length,
      0,
      '思考列是靜態燈泡（跑馬燈改放在側邊欄那一列）',
    )
    assert.ok(
      /var RUNNING_RING = \[/.test(source) && /function RunningDot\(/.test(source),
      '要有 RunningDot 這個「進行中」指示器',
    )
    assert.match(
      source,
      /function RunningDot\([\s\S]{0,900}?shapeRendering: 'crispEdges'/,
      'RunningDot 要用 crispEdges（原生的方格才不會糊掉）',
    )

    reactImpl.resetHooks()
  }

  // ── 側邊欄那一列的「進行中」指示器 ──────────────────────────────
  //
  // 使用者要的是**包廂列表**（側邊欄）那一列的圖示：運作中時換成動畫。
  // 判定用我們自己知道的那件事——對話頁送出訊息到收到結果之間就是「進行中」
  // （我們拿不到 DSH 的 `session.running`，`session.list` 只回文字綁定）。
  {
    const { chatIsRunning, setChatRunning } = __chat
    assert.equal(typeof chatIsRunning, 'function', '要有「這份對話在跑嗎」的判定')
    assert.equal(chatIsRunning('老闆娘', '夜晚'), false, '一開始沒有東西在跑')

    let bumped = 0
    const stop = exportsObject.__refreshChannel.watch(() => {
      bumped += 1
    })
    setChatRunning('老闆娘', '夜晚', true)
    assert.equal(chatIsRunning('老闆娘', '夜晚'), true, '送出之後那一份就是「進行中」')
    assert.equal(chatIsRunning('老闆娘', '白天'), false, '別的對話不受影響（key 是 角色/對話名）')
    assert.equal(bumped, 1, '狀態變了要通知側邊欄重畫')
    setChatRunning('老闆娘', '夜晚', false)
    assert.equal(chatIsRunning('老闆娘', '夜晚'), false, '收到結果就結束')
    assert.equal(bumped, 2, '結束也要通知（否則圖示會一直轉）')
    stop()

    // 側邊欄那一段真的用這個判定來選圖示（原始碼層級的契約）
    assert.ok(
      /chatIsRunning\(chat\.character, chat\.name\) === true/.test(source) &&
        /return React\.createElement\(RunningDot\)/.test(source),
      '側邊欄那一列要在「進行中」時改用 RunningDot',
    )
  }

  /* ---------- 對話頁的分頁（使用者：「進階設定就像大廳一樣，用分頁來完成」）---------- */

  {
    // ⚠️ 這一段**不需要**訊息載入：分頁列跟分頁內容都不依赖 `chat.loaded`，
    // 所以它是訊息列那條路徑以外、唯一進得去的對話頁斷言。
    exportsObject.__selectChat({ character: '老闆娘', name: '夜晚', file: '夜晚.jsonl' })
    reactImpl.resetHooks()
    const renderChat = () => renderComponent(TavernChatPage, {})

    const tabs = collect(
      renderChat(),
      (el) => el.type === 'button' && String(el.props.className || '').indexOf('dsh-tv-zone') === 0,
    )
    assert.deepEqual(
      tabs.map((one) => one.props.children),
      ['💬 對話', '🖼️ 插圖', '📄 檔案'],
      '對話頁要有三個分頁（跟四個分區同一組樣式）',
    )
    assert.match(tabs[0].props.className, /dsh-tv-zoneOn/, '預設要停在「對話」')

    // 一次只畫一個分頁——這是「分頁」的定義，不是實作細節。
    const onChat = flatten(renderChat())
    assert.ok(onChat.includes('送出'), '對話分頁要有輸入與送出')
    assert.equal(onChat.includes('加入插圖'), false, '對話分頁不該同時畫插圖管理器')

    exportsObject.__setChatTab('art')
    const onArt = flatten(renderChat())
    assert.ok(onArt.includes('加入插圖'), '插圖分頁要有插圖管理器')
    assert.equal(onArt.includes('送出'), false, '插圖分頁不該還有輸入框')

    exportsObject.__setChatTab('file')
    const onFile = flatten(renderChat())
    assert.ok(onFile.includes('chats/老闆娘/夜晚.jsonl'), '檔案分頁要看得到對話檔的路徑')
    assert.equal(onFile.includes('加入插圖'), false, '檔案分頁不該有插圖管理器')

    exportsObject.__setChatTab('chat')
    exportsObject.__selectChat(null)
    reactImpl.resetHooks()
    console.log('14c. 對話頁分頁 OK — 三個分頁、一次只畫一個、預設停在對話')
  }

  /* ---------- 匯出：瀏覽器半自己接 `ccv3` 區塊 ---------- */

  {
    // 宿主半的讀取端。放在這裡動態 import，才不用動檔案開頭的匯入區。
    const hostPngcard = await import('./lib/pngcard.js')
    const api = exportsObject.__exportCard
    assert.equal(typeof api, 'object', '匯出用的純函式要匯出給測試')

    // 1. V3 信封：規格裡寫死 MUST 的欄位要補齊。
    const wrapped = api.v3Card({ name: '甲', first_mes: '嗨' })
    assert.equal(wrapped.spec, 'chara_card_v3')
    assert.equal(wrapped.spec_version, '3.0')
    assert.deepEqual(wrapped.data.group_only_greetings, [], 'V3 的 group_only_greetings 不可以缺')
    assert.equal(wrapped.data.assets[0].uri, 'ccdefault:', '沒有插圖時要用規格給的預設值')
    assert.equal(wrapped.data.name, '甲', '原欄位要原樣帶過去')

    // 2. **跨面契約**：客戶端的寫入端產生的位元組，交給宿主半的讀取端讀。
    //    兩邊各自實作 base64／CRC／chunk 佈局，只有全部正確才會一致——
    //    這一條比對字串有意義得多。
    const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const be32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
    const chunkOf = (type, data) => [
      ...be32(data.length),
      ...[...type].map((one) => one.charCodeAt(0)),
      ...data,
      0, 0, 0, 0, // CRC：讀取端刻意不驗它（別人的卡不該因為一個 CRC 就讀不了）
    ]
    const tiny = new Uint8Array([
      ...SIGNATURE,
      ...chunkOf('IHDR', new Array(13).fill(0)),
      ...chunkOf('IDAT', [1, 2, 3, 4]),
      ...chunkOf('IEND', []),
    ])
    const png = api.spliceCardChunk(tiny, wrapped, 'ccv3')
    assert.ok(png.length > tiny.length, '匯出應該比原圖大（多了卡片資料）')

    const back = hostPngcard.readCardFromPng(Buffer.from(png))
    assert.equal(back.keyword, 'ccv3', '區塊要能被宿主半的讀取端認出來（關鍵字與位置都對）')
    assert.equal(back.card.spec, 'chara_card_v3')
    assert.equal(back.card.data.name, '甲')
    assert.equal(back.card.data.first_mes, '嗨')
    // 像素資料不能被動到。
    assert.ok(
      Buffer.from(png).includes(Buffer.from(chunkOf('IDAT', [1, 2, 3, 4]))),
      'IDAT 要原封不動（接區塊，不是重新編碼）',
    )

    // 3. 壞檔要講清楚，不要靜靜地產生一個壞 PNG。
    assert.throws(
      () => api.spliceCardChunk(new Uint8Array(SIGNATURE), wrapped, 'ccv3'),
      /IEND/,
      '找不到 IEND 要丟錯',
    )

    console.log('14d. 匯出 OK — V3 信封補齊必填欄位、ccv3 區塊寫得進去也讀得回來、IDAT 沒被動')
  }

  __chat.setContext(null)
  console.log('14. 思考列 OK — reasoning-delta 即時回報、順序在正文之前、元件真的畫得出來')
}

/* --------- 沒有 extensions 的卡片不可以讓整個設定頁消失（GUI 實測踩到）------- */

{
  // 症狀：在人物卡清單點任何一張卡 → **整個設定頁變成一格空白**，沒有錯誤訊息。
  // 原因：`cardAssets` 用 `card.extensions !== null` 當守衛，而
  //       `undefined !== null` 是 **true** → 接著讀 `.regex_scripts` 丟錯
  //       → React 渲染期崩潰 → 座位被退位（abdicate）。
  //       那一格只留下 `<div data-slot-error="main"></div>`，訊息藏在
  //       `window.__dshTavern.entryErrors` 裡——所以它會裝成「面板不見了」。
  //
  // 真實世界的卡（包含我們自己 `defaults.js` 產的那一張）**大多沒有 extensions**，
  // 所以這不是邊角情況，是「卡片編輯器完全不能用」。
  const { __cardAssets } = exportsObject
  assert.equal(typeof __cardAssets, 'function', 'cardAssets 要匯出給測試')

  const bare = { name: '沒有 extensions 的卡', description: '…', first_mes: '嗨' }
  const summary = __cardAssets(bare)
  assert.deepEqual(summary, { bookEntries: 0, bookName: '', scripts: 0 }, '沒有 extensions 的卡要算得出來')

  // 明確的 undefined / null 也要安全（`readCharacter` 讀不到時會給 null）
  assert.equal(__cardAssets({ extensions: undefined }).scripts, 0, 'extensions: undefined 不可以丟錯')
  assert.equal(__cardAssets({ extensions: null }).scripts, 0, 'extensions: null 不可以丟錯')
  assert.equal(__cardAssets({ extensions: 'x' }).scripts, 0, 'extensions 是字串也不可以丟錯')
  assert.equal(__cardAssets(null).scripts, 0, '整張卡是 null 也不可以丟錯')
  assert.equal(__cardAssets(undefined).scripts, 0, '整張卡是 undefined 也不可以丟錯')

  // 有 extensions 的時候還是要算對
  const withScripts = { extensions: { regex_scripts: [{}, {}] } }
  assert.equal(__cardAssets(withScripts).scripts, 2, '有 regex_scripts 要算得出數量')
  assert.equal(__cardAssets({ extensions: { regex_scripts: 'x' } }).scripts, 0, '不是陣列就當 0')

  // 內嵌世界書的兩種形狀都要算
  assert.equal(__cardAssets({ character_book: { entries: [{}, {}] } }).bookEntries, 2, 'V2 陣列形狀')
  assert.equal(__cardAssets({ character_book: { entries: { a: {}, b: {} } } }).bookEntries, 2, '原生物件形狀')
  assert.equal(__cardAssets({ character_book: { name: '書名' } }).bookName, '書名', '要有書名')

  // 這一型的守衛錯誤不准再出現（`x !== null && x.prop` 對 undefined 是 true）。
  // ⚠️ 要比對**去註解之後**的原始碼——上面那段解釋這個 bug 的註解裡就引用了舊寫法。
  assert.equal(
    /card\.extensions !== null/.test(stripComments(source)),
    false,
    '不可以再用 `card.extensions !== null` 當守衛（undefined 會過關，然後丟錯）',
  )
  console.log('10. 卡片資產 OK — 沒有 extensions 的卡不再讓整個設定頁消失')
}

/* ------------------------------ 插圖 UI ------------------------------ */

{
  const { AssetManager } = exportsObject.__components
  const boxes = collect(AssetManager({ kind: 'character', owner: '老闆娘' }), () => true)
  const text = flatten(AssetManager({ kind: 'character', owner: '老闆娘' }))
  assert.ok(text.includes('這個角色的插圖'), '要顯示這個掛載點的標題：' + text.slice(0, 60))
  assert.ok(text.includes('加入插圖'), '要有加入插圖的按鈕')
  assert.ok(text.includes('art/characters/老闆娘/'), '要告訴使用者圖放在哪個資料夾')
  // 上傳走二進位路由：不能是 base64 JSON，也不能打已退役的 /files 路由。
  // op 名稱必須是字面字串，smoke.mjs 的跨半契約檢查才掃得到。
  assert.ok(source.includes("'assets.write'"), '上傳要打 assets.write')
  assert.ok(source.includes("'character.import'"), '匯入卡片要打 character.import')
  assert.equal(source.includes('/api/dsh-tavern/files'), false, '舊的 files 路由已經退役，不該再被引用')
  assert.equal(/JSON\.stringify\((file|blob)/.test(source), false, '圖片不應該被轉成 JSON 字串')
  // 匯入卡片要真的接到 UI 上，不然功能等於不存在。
  assert.ok(source.includes('匯入卡片'), '人物卡分區要有匯入按鈕')
  // 這一條釘住一個實測到的 bug：openSettings 曾把整個酒館物件傳給 select()，
  // RPC 收到物件就回「沒有這間酒館：[object Object]」。
  // ⚠️ 比對要用「真的呼叫」而不是註解——第一版寫成檢查字串 `select(tavernById(id))`
  // 不存在，結果被我自己解釋這個 bug 的註解（裡面就寫著那串）誤判成失敗。
  const openSettingsBody = source.slice(
    source.indexOf('function openSettings'),
    source.indexOf('/** ＋ → 新對話'),
  )
  assert.ok(openSettingsBody.length > 0, '應該找得到 openSettings 的實作')
  assert.equal(
    /return\s+select\(\s*id\s*\)/.test(openSettingsBody),
    true,
    'openSettings 要直接把 id 傳給 select()',
  )
  assert.equal(
    /select\(\s*tavernById/.test(openSettingsBody),
    false,
    '不可以再把 tavernById() 的結果（物件）傳進 select()',
  )
  assert.equal(/function tavernById/.test(source), false, 'tavernById 已經沒有用途，不該留著')
  // 這個掛載點要有拖放區，才不用先開檔案選單。
  assert.ok(
    boxes.some((el) => typeof el.props.className === 'string' && el.props.className.includes('dsh-tv-drop')),
    '要有拖放區',
  )
  console.log('7. 插圖 UI OK — 標題、加入按鈕、二進位上傳、拖放區')
}

/* ------------------- 主題框架（每間酒館自己的 theme.json） ------------------- */

{
  // 使用者要的是「可以自訂的框架，能動態注入、放在酒館資料夾下」。所以：
  //   - client 半持有一份 **token 契約**（`DEFAULT_THEME_TOKENS`）
  //   - token 層是**獨立的一個 <style>**，換主題只換那一層
  //   - `theme.read` 從那間酒館資料夾讀 `theme.json`
  //   - 宿主半的 `lib/theme.js` 是同一份契約的權威版本
  const { themeTokensCss, applyTheme, currentTheme, setThemeTokens, themeTokens } = exportsObject.__chat
  const themeModule = await import('./lib/theme.js')

  // ⚠️ **預設色票只有一個來源**（`lib/theme.js`）。客戶端 bundle 拿不到 ESM import，
  // 所以宿主在 `theme.read` 的回應裡附上完整的 `defaults`——client 不再自己抄一份
  // （第一版抄了，改色票時兩邊立刻走散，測試直接紅）。
  // 客戶端在「還沒從宿主讀到主題」之前要有一份最小值撐著，不然第一次開啟時
  // 所有 var(--dsh-tv-*) 都是空的、畫面會是全裸的 HTML。
  const { FALLBACK_THEME_TOKENS } = exportsObject.__chat
  assert.equal(
    FALLBACK_THEME_TOKENS.accent,
    themeModule.tokenDefault('accent', 'dark'),
    'fallback 的強調色要跟 lib/theme.js 的深色預設一致',
  )
  // 色票是研究**實算過對比**的那一組（WCAG 相對亮度公式），不是隨手挑的：
  // accent 8.8:1、text-1 15.4:1、text-2 9.2:1、text-3 5.7:1（全部 ≥ 4.5:1）。
  assert.equal(FALLBACK_THEME_TOKENS.accent, '#E8A33D', '強調色＝燭火琥珀（8.8:1）')
  assert.equal(FALLBACK_THEME_TOKENS['text-1'], '#F3E6D2', '主要文字是奶油白，不是純白')
  assert.equal(FALLBACK_THEME_TOKENS['surface-0'], '#14100D', '底色是暖棕，不是純黑')
  assert.equal(
    Object.keys(FALLBACK_THEME_TOKENS).length,
    themeModule.TOKEN_NAMES.length,
    'fallback 要涵蓋全部 token（少一個就會有 var() 是空的）',
  )

  const darkDefaults = themeModule.fullTokens('dark')
  const lightDefaults = themeModule.fullTokens('light')
  assert.ok(Object.keys(darkDefaults).length >= 20, '預設表要有完整的 token 數')
  assert.equal(darkDefaults.accent, '#E8A33D', '預設強調色是燭火琥珀（實算 8.78:1）')
  assert.equal(lightDefaults.accent, '#b0701f', '淺色基底的強調色要不一樣')

  // 元件只准用 token 取色：**元件樣式**不該再有寫死的 hex 或宿主的 --dsw-* 顏色
  const mapCss = codeSource.slice(
    codeSource.indexOf('var MAP_CSS = ['),
    codeSource.indexOf("].join('')", codeSource.indexOf('var MAP_CSS = [')),
  )
  assert.ok(mapCss.length > 1000, '應該切得出 MAP_CSS 的範圍')
  // ⚠️ 寫死的 hex 只**不准出現在主面板區**。側邊欄那一區的宿主變數**需要** fallback
  // （`var(--dsw-alias-label-secondary,#9aa4b2)`）——那是深色主題的保底值，
  // 而側邊欄的規矩本來就是「跟宿主一致」。
  // 主面板區的規矩相反：全部走 `--dsh-tv-*`，這樣 `theme.json` 才換得動。
  const sidebarPrefixes = [
    '.dsh-tv-street', '.dsh-tv-section', '.dsh-tv-iconBtn', '.dsh-tv-region',
    '.dsh-tv-row', '.dsh-tv-slot', '.dsh-tv-folder', '.dsh-tv-chevron',
    '.dsh-tv-projectText', '.dsh-tv-chatRow', '.dsh-tv-chatOn', '.dsh-tv-chatMenuOpen',
    '.dsh-tv-actions', '.dsh-tv-miniBtn', '.dsh-tv-emptyRow', '.dsh-tv-sideErr',
    '.dsh-tv-sideManual', '.dsh-tv-sideInput', '.dsh-tv-overflow', '.dsh-tv-divider',
    '.dsh-tv-cardName', '.dsh-tv-cardDesc', '.dsh-tv-tavernDot', '.dsh-tv-tavernName',
    '.dsh-tv-spin', '.dsh-tv-face', '.dsh-tv-count', '.dsh-tv-rename', '.dsh-tv-menu',
  ]
  let inSide = false
  const mainHex = []
  for (const line of mapCss.split('\n')) {
    const t = line.trim()
    if (t.startsWith("'.")) {
      const brace = t.indexOf('{')
      inSide = sidebarPrefixes.some((one) => t.slice(1, brace > 0 ? brace : 1).startsWith(one))
    }
    if (inSide === false) {
      const hits = line.match(/#[0-9a-fA-F]{3,8}\b/g)
      if (hits !== null) mainHex.push(...hits)
    }
  }
  assert.deepEqual(
    [...new Set(mainHex)],
    [],
    '主面板不該有寫死的顏色（一律走 var(--dsh-tv-*)）：' + [...new Set(mainHex)].join(', '),
  )

  // 圓角只能有四階（改版前有 7 種不一致的值）；兩個例外是圓形與那道光的微圓角
  const radiusAllow = ['border-radius:50%', 'border-radius:3px']
  const radius = [...new Set(codeSource.match(/border-radius:[^;'"]+/g) || [])].filter(
    (one) => one.includes('var(--dsh-tv-radius') === false && radiusAllow.includes(one) === false,
  )
  assert.deepEqual(radius, [], '圓角只能走 var(--dsh-tv-radius-*)：' + radius.join(', '))

  // 套用：宿主送來的預設 ＋ 這間酒館的覆寫
  applyTheme(null, darkDefaults, lightDefaults)
  assert.equal(themeTokens().accent, '#E8A33D', '沒有覆寫時用預設')
  applyTheme({ base: 'dark', tokens: { accent: '#00ff00', 亂寫: 'x' } }, darkDefaults, lightDefaults)
  assert.equal(themeTokens().accent, '#00ff00', '覆寫要生效')
  assert.equal(themeTokens()['亂寫'], undefined, '不認得的 token 要丟掉')
  const css = themeTokensCss()
  assert.ok(css.includes('--dsh-tv-accent: #00ff00'), '產生的 CSS 要含覆寫值')
  assert.equal(css.includes('亂寫'), false, '不認得的 token 不該進 CSS')
  applyTheme({ base: 'light', tokens: {} }, darkDefaults, lightDefaults)
  assert.equal(themeTokens().accent, '#b0701f', '淺色基底要換掉強調色')
  assert.equal(themeTokens()['surface-0'], '#f5f6fa', '淺色基底要換掉底色')
  applyTheme(null, darkDefaults, lightDefaults)

  /* --- `style.bubble` 與 `custom.css`（2.6.0 的「裝修」）--------------------- */

  // 列舉的驗證在 `lib/theme.js`：**打錯字要回報，不是默默用預設**。
  assert.deepEqual(
    themeModule.normalizeTheme(null).style,
    { bubble: 'bubble' },
    '沒有 style 時要有一組預設',
  )
  assert.deepEqual(
    themeModule.normalizeTheme({ style: { bubble: 'paper' } }).style,
    { bubble: 'paper' },
    '合法的值要留下來',
  )
  const badStyle = themeModule.normalizeTheme({ style: { bubble: 'buble' } })
  assert.deepEqual(badStyle.style, { bubble: 'bubble' }, '打錯的值要落回預設')
  assert.ok(badStyle.dropped.includes('style.bubble'), '打錯的值要回報（不然使用者不知道沒生效）')
  assert.ok(
    themeModule.normalizeTheme({ style: { 亂寫: 'x' } }).dropped.includes('style.亂寫'),
    '不認得的 style key 也要回報',
  )

  // 四種樣式都要有一組完整的變數——少一個就會有 `var()` 是空的。
  const styleNames = Object.keys(exportsObject.__chat.BUBBLE_STYLE_VARS)
  assert.deepEqual(styleNames.sort(), ['bubble', 'paper', 'plain', 'tail'], '四種樣式')
  const varNames = Object.keys(exportsObject.__chat.BUBBLE_STYLE_VARS.bubble).sort()
  for (const name of styleNames) {
    assert.deepEqual(
      Object.keys(exportsObject.__chat.BUBBLE_STYLE_VARS[name]).sort(),
      varNames,
      `${name} 的變數要跟其他樣式一樣多（不然會有一項是空的）`,
    )
  }

  // 選了樣式 → 那一層 CSS 真的跟著換（**不必**在畫面上掛任何 class）。
  applyTheme({ base: 'dark', tokens: {}, style: { bubble: 'plain' } }, darkDefaults, lightDefaults)
  assert.equal(exportsObject.__chat.currentStyle().bubble, 'plain', '目前樣式要記下來')
  assert.ok(
    themeTokensCss().includes('--dsh-tv-bubble-bg: transparent'),
    'plain：氣泡底色要變透明',
  )
  applyTheme({ base: 'dark', tokens: {}, style: { bubble: 'tail' } }, darkDefaults, lightDefaults)
  assert.ok(themeTokensCss().includes('--dsh-tv-bubble-tail: block'), 'tail：尾巴要打開')
  applyTheme(null, darkDefaults, lightDefaults)
  assert.ok(
    themeTokensCss().includes('--dsh-tv-bubble-tail: none'),
    '沒有 style 時要落回預設（尾巴關著）',
  )
  assert.ok(
    themeTokensCss().includes('--dsh-tv-surface-2'),
    '預設樣式要沿用 token，不是寫死顏色',
  )

  // `custom.css`：**一定要包 `@scope`**，不然使用者的 `* {…}` 會污染整個宿主
  // （SillyTavern 的前例，`design-language.md` §0）。
  const scopeCss = exportsObject.__chat.scopeCustomCss
  assert.equal(scopeCss(''), '', '沒有 custom.css 時不要注入一個空的 @scope 區塊')
  assert.equal(scopeCss(null), '', 'null 也要能接受')
  const wrapped = scopeCss('  .dsh-tv-bubble { border-radius: 0 }  ')
  assert.ok(
    wrapped.startsWith('@scope (.dsh-tv-view) {'),
    '一定要包 @scope (.dsh-tv-view)——不然它碰得到宿主的 DOM',
  )
  assert.ok(wrapped.includes('.dsh-tv-bubble { border-radius: 0 }'), '內容原樣保留（只去頭尾空白）')
  assert.ok(wrapped.trimEnd().endsWith('}'), '區塊要收好')
  // 研究報告的三組色票之所以能直接抄，就是因為每個值都算過。
  // 以後有人調色票，這裡會直接紅——不會靜默變成「深字壓深底」。
  {
    const hex = (h) => {
      const raw = String(h).replace('#', '')
      return [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16))
    }
    const lum = (h) => {
      const [r, g, b] = hex(h).map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
      return (x + 0.05) / (y + 0.05)
    }
    const dark = themeModule.fullTokens('dark')
    const bg = dark['surface-0']
    // 文字：一般文字 ≥ 4.5:1（WCAG 2.2 AA）
    for (const name of ['text-1', 'text-2', 'text-3']) {
      assert.ok(ratio(dark[name], bg) >= 4.5, `${name} 對底色要 ≥ 4.5:1（實際 ${ratio(dark[name], bg).toFixed(2)}）`)
    }
    // 強調與狀態色也都當文字用 → 一樣要 ≥ 4.5:1
    for (const name of ['accent', 'accent-hover', 'danger', 'warn', 'ok', 'info', 'live']) {
      assert.ok(ratio(dark[name], bg) >= 4.5, `${name} 對底色要 ≥ 4.5:1（實際 ${ratio(dark[name], bg).toFixed(2)}）`)
    }
    // 填入式按鈕：**深色字壓在強調色上**（白字只有 2.16:1，是錯的）
    assert.ok(ratio(bg, dark.accent) >= 4.5, '按鈕文字（用底色）壓在強調色上要 ≥ 4.5:1')
    assert.ok(ratio('#ffffff', dark.accent) < 4.5, '白字壓在強調色上不合格——這一條是防止有人改成白字')
    // 不要純黑底、不要純白字（三個主流系統的共識）
    assert.notEqual(dark['surface-0'], '#000000', '底色不要純黑')
    assert.notEqual(dark['text-1'], '#ffffff', '主要文字不要純白（近黑上會 shimmer）')
    // 表面階梯要分得出來（相鄰層亮度差要有感）
    const steps = ['surface-0', 'surface-1', 'surface-2', 'surface-3'].map((n) => lum(dark[n]))
    for (let i = 1; i < steps.length; i += 1) {
      assert.ok(steps[i] > steps[i - 1], `表面階梯要愈浮愈亮（${i}）`)
    }
  }

  // ── 敘事體排版：四種文字的分類（契約 §6）──
  {
    const { splitNarration } = exportsObject.__chat
    assert.equal(typeof splitNarration, 'function', '要有行分類器')

    const sample = [
      '她把手上的杯子放下。',        // 敘事
      '「今天想喝什麼？」',          // 台詞
      '（她沒有抬頭。）',            // 動作
      '',                            // 空行
      '＊外面開始下雨了。',          // 敘事（`*` 不猜，留給正則腳本）
    ].join('\n')
    const lines = splitNarration(sample)
    assert.deepEqual(
      lines.map((one) => one.kind),
      ['narration', 'speech', 'action', 'narration', 'narration'],
      '行分類：引號＝台詞、括號＝動作、其餘＝敘事',
    )
    assert.equal(lines[1].text, '「今天想喝什麼？」', '原文要原樣保留（不改字）')
    assert.deepEqual(splitNarration(''), [], '空字串回空陣列')
    assert.deepEqual(splitNarration(null), [], 'null 不炸')
    // 全形與半形括號都要認
    assert.equal(splitNarration('(half width)')[0].kind, 'action', '半形括號也算動作')

    // ⛔ 中文沒有斜體：`:root` 要禁止瀏覽器偽造（合成斜體是人工傾斜 14°，方塊字會變形）
    assert.match(source, /font-synthesis:none/, '要關掉合成斜體／粗體')
    // 四種樣式都要有對應的 class
    for (const kind of ['narration', 'speech', 'action', 'thought']) {
      assert.ok(source.includes(".dsh-tv-" + kind + "{"), `要有 .dsh-tv-${kind} 的樣式`)
    }
    // 敘事體：中文行距要寬鬆、行長用 em（`ch` 量不了中文）
    assert.match(source, /line-height:1\.9/, '敘事正文的中文行距要用 1.8–2.0')
    assert.match(source, /max-width:34em/, '中文行長用 em（≈30–40 字），不要用 ch')
    assert.equal(
      /max-width:7[05]ch/.test(source),
      false,
      '不要用 ch 量中文行長（`ch` 是「0」的寬度）',
    )
    // 泡泡不可以是飽和色（Character.AI 的無障礙實證）。
    //
    // ⚠️ 2.6.0 之後氣泡的顏色是 `style.bubble` 推導出來的變數（`--dsh-tv-bubble-bg`），
    // 所以 CSS 的字面只是 `var(…, fallback)`——**要看的是每一組樣式的實際值**，
    // 不然這條斷言只驗到「有寫 var」，驗不到「用的是低彩度色」。
    const bubbleVars = exportsObject.__chat.BUBBLE_STYLE_VARS
    const lowChroma = (value) =>
      value === 'transparent' || /var\(--dsh-tv-(surface-[0-3]|accent-soft)\)/.test(value)
    for (const name of Object.keys(bubbleVars)) {
      for (const key of ['bubble-bg', 'bubble-me-bg']) {
        const value = bubbleVars[name][key]
        assert.ok(
          lowChroma(value),
          `${name}.${key} 要用表面階梯或極淡的 accent-soft（低彩度），不要飽和填色——實際是 ${value}`,
        )
        assert.equal(
          /#[0-9a-fA-F]{3,8}/.test(value),
          false,
          `${name}.${key} 不可以寫死 hex（theme.json 才換得動）`,
        )
      }
    }
    // 還沒讀到主題之前跑的是 CSS 的 fallback，那一個也必須是低彩度的。
    assert.match(
      source,
      /\.dsh-tv-bubble\{[^}]*var\(--dsh-tv-surface-2\)/,
      '泡泡底色的 fallback 也要是表面階梯（第一次開啟時不能是飽和色）',
    )
    console.log('16. 敘事體排版 OK — 四種文字分類、關掉合成斜體、中文行距與行長')
  }

  console.log('15. 主題框架 OK — token 契約兩邊一致、只准用 token 取色、覆寫與淺色基底都生效')
}

/* --------------------- 刪除對話的入口（plan.md §7.6） --------------------- */

{
  /**
   * 症狀：`chat.delete` 這個 op 在 2.5.0 就做好了（宿主半有、`smoke.mjs` 第 14 項也驗過），
   * 但**畫面上沒有入口**——開了一份對話就永遠刪不掉，只能去檔案總管手動刪檔。
   * `docs/plan.md` §7.6 因此把它列為「UI 階段的第一件事」。
   *
   * 這一條釘住入口本身。最要緊的是**送出的參數**：這一頁踩過兩次同型的坑
   * （`chat.create` 少了 `id` 會被當成角色 id、卡片編輯器四個動作全送錯），
   * 而刪除送錯參數的後果只是「回一句找不到」，使用者會以為是刪不掉。
   *
   * 誠實說明這一條驗到哪裡：`state.chats` 在離線測試裡永遠是空的
   * （清單是非同步載入的，假 React 的 useEffect 不會跑），所以**「列真的畫出來、
   * 按了真的刪掉」只能在真的瀏覽器裡驗**——`plan.md` §7.4b 已經記過這個教訓。
   * 這裡驗的是：確認列、參數、狀態而已。
   */
  const { TavernSettingsPage } = exportsObject.__components
  const { __setRpc } = exportsObject

  const chatCall = /rpc\(\s*'chat\.delete'\s*,\s*\{([^}]*)\}/
  const call = chatCall.exec(codeSource)
  assert.ok(call !== null, '對話分區要有 chat.delete 的呼叫點')
  assert.match(call[1], /\bid\s*:/, 'chat.delete 要帶酒館 id（少了會拿角色去找酒館）')
  assert.match(call[1], /character\s*:/, 'chat.delete 要帶角色 id')
  assert.match(call[1], /chat\s*:/, 'chat.delete 要帶對話名')

  const mapStart = codeSource.indexOf('function MapChatFiles(props)')
  const mapEnd = codeSource.indexOf('function MapOverview(props)')
  assert.ok(mapStart > 0 && mapEnd > mapStart, '應該切得出 MapChatFiles 的實作範圍')
  const mapBody = codeSource.slice(mapStart, mapEnd)
  // 確認列的宣告在列的**前面**（確認列要先能畫，列才引用得到它）。
  const delStart = mapBody.indexOf('function renderDeleteRow(chat)')
  const rowStart = mapBody.indexOf('function renderChatRow(chat)')
  assert.ok(delStart > 0 && rowStart > delStart, '應該切得出確認列與列')
  const delBody = mapBody.slice(delStart, rowStart)
  const rowBody = mapBody.slice(rowStart, mapBody.length)

  // 列上的那一顆**不可以直接刪**：它只能把那一列標成待確認。
  assert.equal(
    /chat\.delete|remove\(chat\)/.test(rowBody),
    false,
    '列上的刪除鈕不可以直接刪——要先展開確認列',
  )
  assert.ok(/pendingDelete/.test(rowBody), '刪除鈕要先把那一列標成待確認')
  // 確認列上的那一顆才是真的刪。
  assert.ok(/remove\(chat\)/.test(delBody), '確認列上的「確定刪除」才呼叫 remove')
  assert.ok(/確定要刪掉/.test(delBody), '確認列要講清楚會發生什麼事')
  // 這個 repo 從來沒有用過對話框（側邊欄在最底部，彈窗會被裁掉）。
  assert.equal(/\bwindow\.confirm\b/.test(codeSource), false, '不要用 window.confirm 當確認')

  // 入口要畫得出來：刪除鈕住在「💬 包廂」那一區。
  //
  // ⚠️ 這裡**要真的餵一間酒館**。舊版直接渲染並斷言文字含「對話紀錄」，但當時
  // 畫面只畫了「還沒有選定酒館」，而那段說明文字本身就有「對話紀錄」——
  // 斷言一直是綠的，卻什麼都沒驗到（同型的問題見 4f）。
  Object.assign(exportsObject.__testSeed, {
    loaded: true,
    taverns: [{ id: 'tv-1', name: '測試酒館', active: true, exists: true, scaffolded: true, icon: '🍺' }],
    activeId: 'tv-1',
    characters: [],
    summary: { name: 'tavern', counts: {}, files: [], layout: [] },
    settings: { name: '測試酒館', note: '' },
  })
  reactImpl.resetHooks()
  exportsObject.__setZone('rooms')
  assert.ok(
    flatten(renderComponent(TavernSettingsPage, {})).includes('新對話'),
    '💬 包廂是開新對話的地方',
  )

  // 真的碰一次那顆按鈕：確認它接上了 onClick，而且**按一下不會送出 chat.delete**。
  const sent = []
  __setRpc((op, args) => {
    sent.push({ op, args })
    return Promise.resolve(op === 'chat.list' ? [] : {})
  })
  const buttons = collect(
    renderComponent(TavernSettingsPage, {}),
    (el) => el.type === 'button' && el.props.title === '刪除這份對話',
  )
  // 清單是非同步載入的，而假 React 的 `useEffect` 不會跑，所以列在離線測試裡
  // 永遠是空的（`plan.md` §7.6）。這裡驗的是「空清單不會畫出刪除鈕、也不會送 op」。
  assert.equal(buttons.length, 0, '沒有對話時不該畫出刪除鈕')
  assert.equal(sent.filter((one) => one.op === 'chat.delete').length, 0, '渲染不該送出 chat.delete')

  // 還原：後面的段落不該拿到這裡的種子與分區。
  reactImpl.resetHooks()
  exportsObject.__setZone('hall')
  for (const key of ['taverns', 'activeId', 'characters', 'summary', 'settings']) {
    delete exportsObject.__testSeed[key]
  }
  console.log('11. 刪除對話 OK — 二段確認、chat.delete 的三個參數、沒有對話框')
}

/* ------------------------------ 逐個元件試渲染 ------------------------------ */

let failures = 0
for (const record of injections) {
  const label = `${record.options.name}:${record.options.id ?? record.options.key ?? '(single)'}`
  try {
    const props = record.options.name === 'sidebar.workspaces' ? { wide: true, renderSlot: () => null } : {}
    // ⚠️ 一定要在這裡歸零／宣告「現在跑的是這個元件」：這一行是**直接呼叫**
    // 元件函式，沒有它的話元件會拿到上一段測試留下的 hook 槽——症狀是
    // 「某個面板讀到別的元件的狀態」而在渲染期丟錯（實際踩過：
    // `MapOverview` 的 `props.characters` 變成 undefined）。
    reactImpl.resetHooks()
    const element = renderComponent(record.component, props)
    assert.ok(element !== null && element !== undefined, '回傳了空值')
    const text = flatten(element)
    assert.ok(text.trim().length > 0, '渲染出來是空的')
    console.log(`   ✅ ${label} — 文字 ${text.trim().length} 字`)
  } catch (error) {
    failures += 1
    console.log(`   ❌ ${label}：${String(error && error.message ? error.message : error)}`)
  }
}
assert.equal(failures, 0, '所有元件都要渲染得出來')

console.log('\n全部通過 ✅')
