# 設計判斷：三份參考專案 vs. dsh-tavern

> 狀態：**判斷稿**。本文只做設計取捨。
> **其中建議的項目已在 v2.3.0 實作**（見 [`storage-layout.md`](storage-layout.md) §4.5 的實作對照）；
> 決策與理由保留原樣，因為它們記錄了「為什麼這樣選」——包含我中途改變立場的地方。
> 撰寫時間：2026-09-17

## 0. 先說結論

三份參考各自解決的是**不同問題**，把它們當成「同一件事的三種做法」會選錯：

| 專案 | 它是什麼 | 對我們的意義 |
|---|---|---|
| **SillyTavern** | 生態協議的**事實標準**（卡、世界書、對話、表情圖、預設…） | 我們要**相容它的格式**，但不需要相容它的**執行方式** |
| **flizzywine/dsh-tavern** | DSH 上的**完整文字遊戲 Agent**（自帶 runtime、雙 Agent、9 家生圖） | 它是「另一端」：規模與風險模型跟我們相反，但它的**檔案治理**值得抄 |
| **XCNXNXNX/dsh-portable-tavern** | **無檔案系統**的 DSH 插件：全部狀態住在瀏覽器（localStorage／IndexedDB），「portable」指**狀態可攜**而非執行環境 | 它是我們**儲存哲學的相反極**。它教我們的是「我們為了可攜性付了什麼代價」，以及一個我們該抄的安全細節 |

一句話總結三者的儲存哲學：

```
SillyTavern              ：伺服器上的資料夾（檔案是真相，但圖有兩份）
flizzywine/dsh-tavern    ：固定資料根＋附件服務＋大量標記檔（治理嚴密，但重）
dsh-portable-tavern      ：完全沒有檔案（瀏覽器就是資料庫）
dsh-tavern（我們）        ：使用者選的資料夾（檔案是真相，一項一處）
```

所以本文的判準不是「他們有什麼」，而是「**在『零執行期依賴、只依賴 webServer、按了才做』三條硬規則下，哪一些拿得過來**」。

---

## 1. 我們自己的定位（用來當判準）

先把不可退讓的東西寫清楚，否則下面的比較沒有尺：

1. **零執行期依賴**：宿主半只 import `node:` 與自己的相對檔案。違反＝使用者可能整個 `dsh web` 開不起來。
2. **只依賴 `webServer` 一個 DSH 服務**：多依賴一個核心服務，就多一個「啟動時卡住」的理由。
3. **啟動時零請求、零檔案讀取**；每個動作對應到使用者按下的那一顆按鈕。
4. **資料是使用者的**：一間酒館＝一個普通資料夾，可以用檔案總管看、手改、備份、丟進別的軟體。
5. **移除絕不刪檔**；只補不覆蓋。

第 4 條是最容易被「更聰明的架構」侵蝕的一條，下面會反覆用到。

---

## 2. SillyTavern：要抄的是**格式**，不是**執行方式**

（詳細的資料夾與欄位清單見 §附錄；這裡只做判斷。）

### 值得抄

| 項目 | 為什麼 |
|---|---|
| **卡片的 V2/V3 信封**（`{spec, spec_version, data}`） | 我們已經在做。它是生態的共通貨幣，而且「未知欄位原樣保留」是一條我們已經在守的規則。 |
| **`chats/<角色>/<房間id>/chat.jsonl`＋標頭行** | 我們已經在做，而且已經寫得出有效的酒館聊天檔（房間是一個資料夾：設定／對話／插圖都在裡面）。 |
| **世界書「原始 JSON 不表單化」** | 我們已經在做（格式太多種，硬做欄位表單一定會吃掉欄位）。 |
| **PNG 卡內嵌 `chara`（V2）／`ccv3`（V3）tEXt chunk** | **這是我們目前最大的相容缺口**，見下面。 |

### 不要抄

| 項目 | 為什麼不要 |
|---|---|
| 把圖同時放在兩個地方（`data/<user>/characters/<name>.png` 與 `data/<user>/<name>/`） | 兩份真相，遲早不同步。**一項一處**是我們已經做對的事，不要為了「像 ST」而退回去。 |
| 用**檔名推導**表情（`joy.png` → joy） | 脆：中文、空白、emoji 都會壞。見 §5 決策 B。 |
| 任何「跑對話」「跑提示詞」「跑正則」的部分 | 那是 v1 把 DSH 弄死的原因，已經整批拿掉，不回頭。 |

### 需要決策的一件事：PNG 卡

我們現在只吃 `characters/<id>.json`。真實世界的酒館卡**大多是一個 `.png`**，資料藏在 tEXt chunk 裡。

- **不支援**：使用者從社群下載十張卡，十張都要先自己想辦法轉成 JSON。這對「找到喜歡的內容，丟進來就能用」是硬傷。
- **支援**：要多一個 PNG chunk 剖析器（掃 `length|type|data|crc`，只認 `chara`/`ccv3`，base64→UTF-8 解碼）。這段程式不難，但要小心：**不能相信任何長度欄位**，要防止壞檔造成超大 allocation 或無限迴圈。

**判斷：值得做，但它是獨立的一件事（見 §6 的 P3）**，不應該跟插圖綁在一起做。

### 但這裡有一個**方向性**的發現（研究補充）

我原本以為「ST 存 PNG、我們存 JSON」是我們**落後**。**實際上是相反的**：

- ST 的 `GET /api/characters/all` **只列舉 `characters/` 底下 `.png` 結尾的檔案**。
  純 `.json` 的卡**不是可用的卡**——JSON/YAML 匯入時它會**用 `public/img/ai4.png` 這個預設圖
  把卡「實體化」成一張 PNG**。也就是說：在 ST 裡，PNG 是**儲存格式**，JSON 只是**交換格式**。
- 它是為了「單檔分發 + 拖放即用」才這樣設計的，而那件事我們用**資料夾**做掉了。
- 代價它自己吃下了：**每存一次卡就要重寫整張圖**、讀卡一定要先解 PNG、
  `chara`/`ccv3` 兩份重複資料（而且它的 docstring 還跟實作自相矛盾）。

**所以在我們「一項一處、純檔案」的模型下，`characters/<id>.json` 是比 PNG 更好的儲存格式，
PNG 只該是匯入／匯出的適配器。** 這正好跟 ST 的選擇相反，而且理由是我們不需要它的好處
（單檔分發），卻會吃到它的壞處（重寫整張圖）。

另外一個要注意的細節：ST 匯入純 JSON 卡時**會補一張預設圖**。
所以我們的 P3 匯入如果只寫 JSON、不產生任何圖，那張卡在酒館街上就會是一個「沒有臉」的空格。
**匯入時應該補一個佔位圖**（或者 UI 要把「沒有插圖」畫得好一點）。

---

## 3. flizzywine/dsh-tavern：規模相反，但**檔案治理**值得抄

### 它的設計核心（實測，非推測）

- **一主多子 Agent**：前台主 Agent 只寫正文；一個持續存在的後台子 Agent 做候選項、姿勢、狀態結算。理由是**前綴快取穩定**（宣稱 95%+ 命中）＋把一個混雜的大任務拆成多個目標明確的小任務。
- **敘事本體、變數投影**：「讓變數忠實記錄故事，而不是讓故事服從變數」。原文是權威，變數只是可重算的快取。
- **三方卡片**：`originals/`（不可變原版）＋ `resources/`（可編輯工作版）＋ 記憶體中的穩定投影。**未知欄位不得因為匯入／編輯／匯出而丟失**（他們的架構規則 4）。
- **`$DSH_HOME/profile-data/tavern/data` 固定資料根**，不跟原始碼目錄、更新位置或 worktree 跑；升級先完整備份舊 `data`，衝突不覆蓋而是丟進 `migration-conflicts/` 給人看。
- **大量的標記檔**：`.file-resources-v1.json`、`.material-bindings.json`、`.worldbook-bindings.json`…
- **對話改寫成快照＋追加式 JSONL journal**，revision 只增不減（ABA 防護），回退產生**新分支**而不是改寫歷史。
- **鎖 DSH 版本**（`0.1.2-rc.1`），版本不符就**停止安裝**；因為 DSH 常有破壞性更新。
- **client 產物是確定性組裝的**：原始碼在 `src/client/`，`lib/client.js` 是產物，`pnpm check:client` 會**拒絕過期產物**，不准直接編輯。
- **圖片**：場景插畫含版本、重畫、9 家生圖供應商；**成功圖片的位元組交給 DSH 附件服務管理**，綁定正文版本；只有綁定狀態放在 `scene-images/`。

### 值得抄（而且我們現在就缺）

| 項目 | 為什麼對我們也成立 |
|---|---|
| **原版／工作版分離** | 我們現在**直接寫回使用者的卡檔**（`toCardEnvelope` 會重寫整個檔案）。如果使用者的卡裡有我們不認得的欄位，理論上會保留（我們有做 `{...card}`），但**一旦格式轉換有 bug，使用者的原檔就沒了**。他們的 `originals/` 是「匯入時無損留存原始位元組」——這對「資料是使用者的」是更強的保證。 |
| **`check:client` 拒絕過期產物** | 我們的 `lib/client.js` 是手寫 3000 行、且被當成產物放在 `lib/`。我們有版本標記（`tavern-client-2.2.0`）但**沒有任何機制擋住「改了原始碼忘了同步」**。他們的做法可以直接借：加一條檢查，讓「產物與來源不一致」變成測試失敗。 |
| **升級時先備份、衝突進 `migration-conflicts/`** | 我們的 `tavern.json` 已經有 `assets` 這類中繼資料；未來格式一定會再變。他們「不覆蓋、留下來給人看」比我們的「讀不到就回退成預設值」更保守——但注意我們的回退是刻意的（面板永遠開得起來），兩者要**並存**：讀取寬容、寫入前備份。 |
| **「外部內容未經投影不得進入模型」的原則** | 我們現在不碰模型，所以還用不到。但這是一條**未來擴充時的地基**：如果哪天要把卡片餵給 DSH session，必須有一個唯一的投影邊界，而不是各處拼字串。 |

### 明確**不要**抄

| 項目 | 為什麼 |
|---|---|
| 雙 Agent、候選項、MVU、預設庫、正則管線、EJS／QuickJS 沙箱 | 每一個都要在啟動或每輪跟核心服務打交道。這正是 v1 的死因。**如果這些要回來，應該是獨立插件**（README 已經這樣寫了）。 |
| 快照＋journal 的對話格式 | 我們**不持有劇情權威**（不跑對話）。沒有權威就沒有 revision、沒有 rollback、沒有 ABA 問題。為一個只讀檔案的插件做 journal 是純粹的複雜度。 |
| **把圖片位元組交給 DSH 附件服務** | 見 §5 決策 C。這是本文最重要的一個「不抄」。 |
| 鎖 DSH 版本、自帶 runtime、確定性建置產物 | 他們必須鎖版本是因為他們**深度依賴 DSH 內部**（session 格式、provenance 斷言）。我們只依賴 `webServer` 的路由註冊——這是**窄而穩**的介面。鎖版本會讓我們失去「DSH 更新後通常還能用」的優點。 |

---

## 4. dsh-portable-tavern：我們哲學的**相反極**，但它有一個我們該抄的安全細節

實測（v0.3.0，`main @ 113199e9`）：這是一個正常的 DSH 雙面插件（有宿主半也有瀏覽器半），
但**它不建立任何檔案、不碰 `node:fs`、沒有目錄、沒有使用者選的資料夾**——
所有狀態都在瀏覽器：`localStorage` 六個 key（設定／桌布／模板／工作區／角色庫／自訂 LLM 端點）
＋一個 IndexedDB（只放音樂 blob）。

```js
// 它的「資料庫」長這樣
localStorage['dsh.portable-tavern.workspace.v1']  // { spec, card, worldbook, chat, avatar, … }
localStorage['dsh.portable-tavern.characters.v1'] // SavedCharacter[]（角色庫）
```

### 它證明了一件事：**「沒有檔案」是一個真正可用的選項**

| 面向 | 它（無檔案） | 我們（使用者資料夾） |
|---|---|---|
| 安裝後就能用 | ✅ 沒有任何權限、路徑、原子性問題 | ⚠️ 要選資料夾 |
| 換電腦／換瀏覽器 | ⚠️ 要手動逐卡匯出 JSON | ✅ 資料夾複製走就好 |
| 整個資料庫一起備份 | ❌ **沒有**（只有單卡 JSON 匯出） | ✅ 就是一個資料夾 |
| 瀏覽器清除資料 | 💀 全毀 | ✅ 沒事（根本不在瀏覽器） |
| 容量 | ⚠️ ~5MB 上限，而且**配額錯誤被吞掉** | ✅ 磁碟多大就多大 |
| 圖片的體積效率 | ❌ base64 塞在 JSON 裡 | ✅ 原檔 |
| 使用者能手改／用別的軟體讀 | ❌ 不行 | ✅ 可以 |

它的代價清單值得我們**引以為戒**（這些都是我們已經避開的）：
`try/catch → {}` 的「壞掉就當作沒資料」、每次寫入重寫整個 key、300ms debounce 內的關頁面會掉編輯、
角色庫以**名字**當識別（同名覆蓋）、沒有 migration／備份／版本化、桌布 base64 未壓縮直接撞配額。

**判斷**：我們的選擇（使用者資料夾）在**長期資料安全**與**可攜性**上明顯更好，
它則在**零摩擦上手**上更好。兩個都要的話，正確做法不是換儲存，而是——
**把「匯入／匯出」做順**（它只有單卡 JSON，我們連匯出都還沒有）。這是 P3 之下的一項。

### 該抄的：`guard()` 這種**迴圈位址圍籬**

它所有路由都過一個共用的 `guard()`，同時檢查四件事：

```
remoteAddress 是 127.0.0.1 / ::1 / ::ffff:127.0.0.1
Host 標頭也是迴圈位址
sec-fetch-site !== 'cross-site'
Origin 的 host 與 Host 相符
```

**為什麼這一條對我們特別重要**——我實際去讀了兩邊的原始碼：

1. **DSH 的 `webserver` 本身沒有任何來源檢查**。我對 `dsh-host-webserver/lib/index.js`
   搜過 `origin` / `Origin` / `sec-fetch` / `remoteAddress`：**零命中**。它只負責路由分派。
   所以 `POST /api/dsh-tavern/rpc` 目前是「任何能連到這個 port 的東西都可以打」。
2. **SillyTavern 自己是有防的**：它在啟動時 `fetch('/csrf-token')` 取得 token，
   之後每個請求都帶 `X-CSRF-Token` 標頭，伺服器端驗證（`script.js` 的 `getRequestHeaders()`
   與 `$.ajaxPrefilter` 都掛了這個標頭）。也就是說「這個 port 可以被本機網頁打」是
   **真實存在的威脅模型**，不是理論。

**我們的暴露面**（不是「以後再說」）：

- `tavern.add` 會在使用者給的路徑**建立檔案**；
- `assets.write` 會**寫入檔案**（8MB 上限）；
- `assets.delete` 會**刪除檔案**；
- `tavern.remove` 只動註冊表（這條安全）。

也就是說，一個惡意網頁如果能 POST 進來，可以對**任意路徑**做以上動作。
我們雖然預設綁 `127.0.0.1`，但這只擋掉遠端，**擋不掉「使用者自己開的另一個網頁」**。

**判斷：這一條應該升級成 P2**。不是因為風險高，而是因為**成本極低（一段共用函式）
而防的是一整類問題**。兩個參考專案示範了兩種做法：

| 做法 | 出處 | 對我們的適合度 |
|---|---|---|
| **迴圈位址圍籬**（4 項檢查，無狀態） | dsh-portable-tavern | ✅ **最適合**：不需要狀態、不需要改 client、不需要新的路由 |
| **CSRF token**（`/csrf-token` → 標頭） | SillyTavern | ⚠️ 更強，但要新增路由＋client 要帶標頭＋要在 HTML 注入 token。**如果要做到「連同機的其他行程也不能打」才需要** |

我建議**先做圍籬**：它是純粹的 server-side 檢查，不動 client，也不破壞我們
「面板只送 RPC」的簡單模型。CSRF token 留給「未來真的要開放到區網」的時候。

### 不要抄

| 項目 | 為什麼 |
|---|---|
| 把狀態放進 localStorage／IndexedDB | 對「資料是使用者的」是直接違反；而且**配額吞錯**這種寫法等於默默吃掉使用者的東西 |
| base64 圖片塞 JSON | 體積 +33%，而且使用者拿不出來 |
| 啟動時就 `GET /models` 掃過所有 provider | 這正是我們 v1 的死因**同一類**的風險（它在別人的機器上剛好沒出事而已）。我們「按了才做」是對的 |
| 依賴 `llm` 服務 | 我們已經決定不碰模型（見 §1 硬規則 2）。它做得到是因為它願意付那個耦合代價。 |
| 用**名字**當識別（同名覆蓋） | 我們用檔名／id，已經避開 |

### 一個附帶發現：它也不支援 PNG 卡**匯出**

它只做 PNG **匯入**（`decodePngChara()`），匯出永遠是 `.json`，README 卻寫了「導出 PNG 的 chara 內嵌數據」。
兩個參考專案（它與 flizzywine）**都只做單向**。這告訴我們：**PNG 內嵌是「讀」的需求，不是「寫」的需求**——
所以我們的 P3 只要做匯入，不做匯出。（SillyTavern 自己才是雙向的。）

---

## 5. 三個真正需要你決定的設計問題

### 決策 A：插圖的**掛載點**模型（目前是「一項一組圖 + 主圖」）

**現況**：`art/characters/<卡 id>/`、`art/worldbooks/<書 id>/`、`art/tavern/`，以及**房間的**
`chats/<角色>/<房間id>/art/`（房間的資源跟著房間走——`art/` 底下唯一的例外）；資料夾內容即清單；主圖記在 `tavern.json`。

**要判斷的點**：
- 這個「一項一組圖」的模型對**人物表情差分**夠不夠？（你已經說一個角色會有一大堆圖 → 目前的模型撐得住，因為是一整個資料夾。）
- 但**「主圖」這個概念對四種掛載點意義不同**：對角色卡＋世界書＋店面＝「預設要顯示哪一張」；對對話室＝「這個場景長什麼樣」。**名字一樣、語意不同**，要不要在 UI／文件上區分？

**我的判斷**：模型本身是對的，**不要加第四層目錄**（`art/characters/<id>/expressions/joy/` 這種）。理由：SillyTavern 之所以需要分類目錄是被它的 config 結構逼的；我們「資料夾就是清單」的簡單性是有價值的。**要加的是「標籤」而不是「資料夾」**（見決策 B）。

### 決策 B：表情／動作圖要不要**語意標籤**？

**現況**：只靠檔名，沒有任何語意。面板只會照檔名排序。

**這會擋住什麼**：未來如果要「依台詞情緒自動換圖」，程式必須知道哪張圖是「生氣」。只靠檔名猜（`生氣.png`）在中文之外的命名會全滅。

**SillyTavern 的實測結果**（這改變了判斷，見下）：

- **它沒有任何 manifest**。整個表情系統靠一行正則從檔名推斷：
  `^(.+?)(?:[-\.].*?)?$` → `joy.png`、`joy-1.png`、`joy.expressive.png` **三個都**對應到標籤 `joy`。
- 推斷出來的標籤必須落在**一份固定清單**裡才會被看到：28 個硬編碼的 GoEmotions 標籤
  （`joy`/`anger`/`sadness`…），或分類器 API 給的清單，或使用者在 `settings.json`
  手動註冊的 `custom` 陣列。
- 自訂標籤的規則：**必須符合 `/^[a-z0-9-_]+$/`，而且不能以預設標籤開頭**（`joyful` 會被拒）。
- 因為 `-` 和 `.` 一定是分隔符且無法轉義，**標籤裡不可能含有它們**。

### ⚠️ 我先前判斷錯了，這裡修正

我先前的草案寫「選 (2)，不要 manifest」。**看到實作之後，這個判斷要修正**——因為我當時
不知道 ST 的推斷有兩個具體的破壞性後果：

1. **`微笑-1.png` 與 `微笑-2.png` 在我們的模型裡是兩張不同的圖，但在 ST 的模型裡是
   「同一個表情的兩個差分」。** 我們現在連「變體」的概念都沒有。
2. ST 最嚴重的毛病是**標籤集是英文寫死的**，所以 `喜悦.png` 存得進去卻**永遠選不到**。
   我們的設計**本來就沒有這個問題**（資料夾就是清單，中文檔名照樣顯示）。
   → 這代表我們的基準比我想的更接近 ST 的優點，而**不是**更落後。

**修正後的判斷**：

| 情境 | 建議 |
|---|---|
| 只是「顯示一組圖、挑一張當主圖」（**現況**） | **維持檔名 + 排序**。不要 manifest。 |
| 要能表達「這幾張是同一個表情的差分」 | 用**檔名約定**（例如 `微笑.1.png`／`微笑.2.png` 或 `微笑-1.png`），不要新檔案。 |
| 要放**每張圖的個別設定**（位移、縮放、疊圖層級、作者、來源） | **這時 manifest 才是對的**——檔名承載不了這些，而且這些確實需要第二份資料。 |
| 要「依情緒自動換圖」 | 需要**兩件事**：(1) 標籤、(2) 產生標籤的東西（分類器 → 要碰模型）。**只做 (1) 沒用**。 |

也就是說：**manifest 的正當理由是「每張圖有自己的屬性」，不是「我需要知道這張圖是什麼表情」。**
後者用標籤就夠，前者才需要檔案。而「每張圖有自己的屬性」在我們現在的範圍裡**根本還沒出現**。

### 決策 C：圖片的位元組**放在哪裡**？（最重要）

**現況**：圖片是使用者資料夾裡的普通檔案（`art/.../*.png`）。

**flizzywine 的做法**：交給 DSH 附件服務（`ctx.attachments`），用附件 id 引用，綁定正文版本。

| 面向 | 普通檔案（我們） | DSH 附件服務（他們） |
|---|---|---|
| 使用者看得到／手改／備份 | ✅ 檔案總管直接看 | ❌ 消失在 DSH 內部儲存 |
| 違反「一間酒館＝一個資料夾，帶走就好」 | 不會 | **會** |
| 啟動風險 | 零（只是檔案 I/O） | **要注入 `attachments` 服務** ← 違反硬規則 2 |
| 去重複（同圖多處引用） | 無 | 有（附件 id） |
| 與 DSH 訊息／模型請求整合 | 無 | 有（模型可以直接看圖） |

**我的判斷**：**維持普通檔案**，理由是硬規則 2 與第 4 條。而且要注意：`attachment` 不是內建服務，要注入它就得改 `inject`，那條「只依賴 webServer」的紅線會被跨過。**除非**未來要做「讓模型看這張圖」（那時圖片必須變成 DSH 理解的附件），否則不換。

> 附帶：我查過 `@deepseek-ai/dsh-attachment` 的介面——`saveImage` / `readImage` / `imageHostPath` 都存在，所以技術上做得到。這是**取捨**，不是能力問題。

### 決策 D（附帶）：清單效能

插圖加進來之後，`tavern.list` → 每間酒館 `summary()` → 遞迴數 `art/`；`character.list` → 每張卡 `describeEntityAssets()` → `readdir` ＋ `readSettings`（我已經在同一次列舉中把 settings 讀一次共用）。

**目前規模（幾十張圖）完全沒問題，但這是 O(N) 的**。如果一間酒館有幾百張圖，展開酒館街時會慢。

**判斷**：**先不做快取**。理由是任何索引／快取都會製造「第二份真相」，而我們現在的效能還離痛點很遠。**但要在 UI 上誠實**：如果之後真的慢，先做的是「清單只回主圖，縮圖按需載入」（我們已經有 `loading="lazy"`），而不是建索引檔。

---

## 6. 建議的優先序（不含實作）

| 順位 | 事情 | 為什麼是這個順位 |
|---|---|---|
| **P1** | **原子寫入**（temp file + rename，用在 `tavern.json`、卡片、世界書） | **新發現，而且可能是最便宜的一條**。ST 幾乎所有寫入都走 `write-file-atomic`。我們現在是裸的 `writeFile`——斷電／當機剛好落在寫入中間，**使用者的卡就變成半個檔案**。這是一行級的修改，卻是我們目前最實在的資料安全漏洞。（注意：我們的 `createRoom` 已經用 `mkdir`（不帶 `recursive`）當獨佔鎖，那是對的，保留。） |
| **P1** | **表情標籤（決策 B），只在真的要做自動換圖時** | 唯一會影響「未來能力」的結構性決定；但現在不急。**已修正**：manifest 的正當理由是「每張圖有自己的屬性」，不是「知道這是什麼表情」。 |
| **P2** | **原版／工作版分離**（匯入的卡先無損留存原始位元組） | 這是**資料安全**，不是功能。我們現在直接重寫使用者的卡檔，這是目前最大的「理論上會弄壞使用者的東西」的風險點 |
| **P2** | **`guard()` 式迴圈位址圍籬**（見 §4） | 成本極低、防一整類問題；`tavern.add`／`assets.write`／`assets.delete` 都是會動檔案的動作 |
| **P3** | **PNG 卡匯入**（tEXt `chara`/`ccv3`，**只做讀**） | 最大的**相容性**缺口；兩個參考專案都只做單向，所以不用做匯出 |
| **P3** | **匯出**（單卡／整間酒館） | ST 的匯出只有 `png` 與 `json` 兩種；它有 `.charx` **讀**卻沒有 `.charx` 寫。我們只要做自己格式的匯出就夠。 |
| **P4** | **產物新鮮度檢查**（借 flizzywine 的 `check:client` 思路） | 防止「改了原始碼忘了同步產物」這種我們已經很脆的流程 |
| — | 快照／journal、附件服務、雙 Agent、鎖版本、localStorage 儲存 | **不做**。理由各自見上。 |

### 還有一件關於「備份」的觀察

ST 的備份**只做對話**（`<user>/backups/chat_<key>_<時間>.jsonl`，保留 50 份，
而且非 ASCII 名字要加 sha256 尾綴才不會撞在一起——**這正好證明它的檔名正規化是有損的**）。
**世界書完全沒有備份**：`/api/worldinfo/delete` 就是一個裸的 `fs.unlinkSync`。

所以「抄 ST 的備份」的意思是：**抄它的原子寫入，但不要抄它的備份範圍**。

順帶一提，ST 的**刪除哲學**跟我們一致：移除就是移除，使用者按了才刪。我們在
`character.delete`／`worldbook.delete`／`assets.delete` 上也是這樣（明確實體的刪除，
而不是背景自動清理）。**保持一致，不要引入「自動清理孤兒檔案」這種東西。**

### 而且 ST 在「撞名」這件事上有**三套不同的哲學**

這是研究最後挖出來的，值得單獨記一筆：

| 動作 | ST 的行為 |
|---|---|
| 儲存對話（`/api/chats/save`） | **直接覆蓋**（last-write-wins），唯一的保護是 `chat_metadata.integrity` 比對 |
| 對話改名（`/api/chats/rename`） | 目標存在就 **400 硬失敗** |
| 匯入卡片 | **自動編號**（`Name1.png`、`Name2.png`） |

同一件事（同名檔案）在三條路徑上有三種答案，而且**最危險的那條（儲存）是覆蓋**。

**對我們的意義**：我們目前是**一致地走「不覆蓋」**——
`createRoom` 用 `mkdir`（不帶 `recursive`）當獨佔鎖（撞到就換一個 id）、
`writeAsset` 撞名自動編號（`微笑.png` → `微笑-2.png`）、
卡片／世界書是「使用者明確給了 id 才寫那個檔」。

也就是說，在這一條上**我們比 ST 一致**。這是我們的資產，不要為了「像 ST」而引入覆蓋行為。

**但這裡有一個 ST 做得比我們好的地方**：它的 `integrity` slug。
存檔時如果記憶體裡的對話帶 integrity、而磁碟上的第一行不一樣，它會**拒絕寫入並回 400**——
這是防「另一個程序偷偷改過這個檔案」。我們完全沒有這一層：我們是無狀態地讀寫，
所以「這個檔在我開啟之後被別人改過」我們不會知道。

**但我不建議現在做**。理由：我們不持有對話權威、也沒有背景寫入，
所以「靜默覆蓋掉別人的修改」要發生，得靠**使用者同時在別的編輯器開著同一個檔**。
列為觀察項就好。

**而它的 UX 那半值得抄**：integrity 不符時，伺服器回 400，前端**不接受單純的「是／否」**——
要使用者在彈窗裡**手打 `OVERWRITE` 這七個字母**才會繼續。
如果我們哪天真的要做「覆蓋既有檔案」，**用打字確認，不要用是／否對話框**。
（我們現在根本不做覆蓋，所以這是一條備而未用的原則。）

### 遷移前先快照——這條正好佐證 P2

ST 雖然**沒有**例行備份卡片與世界書，但它**做格式遷移前一定會先快照**：
群組中介資料遷移先把原始檔複製到 `backups/_group_metadata_update/`，
舊資料目錄遷移先把 `public/worlds` 複製到 `backups/_migration/<日期>/` 才動手。

**這跟我們 P2 的「原版／工作版分離」是同一個原則**：
不是「定期備份」，而是「**在我要動你的東西之前，先留一份原樣的**」。
兩個獨立的參考都指向同一件事，這條判斷可以更有信心。

### 一個有利於我們的事實修正

我先前從研究員的初稿得到「它的 sanitizer 是有損的」的印象。**最終修正是**：
`sanitize-filename` **保留中日韓與 emoji**，對話的**檔名**是好的；
有損的只發生在**衍生的 key**（備份 key 把非 ASCII 壓成 `_`、CharX 資產正規化成 `[a-z0-9]`）。

所以 ST 的毛病不是「不能用中文檔名」，而是「**用中文檔名去當衍生 key**」。
這正是我們已經在做的事：**檔案用使用者給的名字（可以是中文），
內部識別用正規化過的 id**（我們的 `assetOwner` 就是這個分工）。
**繼續保持這個分工，不要把顯示名拿去當路徑或 key。**

### 一句話的判斷

三個參考專案裡，**最值得抄的是三個「小」東西**：

1. flizzywine 的**產物新鮮度檢查**；
2. dsh-portable-tavern 的**四項迴圈位址圍籬**；
3. **SillyTavern 的原子寫入**（`write-file-atomic` 那條習慣）——這是**新加入的 P1**，
   因為我們現在是裸的 `writeFile`，斷電會讓使用者的卡變成半個檔案。

以及一個**判斷**：flizzywine 的**原版／工作版分離**是我們目前唯一真正的資料安全缺口。

反過來，最不該被說服的是**儲存模型**。兩個參考專案各自走向「固定資料根＋附件服務」與
「完全沒有檔案」，而我們的「使用者選的資料夾、一項一處、純檔案」在
**可攜性、可手改、可備份、長期安全**上仍然是最好的——代價只是「要選一次資料夾」。
這個代價換來的東西，值得守住。

而且研究過程中出現了兩次「**我們其實做對了，只是不知道**」：

| 我們的選擇 | 參考專案的對照 | 結論 |
|---|---|---|
| 資料夾即清單、中文檔名照樣顯示 | ST 的標籤必須是 `[a-z0-9-_]+` 且落在 28 個英文標籤裡，**`喜悦.png` 存得進去卻永遠選不到** | 我們的基準比想像中好 |
| JSON 卡 + 分開的圖 | ST 的 PNG 是**儲存**格式，每存一次卡要重寫整張圖 | 我們的方向是對的，PNG 只做匯入 |

---

## 7. 附錄：已經自己查證過的 SillyTavern 事實

（這一節只放**親自讀過原始碼**的部分。世界書／對話的完整欄位清單在下一節。）

### PNG 卡的內嵌格式

來源：`src/character-card-parser.js`（伺服器端）。

```
PNG 檔
├── IHDR
├── tEXt  keyword = "chara"  →  base64( UTF-8 JSON )   ← V2
├── tEXt  keyword = "ccv3"   →  base64( UTF-8 JSON )   ← V3
└── IEND
```

- **關鍵字不分大小寫**（它用 `.toLowerCase()` 比對）。
- **V3 優先**：`read()` 先找 `ccv3`，找不到才退回 `chara`。
- 解碼鏈是 **base64 → UTF-8 → JSON**。
- 寫入時它**兩個都寫**（v2 一份、把 v2 改成 `spec: 'chara_card_v3'` / `spec_version: '3.0'` 再寫一份），
  而且會**先移除舊的 `chara`/`ccv3` chunk** 再插在 `IEND` 之前。
- 兩個失敗案例會明確丟錯：沒有 tEXt chunk、有 tEXt 但沒有這兩個關鍵字。
- **它的 docstring 跟實作自相矛盾**（註解說不支援 `ccv3`，程式碼卻在寫它）。

**對我們的意義**：P3 的實作規格就是上面這些。但有一個**安全注意事項**：
它是用 `png-chunks-extract` 這個套件在走 chunk，我們**不能引入**（零執行期依賴）。
自己寫的話，**絕對不能相信 chunk 的長度欄位**——要檢查 `length` 是否超出檔案剩餘長度，
否則一個壞檔就能讓我們 allocate 一個巨大的 buffer 或無限迴圈。
（`ccv3` 可以在第一版就支援，因為它只是同一個 key 的另一個名字。）

### 表情（sprite）系統的形狀

來源：`public/scripts/extensions/expressions/index.js` ＋ `src/endpoints/sprites.js`。

- **沒有 manifest**。資料夾名＝角色名，檔名＝標籤，推斷用一行正則
  `^(.+?)(?:[-\.].*?)?$`：`joy.png`、`joy-1.png`、`joy.expressive.png` **都**對應標籤 `joy`。
- **28 個預設標籤**（GoEmotions）：`admiration, amusement, anger, annoyance, approval, caring,
  confusion, curiosity, desire, disappointment, disapproval, disgust, embarrassment, excitement,
  fear, gratitude, grief, joy, love, nervousness, optimism, pride, realization, relief, remorse,
  sadness, surprise, neutral`。
- 標籤必須落在（預設 ∪ 分類器 API ∪ 使用者 `custom`）裡，**否則那張圖永遠不會被選到**。
- 自訂標籤規則：`/^[a-z0-9-_]+$/`，且**不能以預設標籤開頭**（`joyful` 被拒）。
- 同標籤多張圖時：完全符合標籤的那張是 `type:'success'`（主），其餘 `type:'additional'`；
  `allowMultiple` 開啟時**執行期隨機挑一張**，`rerollIfSame` 排除目前顯示的那張。
- **fallback 鏈**：查標籤 → 沒圖就用 `fallback_expression`（預設 `joy`）再查一次 → 都沒有就
  `#none`（空 src）或 `#emoji`（用 `/img/default-expressions/<label>.png` 這 28 張內建圖）。
- 上傳：`POST /api/sprites/upload`（同名**去副檔名比對**後 unlink 再寫）、
  `POST /api/sprites/upload-zip`（只收 `image/*`、跳過 `__MACOSX`）。
  **沒有尺寸或格式限制**，multer 只設了 `fieldSize: 500MB`（**沒有 fileSize 上限**）。
- 執行期：每 2 秒的 interval worker → 分類最後一則訊息 → 換圖。

### 這個附錄改變了什麼

**在 ST 裡面，語意來自「標籤集 ＋ 分類器」，不是來自檔名。** 檔名只是「這個標籤的圖在哪」。

所以我們如果哪天要做「依情緒換圖」，正確的形狀是**兩件事**：
(1) 圖要有標籤；(2) 要有東西產生標籤（分類器 → 要碰模型，**不在我們的範圍**）。
**只做 (1) 不做 (2) 仍然有價值**（使用者能手動選、UI 能按情緒分組），
但不要假裝「有標籤就等於能自動換圖」。

### 一個順帶的觀察：SillyTavern 自己怎麼防 CSRF

`public/script.js`：啟動時 `fetch('/csrf-token')` 拿 token，之後所有請求帶
`X-CSRF-Token` 標頭（`getRequestHeaders()` 與 `$.ajaxPrefilter` 都掛了）。
**它認為這件事必須做**——這是 §4 那條圍籬建議的旁證。

---

## 8. 附錄：SillyTavern 的完整資料佈局（研究員實測）

### 資料夾

資料根 `./data`；**共用**：`_storage/`（帳號）、`_uploads/`（暫存）、`_errors/`、`_css/`、
`cookie-secret.txt`、`content.log`。**每個使用者** `data/<handle>/`（預設 `default-user`）：

```
thumbnails{,/bg,/avatar,/persona}   worlds          user
User Avatars                        user/images     groups
group chats                         chats           characters
backgrounds                         NovelAI Settings  KoboldAI Settings
OpenAI Settings                     TextGen Settings  themes
movingUI                            extensions      instruct
context                             QuickReplies    assets
user/workflows                      user/files      vectors
backups                             sysprompt       reasoning
```

（注意有**空格與大小寫**混雜的資料夾名，例如 `User Avatars`、`group chats`——這是它的歷史包袱。）
根目錄檔案：`settings.json`、`secrets.json`、`stats.json`、`image-metadata.json`。

**`characters/` 被三重使用**：PNG 卡、sprite 資料夾、以及每個角色的 `backgrounds/` 子資料夾。
這是它最混亂的一處。

### 對話 `.jsonl`

- 路徑 `chats/<avatar 去掉 .png>/<檔名>.jsonl`；群組 `group chats/<chatId>.jsonl`。
- **標頭行**：`{chat_metadata, user_name, character_name}`（匯入器實際寫 `'unused'`）。
  `chat_metadata` 慣例上帶 `custom_background`、`chat_backgrounds`、`note_prompt`、
  `timestamps`、`world_info`、`persona`、`model`、`fav`、`integrity`。
- **訊息行**：`{name, is_user, is_system, send_date, mes, swipes[], swipe_id, swipe_info[], extra{}}`；
  `extra` 帶 `api`、`model`、`token_count`、`reasoning`、`display_text`、`media[]`、
  `media_index`、`inline_image`、`files[]`。群組行多 `original_avatar`/`force_avatar`。
- 檔名 `${characterName} - ${humanizedDateTime()}.jsonl`（`YYYY-MM-DD@HHhMMmSSsMSms`）。
- **改名撞名會硬失敗**（回 400），不是自動編號。**卡片的檔名撞名則自動編號**（`Name1.png`）
  ——同一件事在兩個地方有兩種哲學。
- **完整性檢查**：存檔時若 `chat_metadata.integrity` 存在，會重讀磁碟第一行比對，
  不一致回 400 `{error:'integrity'}`；第一行無法解析就視為損壞，**要求明確覆蓋**。
  最後一行被截斷則降級成 stat 資訊，而不是讓整份對話消失。
- 備份 `<user>/backups/chat_<key>_<時間>.jsonl`，保留 50 份；`key` 是去掉非 ASCII 的名字，
  **含非 ASCII 時要加 8 位 sha256 尾綴**（issue #5780）才不會讓中日韓名字共用同一份配額。

### 世界書

- 檔案 `worlds/<name>.json`；`/import` 與 `/edit` 會檢查物件有沒有 `entries`，沒有就 400。
- 原生形狀：`{"entries": {"0": {…}, "1": {…}}}`——**以字串化 uid 為 key 的物件**，
  裡面再重複一次 `uid`。
- 條目欄位（實際 shipped 的 `Eldoria.json`）：`uid, key[], keysecondary[], comment, content,
  constant, selective, order, position, disable, displayIndex, addMemo, group, groupOverride,
  groupWeight, sticky, cooldown, delay, probability, depth, useProbability, role, vectorized,
  excludeRecursion, preventRecursion, delayUntilRecursion, scanDepth, caseSensitive,
  matchWholeWords, useGroupScoring, automationId`（**大小寫不一致，是它真實的歷史包袱**）。
- **卡內嵌的 `character_book` 是另一種方言**（V2 規格）：`entries` 是**陣列**，
  欄位叫 `keys`／`insertion_order`／`enabled`，需要轉換才能變原生形狀。
- **世界書完全沒有備份**：`/api/worldinfo/delete` 就是裸的 `fs.unlinkSync`；
  壞檔在 `/list` 會被跳過並警告，在 `/get` 則是直接 500。

### 資料安全

- 幾乎所有寫入都走 **`write-file-atomic`**（temp file + rename）。例外是 multer 上傳。
- 啟動時有一串遷移：`migrateUserData`、`migrateSystemPrompts`、
  `migrateGroupChatsMetadataFormat`、`migrateFlatSecrets`、`cleanUploads`、`diskCache.verify`…
- 損壞政策是「**降級，不要崩**」：世界書 `/list` 逐檔 try/catch；對話列表跳過壞檔；
  壞掉的第一行**擋住靜默覆蓋**。
- 路徑安全到處都是：`sanitize-filename` ＋ `isPathUnderParent` ＋ `validateFileName.js`
  中介層 ＋ `UNSAFE_EXTENSIONS` 黑名單。

