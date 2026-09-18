/**
 * 酒館街：有哪些酒館、目前在哪一間。
 *
 * 註冊表只是一個清單檔（`~/.dsh/taverns.json`），內容是「使用者的資料夾在哪裡」。
 * 每間酒館的內容與設定都住在它自己的資料夾裡，這裡不碰。
 *
 * 兩個刻意的設計：
 *   - **不會自動建立任何酒館**：唯一的建立入口是 `add()`（＝側邊欄那顆 ＋）。
 *   - 註冊表壞掉時退化成空清單，面板永遠開得起來（不會讓 DSH 卡住）。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { atomicWrite } from './write.js'
import { TavernWorkspace, resolveDshHome } from './workspace.js'

/** 註冊表檔名（放在 DSH home，不是任何酒館資料夾裡）。 */
export const REGISTRY_FILE = 'taverns.json'

/** 註冊表版本，方便之後遷移。 */
export const REGISTRY_VERSION = 1

/** 空的註冊表。 */
const emptyState = () => ({ version: REGISTRY_VERSION, activeId: '', taverns: [] })

/** 由資料夾路徑推導顯示名稱。 */
function nameFromPath(path) {
  const parts = resolve(path).split(/[\\/]/).filter((part) => part !== '')
  return parts.length > 0 ? parts[parts.length - 1] : path
}

/** 一筆新記錄。 */
function tavernRecord(path, name) {
  const absolute = resolve(path)
  return {
    id: randomUUID(),
    name: typeof name === 'string' && name.trim() !== '' ? name.trim() : nameFromPath(absolute),
    path: absolute,
    addedAt: new Date().toISOString(),
    // 酒館街那一列顯示的圖示（emoji 或短字串）；空字串＝用內建的彩色燈籠。
    icon: '',
  }
}

/**
 * 酒館註冊表。
 *
 * @param home - DSH home 目錄
 */
export class TavernRegistry {
  constructor(home) {
    this.home = home
    this.file = join(home, REGISTRY_FILE)
  }

  /** 由環境建立（`DSH_HOME` 優先）。 */
  static fromEnv(env) {
    return new TavernRegistry(resolveDshHome(env))
  }

  /** 讀註冊表；壞掉或不存在時回傳空狀態。 */
  async read() {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.taverns)) return emptyState()
      const taverns = parsed.taverns
        .filter((item) => item !== null && typeof item === 'object' && typeof item.path === 'string')
        .map((item) => ({
          id: typeof item.id === 'string' && item.id !== '' ? item.id : randomUUID(),
          name: typeof item.name === 'string' && item.name !== '' ? item.name : nameFromPath(item.path),
          path: resolve(item.path),
          addedAt: typeof item.addedAt === 'string' ? item.addedAt : '',
          icon: typeof item.icon === 'string' ? item.icon : '',
        }))
      const activeId = taverns.some((item) => item.id === parsed.activeId) ? parsed.activeId : (taverns[0]?.id ?? '')
      return { version: REGISTRY_VERSION, activeId, taverns }
    } catch {
      return emptyState()
    }
  }

  /** 寫註冊表（原子寫入：這是酒館街唯一的真相，寫壞就整條街不見）。 */
  async write(state) {
    await mkdir(dirname(this.file), { recursive: true })
    await atomicWrite(this.file, `${JSON.stringify({ ...state, version: REGISTRY_VERSION }, null, 2)}\n`)
  }

  /** 列出所有酒館，附上每個的存在狀態與計數。 */
  async list() {
    const state = await this.read()
    const taverns = []
    for (const record of state.taverns) {
      const summary = await new TavernWorkspace(record.path).summary()
      taverns.push({
        id: record.id,
        name: record.name,
        path: record.path,
        addedAt: record.addedAt,
        icon: record.icon,
        exists: summary.exists,
        // 沒有 tavern.json ⇒ 這個資料夾不是這一版建立的（v1 的「預設酒館」就是這樣）。
        // 面板靠這個標記把舊紀錄跟正常酒館分開，不然使用者會以為新增時多冒出一間。
        scaffolded: summary.scaffolded,
        counts: summary.counts,
        active: record.id === state.activeId,
      })
    }
    return { activeId: state.activeId, taverns }
  }

  /**
   * 加入一間酒館，並在資料夾裡建立固定結構。
   * @param path - 使用者選的資料夾（會 resolve 成絕對路徑）。
   * @param name - 顯示名稱；省略時用資料夾名。
   * @returns `{ tavern, created, skeleton }`；同一條路徑已經註冊過時 `created: false`。
   */
  async add(path, name) {
    const state = await this.read()
    const absolute = resolve(path)
    const existing = state.taverns.find((item) => resolve(item.path) === absolute)
    if (existing !== undefined) {
      await this.write({ ...state, activeId: existing.id })
      return { tavern: existing, created: false, skeleton: [] }
    }
    const record = tavernRecord(absolute, name)
    await this.write({ ...state, taverns: [...state.taverns, record], activeId: record.id })
    // 建結構 ＋ 附上預設內容（老闆娘與世界書）；失敗也保留記錄，
    // 面板會顯示錯誤讓使用者自己處理。
    const skeleton = await new TavernWorkspace(record.path)
      .seed()
      .catch(() => [])
    return { tavern: record, created: true, skeleton }
  }

  /** 移除一間酒館（只從清單移除，**不刪磁碟上的資料夾**）。 */
  async remove(id) {
    const state = await this.read()
    const next = state.taverns.filter((item) => item.id !== id)
    if (next.length === state.taverns.length) return { removed: false, activeId: state.activeId }
    const activeId = state.activeId === id ? (next[0]?.id ?? '') : state.activeId
    await this.write({ ...state, taverns: next, activeId })
    return { removed: true, activeId }
  }

  /** 選定目前要用的酒館。 */
  async select(id) {
    // id 一定要是字串。以前沒有這道檢查，所以「把整個酒館物件當 id 傳進來」
    // （客戶端真的發生過）會得到 `沒有這間酒館：[object Object]`——
    // 訊息完全指不出問題在哪。寧可現在就說清楚。
    if (typeof id !== 'string' || id === '') {
      throw new Error(`酒館 id 必須是字串（收到 ${id === null ? 'null' : typeof id}）`)
    }
    const state = await this.read()
    if (!state.taverns.some((item) => item.id === id)) throw new Error(`沒有這間酒館：${id}`)
    await this.write({ ...state, activeId: id })
    return id
  }

  /**
   * 更新顯示屬性（名稱／圖示）。只動註冊表。
   * @param patch - `{ name?, icon? }`；`icon` 空字串＝回到內建圖示。
   */
  async update(id, patch) {
    const state = await this.read()
    const target = state.taverns.find((item) => item.id === id)
    if (target === undefined) throw new Error(`沒有這間酒館：${String(id)}`)
    const name = typeof patch?.name === 'string' && patch.name.trim() !== '' ? patch.name.trim() : undefined
    const icon = typeof patch?.icon === 'string' ? patch.icon.trim().slice(0, 8) : undefined
    const next = state.taverns.map((item) =>
      item.id === id
        ? { ...item, ...(name === undefined ? {} : { name }), ...(icon === undefined ? {} : { icon }) }
        : item,
    )
    await this.write({ ...state, taverns: next })
    return id
  }

  /** 改顯示名稱（`update` 的別名）。 */
  async rename(id, name) {
    return this.update(id, { name })
  }

  /**
   * 取得目前選中的酒館（含它的 TavernWorkspace）。
   * @returns `{ record, workspace }`，沒有選中任何酒館時 undefined。
   */
  async active() {
    const state = await this.read()
    const record = state.taverns.find((item) => item.id === state.activeId)
    if (record === undefined) return undefined
    return { record, workspace: new TavernWorkspace(record.path) }
  }

  /**
   * 取得指定 id 的酒館；空字串或 undefined 時等同 `active()`。
   */
  async byId(id) {
    if (typeof id !== 'string' || id === '') return this.active()
    const state = await this.read()
    const record = state.taverns.find((item) => item.id === id)
    if (record === undefined) return undefined
    return { record, workspace: new TavernWorkspace(record.path) }
  }

  /**
   * 取得目前選中的酒館；沒有就丟錯，並附上可行的下一步。
   * 面板的操作都走這條，錯誤訊息要能直接顯示給使用者。
   */
  async requireActive() {
    const found = await this.active()
    if (found === undefined) throw new Error('還沒有選定酒館——請先在側邊欄的「酒館街」按 ＋ 選一個資料夾')
    const exists = await found.workspace.exists()
    if (!exists) throw new Error(`這間酒館的資料夾不存在了：${found.record.path}`)
    return found
  }

  /**
   * 取得指定酒館；找不到或資料夾不在就丟錯。
   * @param id - 酒館 id；空字串或 undefined 時等同 `requireActive()`。
   */
  async requireById(id) {
    if (typeof id !== 'string' || id === '') return this.requireActive()
    const found = await this.byId(id)
    if (found === undefined) throw new Error(`找不到這間酒館：${String(id)}`)
    const exists = await found.workspace.exists()
    if (!exists) throw new Error(`這間酒館的資料夾不存在了：${found.record.path}`)
    return found
  }
}
