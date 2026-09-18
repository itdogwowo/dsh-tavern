/**
 * 插件自己安裝「酒館模式」的 preset。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 為什麼這件事要由插件做，而不是叫使用者手動放檔案：
 *
 * 酒館模式的 session 靠一份 preset 才有身分（`lib/agent.js` 是那一列指名的模組）。
 * 那份 preset 住在 `~/.dsh/.agent-presets/dsh-tavern/`，在**使用者的 DSH home** 裡。
 * 手動放＝「裝好插件之後還要再看一份說明才能用」，而這正好是這個專案一直在避免的。
 *
 * ## 兩個刻意的地方
 *
 * 1. **不在啟動時做。** 插件掛載時什麼都不做（既有的硬規則），所以是
 *    「使用者第一次要開對話」的時候才呼叫 `ensure()`。
 * 2. **不覆蓋使用者改過的東西。** 如果那份檔案已經存在、而且**不是我們寫的**
 *    （沒有我們的標記），就原樣留著並回報 `foreign`，讓上層可以告訴使用者。
 *    只有「是我們的、但內容過期了」才更新。
 * ────────────────────────────────────────────────────────────────────────
 */
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { atomicWrite } from './write.js'
import { resolveDshHome } from './workspace.js'

/** preset 的 id——同時是資料夾名。**只能是英數與連字號**（DSH 的規則）。 */
export const PRESET_ID = 'dsh-tavern'

/** 我們寫的檔案一定帶著這一行，用來分辨「這是我們的」與「使用者改過的」。 */
const MARKER = '# generated-by: dsh-tavern'

/** 固定不變的部分：只掛我們的 agent 面，沒有 persona、沒有任何工具。 */
const CAUTION = `# ⚠️ 同一個 scope 只能有一個 \`complete: true\` 的 section，
#    所以這裡**不可以**再掛 @deepseek-ai/dsh-persona（它也會註冊 complete），
#    否則系統提示的組裝會直接失敗。
#
# ⚠️ 也不要加任何 tool-* 一列。繼承來的全域工具由 lib/agent.js 的
#    denyInheritedTools() 負責遮掉。`

/**
 * 算出 Agent 面的絕對路徑。
 *
 * preset 的一列接受 `.` 相對路徑（相對於 preset 目錄）、`file:` URL、
 * 絕對路徑、以及套件名。**套件名對第三方插件不可靠**——它從 harness 的安裝基底
 * 解析，而我們的套件裝在 profile 的 `node_modules` 底下。所以用絕對路徑。
 *
 * @param moduleUrl - 這個模組自己的 URL（呼叫端傳 `import.meta.url`）。
 */
export function agentEntryPath(moduleUrl) {
  return fileURLToPath(new URL('./agent.js', moduleUrl))
}

/**
 * 包成 YAML 的單引號字串。
 *
 * ⚠️ **單引號 style 裡反斜線是字面上的**——YAML 唯一的跳脫是「兩個單引號代表一個」。
 * 所以 Windows 路徑**不要**把 `\` 寫成 `\\`：那會產生一條真的不存在的路徑
 * （`C:\\Users\\...` 對檔案系統來說就是兩個反斜線）。
 * 第一版就是畫蛇添足地把反斜線加倍，`test-preset.mjs` §2 抓到的。
 */
function yamlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * 產生 `agent.cordis.yml` 的內容。
 *
 * @param entry - Agent 面的絕對路徑。
 * @param config - 選用：`{ card, user }`（沒綁定 session 時的退路）。
 */
export function renderComposition(entry, config) {
  const lines = [
    '# dsh-tavern 的 Agent 面',
    '#',
    '# 這一列是**唯一**決定「酒館模式的 session 長什麼樣」的東西：',
    '#   - 只掛我們的 agent 面（它自己會回答「我是誰」）',
    '#   - 角色卡從 session 的綁定動態讀取（`<酒館>/.sessions/<sessionId>.json`）',
    '#   - 改了卡片，下一個模型步驟就生效——不需要新開對話',
    '#',
    CAUTION,
    '#',
    MARKER,
    '- id: tavern-agent',
    `  name: ${yamlQuote(entry)}`,
  ]
  const card = typeof config?.card === 'string' && config.card !== '' ? config.card : ''
  const user = typeof config?.user === 'string' && config.user !== '' ? config.user : ''
  if (card !== '' || user !== '') {
    lines.push('  config:')
    // 退路用：還沒綁定的 session（例如使用者直接在 DSH 開一個酒館模式的空白 session）。
    if (card !== '') lines.push(`    card: ${yamlQuote(card)}`)
    if (user !== '') lines.push(`    user: ${yamlQuote(user)}`)
  }
  return lines.join('\n') + '\n'
}

/** 產生 `preset.yml`（顯示用；`order` 讓它在模式選單墊底）。 */
export function renderMetadata() {
  return [
    'name: 酒館模式',
    'description: 角色卡就是系統提示，沒有任何工具（dsh-tavern）',
    'order: 900',
    '',
  ].join('\n')
}

/** preset 資料夾的絕對路徑。 */
export function presetDir(dshHome) {
  return join(typeof dshHome === 'string' && dshHome !== '' ? dshHome : resolveDshHome(), '.agent-presets', PRESET_ID)
}

/** 讀一個檔案，讀不到回 `null`。 */
async function readOrNull(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * 確保 preset 存在而且是我們要的內容。
 *
 * @param options - `{ dshHome, entry, config }`。
 * @returns `{ dir, action, reason }`——`action` 是：
 *   - `'unchanged'`：已經是對的，什麼都沒做
 *   - `'created'`：原本不存在，建立了
 *   - `'updated'`：原本是我們的但內容過期，更新了
 *   - `'foreign'`：**存在但不是我們寫的**（使用者自己放或改過的），原樣留著
 */
export async function ensurePreset(options) {
  const dir = presetDir(options?.dshHome)
  const composition = join(dir, 'agent.cordis.yml')
  const metadata = join(dir, 'preset.yml')
  const wanted = renderComposition(options?.entry, options?.config)
  const wantedMeta = renderMetadata()

  const before = await readOrNull(composition)

  if (before === null) {
    // 資料夾存在但沒有 composition：DSH 會把它當成「壞掉的 preset」列出來。
    // 那是我們的目錄（同名），所以補上——但先確認裡面沒有別人的東西。
    await mkdir(dir, { recursive: true })
    await atomicWrite(composition, wanted)
    if ((await readOrNull(metadata)) === null) await atomicWrite(metadata, wantedMeta)
    return { dir, action: 'created', reason: '' }
  }

  if (before.includes(MARKER) === false) {
    // 不是我們寫的 → 不碰。可能是使用者自己手寫了一份同名的。
    return { dir, action: 'foreign', reason: 'agent.cordis.yml 已存在，而且不是 dsh-tavern 產生的' }
  }

  if (before === wanted && (await readOrNull(metadata)) === wantedMeta) {
    return { dir, action: 'unchanged', reason: '' }
  }

  await atomicWrite(composition, wanted)
  await atomicWrite(metadata, wantedMeta)
  return { dir, action: 'updated', reason: '' }
}

/**
 * 移除我們裝的 preset（給「完全解除安裝」用）。
 *
 * **只在自己確認是我們的檔案時才動手**——使用者改過的一律留著。
 */
export async function removePreset(options) {
  const dir = presetDir(options?.dshHome)
  const composition = await readOrNull(join(dir, 'agent.cordis.yml'))
  if (composition === null) return { dir, removed: false, reason: '沒有這個 preset' }
  if (composition.includes(MARKER) === false) {
    return { dir, removed: false, reason: '不是 dsh-tavern 產生的，不動它' }
  }
  await rm(dir, { recursive: true, force: true })
  return { dir, removed: true, reason: '' }
}

/** preset 現況（給診斷／面板顯示用）。 */
export async function describePreset(options) {
  const dir = presetDir(options?.dshHome)
  const composition = await readOrNull(join(dir, 'agent.cordis.yml'))
  const exists = (await stat(dir).catch(() => undefined)) !== undefined
  return {
    dir,
    exists,
    ours: composition !== null && composition.includes(MARKER),
    hasComposition: composition !== null,
  }
}
