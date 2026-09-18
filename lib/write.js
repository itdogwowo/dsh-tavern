/**
 * 寫入的兩條安全規則。
 *
 *   1. **原子寫入**：先寫暫存檔，再 rename 到位。斷電或行程被殺時，讀者看到的
 *      只有「舊的完整版本」或「新的完整版本」，不會有寫到一半的檔案。
 *   2. **獨佔建立**：只想新增、不想覆蓋時用 `wx`，撞名回報給呼叫端自己編號，
 *      而不是先 stat 再寫（那個中間有空窗）。
 *
 * 為什麼需要這一層：直接 `writeFile` 在磁碟上是「截斷 → 寫入 → 完成」三步，
 * 中間死掉就留下一個被截斷的半個檔案——舊的沒了、新的也不完整。
 * `tavern.json` 裝著主圖設定與酒館名稱，壞掉就是這些設定全丟。
 *
 * 這裡刻意不引入任何相依套件（本插件宿主半零執行期依賴）。
 */
import { open, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

/** 暫存檔的後綴：用 `.tmp-` 開頭，讓它一眼看得出來不是使用者的檔案。 */
const TEMP_MARK = '.tmp-'

/**
 * 可重試的 rename 錯誤碼。
 *
 * **Windows 特有**：如果目的地檔案正被另一個行程開著（例如使用者用編輯器開著
 * `tavern.json`，或我們自己有個讀取正在進行），`rename` 會直接失敗
 * （`EPERM`／`EBUSY`／`EACCES`），而不是像 POSIX 那樣無條件替換。
 *
 * 這在「同時有人讀」的情況下是**暫時性**的——對方讀完就換我們了，
 * 所以正確做法是短暫退避後重試，而不是把錯誤丟給使用者。
 * （這不是猜測：`smoke.mjs` 第 17 項就會實際踩到，第一次跑就是 EPERM。）
 */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])

/** rename 最多重試幾次（每次之間約 10ms → 全部用完約 0.5 秒）。 */
const RENAME_ATTEMPTS = 50

/** 等一下（毫秒）。 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 一個安全的暫存檔路徑（跟目標同目錄，確保 rename 不會跨分割區）。
 * @param target - 最終要寫入的檔案路徑
 */
export function temporaryPath(target) {
  return `${target}${TEMP_MARK}${randomUUID().slice(0, 8)}`
}

/**
 * 原子寫入：暫存檔 → rename。
 *
 * 失敗時會盡量把暫存檔清掉，不要在使用者的資料夾裡留垃圾。
 *
 * @param target - 最終路徑
 * @param data - 字串或 Buffer
 * @param options.mode - 檔案權限（例如 `0o600`）
 */
export async function atomicWrite(target, data, options) {
  const temp = temporaryPath(target)
  try {
    await writeFile(temp, data, options === undefined ? undefined : { mode: options.mode })
    await renameWithRetry(temp, target)
  } catch (error) {
    // 清掉暫存檔；清不掉也不能蓋掉原本的錯誤。
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * rename，但對 Windows 的暫時性鎖定讓步。
 *
 * 只有「目的地被別人開著」這類錯誤才重試；其他錯誤（例如路徑不存在、
 * 跨分割區）立刻往上丟，因為重試再多次也不會成功。
 */
async function renameWithRetry(from, to) {
  let last = null
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (!RETRYABLE_RENAME_CODES.has(error?.code)) throw error
      last = error
      // 線性退避：10ms、20ms、30ms…。同時有人讀的情況下通常一兩次就過。
      await sleep(10 * (attempt + 1))
    }
  }
  throw last
}

/**
 * 獨佔建立：檔案已存在時**絕不覆蓋**，而是丟出帶 `code` 的錯誤讓呼叫端處理。
 *
 * 用 `open(..., 'wx')` 而不是「先 stat 再寫」——後者兩個動作之間有空窗，
 * 而這正是我們要避免的東西。
 *
 * @returns 寫入的位元組數
 * @throws code 為 `EEXIST` 的錯誤（呼叫端通常會換一個名字重試）
 */
export async function createExclusive(target, data) {
  let handle
  try {
    handle = await open(target, 'wx')
    await handle.writeFile(data)
    return Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data), 'utf8')
  } finally {
    if (handle !== undefined) await handle.close().catch(() => {})
  }
}

/** 這個錯誤是不是「檔案已經存在」。 */
export function isExistsError(error) {
  return error !== null && typeof error === 'object' && error.code === 'EEXIST'
}

/**
 * 反覆嘗試獨佔建立，撞名就換下一個編號。
 *
 * 取代舊寫法（先 stat 檢查存在、再 `flag: 'wx'` 寫入）——舊寫法在最後一次嘗試
 * 撞名時會直接把 `EEXIST` 丟給使用者，而且中間有空窗。
 *
 * @param buildPath - `(index) => 路徑`；index 從 0 開始（0＝原名，1＝`-2`…）
 * @param data - 要寫入的內容
 * @param options.startIndex - 從哪個編號開始試
 * @returns `{ path, index }`
 * @throws 超過 `options.limit` 次仍撞名時丟出最後的 `EEXIST`
 */
export async function createUnique(buildPath, data, options) {
  const limit = typeof options?.limit === 'number' ? options.limit : 1000
  const start = typeof options?.startIndex === 'number' ? options.startIndex : 0
  let last = null
  for (let index = start; index < start + limit; index += 1) {
    const path = buildPath(index)
    try {
      await createExclusive(path, data)
      return { path, index }
    } catch (error) {
      if (!isExistsError(error)) throw error
      last = error
    }
  }
  throw last ?? new Error('找不到可用的檔名')
}
