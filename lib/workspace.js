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
import { CUSTOM_CSS_FILE, THEME_FILE, normalizeTheme } from './theme.js'
import {
  ASSETS_FIELD,
  assetIdFor,
  normalizeAssetId,
  parseAssetOwner,
  makeAssetIdResolver,
  nextPrimaryMap,
  readPrimaryMap,
  describeAssets,
} from './assets.js'

/** 一間酒館的固定子資料夾。 */
export const SUBDIRS = ['characters', 'worldbooks', 'chats', 'art']

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

  characters/   人物卡：一張卡一個 .json（SillyTavern 相容格式）
  worldbooks/   世界書：一個 .json 一本
  chats/        對話紀錄：chats/<角色>/<對話名>.jsonl
  art/          插圖：一項一個資料夾，可以放很多張（表情圖、動作圖）
                  art/characters/<卡 id>/*.png
                  art/worldbooks/<書 id>/*.png
                  art/chats/<角色>/<對話名>/*.png
                  art/tavern/*.png ← 酒館自己的店面／背景圖
  tavern.json   這間酒館自己的設定（含「哪一張是主圖」）

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

    const cardPath = this.resolveWithin('characters', `${DEFAULT_CHARACTER_ID}.json`)
    try {
      await createExclusive(cardPath, `${JSON.stringify(toCardEnvelope(defaultCharacter()), null, 2)}\n`)
      created.push(`characters/${DEFAULT_CHARACTER_ID}.json`)
    } catch (error) {
      // 已經有同名的卡就不覆蓋——那是使用者的東西。
      if (!isExistsError(error)) throw error
    }

    const bookPath = this.resolveWithin('worldbooks', `${DEFAULT_WORLDBOOK_ID}.json`)
    try {
      await createExclusive(bookPath, `${JSON.stringify(defaultWorldbook(), null, 2)}\n`)
      created.push(`worldbooks/${DEFAULT_WORLDBOOK_ID}.json`)
    } catch (error) {
      if (!isExistsError(error)) throw error
    }

    // 輸出格式是**預設**，不是選配——沒有它模型就吐普通小說，解析器只能靠推斷。
    // 它跟其他世界書一樣是普通檔案：使用者看得到、改得動、刪得掉。
    const formatPath = this.resolveWithin('worldbooks', `${FORMAT_WORLDBOOK_ID}.json`)
    try {
      await createExclusive(formatPath, `${JSON.stringify(defaultFormatWorldbook(), null, 2)}\n`)
      created.push(`worldbooks/${FORMAT_WORLDBOOK_ID}.json`)
    } catch (error) {
      if (!isExistsError(error)) throw error
    }

    return created
  }

  /** 這間酒館的概況：路徑、名稱、各類檔案數量，以及實際存在哪些項目。 */
  async summary() {
    const exists = await this.exists()
    const counts = { characters: 0, worldbooks: 0, chats: 0, art: 0 }
    let scaffolded = false
    const files = []
    if (exists) {
      const cards = await readdir(this.dir('characters'), { withFileTypes: true }).catch(() => [])
      counts.characters = cards.filter((file) => file.isFile() && file.name.endsWith('.json')).length
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
    const fallback = { version: 1, name: '', note: '', userName: '', userPersona: '', tavernPrompt: '', allowTools: 'none', createdAt: '' }
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
    if (patch?.assets !== undefined) {
      if (patch.assets === null || typeof patch.assets !== 'object' || Array.isArray(patch.assets)) {
        throw new Error('assets 必須是物件（{ "種類:名稱": "檔名" }）')
      }
      next.assets = readPrimaryMap({ [ASSETS_FIELD]: patch.assets })
    }
    next.updatedAt = nowIso()
    // 原子寫入：這是「我們管理的檔案」，寫壞了就等於設定全丟。
    await atomicWrite(this.resolveWithin(SETTINGS_FILE), `${JSON.stringify(next, null, 2)}\n`)
    return next
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
  async listCharacters() {
    const dir = this.dir('characters')
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const cards = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      // 只收檔案：`characters/<id>/` 這種資料夾（如果有）不是卡片。
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const file = entry.name
      const id = file.slice(0, -5)
      const assets = await this.describeEntityAssets('character', id)
      try {
        const parsed = JSON.parse(await readFile(join(dir, file), 'utf8'))
        const card = unwrapCard(parsed)
        cards.push({
          id,
          file,
          name: typeof card.name === 'string' && card.name !== '' ? card.name : id,
          card,
          assets,
          error: '',
        })
      } catch {
        cards.push({ id, file, name: id, card: null, assets, error: '無法解析這個 JSON' })
      }
    }
    return cards
  }

  /** 讀一張卡（原始物件）。 */
  async readCharacter(id) {
    const key = requireId(id, '角色 id')
    const raw = await readFile(this.resolveWithin('characters', `${key}.json`), 'utf8')
    return unwrapCard(JSON.parse(raw))
  }

  /**
   * 寫一張卡。
   *
   * 一律寫成 SillyTavern 相容信封（`{spec, spec_version, data}`），所以檔案
   * 丟回任何相容前端都載得進去；`data` 裡的未知欄位原樣保留（面板只改它認得的欄位）。
   * @returns 實際寫入的 id。
   */
  async writeCharacter(id, card) {
    await this.ensure()
    if (card === null || typeof card !== 'object' || Array.isArray(card)) {
      throw new Error('角色卡必須是物件')
    }
    const fromId = typeof id === 'string' && id.trim() !== '' ? requireId(id, '角色 id') : ''
    const base = fromId || segmentFromName(card.name) || `card-${Date.now().toString(36)}`
    // 原子寫入：這是使用者擁有的檔案（見 docs/storage-layout.md §4）。
    await atomicWrite(
      this.resolveWithin('characters', `${base}.json`),
      `${JSON.stringify(toCardEnvelope(card), null, 2)}\n`,
    )
    return base
  }

  /** 刪一張卡（只刪這一個檔案）。 */
  async deleteCharacter(id) {
    const key = requireId(id, '角色 id')
    await rm(this.resolveWithin('characters', `${key}.json`), { force: true })
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
    next.updatedAt = nowIso()
    await atomicWrite(join(dir, ROOM_FILE), `${JSON.stringify(next, null, 2)}\n`)
    return next
  }

  /**
   * 確認一間房存在，回傳它的 id。
   *
   * ⚠️ **只認 id**。2.6.6 剛上線時這一支還接受「顯示名稱」（目的是讓客戶端不必一次改
   * 19 個呼叫點），但那個相容層的代價是三個 bug——最典型的是：同名可以有兩間房，
   * 依名字解析會命中**第一間**，症狀是「新開的房，訊息全跑進同一個對話框」。
   *
   * 客戶端現在一律送 id（`chat.room`），所以名稱那條路在 2.6.7 拿掉了。
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
      out.push({
        name: typeof record.name === 'string' ? record.name : 'unused',
        isUser: record.is_user === true,
        isSystem: record.is_system === true,
        sendDate: typeof record.send_date === 'string' ? record.send_date : '',
        text: record.mes,
        reasoning:
          record.extra !== null && typeof record.extra === 'object' && typeof record.extra.reasoning === 'string'
            ? record.extra.reasoning
            : '',
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
      if (text === '') continue
      const record = {
        name: typeof message?.name === 'string' && message.name !== '' ? message.name : 'unused',
        is_user: message?.isUser === true,
        is_system: message?.isSystem === true,
        send_date:
          typeof message?.sendDate === 'string' && message.sendDate !== '' ? message.sendDate : nowIso(),
        mes: text,
      }
      const reasoning = typeof message?.reasoning === 'string' ? message.reasoning : ''
      if (reasoning !== '') record.extra = { reasoning }
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
    // 對外只回面板要用的：清單、主圖、擁有者名稱（主圖設定需要它當 key）。
    return { items: described.items, primary: described.primary, owner: described.name }
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
