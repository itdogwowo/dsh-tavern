/**
 * 重啟之後的驗收探針：**提示詞真的到得了模型嗎？**
 *
 *   node verify-stop.mjs [port]
 *
 * ────────────────────────────────────────────────────────────────────────
 * ⚠️ **這一支只讀，完全不寫。** 它會：
 *   1. 問宿主半的版本（`tavern.list`）
 *   2. 讀這一間酒館的生成參數設定（`settings.read`）——只是讀出來顯示
 *   3. 去 session log 裡撈**最近一次送給模型的 request**
 *
 * **為什麼堅持只讀**（這一段是這一支最重要的註解）：
 *
 * 2.6.57 的第一版用 `settings.write` 送一個「故意不合法」的值當探針
 * （「不合法就不會被寫進檔案」）。那個想法本身沒錯，但它有**兩個**問題：
 *
 *   a. **Node 的 `fetch` 送的 body 到不了這個宿主半的路由。** 實測：
 *      `fetch`（含 `node:http`）送 `{"args":{…}}` → 宿主收到的是**空的**，
 *      於是 `writeSettings({})` 靜靜地把 `updatedAt` 更新一次、什麼都沒改；
 *      同一件事用 `curl` 或 PowerShell 送就正常。所以那個「探針」其實
 *      **從來沒有驗到任何東西**（而它看起來像驗過了）。
 *   b. 就算 body 到得了，「不合法」的判斷也會隨版本漂移：2.6.56 的探針送
 *      17 個 stop（當時上限 16），2.6.57 把 `stop` 變成自由欄位之後
 *      17 個**是合法的**——於是它真的寫進了使用者的 `tavern.json`。
 *
 * 結論：**驗證工具不可以有副作用。** 要驗「提示詞有沒有到模型」，
 * 看日誌就夠了，不需要先寫一個值進去。
 * ────────────────────────────────────────────────────────────────────────
 *
 * 三件事，而且三件都「不必問人、不必看畫面」：
 *
 *   1. **宿主半換版了沒**——`tavern.list` 回的 `build` 要等於 `lib/index.js`
 *      的 `TAVERN_BUILD`。不對就是還沒重啟。
 *   2. **你的設定現在是什麼**——溫度／最多 token／停止序列／開關。
 *   3. **模型真的收到了**——掃 session log（**zstd 多 frame**），找最近一次
 *      `request/header`，把 `provider`／`model`／`reasoningEffort`／
 *      `temperature`／`maxTokens`／`stop` 列出來。
 *      前三項**一定要在**：它們被吃掉的話症狀是「選了模型卻沒生效」，
 *      而它看起來像 DSH 壞了（見 `docs/plan.md` §2.6.48）。
 *
 * ⚠️ **要跑之前請先「說一句話」**（真的跑完一輪），不然第 3 步沒東西可看。
 * ⚠️ 回覆格式（`render.json`）的指令**在系統提示裡**，不在 `request/header`
 * ——想看那一段要解 log 裡的 messages，這一支刻意不做（那是另一件事）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { TAVERN_BUILD } from './lib/index.js'
import { STOP_PRESET } from './lib/samplers.js'
import { resolveDshHome } from './lib/workspace.js'

const port = process.argv[2] ?? '3080'
const base = `http://127.0.0.1:${port}`

/** 這個 process 的輸出要能一眼看出「過／不過」，所以自己數。 */
let failures = 0
const ok = (pass, label, detail = '') => {
  if (pass !== true) failures += 1
  console.log(`${pass === true ? '  ✅' : '  ❌'} ${label}${detail === '' ? '' : ' — ' + detail}`)
}

/**
 * 一次 rpc，**用 PowerShell 的 `Invoke-RestMethod` 送**。
 *
 * ⚠️ 這一支原本用 `fetch`，而**讀取**用 fetch 是沒問題的（`tavern.list` 一直
 * 回得出正確的 `build`）——問題只出在**帶 body 的請求**。但既然整支都只讀，
 * 用哪一種都行；這裡保留 fetch 是因為它讓「唯讀」這件事在原始碼上看得出來
 * （沒有任何 `write` 的 op 字串）。
 */
async function rpc(op, args) {
  const res = await fetch(`${base}/api/dsh-tavern/rpc?op=${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ args }),
  })
  return res.json()
}

/* ------------------------------ 1. 宿主半版本 ------------------------------ */

console.log(`\n[1/3] 宿主半版本（工作區是 ${TAVERN_BUILD}）`)
const listed = await rpc('tavern.list', {}).catch((error) => ({ ok: false, error: String(error.message) }))
if (listed.ok !== true) {
  console.log(`  ❌ 連不上 ${base} 或 rpc 失敗：${String(listed.error)}`)
  console.log('     （dsh web 沒在跑？還是 port 不對？`docs/plan.md` §6.2 有怎麼從 log 拿網址）')
  process.exitCode = 1
} else {
  const build = listed.value.build
  ok(build === TAVERN_BUILD, `rpc 回的 build 是 ${build}`, build === TAVERN_BUILD ? '' : `要是 ${TAVERN_BUILD} → 還沒重啟 dsh web`)
  if (build !== TAVERN_BUILD) {
    console.log('  ⚠️ 宿主半還是舊的：下面兩項預計會紅。**重啟 dsh web 之後再跑一次。**')
  }

  /* --------------------------- 2. 你的設定（只讀）--------------------------- */

  console.log('\n[2/3] 這一間酒館的生成參數（只是讀出來顯示）')
  const tavern = listed.value.taverns.find((one) => one.id === listed.value.activeId) ?? listed.value.taverns[0]
  if (tavern === undefined) {
    console.log('  ⚠️ 這一台還沒有任何酒館——跳過（先開一間再跑）')
  } else {
    const read = await rpc('settings.read', { id: tavern.id })
    const s = read.value ?? {}
    console.log(
      `  ℹ️ temperature=${JSON.stringify(s.temperature)} maxTokens=${JSON.stringify(s.maxTokens)}`,
    )
    console.log(
      `  ℹ️ 停止序列開關=${JSON.stringify(s.stopEnabled)} 自填=${JSON.stringify(s.stop)}`,
    )
    // 開關開著的話，模型應該收到的是「內建 ＋ 自填」——把那幾串算出來給人對。
    if (s.stopEnabled === true) {
      console.log(
        `  ℹ️ 所以下一輪應該送出：${JSON.stringify(STOP_PRESET.concat(Array.isArray(s.stop) ? s.stop : []))}`,
      )
    }
  }

  /* --------------------------- 3. 模型真的收到什麼 --------------------------- */

  console.log('\n[3/3] 最近一次送給模型的 request（看日誌，不寫任何東西）')

  /**
   * session log 的三個實測事實（**每一條都量過，不是照型別推的**）：
   *
   * 1. **位置比想像中深一層**：`~/.dsh/sessions/<工作區編碼>/<session-id>/session.v3.jsonl.zstd`。
   *    照「`~/.dsh/sessions/` 底下就是檔案」寫的話會**一個都找不到**，
   *    而症狀是「找不到 request/header」——看起來像還沒跑過對話。
   * 2. **它是 zstd 多 frame**（實測一份 783KB 的 log 有 **514 個 frame**），
   *    而 `zstdDecompressSync(整份)` **只回 232 bytes**（＝第一 frame，只有標頭行）。
   *    所以「直接丟進去」會拿到一個看起來很正常、但**完全沒有 header** 的片段。
   * 3. **header 在 `data.header.config`**（不是 `.payload.header`、也不是 `.header`）：
   *      { type:'request/header', seq, time, data:{ header:{ config:{…},
   *        adapterDefaults, tools } } }
   *    ⚠️ 要讀的是 **`config`** 那一層——`data.header` 本身還有 `tools`
   *    （幾十個工具的描述，印出來會把整個畫面洗掉）。
   */
  const sessionsDir = join(resolveDshHome(), 'sessions')

  /** 遞迴找 log（`sessions/` 底下是「一個工作區一個資料夾」）。 */
  function findLogs(dir, depth = 0) {
    if (depth > 3) return []
    // ⚠️ `readdirSync` 回的是**陣列**，不是 Promise——`.catch()` 在這裡會丟
    // `readdirSync.catch is not a function`（實測踩到，症狀是「讀不到 session log」）。
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
    let out = []
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out = out.concat(findLogs(full, depth + 1))
      else if (/session\.v3\.jsonl/.test(entry.name)) out.push({ path: full, at: statSync(full).mtimeMs })
    }
    return out
  }

  /** 遞迴找 `chat.jsonl`（`chats/<角色>/<房間>/chat.jsonl`）。 */
function findChatFiles(dir, depth = 0) {
  if (depth > 3) return []
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  let out = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out = out.concat(findChatFiles(full, depth + 1))
    else if (entry.name === 'chat.jsonl') out.push(full)
  }
  return out
}

/** 逐 frame 解。⚠️ 單一 frame 壞掉不該讓整支爆掉——我們是來找 header 的。 */
  function decompressAllFrames(bytes) {
    const starts = []
    for (let at = 0; at + 4 <= bytes.length; at += 1) {
      if (bytes[at] === 0x28 && bytes[at + 1] === 0xb5 && bytes[at + 2] === 0x2f && bytes[at + 3] === 0xfd) starts.push(at)
    }
    let out = ''
    for (let i = 0; i < starts.length; i += 1) {
      const end = i + 1 < starts.length ? starts[i + 1] : bytes.length
      try {
        out += zstdDecompressSync(bytes.subarray(starts[i], end)).toString('utf8')
      } catch {
        /* 壞掉的 frame 跳過 */
      }
    }
    return out
  }

  let found = null
  try {
    /**
     * ⚠️ **只找「這一間酒館的」session。**
     *
     * 第一版是「全部 log 按 mtime 排序、取最新的那幾個」——而那樣會讀到
     * **別的** session（實測：它報的是 `dsh-tavern` 那個工作區底下的
     * session，也就是 agent 自己講話的那一個，**不是酒館的房間**）。
     * 一個報錯對象的驗證工具比沒有工具更糟。
     *
     * 這一間酒館的 session id 有兩個來源，兩個都要收：
     *   1. `.sessions/` 的綁定表（房間 ↔ session）
     *   2. 每一個 `chats/<角色>/<房間>/chat.jsonl` 標頭的 `dsh_session_id`
     *      ——綁定表可以重建，標頭是對話自己的事實
     */
    const wanted = new Set()
    const sessionsMap = join(tavern.path, '.sessions')
    // ⚠️ `readdirSync` 回的是**陣列**，不是 Promise——`.catch()` 會丟
    // `readdirSync.catch is not a function`。同一個坑這一支已經踩過兩次
    // （上一次在 `findLogs`），所以這裡寫成 try/catch。
    let sessionFiles = []
    try {
      sessionFiles = readdirSync(sessionsMap)
    } catch {
      sessionFiles = []
    }
    for (const name of sessionFiles) {
      if (name.endsWith('.json')) wanted.add(name.slice(0, -'.json'.length))
    }
    for (const chat of findChatFiles(join(tavern.path, 'chats'))) {
      try {
        const first = readFileSync(chat, 'utf8').split('\n')[0]
        const id = JSON.parse(first)?.chat_metadata?.dsh_session_id
        if (typeof id === 'string' && id !== '') wanted.add(id)
      } catch {
        /* 壞檔跳過 */
      }
    }
    if (wanted.size > 0) {
      console.log(`  ℹ️ 這一間酒館有 ${String(wanted.size)} 個 session 綁定，只找它們的 log`)
    } else {
      console.log('  ⚠️ 找不到任何 session 綁定（這一間酒館還沒聊過？）')
    }

    const logs = findLogs(sessionsDir)
      .filter((one) => wanted.size === 0 || [...wanted].some((id) => one.path.includes(id)))
      .sort((left, right) => right.at - left.at)
    for (const log of logs.slice(0, 8)) {
      const bytes = readFileSync(log.path)
      const text = bytes.subarray(0, 4).toString('hex') === '28b52ffd' ? decompressAllFrames(bytes) : bytes.toString('utf8')
      for (const line of text.split('\n')) {
        if (line.includes('"request/header"') === false) continue
        // 一行一則 JSON；壞行跳過（這個檔案也有別的行程在寫）。
        let parsed = null
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        const config = parsed?.data?.header?.config
        if (config === undefined || config === null) continue
        // 後面的覆蓋前面的 ⇒ 留下的是**這一份 log 裡最後一次**請求。
        found = { config, name: log.path.slice(sessionsDir.length + 1) }
      }
      if (found !== null) break
    }
  } catch (error) {
    console.log(`  ⚠️ 讀不到 session log：${String(error.message)}`)
  }

  if (found === null) {
    console.log('  ⚠️ 這一間酒館的 log 裡找不到 request/header。')
    console.log('     → 先在酒館裡**說一句話**（要真的跑完一輪），再跑一次這一支。')
    failures += 1
  } else {
    const { config } = found
    console.log(`  ℹ️ 來自 ${found.name}`)
    console.log(
      `     provider=${JSON.stringify(config.provider)} model=${JSON.stringify(config.model)} ` +
        `reasoningEffort=${JSON.stringify(config.reasoningEffort)}`,
    )
    console.log(
      `     temperature=${JSON.stringify(config.temperature)} ` +
        `maxTokens=${JSON.stringify(config.maxTokens)} stop=${JSON.stringify(config.stop)}`,
    )
    // ⚠️ 這一條是這一支最重要的斷言：**別人的決定不可以被我們吃掉**。
    ok(
      typeof config.provider === 'string' && typeof config.model === 'string',
      'provider／model 還在（沒有把 DSH 的模型選擇吃掉）',
      config.provider === undefined ? '⚠️ 被吃掉了 → 那個 waterfall 的 `next()` 有問題' : '',
    )
    const stop = config.stop
    ok(
      stop === undefined || (Array.isArray(stop) && stop.length > 0),
      'stop 只有兩種樣子：不存在，或非空的陣列',
      stop === undefined ? '（這一輪沒有送 stop——開關沒開的話那是對的）' : JSON.stringify(stop),
    )
  }
}

console.log(
  failures === 0
    ? '\n全部通過 ✅\n'
    : `\n有 ${failures} 項沒過 ❌（上面每一項都有「要是什麼」的說明）\n`,
)
// ⚠️ **非零的離開碼只能用 `process.exitCode`**，不可以 `process.exit()`、
// 也不可以 `throw`。三種都實測過：
//   - `process.exit(n)` → `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`
//   - `throw`           → 同一個 assert（錯誤路徑也一樣吵）
//   - `process.exitCode = n` → **乾淨**，exit code 照樣是 n
// 而那個 assert 只在「這個 process 用過 `fetch`」之後出現——也就是這一支的正常情況。
process.exitCode = failures === 0 ? 0 : 1
