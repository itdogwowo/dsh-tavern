/**
 * 一間酒館 = 使用者選的一個資料夾。
 *
 * 這個檔案只做兩件事：
 *   1. 在資料夾裡建立／維護固定的結構（人物卡、世界書、對話、立繪、設定檔）
 *   2. 讀寫那些檔案（純檔案 I/O，沒有任何模型、提示詞或正則的邏輯）
 *
 * 刻意保持「笨」：所有東西都是磁碟上的真檔案，使用者可以直接備份、手改、
 * 丟進 SillyTavern 或其他工具。
 */
import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { atomicWrite, createExclusive, createUnique, isExistsError } from './write.js'
import {
  DEFAULT_CHARACTER_ID,
  DEFAULT_WORLDBOOK_ID,
  FORMAT_WORLDBOOK_ID,
  defaultCharacter,
  defaultFormatWorldbook,
  defaultWorldbook,
} from './defaults.js'
import { CUSTOM_CSS_FILE, CUSTOM_CSS_TEMPLATE, THEME_FILE, normalizeTheme } from './theme.js'
import { RENDER_FILE, formatSpecEntries, normalizeRender } from './render.js'
import { WORLDBOOK_POSITIONS, applyBookOverride, normalizePosition, positionOf } from './worldbook.js'
import {
  SAMPLER_KEYS,
  maxTokensProblem,
  normalizeMaxTokens,
  normalizeStop,
  normalizeTemperature,
  stopProblem,
  temperatureProblem,
} from './samplers.js'
import {
  ASSETS_FIELD,
  assetIdFor,
  normalizeAssetId,
  parseAssetOwner,
  makeAssetIdResolver,
  nextPrimaryMap,
  readPrimaryMap,
  describeAssets,
  writeAsset,
  cardAssetName,
  cardUrl,
} from './assets.js'
import { isPng, readCardFromPng, replaceCardInPng } from './pngcard.js'
import { ROOM_FILES_DIR, normalizeMediaList } from './roomfiles.js'

/** 一間酒館的固定子資料夾。 */
export const SUBDIRS = ['characters', 'worldbooks', 'chats', 'art']

/**
 * 一張人物卡的兩種形式，**順序就是優先序**。
 *
 *   - `json`：酒館自己的格式（純文字、可 diff、沒有圖的卡用它，例如「＋ 新增角色」）
 *   - `png` ：**PNG 卡**——SillyTavern 的交換格式，**提示詞住在 `ccv3` 區塊裡**，
 *             而圖本身就是這張卡的立繪。使用者把卡丟進 `characters/` 就會出現。
 *
 * 兩個同名檔案都存在時 `.json` 優先（那是酒館自己編的那一份）。
 */
export const CARD_EXTENSIONS = ['json', 'png']

/** 酒館自己的設定檔（存在酒館資料夾裡，跟著資料夾走）。 */
export const SETTINGS_FILE = 'tavern.json'

/* ---------------------- 房間：一間房＝一個資料夾 ---------------------- */
//
// 佈局（`docs/room-layout.md`）：
//   chats/<角色>/<roomId>/room.json    這間房的設定（人看得懂、可以手改）
//   chats/<角色>/<roomId>/chat.jsonl   對話本身（SillyTavern 格式，一行一則）
//   chats/<角色>/<roomId>/art/         這間房的插圖（跟著房間走）

/** 房間的設定檔。 */
export const ROOM_FILE = 'room.json'

/** 房間的對話檔。名字沿用舊格式的檔名，別的工具一眼認得出。 */
export const CHAT_FILE = 'chat.jsonl'

/**
 * 房間可以選的工具等級。`inherit`＝沿用酒館那一層（**預設**）。
 *
 * 這一格之所以適合放房間：`tools.restrict()` 本來就是 **per-agent＝per-session**
 * 的，所以「這一間房只給唯讀、那一間房全開」正是機制上最自然的粒度。
 */
export const ROOM_TOOL_LEVELS = ['inherit', 'none', 'read', 'write', 'web', 'all']

/**
 * 一間房的設定預設值。
 *
 * `allowTools: 'inherit'` 而不是 `'none'`：房間的預設是**聽酒館的**，
 * 而酒館的預設是 `none`（全關）——所以「什麼都沒設」＝全關，跟以前一樣。
 */
export function defaultRoom(name) {
  return {
    version: 1,
    name: typeof name === 'string' ? name : '',
    roomPrompt: '',
    model: '',
    reasoningEffort: '',
    allowTools: 'inherit',
    // `null` ＝ 聽酒館的（＝不碰 DSH 的決定）。見 `lib/samplers.js`。
    temperature: null,
    maxTokens: null,
    // 同上，`null` ＝ 聽酒館的。⚠️ 不是空陣列（見 `readSettings` 的說明）。
    stop: null,
    // `null` ＝ 聽酒館的；`false` ＝ 這一間**明確關掉**（蓋過酒館的「開」）。
    stopEnabled: null,
    /**
     * 世界書的注入位置（**這一間房的**）。
     *
     * ⚠️ `null` ＝ 聽酒館的（那是房間的預設值）——所以既有房間的行為不變。
     * 值是 `WORLDBOOK_POSITIONS` 之一時蓋過酒館那一層；而每一本書自己的
     * `position` 再蓋過它（由窄到寬：書 → 房 → 酒館）。
     */
    worldbookPosition: null,
    /**
     * 這一間房對**個別世界書**的覆寫（2.6.64）。
     *
     * ⚠️ 形狀 `{ "<書的 id>": { enabled, position } }`，**沒列到的書照酒館那一層**
     * ——所以既有房間（沒有這個鍵）的行為完全不變。
     * ⚠️ 它只調「這一場要不要用這本書、把它放在哪」——**書的內容一個字都不會被改**
     * （那是使用者的 ST 檔；「房間的微調」不該動到書本身）。
     */
    worldbookOverrides: {},
    createdAt: nowIso(),
  }
}

/**
 * 對話 ↔ DSH session 的對照表放這裡：`.sessions/<sessionId>.json`。
 *
 * **為什麼要有一份對照表**：一場真的對話是 DSH 的 session 在跑的，而酒館這邊
 * 只有一個 `.jsonl`。兩邊要接起來，必須有人記得「這個 session 是哪個角色的哪份對話」。
 *
 * **為什麼放酒館資料夾而不是 DSH 的家目錄**：酒館的規矩是「一間酒館＝一個資料夾，
 * 帶走就好」。把綁定放在外面，資料夾就會在別的機器上「忘記自己是誰」。
 *
 * **這不是第二份真相**：它只是索引，內容全部可以由 `chats/` 的標頭重建
 * （見 `rebuildSessionBindings`）。刪掉它只會失去「哪個 session 接哪份對話」，
 * 對話本身一個字都不會少。
 */
export const SESSIONS_DIR = '.sessions'

/**
 * sessionId 會直接變成檔名，所以只收安全字元。
 *
 * DSH 產生的 id 長得像 `session-8e6ef1b9-b52f-47f3-8f60-c92f1f575e74`
 * （也可能是 `0af5b548-…` 這種子代理 id）。這裡刻意**不接受**路徑分隔符、
 * 開頭是點、或空字串——任何一個都會讓對照表跑到資料夾外面。
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

/** 進資料夾時附上的說明（讓「這是一包真檔案」這件事一眼看得出來）。 */
export const README_FILE = 'README.txt'

const README_TEXT = `這是 DSH 酒館模式的一間酒館（一個普通資料夾）。

  characters/   人物卡：.json（酒館格式）或 .png（PNG 卡——提示詞住在圖裡面，
                而那張圖同時是這張卡的立繪）。丟一張 ST 的卡進來就會出現。
  worldbooks/   世界書：一個 .json 一本
  chats/        對話紀錄：一間房＝一個資料夾
                  chats/<角色>/<房間 id>/room.json    這間房自己的設定
                  chats/<角色>/<房間 id>/chat.jsonl   對話本身（SillyTavern 格式）
                  chats/<角色>/<房間 id>/art/         這間房的插圖
                  chats/<角色>/<房間 id>/files/       訊息裡夾帶的附件
                  ⚠️ 資料夾名是**房間 id**（身分），改名只動 room.json 裡的 name。
  art/          插圖：一項一個資料夾，可以放很多張（表情圖、動作圖）
                  art/characters/<卡 id>/*.png
                  art/worldbooks/<書 id>/*.png
                  art/tavern/*.png ← 酒館自己的店面／背景圖
  tavern.json   這間酒館自己的設定（名稱、備註、你是誰、哪一張是主圖）

裝修（外觀也可以整組換掉，改完重新載入頁面）：

  theme.json    顏色、圓角、陰影、字體、對話框樣式（token）
  custom.css    上面改不到的形狀與材質（背景圖、動畫…）——範本已經放在這裡，
                全部註解掉了，要用就把開頭的 * 拿掉

每個檔案都是普通的文字檔或圖片檔，可以直接編輯、備份、傳給別人。
插圖直接丟進對應的資料夾就會出現在面板上，不用改任何設定檔。
DSH 只是幫你把這個資料夾的內容顯示出來。
`

/** 路徑片段白名單：不合法一律拒絕，不偷偷改名。 */
const SAFE_SEGMENT = /^[\w\u4e00-\u9fff.-]+$/

/**
 * 驗證呼叫端明確指定的 id／檔名片段。
 * @throws 不合法時丟錯（呼叫端會把它顯示給使用者）。
 */
export function requireId(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} 不可為空`)
  const trimmed = value.trim()
  if (trimmed === '.' || trimmed === '..' || !SAFE_SEGMENT.test(trimmed)) {
    throw new Error(`${label} 不合法（只接受英數、中日韓、- _ .）：${value}`)
  }
  return trimmed.slice(0, 80)
}

/** 由內容推導安全檔名（卡片名稱可能含任意字元；這裡是唯一允許轉換的地方）。 */
export function segmentFromName(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..') return ''
  return trimmed
    .replace(/[^\w\u4e00-\u9fff.-]/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 80)
}

/**
 * 驗證 session id。
 *
 * 跟 `requireId` 分開，因為規則不一樣：session id 是**我們產生的**（DSH 給的），
 * 使用者不會手打，所以可以嚴格要求「ASCII、不以點開頭、不含路徑分隔符」。
 * 拿它當檔名最怕的就是 `../`——那個檢查在這裡一次做掉。
 *
 * @throws 不合法時丟錯。
 */
export function requireSessionId(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('session id 不可為空')
  const trimmed = value.trim()
  if (SAFE_SESSION_ID.test(trimmed) === false) {
    throw new Error(`session id 不合法（只接受英數、- _ .，且不以點開頭）：${value}`)
  }
  return trimmed
}

/** DSH home（`DSH_HOME` 優先）——酒館街的註冊表放在那裡。 */
export function resolveDshHome(env = process.env) {
  const fromEnv = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '' ? env.DSH_HOME.trim() : ''
  return resolve(fromEnv !== '' ? fromEnv : join(homedir(), '.dsh'))
}

/** 現在時間字串（寫進檔案用）。 */
const nowIso = () => new Date().toISOString()

/**
 * 出貨的「輸出格式」世界書：**這一份是不是沒改過的原版？**
 *
 * ⚠️ **只認「逐字等於出貨版」的條目**。判斷方法是把兩個方向都檢查過：
 *   - 出貨版的每一條都在使用者那份裡，而且 `content` 一字不差
 *   - 使用者那份**沒有多出來的條目**、也沒有多出來的頂層鍵
 *     （多出來＝他自己加過東西 ⇒ 不要動）
 *
 * 任何一項不成立就回 `null`（＝不升級）。**寧可不升級，也不要蓋掉使用者的東西。**
 *
 * @param raw - 檔案原文。
 * @param shipped - `defaultFormatWorldbook()`。
 * @returns 升級後的物件，或 `null`（＝不動它）。
 */
export function upgradeFormatBook(raw, shipped) {
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const shippedEntries = shipped.entries
  const current = normalizeBookEntries(parsed)
  if (current.length === 0) return null

  // 「原版」的定義：條目數一樣、而且每一條的 content 都是出貨版的其中一條。
  const shippedContents = Object.values(shippedEntries).map((one) => one.content)
  if (current.length > shippedContents.length) return null
  for (const entry of current) {
    if (shippedContents.includes(entry.content) === false) return null
  }
  // 頂層鍵：只准有我們知道的那些（`name`／`position`／`entries`／`version`）。
  for (const key of Object.keys(parsed)) {
    if (['name', 'position', 'entries', 'version'].includes(key) === false) return null
  }

  // ---- 到這裡確定是「沒改過的原版」⇒ 升級（但保留 uid 與使用者動過的標題）----
  const byContent = new Map()
  for (const [id, one] of Object.entries(shippedEntries)) byContent.set(one.content, { id, spec: one })
  const nextEntries = {}
  let nextUid = 0
  for (const entry of current) {
    const hit = byContent.get(entry.content)
    // ⚠️ 保留 uid（`collectLore` 用 uid 決勝負，換掉會改變排序的穩定性）
    //    與 `comment`（使用者可能只是改了標題——那不該讓整本書停止升級）。
    nextEntries[String(nextUid)] = {
      ...hit.spec,
      uid: typeof entry.uid === 'number' ? entry.uid : hit.spec.uid,
      comment: typeof entry.comment === 'string' && entry.comment !== '' ? entry.comment : hit.spec.comment,
      displayIndex: nextUid,
    }
    byContent.delete(entry.content)
    nextUid += 1
  }
  // 剩下的就是**出貨版新增的條目**（這一版就是「哪種內容用哪個 kind」那一條）。
  for (const { id, spec } of byContent.values()) {
    nextEntries[String(nextUid)] = { ...spec, uid: spec.uid, displayIndex: nextUid }
    void id
    nextUid += 1
  }

  const next = {
    ...parsed,
    name: typeof parsed.name === 'string' && parsed.name !== '' ? parsed.name : shipped.name,
    // `position` 用出貨版的值：那是這一版刻意的預設（系統提示），
    // 而「原版」的判斷已經保證使用者沒動過這本書的內容。
    position: shipped.position,
    entries: nextEntries,
  }

  /**
   * ⚠️ **內容等價就回 `null`**（＝不必寫檔）。
   *
   * 少了這一步，「已經是最新版」的書也會被回報成「更新過」——因為升級的
   * 結果雖然**內容一樣**，卻是一個新的物件（鍵的順序也可能不同）。
   * 症狀是使用者按了「補上預設內容」，畫面說「已更新」而實際上什麼都沒變
   * ——那比不做事更糟：**它讓「有沒有做事」這件事失去意義**。
   */
  const before = JSON.stringify(parsed)
  const after = JSON.stringify(next)
  return before === after ? null : next
}

/** 世界書的條目 → 陣列（兩種方言都吃；`lib/worldbook.js` 那一支的輕量版）。 */
function normalizeBookEntries(book) {
  const entries = book?.entries
  if (Array.isArray(entries)) return entries.filter((one) => one !== null && typeof one === 'object')
  if (entries !== null && typeof entries === 'object') {
    return Object.values(entries).filter((one) => one !== null && typeof one === 'object')
  }
  return []
}

/**
 * 生成參數那幾個欄位（`SAMPLER_KEYS`：`temperature`／`maxTokens`／`stop`）的寫入。
 *
 * ⚠️ **抽出來不是為了好看，是為了「只有一份」。** 在這一支出現之前，
 * `writeSettings` 與 `writeRoom` 各有一份一模一樣的 for 迴圈——而那個形狀
 * （「驗 → 合法就正規化、不合法就推進 `dropped`」）正是**最容易只改一邊**的東西：
 * 加 `stop` 的時候漏掉酒館那一半，症狀會是「酒館層存不進去、房間層可以」，
 * 而那要按到第二層才發現。這一輪就是因為要加第三個欄位才動它的。
 *
 * `patch[key] === undefined` 是「這次不要動這一欄」，與 `null`（＝清除／聽上一層）
 * 是兩件不同的事——`undefined` 在 JSON 裡根本不會出現，所以那一定是「沒送」。
 *
 * ⚠️ `stop` 的合法值是一個**陣列**，所以它不能走「先驗再正規化」那個對稱形狀
 * 的短路寫法（`stopProblem` 只是 `normalizeStop` 的前置檢查）——但兩個都呼叫，
 * 所以那條「驗一次、用同一個判斷」的規矩還是成立的。
 *
 * @param next - 已經併好的設定物件（**會被就地修改**）。
 * @param patch - 使用者送來的那幾個欄位。
 * @param dropped - 收集被丟掉的欄位說明（**會被就地 push**）。
 */
function applySamplerPatch(next, patch, dropped) {
  for (const key of SAMPLER_KEYS) {
    if (patch?.[key] === undefined) continue
    if (key === 'stop') {
      const problem = stopProblem(patch.stop)
      if (problem === '') next.stop = normalizeStop(patch.stop)
      else dropped.push(`stop（${problem}）`)
      continue
    }
    const problem = key === 'temperature' ? temperatureProblem(patch[key]) : maxTokensProblem(patch[key])
    if (problem === '') {
      next[key] = key === 'temperature' ? normalizeTemperature(patch[key]) : normalizeMaxTokens(patch[key])
    } else {
      dropped.push(`${key}（${problem}）`)
    }
  }
  /**
   * `stop` 的開關（`stopEnabled`）。
   *
   * ⚠️ 它**不是** `SAMPLER_KEYS` 的一員，因為那個清單是「有值／沒有值」的欄位，
   * 而開關有三種狀態：**`true`（開）／`false`（關）／`null`（聽上一層）**。
   * 混進那個迴圈會被「只搬認得的欄位」的規矩漏掉，於是關不掉。
   *
   * ⚠️ **`null` ＝ 回到「聽上一層」，不是 `false`。** 這兩者混掉就會出現
   * 「我把房間那一格按回『聽酒館的』，結果它變成『關』」——而畫面上那兩個選項
   * 是不同的東西（`triStateOf` 也是照這個分的）。
   *
   * 壞字串（`'on'`、`1`…）要**回報且不覆蓋**原本的值：默默留著舊值看起來像
   * 設定成功了，而那正是這一組欄位最糟的失敗方式。
   */
  if (patch?.stopEnabled !== undefined) {
    const wanted = patch.stopEnabled
    if (wanted === true || wanted === false) next.stopEnabled = wanted
    else if (wanted === null || wanted === '') next.stopEnabled = null
    else dropped.push('stopEnabled（要是 true、false 或 null）')
  }
}

/** 圖片的副檔名（`summary()` 數圖用；真正的驗證在 assets.js）。 */
const ART_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp']

/**
 * 遞迴數 `art/` 底下有幾張圖。
 *
 * 結構是 `art/<種類>/<id>/<圖>`，所以要往下走兩層；只數圖片檔，
 * 不把資料夾本身算進去（以前是 `readdir().length`，那會把資料夾也數成圖）。
 */
/**
 * 房間資料夾裡的插圖（`chats/<角色>/<roomId>/art/`）。
 *
 * 為什麼要另外數：房間的圖**跟著房間走**，不在 `art/` 底下——而 `countArt` 只掃給它的
 * 那棵子樹，所以兩邊都要數，大廳的「插圖」才是全部的圖。
 */
async function countRoomArt(chatsDir) {
  let total = 0
  const characters = await readdir(chatsDir, { withFileTypes: true }).catch(() => [])
  for (const who of characters) {
    if (!who.isDirectory()) continue
    const rooms = await readdir(join(chatsDir, who.name), { withFileTypes: true }).catch(() => [])
    for (const room of rooms) {
      if (!room.isDirectory()) continue
      total += await countArt(join(chatsDir, who.name, room.name, 'art'))
    }
  }
  return total
}

async function countArt(dir, depth = 0) {
  if (depth > 3) return 0
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  let total = 0
  for (const entry of entries) {
    if (entry.isDirectory()) {
      total += await countArt(join(dir, entry.name), depth + 1)
      continue
    }
    const lower = entry.name.toLowerCase()
    if (ART_EXTENSIONS.some((extension) => lower.endsWith(extension))) total += 1
  }
  return total
}

/**
 * 一個酒館資料夾。
 *
 * 所有路徑都經過 `resolveWithin`，一定落在這間酒館裡面
 * （`../` 之類的跳脫會被拒絕）。
 */
export class TavernWorkspace {
  /** @param root - 酒館資料夾的絕對路徑 */
  constructor(root) {
    this.root = resolve(root)
  }

  /** `root/<part...>`（呼叫端自己保證 parts 安全）。 */
  dir(...parts) {
    return join(this.root, ...parts)
  }

  /**
   * 解析一個「必須在這間酒館裡」的路徑。
   * @throws 跳出 root 時丟錯。
   */
  resolveWithin(...parts) {
    const target = resolve(this.root, ...parts)
    const base = resolve(this.root)
    if (target !== base && !target.startsWith(base + sep)) {
      throw new Error(`酒館：路徑跳脫被拒絕（${parts.join('/')}）`)
    }
    return target
  }

  /** 資料夾在不在。 */
  async exists() {
    const info = await stat(this.root).catch(() => undefined)
    return info !== undefined && info.isDirectory()
  }

  /**
   * 建立／補齊這間酒館的結構。
   *
   * 這是「新增酒館」唯一會做的寫入動作：四個子資料夾＋設定檔＋說明檔。
   * 已經存在的東西不會被覆蓋——用**獨佔建立**（`wx`）而不是「先檢查再寫」，
   * 因為後者在檢查與寫入之間有空窗，而這正是我們要避免的東西。
   * @returns 這次實際建立了哪些項目（給使用者看「幫你建了什麼」）。
   */
  async ensure() {
    const created = []
    await mkdir(this.root, { recursive: true })
    for (const part of SUBDIRS) {
      const target = this.dir(part)
      const before = await stat(target).catch(() => undefined)
      await mkdir(target, { recursive: true })
      if (before === undefined) created.push(`${part}/`)
    }

    const defaults = `${JSON.stringify({ version: 1, name: '', note: '', createdAt: nowIso() }, null, 2)}\n`
    try {
      await createExclusive(this.resolveWithin(SETTINGS_FILE), defaults)
      created.push(SETTINGS_FILE)
    } catch (error) {
      // 已經有設定檔（或剛好被別人建立）＝不是我們建的，不用回報。
      if (!isExistsError(error)) throw error
    }

    try {
      await createExclusive(this.resolveWithin(README_FILE), README_TEXT)
      created.push(README_FILE)
    } catch (error) {
      if (!isExistsError(error)) throw error
    }
    return created
  }

  /**
   * 補上新建酒館的預設內容：一位老闆娘 ＋ 一本寫著這間店的世界書。
   *
   * 為什麼要這個：一間剛開好的酒館如果是空的（0 人物卡 0 世界書），使用者
   * 面對的是一片空白，不好下手。
   *
   * 三個約束（見 `defaults.js`）：
   *   - **只在新建立酒館時呼叫**（`registry.add()`），不在任何讀取路徑上。
   *     這條是硬規則：讀取路徑寫檔曾經讓「舊版殘留」的標記自己消失。
   *   - **只補不覆蓋**：同名檔案已存在就跳過，使用者自己的東西不會被蓋掉。
   *   - 寫出來的是一般的卡與世界書，沒有任何隱藏格式。
   *
   * @returns 這次實際建立了哪些檔案（給使用者看「幫你建了什麼」）
   */
  async seed() {
    const created = []
    await this.ensure()

    /**
     * 預設的老闆娘：**從出貨的 PNG 卡讀出來**（`samples/characters/老闆娘.png`），
     * 而且那張 PNG 同時是她的立繪。
     *
     * 為什麼是「讀 PNG」而不是「抄一份 JS 物件」：
     *   1. **提示詞住在卡片裡**。PNG 的 `ccv3` 區塊就是那張卡的全文（描述、開場白、
     *      對話示範…），而 `defaultCharacter()` 只是同一個內容的另一種寫法。
     *      從 PNG 讀，等於「卡片是唯一真相」——改卡片不用改程式，也不會走樣。
     *   2. 使用者拿到的預設角色**有臉**。以前只寫一份 JSON，畫面永遠是字母頭像；
     *      而那張畫本來就在 repo 裡。
     *
     * ⚠️ 出貨檔不在時（例如 `npm publish` 少了 `samples/`）**要能退回純資料**：
     * 沒有圖的預設角色仍然可用，不可以讓整個新增酒館失敗。
     */
    const seededCard = await this.seedDefaultCard(created)

    const bookPath = this.resolveWithin('worldbooks', `${DEFAULT_WORLDBOOK_ID}.json`)
    try {
      await createExclusive(bookPath, `${JSON.stringify(defaultWorldbook(), null, 2)}\n`)
      created.push(`worldbooks/${DEFAULT_WORLDBOOK_ID}.json`)
    } catch (error) {
      if (!isExistsError(error)) throw error
    }

    // 輸出格式是**預設**，不是選配——沒有它模型就吐普通小說，解析器只能靠推斷。
    // 它跟其他世界書一樣是普通檔案：使用者看得到、改得動、刪得掉。
    await this.seedFormatBook(created)

    /**
     * **一間可以直接聊的房間**（使用者：「新酒館和新房間都應該要有一個預設」）。
     *
     * 只有「這一輪真的建了老闆娘」才建房間：
     *   - 既有的資料夾（使用者自己的角色）不會被塞一間莫名其妙的房
     *   - 開場白就是卡片的 `first_mes`，也就是推門進來的第一句話
     */
    if (seededCard !== null) {
      const room = await this.createRoom(seededCard.id, '')
      const opening = typeof seededCard.card.first_mes === 'string' ? seededCard.card.first_mes.trim() : ''
      if (opening !== '') {
        await this.appendRoomMessages(seededCard.id, room.room, [
          { name: seededCard.card.name ?? seededCard.id, isUser: false, text: opening },
        ])
      }
      created.push(`chats/${seededCard.id}/${room.room}/${CHAT_FILE}`)
    }

    /**
     * 「裝修」的入口：附一份**整份註解掉**的 `custom.css` 範本。
     *
     * 為什麼要附：這一層是「token 改不到的形狀」唯一的出口，但它不會自己出現——
     * 使用者得先知道有這個檔案才用得下去（只寫在 README 裡等於藏起來）。
     * 範本沒有任何一條生效的規則，所以附了不會改變外觀。
     *
     * ⚠️ 只在**新建酒館**時給（跟老闆娘、世界書同一條規矩）：既有的酒館不會被補，
     * 免得在使用者的資料夾裡冒出他沒要的檔案。
     */
    try {
      await createExclusive(this.resolveWithin(CUSTOM_CSS_FILE), CUSTOM_CSS_TEMPLATE)
      created.push(CUSTOM_CSS_FILE)
    } catch (error) {
      if (!isExistsError(error)) throw error
    }

    return created
  }

  /**
   * 補上／更新**出貨的預設內容**（既有的酒館用）。
   *
   * ⚠️ **這是 `seed()` 的「既有酒館」版本，而它刻意不是自動的。**
   *
   * 新建酒館跑 `seed()`；既有的酒館永遠不會再跑一次，所以出貨內容的修正
   * （例如 2.6.59 多了一條「哪種內容用哪個 kind」）到不了它們手上——
   * 使用者的感想會是「更新了但沒變」。
   *
   * 但**讀取路徑不寫檔**是這個 repo 的硬規則（§2c：讀取順手補結構曾經讓
   * 「舊版殘留」的標記自己消失）。所以它是**使用者按一下才會跑**的動作，
   * 而且回報它動了什麼——不藏在背景。
   *
   * 它做的三件事，每一件都是「只補不覆蓋」：
   *   1. 缺少的預設世界書 ⇒ 建（`seedFormatBook` 順便處理格式書的升級）
   *   2. 格式書沒被改過 ⇒ 升級成出貨版
   *   3. 什麼都沒缺 ⇒ 回一份空的清單（**不必假裝做了事**）
   *
   * @returns `{ changed, skipped }`——兩邊都是字串陣列，給使用者看。
   */
  async repairDefaults() {
    const created = []
    const before = await this.seedFormatBook(created)
    const changed = [...created]
    if (before === 'upgraded') changed.push(`worldbooks/${FORMAT_WORLDBOOK_ID}.json（更新成出貨版本）`)

    const skipped = []
    if (before === 'kept') {
      skipped.push(
        `worldbooks/${FORMAT_WORLDBOOK_ID}.json（你改過它，所以原樣保留）`,
      )
    }
    return { changed, skipped }
  }

  /**
   * 出貨的「輸出格式」世界書：沒有就建，**有的話只補不覆蓋**。
   *
   * ────────────────────────────────────────────────────────────────────────
   * ⚠️ **為什麼這一支不是單純的 `createExclusive()`**（2.6.59 改的）。
   *
   * 出貨的說明文字會**跟著版本改**（例如 2.6.59 多了一條「哪種內容用哪個 kind」，
   * 因為實測發現模型會把同一種內容一下寫純文字、一下寫 JSON）。
   * 而既有的酒館**永遠不會**再跑一次 seed ⇒ 那些修正到不了它們手上，
   * 使用者的感想會是「更新了但沒變」。
   *
   * 所以三條路，而且**判斷「是不是我們的原版」用逐字比對**：
   *
   *   1. 檔案不在 ⇒ 建一份完整的
   *   2. 檔案在、而且**條目內容與出貨版一字不差**（＋沒有我們認不得的東西）
   *      ⇒ 那是「沒改過的原版」，安全升級：保留 uid 與使用者可能動過的
   *      條目標題，換上新文字、補上新條目
   *   3. 其他（沒有 `entries`／內容被改過／有額外的鍵）⇒ **完全不動**
   *
   * 「有沒有被改過」用內容比對而不是記一個版本號：版本號要我們自己維護，
   * 而且使用者手改了內容之後版本號還是舊的 ⇒ 會被誤判成原版而被蓋掉。
   * 逐字比對的代價是「使用者改一個字就不升級」——那正是我們要的結果。
   * ────────────────────────────────────────────────────────────────────────
   *
   * @param created - 這次建立了哪些檔案（會被就地 push）。
   * @returns `'created'`／`'upgraded'`／`'kept'`／`'skipped'`。
   */
  async seedFormatBook(created) {
    const path = this.resolveWithin('worldbooks', `${FORMAT_WORLDBOOK_ID}.json`)
    const shipped = defaultFormatWorldbook()

    let raw = null
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      raw = null
    }

    if (raw === null) {
      await atomicWrite(path, `${JSON.stringify(shipped, null, 2)}\n`)
      if (Array.isArray(created)) created.push(`worldbooks/${FORMAT_WORLDBOOK_ID}.json`)
      return 'created'
    }

    const upgraded = upgradeFormatBook(raw, shipped)
    if (upgraded === null) return 'kept'
    await atomicWrite(path, `${JSON.stringify(upgraded, null, 2)}\n`)
    return 'upgraded'
  }

  /**
   * 預設角色（老闆娘）：資料從出貨的 PNG 卡讀，PNG 本身當她的立繪。
   *
   * @param created - 回報清單（會被推進去的陣列）
   * @returns `{ id, card }`；**已經有同名的卡**（使用者的東西）時回 `null`
   */
  async seedDefaultCard(created) {
    const id = DEFAULT_CHARACTER_ID
    const cardPath = this.resolveWithin('characters', `${id}.json`)
    const pngPath = this.resolveWithin('characters', `${id}.png`)
    if ((await stat(cardPath).catch(() => undefined)) !== undefined) return null
    if ((await stat(pngPath).catch(() => undefined)) !== undefined) return null

    let bytes = null
    let card = null
    try {
      bytes = await readFile(new URL(`../samples/characters/${id}.png`, import.meta.url))
      if (isPng(bytes)) card = unwrapCard(readCardFromPng(bytes).card)
    } catch (error) {
      // 出貨檔不在（或壞掉）→ 退回純資料，不讓新增酒館失敗。
      bytes = null
      card = null
    }
    if (card === null || card === undefined) {
      card = defaultCharacter()
      bytes = null
    }

    /**
     * ⚠️ **寫成 PNG 卡**（`characters/老闆娘.png`），不是 JSON ＋ 插圖。
     *
     * 使用者：「留意他的提示詞要寫進 PNG 卡片當中」——所以預設角色**就是那張卡**：
     * 提示詞住在 `ccv3` 裡，圖也同一份，不需要再複製一張到 `art/`。
     */
    if (bytes !== null) {
      await atomicWrite(pngPath, bytes)
      created.push(`characters/${id}.png`)
    } else {
      await createExclusive(cardPath, `${JSON.stringify(toCardEnvelope(card), null, 2)}\n`)
      created.push(`characters/${id}.json`)
    }
    return { id, card }
  }

  /** 這間酒館的概況：路徑、名稱、各類檔案數量，以及實際存在哪些項目。 */
  async summary() {
    const exists = await this.exists()
    const counts = { characters: 0, worldbooks: 0, chats: 0, art: 0 }
    let scaffolded = false
    const files = []
    if (exists) {
      const cards = await readdir(this.dir('characters'), { withFileTypes: true }).catch(() => [])
      // ⚠️ **兩種卡都要數**：PNG 卡（`characters/<id>.png`）也是卡，
      // 只數 `.json` 的話新建酒館的大廳會顯示「0 張卡」——而畫面上明明有一張。
      counts.characters = cards.filter((file) => {
        if (!file.isFile()) return false
        const ext = file.name.split('.').pop().toLowerCase()
        return CARD_EXTENSIONS.includes(ext)
      }).length
      const books = await readdir(this.dir('worldbooks')).catch(() => [])
      counts.worldbooks = books.filter((file) => file.endsWith('.json')).length
      counts.chats = (await this.listAllRooms()).length
      /**
       * ⚠️ **要數兩邊。** 房間的圖現在**跟著房間走**（`chats/<角色>/<roomId>/art/`），
       * 不在 `art/` 底下——所以光掃 `art/` 會漏掉它們，大廳那個「插圖」數字會少算
       * （2.6.6 加房間佈局時就是這樣少了一張，測試把數字從 4 改成 3 才發現）。
       */
      counts.art = (await countArt(this.dir('art'))) + (await countRoomArt(this.dir('chats')))
      // 這個資料夾是不是「v2 建出來的」。v1 只留四個空資料夾、沒有 tavern.json，
      // 所以這是分辨「舊版殘留」與「正常酒館」最便宜的判準——面板會用它提醒使用者
      // 那筆紀錄其實不是這版建立的（使用者實際回報過「怎麼多一間預設酒館」）。
      scaffolded = (await stat(this.resolveWithin(SETTINGS_FILE)).catch(() => undefined)) !== undefined
      // 實際存在的項目（給面板顯示用）。**不可以用猜的**：以前面板把
      // `tavern.json`、`README.txt` 永久硬寫在「資料夾結構」裡，
      // 於是舊版殘留酒館會同時顯示「有 tavern.json」和「沒有 tavern.json」。
      if (scaffolded) files.push(SETTINGS_FILE)
      // `.sessions` 是插件自己的中繼資料（對話 ↔ DSH session 的對照表）。
      // 照實列出來，但**只有真的存在才列**——跟 `originals/` 一樣的規矩。
      for (const extra of [README_FILE, 'originals', SESSIONS_DIR]) {
        if ((await stat(this.resolveWithin(extra)).catch(() => undefined)) !== undefined) files.push(extra)
      }
    }
    return {
      root: this.root,
      name: this.root.split(sep).pop() ?? this.root,
      exists,
      scaffolded,
      files,
      counts,
    }
  }

  /* ------------------------------ 設定檔 ------------------------------ */

  /** 讀 tavern.json；壞掉或不存在時回傳預設值（面板永遠開得起來）。 */
  async readSettings() {
    const fallback = {
      version: 1,
      name: '',
      note: '',
      userName: '',
      userPersona: '',
      tavernPrompt: '',
      allowTools: 'none',
      // ⚠️ `null`（不是 0）＝**沒有設定**，意思是「不要碰 DSH 的決定」。
      // 見 `lib/samplers.js` 的說明。
      temperature: null,
      maxTokens: null,
      // `null` ＝ 沒有 stop 序列。⚠️ **不是空陣列**——存檔只有一種「沒有」，
      // 兩個都收會出現「這一間是空的、那一間是沒有」的假區別（見 `normalizeStop`）。
      stop: null,
      // `stop` 的開關。預設**關**：開了會多送四串內建的（見 `STOP_PRESET`），
      // 而那會改變既有對話的行為——所以預設必須是「與以前一字不差」。
      stopEnabled: false,
      /**
       * 世界書的**預設注入位置**（這一間酒館的）。
       *
       * ⚠️ **空字串＝沒有指定**，而 `positionOf()` 會落到 `'in-chat'`
       * ——那正是 2.6.58 以前的行為。所以這一格上線時既有酒館「一個字都不變」，
       * 而每一本書自己的 `position` 會蓋過它。
       */
      worldbookPosition: '',
      createdAt: '',
    }
    try {
      const raw = await readFile(this.resolveWithin(SETTINGS_FILE), 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
      return { ...fallback, ...parsed }
    } catch {
      return fallback
    }
  }

  /**
   * 合併寫回 tavern.json（只動給定的欄位）。
   *
   * `assets`（哪一張是主圖）是唯一一個「不是文字欄位」的東西，所以它走自己的
   * 分支：只收物件、逐項驗證成圖片檔名。以前沒有這條分支，插圖的主圖設定
   * 會**默默被丟掉**——面板看起來像「設了主圖但沒生效」。
   */
  async writeSettings(patch) {
    await this.ensure()
    const current = await this.readSettings()
    const next = { ...current }
    /** 被丟掉的值（不合法）——只在真的有東西時回報，見下面 `samplers` 那一段。 */
    const dropped = []
    if (typeof patch?.name === 'string') next.name = patch.name.trim().slice(0, 120)
    if (typeof patch?.note === 'string') next.note = patch.note.slice(0, 4000)
    /**
     * 你在故事裡的名字，對應提示詞裡的 `{{user}}`。
     *
     * 為什麼放在酒館層級而不是每個對話：它是「你是誰」，跨對話不該變。而 agent 面
     * 需要它才能把卡片裡的 `{{user}}` 換掉——在那之前那個變數永遠是預設的「你」。
     *
     * ⚠️ **這一條一定要在 `writeSettings` 的白名單裡**：這支函式只搬它認得的欄位，
     * 沒列到的會被**默默丟掉**（面板看起來像「設了但沒生效」——`assets` 就是這樣
     * 壞過一次，見上面的註解）。
     */
    if (typeof patch?.userName === 'string') next.userName = patch.userName.trim().slice(0, 60)
    /**
     * `userPersona`＝**你是誰**（比名字多一點：身分、來歷、說話方式）；
     * `tavernPrompt`＝**這間店的規則**（每輪都要帶進去的那些）。
     *
     * 兩個都是**輸入**：agent 面會把它們接在角色卡後面一起送進去。注意跟 `note`
     * 的差別——`note` 只給人看，**不會**進提示詞；這兩個會。
     *
     * ⚠️ 同 `userName`：**沒列在白名單裡的欄位會被默默丟掉**（`assets` 就是這樣
     * 壞過一次）。新欄位一律要記得回來加。
     */
    if (typeof patch?.userPersona === 'string') next.userPersona = patch.userPersona.slice(0, 4000)
    if (typeof patch?.tavernPrompt === 'string') next.tavernPrompt = patch.tavernPrompt.slice(0, 4000)
    /**
     * 這個角色能用哪些工具（`none`／`read`／`write`／`web`／`all`）。
     *
     * ⚠️ **預設是 `none`**，而且**只認白名單裡的值**——打錯字或不明字串一律存成
     * `none`。這是安全開關，不可以用「存進去就好、由讀的那邊判斷」的態度處理：
     * 讀的那邊（agent 面）也要 fail closed。
     */
    if (typeof patch?.allowTools === 'string') {
      next.allowTools = ['none', 'read', 'write', 'web', 'all'].includes(patch.allowTools)
        ? patch.allowTools
        : 'none'
    }
    /**
     * 世界書的**預設注入位置**（2.6.59）。
     *
     * ⚠️ **不合法時回報，不靜靜吞掉**（與生成參數同一條理由）：打錯一個位置名
     * 而落回「預設」，使用者會以為自己設好了——然後奇怪為什麼書還是被讀成
     * 「使用者講的話」。空字串是**合法**的（＝沒有指定 ⇒ `in-chat`）。
     */
    if (patch?.worldbookPosition !== undefined) {
      const wanted = patch.worldbookPosition
      if (wanted === '' || wanted === null) next.worldbookPosition = ''
      else if (WORLDBOOK_POSITIONS.includes(wanted)) next.worldbookPosition = wanted
      else dropped.push(`worldbookPosition（要是 ${WORLDBOOK_POSITIONS.join('／')} 其中之一）`)
    }
    /**
     * 生成參數（`temperature`／`maxTokens`／`stop`）。**沒設＝不要碰 DSH 的決定**
     * （`null`，不是 0 或某個自以為是的預設值）。
     *
     * ⚠️ 這一組與上面每一個欄位都不同：**不合法時不是靜靜吞掉**，而是收進
     * `dropped` 一起回報。理由——`allowTools` 打錯字落回 `none` 是 fail closed
     * （安全的），而 `temperature: 5` 落回「沒有設定」是**看起來有設、其實沒設**
     * 的典型：使用者會以為調好了，然後覺得「這插件沒用」。
     *
     * ⚠️ 這裡的驗證**不是**安全檢查（它影響不了檔案系統），是**誠實**：
     * 送不出去的值不要假裝收下了。
     *
     * ⚠️ 那三個欄位的規矩與正規化在 `applySamplerPatch()`（**與 `writeRoom` 共用
     * 同一支**——以前這裡有一份自己的迴圈，那正是「只改一邊」的溫床）。
     */
    applySamplerPatch(next, patch, dropped)
    if (patch?.assets !== undefined) {
      if (patch.assets === null || typeof patch.assets !== 'object' || Array.isArray(patch.assets)) {
        throw new Error('assets 必須是物件（{ "種類:名稱": "檔名" }）')
      }
      next.assets = readPrimaryMap({ [ASSETS_FIELD]: patch.assets })
    }
    next.updatedAt = nowIso()
    // 原子寫入：這是「我們管理的檔案」，寫壞了就等於設定全丟。
    await atomicWrite(this.resolveWithin(SETTINGS_FILE), `${JSON.stringify(next, null, 2)}\n`)
    // `dropped` 只在真的有東西被丟掉時才出現——不然每一個呼叫端都要處理一個
    // 永遠是空陣列的欄位，而那種欄位最後一定會有人忘記處理。
    return dropped.length === 0 ? next : { ...next, dropped }
  }

  /**
   * 讀這間酒館的主題（`<酒館>/theme.json`）。
   *
   * 主題住在酒館資料夾裡是刻意的：**一間酒館＝一個資料夾，整包帶走**的時候
   * 外觀也跟著走。沒有那個檔案就回預設（不是錯誤）。
   *
   * 壞掉的檔案（不是合法 JSON、或不是物件）也是回預設，但會帶 `broken: true`
   * ——設定頁要能告訴使用者「你的 theme.json 讀不出來」，而不是默默用預設。
   *
   * @returns `{ exists, broken, theme }`；`theme` 是 `normalizeTheme()` 的結果。
   */
  async readTheme() {
    const path = this.resolveWithin(THEME_FILE)
    let raw
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      return { exists: false, broken: false, theme: normalizeTheme(null) }
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { exists: true, broken: true, theme: normalizeTheme(null) }
    }
    try {
      return { exists: true, broken: false, theme: normalizeTheme(parsed) }
    } catch {
      return { exists: true, broken: true, theme: normalizeTheme(null) }
    }
  }

  /**
   * 寫這間酒館的主題。
   *
   * **只寫使用者真正改過的項目**（`normalizeTheme()` 已經把不認得的 key 丟掉），
   * 而且原子寫入——主題檔壞掉等於整個外觀壞掉。
   *
   * @param patch - `{ base, tokens }`。
   * @returns 寫進去的內容（正規化之後）。
   */
  async writeTheme(patch) {
    const theme = normalizeTheme(patch)
    const payload = { version: 1, base: theme.base, tokens: theme.tokens, style: theme.style }
    await this.ensure()
    await atomicWrite(this.resolveWithin(THEME_FILE), `${JSON.stringify(payload, null, 2)}\n`)
    return { exists: true, broken: false, theme }
  }

  /**
   * 讀這間酒館的自訂 CSS（`<酒館>/custom.css`）。
   *
   * 這是「裝修」的**逃生口**：token 改不到的形狀、材質、背景圖、動畫，用這一層。
   * 它是 `theme.json` 的補充而不是替代——能改的就用 token 改，token 改不動的才寫這裡。
   *
   * ⚠️ 內容是使用者寫的，宿主**不解析、不驗證**，只原樣送給客戶端；
   * 由客戶端用 `@scope (.dsh-tv-view)` 包起來再注入，所以它碰不到宿主自己的 DOM
   * （SillyTavern 的 `* { text-shadow }` 污染整個宿主是前例，見 `design-language.md`）。
   *
   * 沒有那個檔案就回空字串——**不是錯誤**（大多數酒館不會有）。
   *
   * @returns CSS 文字（可能是空的）。
   */
  async readCustomCss() {
    try {
      const text = await readFile(this.resolveWithin(CUSTOM_CSS_FILE), 'utf8')
      return typeof text === 'string' ? text : ''
    } catch {
      return ''
    }
  }

  /* ---------------------------- 回覆格式 ---------------------------- */

  /**
   * 讀這間酒館的回覆格式（`<酒館>/render.json`）。
   *
   * ⚠️ **這一份與 `theme.json` 是兩件事**：那個管「看起來怎樣」，
   * 這一個管「**我們怎麼告訴模型該怎麼回**，以及我們怎麼讀懂它」。
   * 兩者改的時機完全不同（換外觀 vs 換模型／換卡），所以放在兩個檔案裡。
   *
   * 沒有那個檔案 ⇒ 回預設（`mode: 'plain'`），所以**它不存在也不會壞**
   * ——這一點很重要：`plain` 模式下提示詞一個字都不加，也就是與以前一字不差。
   *
   * 壞掉的檔案回預設 ＋ `broken: true`（同 `readTheme()`）：設定頁要能說出來，
   * 而不是默默用預設。
   *
   * @returns `{ exists, broken, render }`；`render` 是 `normalizeRender()` 的結果。
   */
  async readRender() {
    const path = this.resolveWithin(RENDER_FILE)
    let raw
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      return { exists: false, broken: false, render: normalizeRender(null).render }
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { exists: true, broken: true, render: normalizeRender(null).render }
    }
    return { exists: true, broken: false, render: normalizeRender(parsed).render, dropped: [] }
  }

  /**
   * 寫這間酒館的回覆格式（**整份寫入**，不是 patch）。
   *
   * ⚠️ **與 `writeTheme()` 同一條規矩**：沒有 patch 語意。要改一個欄位就把
   * 完整的一份送過來（客戶端讀回來、改一格、整份寫回去）。理由是這一支的
   * 輸入是一個**清單**（標記），而「patch 一個陣列」的語意很快就會變成
   * 「怎麼刪掉一個標記」的哲學問題——不值得。
   *
   * ⚠️ 但**不合法的那幾項會回報**（`dropped`），不會靜靜吞掉：
   * 打錯一個 kind 卻看起來像設定成功了，是這一組欄位最糟的失敗方式。
   *
   * @param patch - `{ mode, markers, quotes, parens, choicesClickable }`（可省略）。
   * @returns 寫進去的內容（正規化之後）＋ `dropped`（有的話）。
   */
  async writeRender(patch) {
    const { render, dropped } = normalizeRender(patch)
    const payload = {
      version: 1,
      mode: render.mode,
      markers: render.markers,
      quotes: render.quotes,
      parens: render.parens,
      choicesClickable: render.choicesClickable,
    }
    await this.ensure()
    await atomicWrite(this.resolveWithin(RENDER_FILE), `${JSON.stringify(payload, null, 2)}\n`)
    return dropped.length === 0 ? render : { ...render, dropped }
  }

  /* ------------------------------ 人物卡 ------------------------------ */

  /**
   * 列出人物卡。
   * @returns `[{ id, file, name, card, assets, error }]`；`card` 是**原始** JSON 物件
   *   （如果是 `{spec, data}` 信封就取 `data`），解析失敗時 `card` 為 null。
   *   `assets` 是插圖狀態（`{ items, primary }`），面板用它畫縮圖。
   *
   * ⚠️ **刻意不呼叫 `ensure()`**：這是「讀」。以前讀取路徑會順手補結構，
   * 結果光是瀏覽一間舊版殘留的酒館就幫它建了 `tavern.json`，
   * 「舊版殘留」的標記就此消失（使用者看到的現象是「標記自己不見了」）。
   * 讀取只讀；要建東西請走寫入路徑（`writeCharacter` 等）。
   */
  /**
   * 一張卡的檔案：`.json`（酒館自己的格式）或 `.png`（**PNG 卡**，提示詞住在 `ccv3` 裡）。
   *
   * ⚠️ **PNG 卡是「卡」不是「圖」**：使用者把 SillyTavern 的卡丟進 `characters/` 就會出現，
   * 在面板上改完也**寫回同一張 PNG**（見 `writeCharacter`）。`.json` 只在「這張卡沒有圖」
   * 時才是儲存形式（例如「＋ 新增角色」）。
   *
   * 兩個都存在時 **`.json` 優先**（那是酒館自己編的那一份，離使用者最近）。
   * @returns `{ file, ext }`；都沒有時回 `null`
   */
  async cardFileOf(id) {
    const key = requireId(id, '角色 id')
    for (const ext of CARD_EXTENSIONS) {
      const file = `${key}.${ext}`
      if ((await stat(this.resolveWithin('characters', file)).catch(() => undefined)) !== undefined) {
        return { file, ext }
      }
    }
    return null
  }

  async listCharacters() {
    const dir = this.dir('characters')
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    /**
     * 先收 id（`.json` 與 `.png` 都算），同一個 id 只留一份——兩個都有時 `.json` 優先，
     * 交給 `cardFileOf()` 決定，這裡不重複判斷。
     */
    const ids = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile()) continue
      const ext = entry.name.split('.').pop().toLowerCase()
      if (!CARD_EXTENSIONS.includes(ext)) continue
      const id = entry.name.slice(0, -(ext.length + 1))
      if (id !== '' && !ids.includes(id)) ids.push(id)
    }
    const cards = []
    for (const id of ids) {
      const found = await this.cardFileOf(id)
      const assets = await this.describeEntityAssets('character', id)
      if (found === null) continue
      try {
        const raw = await readFile(join(dir, found.file))
        const card = found.ext === 'png' ? unwrapCard(readCardFromPng(raw).card) : unwrapCard(JSON.parse(raw.toString('utf8')))
        cards.push({
          id,
          file: found.file,
          name: typeof card.name === 'string' && card.name !== '' ? card.name : id,
          card,
          assets,
          error: '',
        })
      } catch (error) {
        cards.push({
          id,
          file: found.file,
          name: id,
          card: null,
          assets,
          error: found.ext === 'png' ? '無法解析這張 PNG 卡' : '無法解析這個 JSON',
        })
      }
    }
    return cards
  }

  /** 讀一張卡（原始物件）。`.json` 與 PNG 卡都讀（PNG 卡走 `ccv3`／`chara`）。 */
  async readCharacter(id) {
    const key = requireId(id, '角色 id')
    const found = await this.cardFileOf(key)
    if (found === null) throw new Error(`找不到這張卡：characters/${key}.json（或 .png）`)
    const raw = await readFile(this.resolveWithin('characters', found.file))
    if (found.ext === 'png') return unwrapCard(readCardFromPng(raw).card)
    return unwrapCard(JSON.parse(raw.toString('utf8')))
  }

  /**
   * 寫一張卡。
   *
   * **寫回同一種形式**（使用者：「PNG 卡直接就是卡，讀得到、寫得回去」）：
   *   - 原本是 **PNG 卡** → 把新的卡片資料**換進那張 PNG**（`replaceCardInPng`），
   *     `IDAT` 原封不動，所以圖不會被重新編碼。提示詞因此一直住在卡片裡。
   *   - 原本是 `.json`、或這是一張新卡 → 寫 `.json`（沒有圖的卡不需要 PNG）。
   *
   * ⚠️ 兩個都存在時以 `.json` 為準（見 `cardFileOf`），所以**不會**出現
   * 「改了 PNG、顯示的卻是 JSON」這種兩份真相。
   *
   * 信封一律是 SillyTavern 相容的 `{spec, spec_version, data}`；`data` 裡的未知欄位
   * 原樣保留（面板只改它認得的欄位）。
   * @returns 實際寫入的 id。
   */
  async writeCharacter(id, card) {
    await this.ensure()
    if (card === null || typeof card !== 'object' || Array.isArray(card)) {
      throw new Error('角色卡必須是物件')
    }
    const fromId = typeof id === 'string' && id.trim() !== '' ? requireId(id, '角色 id') : ''
    const base = fromId || segmentFromName(card.name) || `card-${Date.now().toString(36)}`
    const existing = await this.cardFileOf(base)
    if (existing !== null && existing.ext === 'png') {
      const path = this.resolveWithin('characters', existing.file)
      const bytes = await readFile(path)
      // 沿用原本那一個關鍵字（`ccv3` 或 `chara`）——不要在存檔時偷偷換掉卡的方言。
      let keyword = 'ccv3'
      try {
        keyword = readCardFromPng(bytes).keyword
      } catch (error) {
        keyword = 'chara'
      }
      await atomicWrite(path, replaceCardInPng(bytes, toCardEnvelope(card), { keyword }))
      return base
    }
    // 原子寫入：這是使用者擁有的檔案（見 docs/storage-layout.md §4）。
    await atomicWrite(
      this.resolveWithin('characters', `${base}.json`),
      `${JSON.stringify(toCardEnvelope(card), null, 2)}\n`,
    )
    return base
  }

  /** 刪一張卡（只刪這一個檔案）。 */
  /**
   * 把一份 **PNG 卡的位元組原封不動**存成 `characters/<id>.png`。
   *
   * 這是「PNG 卡直接就是卡」的寫入端：匯入與新建酒館的預設角色都走這裡——
   * 卡片資料（提示詞）住在 PNG 的 `ccv3` 裡，所以**不需要**再寫一份 JSON，
   * 也不需要把它複製成插圖（`describeEntityAssets` 會把卡片本體當成立繪）。
   *
   * ⚠️ 撞名時**自動編號**（`名字-2.png`）：那張卡是使用者的檔案，不可以蓋掉。
   * @param id - 想要的 id；空字串＝由 `name` 推導
   * @param name - 卡片裡的顯示名稱（只用來推導 id）
   * @param bytes - PNG 檔的完整位元組（**原樣寫入，不改一個位元組**）
   * @returns 實際寫入的 id
   */
  async writeCardPng(id, name, bytes) {
    if (!isPng(bytes)) throw new Error('這不是 PNG 檔（檔頭不對）')
    // 先確認裡面真的有卡片資料——不然會存進一張「看起來是卡但讀不出來」的圖。
    readCardFromPng(bytes)
    await this.ensure()
    const fromId = typeof id === 'string' && id.trim() !== '' ? requireId(id, '角色 id') : ''
    const base = fromId || segmentFromName(name) || `card-${Date.now().toString(36)}`
    const existing = new Set(
      (await readdir(this.dir('characters'), { withFileTypes: true }).catch(() => []))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name.replace(/\.(json|png)$/i, '')),
    )
    let key = base
    for (let n = 2; existing.has(key) && n < 999; n += 1) key = `${base}-${String(n)}`
    await atomicWrite(this.resolveWithin('characters', `${key}.png`), bytes)
    return key
  }

  /** 刪掉一張卡。**兩種形式都刪**（不然被刪掉的 PNG 卡會在下一次列舉時冒出來）。 */
  async deleteCharacter(id) {
    const key = requireId(id, '角色 id')
    for (const ext of CARD_EXTENSIONS) {
      await rm(this.resolveWithin('characters', `${key}.${ext}`), { force: true })
    }
    return key
  }

  /* ------------------------------ 世界書 ------------------------------ */

  /**
   * 列出世界書檔案。
   * @returns `[{ id, file, assets }]`；`assets` 是插圖狀態（面板畫縮圖用）。
   * 同 `listCharacters()`：**不呼叫 `ensure()`**，讀取不該改動資料夾。
   */
  async listWorldbooks() {
    const dir = this.dir('worldbooks')
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const books = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const id = entry.name.slice(0, -5)
      books.push({ id, file: entry.name, assets: await this.describeEntityAssets('worldbook', id) })
    }
    return books
  }

  /** 讀一本世界書（原樣回傳 JSON）。 */
  async readWorldbook(id) {
    const key = requireId(id, '世界書 id')
    const raw = await readFile(this.resolveWithin('worldbooks', `${key}.json`), 'utf8')
    return JSON.parse(raw)
  }

  /**
   * 設定一本世界書的**注入位置**（2.6.59）。
   *
   * ⚠️ **這是「只改書的 `position` 一個欄位」的專用路徑**，而不是叫客戶端
   * 用 `worldbook.write` 送整本。理由有兩個：
   *   1. 整本送過來要**逐位元組保留**使用者的書（那是 ST 的檔，裡面幾十個
   *      我們不認得的欄位）——而「讀出來、改一格、寫回去」在客戶端做
   *      就是要相信那一趟來回沒有掉東西。
   *   2. 位置是**這本書怎麼被讀**的後設資料，不是書的內容。
   *
   * ⚠️ 位置存**我們的名字**（`'system-after'` 這種字串），不是 ST 的數字
   * ——但 `positionOf()` 兩種都讀得懂，所以舊檔不會壞。
   *
   * @param id - 世界書 id。
   * @param where - `WORLDBOOK_POSITIONS` 之一。
   * @returns 寫進去的值。
   */
  async writeWorldbookPosition(id, where) {
    const list = await this.listWorldbooks()
    const key = typeof id === 'string' ? id : ''
    // 先把 id 驗成清單裡的檔案名（避免 `../` 之類的東西直接進路徑）。
    const found = list.find((one) => one.id === key)
    if (found === undefined) throw new Error(`找不到這本世界書：${key}`)
    const normalized = normalizePosition(where)
    if (normalized === '') {
      throw new Error(`位置要是 ${WORLDBOOK_POSITIONS.join('／')} 其中之一（收到 ${JSON.stringify(where)}）`)
    }
    const data = await this.readWorldbook(found.id)
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('這本世界書的內容不是物件，無法設定位置')
    }
    // 只動 `position` 一個鍵，其餘（ST 的幾十個欄位）原樣保留。
    const next = { ...data, position: normalized }
    await atomicWrite(this.resolveWithin('worldbooks', `${found.id}.json`), `${JSON.stringify(next, null, 2)}\n`)
    return normalized
  }

  /**
   * 哪幾本世界書在教**回覆格式**？
   *
   * ⚠️ **這不是一個功能，是一個警告的來源。** 格式指令有兩個可能的老師：
   * 世界書（`constant` 條目，住在訊息裡）與 `render.json`（plugin 送進系統提示）。
   * 兩個同時開著就會給模型**兩份規格**——而設定頁要看得見那件事。
   *
   * 讀不到／壞掉的書**跳過**（不丟錯）：這只是提示，不該讓設定頁打不開。
   *
   * @returns `[{ id, entries }]`——`entries` 是命中的條目標題。
   */
  async formatSpecBooks() {
    const listed = await this.listWorldbooks()
    const out = []
    for (const one of listed) {
      let data = null
      try {
        data = JSON.parse(await readFile(this.resolveWithin('worldbooks', `${one.id}.json`), 'utf8'))
      } catch {
        continue
      }
      const entries = formatSpecEntries(data)
      if (entries.length > 0) out.push({ id: one.id, entries })
    }
    return out
  }

  /**
   * 每一本世界書的**注入位置**（設定頁要顯示目前的值）。
   *
   * ⚠️ 回的是「**這本書最後會被放在哪裡**」——也就是已經把酒館層的預設
   * 算進去的結果（`positionOf`），不是檔案裡那個原始值。使用者要看到的
   * 是「它會被放在哪」，不是「它寫了什麼」。
   *
   * @returns `[{ id, position, explicit }]`——`explicit` 是「這本書自己有指定嗎」。
   */
  async worldbookPositions() {
    const listed = await this.listWorldbooks()
    const fallback = (await this.readSettings()).worldbookPosition
    const out = []
    for (const one of listed) {
      let data = null
      try {
        data = JSON.parse(await readFile(this.resolveWithin('worldbooks', `${one.id}.json`), 'utf8'))
      } catch {
        continue
      }
      out.push({
        id: one.id,
        // ⚠️ 這裡沒有房間可用（「📖 藏書」是酒館層的頁面），所以只算到酒館層。
        position: positionOf(data, '', fallback),
        explicit: normalizePosition(data?.position) !== '',
      })
    }
    return { fallback: typeof fallback === 'string' ? fallback : '', books: out }
  }

  /**
   * **這一間房**最後會把每一本世界書放在哪裡（房間 ＋ 酒館的預設都算進去）。
   *
   * ⚠️ 為什麼要單獨一支：房間那一頁要顯示的是「**在這一間房裡**，這本書會被
   * 放在哪」——而那要三層一起算（書 → 房 → 酒館）。用酒館那一支的結果會顯示
   * 錯的位置，而那是**安靜的**：使用者看到一個位置，實際送去的是另一個。
   *
   * @param character - 角色 id。
   * @param room - 房間 id。
   * @returns `{ room, tavern, books }`——`books` 每一項多了 `position`（算完的）
   *   與 `explicit`（書自己有沒有指定）。
   */
  async roomWorldbookPositions(character, room) {
    const id = await this.resolveRoom(character, room)
    const roomData = await this.readRoom(character, id)
    const tavernFallback = (await this.readSettings()).worldbookPosition
    const roomFallback = typeof roomData?.worldbookPosition === 'string' ? roomData.worldbookPosition : ''
    const overrides =
      roomData?.worldbookOverrides !== null && typeof roomData?.worldbookOverrides === 'object' && Array.isArray(roomData.worldbookOverrides) === false
        ? roomData.worldbookOverrides
        : {}
    const out = []
    for (const one of await this.listWorldbooks()) {
      let data = null
      try {
        data = JSON.parse(await readFile(this.resolveWithin('worldbooks', `${one.id}.json`), 'utf8'))
      } catch {
        continue
      }
      out.push({
        id: one.id,
        /**
         * ⚠️ **要先 `applyBookOverride` 再算位置**——不然房間指定的位置
         * 不會出現在「最後會放在哪」裡面（而那一格正是使用者要看的東西）。
         * 順序也保證了「書自己指定」還是贏（影子欄位排在它後面）。
         */
        position: positionOf(applyBookOverride({ id: one.id, data }, overrides)?.data, roomFallback, tavernFallback),
        explicit: normalizePosition(data?.position) !== '',
        /**
         * ⚠️ **這一間房有沒有關掉它**（`worldbookOverrides[id].enabled === false`）。
         * 房間那一頁要顯示這個——不然使用者會看到「沒生效」而不知道為什麼。
         */
        enabled: overrides[one.id]?.enabled === false ? false : true,
        /** 這一間房有沒有**碰過**這本書（有覆寫）。 */
        overridden: overrides[one.id] !== undefined,
      })
    }
    return {
      room: normalizePosition(roomData?.worldbookPosition) === '' ? '' : roomData.worldbookPosition,
      tavern: typeof tavernFallback === 'string' ? tavernFallback : '',
      overrides: overrides,
      books: out,
    }
  }

  /** 寫一本世界書（原樣寫入，不做欄位轉換）。 */
  async writeWorldbook(id, data) {
    await this.ensure()
    if (data === null || typeof data !== 'object') throw new Error('世界書必須是 JSON 物件或陣列')
    const fromId = typeof id === 'string' && id.trim() !== '' ? requireId(id, '世界書 id') : ''
    const derived = typeof data.name === 'string' ? segmentFromName(data.name) : ''
    const base = fromId || derived || `worldbook-${Date.now().toString(36)}`
    await atomicWrite(this.resolveWithin('worldbooks', `${base}.json`), `${JSON.stringify(data, null, 2)}\n`)
    return base
  }

  /** 刪一本世界書。 */
  async deleteWorldbook(id) {
    const key = requireId(id, '世界書 id')
    await rm(this.resolveWithin('worldbooks', `${key}.json`), { force: true })
    return key
  }

  /* ------------------------------ 對話紀錄 ------------------------------ */

  /**
   * 列出對話紀錄。
   * 目錄形狀照 SillyTavern：`chats/<角色>/<對話名>.jsonl`。
   *
   * 每一筆都附上 `assetId`——插圖資料夾的名字。對話名是使用者取的，
   * 可能含不能當資料夾名的字元，所以要正規化（見 `assets.js` 的 `assetOwner`）；
   * 先排序再解析，讓同一組檔案每次拿到同一組 assetId。
   */
  async listAllRooms() {
    const base = this.dir('chats')
    const settings = await this.readSettings()
    const perCharacter = await readdir(base, { withFileTypes: true }).catch(() => [])
    const rooms = []
    for (const dirent of perCharacter) {
      if (dirent.isDirectory() !== true) continue
      const character = dirent.name
      const resolveAssetId = makeAssetIdResolver(character)
      for (const room of await this.listRooms(character)) {
        const info = await stat(join(base, character, room.room, CHAT_FILE)).catch(() => undefined)
        rooms.push({
          character,
          // `room` 才是**身分**（資料夾名）；`name` 是顯示名稱，改名不會動到它。
          room: room.room,
          name: room.name,
          file: room.file,
          roomPrompt: room.roomPrompt,
          allowTools: room.allowTools,
          model: room.model,
          // 同上：清單要帶得出生成參數，不然「⚙️ 房間」那一格永遠是空的
          // （它讀的是清單回來的 `selected`，不是每一列都再打一次 `room.read`）。
          temperature: room.temperature,
          maxTokens: room.maxTokens,
          stop: room.stop,
          stopEnabled: room.stopEnabled,
          /**
           * ⚠️ **原樣回傳房間那一層的值**（`null` ＝ 聽酒館的）——
           * **不要**在這裡填成算完的結果：那就分不出「這一間房有沒有自己的設定」，
           * 而使用者按「聽酒館的」時的行為取決於那件事（同 `maxTokens` 那一條）。
           */
          worldbookPosition: room.worldbookPosition,
          artCount: room.artCount,
          assetId: resolveAssetId(room.room),
          // ⚠️ 插圖狀態目前仍走舊的 `art/chats/<角色>/<對話>/`。房間的圖在房間資料夾
          // 裡，所以這裡會是空的——等客戶端切過去（階段 4b）再一起接上。
          assets: await this.describeEntityAssets('chat', `${character}/${room.room}`, settings),
          mtimeMs: info === undefined ? null : info.mtimeMs,
          size: info === undefined ? null : info.size,
        })
      }
    }
    return rooms.sort((left, right) => (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0))
  }


  /**
   * 產生一個沒被用過的房間 id。
   *
   * 形狀：`時間 base36` ＋ `-` ＋ `隨機 4 碼`（例：`m1k3x9-a7f2`）。可排序、刪掉不會有
   * 空號、不必查表。用 `mkdir`（**不帶** `recursive`）當獨佔鎖：目錄已存在會丟
   * `EEXIST`，撞到就換一個——`createExclusive`／`createUnique` 是給檔案用的，
   * 這裡要的是目錄。
   */
  async nextRoomId(parent) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      try {
        await mkdir(join(parent, id))
        return id
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
    }
    throw new Error('建不出房間資料夾（連續撞名 8 次）')
  }

  /**
   * 開一間新房。
   *
   * @param character - 角色 id。
   * @param name - **顯示名稱**，不是路徑。改它不會動到任何資料夾。
   * @returns `{ character, room, name, dir }`。
   */
  async createRoom(character, name) {
    const who = requireId(character, '角色 id')
    await this.ensure()
    const parent = this.resolveWithin('chats', who)
    await mkdir(parent, { recursive: true })

    const room = await this.nextRoomId(parent)
    const dir = join(parent, room)
    await mkdir(join(dir, 'art'), { recursive: true })
    const wanted = segmentFromName(name)
    /**
     * 顯示名稱：**沒給名字、或只給了角色名時，補上 id 的隨機尾巴**。
     *
     * 為什麼：預設名稱就是角色名，於是每一間房都叫「老闆娘」，清單上完全分不出
     * 誰是誰——使用者：「預設+隨機這些基本」。id 本來就有一截隨機碼，拿它當後綴
     * 剛好（可讀、穩定、不必再抽一次）。
     *
     * 自己取的名字**原樣保留**，不動它——那是使用者的決定。
     */
    const suffix = room.slice(room.indexOf('-') + 1)
    const display = wanted === '' || wanted === who ? `${who}-${suffix}` : wanted
    await atomicWrite(join(dir, ROOM_FILE), `${JSON.stringify(defaultRoom(display), null, 2)}\n`)
    // 對話檔的標頭與舊格式**一字不差**（SillyTavern 讀得懂），只是換了位置。
    await atomicWrite(
      join(dir, CHAT_FILE),
      `${JSON.stringify({ chat_metadata: {}, user_name: 'unused', character_name: 'unused' })}\n`,
    )
    return { character: who, room, name: display, dir }
  }

  /**
   * 讀一間房的設定。壞掉或不存在時回預設值（面板永遠開得起來）。
   *
   * 跟 `readSettings` 同一個規矩：**讀取不改檔案**。
   */
  async readRoom(character, room) {
    const fallback = defaultRoom('')
    try {
      const parsed = JSON.parse(await readFile(join(this.roomDir(character, room), ROOM_FILE), 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
      return { ...fallback, ...parsed }
    } catch (error) {
      return fallback
    }
  }

  /**
   * 合併寫回 `room.json`（只動給定的欄位）。
   *
   * ⚠️ 跟 `writeSettings` 一樣是**白名單**：沒列到的欄位會被默默丟掉。新欄位一律要
   * 記得回來加——`assets` 就是沒加而壞過一次的那一個。
   *
   * ⚠️ `name` 只改**設定裡的名字**，不動資料夾：房間的身分是 `roomId`，
   * 那正是這個佈局存在的目的。
   */
  async writeRoom(character, room, patch) {
    const dir = this.roomDir(character, room)
    await this.ensure()
    await mkdir(dir, { recursive: true })
    const next = { ...(await this.readRoom(character, room)) }
    if (typeof patch?.name === 'string') {
      const wanted = segmentFromName(patch.name)
      if (wanted !== '') next.name = wanted
    }
    if (typeof patch?.roomPrompt === 'string') next.roomPrompt = patch.roomPrompt.slice(0, 4000)
    if (typeof patch?.model === 'string') next.model = patch.model.slice(0, 120)
    if (typeof patch?.reasoningEffort === 'string') {
      next.reasoningEffort = patch.reasoningEffort.slice(0, 40)
    }
    if (typeof patch?.allowTools === 'string') {
      next.allowTools = ROOM_TOOL_LEVELS.includes(patch.allowTools) ? patch.allowTools : 'inherit'
    }
    /**
     * 生成參數：**房間這一層蓋過酒館**（與 `allowTools` 同一條規矩）。
     *
     * `null`＝聽酒館的（房間的預設值）；酒館也是 `null` 就等於「不要碰 DSH 的決定」。
     * 兩層的預設都是**不設**，所以這一組欄位上線時，既有對話的行為**一個字都不變**。
     *
     * ⚠️ 與 `writeSettings` 一樣：不合法的值收進 `dropped` 回報，不靜靜吞掉。
     * 而**兩邊共用同一支**（`applySamplerPatch`）——不要在這裡再寫一份迴圈。
     */
    const roomDropped = []
    applySamplerPatch(next, patch, roomDropped)
    /**
     * 世界書的注入位置（**這一間房的**）。
     *
     * ⚠️ **三態**：`null`／`''` ＝ 聽酒館的（房間的預設值）；三個位置名之一
     * ＝ 這一間房自己的選擇。不合法要**回報**，不靜靜吞掉——打錯一個位置名
     * 而落回「聽酒館的」，使用者會以為自己設好了。
     *
     * ⚠️ 它寫在 `roomDropped` 之後：那一格要先宣告才推得進去
     * （`const` 沒有提升——這一輪就是這樣被 `ReferenceError` 抓到的）。
     */
    if (patch?.worldbookPosition !== undefined) {
      const wanted = patch.worldbookPosition
      if (wanted === '' || wanted === null) next.worldbookPosition = null
      else if (WORLDBOOK_POSITIONS.includes(wanted)) next.worldbookPosition = wanted
      else roomDropped.push(`worldbookPosition（要是 ${WORLDBOOK_POSITIONS.join('／')} 其中之一）`)
    }
    /**
     * 這一間房對個別世界書的覆寫（2.6.64）。
     *
     * ⚠️ **只收「認得的書」**：id 要真的在 `worldbooks/` 裡（不然打錯一個字
     * 就會留下一筆永遠不會生效的設定，而使用者以為自己關掉了那本書）。
     * 不認得的書收進 `dropped` 一起回報。
     *
     * ⚠️ `enabled: true` 與「沒有這一項」**意思一樣**（照酒館那一層），所以
     * 還原成預設時直接**刪掉那一項**——不要留一筆沒有作用的設定在檔案裡。
     */
    if (patch?.worldbookOverrides !== undefined) {
      const wanted = patch.worldbookOverrides
      if (wanted === null) {
        next.worldbookOverrides = {}
      } else if (typeof wanted !== 'object' || Array.isArray(wanted)) {
        roomDropped.push('worldbookOverrides（要是一個物件）')
      } else {
        const known = new Set((await this.listWorldbooks()).map((one) => one.id))
        const out = {}
        for (const [key, value] of Object.entries(wanted)) {
          if (known.has(key) === false) {
            roomDropped.push(`worldbookOverrides（沒有這本世界書：${key}）`)
            continue
          }
          if (value === null || value === undefined) continue
          if (typeof value !== 'object' || Array.isArray(value)) {
            roomDropped.push(`worldbookOverrides（${key} 要是一個物件）`)
            continue
          }
          const one = {}
          // `false` ＝ 這一間房不用這本書。`true`／沒給 ＝ 照酒館那一層（不寫進檔案）。
          if (value.enabled === false) one.enabled = false
          const position = typeof value.position === 'string' ? value.position : ''
          if (position !== '') {
            if (WORLDBOOK_POSITIONS.includes(position)) one.position = position
            else roomDropped.push(`worldbookOverrides（${key} 的位置不合法：${position}）`)
          }
          if (Object.keys(one).length > 0) out[key] = one
        }
        next.worldbookOverrides = out
      }
    }
    next.updatedAt = nowIso()
    await atomicWrite(join(dir, ROOM_FILE), `${JSON.stringify(next, null, 2)}\n`)
    return roomDropped.length === 0 ? next : { ...next, dropped: roomDropped }
  }

  /**
   * 確認一間房存在，回傳它的 id。
   *
   * ⚠️ **只認 id**。2.6.6 剛上線時這一支還接受「顯示名稱」（目的是讓客戶端不必一次改
   * 19 個呼叫點），但那個相容層的代價是三個 bug——最典型的是：同名可以有兩間房，
   * 依名字解析會命中**第一間**，症狀是「新開的房，訊息全跑進同一個對話框」。
   *
   * 客戶端現在一律送 id（`room.room`），所以名稱那條路在 2.6.7 拿掉了。
   * **顯示名稱仍然可以重複、可以改，只是不當身分**——那正是這個佈局的重點。
   */
  async resolveRoom(character, room) {
    const who = requireId(character, '角色 id')
    const id = requireId(room, '房間 id')
    const chat = join(this.resolveWithin('chats', who), id, CHAT_FILE)
    if ((await stat(chat).catch(() => undefined)) === undefined) {
      // 訊息要**可行動**：帶上相對路徑，使用者可以直接去看那個資料夾在不在。
      throw new Error(`找不到這間房：chats/${who}/${id}`)
    }
    return id
  }

  /**
   * 一間房的資料夾。逐段驗證——`..` 之類的跳脫在 `resolveWithin` 被擋下。
   *
   * ⚠️ 房間 id **不套** `segmentFromName`：它是我們自己產的
   * （`時間 base36-隨機4碼`），把使用者的輸入正規化只會掩蓋傳錯值的 bug。
   */
  roomDir(character, room) {
    const who = requireId(character, '角色 id')
    const id = requireId(room, '房間 id')
    return this.resolveWithin('chats', who, id)
  }

  /** 房裡的插圖資料夾（跟著房間走，不再散到 `art/chats/`）。 */
  roomArtDir(character, room) {
    return join(this.roomDir(character, room), 'art')
  }

  /**
   * 房裡的**附件**資料夾（`<room>/files/`）。
   *
   * 與插圖分開放是刻意的：`art/` 是「這個實體長什麼樣」（海報牆、主圖、表情圖都在讀它），
   * 附件是「這一則訊息夾帶了什麼」。混在一起會讓主圖挑到一個 PDF。
   */
  roomFilesDir(character, room) {
    return join(this.roomDir(character, room), ROOM_FILES_DIR)
  }

  /**
   * 列出一個角色的所有房間。
   *
   * **只認資料夾**：`chats/<角色>/` 底下只要是目錄、而且裡面有 `room.json` 或
   * `chat.jsonl`，就是一間房。舊格式的 `<名>.jsonl`（檔案）**刻意不讀**——
   * 使用者同意「刪除重新來」，所以不做兩種形狀並存（那正是這類改動最容易長 bug
   * 的地方，見 `docs/room-layout.md` §5）。
   *
   * @returns `[{ character, room, name, file, size, artCount, roomPrompt, allowTools, model }]`。
   */
  async listRooms(character) {
    const who = requireId(character, '角色 id')
    const dir = this.resolveWithin('chats', who)
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const rooms = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const room = entry.name
      const settings = await this.readRoom(who, room)
      const info = await stat(join(dir, room, CHAT_FILE)).catch(() => undefined)
      // 沒有對話檔、也沒有名字的資料夾是殘骸，不當一間房。
      if (info === undefined && settings.name === '') continue
      const art = await readdir(join(dir, room, 'art')).catch(() => [])
      rooms.push({
        character: who,
        room,
        name: settings.name === '' ? room : settings.name,
        file: `${room}/${CHAT_FILE}`,
        size: info === undefined ? null : info.size,
        artCount: art.length,
        roomPrompt: settings.roomPrompt,
        allowTools: settings.allowTools,
        model: settings.model,
        // 生成參數（`null` ＝ 聽酒館的）。客戶端「⚙️ 房間」那一格要顯示目前的值，
        // 所以它必須在**清單的投影**裡——漏了這一條的症狀是「存了但格子是空的」。
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        stop: settings.stop,
        stopEnabled: settings.stopEnabled,
        worldbookPosition: settings.worldbookPosition,
      })
    }
    return rooms.sort((left, right) => String(left.room).localeCompare(String(right.room)))
  }

  /**
   * 讀一間房的訊息（不含標頭行）。
   *
   * 形狀與 `readChatMessages` 一致。解析刻意**寬鬆**：壞掉的行跳過——不要因為一行
   * 壞掉就讓整間房打不開。
   */
  async readRoomMessages(character, room) {
    let raw = ''
    try {
      raw = await readFile(join(this.roomDir(character, room), CHAT_FILE), 'utf8')
    } catch (error) {
      return []
    }
    const out = []
    for (const line of raw.split('\n')) {
      const text = line.trim()
      if (text === '') continue
      let record
      try {
        record = JSON.parse(text)
      } catch (error) {
        continue
      }
      // 第一行是標頭（有 `chat_metadata`），不是訊息。
      if (record === null || typeof record !== 'object' || record.chat_metadata !== undefined) continue
      if (typeof record.mes !== 'string') continue
      const extra = record.extra !== null && typeof record.extra === 'object' ? record.extra : {}
      // ⚠️ `extra` 是 SillyTavern 的自由欄位，酒館的東西住在裡面：
      //   `reasoning`＝思考、`usage`／`ms`＝那一輪的用量與用時（DSH 那兩個「用量／用时」的
      //   小標籤就是讀這兩個）。**壞掉的值一律當沒有**，不要讓一行壞資料毀掉整則訊息。
      const usage = extra.usage !== null && typeof extra.usage === 'object' ? extra.usage : null
      out.push({
        name: typeof record.name === 'string' ? record.name : 'unused',
        isUser: record.is_user === true,
        isSystem: record.is_system === true,
        sendDate: typeof record.send_date === 'string' ? record.send_date : '',
        text: record.mes,
        reasoning: typeof extra.reasoning === 'string' ? extra.reasoning : '',
        usage:
          usage === null
            ? null
            : {
                input: typeof usage.input === 'number' ? usage.input : 0,
                output: typeof usage.output === 'number' ? usage.output : 0,
                cacheRead: typeof usage.cacheRead === 'number' ? usage.cacheRead : 0,
                cacheWrite: typeof usage.cacheWrite === 'number' ? usage.cacheWrite : 0,
                reasoning: typeof usage.reasoning === 'number' ? usage.reasoning : 0,
              },
        ms: typeof extra.ms === 'number' && extra.ms >= 0 ? extra.ms : null,
        // 那一則夾帶的附件（圖片／檔案）。`extra.media` 是 SillyTavern 自己的欄位，
        // 我們用它存「這一則訊息帶了什麼」——重新整理之後畫得出來靠的就是它。
        media: normalizeMediaList(extra.media),
        // 那一輪的 provider／model（DSH 訊息上「提供方 / 模型」那一列）。
        route:
          extra.route !== null &&
          typeof extra.route === 'object' &&
          typeof extra.route.provider === 'string' &&
          typeof extra.route.model === 'string'
            ? {
                provider: extra.route.provider,
                model: extra.route.model,
                // 推理等級（有換過等級才會有）——chip 上那一格靠它。
                effort: typeof extra.route.effort === 'string' ? extra.route.effort : '',
              }
            : null,
      })
    }
    return out
  }

  /** 把一輪對話追加到房間的 `chat.jsonl`（形狀與 `appendChatMessages` 相同）。 */
  async appendRoomMessages(character, room, messages) {
    const path = join(this.roomDir(character, room), CHAT_FILE)
    if ((await stat(path).catch(() => undefined)) === undefined) {
      throw new Error(`找不到這間房：${String(room)}`)
    }
    const lines = []
    for (const message of Array.isArray(messages) ? messages : []) {
      const text = typeof message?.text === 'string' ? message.text : ''
      // ⚠️ 空正文**只有在沒有附件時**才跳過：丟一張圖不說話是合法的（SillyTavern
      // 也允許），而「沒有正文就整則丟掉」會讓那張圖從紀錄裡消失。
      const media = normalizeMediaList(message?.media)
      if (text === '' && media.length === 0) continue
      const record = {
        name: typeof message?.name === 'string' && message.name !== '' ? message.name : 'unused',
        is_user: message?.isUser === true,
        is_system: message?.isSystem === true,
        send_date:
          typeof message?.sendDate === 'string' && message.sendDate !== '' ? message.sendDate : nowIso(),
        mes: text,
      }
      const reasoning = typeof message?.reasoning === 'string' ? message.reasoning : ''
      // `extra` 只在真的有東西時才寫（保持既有檔案的最小形狀）。
      //   `usage`／`ms`＝那一輪的用量與用時——DSH 把它們顯示在**訊息上**
      //   （「用量 22.6M tok」「用时 3分28秒」），所以跟著訊息一起存才活得過重新整理。
      const extra = {}
      if (reasoning !== '') extra.reasoning = reasoning
      const usage = message?.usage
      if (usage !== null && typeof usage === 'object') {
        const num = (value) => (typeof value === 'number' && value >= 0 ? value : 0)
        extra.usage = {
          input: num(usage.input),
          output: num(usage.output),
          cacheRead: num(usage.cacheRead),
          cacheWrite: num(usage.cacheWrite),
          reasoning: num(usage.reasoning),
        }
      }
      if (typeof message?.ms === 'number' && message.ms >= 0) extra.ms = message.ms
      // 附件（圖片／檔案）：`extra.media`——SillyTavern 的自由欄位之一，欄名照它。
      if (media.length > 0) extra.media = media
      const route = message?.route
      if (
        route !== null &&
        typeof route === 'object' &&
        typeof route.provider === 'string' &&
        typeof route.model === 'string'
      ) {
        extra.route = {
          provider: route.provider,
          model: route.model,
          // 空字串＝沒指定（提供方預設），不要寫成 undefined。
          effort: typeof route.effort === 'string' ? route.effort : '',
        }
      }
      if (Object.keys(extra).length > 0) record.extra = extra
      lines.push(JSON.stringify(record))
    }
    if (lines.length === 0) return 0
    await appendFile(path, `${lines.join('\n')}\n`, 'utf8')
    return lines.length
  }

  /**
   * 改一間房的名字。
   *
   * ⚠️ **只改 `room.json` 裡的 `name`，不動任何路徑**——這就是房間用 id 當身分的
   * 全部目的。舊的 `renameChat` 要同時搬四處（檔名、`.sessions` 對照表、插圖資料夾、
   * `tavern.json` 的主圖 key），這裡一行都不用搬。
   */
  async renameRoom(character, room, name) {
    // ⚠️ 先 `resolveRoom`：它找不到就丟「找不到這間房」。
    // 不能直接 `writeRoom`——那一支會順手 `mkdir`（給 ⚙️ 房間 分頁的防禦），
    // 於是「對不存在的房間改名」會**默默把它建出來**。改名的前提是它存在。
    const id = await this.resolveRoom(character, room)
    const next = await this.writeRoom(character, id, { name: name })
    return { character: character, room: id, name: next.name }
  }

  /**
   * 刪一間房：**整個資料夾刪掉**（設定、對話、插圖都跟著走）。
   *
   * 這與舊的 `deleteChat` 不同：舊的只刪那個 `.jsonl`、插圖留在原地（會留孤兒圖）。
   * 房間的資源既然跟著房間走，刪除就是刪除整個房間——使用者的心智模型也一致：
   * 「我把這間房拆了」。
   *
   * 但對照表仍然要一起清：它是「關於這間房」的中繼資料，房間沒了它就是指向空氣。
   */
  async deleteRoom(character, room) {
    const who = requireId(character, '角色 id')
    const id = requireId(room, '房間 id')
    const dir = this.resolveWithin('chats', who, id)
    if ((await stat(dir).catch(() => undefined)) === undefined) {
      throw new Error(`找不到這間房：chats/${who}/${id}`)
    }
    // ⚠️ **先讀設定，再刪資料夾。** 反過來的話 `readRoom` 只會拿到預設值
    // （資料夾已經不在了），顯示名稱那條比對就永遠不成立——症狀是「刪掉了，
    // 但說沒有解掉任何 session」，而且看起來像綁定比對寫錯。
    const settings = await this.readRoom(who, id)
    await rm(dir, { recursive: true, force: true })
    // 綁定裡記的可能是房間 id（新的），也可能是顯示名稱（舊的、或使用者看到的那個）。
    // 兩種都認。
    const unbound = []
    for (const record of await this.listSessionBindings()) {
      if (record.character !== who) continue
      const matches =
        record.room === id || record.chat === id || (settings.name !== '' && record.chat === settings.name)
      if (matches) {
        await this.unbindSession(record.sessionId)
        unbound.push(record.sessionId)
      }
    }
    return { character: who, room: id, unbound: unbound }
  }





  /**
   * 把匯入的原始卡片檔留一份。
   *
   * 為什麼只有 PNG 需要：PNG 卡除了卡片 JSON，還有**我們重建不出來的圖片位元組**。
   * 我們自己的儲存格式是 `<id>.json`，所以那張圖不留就真的沒了。
   * 相對地，JSON 卡的文字就是資料本身，寫出去不會失真，不需要多留一份。
   *
   * 位置刻意放在 `originals/cards/`，**不在 `characters/` 底下**：
   * `characters/` 是 SillyTavern 會讀的目錄，多放非卡片檔案會污染它的角色庫。
   *
   * @param id - 角色 id（檔名，不含副檔名）
   * @param bytes - 原始 PNG 位元組
   * @returns 有沒有真的留下來（同名已存在時回 false，不覆蓋）
   */
  async keepCardOriginal(id, bytes) {
    const key = requireId(id, '角色 id')
    const dir = this.resolveWithin('originals', 'cards')
    await mkdir(dir, { recursive: true })
    const target = this.resolveWithin('originals', 'cards', `${key}.png`)
    try {
      await createExclusive(target, bytes)
      return true
    } catch (error) {
      // 已經有一份原版了就不覆蓋——原版的意義就是「第一次匯進來的樣子」。
      if (isExistsError(error)) return false
      throw error
    }
  }

  /* --------------------- 對話 ↔ DSH session 的對照表 --------------------- */

  /**
   * 把一個 DSH session 綁到這個酒館裡的一份對話。
   *
   * @param sessionId - DSH 的 session id（會變成檔名，所以先驗證）。
   * @param record - `{ character, chat, room? }`；`chat` 是**顯示名稱**，
   *   `room` 是**房間 id**（有它 agent 面才找得到 `room.json`）。
   * @returns 寫進去的完整紀錄（含 `sessionId` 與 `boundAt`）。
   *
   * 原子寫入：這一條會在**對話正在跑**的時候被讀（Agent 面每一次模型請求都讀），
   * 所以不能讓它讀到寫到一半的檔案。
   */
  async bindSession(sessionId, record) {
    const id = requireSessionId(sessionId)
    const character = requireId(record?.character, '角色 id')
    const chat = segmentFromName(record?.chat)
    if (chat === '') throw new Error('對話名稱不可為空')
    // NOT a whitelist bug this time——這裡是**明確列出**要寫的欄位，所以新增欄位
    // 一定要回來加。`room` 是房間的身分：agent 面靠它讀 `room.json`，套用「這一場的
    // 指示」與工具權限（`roomField`）。舊綁定沒有它就退回酒館那一層，不會壞。
    const room = typeof record?.room === 'string' && record.room !== '' ? record.room : ''

    await this.ensure()
    const dir = this.dir(SESSIONS_DIR)
    await mkdir(dir, { recursive: true })

    // 已經有綁定就保留原本的 boundAt（重新綁定不該假裝是新開的對話）。
    const previous = await this.readSession(id)
    const next = {
      version: 1,
      sessionId: id,
      character,
      room,
      chat,
      boundAt: typeof previous?.boundAt === 'string' ? previous.boundAt : nowIso(),
      updatedAt: nowIso(),
    }
    await atomicWrite(this.resolveWithin(SESSIONS_DIR, `${id}.json`), `${JSON.stringify(next, null, 2)}\n`)
    return next
  }

  /**
   * 讀一個 session 的綁定。
   *
   * @returns 綁定紀錄，或 `null`（沒綁定／壞檔／id 不合法）。
   *
   * **永遠不丟錯**：Agent 面在每一次模型請求裡呼叫它，在那裡丟錯等於
   * 「每一輪都失敗」。讀不到就回 `null`，讓上層決定要不要退回預設行為。
   */
  async readSession(sessionId) {
    if (typeof sessionId !== 'string' || SAFE_SESSION_ID.test(sessionId) === false) return null
    try {
      const raw = await readFile(this.resolveWithin(SESSIONS_DIR, `${sessionId}.json`), 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      if (typeof parsed.character !== 'string' || typeof parsed.chat !== 'string') return null
      return parsed
    } catch {
      return null
    }
  }

  /** 解掉一個 session 的綁定。回傳「本來有沒有」。 */
  async unbindSession(sessionId) {
    const id = requireSessionId(sessionId)
    const before = await this.readSession(id)
    await rm(this.resolveWithin(SESSIONS_DIR, `${id}.json`), { force: true })
    return before !== null
  }

  /** 列出這間酒館所有的綁定（給「這份對話接的是哪個 session」的反查用）。 */
  async listSessionBindings() {
    const dir = this.dir(SESSIONS_DIR)
    const files = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json')).sort()
    const bindings = []
    for (const file of files) {
      const record = await this.readSession(file.slice(0, -'.json'.length))
      if (record !== null) bindings.push(record)
    }
    return bindings
  }

  /**
   * 依 `chats/` 的內容重建對照表。
   *
   * 對照表是**索引**不是真相：真正的關聯寫在每個 `.jsonl` 第一行的
   * `chat_metadata.dsh_session_id`。所以索引掉了、被手動刪了、或從別的機器
   * 複製過來，都跑一次這個就能長回來。
   *
   * @returns 重建了幾筆。
   */
  async rebuildSessionBindings() {
    const chats = await this.listAllRooms()
    let rebuilt = 0
    for (const chat of chats) {
      // 用**房間 id**（`chat.room`）讀標頭——`chat.name` 是顯示名稱，改過名就對不上路徑。
      const sessionId = await this.readChatSessionId(chat.character, chat.room)
      if (sessionId === null) continue
      // `room` 與 `chat` 都寫：新的讀 `room`，舊的讀 `chat`（相容期）。
      await this.bindSession(sessionId, {
        character: chat.character,
        room: chat.room,
        chat: chat.name,
      })
      rebuilt += 1
    }
    return rebuilt
  }

  /**
   * 讀一份對話的標頭，取出它綁的 session id。
   *
   * 只讀第一行——對話檔可能很大，沒有理由為了看標頭把整個檔案讀進來。
   */
  async readChatSessionId(character, chat) {
    const who = requireId(character, '角色 id')
    // 「chat」可能是房間 id 或顯示名稱（相容期）。找不到就回 `null`——**fail-soft**：
    // 這一支的用途是「盡量把索引長回來」，不是「檢查使用者有沒有弄錯」。
    let room
    try {
      room = await this.resolveRoom(who, chat)
    } catch (error) {
      return null
    }
    try {
      const handle = await open(join(this.roomDir(who, room), CHAT_FILE), 'r')
      try {
        const buffer = Buffer.alloc(64 * 1024)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0]
        const header = JSON.parse(firstLine)
        const id = header?.chat_metadata?.dsh_session_id
        return typeof id === 'string' && SAFE_SESSION_ID.test(id) ? id : null
      } finally {
        await handle.close()
      }
    } catch {
      return null
    }
  }

  /**
   * 把 session id 寫進對話檔的標頭行。
   *
   * 標頭是檔案的第一行，改它就得重寫整個檔案。這裡用「讀進來、換掉第一行、
   * 原子寫回」——對話檔是 append-only，所以這不會打亂後面任何一則訊息。
   *
   * @returns 有沒有改到東西。
   */
  async stampChatSessionId(character, chat, sessionId) {
    const who = requireId(character, '角色 id')
    const id = requireSessionId(sessionId)
    // 「chat」現在可能是房間 id，也可能是顯示名稱（相容期，同 `resolveRoom`）。
    // 找不到就回 `false`——**維持原本的 fail-soft**：這一步是加分項，
    // 不該讓 `session.bind` 整個失敗（以前是「檔案讀不到就回 false」）。
    let room
    try {
      room = await this.resolveRoom(who, chat)
    } catch (error) {
      return false
    }
    const path = join(this.roomDir(who, room), CHAT_FILE)

    let raw
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      return false
    }
    const newline = raw.indexOf('\n')
    if (newline < 0) return false

    let header
    try {
      header = JSON.parse(raw.slice(0, newline))
    } catch {
      return false
    }
    if (header === null || typeof header !== 'object' || Array.isArray(header)) return false
    const metadata = header.chat_metadata !== null && typeof header.chat_metadata === 'object' ? header.chat_metadata : {}
    if (metadata.dsh_session_id === id) return false
    header.chat_metadata = { ...metadata, dsh_session_id: id }

    await atomicWrite(path, `${JSON.stringify(header)}${raw.slice(newline)}`)
    return true
  }

  /* ------------------------------ 插圖 ------------------------------ */

  /**
   * 某個實體的插圖狀態（清單 + 目前的主圖）。
   * @param kind - `character` / `worldbook` / `chat` / `tavern`
   * @param id - 人物卡／世界書的檔名；對話是 `角色/對話名`；`tavern` 省略
   * @param prefetched - 已經讀好的 `tavern.json`（批次列舉時避免每個實體重讀一次）
   */
  async describeEntityAssets(kind, id, prefetched) {
    const owner = parseAssetOwner(kind, id)
    const settings = prefetched === undefined ? await this.readSettings() : prefetched
    const described = await describeAssets(this.root, kind, owner, settings)
    /**
     * **PNG 卡本身就是她的立繪**：沒有另外的插圖時，卡片那張圖就是頭像／海報。
     *
     * 做法是把卡片當成一個「虛擬的插圖項目」加進清單（`source: 'card'`）——
     * 客戶端不必為了 PNG 卡多一條路徑，`findAssetUrl(assets, primary)` 直接就能用。
     *
     * ⚠️ 它**只加在後面**：`items` 的順序就是「檔名排序」，而 `pickPrimary` 在沒有指定
     * 主圖時取第一張——所以既有插圖永遠優先，卡片只是後備（使用者上傳了圖就以圖為準）。
     * 也因為它不是真的插圖，客戶端**不給刪**（`source: 'card'`）。
     */
    const items = described.items.slice()
    if (kind === 'character') {
      const found = await this.cardFileOf(owner.id)
      if (found !== null && found.ext === 'png') {
        const name = cardAssetName(owner.id)
        if (!items.some((item) => item.name === name)) {
          const info = await stat(this.resolveWithin('characters', found.file)).catch(() => undefined)
          items.push({
            name,
            bytes: info === undefined ? 0 : info.size,
            mtimeMs: info === undefined ? 0 : info.mtimeMs,
            url: cardUrl(owner.id),
            source: 'card',
          })
        }
      }
    }
    // 對外只回面板要用的：清單、主圖、擁有者名稱（主圖設定需要它當 key）。
    const primary =
      described.primary === null && items.length > 0 ? items[0].name : described.primary
    return { items, primary, owner: described.name }
  }

  /**
   * 指定某個實體的主圖。
   * @param name - 檔名（必須是這個實體現有的圖）
   * @returns 更新後的 `tavern.json`
   */
  async setPrimaryAsset(kind, id, name) {
    await this.ensure()
    const owner = parseAssetOwner(kind, id)
    const listed = await this.describeEntityAssets(kind, id)
    if (!listed.items.some((item) => item.name === name)) {
      throw new Error(`這個實體沒有這張圖：${String(name)}`)
    }
    const current = await this.readSettings()
    const next = nextPrimaryMap(readPrimaryMap(current), kind, owner.name, name)
    return this.writeSettings({ assets: next })
  }

  /**
   * 取消指定主圖（回到「檔名排序的第一張」）。
   * @returns 更新後的 `tavern.json`
   */
  async clearPrimaryAsset(kind, id) {
    await this.ensure()
    const owner = parseAssetOwner(kind, id)
    const current = await this.readSettings()
    const next = nextPrimaryMap(readPrimaryMap(current), kind, owner.name, null)
    return this.writeSettings({ assets: next })
  }
}

/* ------------------------------ 卡片信封 ------------------------------ */

/** 從 `{spec, data}` 信封取出卡片資料；不是信封就原樣回傳。 */
export function unwrapCard(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const data = parsed.data
  if (typeof parsed.spec === 'string' && data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return { ...data }
  }
  return { ...parsed }
}

/** 包成 SillyTavern 相容信封（v2：最通用的版本）。 */
export function toCardEnvelope(card) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { ...card } }
}
