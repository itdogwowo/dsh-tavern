# dsh-tavern 實作規範

> 這份是**合約**，不是討論稿。寫程式的時候照這份；有疑問的時候這份是權威；
> 要改架構**先改這份**再改程式。
>
> 設計的判斷與理由在 [`redesign.md`](redesign.md)（為什麼這樣選、被推翻過什麼）。
> 這份只放**怎麼寫**。
>
> 每一條規範都有編號（`R1`、`R2`…），而且**都必須有一條測試釘住**（見 §6）。
> 沒有測試的規範等於沒有規範。
>
> 撰寫時間：2026-09-17

---

## 1. 三個面

ds-tavern 是**一個套件、三個入口**。每個面在不同的地方跑、有不同的風險、只能注入不同的東西。

| 面 | 入口 | 在哪裡跑 | 允許注入 | 壞掉會怎樣 |
|---|---|---|---|---|
| **宿主半** | `exports["."]` → `lib/index.js` | `dsh web` 行程 | **只有 `webServer`** | **整個 DSH 開不起來** |
| **瀏覽器半** | `exports["./client"]` → `lib/client.js` | 瀏覽器 | **只有 `slots`** | **整個 GUI 白屏** |
| **Agent 面** | `exports["./agent"]` → `lib/agent.js` | **只在 preset 裡** | `systemPrompt`（＋將來的 `tools`） | 只有那個對話開不起來 |

**風險從上到下遞減。** 所以：**能放 Agent 面的東西不要放宿主半。**

---

## 2. 硬規則

### R1 — 硬依賴放 `inject`，可選依賴放 `ctx.inject()`

**這是 Cordis 自己的機制，不是我們發明的**（`cordis/lib/types/registry.d.ts:101-111`）：

```ts
/**
 * Run a callback once the requested services are available.
 * Shorthand for `ctx.plugin({ inject, apply: callback })`: the callback
 * is unloaded and re-run whenever a required service changes.
 */
inject(deps: Inject, callback: Plugin.Function<void>): Fiber & PromiseLike<Fiber>;
```

```js
// ✅ 對：webServer 是硬依賴（沒有它這個插件什麼都不是）→ 放 inject
export const inject = ['webServer']

function apply(ctx) {
  // connection 是「有更好、沒有也能活」→ 用 ctx.inject 開一個子 fiber 等它。
  // 它不會拖住這一筆 entry 的啟動，所以拿不到也不會讓 dsh web 起不來。
  ctx.inject(['connection'], (ctx) => {
    ctx.connection.rpc.handle('/tavern', handler)          // 有驗證的通道
  })
  // webServer 的裸路由仍然掛著，當作退路
}

// ❌ 錯：把可選依賴寫進 inject —— 等不到的服務會讓這筆 entry 停在 pending，
//        整個 dsh web 起不來。v1 就是這樣死的。
export const inject = ['webServer', 'connection']
```

| 依賴 | 性質 | 放哪 |
|---|---|---|
| `webServer` | **硬**：沒有它這個插件沒有意義 | `inject` 陣列 |
| `connection` | **軟**：有它更安全，沒有也能跑 | `ctx.inject([...], cb)` |
| `systemPrompt`（Agent 面） | **硬**：Agent 面存在的理由就是它 | `inject` 陣列 |
| `slots`（瀏覽器半） | **硬**：整個 UI 都掛在座位上 | `inject` 陣列 |

**判斷方式**：問「**沒有它，這個面還有意義嗎？**」有 → `inject`；沒有 → `ctx.inject()`。

### R2 — 瀏覽器半只 `slots`

```js
export const inject = ['slots']      // ✅
```

其他服務（`layout`、`remote`、`connection`…）一律 `ctx.get()`，而且**在使用的當下才拿**。

> 理由：客戶端插件的 `inject` 等不到服務時，**整個 GUI 不掛載**（`redesign.md` §8.5），
> 不是「酒館壞掉」。

### R3 — 絕對不自創 session 事件型別

酒館自己的資料（對話 → 角色的對照、書籤、任何狀態）**只能放在自己的側檔**。

> 理由：`dsh-session-persistence` 讀到不認得又沒標 `ignorable` 的事件型別會**拒讀整個 log**
> ——那個對話就再也回不來了。

### R4 — 系統提示只放「整場對話固定」的東西

| 放 | 不放 |
|---|---|
| 角色卡（description／personality／scenario／mes_example／first_mes） | ❌ 世界書 |
| 使用者人設 | ❌ 時間、天氣、任何每輪會變的字 |
| 固定的酒館風格指示 | ❌ 上一輪的摘要 |

> 理由：**KV 快取是前綴快取**。系統提示每輪變一次，整段前綴就每輪失效。
> 這也正好是 SillyTavern 的靜態／動態分界。

### R5 — 動態的東西放訊息，而且越靠尾端越好

世界書觸發的條目接在**使用者訊息**裡（或 `agent/pre-step` 注入）。

> 理由：同 R4。放在尾端只影響尾端，前面的前綴照樣命中。

### R6 — 卡片進系統提示一定要經過變數

```js
// ✅ 對
ctx.systemPrompt.variable('tavern_card', (c) => cardTextFor(c.agent))
ctx.systemPrompt.section({ name: 'tavern:card', order: 0, text: '{{tavern_card}}', complete: true })

// ❌ 錯——卡片裡的 {{char}} / {{user}} 會讓 interpolate() 直接丟錯，
//        而且症狀是「卡片看起來好好的，一送出就炸」
ctx.systemPrompt.section({ name: 'tavern:card', order: 0, text: cardText })
```

> 理由：`renderPrompt` 對**任何**不認得的 `{{...}}` 丟錯，而且沒有跳脫語法。
> 替換進去的值**不會再被掃描一次**，所以變數是唯一的解法。

### R7 — 所有寫入都是原子寫入

用 `lib/write.js` 的 `atomicWrite()`（暫存檔 → rename）。不要裸的 `writeFile`。

### R8 — 不覆蓋

- 開新對話、上傳插圖撞名 → **自動編號**
- 卡片／世界書 → 只有使用者明確給了 id 才寫那個檔
- 刪除 → **只在使用者按了才刪**，不做背景清理

### R9 — 一個套件、三個入口，全部要宣告

```json
"exports": {
  ".": "./lib/index.js",
  "./client": "./lib/client.js",
  "./agent": "./lib/agent.js"
}
```

> 注意：**新增一個 export 不是熱的**——`dsh-client-hmr` 是輪詢檔案，
> 新 export 要重啟宿主才看得到（`redesign.md` §11.4）。

### R10 — 每個面都有自己的版本標記

`TAVERN_BUILD` / `CLIENT_BUILD` / `AGENT_BUILD`，而且 `verify.mjs` 要對得上
`package.json` 的版本。

### R11 — 動態的提示詞 provider 一定要「讀不到就回空的」

系統提示的 provider（見 §3.2）是在**每一次模型請求**裡被呼叫的。在那裡丟錯等於
「卡片被搬到別的地方 → 每一輪都失敗」，而且錯誤會以很難懂的形式冒出來。
**讀不到、壞檔、型別錯 → 回空字串**，讓對話繼續，使用者看得見「角色不見了」。

### R12 — preset 不掛的，不代表不會出現

`complete: true` 只保證**系統提示**乾淨，**不保證工具乾淨**。
DSH 自己的工具是掛在 preset 裡的，但**第三方插件可能把工具註冊在全域**，
那些會漏進 preset session（實測：`ego_*` 整套都在，而且呼叫得動）。

→ 酒館模式要**主動遮蔽繼承來的全域工具**（用 `ctx.tools.restrict`，見 §8.3）。
→ 未來我們自己的酒館工具是 scope 內註冊的，**不受這個遮蔽影響**。

### R13 — 世界書只做「標準」等級，而且偏離 ST 的地方要寫下來

實作範圍：`constant`／`key`／`keysecondary`／四種 `selectiveLogic`／`caseSensitive`／
`matchWholeWords`／`order`／預算上限。

**刻意不做**：`position` 八種位置、`depth`、`role`、`probability`、`sticky`、
`cooldown`、`delay`、**遞迴**——我們只有一種插入位置（最新的使用者訊息），
做那些發揮不出效果，複雜度卻很高。

**偏離 ST 的地方一定要在程式碼裡寫出理由**（例：`matchWholeWords` 對中文無效，
見 §9.1）。照抄一個對中文壞掉的規則，比不實作更糟——因為它會**默默地**出錯。

---

## 3. 範例：照著抄

### 3.1 preset 檔（裝好就不動，使用者不需要管理）

```yaml
# ~/.dsh/.agent-presets/dsh-tavern/agent.cordis.yml
- id: tavern-agent
  name: 'dsh-tavern/agent'
```

```yaml
# ~/.dsh/.agent-presets/dsh-tavern/preset.yml
name: 酒館模式
description: 由 dsh-tavern 提供——角色卡就是系統提示，沒有任何工具
order: 900
```

**就這樣。** 沒有 `dsh-persona`（我們的 Agent 面自己註冊身分）、沒有任何 `tool-*` 一列
（所以那個 session 沒有工具）。

### 3.2 Agent 面：卡片 → 系統提示

```js
// lib/agent.js
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'dsh-tavern-agent'
export const inject = ['systemPrompt']     // 合規：只在 preset 裡，不在 dsh web 啟動路徑上

/** 卡片快取：檔案 → { stamp, text }。mtime 沒變就不重新解析。 */
const cache = new Map()

function cardTextFor(agent) {
  const sessionId = typeof agent?.id === 'string' ? agent.id : ''
  if (sessionId === '') return ''
  const found = lookupSession(sessionId)              // 側檔：session → { root, character }
  if (found === null) return ''
  const file = join(found.root, 'characters', found.character + '.json')

  const stamp = statSync(file).mtimeMs                 // 同步、微秒級
  const hit = cache.get(file)
  if (hit !== undefined && hit.stamp === stamp) return hit.text   // ← 命中率 ~100%

  const text = renderCard(JSON.parse(readFileSync(file, 'utf8')))
  cache.set(file, { stamp, text })
  return text
}

export function apply(ctx) {
  // R6：卡片放變數，section 只放參照
  ctx.effect(
    () => ctx.systemPrompt.variable('tavern_card', (c) => cardTextFor(c.agent)),
    'tavern.card',
  )
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: 'tavern:card',
      order: 0,
      text: '{{tavern_card}}',
      complete: true,          // 這一段就是全部的系統提示
    }),
    'tavern.section',
  )
  ctx.systemPrompt.suppressRuntimeContext()
}
```

**為什麼這樣就夠**：`dsh-agent-loop` 在**每一個模型步驟之前**呼叫
`systemPrompt.assemble()`，我們的 provider 就被叫一次。所以**改了卡片，下一輪就生效**
——不需要新開對話。

### 3.3 一個 op 的完整鏈路（客戶端按鈕 → 寫檔）

```js
// lib/client.js（瀏覽器半）
function rename(id, next) {
  return ctx.get('connection').rpc.call('/tavern', 'chat.rename', { id, chat, next })
    .then((result) => {
      if (result.ok !== true) throw new Error(result.error.message)
      return result.value
    })
}
```

```js
// lib/index.js（宿主半）
const connection = ctx.get('connection')
if (connection !== undefined) {
  connection.rpc.handle('/tavern', async (endpoint, payload) => {
    try {
      return { ok: true, value: await dispatch(endpoint, payload) }
    } catch (error) {
      return { ok: false, error: { code: 'tavern/failed', message: String(error.message), details: {} } }
    }
  })
} else {
  // 退路：裸路由 ＋ ctx.connection.requestRejection()（拿不到 connection 時用自寫圍籬）
}
```

**規範**：錯誤一律回 `{ok:false, error:{code, message, details}}`，不要讓它 reject。

### 3.4 世界書注入（**待驗**）

```js
// 用 agent/pre-step 的 waterfall 改寫「這一輪要進去的訊息」
ctx.on('agent/pre-step', async (payload, next) => {
  const messages = await next()
  const fired = scanWorldbook(payload.agent, messages)   // 依最新訊息決定哪些條目要出現
  if (fired.length === 0) return messages
  return injectBeforeNewest(messages, fired.join('\n'))  // R5：越靠尾端越好
})
```

> ⚠️ 這一條的 API 形狀**還沒實測**（`redesign.md` §10.6）。
> 在驗證之前不要照抄。

### 3.5 測試的寫法

每個 `R` 編號至少一條測試，而且**測試要釘住「為什麼」**：

```js
// ✅ 好：斷言訊息說出壞掉會怎樣
assert.equal(source.includes("inject = ['webServer', 'connection']"), false,
  'R1：多注入一個服務就多一個「dsh web 開不起來」的理由')

// ❌ 壞：只說「不可以這樣」
assert.equal(source.includes("'connection'"), false)
```

> 掃原始碼的斷言**一定要先去掉註解**，而且要用字串感知的去法
> （`accept: 'image/*'` 會騙過純 regex 的版本——`test-client.mjs` 已經踩過）。

---

## 4. 資料與檔案

| 路徑 | 內容 |
|---|---|
| `<酒館>/characters/<id>.json` | 人物卡（SillyTavern V2/V3 信封） |
| `<酒館>/worldbooks/<id>.json` | 世界書（原生 `{entries:{uid:{...}}}`） |
| `<酒館>/chats/<角色>/<房間id>/` | 一間房＝一個資料夾：`room.json`（設定）＋ `chat.jsonl`（對話，第一行是標頭，`chat_metadata` 是自由物件）＋ `art/`。**身分是 id，不是名字**（見 `room-layout.md`） |
| `<酒館>/art/{characters,worldbooks,chats,tavern}/…` | 插圖（資料夾內容就是清單） |
| `<酒館>/tavern.json` | 這間酒館的設定（含主圖指定） |
| `<酒館>/.sessions/<sessionId>.json` | **側檔**：session → `{character, chat}`（R3）。是**索引**，掉了可以從對話檔的標頭重建 |

**`chat_metadata` 裡可以放 `dsh_session_id`**——它是 SillyTavern 自己的自由欄位，
所以這樣寫是格式相容的，不是硬塞。

**誰是真相**：對話 ↔ session 的關聯，**真相在對話檔的標頭**（跟著檔案走）；
`.sessions/` 是為了讓 Agent 面能 O(1) 查到的**索引**。所以：
- 綁定時兩個都寫（`session.bind` 會順手蓋標頭）
- 索引掉了 → `session.rebuild` 從標頭重建
- 索引壞掉 → 當作沒綁定（回退到 preset 的 `card`），**不是**讓對話開不起來

---

## 5. 命名

| 東西 | 規則 | 例 |
|---|---|---|
| preset id | `/^[a-z0-9][a-z0-9-]*$/`（是資料夾名，**不能有中文**） | `dsh-tavern` |
| preset 顯示名 | 中文可以 | `酒館模式` |
| rpc 頻道 | `/^\/[A-Za-z0-9._~-]+$/`，**`/api` 保留** | `/tavern` |
| fetch 路由 | **必須在 `/api` 底下** | `/api/dsh-tavern/asset` |
| 提示詞變數 | `[a-z][a-z0-9_]*` | `tavern_card` |
| prompt section 名 | 用 `:` 分命名空間 | `tavern:card` |

---

## 6. 規範 ↔ 測試對照

| 規範 | 釘它的測試 | 狀態 |
|---|---|---|
| R1 硬依賴 `inject`／可選 `ctx.inject()` | `verify.mjs` ＋ `test-agent.mjs` §7 | ✅ |
| R2 瀏覽器半只 `slots` | `verify.mjs` ＋ `test-client.mjs` | ✅ |
| R3 不自創 session 事件 | `test-workspace.mjs` §13 ＋ `smoke.mjs` §11b ＋ `test-agent.mjs` §8 | ✅ |
| R4 系統提示只放靜態 | `test-agent.mjs` §5（mtime 一變就重讀）＋ 實測 | ✅ |
| R5 動態放訊息 | `test-worldbook.mjs`（6 段）＋ `test-agent.mjs` §9 ＋ 實測 | ✅ |
| R6 `{{}}` 走變數 | `test-agent.mjs` §4——**餵含 `{{char}}` 的卡** | ✅ |
| R7 原子寫入 | `smoke.mjs` §13（SIGKILL 實測） | ✅ |
| R8 不覆蓋 | `smoke.mjs` §7／§18 | ✅ |
| R9 三個入口 | `verify.mjs` | ✅ |
| R10 版本標記 | `verify.mjs`（三個面都檢查） | ✅ |
| R11 讀不到回空的 | `test-agent.mjs` §5／§8／§9 | ✅ |
| R12 遮蔽全域工具 | `test-agent.mjs` §7 ＋ 實測 | ✅ |
| R13 世界書只做「標準」等級 | `test-worldbook.mjs` §3（四種 selectiveLogic） | ✅ |

**十二條全部有測試。** 下一個工作包是 UI（`redesign.md` §4 的分區；現在是**五個**：
🏠 大廳／💬 包廂／🎭 卡司／📖 藏書／⚙️ 設定）。

---

## 9. 世界書：我們做哪些、刻意不做哪些

`lib/worldbook.js` 的檔頭有完整對照表。摘要：

| ST 的功能 | 我們 | 為什麼 |
|---|---|---|
| `constant`、`key`、`keysecondary`、四種 `selectiveLogic`、`caseSensitive`、`matchWholeWords`、`order`、預算 | ✅ | 「標準」等級 |
| `position` 八種插入位置、`depth`、`role` | ❌ **只有一種** | DSH 的 session 只給「使用者訊息」一個槓桿 |
| `probability`／`sticky`／`cooldown`／`delay`／**遞迴** | ❌ | 只有一種插入位置，做了發揮不出效果，複雜度卻很高 |

### 9.1 ⚠️ 我們在 `matchWholeWords` 上偏離 ST

ST 用 `(?:^|\W)(key)(?:$|\W)`。**但 JS 的 `\w` 只有 `[A-Za-z0-9_]`**，
所以中文一律算 `\W`——那個邊界對中文是壞的：「酒」會在校「**酒店**」裡命中。

我們的規則：純 ASCII 的關鍵字照 ST 用邊界；**含中文的關鍵字讓整詞模式無效**
（退回包含比對）。

選「無效」而不是「用壞掉的邊界」，是因為兩者的錯法不對稱：無效只是多注入一點
設定；壞掉的邊界會**默默讓設定該出現時不出現**，使用者根本查不出來。

（這一條是 `test-worldbook.mjs` §2 寫出來之後才發現的——**測試抓到我自己照抄錯的地方**。）

---

## 7. 第一個工作包的定義（可以開工的最小單位）

**目標**：證明 §10 的架構走得通，並把 R3～R6、R9 的測試補上。

| # | 做什麼 | 驗什麼 |
|---|---|---|
| 1 | `lib/agent.js`：變數 ＋ section ＋ `complete: true` | R6——**餵一張含 `{{char}}`／`{{user}}` 的卡**，確認不炸 |
| 2 | 寫 `~/.dsh/.agent-presets/dsh-tavern/`（三行 ＋ `preset.yml`） | preset 被 DSH 接受、`session.create` 成功 |
| 3 | 開一個 session，問「你是誰、你能做什麼」 | 只認得卡片、**一個工具都沒有**、沒有 harness 身分 |
| 4 | 改卡片檔案（不動 session），再問一次 | R4——**下一輪就生效** |
| 5 | 故意讓 preset 壞掉，開一個 session | **`dsh web` 不受影響** |
| 6 | 寫 `.sessions/<id>.json` 側檔並讀它 | R3 的替代方案可行 |

**六步都過了，才開始畫 UI。** 這個工作包很小，但它決定 UI 之前的所有事。

---

## 8. 第一個工作包：**實測結果**（2026-09-17）

在真的 GUI、真的模型上跑完。結論：**架構成立**，但發現一件研究沒預料到的事。

### 8.1 六步的結果

| # | 結果 | 證據 |
|---|---|---|
| 1 | ✅ | `test-agent.mjs` §4：卡片原文直接進 section 會丟錯；走變數安全 |
| 2 | ✅ | 寫進 `~/.dsh/.agent-presets/dsh-tavern/` 之後，**不用重啟**，模式選單就出現「酒館模式」 |
| 3 | ✅ | 模型回答：「我收到的**只有這張角色卡**（人設、性格、場景、對話示範），沒有『你是軟體工程師』之類的指示」 |
| 4 | ✅ | **在卡片檔裡插入 `【LIVE-RELOAD-TEST-7f3a】`，同一個 session 的下一輪就唸出來了**；軌跡裡也記了一筆「系统提示词已更新」 |
| 5 | ✅ | 放一個指名不存在套件的 preset → GUI 正常、`dsh-web.log` 沒有任何錯誤 |
| 6 | ✅ | 側檔 `lib/workspace.js` 的 `bindSession`／`readSession`／`rebuildSessionBindings`，測試在 `test-workspace.mjs` §13 與 `test-agent.mjs` §8 |

### 8.1b 第二個工作包：R3（session 綁定）與 R5（世界書）

| 項目 | 結果 | 證據 |
|---|---|---|
| R3 對照表 | ✅ | `<酒館>/.sessions/<sessionId>.json`；真相另外蓋進對話檔標頭的 `chat_metadata.dsh_session_id`，索引掉了可以 `session.rebuild` 重建 |
| R3 認人 | ✅ | `agent.session.header.cwd` ＋ 對照表 → 卡片路徑（`test-agent.mjs` §8） |
| R5 世界書 | ✅ | **實測**：訊息裡沒提到關鍵字 → 只有 `constant` 條目進去；提到「鳳梨」→ 關鍵字條目**正確觸發**。軌跡裡的實際訊息逐輪可驗 |
| R5 位置 | ✅ | 注入的區塊接在**最新一則使用者訊息**前面（KV 快取：只動尾端） |
| R5 保真度 | ✅ | 只換 `content`，`id`／`role`／`source` 全部保留（`test-worldbook.mjs` §5） |

### 8.2 關鍵數據

| | 有工具（未遮蔽） | 遮蔽之後 |
|---|---|---|
| 每一輪的 token | **10.6K** | **749** |
| 系統提示 | 只有角色卡 | 只有角色卡 |
| 工具 | **一整套 `ego_*`，而且真的呼叫得動** | 無 |

KV 快取：第 2 輪起 **77%／82%** 命中——系統提示穩定，前綴快取照常運作（R4／R5 成立）。

### 8.3 ⚠️ 研究沒預料到的事：全域工具會漏進來

研究說「preset 不掛 `tool-*` 一列 → 那個 session 沒有工具」。**只對一半。**

- **對的部分**：DSH **自己**的工具是「掛在 preset 裡」的（出貨的 web 組合把它們在主機平面停用、
  移到 preset 後面），所以不掛就沒有。
- **錯的部分**：**第三方插件不一定要遵守那個慣例。** 實測的環境裡有一個第三方插件
  把工具註冊在**全域**，於是酒館模式的 session 照樣看得到一整套它的工具
  ——而且**真的呼叫得動**（模型成功執行了其中一個並拿到真實回傳）。

對角色扮演來說那是災難：模型開始報工具清單、想開瀏覽器、直接出戲。

**修法用 DSH 自己的機制**（`ctx.tools.restrict`，`dsh-tools/lib/index.js:2790`）：

```js
ctx.inject(['tools'], (scoped) => {
  const names = scoped.tools.schemas()          // 省略 scope ＝ 全域視圖
    .map((s) => s.name)
    .filter((n) => n !== 'run_code')            // PTC 保留通道，restrict 拒收
  if (names.length > 0) scoped.tools.restrict({ deny: names })
})
```

三個關鍵性質（都是文件明講的，實測也成立）：
- 它是「**per-scope 的全域工具遮罩**」，而且**不影響 scope 自己註冊的工具**
  → 我們未來的酒館工具不受影響。
- `ctx.inject` 而不是寫進 `inject` 陣列 → 沒有 `tools` 服務時**核心功能不陪葬**。
- `denyGlobalTools: false` 可以關掉（給「我就是要用那些工具」的人）。

實測結果：模型回答「**我沒有任何工具**」，總用量 10.6K → **749**。

### 8.4 這一輪學到的操作教訓

**ESM 的模組快取是用路徑當 key 的。** 改了 `lib/agent.js` 之後，同一條路徑會拿到**舊的模組**
——即使 preset 換了一個新的 generation。**「複製到安裝目錄」只在這條路徑還沒被載入過的時候有效**，
第一次之後就沒用了（這一輪就是靠「安裝路徑還沒被載入過」才驗到的，不是通則）。

三個可行的辦法：

| 辦法 | 什麼時候用 |
|---|---|
| **換一個檔名**（`tmp/agent-v2.js`，每改一次 +1） | 開發中反覆驗證，不用重啟 |
| **重啟 `dsh web`** | 收尾時確認正式路徑（但會結束正在跑的 session） |
| 兩者混用 | 平常 (1)、收尾 (2) |

**瀏覽器半不用這樣**：`lib/client.js` 複製過去、重新載入頁面就好。
**宿主半要重啟。** 三種改動、三種代價，寫在 `plan.md` §6.4。
