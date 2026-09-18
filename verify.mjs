/**
 * dsh-tavern 安裝前檢查：確認 DSH 的三個面都載得起來。
 *
 * DSH 的 loader 對 out-of-tree 插件走 realpath（`realpathSync(entry)`），所以
 * 模組解析是從「插件原始目錄」往上找，而不是從 profile 的 node_modules。
 * 這個腳本把六個前提驗掉：
 *   1. manifest：dsh.bundle.patch 存在、dsh.client.platform 有宣告、
 *      bundle 的 __ModuleLoader__.load id 與套件名一致
 *   2. host 半：lib/index.js 能 import，而且只依賴 `webServer`
 *   3. client 半：exports["./client"] 指向存在、語法正確的 bundle
 *   4. **agent 面**：exports["./agent"] 能 import，而且只依賴 `systemPrompt`
 *   5. **零執行期依賴**：每個面只 import node: 與自己的相對檔案（最重要的一條）
 *   6. 三個面的版本標記彼此對得上（只更新到一半是最常見的災難）
 *
 * 用法：node verify.mjs
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readCardFromPng } from './lib/pngcard.js'

const root = resolve(import.meta.dirname)
let failures = 0

function check(label, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + label + (detail === undefined ? '' : ' — ' + detail))
  if (!ok) failures += 1
}

/* --- manifest ------------------------------------------------------------ */
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
check('套件名為 dsh-tavern', manifest.name === 'dsh-tavern', manifest.name)

const patch = manifest.dsh?.bundle?.patch
check('宣告 dsh.bundle.patch', typeof patch === 'string', patch)
check('patch 檔存在', typeof patch === 'string' && existsSync(join(root, patch)))

const platform = manifest.dsh?.client?.platform
check('宣告 dsh.client.platform', platform === 'web', String(platform))

const clientRel = manifest.exports?.['./client']
check('exports["./client"] 存在', typeof clientRel === 'string', String(clientRel))

const hostRel = manifest.exports?.['.']
check('exports["."] 存在', typeof hostRel === 'string', String(hostRel))

const agentRel = manifest.exports?.['./agent']
check('exports["./agent"] 存在', typeof agentRel === 'string', String(agentRel))

/* --- host 半 -------------------------------------------------------------- */
const hostPath = join(root, hostRel)
check('host 半檔案存在', existsSync(hostPath))

try {
  const mod = await import(pathToFileURL(hostPath).href)
  check('host 半可 import', true, 'exports = ' + Object.keys(mod).join(','))
  check('host 半匯出 apply()', typeof mod.apply === 'function')
  // v2 的契約：宿主半只需要 webServer。多依賴一個服務就多一個開不了機的理由。
  check('host 半只依賴 webServer', JSON.stringify(mod.inject) === '["webServer"]', JSON.stringify(mod.inject))
} catch (error) {
  check('host 半可 import', false, String(error.message).split('\n')[0])
  console.log(
    '     ↳ 宿主半載入失敗＝整個 dsh web 起不來（loader 同步導入）。\n' +
      '       立即恢復：dsh plugin --profile web remove dsh-tavern\n' +
      '       本插件已改為零執行期依賴，不需要 node_modules junction。',
  )
}

/* --- 2. client 半 -------------------------------------------------------- */
const clientPath = join(root, clientRel)
check('client 半檔案存在', existsSync(clientPath))

if (existsSync(clientPath)) {
  const source = readFileSync(clientPath, 'utf8')
  check('client 是 __ModuleLoader__ bundle', source.includes('__ModuleLoader__.load'))
  const idMatch = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(source)
  check('bundle id 與套件名一致', idMatch !== null && idMatch[1] === manifest.name, idMatch === null ? '找不到 id' : idMatch[1])
  // 只看程式碼有沒有 JSX 起始標籤；CSS 選擇器長得像 <tag>，先把字串常值拿掉。
  const withoutLiterals = source.replace(/'[^'\n]*'/g, "''").replace(/"[^"\n]*"/g, '""')
  const jsxHits = withoutLiterals.match(/<[A-Z][A-Za-z]*[\s/>]/g)
  check('client 沒有 JSX（全用 createElement）', jsxHits === null, jsxHits === null ? '' : jsxHits.join(' '))
  check('client 沒有 import/require ESM 語法', /^\s*import\s/m.test(source) === false)
}

/* --- 3. agent 面 --------------------------------------------------------- */
/**
 * Agent 面跟前兩面最大的不同：**它只在 preset 裡面跑**，不在 `dsh web` 的啟動
 * 路徑上。所以它壞掉不會讓 DSH 開不起來，只會讓那個對話開不起來。
 *
 * 但「不在啟動路徑上」不等於可以隨便——它每一次模型請求都會被呼叫，
 * 所以它仍然必須零執行期依賴（解析失敗＝那個對話每輪都失敗）。
 */
const agentPath = join(root, agentRel)
check('agent 面檔案存在', existsSync(agentPath))

if (existsSync(agentPath)) {
  try {
    const mod = await import(pathToFileURL(agentPath).href)
    check('agent 面可 import', true, 'exports = ' + Object.keys(mod).join(','))
    check('agent 面匯出 apply()', typeof mod.apply === 'function')
    // `systemPrompt` 對這一面是硬依賴：沒有它，這一面存在的理由就消失了。
    // 注意這裡跟宿主半的差別——宿主半是「只能有 webServer」，agent 面是
    // 「只能有 systemPrompt」，兩個面各自的最小依賴。
    check(
      'agent 面只依賴 systemPrompt',
      JSON.stringify(mod.inject) === '["systemPrompt"]',
      JSON.stringify(mod.inject),
    )
  } catch (error) {
    check('agent 面可 import', false, String(error.message).split('\n')[0])
  }
}

/* --- 0. 零執行期依賴（最重要的一條）------------------------------------- */
// DSH 的 loader 在啟動時「同步導入」每個 bundle 的 loader entry。任何一個插件的
// 頂層 import 解析失敗，整個 dsh web 就起不來——不是降級跳過，是直接開不了機。
// 所以宿主半只能 import node: 內建模組與自己的相對檔案。（DSH discussion #1884）
{
  const libDir = join(root, 'lib')
  const hostFiles = existsSync(libDir) ? readdirSync(libDir).filter((name) => name.endsWith('.js')) : []
  const offenders = []
  for (const name of hostFiles) {
    const text = readFileSync(join(libDir, name), 'utf8')
    for (const match of text.matchAll(/^\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/gm)) {
      const spec = match[1]
      if (!spec.startsWith('node:') && !spec.startsWith('./') && !spec.startsWith('../')) {
        offenders.push(name + ' → ' + spec)
      }
    }
    for (const match of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)) {
      const spec = match[1]
      if (!spec.startsWith('node:') && !spec.startsWith('./') && !spec.startsWith('../')) {
        offenders.push(name + ' → 動態 import ' + spec)
      }
    }
  }
  check('宿主半零執行期依賴（只用 node: 與相對路徑）', offenders.length === 0, offenders.join(' | '))
  check('lib/ 內有可檢查的宿主檔案', hostFiles.length > 0, hostFiles.join(','))

  /**
   * `package.json` 的 `files` 要涵蓋 `lib/` 底下每一個 `.js`。
   *
   * ⚠️ 從 GitHub 的 tarball 安裝時 `files` 沒有作用（整個 repo 都會被解開），
   * 所以漏掉它**在本機不會有任何症狀**——只有 `npm publish` 出來的套件會少檔案，
   * 而且是執行到那一行才炸。實際漏過三個：`lib/preset.js`、`lib/theme.js`、
   * `lib/worldbook.js`（都是後來新增的，加檔案時忘了同步這一份清單）。
   *
   * 這一條把「新增一個 lib 檔案」變成一件會讓檢查變紅的事。
   */
  const listed = new Set(Array.isArray(manifest.files) ? manifest.files : [])
  const unlisted = hostFiles.filter((name) => !listed.has('lib/' + name))
  check('files 涵蓋 lib/ 底下每個 .js', unlisted.length === 0, unlisted.map((n) => 'lib/' + n).join(', '))
}

/* --- 版本標記：確認裝到的是這一版 ---------------------------------------- */
// 三個面是三個獨立載入的檔案，很容易只更新到一半（例如改了 agent 面忘了重啟宿主、
// 或 profile 裡還是舊版）。把四個標記綁在一起，升級後一眼看得出來。
{
  const pluginManifest = JSON.parse(readFileSync(join(root, 'dsh.plugin.json'), 'utf8'))
  check(
    'dsh.plugin.json 版本與 package.json 一致',
    pluginManifest.version === manifest.version,
    manifest.version + ' / ' + String(pluginManifest.version),
  )
  const hostSource = readFileSync(hostPath, 'utf8')
  const hostBuild = /TAVERN_BUILD\s*=\s*'([^']+)'/.exec(hostSource)
  check('宿主半版本標記對得上', hostBuild !== null && hostBuild[1] === 'tavern-' + manifest.version, hostBuild === null ? '找不到 TAVERN_BUILD' : hostBuild[1])
  const clientSource = readFileSync(clientPath, 'utf8')
  const clientBuildMatch = /CLIENT_BUILD\s*=\s*'([^']+)'/.exec(clientSource)
  check(
    '瀏覽器半版本標記對得上',
    clientBuildMatch !== null && clientBuildMatch[1] === 'tavern-client-' + manifest.version,
    clientBuildMatch === null ? '找不到 CLIENT_BUILD' : clientBuildMatch[1],
  )
  if (existsSync(agentPath)) {
    const agentSource = readFileSync(agentPath, 'utf8')
    const agentBuildMatch = /AGENT_BUILD\s*=\s*'([^']+)'/.exec(agentSource)
    check(
      'agent 面版本標記對得上',
      agentBuildMatch !== null && agentBuildMatch[1] === 'tavern-agent-' + manifest.version,
      agentBuildMatch === null ? '找不到 AGENT_BUILD' : agentBuildMatch[1],
    )
  }
}

/* --- 出貨的範例圖：不可以夾帶生成工具留下的東西 -------------------------- */
/**
 * `samples/` 底下的 PNG 是會被上傳到 GitHub 的出貨內容。生成式工具很喜歡在 PNG 裡
 * 塞文字區塊（`parameters`、`Software`、`prompt`、`workflow`、XMP…）——那是**生成
 * 參數與提示詞**，跟著圖一起公開等於把工具鏈一起送出去，而卡片本身完全不需要它們。
 *
 * 所以這裡走一次真正的 chunk 串列，只放行「顯示這張圖真的需要」的區塊；
 * 文字區塊只准是卡片資料本身（`ccv3`／`chara`），那正是這張 PNG 存在的理由。
 *
 * 順便釘住兩件事：範例必須是**合法的 V3 卡**（`group_only_greetings` 是規格裡
 * 寫死 MUST 的欄位），而且**PNG 裡的那份要跟旁邊的 JSON 一模一樣**——
 * 兩份資料走樣的話，這張卡就不再是它自己宣稱的東西了。
 */
{
  // 顯示用的區塊：PNG 本體、色彩空間、像素密度、透明度、ICC。其餘一律視為夾帶。
  const ALLOWED = new Set([
    'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'sRGB', 'gAMA', 'cHRM', 'pHYs', 'iCCP', 'sBIT', 'bKGD', 'tEXt',
  ])
  const CARD_KEYWORDS = new Set(['ccv3', 'chara'])

  function collectPngs(dir) {
    const out = []
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return out
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...collectPngs(full))
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) out.push(full)
    }
    return out
  }

  const images = collectPngs(join(root, 'samples'))
  check('samples/ 底下有出貨的角色卡', images.length > 0, images.length + ' 張')

  for (const image of images) {
    const relativePath = relative(root, image)
    const bytes = readFileSync(image)
    const stray = []
    const keywords = []
    let offset = 8
    while (offset + 8 <= bytes.length) {
      const length = bytes.readUInt32BE(offset)
      const type = bytes.toString('latin1', offset + 4, offset + 8)
      if (!ALLOWED.has(type)) stray.push(type)
      if (type === 'tEXt') {
        const data = bytes.subarray(offset + 8, offset + 8 + length)
        const separator = data.indexOf(0)
        const keyword = data.subarray(0, separator < 0 ? 0 : separator).toString('latin1')
        keywords.push(keyword)
        if (!CARD_KEYWORDS.has(keyword.toLowerCase())) stray.push('tEXt:' + keyword)
      }
      offset += 12 + length
      if (type === 'IEND') break
    }
    check(
      relativePath + ' 沒有生成工具留下的區塊',
      stray.length === 0,
      stray.length === 0 ? '只放行顯示與卡片資料用的區塊' : '多出 ' + stray.join(', '),
    )
    check(
      relativePath + ' 帶的是 V3 卡片資料（ccv3）',
      keywords.some((keyword) => keyword.toLowerCase() === 'ccv3'),
      keywords.join(', ') === '' ? '（沒有任何文字區塊）' : keywords.join(', '),
    )

    const sidecar = image.replace(/\.png$/iu, '.json')
    if (!existsSync(sidecar)) continue
    const jsonCard = JSON.parse(readFileSync(sidecar, 'utf8'))
    check(
      relativePath + ' 的 JSON 是 chara_card_v3',
      jsonCard.spec === 'chara_card_v3' && jsonCard.spec_version === '3.0',
      String(jsonCard.spec) + ' / ' + String(jsonCard.spec_version),
    )
    check(
      relativePath + ' 有 V3 寫死必填的 group_only_greetings',
      Array.isArray(jsonCard.data?.group_only_greetings),
      Array.isArray(jsonCard.data?.group_only_greetings) ? '空陣列也可以，但不能沒有' : '缺欄位',
    )
    const inPng = readCardFromPng(bytes).card
    check(
      relativePath + ' 的 PNG 與旁邊的 JSON 內容一致',
      JSON.stringify(inPng) === JSON.stringify(jsonCard),
      JSON.stringify(inPng) === JSON.stringify(jsonCard) ? '' : '兩份資料走樣了',
    )
  }
}

/* --- 個資掃描：這個 repo 會被上傳到 GitHub -------------------------------- */
/**
 * 文件與程式碼裡**不可以出現真實的使用者名稱或本機絕對路徑**。
 *
 * 為什麼要有這一條：`docs/plan.md` 是交接文件，寫的時候圖方便寫了
 * `<家目錄>/Documents/Git/...` 這種完整路徑——而那串路徑**夾帶使用者名稱**，
 * 於是 repo 一上 GitHub，等於公開「這個帳號叫什麼、目錄怎麼放」。
 * 更糟的是截圖：畫面裡的側邊欄會顯示**工作區名稱**（公司專案名）與完整路徑。
 *
 * 實際發生過一次：`docs/plan.md` 有 9 處、`docs/` 底下 8 張截圖全部要修。
 * （截圖本來就在 `.gitignore` 的 `*.png` 裡，但**用 GitHub 網頁拖檔案上傳不會看
 * `.gitignore`**——所以光靠 ignore 不夠。）
 *
 * 掃描範圍：repo 底下的文字檔（`.md`/`.js`/`.mjs`/`.json`/`.yml`/`.txt`），
 * 跳過 `.git` 與 `node_modules`。樣板寫法（`<你>`、`<user>`）不算——
 * 那正是我們要推廣的寫法。
 *
 * 兩層掃描：
 *   A. **家目錄形狀的路徑**（`/Users/<名字>`、`/home/<名字>`、`C:\Users\<名字>`）
 *   B. **本地黑名單** `.privacy-denylist.txt`（已 gitignore，可選）
 *      A 抓不到公司名／專案名，而實際發生過的那次洩漏正是這一類。
 * 完整說明與事故處理步驟見 `docs/privacy-runbook.md`。
 */
{
  const SKIP_DIRS = new Set(['.git', 'node_modules'])
  /**
   * 這三個檔案**不掃**，原因各不相同但都成立：
   *   - `.privacy-denylist.txt` 就是黑名單本身，掃它必定命中自己
   *   - `AGENTS.local.md` / `CLAUDE.local.md` 是 gitignored 的個人覆蓋層
   * 共同理由：**掃一個不可能被 commit 的檔案沒有意義**。
   */
  const SKIP_FILES = new Set(['.privacy-denylist.txt', 'AGENTS.local.md', 'CLAUDE.local.md'])
  const TEXT_EXT = new Set(['.md', '.js', '.mjs', '.json', '.yml', '.yaml', '.txt'])
  // 家目錄的形狀：macOS／Linux 的 /Users/<名字>、/home/<名字>，Windows 的 C:\Users\<名字>。
  // `[^/\s...<>]` 這個字元類別**刻意排除 `<` 與 `>`**，所以 `<你>` 這種樣板不會誤判。
  const HOME_SHAPED = [
    /\/Users\/([^/\s`'")<>[\]]+)/g,
    /\/home\/([^/\s`'")<>[\]]+)/g,
    /[A-Za-z]:\\Users\\([^\\\s`'")<>[\]]+)/g,
  ]

  /** 命中處太多時不要洗版，只報前 8 個。 */
  const describeHits = (hits) =>
    hits.slice(0, 8).join(' | ') + (hits.length > 8 ? ` …共 ${String(hits.length)} 處` : '')

  // 兩個掃描共用一次走訪。這裡只留行陣列（不留整份字串），35 個檔案綽綽有餘。
  const textFiles = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!TEXT_EXT.has(extname(entry.name))) continue
      let text
      try {
        text = readFileSync(path, 'utf8')
      } catch {
        continue
      }
      textFiles.push({ rel: relative(root, path), lines: text.split('\n') })
    }
  }
  walk(root)

  /* --- 掃描 A：家目錄形狀的路徑 ----------------------------------------- */
  const leaks = []
  for (const file of textFiles) {
    for (let i = 0; i < file.lines.length; i += 1) {
      for (const pattern of HOME_SHAPED) {
        pattern.lastIndex = 0
        if (pattern.test(file.lines[i])) {
          leaks.push(`${file.rel}:${String(i + 1)}`)
          break
        }
      }
    }
  }
  check('文件與程式碼裡沒有真實的使用者名稱／本機絕對路徑', leaks.length === 0, describeHits(leaks))

  /* --- 掃描 B：本地黑名單 ----------------------------------------------- */
  /**
   * 掃描 A 只認得「家目錄形狀」，**抓不到公司名／內部專案名**——而實際發生過的
   * 那一次洩漏正是後者（側邊欄的工作區名稱被貼進 README 的示意圖），
   * 掃描 A 放它過了。這一層補上那個洞。
   *
   * 黑名單放在 `.privacy-denylist.txt`（**已 gitignore**，一行一個詞，
   * `#` 開頭是註解）。它不進版控是刻意的：**黑名單本身就是機密**，
   * 把公司名寫進一個公開檔案來防止公司名外洩是自相矛盾的。
   * 代價是兩台機器要各建一份（見 docs/privacy-runbook.md 第 4 節）。
   *
   * 沒有這個檔案時顯示「略過」而不是失敗：新 clone 的人不該因為沒有你的
   * 私人黑名單而跑不過檢查。
   *
   * 比對**不分大小寫**：隱私防線寧可多抓（誤判看得到 `檔案:行號`，改清單就好），
   * 也不要漏掉「同一個名字大小寫不同」這種差異。
   */
  const denylistPath = join(root, '.privacy-denylist.txt')
  const denylist = existsSync(denylistPath)
    ? readFileSync(denylistPath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line !== '' && !line.startsWith('#'))
    : []

  if (denylist.length === 0) {
    console.log('  ⏭️  個資黑名單：略過（沒有 .privacy-denylist.txt，或裡面沒有詞）')
  } else {
    const hits = []
    for (const file of textFiles) {
      for (let i = 0; i < file.lines.length; i += 1) {
        const line = file.lines[i].toLowerCase()
        const index = denylist.findIndex((term) => line.includes(term))
        // ⚠️ 只報「檔案:行號（第幾個詞）」而**不報命中哪個詞**：黑名單是機密，
        // 而檢查失敗的輸出最常被整段貼進對話或 issue。
        if (index >= 0) hits.push(`${file.rel}:${String(i + 1)} (#${String(index + 1)})`)
      }
    }
    check(`個資黑名單沒有命中（${String(denylist.length)} 個詞）`, hits.length === 0, describeHits(hits))
  }
}

/* --- realpath 提醒 ------------------------------------------------------- */
const real = realpathSync(hostPath)
check('loader 會看到的實際路徑就是本目錄', real === hostPath, real)

console.log(failures === 0 ? '\n全部通過 ✅ 可以 dsh plugin add 安裝了' : `\n有 ${failures} 項未通過 ❌`)
process.exit(failures === 0 ? 0 : 1)
