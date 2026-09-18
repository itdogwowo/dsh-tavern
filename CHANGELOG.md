# 變更記錄

版本號照 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## 2.5.1 — 刪除對話的入口，以及 macOS 上的開發迴圈

### 三個介面修正（都照 DSH 原生的做法）

**1. 區塊標題列整列可點。** 使用者：「這好像是一個按鍵點擊摺疊，但下面的一層卻是整行
都能夠點擊摺疊。這裏風格不一致我希望遵從下面一層的做法」——酒館列本來就是「點列本體
＝展開／收合」，所以標題列照同一個規矩：**點那一列的任何地方都切換**（`cursor:pointer`），
只有右邊那顆「＋ 新增酒館」`stopPropagation`（不然按新增會順手把區塊收掉）。
摺疊按鈕留著（鍵盤與報讀器靠它），它自己切換 ＋ 擋冒泡。

**2. 聊天室貼底。** 使用者：「他應該要保持貼底，因為現在思考的時候我看不見思考要自己
手動滾下去」。我們的重繪是**指令式**的（自己叫 `render()`），所以不能在 render 裡無腦
`scrollTop = scrollHeight`——那會把正在往上翻紀錄的人硬拉回底部。規矩照原生聊天：

| 情況 | 行為 |
|---|---|
| 內容長高（思考、串流文字）＋ 使用者**貼著底** | 自動捲到底 |
| 使用者自己往上滑（離底超過 40px） | **不動他**（尊重閱讀） |
| 他再滑回底部附近 | 恢復自動 |
| 他自己**送出訊息** | 無條件貼底（剛說的話一定看得到） |

用 `scrollTop = scrollHeight`（不用 `smooth`：串流每一段都要跟得上，`smooth` 會排隊）
＋ 一次 `requestAnimationFrame` 補正（內容高度常常在這一輪之後才定下來）。

**3. 分隔線的動態感**（使用者貼了原生的 `widthHandle` 說「這裏能夠動態調整至中」）。
原生**不是畫一條固定的線**，而是：

```js
// .wSkVaW_widthHandle 的 onPointerMove —— 只改一個 CSS 變數，所以沒有重繪開銷
const box = e.currentTarget.getBoundingClientRect()
e.currentTarget.style.setProperty('--dsh-width-handle-pointer-y', `${e.clientY - box.top}px`)
```

```css
.widthHandle:after {
  background: linear-gradient(to bottom,
    transparent calc(var(--dsh-width-handle-pointer-y, 50%) - 52px),
    var(--dsw-alias-scrollbar-hover-l1) calc(var(--dsh-width-handle-pointer-y, 50%) - 12px),
    var(--dsw-alias-scrollbar-hover-l1) calc(var(--dsh-width-handle-pointer-y, 50%) + 12px),
    transparent calc(var(--dsh-width-handle-pointer-y, 50%) + 52px));
  opacity: 0; width: 3px;
}
.widthHandle:hover:after, .widthHandle[data-dragging]:after { opacity: 1 }
```

**游標在哪裡，那道光就在哪裡**（以它為中心 ±52px 淡出）。我們照抄成
`--dsh-tv-pointer-y` ＋ `onMouseMove: trackPointer`，並在拖曳中標記 `data-dragging`
（跟原生一樣持續亮著）。

### 測試（`test-client.mjs` 第 3、12 項）

- 標題列本身接得上點擊、**按鈕只擋冒泡不重複切換**、**按「＋」不會把區塊收掉**。
- 分隔線：`--dsh-tv-pointer-y` 的寫入、`onMouseMove` 有接、`:after` 的漸層以它為中心、
  `data-dragging`。
- 貼底：`stickToBottom` 的守衛（**翻紀錄時不搶**）、40px 的判定、`ref`／`onScroll` 有接、
  送出時無條件貼底。

**真瀏覽器實測**：標題列點列就展開（`aria-expanded` false → true）、
分隔線 `--dsh-tv-pointer-y` 跟著游標（`2px` → `7px`）、
對話紀錄 `distanceFromBottom: 1` 且最後一則**完全可見**、
往上滑之後 `scrollTop` 停在 `0`（新內容進來也不搶）、滑回底部恢復自動。


### 「思考」那一列（使用者：「思考的時候應該是有些圖標的，我看 dsh 也有」）

以前 `reasoning-delta` 被當成「不認識的東西」**整段丟掉**——於是模型在思考的那幾秒
畫面上**什麼都沒有**，看起來像卡住。DSH 原生在那段時間會顯示一列會流動的「思考」，
所以照它的形狀補上：

| 原生（`ReasoningRow`） | 酒館 |
|---|---|
| `IconThinkOutline14`（燈泡、14px） | 自己畫一顆同形的（原生那顆在 primitives，bundle 只拿得到 `react`） |
| 標題「思考」（`message.think`） | 一樣 |
| 可折疊、**整列可點**（`expandOnRowClick`） | 一樣（`role=button` ＋ Enter/Space） |
| 收合時顯示一段預覽（`collapsedContent`） | 一樣 |
| 串流時疊一層流動的高光（`:after` 的 `dsh-reasoning-row-sweep`） | 一樣（`@keyframes dsh-tv-sweep`，2.6s；`prefers-reduced-motion` 時關掉） |
| 放在回覆的**前面** | 一樣 |

- **預設展開、串流結束後可收合**；使用者自己點過就尊重他的選擇（`touched`）。
- **思考會寫進 `.jsonl` 的 `extra.reasoning`**——那是 SillyTavern 本來就有的自由欄位，
  所以帶著走的檔案裡思考不會丟，別的軟體也讀得懂那一則訊息。**不會混進正文**，
  沒有思考的訊息也不會長出空的 `extra`。
- 寬度上限跟氣泡一致（`max-width:78%`）：思考可能很長，鋪滿整個對話寬度會把正文擠掉。

### 「進行中」的矩陣跑馬燈：放在**側邊欄的對話列**，不是思考列

使用者：「check Room 外面的列表 check Room 列表…運作中的時候會換一個思考中的圖表的動圖」
——指的是**側邊欄包廂列表那一列的圖示欄**（`dsh-tv-slot`），不是對話頁的思考列。
第一版做到思考列上了，**已還原**。

DSH 原生的判定是 `node.session.running`（`sessionStatuses()`：有 pending interaction
優先，否則 `running` → `state: 'ongoing'`）。**我們拿不到那個欄位**——`session.list`
只回「哪個 session 綁到哪份對話」。所以改成我們自己知道的那件事：

> 對話頁**送出訊息到收到結果之間**，這一份對話就是「進行中」。

實作：模組層級的 `runningChats`（key 是 `角色/對話名`）＋ `setChatRunning()`；對話頁在
送出時標記、完成／失敗／取消時清掉，並走 `refreshChannel` 通知側邊欄。側邊欄用新的
`useRefreshChannelRerender()` 訂閱——**只重畫、不重讀**（為了一顆圖示重讀六份
`.jsonl` 是浪費）。跑完就換回原本的圖示（對話圖示或該對話的主圖插圖）。

#### 那顆動畫的精確規格（`StatusDot` 的 `ongoing`）

原型是 DSH 的 `StatusDot`（`dsh-web-frontend` 的 bundle，`state === "ongoing"`）：

```js
const RING = [[0,0],[4,0],[8,0],[8,4],[8,8],[4,8],[0,8],[0,4]]
<svg width={10} height={10} viewBox="0 0 10 10" shapeRendering="crispEdges">
  {RING.map(([x, y], i) => (
    <rect x={x} y={y} width="2" height="2"
          style={{ animationDelay: `${(i - RING.length) * 125}ms` }} />
  ))}
</svg>
```

CSS（同一份 bundle 的樣式表）：

```css
.matrix { --dsh-state-ongoing: var(--dsw-static-deepseek-450); color: var(--dsh-state-ongoing) }
.cell { fill: currentColor; opacity: .15; animation: dot-chase 1s infinite }
@keyframes dot-chase {
  0%,12.4%   { opacity: 1 }
  12.5%,24.9%{ opacity: .6 }
  25%,37.4%  { opacity: .35 }
  37.5%,to   { opacity: .15 }
}
```

**關鍵是負的 `animation-delay`**（-1000ms 起、每顆 +125ms）：同一條 1s 的動畫
依序跑過八顆方格，看起來就是一顆光點繞著方框跑。顏色是 `--dsw-static-deepseek-450`
（這台解析成 `#5686fe`）。我們把它複製成 `RunningDot` ＋ `dsh-tv-chase`，
四段透明度寫成自訂屬性（`--dsh-tv-chase-1..4`）避免數字重複兩份。

**實測驗證**（真的在瀏覽器裡量）：8 顆方格、延遲 `-1s / -0.875s / … / -0.125s`、
`fill: rgb(86, 134, 254)`、`animation: dsh-tv-chase 1s`、
當下透明度 `1.00 / .35 / .60 / .15 …`（＝真的在跑）。

> ⚠️ **寫回紀錄那一半要重啟宿主半**（`chat.messages` 是宿主半的 op）。
> 串流時的思考列不需要——那條路完全在客戶端半。

### 測試

- `test-client.mjs` 第 9 項：串流的 `reasoning-delta` 要**即時**回報、順序在正文之前、
  而且**不混進正文**（`result.text` 只有正文、`result.reasoning` 只有思考）。
- `test-client.mjs` 第 14 項（新）：思考列的**渲染**——標題「思考」／運作中是
  「思考中」、**運作中要畫出 8 顆方格與正確的負延遲**（`-1000ms` 起、每顆 +125ms）、
  **停下來就不該還有跑馬燈**、`10×10` ＋ `crispEdges`、收合時有預覽。

- 側邊欄的「進行中」：`chatIsRunning` / `setChatRunning` 的狀態機（送出→跑、
  完成→停、**別的對話不受影響**、**狀態變了要通知側邊欄重畫**），以及原始碼層級的
  契約（那一列在進行中時改用 `RunningDot`）。

  > 「點一下會展開」的**狀態轉移**沒有寫進離線測試：假的 React 不會因為 setState
  > 重繪，而我們是靠「再渲染一次」去觀察那個 `useRef` 的變化——中間只要有任何一次
  > `collect`／`flatten` 走進元件就會多跑一次、把狀態攪亂。**這一段反覆試了四次
  > 都不穩，所以停手**，改成驗可靠的部分（整列接得上點擊、預設收合、外觀），
  > 真實的點擊照 §7.4b 的規矩在瀏覽器裡走一遍。
- `test-workspace.mjs` 第 17 項（新）：思考**無損往返**——`extra.reasoning` 原樣讀回
  （含換行）、不混進正文、沒有思考的訊息不長出空的 `extra`、壞行與缺欄位照舊可讀。


### ⚠️ 修掉一個「CSS 同名 class」造成的排版災難（使用者：「打直顯示，一行根本顯示不全」）

使用者回報側邊欄的對話列變成**直的**、一行顯示不全。查下去是三個坑疊在一起：

**坑 1：同一個 class 名被定義兩次，而 `flex-direction` 只寫在其中一條。**
`.dsh-tv-chat` 既是 v1 的「對話頁訊息容器」（`display:flex; flex-direction:column;
gap:10px`）又是新加的「側邊欄對話列」（`display:flex; align-items:center; gap:0`）。
兩條同分特異度、後者勝出——**但 `flex-direction:column` 只在前者裡，不在後者的
`display:flex` shorthand 裡，所以它留了下來**，對話列就被壓成直的：圖示、標題、
時間疊在一起，`elementFromPoint` 在標題中心打到的是「時間」。
現在拆成 `.dsh-tv-chatBody`（容器）與 `.dsh-tv-chatRow`（列），並且
**列自己明寫 `flex-direction:row`**。

> 順手抓到同型的另外兩組：`.dsh-tv-split`（設定頁兩欄 grid ↔ 側邊欄拖曳分隔線）
> 與 `.dsh-tv-tag`（檔案標籤 ↔ 舊版殘留標記）。四組全部拆開。
> `test-client.mjs` 第 12 項現在**掃出「同一個 dsh-tv class 被定義兩次」**——
> 同名 CSS 規則幾乎一定是 bug。

**坑 2：portal 到 `document.body` 的選單拿不到主題變數。**
選單本來寫 `background: var(--dsw-alias-bg-elevated, #161a22)`——而
**`--dsw-alias-bg-elevated` 在 DSH 的主題裡根本不存在**，於是它落到深色 fallback，
淺色主題下變成「深色字壓深色底」，**三個標籤全部看不見**（只有圖示看得到）。
現在 `inheritTheme()` 從側邊欄當下的 computed style 取真正的底色與文字色，
直接寫在**選單框**上（寫在容器上不夠——容器的底色不一定透上來）。

**坑 3：`event.currentTarget` 在繪製選單時已經是 `null`。**
React 的合成事件會在處理器跑完之後清掉它，所以「從按鈕往上找側邊欄底色」那條路
根本沒跑。現在另外用 `document.querySelector('.dsh-tv-region, …')` 當錨點。

**同時照原生補齊的寬度約束**（原生 `.title` 那一條的精髓是 `min-width:0`）：
`.dsh-tv-title` 逐字照原生（`text-overflow:ellipsis; white-space:nowrap;
min-width:0; overflow:hidden`，**不寫 `width`**——實測寫 `width:0` 會讓它變成 0 寬），
`.dsh-tv-group` / `.dsh-tv-streetInner` / `.dsh-tv-projectText` 補上 `min-width:0`。

**驗證方式（真的在瀏覽器裡量的）**：列 260×32、`flex-direction:row`；
四個部分 `(20,16) (40,178) (224,40)` 同一條水平線、不重疊；
hover 時時間 `display:none`、⋯ `display:flex`（16px）；
選單 140×94、三項齊全、`insideViewport: true`、底色 `rgb(242,245,250)`、文字 `rgb(29,37,57)`；
改名行內輸入 202×20、有 focus、Enter 後收掉。


### 對話列照原生會話列（使用者：「check Room 應該和現在 DSH 靠近甚至一樣」）

使用者貼了兩段 HTML 來比對，問題一眼就看得出來：原生的會話列是
`slot → title → time → rowActions`，**酒館的對話列沒有最後那一塊**
——CSS 早就為 ⋯ 寫好了（`hover 時時間讓位`、`hover 時動作出現`），
但**沒有任何程式碼渲染那個 span**，所以那個原生行為永遠不會發生。

現在四個部分齊全，而且行為照原生：

- **hover 時時間讓位給 ⋯**、選單開著時也一樣（純 CSS，跟原生同一組選擇器）。
- **⋯ 開「改名／分支／刪除」**（原生是「改名／分支／封存」；封存沒有對應的酒館概念）。
- **改名是行內輸入框**，不是彈窗：Enter 送出、Esc／失焦取消，樣式照原生
  `.renameInput`（14px/20px、4px 圓角）。
- **選單 portal 到 `document.body`**，所以不會被側邊欄的 overflow 裁掉
  ——原生也是 `createPortal(…, document.body)`。客戶端 bundle 的 `require`
  只拿得到 `react`（沒有 react-dom），所以自己建容器 + 固定座標。
- 點外面或 Esc 關閉；選單開著時那一列維持 `menuOpen` 的底色（原生一樣）。
- `gap:12px`（原生 `.rowActions{gap:12px}`）、標題邊距 `0 6px 0 4px`（原生一樣）。

### 新 op：`chat.rename`

改一份對話的名字＝改那個 `.jsonl` 的檔名，但一份對話的**身分**四處都記著同一個名字，
所以四處一起搬：

| 哪裡 | 怎麼搬 |
|---|---|
| `chats/<角色>/<名>.jsonl` | 內容原樣搬到新檔名（**獨佔建立，撞名自動編號、不覆蓋**） |
| `.sessions/<id>.json` | 綁定裡記的對話名一起改（不然那份對話會失去它的 session） |
| `art/chats/<角色>/<正規化名>/` | 插圖資料夾跟著改名（目標已存在時不合併、不覆蓋） |
| `tavern.json` 的 `assets` | 主圖 key `chat:<角色>/<名>` 一起改 |

回傳的 `name` 才是**真正用的名字**（撞名時會換編號），呼叫端一定要用它。
名字沒變時當成功（呼叫端常常是「按了 Enter 但沒改」）。

### 分支：接 DSH 自己的 `remote.session.fork`

原生會話列那一顆「分支」就是 `session.fork({sessionId, atSeq?})`。酒館把它接上檔案：
`fork` → `chat.create` 開新檔 → `chat.append` 把目前看到的訊息寫過去 → `session.bind`。
兩個真實限制都**在選單上直說**，不給「按了沒反應」的按鈕：
還沒有任何綁定（這份對話還沒真的聊過）→ 明說要先開啟並說一句話；
這台 DSH 的 remote 沒有 `fork` → 那一項變灰並說明原因。

### 順手修掉的脆弱點（同型 bug 的預防）

使用者這輪讓「元件被直接呼叫」的路徑變多，於是幾個「假設宿主半一定回陣列／物件」
的地方在渲染期丟錯——那會讓整個 `main` 面板變成死格（`plan.md` §7.4b 那個型別）。
全部改成防禦式：`MapOverview` / `MapCharacters` 的 `characters`、
`summary.counts`、`MapTavernActions` 的名稱。**它們是防禦，不是這輪的功能。**

### 測試

- `test-workspace.mjs` 第 16 項（新）：改名——檔案／綁定／插圖資料夾／主圖 key
  四處一起搬、**撞名不覆蓋**（回傳的是真的名字）、不存在的對話與空名字要報錯。
- `test-client.mjs` 第 12 項（新）：對話列的 `slot／title／time／actions` 四個部分
  齊全、⋯ 有 `aria-haspopup`、按下去畫出 portal 到 body 的選單、三項名稱與順序。
- `test-client.mjs` 第 13a／13b／13c（新）：改名（按鈕只開行內輸入，Enter 才送 op，
  四個參數都對）、刪除（三個參數）、分支（`fork` → 新檔 → 寫訊息 → 綁定新 session）。


### 為什麼

兩個都是「東西已經做好了、但使用者碰不到」的問題。

1. **`chat.delete` 早就做好了**（宿主半有這個 op、`smoke.mjs` 第 14 項也驗過行為），
   但**畫面上沒有入口**——開了一份對話就永遠刪不掉，只能去檔案總管手動刪檔。
   `docs/plan.md` §7.6 因此把它列為「UI 階段的第一件事」。
2. **改了程式碼卻不會生效**：profile 是從 GitHub 的 tarball 裝的
   （`refs/heads/main.tar.gz`），所以工作區的檔案跟 DSH 實際載入的
   `node_modules/dsh-tavern` 是兩份**實體複製**，改完還要手動複製過去，
   而且 tarball 會被 pnpm 的快取騙到（裝到的還是舊版）。

### 刪除對話（新）

設定頁的「💬 對話紀錄」分區，每一列多一顆**刪除**（danger 樣式）：

- **按一下不會刪**，只會在那**一列底下就地展開確認**（「確定要刪掉
  `角色/對話.jsonl` 嗎？檔案會真的從磁碟上消失，救不回來。」＋「確定刪除」／「取消」）。
  一次只確認一份——按另一列的刪除會把上一列的確認收掉。
- 不用 `window.confirm`：這個 repo 從來沒有用過對話框，而且側邊欄在最底部、
  彈窗會被裁掉（⋯ 與 ＋ 都是為此改成不彈窗）。就地展開的確認列在離線測試裡也看得到。
- 刪除成功後：清單重讀、`summary.counts` 重算（通知兩條通道）、訊息寫出
  「已刪除 `角色/對話.jsonl`」——**並說明對話室插圖留著、session 綁定一起解掉**
  （跟刪角色同一個規矩：只刪那一份，不連帶清別的）。
- **正在看的那份對話被刪掉時**，對話頁會自己發現（訂閱「內容變了」的通知 → 重讀
  `chat.list` → 找不到就退回這間酒館的設定頁並說明原因），而不是留在一頁已經不存在的
  紀錄上、等使用者送出訊息才得到「找不到這份對話」。

### 開發迴圈：改用 `link:`（macOS 這台）

```sh
dsh plugin --profile web add "link:/path/to/dsh-tavern"
```

於是 `~/.dsh/profiles/web/node_modules/dsh-tavern` 是一條 symlink，指回工作區。
改 `lib/client.js` 之後**重新載入頁面就生效**（DSH 內建的 `dsh-client-hmr` 每 500ms
對 client bundle 重新取 hash，內容變了就透過 `/plugins/events` 推 `rebuilt`）；
動到宿主半（`lib/index.js`）仍然要重啟 `dsh web`。

> 驗證方式（不必問人）：抓 `/plugins/??dsh-tavern/client.js&rev=<rev>`，下載到的 bundle
> 應該含著你剛改的字串；`/plugins/events` 會列出每個 bundle 的 `rev`。

### 文件更正

- `README.md` 說「五支測試」、版本標記寫 `2.4.0`——實際是**八支**、`2.5.0`
  （現在是 `2.5.1`）。
- `docs/plan.md` 的環境那節整節是 Windows 路徑與「沒有 git」的前提，
  在 macOS 這台上已經不成立。

### 介面變動

- 版本標記升為 `tavern-2.5.1` / `tavern-client-2.5.1` / `tavern-agent-2.5.1`；
  `package.json` 與 `dsh.plugin.json` 為 `2.5.1`。
- 沒有 API、RPC 或檔案格式變動：`chat.delete` 本來就在，只是多了入口。

### 測試

- `test-client.mjs` 第 11 項（新）：確認列、`chat.delete` 的三個參數
  （`id`／`character`／`chat`——這一頁踩過兩次「少了酒館 id 就被當成角色 id」的坑）、
  **列上的按鈕不可以直接刪**、沒有 `window.confirm`。
- `test-client.mjs` 第 4d／6b 項：`MapChatFiles` 的通知點從 1 個變 2 個（建立 ＋ 刪除）、
  `useRefreshVersion` 的訂閱從 4 處變 5 處（對話頁也訂閱了）。

## 2.4.0 — 新建酒館附老闆娘與世界書；補齊設定頁的入口

### 為什麼

使用者：「**預設就是，新建酒館的時候會給一個酒館老闆娘和世界書**」。
一間剛開好的酒館原本是空的（0 人物卡、0 世界書），面對一片空白很難下手。

使用者同時指出：「**設定的 gui 麻煩你重新看重新找，好像和你想的不一樣**」——
確實不一樣。我原本以為的設定頁比實際的完整，實際走一遍之後發現三個缺口。

### 新建酒館的預設內容（新）

按 ＋ 選資料夾之後，除了四個目錄與設定檔，還會附上：

```
characters/老闆娘.json    一位可以直接開始的老闆娘
worldbooks/酒館.json      一本寫著「這間店／老闆娘／店規」的世界書
```

三個刻意的約束：

- **只在新建立時給。** 不放在任何讀取路徑上——讀取寫檔曾經讓「舊版殘留」的
  標記自己消失，那個 bug 花了兩輪才修完。**既有的酒館不會被補**。
- **只補不覆蓋。** 目標檔案已存在就跳過；使用者自己改過的老闆娘不會被蓋掉。
- **寫出來的是一般的卡與世界書**，沒有任何隱藏格式，要改要刪都很容易。

內容寫在 `lib/defaults.js`。世界書用**原生形狀**（`entries` 是以字串化 uid
為 key 的物件），跟使用者從別處匯入的世界書是同一種東西、同一套編輯器。

### 設定頁（側邊欄 ⋯ 進去的那頁）補齊

實際走過一遍之後發現的問題：

- **「💬 對話紀錄」分區完全沒有動作可做**——只能從側邊欄那顆 hover 才出現的 ＋
  開新對話，設定頁這邊找不到入口。現在有「**＋ 新對話**」，會就地列出角色讓你挑
  （不彈窗：酒館街在最底部，彈窗會被裁掉，跟 ⋯ 同一個理由）。
- **世界書只能新增空白的**。現在有「**📥 匯入世界書**」，跟匯入卡片一樣走二進位
  body，**不做任何欄位轉換**（原始 JSON 原樣寫入）。接受 `{entries:…}` 與陣列兩種
  方言；不像世界書的檔案會早點拒絕並說明原因。
- 世界書的 id 由**檔名**推導，不是 `data.name`——後者是 SillyTavern **內嵌**方言
  才有的欄位，原生世界書沒有，照它走會得到 `worldbook-<時間>` 這種爛名字。

### 介面變動

- 新增 `lib/defaults.js`（`package.json` 的 `files` 要帶上）。
- 新增 RPC `worldbook.import`（二進位 body）。
- `tavern.add` 的 `skeleton` 現在會回報預設內容的兩個檔案
  （`characters/老闆娘.json`、`worldbooks/酒館.json`）。
- 版本標記升為 `tavern-2.4.0` / `tavern-client-2.4.0`。

### 測試

- `test-workspace.mjs` 第 12 項：seed 產生正確的卡與世界書、欄位不可是空的、
  第二次 seed 不建立任何東西、**不覆蓋使用者改過的版本**。
- `smoke.mjs` 第 4 項加上預設內容的斷言、新增第 5b 項（世界書匯入：原樣寫入、
  兩種方言、不像世界書就拒絕）。
- `test-registry.mjs` 第 4 項改成**相對**比對（新建附老闆娘之後基準不是 0）。

## 2.3.0 — 儲存層強化：原子寫入、來源圍籬、PNG 卡匯入

三份參考專案（SillyTavern、flizzywine/dsh-tavern、dsh-portable-tavern）研究完之後，
依 [`docs/storage-layout.md`](docs/storage-layout.md) 的定稿實作。判斷過程見
[`docs/design-comparison.md`](docs/design-comparison.md)。

### 原子寫入（最重要的資料安全修正）

以前每個寫入都是裸的 `writeFile`，而它在磁碟上是「**截斷 → 寫入 → 完成**」三步。
如果行程在截斷與完成之間死掉（斷電、被強制關閉、crash、磁碟滿），
檔案就停在「被截斷、只寫了一半」——**舊的沒了、新的也不完整**。
`tavern.json` 裝著主圖設定與酒館名稱，壞掉就是這些設定全丟。

現在全部走 `lib/write.js` 的 `atomicWrite`（寫暫存檔 → `rename`），
所以斷電時只有兩種結果：**舊的完整版本**，或**新的完整版本**。

`smoke.mjs` 第 13 項**真的在寫入途中把行程 SIGKILL**，然後檢查檔案：
新寫法留下原本的完整內容，而對照組（直接寫檔）被截斷成 0 bytes。
（寫這個測試本身踩了兩次坑：第一次「等 250ms 再殺」根本殺在寫完之後；
改用「看到暫存檔出現才殺」才真的命中寫入中。）

涵蓋範圍：`~/.dsh/taverns.json`、`tavern.json`、`characters/*.json`、
`worldbooks/*.json`、`art/**`。

### 不再覆蓋：獨佔建立與碰撞重試

- `ensure()` 建 `tavern.json`／`README.txt` 改用 `open(..., 'wx')`，
  取代「先 stat 再寫」——後者在檢查與寫入之間有空窗。
- `createChat` 改用 `createUnique`（撞名換編號重試）。
  舊寫法有兩個毛病：檢查與寫入之間有空窗，而且最後一次嘗試撞名時
  會把裸的 `EEXIST` 丟給使用者。

### 來源圍籬（安全）

研究時查出：**DSH 的 `webserver` 沒有任何來源檢查**（`origin`／`sec-fetch`／
`remoteAddress` 全部零命中），而 SillyTavern 自己有 CSRF token
——所以「本機的其他網頁可以打這個 port」是真實的威脅模型。
我們的 op 會**建立檔案**（`tavern.add`，路徑由呼叫端決定）、**寫入**（`assets.write`）、
**刪除**（`assets.delete`），所以兩條路由都套了四項檢查：

1. 連線來源必須是迴圈位址
2. `Host` 也必須是迴圈位址（擋 DNS rebinding）
3. `Sec-Fetch-Site` 不可以是 `cross-site`
4. 有 `Origin` 時，它的 host 必須與 `Host` 相符

刻意留了遠端出口：`DSH_TAVERN_ALLOW_REMOTE=1` 放行非本機來源，
但第 3、4 項仍然有效——放寬的是「只有本機」，不是「關掉防護」。
`smoke.mjs` 第 14 項對每一種繞過手法各測一條。

### PNG 卡匯入（新）

真實世界的酒館卡大多是一個 `.png`，資料藏在 tEXt chunk 裡。新增 `lib/pngcard.js`：

- 讀 `chara`（V2）與 `ccv3`（V3），**`ccv3` 優先**、關鍵字**大小寫不敏感**、
  解碼鏈是 base64 → UTF-8 → JSON（與 SillyTavern 一致）。
- **只做讀，不做寫。** 兩個參考專案也都只做單向——PNG 內嵌是「讀別人的卡」的需求。
- ⚠️ **不相信任何長度欄位**：PNG 每個 chunk 開頭是 4 bytes 的長度宣告，
  一個惡意檔可以宣告 4GB。每一步都先確認剩餘位元組夠不夠，
  超過上限就拒絕。`smoke.mjs` 第 16 項用一個宣告 `0xFFFFFFFF` 的 chunk 驗證它
  「瞬間拒絕而不是真的去讀」。
- 匯入時：資料寫成 `characters/<id>.json`、**原始 PNG 位元組**留在
  `originals/cards/<id>.png`（tEXt 以外的位元組我們重建不出來）、
  那張 PNG 同時成為這張卡的插圖。
- 原版**同名不覆蓋**：原版的意義就是「第一次匯進來的樣子」。
- 瀏覽器半：人物卡分區多了「📥 匯入卡片」按鈕（接受 `.png` 與 `.json`）。

### 把「對不起來」變成不可能

匯入與上傳都是二進位 body，op 名稱寫在程式碼裡的**字面字串**上。
`smoke.mjs` 的跨半契約檢查（第 12 項）因此也擴充成同時掃 `rpc('…')` 與
`sendFile('…')`，並且**容忍跨行呼叫**——第一版就是因為 `sendFileExpectOk(\n 'character.import'`
跨行而掃不到，還加了「必須掃到這兩個二進位 op」的自我檢查。
現在 25 個 op 全部被涵蓋。

### 無損往返的保證（取代 `.original` 備份）

討論時決定**不做**「外部改過偵測」，也不為每個檔案預留 `.original` 備份
（使用者確認「同時用編輯器開著同一個檔」不是真實情境）。改為用
**規則 + 測試**保證：`test-workspace.mjs` 第 10、11 項拿真實形狀的卡與世界書
（含未知欄位、`extensions.regex_scripts`、`character_book`、世界書的兩種方言）
寫入再讀出，**逐欄位必須相等**。

### 介面變動

- 新增 `lib/write.js`、`lib/pngcard.js`（`package.json` 的 `files` 要帶上）。
- 新增 RPC `character.import`（二進位 body）。
- 版本標記升為 `tavern-2.3.0` / `tavern-client-2.3.0`。
- 新增環境變數 `DSH_TAVERN_ALLOW_REMOTE`。
- 新增 `originals/cards/` 目錄（只有匯入 PNG 卡時才會出現）。

## 2.2.0 — 插圖變成「一組圖 + 主圖」，並修掉兩個實際踩到的 bug

### 為什麼

2.1.0 的 `art/` 只是 `mkdir` 出來的一個空目錄：宿主半有一條 `/api/dsh-tavern/files`
在服務它，但**瀏覽器半從來沒有呼叫過**，也沒有任何上傳端點。也就是說插圖一直是死路，
而且結構是孤島——人物卡是一個 `.json`，圖卻丟在一個對不上任何東西的 `art/<角色>/`。

同時使用者回報了兩件事：

1. **「按 ＋ 新增酒館，連預設酒館也一起出現」**——真相是那筆紀錄從 2026-09-16（v1）
   就躺在 `~/.dsh/taverns.json` 裡，而酒館街預設收合，所以按 ＋（新增後清單會自動展開）
   才第一次看到它。不是新增邏輯多建了一間，是舊資料沒有清理路徑。
2. **「＋ 新增角色」按了沒反應**——面板呼叫 `character.create`，宿主半沒有這個 op，
   永遠回 `unknown op`。而所有測試都是綠的，因為兩半各自被測、沒有人測它們之間的介面。

### 插圖（新）

- **模型改成「一個東西 → 一組圖 → 指定主圖」**。一個角色的微笑／生氣／動作差分
  可以幾十張，所以不是「一張立繪」。
- 掛載點（`art/` 底下，一項一個資料夾）：
  `art/characters/<卡 id>/`、`art/worldbooks/<書 id>/`、
  `art/chats/<角色>/<對話名>/`、`art/tavern/`（店面／背景圖）。
- **資料夾就是清單**：直接丟圖進去就生效，不用改設定檔。
  主圖記在 `tavern.json` 的 `assets`（`{"character:老闆娘": "微笑.png"}`）；
  沒指定＝檔名排序第一張，指定的被刪掉會自動退回第一張。
- **上傳走二進位**（`assets.write`：body 是圖片本身，種類／擁有者／檔名放 query），
  不是 base64 JSON——一張圖好幾 MB，base64 會再多 33%。
- **只信內容不信副檔名**：檢查 magic bytes（png/jpg/gif/webp/avif/bmp），
  宣告 jpg 但內容是 png 就存成 `.png`。單張上限 8MB、單一實體上限 400 張、
  同名自動編號（`微笑.png` → `微笑-2.png`，不覆蓋）。
- 讀圖路由 `GET /api/dsh-tavern/assets/...`：逐段驗證路徑（擋跳脫）、
  正確 `content-type`、`nosniff`、etag（304）。
- 面板：人物卡清單顯示主圖小臉、卡片編輯器／世界書／對話頁／酒館設定頁各有一個
  插圖管理器（縮圖格、點縮圖換主圖、✕ 刪除、整批拖放、可同時選多檔）。

### 修掉的 bug

- **`character.create` 不存在** → 宿主半補上這個 op，「＋ 新增角色」現在真的會建卡。
- **`writeSettings` 只認得 `name`/`note`** → 面板設的主圖會被**默默丟掉**
  （看起來像「設了沒生效」）。現在 `assets` 有自己的分支並逐項驗證。
- **刪掉主圖時的邏輯錯誤** → 以前會拿 `null` 去指定主圖而丟錯；
  現在改成「刪掉的正好是主圖時，才把主圖換成還存在的那一張」。
- **上傳後「第一張自動當主圖」永遠不成立** → 判斷順序寫反了（先寫檔才看「本來有沒有圖」）。
- **`art` 計數把資料夾也算進去**（`readdir().length`）→ 改成遞迴數圖片檔。
- **舊版殘留的酒館** → `summary()` 新增 `scaffolded`（有沒有 `tavern.json`），
  面板把它標成「舊版殘留」並在設定頁說明來龍去脈；移除仍然只動清單、不刪檔案。

### 介面變動

- 新增 `lib/assets.js`；`package.json` 的 `files` 要帶上它。
- 新增 RPC：`character.create`、`assets.list`、`assets.write`（二進位）、
  `assets.primary`、`assets.delete`。
- **移除** `GET /api/dsh-tavern/files`（從來沒有被用過，而且它的路徑檢查比新的鬆）。
- `character.list` / `worldbook.list` / `chat.list` 的回應多了 `assets`
  （`{ items, primary, owner }`）；`chat.list` 的每一筆多了 `assetId`。
- 對話名可能含不能當資料夾名的字元（`&`、空白、emoji），所以插圖資料夾用的是
  正規化後的 `assetId`（`assets.js` 的 `assetOwner`），主圖設定則用原始名字當 key。
- 版本標記升為 `tavern-2.2.0` / `tavern-client-2.2.0`；`package.json` 與
  `dsh.plugin.json` 為 `2.2.0`。
- **沒有舊插圖要相容**：`art/` 本來就是空的（沒有任何程式寫過它），
  所以不做舊路徑遷移。舊的 `art/<角色>/*` 檔案仍然留在磁碟上，只是不再被讀取。

### 測試

- `smoke.mjs`：新增第 7～10 項（插圖上傳／自動編號／主圖／讀取／刪除、
  非圖片與路徑跳脫與超大檔的防護、對話室與店面、移除不刪插圖）、
  第 11 項（舊版殘留辨識）、以及第 12 項
  **跨半 op 契約**——把瀏覽器半原始碼裡的每個 `rpc('...')` 掃出來，逐一確認宿主半
  真的有那個路由。這一條就是為了讓「＋ 新增角色」那類 bug 不可能再靜默通過。
- `test-workspace.mjs`：新增第 8～9 項（assetId 正規化與撞名、magic bytes、
  路徑防護、主圖寫得進 `tavern.json` 且清得掉）。
- `test-client.mjs`：新增第 7 項（插圖 UI 的標題／加入按鈕／二進位上傳／拖放區，
  並確認不再引用退役的 `/files` 路由）。

## 2.1.0 — 啟動時什麼都不做，按了才做

### 為什麼

2.0.0 雖然把核心服務都拿掉了，但側邊欄的「酒館街」一掛載就會自己去讀 `tavern.list`。
側邊欄區塊是一直掛在畫面上的，所以那等於「DSH 一開啟這個插件就在做事」——出問題時
**看不出是哪一個動作卡住**。使用者要的是：把動作交回自己手上，按了才動，
這樣壞掉時一眼知道是哪一顆按鈕壞了。

### 改了什麼

- **酒館街預設收合**：沒展開時只畫標題列（啤酒杯 + 「酒館街」+ ＋），
  **一個請求都不送**。按標題列才展開並第一次讀 `tavern.list`。
- 展開後讀取失敗會顯示 `讀取失敗：…`，不會假裝在讀取。
- 酒館列、⋯（設定）、＋（新對話）、對話列、世界書／人物卡／對話紀錄，
  全部維持「按下去才讀」。
- `test-client.mjs` 新增第 2b 項：用 fetch 監聽釘死
  **`apply()` 零請求 → 掛載零請求 → 按「顯示酒館街」剛好一個 `tavern.list`**。

### 介面變動

- 版本標記升為 `tavern-2.1.0` / `tavern-client-2.1.0`；`package.json` 與
  `dsh.plugin.json` 為 `2.1.0`。
- 沒有任何 API 或檔案格式變動：酒館資料夾結構、`tavern.json`、註冊表格式都不變，
  升級後舊資料照樣讀得到。

## 2.0.0 — 砍掉重練：只留 UI 與檔案

### 為什麼

v1 在 macOS 上安裝後 **DSH 完全卡死、開不起來**。v1 的宿主半在啟動時會跟一堆核心服務
打交道（`settings` 命名空間＋自製 schema、`agents` 接管、`agent/request` 覆寫、
`systemPrompt` 注入），彼此糾纏，任何一個卡住就等於整個 `dsh web` 起不來。

所以 v2 的目標很明確：**只留下不會出事的東西**。

### 拿掉的（整個刪除，不是關掉）

- `settings` 命名空間、自製 schema（`lib/schema.js`）與所有參數持久化
- `agent/request` waterfall 覆寫、`systemPrompt` 段落注入、`agents` 接管
- 顯示層正則引擎（`lib/regex.js`）與卡片預覽
- 舊資料遷移、自動認養 `~/.dsh/tavern/`、「預設酒館」、自動建立任何酒館
- 階段 2–5 的佔位面板（對話循環、世界書觸發、立繪、MCP）

宿主半現在**只依賴 `webServer` 一個服務**，其餘全是檔案 I/O。

### 留下的

- 側邊欄的「酒館街」區塊（度量與互動照抄原生工作區瀏覽器：34px 列、hover 才出現的
  ⋯／＋、展開其餘 N 個、可拖曳的分隔線、彩色燈籠與啤酒杯圖示、每間酒館可自訂圖示）
- 中間的設定頁：🏠 這間酒館／🎭 人物卡／📖 世界書／💬 對話紀錄
- **新增酒館＝在選定的資料夾裡建立結構**：
  `characters/`、`worldbooks/`、`chats/`、`art/`、`tavern.json`、`README.txt`
- 人物卡：SillyTavern 信封、未知欄位原樣保留、裸卡與壞卡都處理
- 世界書：原始 JSON 讀寫
- 對話：列出 `chats/<角色>/*.jsonl`，＋ 會寫出帶 SillyTavern 標頭的檔案
- 設定卡片：退避重試、失敗顯示錯誤（不再卡在「工作區讀取中…」）

### 介面變動

- 版本標記：`tavern-2.0.0` / `tavern-client-2.0.0`
- 測試從七支減為五支（`test-schema.mjs`、`test-regex.mjs` 隨功能移除）
- `docs/architecture-seams.md` 刪除（它描述的是已移除的階段 2–5 接縫）

## 1.0.0 — 第一版正式釋出

酒館模式變成獨立的 DSH 插件：側邊欄酒館街、人物卡／世界書／對話的檔案管理、
生成參數與提示詞注入（於每次模型請求生效）、顯示層正則引擎。

（該版本的生成參數／提示詞／agent 相關功能已在 2.0.0 移除。）
