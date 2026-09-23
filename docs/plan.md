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

## 2. 現在的狀態（2026-09-22 更新）

| | |
|---|---|
| 版本 | **2.6.45**（PNG 卡直接就是卡 ＋ 新酒館預設 ＋ 裝修接回來）。**還沒 commit**——這台沒有 git；GitHub `main` 上還是 2.5.0 |
| 測試 | `npm test` **九套全綠**（`verify` / `test-pngcard` / `test-worldbook` / `test-agent` / `test-preset` / `smoke` / `test-workspace` / `test-registry` / `test-client`）|
| 架構 | **三個面全部實作完成**：宿主半、瀏覽器半、**Agent 面** |
| 規範 | 12 條（R1–R13），**每一條都有測試釘住** |
| 真聊天 | ✅ 打通了；逐字串流、寫回 `.jsonl`、思考列、換角色換卡都實測過 |
| 安裝 | ✅ `link:` 指回工作區（改工作區＝改插件）。**Windows 這台** |
| UI | **五個分區**：🏠 大廳／💬 包廂／🎭 卡司／📖 藏書／**⚙️ 設定**。對話頁**四個分頁**：💬 對話／🖼️ 插圖／**⚙️ 房間**／**📄 檔案** |
| 儲存 | **一間房＝一個資料夾**（`chats/<角色>/<roomId>/{room.json,chat.jsonl,art/,files/}`），身分是 `roomId`，改名不動路徑。設計：`docs/room-layout.md` |
| 酒館 | 一間（使用者自己選的資料夾）|
| 對話框 | ✅ 模型 chip（顯示名稱 ＋ 思考強度）、選單、全新的房也能選（順手開 session）、等級會收斂。**2.6.43** |

### 2.6.45 這一輪（PNG 卡直接就是卡）

使用者：「提示詞住在 PNG 裡，我這裡指的是**酒館角色卡的寫法**」→
「PNG 卡直接就是卡（讀得到、寫得回去）」。完整說明在 `CHANGELOG.md` 的 2.6.45。

1. **`characters/<id>.png` 是第一級的卡**：`cardFileOf(id)` 是唯一判斷點
   （`.json` 優先，其次 `.png`），`listCharacters`／`readCharacter`／`writeCharacter`／
   `deleteCharacter` **全部走它**——所以「寫回同一種形式」是一條規則，不是四處各自判斷。
2. ⚠️ **`replaceCardInPng()` 是必需的，不是重構**：`writeCardIntoPng` 是「接上去」，
   而讀取端 `ccv3` 優先 → 對已經有 `ccv3` 的圖再寫 `chara`，**讀回來還是舊的**
   （改了卡、看起來成功、其實沒生效）。測試同時釘「卡片區塊只有一個」與
   「非 tEXt 位元組完全相同」。
3. **卡片本體就是立繪**：`describeEntityAssets('character', …)` 把它當成
   `source: 'card'` 的項目**加在最後**（既有插圖永遠優先），走新的
   `/api/dsh-tavern/card/<id>` 路由；客戶端因此不必為 PNG 卡多寫一條路徑，
   而它在插圖管理器裡**沒有刪除鈕**（那不是 `art/` 底下的東西）。
4. **匯入不轉檔**：PNG → 位元組原封不動存成 `characters/<id>.png`（不再寫 `originals/`
   與 `art/`）；**撞名自動編號**（照 ST 的規矩，那是使用者的檔案）。
5. **新建酒館的預設老闆娘就是那張 PNG 卡**（逐位元組複製出貨檔）——「提示詞住在 PNG 裡」
   在預設角色上也是真的，不是只有匯入的卡。
6. ⚠️ 血的教訓：`README_TEXT` 這個 template literal 裡**不可以出現反引號**
   （我寫了 `` `.json` `` → 整份 `workspace.js` 語法壞掉，`verify` 的
   「host 半可 import」第一個紅）。要標記檔名就用「」或直接寫。

### 2.6.44 這一輪（新酒館／新房間的預設 ＋ 裝修接回來）

使用者：「我們不是應該有一個新房間預設的嗎？還有就是酒館老闆娘應該也有一個預設，
他連同圖片也一起是預設的，留意他的提示詞要寫進 PNG 卡片當中」
＋「我的意思是新酒館和新房間都應該要有一個預設，預設 css、預設卡片」。

**一句話**：新建酒館現在是「一位有臉的老闆娘 ＋ 兩本世界書 ＋ 一間可以直接聊的房間
＋ 一份裝修範本」，而 `theme.json`／`custom.css` 也終於真的會生效了。

1. ⚠️ **`ensureTheme()` 從來沒有被呼叫過** → `theme.read` → `applyTheme` →
   `applyCustomCss` 整條鏈是死的：`theme.json` 改了沒反應、`custom.css` 那一層
   `<style>` 永遠是空的。**純函式測試全綠、宿主 op 也在，只有「有沒有人呼叫」沒被釘住**
   （當時的驗證是「在 devtools 手改 token 那一層」，證明的是 CSS 變數會生效）。
   現在兩個地方呼叫（`ensureTheme` 自己按酒館 id 去重）：`TavernStreet` 的清單讀完
   （比主面板早）＋ `loadTavernData`（`tavern.list` 回來就套）。
   測試：`test-client.mjs` 14k 掃「`ensureTheme(` 至少兩個呼叫點」——**這一條要留著**。
2. **預設角色＝出貨的 PNG 卡**：`seedDefaultCard()` 讀
   `samples/characters/老闆娘.png` 的 `ccv3` 產生 `characters/老闆娘.json`，
   並把同一張 PNG 複製成 `art/characters/老闆娘/老闆娘.png`（主圖）。
   → **提示詞只有一份真相（卡片）**，而且預設角色有臉。
   ⚠️ 出貨檔不在時退回 `defaultCharacter()`（純資料、沒有圖），**不可以讓新增酒館失敗**。
   `package.json` 的 `files` 已補 `samples/characters/老闆娘.png`，`verify.mjs` 盯著它
   （漏掉在 `link:` 安裝時完全看不出來）。
3. **預設房間**：`seed()` 順手 `createRoom(老闆娘, '')` ＋ 把 `first_mes` 寫成第一則訊息。
   ⚠️ **只有「這一輪真的建了老闆娘」才建房間**（`seedDefaultCard()` 回 `null` 就跳過）
   ——既有的資料夾（使用者自己的角色）不會被塞一間房。
4. **`custom.css` 範本**（`CUSTOM_CSS_TEMPLATE` 住在 `lib/theme.js`）：整份註解掉、
   代價零，但把常用類別列出來（含 `.dsh-tv-modelRoot`／`.dsh-tv-modelCell`／
   `.dsh-tv-attachBtn`…）。**只在新建時給**。
5. `README.txt`（酒館資料夾裡那一份）改成房間＝資料夾的現況 ＋ `files/` ＋ 裝修。
6. ⚠️ **`theme.write` 是「整份寫入」不是 patch**（`writeTheme(patch)` 用 patch 蓋掉整個
   theme）。目前**沒有客戶端呼叫者**，但接設定頁之前要先處理，不然會把沒送的 token
   全清掉——驗證時就踩到一次（先寫 `radius-md`、再寫一個打錯的 key → token 變成 `{}`）。

**驗證方式（這一輪的做法，日後照抄）**：**不要動使用者的酒館**——用 `tavern.add` 開一間
暫時的酒館（放在 temp），量完 `tavern.remove` ＋ 刪資料夾。離線的 seed 檢查則直接用
`node` 開一間 temp 酒館（`TavernWorkspace(root).seed()`），看回報清單與 `summary.counts`。
實測：`custom.css` 的 `.dsh-tv-bubble{border-radius:3px}` → 兩顆氣泡 **3px**；
`theme.json` 的 `radius-md:18px`／`accent:#3ec46d`／`style.bubble:"tail"` →
**18px／#3ec46d／`--dsh-tv-bubble-tail: block`**。

### 2.6.43 這一輪（對話框：模型與思考強度）

使用者：「我們先完成了對話框吧，現在的選擇模型，思考強度這些還未做好」。
完整說明在 `CHANGELOG.md` 的 2.6.43；這裡只留**接手的人一定要知道的事**：

1. ⚠️ **第三次空白頁的兇手抓到了**：chip 的 `title` 從 `route.provider` 讀欄位，
   而 `modelCurrent` 有值、`route` 是 `null` 是常態 → render 丟錯 →
   `slot entry crashed in 'main'`。**點開選單就會踩到**（`loadModels()` 當時會把目錄
   default 寫進 `modelCurrent`）。兩個原因都拆了：title 只從 `selection` 取值、
   目錄 default 有自己的格子（`chat.modelDefault`，只當最後一位後備）。
   → **`plan.md` 舊版那句「進房那條 effect 裡不要再塞新的非同步讀取」是誤診**，
   真正的原因是這條 null 讀取；目錄現在可以在 `loadUsage` 順手讀（只讀一次）。
2. 「現在選什麼」**讀 session 的 `modelSelection` 投影**（跟 DSH 自己的 chip 同一份）：
   `ctxRef.get('sessions').binding(sessionId).session.projections.faceOf('modelSelection')`
   → `getSnapshot()` → `next ?? lastUsed`。**整段包 try/catch**，讀不到就退回
   `usage.route`（它是選配來源，不可以弄倒頁面）。
3. 等級的規則**照 DSH 抄**（`choices`／`currentChoice`／`effectiveEffort`／`effortChoices`）：
   只挑模型時「保留目前那一級，不合法就用新模型的 `defaultEffort`」；
   「提供方預設」只在模型**沒有** `defaultEffort` 時出現；
   **沒有 `reasoning` 這一層**的模型連 chip 上那一格都不顯示。
4. 全新的房要能選 → `sessionForModelPick()`：沒有 session 就順手 `ensureChatSession`
   （房間 ↔ session 一對一，模型選擇記在 session 上，不開就沒地方記）。
5. 選單對齊 chip 的**正確做法**：面板是卡片的子節點，用
   `right: 卡片右緣 − chip 右緣`。**不要 portal、不要 fixed**（那兩招都試過、都會看不到）。
6. 純函式全部搬到**模組層級**（`modelKeyOf`／`effortOptionsOf`／`resolveEffortFor`／`chipTextOf`…），
   測試出口是 `__model`——它們原本住在 render 裡，在那裡出錯的代價是整頁消失。
7. **UI 照 DSH 的 `ui-model-selection` 逐項對齊**（使用者貼了那顆 chip 的 DOM 說
   「他的 ui ux 做得比較流暢」）。要動這一塊之前**先讀它的 `client.js`**，重點事實：
   - chip ＝ `root`（`position:relative`）裡面包 `trigger`：**圖示 ＋ `triggerLabel` ＋
     `triggerEffort` ＋ chevron**；`title` ＝ `模型名 · 等級`；`aria-label` ＝
     「選擇模型，目前 X，推理等級 Y」。
   - 選單**兩層**（`pane`）：root 是兩列 `_cell`（模型／推理等級，值靠右、右邊 `›`），
     點進去才是清單；選項是 `_option` ＋ `role=menuitemradio` ＋ 打勾。
   - **等級那一列只在模型有 `reasoning` 時出現**；「提供方預設」只在模型**沒有**
     `defaultEffort` 時出現。
   - **點已經選中的那一個＝只關掉選單**（不送請求、不跳通知）。
   - 用詞是 DSH 的「**推理等級**」（`menu.effort`），不是「思考強度」。
   - 它用 portal 到 `document.body` ＋ `position:fixed`，是因為它的 composer 住在有
     overflow 的容器裡。**酒館不需要、也不該抄那一半**：選單掛在 `.dsh-tv-modelRoot`
     裡、`right:0` 就精準貼齊 chip（實測右緣差 0px）——portal 與 fixed 在這個 repo
     各失敗過一次（面板被丟到畫面外）。


### 2.6.42 這一輪（附件：上傳檔案與圖片）

使用者回報「沒法選擇模型和上傳檔案」。模型那一半 2.6.22–2.6.41 就做完了，**這一輪補附件**。
完整說明在 `CHANGELOG.md` 的 2.6.42；這裡只留**接手的人一定要知道的事**：

1. **兩條路，照 DSH 自己的 composer 分**（讀 `dsh-client-ui-conversation` 的 `sendSession`）：
   圖片走 `{type:'image', mediaType, data, name}`（base64 inline，**只有這樣模型才看得到圖**）；
   其他檔案先 `ctx.get('fileUpload').upload(sessionId, file, name, …)` 拿 `receiptId`，
   prompt 放 `{type:'file', receiptId}`。**附件在前面、文字在後面**（DSH 的順序）。
2. **房間裡再存一份**（`<room>/files/`）：DSH 那一份帶不走。訊息用 `extra.media` 指它
   ——那是 **SillyTavern 的欄位**，所以重新整理之後還畫得出來。
3. ⚠️ **這一輪量到兩個真的壞掉的地方（都已修、都有測試）**：
   - **送出瞬間自己那則訊息會消失**：`setChatRunning()` bump `refreshChannel`，對話頁
     訂閱了它並在裡面 `loadMessages()`，而磁碟還沒有剛送出的那一則 → 蓋掉；
     連錯誤訊息也被 `loadMessages` 的成功分支清掉（症狀：「按了送出，什麼都沒發生」）。
     修法：`chat.busy`／`chat.writing` 時不重讀。
   - **附件 chip 在送出時不見**：`media` 只收有 URL 的，而 URL 要等存進房間才有。
     改成「名字在就留著」，還沒存到時畫一顆**不能點**的 chip。
4. ⚠️ **假 PNG 會被 sharp 拒絕**：測試用的圖一定要用**真編碼器**產生
   （`canvas.toBlob('image/png')`）。隨手拼的 PNG 位元組 Chrome 解得開、sharp 回
   `Unsupported or malformed image data.`——我為此白跑了一次。
5. ⚠️ **`file.write` 是二進位 op，`args` 是 `undefined`**：身分參數只能從 **query string**
   讀（跟 `assets.write` 同一條規矩）。第一版寫 `args?.character` → 「角色 id 不可為空」。

**這一輪的驗收（真瀏覽器）**：📎 在輸入框左邊；夾帶一張圖＋一份 txt → 兩顆 chip
（圖片是縮圖、檔案是 📄＋大小）；× 拿掉、再加回來；送出 → 模型回覆裡寫著
「The user attached a file "筆記.txt" (12 bytes)」，另一輪看著 canvas 產生的圖回報
「primarily red/crimson with a yellow/gold block in the upper-left corner」。

**重啟 `dsh web` 之後要補驗的三件事**（重啟前只驗得到「送得出去」那一半）：

1. 房間裡真的多一個 `chats/<角色>/<房間id>/files/<檔名>`，而且位元組一模一樣。
2. `chat.jsonl` 的那一則多一個 `extra.media`（`[{type,url,name,bytes}]`）。
3. **重新整理頁面**之後，訊息上的附件還在（圖片畫得出來、檔案那顆 chip 點得開）。

> ⚠️ 重啟前後最容易誤判的一件事：附件送得出去、模型也看得到，**只有房間那一份存不下來**
> （`file.write` 回 `unknown op`）。這時訊息上會有一顆**虛線框、不能點**的 chip
> ——那是刻意的（`dsh-tv-fileChipFlat`），不是壞掉。


**一句話**：**引擎、油門、車殼都有了，現在連「房間」都是真的資料夾了。**

**2.6.41 這一輪（對話頁用量列 ＋ 輸入框一張卡 ＋ 權限文案）**：

- ⚠️ **整份「本輪用量」也在訊息上**（使用者：「還有這些資訊你剛才放錯位置了」）：點訊息上那顆
  「用量 … tok」展開**那一輪**的細節（合計／提供方 · 模型／快取命中／未快取輸入／快取讀取／
  輸出（其中推理）／本輪用時和速度）。DSH 這一整組 locale key 都是 `message.` 開頭
  （`message.turnUsage.*`、`message.ranFor`）——所以它們屬於**訊息**，不屬於輸入框那個面板。
  面板只剩上下文／會話統計／Token 用量（累計）三份。
- **提供方 / 模型跟著訊息存**：`chat.jsonl` 的 `extra.route`（`{provider, model}`），
  來源是開場快照的 `request/context` 事件。**動到宿主半 → 要重啟**。
- ⚠️ **「用量／用时」掛在訊息上，不是掛在面板上**（使用者貼了 DSH 那兩個元素說
  「我是指這兩個位置」）：助理訊息氣泡**下面**那一行 `[資料庫] 用量 14.4K tok`、
  `[時鐘] 用时 3分18秒`（DSH 的 `message.turnUsage.consumed`／`message.ranFor`）。
  要活得過重新整理就得跟著訊息存：`chat.jsonl` 的 **`extra.usage`／`extra.ms`**
  （SillyTavern 的 `extra` 是自由欄位，`reasoning` 已經住在那裡）。**這一項動到宿主半**
  → 要重啟；舊訊息沒有那兩個欄位就**不畫**（不是畫 0）。
- **點面板外面就收起**（使用者：「我應該點擊外面就會縮回去」）：一個 `mousedown` listener，
  只在有面板開著時掛、收起或卸載一定拆掉；點在**面板／pill／環**上面不算外面（它們自己有
  onClick，這裡再關一次會變成「開了又立刻關」）。頁面上驗過：點訊息區→收起、點面板內→不關。
- **本輪用量多一列「提供方 / 模型」**（DSH 的 `message.turnUsage.model`）：值來自**開場快照的
  `records`**——最後一則 `request/context` 帶著 `provider`／`model`（`.jsonl` 沒那個欄位）。
- **「本輪用時」→「本輪用時和速度」**（DSH 叫 `本轮用时和速度`），加上本輪輸出速度＝
  本輪輸出 token ÷ 本輪秒數。分母用**整輪牆上時間**（串流沒報解碼時間），所以比 DSH 略低——
  註解裡寫明「寧可低估也不要假裝精確」。
- ⚠️ **每一顆按鈕開自己那一份**（使用者：「顯示資料他會分多個按鈕分開顯示」）：
  環→`上下文`、碼錶→`會話統計`（＋本輪用時）、資料庫→`Token 用量（累計）`（＋本輪用量）。
  不是把四段通通塞進同一個面板 ✗。狀態是 `chat.usagePanel`（`''`／`'ctx'`／`'stats'`／
  `'tokens'`）：點同一顆＝收起來、點別顆＝換過去。
- ⚠️ **環與統計是兩件事**（使用者：「你自己是分開顯示的」）。DSH 的分法（讀它的 CSS 與
  locale 得到的事實）：
  - 上下文＝**圓環按鈕**（`.JObwrW_trigger`：28×28、`border-radius:999px`、`display:grid`），
    在 composer 那一列的 `trailing` 裡、**緊貼送出鍵前面**；
  - 統計＝**兩顆 pill**（`.bOPqQW_root`：碼錶「幾輪幾步 · tok/s」、資料庫「tok · 快取命中」），
    在**卡片外面**、整排置中；
  - 面板是一個對話框（`stats.dialog.title`＝会话统计、`stats.dialog.usageTitle`＝Token 用量…）。
  我一開始把三顆擠成一排、還塞進卡片裡 ✗——那是錯的。現在卡片裡是 `◯ ＋ 送出鍵`，卡片外面
  是那兩顆。
- **送出鍵在右下角、34×34 圓形**（DSH 的 `.uV2eYG_primary`：`border-radius:999px`、往上箭頭、
  `translateY(-2px)`）。檔案路徑在左邊；忙碌時同一顆變成「停下來」。送出鍵因此沒有文字
  （名字在 `aria-label`）。
- **面板四段照 DSH 那個對話框**（使用者把它整份貼過來）：會話統計（模型用時／工具呼叫用時／
  首 token 平均 TTFT／輸出速度 TPS）／Token 用量（合計／快取命中／未快取輸入／快取讀取／
  輸出）／本輪用量／本輪用時。每列「標籤靠左、數字靠右」；面板裡的數字是**精確值加千分位**
  （它寫 `775,465 tok`）。**本輪**那兩段來自**串流裡的 `{type:'usage'}` chunk** ＋
  送出到收到回覆的實際時間——只有跑過一輪才出現。
- ⚠️ **面板要往上開**：輸入框貼在對話頁底部，往下長一定被裁掉（截圖才看到）。
  DSH 那顆環的面板就是 `position:absolute;bottom:calc(100% + 8px)`。
- **輸入框是一張卡**（使用者：「有一些欺騙性的 UI，例如假裝是在同一個對話框，現在所有
  東西都是分開的」）：`.dsh-tv-chatInput` 改成**沒有邊框、有底色、有圓角**的卡（照 DSH 的
  `.uV2eYG_card`：`border:0` ＋ 底色 ＋ 柔和陰影 ＋ 大圓角），textarea 在裡面**沒有自己那
  一圈框**，按鈕列與檔案路徑在同一張卡裡。舊版是四件各自成單位的東西（textarea 一圈框／
  按鈕一列／檔案一行／pill 一列）——那才是「看起來分開」的原因。
- **用量 pill 在卡片裡面**（同一張卡的下緣、整排置中）：
  `[環] 上下文 1.1K / 1.00M（0%） · 緩衝 998.9K`、`[碼錶] 1 輪 1 步 · 200 tok/s`、
  `[資料庫] 1.2K tok · 快取命中 78%`。點任何一顆展開上面那個面板。
  DSH 是把那排放在卡片下方靠寬度對齊「假裝」同一體，這裡直接放進同一張卡。
- ⚠️ **度量是「讀原始碼抄的」，不是看 DOM 猜的**。這台機器上就有 DSH 自己的前端：
  `dsh-client-ui-chat/lib/client.js` 的 `.bOPqQW_*`（那排統計）與
  `dsh-client-ui-conversation/lib/client.js` 的 `.JObwrW_*`（那顆計量環）。
  抄下來才知道：pill 其實是 **`button`**（`background:0 0;border:none;padding:1px 8px`）、
  整排 **`justify-content:center`**、字級 **13px**、`·` 自己帶 6px、圖示是 16×16
  `stroke-width:1.25`、環是 14×14 半徑 5.5 且 `stroke-dasharray = 佔用 × 2πr`。
  → **能讀原始碼就不要猜**（第一版是猜的：「小字＋灰階」✗，被說不夠好看）。
  `·` **只在同一組內**用，組與組之間只留空白，細節收進點開的面板（它那顆計量環也是）。
  ⚠️ 「不要框」那一版被說不夠好看之後才去把 DSH 的 CSS 讀出來——pill **確實是 button**，
  只是 `background:0 0;border:none`（見上一條的度量表）。
- **數字從哪來**：session 串流的**開場快照**（`type: 'snapshot'` 那個 frame 自己帶著
  `projections`＝`contextPressure`／`tokenUsage`／`contextBreakdown`／`sessionStats`）。
  那是宿主算好、給瀏覽器讀的同一份值——酒館只是跟著讀，不會出現「同一份日誌的第二個答案」。
- ⚠️ **中間走錯的一步**（別再走回去）：第一版叫宿主半算（`room.usage` ＋ `ctx.tokenMeter`
  ＋ `ctx.sessions.get()`），上線後那一列**一直是空的**，因為 `ctx.sessions` 只看得到
  「現在活著的」session——重啟後那個對話不在記憶體裡就永遠量不到。改成讀持久日誌來的
  開場快照之後就好了，而且**純客戶端＝不必重啟**。那一版的宿主半已經收回來。
- ⚠️ **兩個用實測換來的 API 細節**（照型別推會錯，而且都是無聲的）：
  1. `service.follow(...)` **不可以送 `assistantStream: false`**（宿主回
     `session/follow rejected "request"`，我們靜靜吞掉）；**不送**它才會來開場快照。
  2. 快照的 `projections` 在 **frame 自己身上**，**不是** `frame.page.projections`。
     測試原本照錯的假設寫 → **測試全綠、畫面全空**；現在測試釘真形狀。
- **權限文案改成人話**：以前是「只讀——read、glob、grep」（那是實作，不是使用者要決定的
  事），現在兩處（酒館層＋「⚙️ 房間」）都寫「它拿到什麼」。
- 舊綁定的 `chat` 欄位放的是**顯示名稱**（新綁定才有 `room`）——比對時兩種都要試。
- 測試：`test-client.mjs` **14h**（純函式投影轉換、綁定表比對、串流收尾、讀不到就留空）。

**2.6.9 這一輪（純客戶端，重新整理頁面就生效、不必重啟）**：

- **＋ 從單程票變成來回鍵。** 已經在包廂裡再按一次＝回到剛剛在看的那份對話；判斷用
  「現在在哪裡」（`currentZone` ＋ 新記的一格 `shownPanel`），不是「上次按了什麼」。
  順手修好一個真的壞掉的地方：分區是模組層級狀態，而**重畫側邊欄不會重畫主面板**
  ——所以「已經停在這一頁」時按 ＋ 看起來像沒反應（設定頁現在訂閱 `refreshChannel`
  只為了重畫）。
- **房間裡就能改名**（「⚙️ 房間」分頁第一格 ＋ Enter）。順手修掉兩個同型 bug：
  `room.rename` 的回傳值是薄的（只有 `character`／`room`／`name`），兩處都拿它**取代**
  手上的座標，於是 `roomPrompt`／`allowTools`／`file` 當場消失（改成合併）；對話頁的
  身分原本是「角色/名字」，所以在房間裡改個名會把整頁重置（改成**房間 id**）。
- 測試：`test-client.mjs` **14f／14g**。

### 2b. 剩下的兩件（其餘都完成了）

> 使用者 2026-09-22 說「打掃」，但打掃比看起來大——所以列在這裡，不要靠記憶。
> **2026-09-22 收工時的狀態：1／2／3／5／6a 全部完成，只剩 4 與 6b。**

| # | 項目 | 狀態 |
|---|---|---|
| 1 | 📂 打開資料夾（DSH 的 `GET /open-in-app/apps` → `POST /open-in-app/open`，body `{app, path}`；`app` 要在清單裡、`path` 要是**存在目錄**的絕對路徑。純客戶端） | ✅ |
| 2 | 分支那兩處 `chat: created.name` → `created.room`（客戶端） | ✅ |
| 3 | 打掃：五段測試搬到房間 API（斷言一條都沒少、兩處語意反轉換成更強斷言）、五個舊方法 **249 行**刪除、四份文件更新 | ✅ |
| 5 | 版本 **2.6.7** ＋ CHANGELOG | ✅ |
| 6a | `resolveRoom` **只認 id**（名稱分支拿掉——那是三個 bug 的源頭） | ✅ |

**剩下這兩件，各自是一個專門的階段（都要重啟）：**

4. ✅ **2026-09-22 完成**：房間的圖搬進 `<room>/art/`。關鍵是 `lib/assets.js` 的
   `assetDir()`——讀圖路由、列出、上傳、刪除**最後都呼叫它**，所以改一個地方就夠，
   URL 形狀完全不變。**舊的 `art/chats/` 圖不搬**（動使用者的圖檔風險大），只是不會顯示。
   直接後果：`counts.art` 曾經少算一張（測試先紅才發現）→ 現在兩邊都掃。

6b. **拿掉 `chat.*` 那 6 個相容 op** ⏳ ——**規模量過了：約 70 處**
   （`lib/client.js` 15 ＋ `test-client.mjs` **43** ＋ `smoke.mjs` 12）。
   ⚠️ **它已經不是正確性問題**：危險的那一半（`resolveRoom` 收「顯示名稱」）在 6a 就拿掉了
   ——現在送名字會**明確報錯**，不會默默寫進第一間同名房。剩下的兩組 op 是**等價的別名**，
   所以這是**命名衛生**，不是縫。要做的話當成一次專門的掃描（測試就是安全網），不要順手夾帶。
   ⚠️ 而且**不是 1:1 改名**：`chat.list` 不帶角色（列整間酒館），而 `room.list` 原本按角色列
   ——所以 `room.list` 的角色參數現在是**可省略的**（已做），那條路才通。

### 2c. 這幾輪踩到的坑（值得記住）

- **新舊形狀的交界處就是 bug 的家**。為了「客戶端一行都不用改」而做的 `chat.*` 相容層
  （收 id 或名稱），救了一次 19 個呼叫點的改動，但代價是三個回報：
  進去就報「房間 不可為空」（`openChat` 漏了 `room`）、每間新房的訊息跑進同一框
  （客戶端送**名字**，同名命中第一間）、建完要 refresh（側邊欄訂閱的是「只重畫不重讀」）。
  **縫要早點封**——6a 就是把那條縫封起來（名稱分支拿掉之後，送名字會**明確報錯**，
  而不是默默寫進第一間同名房）。
- **「只重畫、不重讀」有一個前提**：那個通道只承載「狀態變了」。一旦它同時承載
  「內容變了」，就得重讀——`refreshChannel` 就是這樣。
- **測試會數程式碼裡的字串出現次數**（`source.match(/useRefreshChannelRerender\(/g)`）。
  連**註解裡寫到那串程式碼**都會被算進去——改註解的時候要留意。
- **讀取政策會過期**：改檔案前要先 `read`，而且隔幾輪要重讀。這件事意外救過一次
  （草稿引用了我還沒確認存在的 `atomicWrite`／`ROOM_FILE`）。
- **先讀再改**。這一輪所有「猜」的都失敗、所有「先讀」的都一次過。最貴的一次是
  `resolveRoom` 的註解我記錯了一句，`old_string` 對不上 → 測試先紅了一輪才補回來。
- **一次性的腳本要處理行尾**：`lib/workspace.js` 是 CRLF，按 `\n` 切之後每行尾端還留著
  `\r`，所以比對縮排前一定要先去掉（第一次跑就是漏了這件事，回報「移除 0 個」）。


---

## 3. 程式碼地圖

> 上一個版本的最後一哩（上傳 2.5.0 到 GitHub、裝完確認版本標記）**都已經完成**，
> 見 §11。所以現在唯一還沒動的是 §7.5 那張表（四分區）。
>
> ⚠️ 2026-09-22 打掃：這一節以前有**兩份一模一樣的「2.6.41 之後還沒做的兩件」**
> （貼上的時候重複了）。那兩件**都做完了**——模型 chip 在 2.6.22–2.6.41、
> 附件在 **2.6.42**（見 §2 與 `CHANGELOG.md`）。重複的那一份已刪掉。

```
lib/index.js       宿主半（Node）。51 個 rpc op ＋ **四條** HTTP 路由（rpc／插圖／PNG 卡／附件）。
                   ⚠️ 在 dsh web 的啟動路徑上——壞了整個 DSH 開不起來。inject 只有 webServer
lib/client.js      瀏覽器半。全部 UI。是手寫的 __ModuleLoader__ bundle，不是 ESM、沒有 JSX
lib/agent.js       Agent 面（新）。只在 preset 裡跑。動態系統提示 ＋ 世界書 ＋ 工具遮罩
lib/worldbook.js   世界書的觸發邏輯（純函式，好測）
lib/workspace.js   一個酒館資料夾的讀寫（結構、卡片、世界書、對話、插圖、session 對照表）
                   ⚠️ `cardFileOf()` 是「這張卡是哪個檔案」的**唯一判斷點**（.json 或 .png）
lib/registry.js    酒館街的註冊表（~/.dsh/taverns.json）
lib/assets.js      插圖（art/ 底下，一項一組圖 ＋ 主圖）＋ PNG 卡的路由前綴與 URL
lib/roomfiles.js   房間的**附件**（`<room>/files/`：訊息裡夾帶的圖片／檔案 ＋ 讀取路由）
lib/pngcard.js     PNG 角色卡：tEXt chunk 的**讀**與**寫**（寫回要用 `replaceCardInPng`）
lib/write.js       原子寫入（暫存檔 → rename）
lib/defaults.js    新建酒館的預設內容（老闆娘 ＋ 世界書；老闆娘是 PNG 卡）
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
| GUI | **port 每次啟動不一定**（實測看過 3080 與 3085）→ 用 §6.2 從 log 拿，**不要寫死** |

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
| **插件安裝方式** | **`link:`** → 改工作區＝改插件 | **`link:`**（2026-09-18 修好，見 §6.1c；在那之前是 tarball 複製） |
| `git` | 有（而且有 `origin`） | **可能不在 PATH 上** |
| Node／DSH | v26 / 0.1.5-rc.2 | v24 / 0.1.5-rc.1 |

**⚠️ 如果那一台的安裝是「複製」而不是「連結」**：

- 改了工作目錄的 `lib/*.js`，**安裝目錄不會跟著變**——DSH 載入的還是舊的。
- 反過來，**重新安裝會蓋掉手動複製的檔案**。
- 要在那裡驗證改動，就得**手動把 `lib/` 複製進安裝目錄**，
  或改成 `link:`（見 §6.1c——**2026-09-18 之後兩台都是這樣了**）。

判斷「現在跑的是哪一版」最快的方法：`tavern.list` 回的 `build`，跟工作目錄的
`TAVERN_BUILD` 比。**兩台都一樣：宿主半改了就要重啟，客戶端半重新載入頁面就好。**

### 6.1c 把「複製」改成「連結」（2026-09-18 在 Windows 上做過）

```sh
dsh plugin --profile web add "link:<你 clone 的位置>"
```

`dsh plugin` 其實是 **pnpm 的 passthrough**（在 profile 目錄裡跑 pnpm），所以：

- profile 在 `~/.dsh/profiles/<profile>/`——**在沙箱外**，這條指令要升級權限才跑得動。
  症狀是 pnpm 回 `unable to open database file`：那是它打不開自己的 store，
  **不是 pnpm 壞掉**（唯讀的 `pnpm ls` 也會出現同一個症狀）。
- **動手前先備份** `package.json` 與 `pnpm-lock.yaml`（改壞了才回得去）。
- `Packages: +N -M` **不代表依賴變了**。要判斷有沒有動到別的插件，比對 lockfile 的
  **套件集合**：實測 `+4 -13` 而集合 219 → 219 完全不變——那只是 pnpm 把套件在
  `node_modules` 根目錄與 store 之間重擺（這個 profile 是 `nodeLinker: hoisted`）。
- 裝完**不必重啟就已經生效一半**：DSH 會自己重新掃描（`/plugins/events` 的 rev 會變）。

**驗收（兩條，都不必問人、不必看畫面）**：

```powershell
# 1. 連結指向 repo
(Get-Item "<profile>\node_modules\dsh-tavern" -Force).Target

# 2. DSH 吐出來的 bundle 逐位元組等於工作區那一份（只多一個 sourceMappingURL）
curl.exe -s -o probe.js "http://127.0.0.1:<port>/plugins/??dsh-tavern/client.js&rev=<rev>"
[IO.File]::ReadAllText('probe.js').Contains([IO.File]::ReadAllText('lib/client.js'))   # 要 True
```

> `rev` 從 `/plugins/events` 拿。⚠️ **只挑 `dsh-tavern` 那一筆出來**——
> 整包 graph 有幾十 KB，整份 dump 進對話很貴（用 `Select-String` 或 regex 取一筆就好）。

**「改了會不會被看到」**（2026-09-18 實測）：在 `lib/client.js` 尾端加一行 `/* probe */`
→ rev 從 `161ea301dddc` 變成 `1e28d3a90cb4`（**沒有重啟**）→ 抓下來的 bundle 含那行標記。
客戶端半就是這樣：**存檔 → HMR 自己推上去**。

**⚠️ 代價：現在工作區壞掉＝當場的 GUI 白屏。** 以前是複製，壞掉的只是副本；
`link:` 之後**客戶端插件掛不起來就是整個 GUI 白屏**（§5 第 10 條，
`assertEntriesActive` 把 `pending` 跟 throw 一樣當致命）。
所以改完 `lib/client.js` **先跑 `npm test` 再重新載入頁面**。

**還剩哪一半要手動**：`lib/index.js`（宿主半）的路由表是**載入時的常數**，
所以新增／改 op **仍然要重啟 `dsh web`**。這件事**agent 自己做不了**——
它就跑在那個 process 裡面，重啟等於自殺；要使用者自己重開。

**怎麼確認宿主半現在是哪一版**（不必翻 log）：

```powershell
curl.exe -s -X POST -H "Content-Type: application/json" -H "Origin: http://127.0.0.1:<port>" `
  --data '{}' "http://127.0.0.1:<port>/api/dsh-tavern/rpc?op=tavern.list"
```

回的 `build` 應該等於工作區 `lib/index.js` 的 `TAVERN_BUILD`。
還有一招可以驗「某個新 op 到底進去了沒」：**拿那個 op 亂呼一次**——
回**參數錯誤**（例：`角色 id 不可為空`）代表它已經註冊了；
回 `unknown op "…"` 才是還沒重啟。

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
2. 回覆完之後，`chats/<角色>/<房間id>/chat.jsonl` 應該多兩行（使用者 ＋ 角色）
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

### 7.5 UI：四個分區（**✅ 完成，2.6.0**）

> 2026-09-18 只補了其中最重要的一個缺口（刪除對話的入口，見 §7.6）。
> **同一天稍晚兩輪做完**：先做分區外殼與大廳（§13.1–13.2），再做卡司的海報牆與
> 藏書的條目清單（§13.3），最後把版本升到 2.6.0。

照 `redesign.md` §3.2 的形狀（一間酒館＝一張 main 面板，分區在裡面切）：

| 分區 | 內容 | 現況 |
|---|---|---|
| 🏠 大廳 | 概況、**快速入口**、店面圖、名稱／圖示／備註、**收合的進階**（移除） | ✅ 完成 |
| 💬 包廂 | 對話清單、開新對話、**對話本體**（✅）、**刪除對話**（✅ 2.5.1）、房間插圖 | ✅ 完成（房間插圖在對話頁） |
| 🎭 卡司 | 卡片清單／編輯器（✅）、插圖集（✅）、內嵌世界書（✅）、**海報牆** | ✅ 完成 |
| 📖 藏書 | 世界書清單＋原始 JSON（✅）、插圖集（✅）、**條目清單編輯器** | ✅ 完成 |

**已經定案的實作方式（不要重新發明）**：

- **一次只畫一個分區**：`TavernSettingsPage` 依 `currentZone` 只建立那一區的元素。
- **`currentZone` 是模組層級的變數，不是 `useState`**。兩個理由：這個面板是常駐的
  （切去別的 panel 再回來、或換酒館，不該被重置回大廳）；而且離線測試的假 React
  把 `useState` 的 setter 做成空的（`() => {}`），靠 `useState` 的狀態轉移在那裡
  驗不到。測試出口：`__setZone` / `__currentZone` / `__zones`。
- **`.dsh-tv-sec` / `.dsh-tv-secTitle` 以前根本沒有 CSS**，所以分區標題長得跟瀏覽器
  預設的 `h3` 一樣——那是「簡陋感」的具體來源之一。現在有樣式了。
- **「移除」收在「進階」裡**（`plan.md` 這張表的要求）：它以前就貼在「重新命名」
  右邊，而說明文字在頁尾，兩者隔了整個畫面。
- **離線測試可以逐欄餵 `__testSeed`**（`taverns` / `activeId` / `summary` / …）。
  在那之前「設定頁要有四個分區」那類斷言是**空跑**的：畫面只渲染了
  「還沒有選定酒館」，而那段說明文字剛好含「對話紀錄」。新的 `4f`／`4g`
  用真的種子，而且**比對元素而不是文字**（大廳的快速入口也寫「💬 包廂」，
  用 `includes` 會讓分區列整條不見時斷言照樣變綠）。

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
| **`docs/reply-format.md`** | **要碰「訊息怎麼被讀懂」之前**。回覆格式的契約（模型可以吐什麼、kind 清單、節點形狀、容錯行為、消費者介面） |
| `docs/worldbook-plan.md` | **要動世界書之前**。ST 欄位的可行性盤點（已有／做得到／DSH 做不到）＋實作順序 |
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

**這一輪（2026-09-18）的未完成項：**

- [ ] **2.5.1 的新 UI 要在真瀏覽器裡走一遍**：對話列的 ⋯（改名／分支／刪除）
      與設定頁的刪除鈕。離線測試驗到的是「結構、參數、狀態」，**列真的畫出來、
      按了真的送對 op** 只有真瀏覽器看得到（§7.4b 的教訓）。
- [x] ~~**宿主半要重啟一次**~~：**2026-09-18 在 Windows 上驗過，已經是 2.5.1 了**——
      `tavern.list` 回 `build: tavern-2.5.1`（＝工作區的 `TAVERN_BUILD`），
      而且 `chat.rename` 回的是參數錯誤，不是 `unknown op`。
- [x] ~~Windows 那台是 tarball 複製~~：**改成 `link:` 了**（§6.1c），
      而且實測過「改工作區 → rev 自己變 → bundle 跟著變」，不必重啟。
- [ ] **2.5.1 還沒有 commit／push**（工作區改了 `lib/client.js`、四個版本標記、
      `test-client.mjs`、`CHANGELOG.md`、`README.md`，加上 `docs/plan.md`）。
      ⚠️ **Windows 這台沒有 `git`**（不在 PATH、標準路徑也沒有）——要 commit 得在
      另一台做，或先在這台裝 git。**push 一律要先問使用者**（全域指示）。
- [ ] 使用者的酒館 `tavern.json` 的 `name`：一台是**空的**（顯示資料夾 basename），
      另一台是 `tavern`。要改的話在 GUI 的「🏠 這間酒館」改名。

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

---

## 13. 2026-09-18 稍晚（Windows）：分區外殼，以及清掉 223 行死碼

### 13.1 死碼清除（**動手改 UI 之前必須先做**）

`lib/client.js` 裡有 12 組同名的頂層宣告，而 JS 的規則是「同一個作用域裡
**最後一個宣告勝出**」——所以前面那一份是死碼，**改它不會有任何反應**。
真正重複的有三處（其餘兩組是 PowerShell 雜湊表**不分大小寫**造成的誤判：
`RPC`/`rpc`、`cardAssets`/`CardAssets`）：

| 位置 | 內容 |
|---|---|
| `reasoningDeltaOf` | 兩份內容相同（第二份的 JSDoc 比較完整） |
| `ASSET_LABELS` / `ASSET_LABELS_BY_DIR` | 兩份內容相同 |
| 圖示那一整塊 | `IconEdit`／`IconBranch`／`IconTrash`／`IconThink`／`RunningDot`／`ThinkingRow` ＋ `RUNNING_RING`——**7 個宣告全部**在 200 行之後又被宣告一次（SVG 路徑資料一模一樣，只差排版） |

刪掉 191 ＋ 16 ＋ 16 ＝ **223 行**：`node --check` 過、`npm test` 八套全綠、
每個名字只剩一個宣告。⚠️ **判斷方法要可靠**：第一版的掃描腳本沒遮掉
template literal，給出「只有一組重複」的錯誤結論。可靠的做法是直接列出
`^    (function|var|const|let) NAME` 再按名字數重複——**4 空格縮排就是同一個作用域**。

> 為什麼非先做不可：那六顆圖示正是 ⋯ 選單在用的，而它們有兩份。
> 改到前面那一份＝怎麼改都沒反應。

### 13.2 四分區外殼

見 §7.5。**五個分區**（2.6.5 起多了 ⚙️ 設定）在同一張 `main:tavern` 面板裡切換、一次只畫一區；
`currentZone` 走模組層級變數（理由與測試出口見 §7.5）。

真瀏覽器（ego-browser）驗過：

- **五個分區**各切一次，**每次都只亮一個分頁**、內容正確換過來。
- 大廳的快速入口帶著數量（`1 份對話／1 張卡／1 本`），按了真的跳區。
- 「進階」收合時**移除鈕根本不在 DOM 裡**（不是只有視覺上藏起來），
  展開後按鈕與說明一起出現。

> ⚠️ 兩個操作教訓（下次驗 UI 會再遇到）：
> 1. **`ego_click` 的合成點擊對那顆 ⋯ 按鈕沒有觸發**，用 DOM 的 `.click()` 才會。
> 2. **讀 DOM 要等 React flush**。在同一個 JS turn 內 `.click()` 完立刻讀，
>    會拿到舊畫面——看起來像「點了沒反應」，其實只是還沒重繪。

### 13.3 四分區完成（同一天的第二輪）

1. ~~💬 包廂的房間插圖~~：**已經有了**——對話頁（`main:tavern-chats`）本來就掛著
   `AssetManager { kind: 'chat' }`。包廂那一區列的是「有哪些對話」，而房間插圖
   屬於「那一份對話」，所以它留在對話頁是對的，不要搬進包廂。
2. ✅ 🎭 卡司的**海報牆**：沒選卡＝海報牆（找卡）、選了＝編輯器（改卡）＋返回鍵。
3. ✅ 📖 藏書的**條目清單編輯器**：只做常用欄位（標題／關鍵字／常駐／內容），
   其餘欄位原樣保留；原始 JSON 收合成「▸ 原始 JSON」，
   但**解析不了時強制展開**（不然使用者會卡在一個沒有出口的畫面）。
4. ✅ 版本標記升到 **2.6.0**（三個面 ＋ `package.json` ＋ `dsh.plugin.json`）。

**這一輪的驗收**：`npm test` 八套全綠；真瀏覽器（ego-browser）走過分區切換、
快速入口、進階收合、海報牆 → 編輯器 → 返回、藏書條目改一個欄位
（改完原始 JSON 立刻跟著變，而且**磁碟上的檔案沒有被動到**——沒按儲存就不寫檔）。

> 兩個設計上的取捨留在這裡，以後不要「順手修掉」：
> - **條目編輯器會重新格式化 JSON**（`JSON.stringify(…, null, 2)`）。這是刻意的：
>   要精確控制排版的人走原始模式。反過來說，**不可以**為了保留排版而放棄
>   「改一個欄位」的簡單模型。
> - **`worldbookPatch` 是純函式**（回新的文字，不碰 state）。抽出來是為了測得到
>   ——`MapWorldbooks` 的清單在 `useEffect` 裡非同步載入，而假 React 的
>   `useEffect` 是空函式。

### 13.4 裝修：`style.bubble` 與 `custom.css`（同一天第三輪）

使用者：「我記得叫你設計一種格式讓我能夠透過目錄來修改，例如背景顏色、
**對話框風格**之類的」。查下去發現：**顏色那一半 2.5.x 就做好了**
（`theme.json` 的 31 個 token），**形狀那一半沒有**——token 只能換數值。

補了兩層（**`lib/theme.js` 是唯一來源，驗證與文件都從 `THEME_STYLE_KEYS` 長出來**）：

| 層 | 內容 | 誰讀 |
|---|---|---|
| `theme.json` 的 `style.bubble` | `bubble`／`plain`／`tail`／`paper`（列舉） | 宿主（`theme.read` → `normalizeTheme`） |
| `<酒館>/custom.css` | token 改不到的形狀／材質／背景圖／動畫 | 宿主原樣讀出，客戶端包 `@scope` 注入 |

三個實作決定（都有測試釘住）：

1. **氣泡樣式走 CSS 變數，不是 class**：元件樣式是靜態一層，主題是「換一間酒館
   才換一次」。用變數只要換那一層，不必讓每一顆氣泡知道自己是哪一種樣式。
2. **打錯的樣式名要落回預設「而且回報」**（`dropped` 裡會有 `style.bubble`）——
   默默用預設會讓使用者以為自己改了。
3. **`custom.css` 一定包 `@scope (.dsh-tv-view)`**：SillyTavern 的
   `* { text-shadow }` 污染整個宿主是前例。不支援 `@scope` 的瀏覽器整段忽略
   （刻意的降級，不是破口）。`scopeCustomCss()` 抽成純函式才測得到
   ——假的 `document.head.appendChild` 是空的。

**已經放進使用者的酒館**：`theme.json`（31 個 token ＝目前預設值，所以外觀不變，
改哪一行就只有那行變）＋ `custom.css`（整份註解掉的範例）。
⚠️ 31 個 token 全部 pin 住是有代價的：**以後內建色票改了，這間酒館不會跟著走**
（要刪掉那一行才會回去繼承）。

> ⚠️ **這一輪的宿主半還沒生效**：`theme.read` 要回傳 `style` 與 `customCss`，
> 而路由與模組是載入時的常數 → **要重啟 `dsh web`**。
> 客戶端那一半（變數驅動外觀）已經在真瀏覽器上量過：`plain` 讓圓角／邊框／內距
> 歸零、`tail` 讓 `::after` 從 `none` 變 `block`，而且「我的訊息」有自己的變數。
