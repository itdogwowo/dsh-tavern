# dsh-tavern 交接與計劃書

> **這份文件的用途**：讓一個**完全沒有上下文**的人（或 agent）在隔天、換 session、
> 甚至換機器之後，能夠讀完這一篇就接著做事。
>
> 如果你只有五分鐘：讀 §1、§2、§6、§7。
> 如果你要改程式：§3（程式碼地圖）→ §5（已驗證的事實）→ `implementation-spec.md`。
> 如果你要改設計：`redesign.md`（判斷與理由）→ 這份的 §4（已定案的事）。
>
> 撰寫時間：2026-09-17 傍晚（Windows）。**2026-09-18 在 macOS 上更新過一次**：
> §2（狀態）、§6（環境與操作手冊整節重寫）、§7.6（刪除對話做完了）、§11（檢查清單）。
> 其餘章節（§3 程式碼地圖、§5 已驗證的事實、§7.1–7.4）仍然是 09-17 的內容，
> **但那些結論仍然有效**——它們講的是 DSH 的行為與設計判斷，跟作業系統無關。

---

## 1. 一句話

**dsh-tavern 是 DeepSeek Harness（DSH）上的一個「酒館模式」插件**：
一間酒館＝使用者自己選的一個普通資料夾，裡面放人物卡、世界書、對話、插圖。
它讓你在 DSH 裡用 SillyTavern 格式的角色卡**真的跟角色聊天**，
而角色卡本身就是那個對話的系統提示。

**它為什麼存在**：SillyTavern 有生態（卡、世界書、對話格式）但沒有 DSH 的能力；
DSH 有能力但沒有角色扮演的前台。這個插件是把兩邊接起來，而且**資料是使用者的**
（一個資料夾，帶走就好，可以手改、可以備份）。

---

## 2. 現在的狀態（2026-09-18，macOS）

> 這一節在 2026-09-18 更新過：專案從 Windows 換到 macOS、GitHub 上的 2.5.0 已經
> 拉下來、安裝方式改成 `link:`、而且 §7.6 的第一件事（刪除對話）做完了。

| | |
|---|---|
| 版本 | **2.5.1**（已 commit 的工作區；2.5.0 已經在 GitHub 的 `main` 上） |
| 測試 | `npm test` **八套全綠**（`verify` / `test-worldbook` / `test-agent` / `test-preset` / `smoke` / `test-workspace` / `test-registry` / `test-client`） |
| 架構 | **三個面全部實作完成**：宿主半、瀏覽器半、**Agent 面** |
| 規範 | 12 條（R1–R13），**每一條都有測試釘住** |
| 真聊天 | ✅ **打通了，而且五步驗收全過**（§7.4）。逐字串流、寫回 `.jsonl`、換角色換卡都實測過 |
| 安裝 | ✅ `link:` 指回工作區（改工作區＝改插件；不再有兩份實體複製） |
| UI | 對話頁（包廂的本體）**已經能聊天**；**刪除對話的入口做好了**（2.5.1）；四分區的重做還沒開始 |
| 酒館 | 一間（使用者自己選的資料夾；附預設的老闆娘＋世界書，**還沒有任何對話**） |

**一句話**：**引擎做好了、油門接上了、車也真的會跑了——還差把車殼換成新的。**

> 上一個版本的最後一哩（上傳 2.5.0 到 GitHub、裝完確認版本標記）**都已經完成**，
> 見 §11。所以現在唯一還沒動的是 §7.5 那張表（四分區）。

---

## 3. 程式碼地圖

```
lib/index.js       宿主半（Node）。31 個 rpc op ＋ 兩條 HTTP 路由。
                   ⚠️ 在 dsh web 的啟動路徑上——壞了整個 DSH 開不起來。inject 只有 webServer
lib/client.js      瀏覽器半。全部 UI。是手寫的 __ModuleLoader__ bundle，不是 ESM、沒有 JSX
lib/agent.js       Agent 面（新）。只在 preset 裡跑。動態系統提示 ＋ 世界書 ＋ 工具遮罩
lib/worldbook.js   世界書的觸發邏輯（純函式，好測）
lib/workspace.js   一個酒館資料夾的讀寫（結構、卡片、世界書、對話、插圖、session 對照表）
lib/registry.js    酒館街的註冊表（~/.dsh/taverns.json）
lib/assets.js      插圖（art/ 底下，一項一組圖 ＋ 主圖）
lib/pngcard.js     PNG 角色卡的 tEXt chunk 解析
lib/write.js       原子寫入（暫存檔 → rename）
lib/defaults.js    新建酒館的預設內容（老闆娘 ＋ 世界書）
```

**測試**：`verify.mjs`（安裝前契約）、`test-agent.mjs`、`test-worldbook.mjs`、
`smoke.mjs`（宿主半整合，20 段）、`test-workspace.mjs`、`test-registry.mjs`、`test-client.mjs`。

---

## 4. 已定案的決策（不要再重開）

| 決策 | 內容 | 為什麼 | 細節 |
|---|---|---|---|
| **分區** | 4 區：`🏠 大廳`／`💬 包廂`／`🎭 卡司`／`📖 藏書` | 一個分區＝一個問題 | `redesign.md` §3、§4 |
| **導航** | 側邊欄維持現狀（酒館列 ＋ ×⋯× ＋ ＋）；**分區住在主面板裡面** | 側邊欄跟原生工作區清單共用高度，塞不下四層樹（使用者原話） | `redesign.md` §3.1 |
| **角色卡＝系統提示** | 用一個 preset ＋ Agent 面的**動態 provider**，不是每個角色一個 preset 檔 | 一份檔案服務所有角色；**改卡片下一輪就生效**（跟 ST 一樣） | `implementation-spec.md` §3.2 |
| **世界書** | 每一輪掃描，接在**最新的使用者訊息**前面 | 系統提示每輪變會毀掉 KV 快取；接尾端只動尾端 | `implementation-spec.md` §9 |
| **插圖** | 只跟著它的主人，**不做全館總覽** | 一種東西只有一個家 | `redesign.md` §5 決策 4 |
| **不加自訂 session 事件** | 酒館的狀態放自己的側檔 | DSH 讀到不認得的事件型別會**拒讀整個 log**，對話就回不來了 | R3 |
| **不自己圍籬笆** | 用 DSH 的 `connection` 通道（有驗證）；裸路由仍留著當退路 | 我們的四項檢查**擋不掉本機 curl**，DSH 的連 cookie 都驗 | `redesign.md` §11.1 |

---

## 5. 已驗證的事實（**實測**，不是推論）

> 這些是這一輪最貴的產出。**不要憑印象推翻它們**——每一條都有出處或實測記錄。

| # | 事實 | 怎麼驗的 |
|---|---|---|
| 1 | 寫一份 preset 進 `~/.dsh/.agent-presets/`，**不用重啟**，模式選單就出現 | GUI 實測 |
| 2 | `complete: true` 讓系統提示**只剩角色卡**（沒有 harness 身分、沒有工具說明） | GUI 的「系统提示词」面板 |
| 3 | **改卡片檔，同一個 session 的下一輪就生效** | 在卡片裡插 `【LIVE-RELOAD-TEST-7f3a】`，下一輪被一字不漏唸出來 |
| 4 | preset 壞掉**不會**影響 `dsh web` | 放一個指名不存在套件的 preset → GUI 正常、log 零錯誤 |
| 5 | ⚠️ **全域工具會漏進 preset session** | 模型真的呼叫了其中一個第三方工具並拿到真實回傳；用 `ctx.tools.restrict` 遮蔽後變成「我沒有任何工具」，用量 **10.6K → 749 token** |
| 6 | 世界書按關鍵字正確觸發 | 訊息沒提「鳳梨」→ 只有 constant；提到 → 關鍵字條目出現（軌跡逐輪可驗） |
| 7 | KV 快取照常運作 | 第 2 輪起 **77～82%** 命中 |
| 8 | ⚠️ **ST 的 `matchWholeWords` 對中文是壞的** | JS 的 `\w` 只有 ASCII，所以「酒」會在校「**酒店**」裡命中。我們改成對中文無效 |
| 9 | ⚠️ **ESM 的模組快取用路徑當 key** | 改 `lib/agent.js` 之後同一條路徑會拿到**舊模組**，即使 preset 換了新 generation |
| 10 | 客戶端插件掛不起來＝**整個 GUI 白屏**（不是「酒館壞掉」） | 讀 DSH 出貨的啟動核心：`assertEntriesActive` 把 `pending` 跟 throw 一樣當致命 |

---

## 6. ⚠️ 環境與操作手冊（**最容易被忘掉的一節**）

### 6.1 路徑（**一律用相對的說法，不寫絕對路徑**）

> ⚠️ **這一節刻意不寫絕對路徑。** 這個 repo 會上傳到 GitHub，而絕對路徑會夾帶
> **使用者名稱**與私人目錄結構（連帶把「這個人在哪間公司、手上有哪些專案」洩出去）。
> 所以一律寫成「相對於 repo」或「相對於家目錄」——你自己機器上的實際位置，
> 用下面的方法算出來就好。
>
> 這一節原本寫死了兩台機器的完整路徑（macOS 與 Windows 各一串），已於 2026-09-18 移除。

| 東西 | 怎麼找 |
|---|---|
| **工作目錄（開發在這裡）** | 這個檔案所在的 repo 根目錄（`docs/plan.md` 往上兩層） |
| **實際安裝（DSH 載入的）** | `~/.dsh/profiles/<profile>/node_modules/dsh-tavern` |
| **preset** | `~/.dsh/.agent-presets/dsh-tavern/`（`agent.cordis.yml` ＋ `preset.yml`；**由插件自己裝**） |
| **使用者的酒館** | 使用者自己選的資料夾——查 `~/.dsh/taverns.json` |
| 酒館註冊表 | `~/.dsh/taverns.json` |
| **DSH 本體** | 看你是怎麼裝的：`npm i -g` → npm 的全域 `node_modules`；`npx` → npm 的 `_npx` 快取；Homebrew → `/opt/homebrew/lib/node_modules/` |
| DSH 的 log（**token 在這裡**） | `~/.dsh/dsh-web.log` |
| session 儲存 | `~/.dsh/sessions/` |
| GUI | `http://127.0.0.1:3085` |

`~` 是家目錄：macOS 是 `/Users/<你>`、Windows 是 `C:\Users\<你>`
（PowerShell 裡就是 `$env:USERPROFILE`）。有設 `DSH_HOME` 的話，`~/.dsh` 換成它。

**安裝方式：`link:` 最好**（2026-09-18 起）：

```sh
dsh plugin --profile web add "link:<這個 repo 的路徑>"
```

以前裝的是 `…/archive/refs/heads/main.tar.gz`，所以工作區與安裝目錄是
**兩份實體複製**——改了工作區的檔案，DSH 完全不知道。`link:` 讓「改工作區＝改插件」。

### 6.2 拿 GUI 的網址（token 每次重啟都會換）

```sh
grep "dsh web: http" ~/.dsh/dsh-web.log | tail -1
```

沒帶 token 開 `http://127.0.0.1:3085/` 會回 `dsh web authentication required`。
**這是 cookie 驗證，不是壞掉。**

### 6.3 跑測試

```sh
cd <這個 repo>
npm test
```

### 6.4 ⚠️ 怎麼驗證改動（三種改動、三種代價）

`link:` 之後**不必再複製檔案**，但三種改動的生效方式仍然不一樣：

| 改了什麼 | 怎麼讓它生效 |
|---|---|
| **瀏覽器半**（`lib/client.js`） | **重新載入頁面**（F5）就好——DSH 內建的 `dsh-client-hmr` 每 500ms 重新取 hash |
| **宿主半**（`lib/index.js`） | **必須重啟 `dsh web`**（路由表是載入時建立的常數） |
| **Agent 面**（`lib/agent.js`） | **必須重啟，或換一個檔名**（見下） |

**怎麼確認「瀏覽器半真的換新了」**（不必問人、不必看畫面）：

```sh
# 1. 從 SSE 拿到 dsh-tavern 目前的 rev
curl -sN http://127.0.0.1:3085/plugins/events | head -3
# 2. 抓那一份 bundle，grep 你剛改的字串
curl -s "http://127.0.0.1:3085/plugins/??dsh-tavern/client.js&rev=<rev>" | grep -c '<你剛改的字串>'
```

> 這一招 2026-09-18 用過：改完 `lib/client.js` 之後抓下來的 bundle 含著新字串
> （`確定要刪掉`），代表 HMR 已經把新版推上去了。注意**不要帶 `?token=`**
> （帶了反而 404），直接抓就好。

**Agent 面的陷阱**（第 9 條事實）：ESM 用**路徑**當快取 key，所以「換檔案」
**只有在這條路徑還沒被載入過的時候**才有效。第一次之後就沒用了。

三個可行的辦法：
1. **換檔名**（spike 用的辦法）：複製成 `tmp/agent-v3.js`，preset 指它。
   每改一次就 +1。可以在同一個 DSH 裡反覆驗證。
2. **重啟 `dsh web`**（最乾淨，但會結束正在跑的 session）。
3. 兩者混用：開發時用 (1)，收尾時用 (2) 確認正式路徑。

### 6.5 沙箱

工作目錄以外的地方（`~/.dsh/` 底下的 profile／preset／使用者的酒館）**寫入會被沙箱拒絕**。
拒絕時**用同一個操作重試一次**，加上 `sandbox_permissions: danger-full-access`
與一句 justification——審批提示就是使用者同意的管道。**不要繞路。**

> 真的踩過：`dsh plugin --profile web add "link:…"` 會讓 pnpm 對
> `node_modules` 裡的既有檔案 `chmod`，回 `ERR_PNPM_CMD_SHIM_CHMOD … Operation not permitted`。
> 那不是 pnpm 壞掉，是沙箱；升級權限重跑同一個指令就過了。

### 6.1b ⚠️ 這份 repo 會在**兩台機器**之間同步（2026-09-18 補）

同一個 repo 同時存在於兩台機器，而**它們的 DSH 環境不一樣**。
接手之前**先確認自己在哪一台**——但**兩台的實際路徑都不寫在這裡**（見 §6.1 的理由），
只寫「怎麼判斷」與「差在哪」。

| | **macOS** | **Windows** |
|---|---|---|
| 家目錄 | `/Users/<你>` | `C:\Users\<你>`（`$env:USERPROFILE`） |
| 使用者的酒館 | 使用者選的資料夾（查 `taverns.json`） | 同上 |
| DSH 本體 | 通常是 Homebrew 全域 | 通常是 `npx` 的 `_npx` 快取 |
| **插件安裝方式** | **`link:`** → 改工作區＝改插件 | **可能是 tarball 複製**（那就會漂移，見下） |
| `git` | 有（而且有 `origin`） | **可能不在 PATH 上** |
| Node／DSH | v26 / 0.1.5-rc.2 | v24 / 0.1.5-rc.1 |

**⚠️ 如果那一台的安裝是「複製」而不是「連結」**：

- 改了工作目錄的 `lib/*.js`，**安裝目錄不會跟著變**——DSH 載入的還是舊的。
- 反過來，**重新安裝會蓋掉手動複製的檔案**。
- 要在那裡驗證改動，就得**手動把 `lib/` 複製進安裝目錄**，
  或比照另一台改成 `link:`（一勞永逸）。

判斷「現在跑的是哪一版」最快的方法：`tavern.list` 回的 `build`，跟工作目錄的
`TAVERN_BUILD` 比。**兩台都一樣：宿主半改了就要重啟，客戶端半重新載入頁面就好。**

### 6.6 其他坑

- **`git` 現在有**（macOS 這台），而且 repo 有 `origin`。2026-09-18 之前
  GitHub 上的 `main`（`b1b93c4`，2.5.0）比工作區新，所以工作區要先 `git pull` 才對得上。
- **裝的時候不要再用 `refs/heads/main.tar.gz`**：pnpm 的快取會讓它裝到舊版。
  要嘛用 `link:`（開發），要嘛用 commit-pinned URL
  （`…/archive/<sha>.tar.gz`）。**舊的 `main.tar.gz` 寫法在第二次裝之後就不可信了。**
- **session log 是 zstd 多 frame**：`zstdDecompressSync(readFileSync(f))` 只解得出第一 frame。
  要讀完整內容得自己處理多 frame。
- **`ps`／`Get-NetTCPConnection` 這類指令在沙箱裡被拒**；要看行程用別的方式。
- **不要自己起第二個 web server**。GUI 就是 3085 那一個。
- **換行字元在兩台機器之間會變**（2026-09-18 在 Windows 上踩到）：同一棵樹裡
  `lib/*.js` 是 **CRLF**、`smoke.mjs`／`verify.mjs` 是 **LF**。所以**測試裡要跨行比對
  原始碼時，先把 `\n` 正規化**——`test-client.mjs` 的 `source` 現在有一行
  `.replace(/\r\n/g, '\n')`，就是為此。症狀是「斷言說找不到某段程式碼，但那段程式碼
  明明就在檔案裡」，而且**只有那一條會紅**。
- **`package.json` 的 `files` 要涵蓋 `lib/` 底下每個 `.js`**。從 GitHub 的 tarball
  安裝時 `files` 沒作用，所以漏掉它**在本機完全沒有症狀**——只有 `npm publish`
  出來的套件會少檔案。實際漏過三個（`lib/preset.js`、`lib/theme.js`、
  `lib/worldbook.js`）。`verify.mjs` 現在會檢查這一條。

---

## 7. 下一個工作包：💬 包廂（真的能聊天）＋ UI 重做

> **進度（2026-09-17 晚）**：後端全部完成、客戶端接線完成、`npm test` 八套全綠。
> **剩下最後一哩：宿主半要重啟一次**（新增的 op 才會生效），然後就能在 GUI 裡真的聊天。

### 7.1 先做這個（後端還缺的兩塊）✅ 完成

| # | 做什麼 | 為什麼 | 狀態 |
|---|---|---|---|
| 1 | **`chat.delete`** | 以前開了一份對話就**永遠刪不掉** | ✅ 只刪那個 `.jsonl` ＋ 解掉綁定（插圖留著，跟刪角色同一個規矩） |
| 2 | **插件自己安裝 preset** | 以前 preset 是我手動放的 | ✅ `lib/preset.js`：`preset.ensure` / `preset.status` / `preset.remove`，**不在啟動時裝**、**不覆蓋使用者改過的** |

順手補的兩個 op（一輪對話結束後要把紀錄寫回去）：
`chat.append`（追加訊息，**不改寫既有內容**）、`chat.messages`（讀訊息，壞行跳過）。

### 7.2 再接畫面（客戶端半）✅ 完成

```
開新對話（角色 X）
  1. preset.ensure          → 裝好酒館模式的 preset（宿主）
  2. session.list           → 反查有沒有既有的綁定（宿主）
  3. session.create         → 有綁定就回復，沒有就新開（客戶端，ctx.get('remote.session')）
  4. session.bind           → 寫對照表 ＋ 蓋標頭（宿主）
送訊息
  5. session.follow         → 先開始聽（**順序不能反**）
  6. session.prompt         → 送出
  7. 逐字貼上 → committed 結束 → chat.append 寫回 .jsonl
```

**四條硬規則**（`implementation-spec.md`）：
- **R2**：`remote.session` **不可以**寫進客戶端 bundle 的 `inject` 陣列
  （等不到服務＝**整個 GUI 白屏**）。用 `ctxRef.get('remote.session')`，**按下送出時**才拿。
  `test-client.mjs` §8 有一條原始碼斷言釘住這件事。
- **R3**：不要自創 session 事件型別。
- **R4／R5**：靜態的進系統提示、動態的進訊息。
- **R8**：寫回 `.jsonl` 不覆蓋、不背景清理。

### 7.3 ⚠️ 最後一哩：重啟一次 `dsh web`

**為什麼**：這一輪新增了宿主半的 op（`chat.delete`／`chat.append`／`chat.messages`／
`preset.*`）。宿主半的路由表是**載入時建立的常數**，所以**新增 op 一定要重啟**才會生效。
（客戶端半不用——重新載入頁面就好。）

**重啟前**：已經驗證過的
- `npm test` 八套全綠（新增的 op 全部有 `smoke.mjs` 的整合測試）
- 新版的對話畫面在真的 GUI 裡渲染正常、錯誤會顯示出來

**重啟後要驗的（三分鐘）**：
1. 開一份新對話 → 送一句話 → 應該**逐字**看到回覆
2. 回覆完之後，`chats/<角色>/<對話>.jsonl` 應該多兩行（使用者 ＋ 角色）
3. 關掉頁面再打開同一份對話 → 訊息還在（從 `.jsonl` 讀回來）
4. 換一個角色開對話 → 系統提示應該是**新的那張卡**
   （在「轨迹 → 初始系统提示词」看）
5. 刪掉一份對話 → 檔案真的不見了

### 7.4 ✅ 重啟後驗收（2026-09-17 晚，**五步全過**）

| # | 驗什麼 | 結果 |
|---|---|---|
| 1 | 開一份新對話 → 送一句話 → **逐字**看到回覆 | ✅ **有逐字串流的實測數據**：文字長度每 250ms 長 35～55 字（`174 → 209 →（模型思考 2.5 秒）→ 256 → 291 → 326 → 369 → 412 → 447 → 496 → 543 → 558`）。中間那段停頓是 reasoning，我們只渲染 `text-delta`，正確忽略 |
| 2 | 回覆完之後 `.jsonl` 多兩行 | ✅ 標頭帶 `chat_metadata.dsh_session_id`，後面兩則是使用者與角色；`.sessions/<id>.json` 也寫了 |
| 3 | 關掉頁面再打開同一份對話 → 訊息還在 | ✅ 從 `.jsonl` 讀回來 |
| 4 | 換一個角色開對話 → 系統提示是**新的那張卡** | ✅ 見下 |
| 5 | 刪掉一份對話 → 檔案真的不見了 | ✅ 清單少一份、綁定一起解掉、不存在的對話回可行動的錯誤 |

**第 4 步的證據**（最漂亮的一條）：測試卡寫「沉默的酒保。**絕不自我介紹**、不稱呼對方、
**句子很短**。」，問它「你是誰？」，回覆是——

> **「看櫃檯的。」**

三個字、沒有名字、沒有敬語。對比老闆娘那段文學腔的長回覆，**系統提示確實跟著卡換了**。

**另外驗到的一件好事**：preset 現在是**插件自己裝的**（`preset.ensure` 回 `created`），
不再是手寫的。刪掉手寫的那份之後，插件第一次被叫到就自己長出來了。

### 7.4b 這一輪在 GUI 裡抓到的兩個**真 bug**（都已修，都有測試）

| bug | 症狀 | 原因 |
|---|---|---|
| **卡片編輯器三個動作全壞** | 點一張卡 → 「找不到這間酒館：老闆娘」；儲存、刪除同理 | 客戶端送 `{ id: 角色id }`，而宿主半的約定是 `{ id: 酒館id, card: 角色id }`。`create` 更隱蔽：送 `{card:{name}}` 但宿主半讀 `args.name`，所以永遠建立「新角色」 |
| **點一張卡就讓整個設定頁消失** | 四區全不見，只剩一格空白，**沒有任何錯誤訊息** | `cardAssets` 用 `card.extensions !== null` 當守衛，而 `undefined !== null` 是 **true** → 讀 `.regex_scripts` 丟錯 → React 渲染期崩潰 → 座位被退位。**大多數的卡（包含我們自己產的）都沒有 `extensions`** |

第二個的訊息藏在 `window.__dshTavern.entryErrors` 裡——這是先前為了「註冊成功卻沒畫面」
加的除錯出口，這次真的派上用場。**排查的第一步就是看那裡。**

還有一個**很有價值的操作教訓**：這兩個 bug 都是「畫面看起來正常，只有一個紅字」或
「整格消失」的型別，離線測試（假的 React）**不會**抓到——它們是點進去才出現的。
所以 UI 的每一條路徑都要在真瀏覽器裡走一遍。

### 7.5 UI：四個分區（**還沒做——這是現在唯一還沒動的一塊**）

> 2026-09-18 只補了其中最重要的一個缺口（刪除對話的入口，見 §7.6），
> 四分區的版面重做**還沒開始**。

照 `redesign.md` §3.2 的形狀（一間酒館＝一張 main 面板，分區在裡面切）：

| 分區 | 內容 | 備註 |
|---|---|---|
| 🏠 大廳 | 店面圖、名稱／圖示／備註、概況、快速入口、**收合的進階**（資料夾、重新讀取、移除） | 「移除」是破壞性動作，不要再跟「重新命名」並排 |
| 💬 包廂 | 對話清單、開新對話、**對話本體**（✅ 已做）、房間插圖、**刪除對話**（✅ 2.5.1） | 對話本體已經能用了 |
| 🎭 卡司 | 海報牆（主圖＋名字）、欄位表單、**插圖集**、內嵌世界書、原始 JSON | 「找卡」跟「改卡」要能分開看 |
| 📖 藏書 | 世界書清單、**條目清單**（不要只有一大塊 JSON）、原始 JSON 模式、插圖集 | 條目編輯器只做常用欄位 |

### 7.6 UI 之前可以先決定的小事

- `sidebar.panellist` 能不能取代我們現在**包下整個側邊欄**的做法？
  （現在是 `sidebar.workspaces` ＋ `priority: -1`，是這個插件最有侵略性的一件事。
  研究說 `sidebar.panellist` 是「加進去就好、不會蓋掉別人」的座位，而且沒有住戶。）
  **這會改變外觀（酒館街不再是原生清單下面那一排），所以要使用者決定。**
- **對話列已經照原生會話列重做**（2026-09-18，2.5.1）：`slot → title → time → actions`
  四個部分齊全、hover 時時間讓位給 ⋯、⋯ 開一個 portal 到 `document.body` 的選單
  （**改名／分支／刪除**，原生是「改名／分支／封存」——封存沒有對應的酒館概念）。
  改名是行內輸入框（照原生 `.renameInput`）；分支接 DSH 自己的
  `remote.session.fork`；新增了 `chat.rename` 這個 op（檔案／綁定／插圖資料夾／
  主圖 key 四處一起搬，撞名不覆蓋）。
  > 排版與互動的對照表在 `README.md` 的「側邊欄的外觀」那一節。
- ~~**「刪除對話」還沒有按鈕。**~~ ✅ **2026-09-18 完成（2.5.1）**：
  設定頁「💬 對話紀錄」每一列多一顆「刪除」；按一下**不會刪**，只在那一列底下
  就地展開確認（「檔案會真的從磁碟上消失，救不回來」＋ 確定刪除／取消），
  確認後才送 `chat.delete`。順帶處理了「正在看的那份對話被刪掉」——對話頁會自己
  發現並退回設定頁，不會留在一頁不存在的紀錄上。

  > **還沒在真瀏覽器裡驗過**。離線測試只驗得到「確認列、參數、狀態而已」
  > （清單是非同步載入的，假 React 的 `useEffect` 不會跑，所以列在測試裡永遠是空的）。
  > 照 §7.4b 的教訓，要請使用者開著 GUI 走一遍：**列出來 → 按刪除 → 取消（不該刪）→
  > 再按刪除 → 確定刪除（檔案真的不見）**。

---

### 7.7 ⚠️ 這一輪踩到的三個 CSS／DOM 坑（**修 UI 之前先讀**）

1. **同一個 class 名被定義兩次＝排版災難。** `.dsh-tv-chat` 同時是「對話頁訊息容器」
   （`flex-direction:column`）與「側邊欄對話列」（要橫的），兩條同分特異度、後者勝出，
   但 `flex-direction` 不在後者的 `display:flex` 裡 → 對話列被壓成直的、元素互相重疊。
   現在**容器／列分名**（`chatBody` / `chatRow`），而且 `test-client.mjs` 第 12 項
   會掃「同一個 class 定義兩次」。
   > 同型的還有 `split`（兩欄 grid ↔ 拖曳分隔線）與 `tag`（檔案標籤 ↔ 舊標記），
   > 也一起拆了。
2. **portal 到 `document.body` 的元素拿不到主題變數。** 主題定義在側邊欄那棵子樹，
   而 `--dsw-alias-bg-elevated` **根本不存在**——用了它就會落到自己寫的 fallback，
   淺色主題下變成「深字壓深底」（實測：三個標籤全部看不到）。
   解法是 `inheritTheme()`：從側邊欄當下的 computed style 取底色／文字色，
   寫在**選單框**上。
   > **不要**用 `--dsw-alias-bg-base`：它在這個主題裡是
   > `rgba(255,255,255,calc(0 * .45))`，`calc` 讓它算不出顏色。
3. **`event.currentTarget` 在之後的繪製時是 `null`**（React 合成事件會清掉它）。
   需要「從被點的按鈕往上找」時，**在處理器裡就先把它存起來**，或改用
   `document.querySelector` 找一個穩定的錨點。

### 7.8 「運作中」的動畫指示器（`StatusDot`）——要抄就抄這一組數字

原生在「正在做事」時不是轉圈圈，而是**八顆 2×2 方格繞一圈跑**。實作在
`dsh-web-frontend/dist/assets/index-*.js`（`StatusDot`），樣式在同名的 `.css`：

```
RING = [[0,0],[4,0],[8,0],[8,4],[8,8],[4,8],[0,8],[0,4]]   // 繞一圈的順序
<svg width=10 height=10 viewBox="0 0 10 10" shapeRendering="crispEdges">
  RING.map(([x,y], i) => <rect x y width=2 height=2
       style={{ animationDelay: `${(i - 8) * 125}ms` }} />)   // 負延遲＝相位
```

```css
color: var(--dsw-static-deepseek-450)   /* 這台是 #5686fe；--dsh-state-ongoing 也指向它 */
.cell { fill: currentColor; opacity: .15; animation: dot-chase 1s infinite }
@keyframes dot-chase { 0%,12.4%{opacity:1} 12.5%,24.9%{opacity:.6} 25%,37.4%{opacity:.35} 37.5%,to{opacity:.15} }
```

酒館的版本：`lib/client.js` 的 `RUNNING_RING` / `RunningDot` / `.dsh-tv-runCell` /
`@keyframes dsh-tv-chase`，用在**側邊欄對話列的圖示欄**（那一列在跑的時候）。

**判定「在跑」的來源**：原生用 `node.session.running`，我們拿不到（`session.list`
只回文字綁定）——所以用本地狀態：對話頁送出 → 標記、收到結果／失敗／取消 → 清掉
（`runningChats` ＋ `setChatRunning()`），並走 `refreshChannel` 讓側邊欄只重畫
（`useRefreshChannelRerender()`，不重讀清單）。

> 同一個指示器在 DSH 的其他地方（會話列的狀態欄）也用同一組數字——所以照抄它就對了，
> 不要自己發明一顆轉圈圈的 spinner。

### 7.9 主題框架（design tokens）——UI 重新設計的地基

使用者：「UI 都非常簡陋，給（缺）一點現代化以及為了這個項目專門設計的味道」＋
「應該是可以自訂的，我們要設計個簡單的框架讓我們能夠動態注入放進酒館文件夾下」。

**改版前的實況（量出來的）**：129 處寫死的顏色（`#2a3140` ×26、`#6b7280` ×19…）、
只用了 12 個宿主變數、**7 種不一致的圓角**（4/6/7/8/9/10/12px）。每個元件自己挑色
——這就是「膠水感」的來源。

**現在的結構**：

```
lib/theme.js            權威色票：26 個 token ×（dark / light）＋ 純函式
                        （normalizeTheme / themeToCss / fullTokens / themeTable）
<酒館資料夾>/theme.json  這間酒館的覆寫（{ "base": "dark", "tokens": {…} }）
                        整包帶走時外觀跟著走
client 的 token 層       獨立的一個 <style data-dsh-tavern-theme="tokens">，
                        排在元件樣式**前面**；換主題只換這一層
client 的元件樣式        只准寫 var(--dsh-tv-*)，不准有 hex（測試會掃）
```

**token 命名**（元件只准用這些；`--dsh-tv-` 前綴）：

| 群組 | token |
|---|---|
| 底色 | `surface-0`（最底）／`surface-1`（卡片）／`surface-2`（浮起） |
| 邊框 | `line`／`line-soft` |
| 文字 | `text-1`（主要）／`text-2`（次要）／`text-3`（最弱） |
| 強調 | `accent`／`accent-soft` |
| 狀態 | `live`（進行中）／`danger`／`warn`／`ok` |
| 圓角 | `radius-sm`／`radius-md`／`radius-lg`／`radius-pill`（**只有四階**） |
| 陰影 | `shadow-1`／`shadow-2` |
| 動效 | `speed-fast`／`speed-slow`／`ease` |
| 字體 | `font`／`font-reading`／`font-mono` |

**預設色票**（「墨水與暖光」：極簡的骨架 ＋ 酒館的靈魂）：深墨底 `#0e1014`、
卡片 `#151821`、文字 `#e9ecf3`、**強調＝燈籠暖光 `#e2a45c`**。

**兩個刻意的設計決定**：

1. **色票只有一個來源（宿主）**。客戶端 bundle 沒有 ESM import、拿不到
   `lib/theme.js`，所以 `theme.read` 的回應會附上完整的 `defaults` /
   `lightDefaults`。第一版在 client 抄了一份，改色票時兩邊立刻走散（測試直接紅）
   ——那個教訓留在這裡。
2. **client 仍留一份「最小值 fallback」**：第一次開啟、還沒讀到主題之前，
   所有 `var(--dsh-tv-*)` 不能是空的（不然畫面是全裸的 HTML）。
   它跟 `lib/theme.js` 的一致性由測試釘住。

**驗證方式（不必重啟就能驗）**：在頁面裡改 token 層的字，元件的圓角／顏色立刻跟著變
（實測：`--dsh-tv-radius-md` 10px → 18px，`.dsh-tv-menu` 的 `border-radius` 變成 18px）。

> ⚠️ **`theme.read` / `theme.write` 是宿主半的 op，要重啟才會生效。**
> 在那之前 client 用 fallback 色票跑（外觀是對的，只是還讀不到 theme.json）。

**下一步（UI 重新設計）**：token 只是地基。真正的重做是「為這個框架特別定做」的
資訊架構與元件——等設計研究（現代角色扮演前端的視覺語言）回來之後，
照 `docs/design-*` 的規格逐頁重做。功能面的研究已經在
`docs/research-roleplay-features.md`。

## 8. 還沒做的 / 已知限制

| 項目 | 狀態 |
|---|---|
| 插圖的「一大堆表情圖」瀏覽體驗 | 沒動（現在還是縮圖格子） |
| 世界書的 `position` 八種插入位置 | **不做**（我們只有一種） |
| 世界書的 `probability`／`sticky`／`cooldown`／`delay`／**遞迴** | **不做**（理由見 §9） |
| 世界書的掃描範圍 | **只掃這一輪進入的訊息**，不是 ST 的「最後 N 則」 |
| 酒館自己的工具（擲骰、換表情圖、記筆記） | 沒做。**這是「只有 DSH 做得到」的那一塊** |
| 使用者人設（persona） | 沒做（`{{user}}` 現在吃 preset 的 `user` 設定） |
| 匯出（單卡／整間酒館） | 沒做 |
| 生成參數（溫度、max tokens） | 沒做。介面是 `agent/request`，回傳 `LlmCallConfig` |
| 舊版 v2.4 的 UI | **還在**。要重做的就是它 |

---

## 9. 未定案的問題（下次要問使用者的）

1. **側邊欄要不要改用 `sidebar.panellist`**（見 §7.4）——這會改外觀，要使用者決定。
2. **酒館自己的工具要不要做**——使用者對「角色能動手」有興趣（他提過「叫他幫我關電腦」）。
   研究發現**全域工具會漏進 preset session**，所以任何工具都要刻意決定。
3. **世界書的掃描範圍**要不要擴大到「最近 N 則」（現在只有進入的那一則）。
   擴大需要讀 session 歷史，那是另一塊 API。

---

## 10. 文件導覽

| 文件 | 什麼時候讀 |
|---|---|
| **`docs/plan.md`**（本文件） | **第一個讀**。狀態、環境、下一步 |
| `docs/implementation-spec.md` | 要寫程式之前。12 條規範 ＋ 可以整段照抄的範例 ＋ 實測結果 |
| `docs/redesign.md` | 要動設計之前。功能盤點、分區、被推翻過的方案與理由、DSH 與 ST 的研究附錄 |
| `docs/storage-layout.md` | 要動資料格式之前 |
| `docs/design-comparison.md` | 想知道「為什麼不抄 SillyTavern 的某個做法」 |
| `README.md` | 給使用者看的（安裝、外觀、緊急恢復） |
| `CHANGELOG.md` | 版本與「為什麼改」 |

---

## 11. 收工前的檢查清單（**2026-09-18 更新**）

- [x] `npm test` 八套全綠
- [x] 工作目錄沒有殘留的探針檔（`tmp/`、`.sessions/`、假的 `characters/`／`worldbooks/`）
- [x] preset 只有一個（`dsh-tavern`），**由插件自己產生**（帶 `generated-by` 標記）
- [x] 卡片檔已從探針還原成原始位元組
- [x] 新版對話畫面在真的 GUI 裡渲染正常
- [x] **重啟一次 `dsh web`** → §7.4 的五步驗收**全過**
- [x] GUI 裡抓到的兩個真 bug 都修好、都有測試
- [x] 測試產物清乾淨（`characters/酒保.json`、`chats/酒保/` 已刪）
- [x] ~~**使用者的酒館留了一份示範對話**~~：**已經沒有了**——2026-09-18 檢查時，
      使用者那間酒館的 `chats/` 是空的，只有預設的老闆娘與世界書。
      要刪對話的話現在**有 UI 了**（§7.6）。
- [x] ~~**使用者要上傳 v2.5.0 到 GitHub**~~：**已完成**——GitHub `main` 的
      `b1b93c4` 就是 2.5.0，工作區已 `pull` 對齊。
- [x] ~~上傳之後，重新安裝並確認三個面的版本標記都是 2.5.0~~：**已完成**，
      而且安裝方式從 tarball 改成 `link:`。

**這一輪（2026-09-18，macOS）新增的未完成項：**

- [ ] **2.5.1 的新 UI 要在真瀏覽器裡走一遍**：對話列的 ⋯（改名／分支／刪除）
      與設定頁的刪除鈕。離線測試驗到的是「結構、參數、狀態」，**列真的畫出來、
      按了真的送對 op** 只有真瀏覽器看得到（§7.4b 的教訓）。
- [ ] **宿主半要重啟一次**：`chat.rename` 是新增的 op，而路由表是載入時的常數。
      在那之前客戶端半會拿到 `unknown op "chat.rename"`（客戶端半本身已經生效了）。
- [ ] **2.5.1 還沒有 commit／push**（工作區改了 `lib/client.js`、四個版本標記、
      `test-client.mjs`、`CHANGELOG.md`、`README.md`、`docs/plan.md`）。
- [ ] 使用者的酒館 `tavern.json` 的 `name` 是**空的**——酒館街上顯示的是資料夾
      basename（`酒館`）。要改的話在 GUI 的「🏠 這間酒館」改名。

---

## 12. 這一輪（2026-09-17 晚）多做了什麼

§7.1 與 §7.2 都在這一輪做完了。新增的檔案與 op：

| 新增 | 內容 |
|---|---|
| `lib/preset.js` | 插件自己安裝酒館模式的 preset。**不在啟動時裝**、**不覆蓋使用者改過的** |
| `lib/worldbook.js` | （稍早）世界書的觸發邏輯 |
| op `chat.delete` | 刪一份對話（只刪那個 `.jsonl`；插圖留著；解掉綁定） |
| op `chat.append` | 追加訊息到 `.jsonl`（**不改寫既有內容**） |
| op `chat.messages` | 讀訊息（壞行跳過，不讓一行壞資料毀掉整份對話） |
| op `preset.ensure` / `preset.status` / `preset.remove` | preset 的安裝／檢查／移除 |
| op `session.bind` / `read` / `list` / `unbind` / `rebuild` | 對話 ↔ session 的對照表 |
| 客戶端 `__chat` | session 生命週期：`available` / `ensure` / `send` / `cancel` |
| `test-preset.mjs` | preset 安裝（4 段） |
| `test-client.mjs` §8／§9 | session 控制器與逐字串流 |

**這一輪抓到的兩個 bug**（都是測試抓到的，不是我想出來的）：

1. **YAML 單引號裡反斜線不用跳脫。** 我畫蛇添足地把 Windows 路徑的 `\` 寫成 `\\`，
   那會產生一條**真的不存在**的路徑。單引號 style 唯一的跳脫是「兩個單引號代表一個」。
2. **ST 的 `matchWholeWords` 對中文是壞的**（稍早）：JS 的 `\w` 只有 ASCII，
   所以「酒」會在校「**酒店**」裡命中。我們讓它對非 ASCII 無效。
