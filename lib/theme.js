/**
 * dsh-tavern — 主題（design tokens）
 *
 * 這個模組**只做兩件事**，兩邊都是純函式，好測：
 *
 *   1. 定義**一份 token 契約**：整個介面只准用這些名字取顏色、圓角、間距、字級、
 *      動效。元件不再自己挑色（改版前有 129 處寫死的顏色、7 種不一致的圓角
 *      ——那正是「膠水感」的來源）。
 *   2. 把一份主題（token → 值）變成 CSS 字串，客戶端半把它注入 `<style>`。
 *
 * **一間酒館＝一個資料夾**，所以主題也住在酒館裡：`<酒館>/theme.json`。
 * 整包帶走的時候外觀跟著走；換酒館就換主題。沒有那個檔案就用內建預設。
 *
 * 這個檔案**不准 import 任何 `@deepseek-ai/*`**（零執行期依賴是硬規則，見 README），
 * 所以它只有純資料與純函式。
 *
 * @module dsh-tavern/theme
 */

/**
 * Token 契約。
 *
 * 每一項：`{ group, label, hint, dark, light }`。
 * - `dark` / `light` 是兩種內建基底（使用者的主題只要覆寫想改的那幾項，
 *   其餘繼承基底）。
 * - `label` / `hint` 是給設定頁畫「主題編輯器」用的（之後的 UI）。
 *
 * 命名規則（照 DSH 自己的 alias 風格，但用我們自己的前綴 `--dsh-tv-`）：
 *
 *   surface-0/1/2   底色三階（0 最底、2 最浮）
 *   line / line-soft 邊框（強／弱）
 *   text-1/2/3      文字三階（1 最主要、3 最弱）
 *   accent          強調色（重要動作、選中）
 *   accent-soft     強調色的淡底（選中列、標籤底）
 *   live            進行中（模型在跑）
 *   danger / warn / ok  狀態
 *   radius-sm/md/lg/pill 圓角四階（不要再有第 5 種值）
 *   shadow-1/2      陰影兩階
 *   speed-fast/slow 動效時長
 *   font / font-mono 字體堆疊
 */
export const THEME_TOKENS = {
  /* ---- 底色三階（深墨為底）---- */
  'surface-0': { group: '底色', label: '底色（最底）', dark: '#14100D', light: '#f5f6fa' },
  'surface-1': { group: '底色', label: '卡片', dark: '#1B1611', light: '#ffffff' },
  'surface-2': { group: '底色', label: '浮起（選單、輸入框）', dark: '#241C16', light: '#eceff6' },
  'surface-3': { group: '底色', label: '最浮（模態、選中卡）', dark: '#2E241C', light: '#e2e6ef' },

  /* ---- 邊框 ---- */
  hover: {
    group: '底色',
    label: '互動底（hover、選中列）',
    dark: '#221B15',
    light: '#e8ebf2',
  },
  line: { group: '邊框', label: '邊框', dark: '#3A2E25', light: '#dce1ec' },
  'line-soft': { group: '邊框', label: '邊框（淡）', dark: '#2A211A', light: '#e8ebf3' },

  /* ---- 文字三階 ---- */
  'text-1': { group: '文字', label: '主要文字', dark: '#F3E6D2', light: '#1a1f2b' },
  'text-2': { group: '文字', label: '次要文字', dark: '#C6B199', light: '#59617a' },
  'text-3': { group: '文字', label: '最弱（說明、時間）', dark: '#9C8A74', light: '#878fa4' },

  /* ---- 強調（燈籠暖光）---- */
  accent: { group: '強調', label: '強調色（唯一）', dark: '#E8A33D', light: '#b0701f' },
  'accent-hover': { group: '強調', label: '強調色（hover）', dark: '#F5BC63', light: '#c9852c' },
  'accent-soft': {
    group: '強調',
    label: '強調色的淡底',
    dark: 'rgba(232,163,61,.14)',
    light: 'rgba(176,112,31,.13)',
  },

  /* ---- 狀態 ---- */
  live: { group: '狀態', label: '進行中', dark: '#E8A33D', light: '#b0701f' },
  info: { group: '狀態', label: '中性提示', dark: '#7FA8C9', light: '#3f6c8f' },
  glow: { group: '狀態', label: '環境光（立繪光池、邊光）', dark: '#D98A2B', light: '#d98a2b' },
  danger: { group: '狀態', label: '危險／刪除', dark: '#D96C5F', light: '#bf3b36' },
  warn: { group: '狀態', label: '警告', dark: '#E5B25D', light: '#997015' },
  ok: { group: '狀態', label: '成功', dark: '#7FB069', light: '#2c8350' },

  /* ---- 圓角（四階，不准再有第 5 種）---- */
  // 四階是**乘數關係**（sm = md×.75、lg = md×1.25），不是四個各自獨立的數字
  // ——這樣改一個基準，整組跟著動（研究報告 §5 的 shadcn 作法）。
  'radius-sm': { group: '圓角', label: '小（標籤、按鈕）', dark: '6px', light: '6px' },
  'radius-md': { group: '圓角', label: '中（列表、輸入框）', dark: '8px', light: '8px' },
  'radius-lg': { group: '圓角', label: '大（卡片、面板）', dark: '10px', light: '10px' },
  'radius-pill': { group: '圓角', label: '膠囊', dark: '999px', light: '999px' },

  /* ---- 陰影 ---- */
  'shadow-1': {
    group: '陰影',
    label: '一階（卡片）',
    dark: '0 1px 2px rgba(0,0,0,.35)',
    light: '0 1px 2px rgba(23,32,64,.06)',
  },
  'shadow-2': {
    group: '陰影',
    label: '二階（浮起、選單）',
    dark: '0 12px 32px rgba(0,0,0,.45)',
    light: '0 12px 32px rgba(23,32,64,.14)',
  },

  /* ---- 動效 ---- */
  'speed-fast': { group: '動效', label: '快（hover）', dark: '120ms', light: '120ms' },
  'speed-slow': { group: '動效', label: '慢（進場）', dark: '220ms', light: '220ms' },
  ease: {
    group: '動效',
    label: '緩動曲線',
    dark: 'cubic-bezier(.2,.8,.2,1)',
    light: 'cubic-bezier(.2,.8,.2,1)',
  },

  /* ---- 字體 ---- */
  font: {
    group: '字體',
    label: '介面字體',
    dark: '-apple-system,"Segoe UI","PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif',
    light: '-apple-system,"Segoe UI","PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif',
  },
  'font-reading': {
    group: '字體',
    label: '敘事正文（**這是「讀小說」與「讀聊天」的分界**）',
    dark: '"Iowan Old Style","Source Serif 4","Songti TC","Noto Serif TC",Georgia,serif',
    light: '"Iowan Old Style","Source Serif 4","Songti TC","Noto Serif TC",Georgia,serif',
  },
  'font-mono': {
    group: '字體',
    label: '等寬（JSON、路徑）',
    dark: 'ui-monospace,SFMono-Regular,Consolas,monospace',
    light: 'ui-monospace,SFMono-Regular,Consolas,monospace',
  },
}

/** token 名字的完整清單（`--dsh-tv-` 之後的部分）。 */
export const TOKEN_NAMES = Object.keys(THEME_TOKENS)

/** 基底名稱。 */
export const THEME_BASES = ['dark', 'light']

/** 酒館資料夾裡的主題檔名。 */
export const THEME_FILE = 'theme.json'

/** 酒館資料夾裡的自訂樣式檔名（「裝修」的逃生口，見 `readCustomCss`）。 */
export const CUSTOM_CSS_FILE = 'custom.css'

/**
 * 新建酒館時附上的 `custom.css` **範本**（`workspace.seed()` 會寫進去）。
 *
 * 為什麼要附這一張：這一層是「token 改不到的形狀」唯一的出口，但它**不會自己出現**
 * ——使用者得先知道有這個檔案才用得下去（只寫在 README 裡等於藏起來）。附一份
 * **整份註解掉**的範本，代價是零（沒有任何一條生效的規則）而功能看得見。
 *
 * ⚠️ 範本裡的每一行都必須留在註解裡：`workspace` 的測試會檢查
 * 「拿掉註解之後沒有剩下任何規則」，所以**不要把範例寫成生效的 CSS**。
 */
export const CUSTOM_CSS_TEMPLATE = `/*
 * <酒館資料夾>/custom.css —— 這間酒館的裝修（進階）
 *
 * 什麼時候用這一層：theme.json 的 token 改得到的，就用 token 改；改不到的才寫這裡。
 * 它排在元件樣式**後面**才注入，所以蓋得過去。
 *
 * ⚠️ 三個規矩要知道：
 *   1. 它會被包在 @scope (.dsh-tv-view) 裡——所以它碰不到 DSH 自己的介面
 *      （SillyTavern 的 \`* { text-shadow }\` 污染整個宿主是前例）。
 *      也因為如此，選擇器直接寫 .dsh-tv-xxx 就好，不要再加 .dsh-tv-view 前綴。
 *   2. 存檔之後要**重新載入頁面**：同一間酒館不會自動重讀。
 *   3. 這一份預設**全部是註解**——沒拿掉開頭的 * 之前，它不會改動任何東西。
 *
 * 常用到的類別（想改哪裡就挑那一個寫）：
 *   .dsh-tv-view          酒館介面的最外層（主面板與側邊欄各一個）
 *   .dsh-tv-bubble        對話氣泡        .dsh-tv-bubbleText   正文
 *   .dsh-tv-msg           一則訊息（頭像 ＋ 氣泡）            .dsh-tv-avatar  頭像
 *   .dsh-tv-bubbleWho     發話者名牌      .dsh-tv-thought      思考那一列
 *   .dsh-tv-chatInput     輸入框那張卡    .dsh-tv-send         送出鍵
 *   .dsh-tv-attachBtn     附件鈕（📎）    .dsh-tv-attachChip   待送的附件
 *   .dsh-tv-modelChip     模型 chip       .dsh-tv-modelPanel   模型選單
 *   .dsh-tv-modelRoot／.dsh-tv-modelCell／.dsh-tv-modelItem   選單的兩層
 *   .dsh-tv-usagePill     下面那排統計    .dsh-tv-usageRing     上下文環
 *   .dsh-tv-zone／.dsh-tv-zoneOn          分區分頁（大廳／包廂／卡司／藏書／設定）
 *
 * 下面是幾個例子，全部註解掉了，要用就把開頭的 * 拿掉：
 *
 * 氣泡不要邊框、圓角大一點
 * .dsh-tv-bubble { border: 0; border-radius: 14px }
 *
 * 角色名牌加字距（⚠️ 只對英文好看，中文不要加字距）
 * .dsh-tv-bubbleWho { letter-spacing: .08em }
 *
 * 正文再大一點
 * .dsh-tv-bubbleText { font-size: 17px }
 *
 * 選中的分區改成整塊底色
 * .dsh-tv-zoneOn { background: var(--dsh-tv-accent-soft) }
 *
 * 整個酒館介面換一張背景圖
 * .dsh-tv-view { background-image: url("./bg.png"); background-size: cover }
 */
`

/**
 * 對話框樣式（`style.bubble`）。
 *
 * ⚠️ 這一層是**形狀**，不是數值——token 改不動它（token 只能換顏色、圓角、
 * 陰影、字體），所以另外開一個列舉。要加第五種就在這裡加，並在客戶端補一條
 * `.dsh-tv-bubbleStyle-<name>` 的規則。
 *
 *   - `bubble`：預設。圓角氣泡，兩邊分左右。
 *   - `plain` ：沒有氣泡。只有名牌與正文，像小說排版（長篇閱讀最舒服）。
 *   - `tail`  ：氣泡帶一個指向發話者的尾巴。
 *   - `paper` ：紙張感。米色底、細邊框、內縮陰影。
 */
export const BUBBLE_STYLES = ['bubble', 'plain', 'tail', 'paper']

/**
 * 每一個 `style.*` 的容許值、預設、顯示名稱。
 *
 * 驗證、文件、之後的設定頁都從這一張表長出來——**不要再另外抄一份清單**。
 */
export const THEME_STYLE_KEYS = {
  bubble: { values: BUBBLE_STYLES, default: 'bubble', label: '對話框樣式' },
}

/** 一份主題的預設 `style`（每個 key 都取它的預設值）。 */
export function styleDefaults() {
  const out = {}
  for (const key of Object.keys(THEME_STYLE_KEYS)) out[key] = THEME_STYLE_KEYS[key].default
  return out
}

/**
 * 一個 token 的預設值。
 *
 * @param name - token 名（不含 `--dsh-tv-`）。
 * @param base - `'dark'` 或 `'light'`。
 * @returns 值；不認得的 token 回 `undefined`。
 */
export function tokenDefault(name, base) {
  const spec = THEME_TOKENS[name]
  if (spec === undefined) return undefined
  return base === 'light' ? spec.light : spec.dark
}

/**
 * 驗證／正規化一份主題覆寫。
 *
 * **不認識的 token 一律丟掉**（不回錯誤）：主題檔是使用者手改的，
 * 多留一個打錯的 key 不該讓整個主題失效。但「完全不是物件」要報錯，
 * 因為那代表檔案壞了、使用者需要知道。
 *
 * @param patch - 使用者提供的覆寫（`{ base?, tokens?, style? }`）。
 * @returns `{ base, tokens, dropped, style }`；`dropped` 是被丟掉的 key（給 UI 顯示）。
 */
export function normalizeTheme(patch) {
  if (patch === null || patch === undefined) {
    return { base: 'dark', tokens: {}, dropped: [], style: styleDefaults() }
  }
  if (typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('主題必須是一個物件（{ "base": "dark", "tokens": { … } }）')
  }
  const base = THEME_BASES.includes(patch.base) ? patch.base : 'dark'
  const raw = patch.tokens !== null && typeof patch.tokens === 'object' && !Array.isArray(patch.tokens) ? patch.tokens : {}
  const tokens = {}
  const dropped = []
  for (const key of Object.keys(raw)) {
    if (THEME_TOKENS[key] === undefined) {
      dropped.push(key)
      continue
    }
    const value = raw[key]
    if (typeof value !== 'string' || value.trim() === '') {
      dropped.push(key)
      continue
    }
    tokens[key] = value.trim()
  }
  // `style` 是列舉，不是自由值：打錯（`"buble"`）等於沒生效，所以要像 token
  // 一樣**回報**它被丟掉了，而不是默默用預設。
  const rawStyle =
    patch.style !== null && typeof patch.style === 'object' && !Array.isArray(patch.style) ? patch.style : {}
  const style = styleDefaults()
  for (const key of Object.keys(THEME_STYLE_KEYS)) {
    const spec = THEME_STYLE_KEYS[key]
    if (rawStyle[key] === undefined) continue
    if (typeof rawStyle[key] !== 'string' || spec.values.includes(rawStyle[key]) === false) {
      dropped.push('style.' + key)
      continue
    }
    style[key] = rawStyle[key]
  }
  for (const key of Object.keys(rawStyle)) {
    if (THEME_STYLE_KEYS[key] === undefined) dropped.push('style.' + key)
  }
  return { base, tokens, dropped, style }
}

/**
 * 一份主題 → CSS 字串（只含 `:root` 的變數宣告，沒有元件樣式）。
 *
 * 用法：客戶端半把這一串注入一個 `<style>`，並把它排在元件樣式**前面**
 * （元件樣式只引用 `var(--dsh-tv-*)`，不再自己帶 fallback 顏色）。
 *
 * @param theme - `normalizeTheme()` 的回傳值，或 `undefined`（用預設）。
 * @param scope - 選擇器，預設 `:root`。要限定在某個容器時可以傳 `.dsh-tv-root`。
 * @returns CSS 字串。
 */
export function themeToCss(theme, scope) {
  const clean = theme === undefined ? { base: 'dark', tokens: {} } : theme
  const at = scope === undefined || scope === null || scope === '' ? ':root' : scope
  const lines = []
  for (const name of TOKEN_NAMES) {
    const value = clean.tokens[name] !== undefined ? clean.tokens[name] : tokenDefault(name, clean.base)
    if (value === undefined) continue
    lines.push(`  --dsh-tv-${name}: ${value};`)
  }
  return `${at} {\n${lines.join('\n')}\n}\n`
}

/**
 * 一份主題的「有效值」表（含基底、覆寫、最後的結果）。
 *
 * 給設定頁的主題編輯器用：它要顯示每一項現在的值、以及哪幾項是使用者改過的。
 *
 * @param theme - `normalizeTheme()` 的回傳值。
 * @returns `[{ name, group, label, value, overridden }]`。
 */
export function themeTable(theme) {
  const clean = theme === undefined ? { base: 'dark', tokens: {} } : theme
  return TOKEN_NAMES.map((name) => {
    const spec = THEME_TOKENS[name]
    const overridden = clean.tokens[name] !== undefined
    return {
      name,
      group: spec.group,
      label: spec.label,
      value: overridden ? clean.tokens[name] : tokenDefault(name, clean.base),
      overridden,
    }
  })
}

/** 內建主題（之後的設定頁會列出來給使用者挑；現在先只有這兩組基底）。 */
export const BUILTIN_THEMES = [
  {
    id: 'lantern',
    name: '燈籠夜（暖）',
    description: '深墨為底、燈籠暖光當強調色：極簡的骨架、酒館的靈魂。',
    base: 'dark',
    tokens: {},
  },
  {
    id: 'daylight',
    name: '天光（冷）',
    description: '淺色底，白天或投影時用。',
    base: 'light',
    tokens: {},
  },
]

/**
 * 一份基底的**完整** token 表（所有 token 都有值）。
 *
 * 這是給客戶端半用的：bundle 沒有 ESM import，沒辦法叫它 `import` 這一支，
 * 所以由宿主在 `theme.read` 的回應裡附上這一份——**預設值只有這一個來源**，
 * 不會有兩份走散的問題。
 *
 * @param base - `'dark'` 或 `'light'`。
 * @returns `{ 'surface-0': '#0e1014', … }`。
 */
export function fullTokens(base) {
  const out = {}
  for (const name of TOKEN_NAMES) out[name] = tokenDefault(name, base)
  return out
}

export default {
  THEME_TOKENS,
  TOKEN_NAMES,
  THEME_BASES,
  THEME_FILE,
  BUILTIN_THEMES,
  tokenDefault,
  fullTokens,
  normalizeTheme,
  themeToCss,
  themeTable,
}
