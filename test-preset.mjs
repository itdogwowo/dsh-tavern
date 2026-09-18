/**
 * `lib/preset.js` 的測試——插件自己安裝「酒館模式」preset。
 *
 * 這一塊最怕的兩件事：
 *   1. **覆蓋掉使用者的東西**（他的 `~/.dsh/.agent-presets/dsh-tavern/` 可能被他改過）
 *   2. **寫出 DSH 不接受的内容**（id 不合規則、YAML 壞掉）→ 那個 preset 會變成
 *      「壞掉的一列」，而使用者不會知道為什麼
 *
 * 用法：node test-preset.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { PRESET_ID, agentEntryPath, describePreset, ensurePreset, presetDir, removePreset, renderComposition, renderMetadata } =
  await import('./lib/preset.js')

/** DSH 對 preset id 的規則（`dsh-agent-presets/lib/index.js:105`）。 */
const PRESET_ID_RULE = /^[a-z0-9][a-z0-9-]*$/

/* ------------------------------ id 與路徑 -------------------------------- */

{
  assert.match(PRESET_ID, PRESET_ID_RULE, 'preset id 就是資料夾名，必須合 DSH 的規則')
  const dir = presetDir('C:\\dsh-home')
  assert.equal(dir, join('C:\\dsh-home', '.agent-presets', PRESET_ID), 'preset 要放在 DSH home 底下')

  // Agent 面的路徑要是絕對路徑（研究：第三方插件用套件名不可靠，
  // 因為套件名從 harness 的安裝基底解析，而我們裝在 profile 的 node_modules）
  const entry = agentEntryPath(new URL('./lib/preset.js', import.meta.url).href)
  assert.ok(/^[A-Za-z]:\\/.test(entry) || entry.startsWith('/'), '要算出絕對路徑：' + entry)
  assert.ok(entry.endsWith('agent.js'), '要指到 agent.js：' + entry)

  console.log('1. id 與路徑 OK —', dir)
}

/* ------------------------------ 產生的內容 ------------------------------- */

{
  const text = renderComposition('C:\\x\\agent.js', { card: 'C:\\cards\\a.json', user: '阿明' })

  // 這一條最要緊：**不可以**掛 dsh-persona（兩個 complete section 會讓組裝失敗）。
  assert.equal(/dsh-persona/.test(text.replace(/^#.*$/gm, '')), false, '不可以真的掛 dsh-persona（只可以在註解裡提到）')
  assert.equal(/^\s*name:\s*'@deepseek-ai\/dsh-persona'/m.test(text), false, '同上')
  assert.equal(/tool-/.test(text.replace(/^#.*$/gm, '')), false, '不可以掛任何工具')

  assert.ok(text.includes(PRESET_ID === 'dsh-tavern' ? 'generated-by' : 'never'), '要有我們的標記，才能分辨是不是我們寫的')
  assert.ok(text.includes("- id: tavern-agent"), '要有那一列')
  assert.ok(text.includes("name: 'C:\\x\\agent.js'"), '要指到 agent 面：' + text)

  // 單引號在 YAML 裡要寫成兩個
  const quoted = renderComposition("C:\\it's\\agent.js", {})
  assert.ok(quoted.includes("'C:\\it''s\\agent.js'"), '路徑裡的單引號要跳脫')

  // 沒有 config 時不要產生空的 config 區塊（YAML 的空物件會讓 DSH 的 schema 抱怨）
  assert.equal(/^\s*config:/m.test(renderComposition('C:\\x\\agent.js', {})), false, '沒有設定時不要產生 config 區塊')
  assert.equal(/^\s*config:/m.test(renderComposition('C:\\x\\agent.js', { card: '' })), false, '空的 card 也算沒有')

  const meta = renderMetadata()
  assert.ok(meta.includes('name: 酒館模式'), '顯示名可以是中文')
  assert.ok(meta.includes('order: 900'), 'order 讓它在模式選單墊底')

  console.log('2. 產生的內容 OK — 沒有 persona、沒有工具、有標記、YAML 跳脫正確')
}

/* ---------------------------- 安裝／更新／不覆蓋 -------------------------- */

{
  const home = mkdtempSync(join(tmpdir(), 'dsh-tavern-preset-'))
  const options = { dshHome: home, entry: 'C:\\x\\agent.js', config: { user: '阿明' } }

  // 一開始不存在
  const before = await describePreset(options)
  assert.equal(before.exists, false, '一開始不該存在')

  // 建立
  const created = await ensurePreset(options)
  assert.equal(created.action, 'created')
  assert.equal(readFileSync(join(created.dir, 'agent.cordis.yml'), 'utf8').includes('tavern-agent'), true)
  assert.equal(readFileSync(join(created.dir, 'preset.yml'), 'utf8').includes('酒館模式'), true)

  // 再跑一次：內容一樣 → 什麼都不做（**不要每次開對話都重寫**，
  // 因為 DSH 的 preset 世代不會回收）
  const again = await ensurePreset(options)
  assert.equal(again.action, 'unchanged', '內容一樣時不該重寫')

  // 設定的東西變了 → 更新
  const updated = await ensurePreset({ ...options, config: { user: '小美' } })
  assert.equal(updated.action, 'updated', '設定變了要更新')
  assert.ok(readFileSync(join(updated.dir, 'agent.cordis.yml'), 'utf8').includes('小美'))

  // ⚠️ 使用者自己改過的（沒有我們的標記）→ **原樣留著**
  writeFileSync(join(created.dir, 'agent.cordis.yml'), '# 我自己寫的\n- id: mine\n  name: ./mine.js\n')
  const foreign = await ensurePreset(options)
  assert.equal(foreign.action, 'foreign', '不是我們寫的就不碰')
  assert.ok(
    readFileSync(join(created.dir, 'agent.cordis.yml'), 'utf8').includes('我自己寫的'),
    '使用者的內容一個字都不能動',
  )

  // 移除：也不是我們的 → 不動
  const kept = await removePreset(options)
  assert.equal(kept.removed, false, '不是我們的就不刪')

  // 換回我們的內容 → 可以更新，也可以移除
  writeFileSync(join(created.dir, 'agent.cordis.yml'), renderComposition('C:\\x\\agent.js', {}))
  assert.equal((await ensurePreset(options)).action, 'updated', '是我們的就更新')
  const removed = await removePreset(options)
  assert.equal(removed.removed, true, '是我們的就可以移除')
  assert.equal((await describePreset(options)).exists, false, '移除之後不該存在')

  rmSync(home, { recursive: true, force: true })
  console.log('3. 安裝流程 OK — 建立／不重複寫／更新／不覆蓋使用者的／可移除')
}

/* ------------------------------ 壞掉的目錄 ------------------------------- */

{
  const home = mkdtempSync(join(tmpdir(), 'dsh-tavern-preset-bad-'))
  // 資料夾存在但沒有 composition：DSH 會把它列成「壞掉的 preset」。
  // 那是我們的目錄名，所以要補上。
  mkdirSync(presetDir(home), { recursive: true })
  const fixed = await ensurePreset({ dshHome: home, entry: 'C:\\x\\agent.js' })
  assert.equal(fixed.action, 'created', '空目錄要補上 composition')
  assert.equal((await describePreset({ dshHome: home })).hasComposition, true)
  rmSync(home, { recursive: true, force: true })
  console.log('4. 空目錄 OK — 補上 composition，不留一個「壞掉的一列」')
}

console.log('\n全部通過 ✅')
