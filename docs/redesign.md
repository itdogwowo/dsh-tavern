# 重新設計：功能與分區

> 狀態：**討論稿，決策陸續定案中**。這一份只談「有什麼功能、怎麼分區」，**不談 UI 長相**。
> UI 等分區定案之後再畫。
> §8 是真聊天的研究附錄（已查證 DSH 原始碼），**它有幾條硬事實會約束所有後續設計**。
> 撰寫時間：2026-09-17

---

## 0. 為什麼要重來

不是「想換個樣子」，是現在的分區有幾個具體的毛病。先用一張圖看清楚現在長什麼樣：

```
側邊欄
└ 酒館街                                    ← 只有「酒館」這一層
   └ tavern   [⋯ 設定] [＋ 新對話]
      └ （對話清單，展開時）

main:tavern（按 ⋯ 進來的那一頁）＝ 一頁到底
├ 🏠 這間酒館
│   ├ 統計 4 格（人物卡／世界書／對話／插圖）
│   ├ 資料夾結構說明（一段文字）
│   ├ 店面圖上傳區
│   ├ 名稱 + 重新命名 + 從酒館街移除
│   ├ 圖示 12 顆
│   └ 備註
├ 🎭 人物卡     （清單 ＋ 欄位表單 ＋ 插圖集）
├ 📖 世界書     （清單 ＋ 原始 JSON textarea ＋ 插圖集）
└ 💬 對話紀錄   （清單 ＋ 新對話）

main:tavern-chats（點一份對話進來）＝ 佔位頁 ＋ 房間插圖
DSH 設定 → 插件 → 酒館（TavernSettingsCard）
```

### 五個具體問題

1. **「設定」這兩個字指的是兩個地方。** 一個是 DSH 的「設定 → 插件 → 酒館」卡片，
   一個是側邊欄 ⋯ 進去的那一頁。你自己就誤會過一次——以為我要你看的是 DSH 設定，
   結果你指的是 ⋯ 那一頁。
2. **⋯ 的期待是「設定」，但那一頁 80% 是內容管理。** 名稱／圖示／備註／移除是「設定」，
   人物卡／世界書／對話是「內容」。兩種不同性質的東西疊在同一頁。
3. **一頁到底會失控。** 現在人物卡和世界書各自「清單 ＋ 編輯器 ＋ 插圖集」三段式疊在頁面裡。
   三張卡還行，三十張卡就是一場捲動災難——尤其插圖集本身還會長高。
4. **插圖是附屬品，但挑圖是一個獨立的工作。** 一個角色可能有幾十張表情／動作圖，
   「看圖、挑主圖、刪圖」的體驗不會比「改 description 欄位」不重要，
   不該永遠縮在編輯器最下面。
5. **對話還不是一個地方。** 它現在是檔案清單。有房間插圖的掛載點，但整體沒有「包廂」的感覺。

---

## 1. 功能盤點

分四類：**收藏**（把東西放進來）、**整理**（把東西改對）、**使用**（拿東西來做什麼）、**診斷**。

### 1.1 收藏

| 功能 | 現況 | 掛在哪個物件 |
|---|---|---|
| 新增酒館（選一個資料夾） | ✅ | 酒館 |
| 匯入人物卡（PNG 內嵌 `chara`/`ccv3`、或 JSON） | ✅ | 人物卡 |
| 匯入世界書（JSON，原樣寫入不轉欄位） | ✅ | 世界書 |
| 上傳插圖（單張／多張／拖放） | ✅ | 四種實體 |
| 從別間酒館帶一份內容過來 | ❌ | — |

### 1.2 整理

| 功能 | 現況 | 備註 |
|---|---|---|
| 改酒館名稱／圖示／備註 | ✅ | |
| 改人物卡 8 個標準欄位 | ✅ | name / description / personality / scenario / first_mes / mes_example / system_prompt / post_history_instructions |
| 改人物卡的**原始 JSON**（未知欄位） | ❌ | 世界書有這條路，卡片沒有 |
| 改世界書 | ⚠️ **半套** | 只有一整塊原始 JSON textarea。看得到、改得動，但條目一多就沒救 |
| 逐條編輯世界書條目（key／content／啟用） | ❌ | 一本書 50 條時的唯一解法 |
| 指定主圖 | ✅ | |
| 刪除人物卡／世界書／插圖 | ✅ | |
| **刪除對話** | ❌ | **`chat.delete` 這個 op 根本不存在**——開了一份就刪不掉 |

### 1.3 使用

| 功能 | 現況 | 備註 |
|---|---|---|
| 開一份新對話 | ✅ | 只建立檔案（SillyTavern 格式的 `.jsonl` ＋ 標頭行） |
| **刪除一份對話** | ❌ | **`chat.delete` 這個 op 根本不存在**——開了一份就刪不掉 |
| 讀一份對話的內容 | ❌ | 現在的對話頁明說「要讀內容就用任何文字編輯器開它」 |
| **真的在裡面聊天** | ❌ | 技術上做得到，但**只有一條路**（DSH 的 session），見 §5 決策 1 與 §8 |
| 挑世界書掛進對話 | ❌ | |
| 使用者自己的人設（persona） | ❌ | 角色卡裡 `{{user}}` 目前沒有東西填 |
| 匯出（單卡／整間酒館） | ❌ | |

### 1.4 診斷

| 功能 | 現況 |
|---|---|
| 統計（人物卡／世界書／對話／插圖） | ✅ |
| 重新讀取（手動丟檔進資料夾之後） | ✅ |
| 版本標記（host／client） | ✅ 有，但只有 DSH 設定卡片看得到 |

---

## 2. 分區原則

後面「什麼放哪裡」都用這五條判斷。有爭議時回來看這一節。

| # | 原則 | 意思 |
|---|---|---|
| **P1** | **一個分區＝一個問題** | 進去一眼就知道「我來這裡是要幹嘛」。答不出來就是分錯了 |
| **P2** | **一種東西只有一個家** | 人物卡只在「卡司」，世界書只在「藏書」。**不要為了方便在兩處都放一份**（兩份就會不同步） |
| **P3** | **身分／內容／操作分開** | 「這間酒館叫什麼」是身分，「裡面有誰」是內容，「怎麼重新讀取」是操作。三種性質不同 |
| **P4** | **罕用的收起來** | 資料夾路徑、build 標記、移除酒館——一年用不到幾次，不該站在第一排 |
| **P5** | **隱喻要一致** | 已經用了酒館街／店面／包廂。新分區沿用同一套，不要中英混雜或忽然變成技術名詞 |

---

## 3. 分區

### 3.1 側邊欄（酒館街）——**維持現在的樣子**

```
酒館街                                    [＋]
├ tavern                        [⋯]  [＋ 新對話]
│  └ （展開時）最近的對話…
└ 另一間酒館 …
```

側邊欄**不加分區這一層**。它只做兩件事：**選酒館**、**進酒館**。

**為什麼（決策 3 已定案）**：側邊欄上半部是 DSH 原生工作區清單，下半部才是酒館街，
兩者共用一個高度。在這麼窄的地方再塞一棵「酒館 → 四個分區 → 對話」的樹，
會讓整條側邊欄變成一棵四層的樹，操作反而更難。使用者原話：

> 「第一個方案會讓畫面變得非常複雜，這裏沒有足夠的空間，人操作變得容易（困難）」

進入酒館的入口維持現在的 **⋯**。分區住在主面板**裡面**。

### 3.2 主面板：一間酒館＝一張面板，四個分區在裡面

```
main:tavern
┌────────────────────────────────────────────────┐
│ tavern · 設定                    [重新讀取]      │
├────────────────────────────────────────────────┤
│  🏠 大廳  │  💬 包廂  │  🎭 卡司  │  📖 藏書     │  ← 分區切換（我們自己的）
├────────────────────────────────────────────────┤
│                                                │
│              （選中的分區內容）                  │
│                                                │
└────────────────────────────────────────────────┘

main:tavern-chats  ← 從側邊欄點一份對話時走這個面板（跟現在一樣）
```

| 分區 | 一句話 | 進來要做的事 |
|---|---|---|
| **🏠 大廳** | 這間酒館是什麼、現在在幹嘛 | 看概況、改門面、跳去別區 |
| **💬 包廂** | 跟誰、在哪裡 | 開一份對話、看對話 |
| **🎭 卡司** | 這裡有誰 | 找一張卡、改它、換它的圖 |
| **📖 藏書** | 這個世界的設定 | 找一本書、改條目 |

**這代表什麼**：分區切換、清單、編輯器、對話畫面**全部是我們自己的程式**，
唯一的 DSH 接觸點是「側邊欄點 ⋯／點對話 → `layout.selectPanel(key)`」。
我們不再需要為每個分區宣告一個 DSH panel key，DSH 也不會知道酒館裡面有幾個分區。

好處不只是少耦合：**主面板以內我們完全自由**——一張卡可以用整頁編輯、對話可以整頁接管、
大廳可以做成儀表板，都不必再配合 DSH 的 panel 行為。

### 3.3 DSH 設定（插件層級，不是酒館層級）

| 位置 | 放什麼 |
|---|---|
| DSH 設定 → 插件 → 酒館 | 酒館街註冊表位置、目前選中的酒館、版本標記、`DSH_TAVERN_ALLOW_REMOTE` 說明 |

這一張卡片**只講插件自己的事**，不重複酒館的內容。

---

## 4. 每個分區的界線

### 🏠 大廳

| 放 | 不放 |
|---|---|
| 店面圖（＋它的插圖集） | 人物卡清單 |
| 名稱／圖示／備註 | 世界書清單 |
| 概況：四個數字 ＋ 最近的對話 | 對話內容 |
| 快速入口：開新對話、匯入卡片 | |
| **收合的「進階」**：資料夾位置、重新讀取、版本標記、**從酒館街移除** | |

判斷依據：P3（身分 vs 內容）＋ P4（罕用的收起來）。
「從酒館街移除」放進階，是因為它是**破壞性動作**——現在它跟「重新命名」並排，
兩顆按鈕長得一樣，間隔 6px。

### 💬 包廂

| 放 | 不放 |
|---|---|
| 對話清單（依角色分組、房間插圖縮圖、最後一則、時間） | 人物卡欄位編輯 |
| 開一份新對話（挑角色） | 世界書編輯 |
| 對話本體（開啟後） | |
| 房間插圖（一場景一組圖） | |
| **刪除對話** | |

這是**最需要補**的一區：現在連刪都刪不掉（§1.2）。

### 🎭 卡司

| 放 | 不放 |
|---|---|
| 海報牆（主圖 ＋ 名字，一頁看很多張） | 世界書清單 |
| 選一張之後：欄位表單 / 插圖集 / 內嵌世界書 / **原始 JSON** | 對話 |
| 新增／匯入／刪除／（未來）匯出 | |
| 插圖集（幾十張表情／動作圖的主場） | |

判斷依據：P1。**「找卡」跟「改卡」是兩件事**，海報牆與編輯器要能分開看。

### 📖 藏書

| 放 | 不放 |
|---|---|
| 世界書清單 | 人物卡 |
| 條目清單（key／內容摘要／啟用） | 對話 |
| 原始 JSON 模式（原樣保留，不轉欄位） | |
| 匯入／新增／刪除／插圖集 | |

判斷依據：P1。世界書現在是「一整塊 JSON」，那是**給程式看的**，不是給人編輯的。
但要注意：SillyTavern 的條目有 30 個欄位、而且大小寫不一致（見
[`design-comparison.md`](design-comparison.md) §8），所以條目編輯器**只能做常用欄位**，
其餘一律走原始 JSON。

---

## 5. 決策

### 決策 1：包廂要真的能聊天 ✅ 已定案（要真聊天）

使用者原話：

> 「包廂對話就是用來真聊天的，當然裡面可能會有一點小設定可以讓我設定」

所以「只管理檔案」出局。實際查過 DSH 之後，**只有一條路**（見 §8 附錄）：

```
我們（client 半）──ctx.remote.session──▶ DSH 的 Session ──▶ 模型
                      create / prompt / follow(逐字串流) / cancel
```

**沒有**「直接叫模型」的客戶端介面（`dsh-llm` 的客戶端面只有 3 個查詢方法，沒有生成）。
`session.prompt()` 也不是 completion，它只回 `{accepted:true}`——回覆要從
`session.follow({assistantStream:true})` 的 `{type:'text-delta', text}` 逐字收。

#### 剩下一個要選的：角色卡要當「系統提示」還是「使用者訊息」

DSH 的 session **沒有**「自帶 system prompt」這個欄位。只有兩條路：

| 路線 | 做法 | 得到什麼 | 代價 |
|---|---|---|---|
| **甲：卡片放使用者訊息** | 每次送出時把角色卡接在使用者訊息前面 | 零風險、不寫任何檔案 | 卡片是**使用者訊息**，不是 system prompt——模型比較容易不聽話，而且在 DSH 的原始對話裡看得到那一大坨卡片 |
| **乙：寫一個 persona preset** | 宿主半在 `~/.dsh/.agent-presets/dsh-tavern/` 寫一個 preset：只有一個 persona（＝角色卡）、`complete: true`、**沒有任何工具**，然後 `session.create({agentPreset:'dsh-tavern'})` | 卡片是**完整的 system prompt**；那個 session **沒有工具**（對角色扮演是好事） | 宿主半要寫檔（只寫 DSH home，**仍然不需要注入任何服務**）；每改一次卡會產生一個不會回收的 generation |

**乙的關鍵事實**：preset 只是磁碟上的檔案，而宿主半本來就有 `node:fs`——
所以「寫 preset」**不會**跨過「只依賴 `webServer`」那條紅線。這是目前唯一能拿到真 system prompt 的方法。

#### 三個必須接受的代價（甲、乙都一樣）

1. **酒館的對話會出現在你平常的 DSH session 清單裡。**
   已經查證：未註冊在任何 workspace 的 session 會落到側邊欄的「未分組」。
   可以用 `workspace.archiveSession({sessionId})` 把它藏起來——**預設就藏**。
2. **對話會有兩份。** DSH 的 session 儲存是權威，酒館資料夾裡的 `.jsonl` 是鏡像。
   這跟「一項一處」有衝突，但有一個乾淨的解法：
   SillyTavern 的對話檔**第一行本來就有一個自由欄位 `chat_metadata`**，
   我們把 `dsh_session_id` 記在那裡
   → **打開一份對話檔＝resume 那個 session**，檔案仍然是你帶著走的那一份，
   而且別人（別的軟體）讀這個檔完全不受影響。
3. **取樣參數目前設不了。** `session.selectModel()` 只吃 `{provider, model, reasoningEffort}`，
   沒有 temperature／top_p。所以「小設定」實際能給的是：
   **模型、世界書掛哪幾本、開場白要不要自動送、使用者人設**——不要承諾溫度。

**我的傾向**：先做**甲**，把**乙**當成一個開關（預設開或預設關由你決定）。
理由：甲不寫任何檔案、不可能弄壞別的東西；乙才是「像樣的角色扮演」，
但它要動 DSH home，而且不確定 `~/.dsh` 一定可寫。

### 決策 2：分幾個區 ✅ 已定案

**4 區**：`🏠 大廳` / `💬 包廂` / `🎭 卡司` / `📖 藏書`。

### 決策 3：導航放哪裡 ✅ 已定案

**側邊欄維持現在的樣子**（酒館列 ＋ ⋯ 進入 ＋ ＋ 新對話）；**四個分區住在主面板裡面**。

使用者原話：

> 「我不希望方案 A，我希望用 ⋯ 進入就像現在一樣。原因是第一個方案會讓畫面變得非常複雜，
> 這裏沒有足夠的空間，人操作變得（不）容易。」

側邊欄上半部是 DSH 原生工作區清單、下半部才是酒館街，兩者共用高度，
再塞一棵四層的樹會讓它更擠。詳見 §3.1。

### 決策 4：插圖要不要一個「全館」的入口？ ✅ 已定案

**不做。** 插圖只跟著它的主人（角色→插圖集、對話→房間圖、酒館→店面圖）。
大廳顯示總數，點數字跳去對應的實體。

---

## 6. 這份設計刻意不做的事

| 不做 | 為什麼 |
|---|---|
| 在啟動或每次請求時跟核心服務打交道 | v1 的死因。硬規則：宿主半只依賴 `webServer`，啟動時零請求 |
| **把 `remote.session` 寫進瀏覽器半的 `inject`** | **這一條最要緊**：DSH 的啟動核心會檢查每一個 client 插件是否 `active`，**`pending`（等不到服務）跟 throw 一樣致命**，而且檢查不過就**整個 GUI 不掛載**。寫進 `inject` ＝「哪天那個服務不在，整個 DSH 白屏」。改成**按送出時才 `ctx.get('remote.session')`**，拿不到就顯示「這台 DSH 沒有對話服務」 |
| 自己接模型（`ctx.llm.stream`） | 那是**宿主平面**的服務，不在客戶端可呼叫的清單裡。而且會跨過「只依賴 webServer」的紅線 |
| 加自訂的 `ctx.remote` namespace | 能力集在**建置時就固定**（要 `@deepseek-ai/dsh-typert-generator`，而它沒有隨 DSH 出貨）。第三方加不了 |
| 把圖片交給 DSH 附件服務 | 會跨過紅線；而且「一間酒館＝一個資料夾，帶走就好」會破功 |
| 快照／journal 的對話格式 | 對話的權威在 DSH session 那邊。我們是鏡像，鏡像不需要 revision |
| 承諾「溫度／top_p 可以調」 | 遠端介面只給 `{provider, model, reasoningEffort}`。做不到的就不要畫在 UI 上 |
| 世界書的 30 欄位全表單 | 格式太多種、欄位名大小寫不一致。常用欄位做表單，其餘走原始 JSON |
| 自動清理孤兒檔案 | 刪除一律是「使用者按了才刪」 |
| 依情緒自動換圖 | 需要分類器（要碰模型）。圖可以有標籤，但不要假裝有標籤就等於能自動換 |

---

## 7. 下一步

1. 決策 1 剩下的小選擇：角色卡走**甲**（使用者訊息）還是**乙**（persona preset）？
2. 定案之後補上每個分區的**內容清單**（哪一顆按鈕、哪一個欄位、什麼狀態）。
3. 再開始畫 UI（版面、間距、DSH 的深淺色變數）。

---

## 8. 附錄：真聊天的研究結果（已查證）

> 這一節是派人把 DSH 全部客戶端 API 翻過一遍之後的結果。每一條都指得出檔案與行號，
> 沒查到的也照實寫「沒查到」。**這是決策 1 的事實基礎，不要憑印象改。**

### 8.1 沒有「直接叫模型」的客戶端介面

- 客戶端可呼叫的全部能力＝**15 個 contribution → 19 個 namespace → 84 個方法**，其中沒有任何生成方法。
- `@deepseek-ai/dsh-llm` 的客戶端面只有 **3 個查詢方法**：
  `discoverModels` / `listConfigurableProviders` / `listProviders`
  （`dsh-llm/lib/typert.remote-client.d.ts:9-21`）。
- ⚠️ **陷阱**：`dsh-llm/README.md` 裡有一段 `ctx.llm.stream({provider, model, messages})` 的
  `for await` 範例。那是**宿主平面**的服務（`ctx.llm`），在 `typert.host.js` 裡
  **沒有 `@Remote` 標記、也不在 `TYPERT.invocations` 裡**，過不了橋。
  照著那段文件寫會編譯得過、執行時拿不到。

### 8.2 唯一的入口是 Session

```ts
session.create ({ workspaceId? | cwd?, sessionId?, agentPreset? }) → { sessionId }
session.prompt ({ requestId, sessionId, mode:'queue'|'steer', content })  → { accepted: true }
session.follow ({ address:{kind:'session',sessionId}, assistantStream:true }) ← 逐字串流
session.cancel ({ sessionId }) → { accepted: true }
session.selectModel ({ sessionId, provider, model, reasoningEffort? })
session.modelCatalog()
```

- `prompt` **不是** completion，只回 `{accepted:true}`。回覆要從 `follow` 收。
- 串流是真逐字：`{type:'assistant-stream', frame}` 裡 `frame.chunk` 是原始的 `StreamChunk`
  （`{type:'text-delta', index, text}`），`frame.outcome.kind==='committed'` 代表這輪結束。
- **`cwd` 一定會有**：`workspaceId` 與 `cwd` 只能給一個（兩個都給＝`gateway/bad-request`），
  都不給就退回 DSH 行程的 `process.cwd()`，然後 `mkdir` 它、寫進 session meta。
  所以「沒有 cwd 的 session」不存在。
- **沒有 system prompt 欄位**。唯一的槓桿是 `agentPreset`。
- **preset 只能複製不能編輯**：`agentPresets` 只有 `copy/deletePreset/list/read/select`，
  呼叫端不能提供內容。設定裡也沒有系統提示的編輯 API
  （`dsh-system-prompt/README.md:172` 明講沒有）。
- **但 preset 就是磁碟上的檔案**：`<dshHome>/.agent-presets/`（使用者層，
  已確認存在且是空的），沒有 watcher，每次讀都真的讀檔案。
  `includeUserRoot` 預設為 true。所以宿主半可以用 `node:fs` 直接寫進去——
  **這不需要注入任何 ctx 服務**。
- **工具的數量＝preset 的組成的**，沒有 per-session 的工具限制介面。
  一個只有 persona 一列的 preset 就是「沒有工具」的 agent
  （出貨的 `minimal` preset 就是這個形狀）。

### 8.3 會污染使用者的 DSH 清單

`session.list` 會回傳所有活著的 session 加上有 cwd 的冷 session，而 GUI 的側邊欄就是打這個。
沒有註冊在任何 workspace 的 session 會落到「未分組」那一組。
→ **預設用 `workspace.archiveSession({sessionId})` 把它藏起來。**

### 8.4 我們不需要宣告任何東西

`ctx.remote.session` 在每個 web 部署裡都已經掛好了
（`dsh-base/cordis.patch.yml:45-46` 掛 gateway，`dsh-web-app/cordis.patch.yml:195-196` 掛 api-remotes，
後者的 client `apply()` 掛上 15 個 contribution）。
`package.json` 的 `dsh.client.inject` **只是資訊性的，不是 Cordis 服務注入**
（`dsh-package-manifest/lib/types/types.d.ts:43`）。
真正的閘門是 client bundle 匯出的 `inject` 陣列——我們現在是 `['slots']`，
**保持不動**，用 `ctx.get('remote.session')` 在按下送出時才拿。

### 8.5 ⚠️ 最重要的一條：客戶端插件掛不起來＝整個 GUI 白屏

- **對的一半**：客戶端半的錯誤**不會**讓 Node 宿主開不起來（宿主只 `readFileSync` bundle 的位元組，從不 eval）。
- **錯的一半（而且是要命的那一半）**：出貨的啟動核心裡有這段（節錄自
  `dsh-web-frontend/dist/assets/index-BKQ_L1z6.js`）：

  ```js
  assertEntriesActive(t){
    // 逐個 roster entry 檢查 fiber.state
    //   'pending'（等服務）與 throw 一樣被推進 r 陣列
    if (r.length > 0) throw new Error(`web boot: ${r.length} entries did not activate\n...`)
  }
  ```

  而 `mountApp(ctx)`（掛 React 應用）**只在 `runPluginBoot` 通過之後**才會被呼叫。
  也就是說：語法錯、頂層 throw、`require` 解析不到、require cycle、
  **或等不到某個服務**——任何一種都是**整個 GUI 打不開**，不是「酒館壞掉」。
- 唯一的隔離是**渲染期、逐座位**的 `SlotErrorBoundary`（我們已經在用 `slots.onEntryError`）。
- **結論**：`inject` 陣列是危險的，`ctx.get()` 是安全的。
  這一條不只約束酒館，它約束這個插件的**每一個**客戶端功能。

---

## 9. 附錄：原版酒館（SillyTavern）實際怎麼組提示詞

> 讀的是 `SillyTavern/SillyTavern` 的 `release` 分支，`06bde939`（2026-09-14）。
> 主要檔案：`public/scripts/openai.js`（7397 行）、`world-info.js`、`PromptManager.js`。
> 這一節的目的是**照抄它的順序**，而不是自己發明一套。

### 9.1 它送出去的訊息，依序是這 12 塊

| # | 區塊 | 角色 | 內容來自 |
|---|---|---|---|
| 1 | `main` | system | 全域主提示。預設是 `Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.`。**卡片有 `system_prompt` 就整段取代它**（預設開啟） |
| 2 | `worldInfoBefore` | system | 世界書裡 `position: 0`（before）的條目 |
| 3 | `personaDescription` | system | **使用者自己的設定** |
| 4 | `charDescription` | system | 卡片的 `description`。**原文照送，沒有加任何標題或包裝** |
| 5 | `charPersonality` | system | 卡片的 `personality` |
| 6 | `scenario` | system | 卡片的 `scenario` |
| 7 | `enhanceDefinitions` | system | 一段固定文字（**預設關閉**） |
| 8 | `nsfw` | system | 預設空的 |
| 9 | `worldInfoAfter` | system | 世界書裡 `position: 1`（after）的條目 |
| 10 | `dialogueExamples` | system | 卡片的 `mes_example`。切成 `<START>` 區塊，每行變成一條 system 訊息，`name` 是 `example_user` / `example_assistant`，前面再插一條 `[Example Chat]` |
| 11 | `chatHistory` | user / assistant / system | 真正的對話。最上面有一條 `[Start a new Chat]` |
| 12 | `jailbreak` | system | 卡片的 `post_history_instructions`（有就取代） |

`first_mes` **不在這張表裡**——它就是歷史的第 0 則訊息，跟著 `chatHistory` 進去。

### 9.2 第一個意外：它不是「一大包系統提示」，是**十幾條 system 訊息**

我原本以為 ST 會把角色卡拼成一大段字串塞進 system prompt。**不是。**
它把每一個欄位拆成**各自的 system 訊息**，中間夾著世界書、使用者設定、範例對話。

這件事重要，因為它代表「角色卡是設定」在 ST 裡是**名副其實**的——模型的每一段前文都是 system 角色。

### 9.3 第二個關鍵：哪些固定、哪些每輪重算

| 整場對話固定 | 每一輪都要重算 |
|---|---|
| 卡片的 `description` / `personality` / `scenario` / `mes_example` | **世界書**（掃描最新訊息決定哪些條目要出現） |
| 卡片的 `system_prompt`（＝主提示） | **Author's Note**（依 `note_interval` 決定這一輪要不要出現） |
| 卡片的 `post_history_instructions` | **對話歷史視窗**（爆預算就從最舊的開始丟） |
| 使用者人設的**內容** | 使用者人設的**位置**（可以設成插在對話深處） |
| `[Start a new Chat]` 那段 | `send_if_empty`（最後一則是 assistant 時補一則 user） |

**世界書是最複雜的一塊**：它不只有一個位置，而是散在**三個地方**——
`worldInfoBefore` / `worldInfoAfter` 兩塊 system 訊息、**插在對話歷史某個深度**的訊息、
以及**改寫 Author's Note 的文字**。它還有 8 種 `position`（before / after / AN 上 / AN 下 /
對話中第 N 層 / 範例對話開頭 / 範例對話結尾 / outlet），加上遞迴（一個條目的內容可以觸發下一個）。

### 9.4 我們的對照表（誠實版）

DSH 的 session 給我們的只有兩個槓桿：**開 session 時固定的 system prompt**（preset 的
`prefix` / `suffix`）和**每一輪的使用者訊息**（`session.prompt` 只吃使用者訊息）。
沒有「插入一條 system 訊息到第 N 層」這種事。所以：

| ST 的區塊 | 我們 | 保真度 |
|---|---|---|
| 1 `main` ＋ 4/5/6 卡片三欄 ＋ 10 範例對話 | preset 的 **prefix** | ✅ 完整 |
| 3 使用者人設 | preset 的 **prefix 或 suffix** | ✅ 完整 |
| 12 `post_history_instructions` | preset 的 **suffix** | ⚠️ **它進不了「歷史之後」**，只會在系統提示裡（ST 是接在整段歷史後面） |
| 2 `worldInfoBefore` | 接在**使用者訊息前面** | ⚠️ 只剩一種位置（ST 有 8 種） |
| 9 `worldInfoAfter` | 同上，只能併在同一段 | ⚠️ 分不出前後 |
| 深度插入 / Author's Note | 同上 | ❌ 做不到「插在第 N 層」 |
| 11 `chatHistory` | DSH session 自己管 | ✅ 完整（但 token 預算由 DSH 決定，不是我們） |

### 9.5 還有三個要先講清楚的代價

1. **世界書只有一種插入位置。** ST 的 `position` 有 8 種、還能插進對話第 N 層。
   我們全部只能接在使用者訊息前面。**這對「名詞解釋型」的世界書夠用，
   對「要用 depth 控制注入強度」的進階用法不夠。**
2. **改了角色卡，已經開著的對話不會跟著變。** preset 是**開 session 時**讀的，
   而 DSH 說「改寫 preset 會產生新版本，已經跑著的 session 用它自己那份」。
   ST 是每一輪重讀卡片。所以我們的模型行為是：**改完卡片要新開一份對話才生效。**
3. **每個角色卡要一個 preset 檔。** preset 是磁碟上的靜態檔案，卡片內容不一樣就得各寫一份。
   改卡片才重建（不是每輪），但改很多次卡片會留下不會回收的舊版本，直到 DSH 重啟。

### 9.6 所以結論

**原版酒館做的其實就是「乙」**——卡片是設定（system），世界書是每輪算的動態內容。
我們沒有自己的模型連線，所以只能靠 preset 把「設定」那半放到對的位置。

**但這件事有一個前提要先驗證**：一個「只有 persona 一列、沒有任何工具」的 preset，
在 DSH 上真的開得起來、而且真的沒有工具嗎？
研究是從 preset 的組裝規則推出來的（出貨的 `minimal` 是「persona ＋ 一個 shell」），
**沒有實測過「一個工具都不掛」**。

→ **第一步應該是一個很小的實驗**：寫一個只有 persona 的 preset、開一個 session、
問它「你是誰、你能做什麼」，然後看它是不是真的只認得那段 persona、而且一個工具都沒有。
這個實驗很小，但它決定整條路走不走得通。**驗完再談 UI。**

---

## 10. 角色卡怎麼變成身分（架構）

> ⚠️ 這一節在 2026-09-17 被**推翻並改寫過一次**。下面 10.2 保留被推翻的方案與理由，
> 因為它記錄了「為什麼不那樣做」——那個判斷以後還會有人想重走一遍。

### 10.1 定案：第三個「面」＋動態系統提示

**ds-tavern 拆成三個面**——這是「萬物皆插件」真正的好處：

| 面 | 在哪裡跑 | 注入 | 風險 |
|---|---|---|---|
| **宿主半** | `dsh web` 啟動時 | `webServer` | 高：在啟動路徑上，壞了 DSH 開不起來 |
| **瀏覽器半** | 瀏覽器 | `slots` | 中：掛不起來＝**整個 GUI 白屏**（§8.5） |
| **Agent 面**（新） | **只在 preset 裡面** | `systemPrompt`（將來 ＋ `tools`） | **低：不在啟動路徑上**，壞了只影響那個對話 |

Agent 面的工作：**每一次模型請求前，讀出「這個 session 是哪個角色」，把卡片全文當成系統提示交出去。**

```
~/.dsh/.agent-presets/dsh-tavern/agent.cordis.yml   ← 三行，裝插件時就放好，永遠不改寫
    - id: tavern-agent
      name: 'dsh-tavern/agent'

每一次模型請求（dsh-agent-loop 的 preStep）
  └─ 我們的 provider 被呼叫，收到 { agent }
       ├─ agent.session.id          → 查對照表，知道是哪個角色
       ├─ 讀 <酒館>/characters/<角色>.json
       └─ 回傳卡片全文 → 就是這個 session 的完整系統提示
```

**依據（都讀過原始碼）**：

| 事實 | 出處 |
|---|---|
| `PromptSection.text` 可以是 `(context) => string`，**每次組裝時才呼叫** | `dsh-system-prompt/lib/types/index.d.ts:60`；實作 `lib/index.js:336-343` |
| provider 收到的是**活的 Agent** | `dsh-agent/lib/types/runtime-types.d.ts:14-19`；`lib/index.js:258-264` `assembleContextFor()` |
| 組裝發生在**每一個模型步驟之前**（`preStep`） | `dsh-agent-loop/lib/index.js:890` |
| 一級公民範例：`dsh-sandbox-policy` 就是這樣讀 `context.agent?.session` 的 | `dsh-sandbox-policy/lib/index.js:121-130` |
| `complete: true` 會讓那一段成為**唯一的**系統提示（harness 身分、部署 persona、工具說明全部消失） | `dsh-system-prompt/lib/index.js:332-356` |
| preset 的一列是 agent 的**scope 祖先**，所以它的註冊對所有加入這個 preset 的 session 生效 | `dsh-agent-presets/lib/index.js:1778-1789`、`dsh-scope/lib/index.js:327-338` |

**這個架構解掉的問題**：

| 原本 | 現在 |
|---|---|
| 每個角色一個 preset 檔 | **一個**，永遠不改寫 |
| 改寫 preset → 世代不回收、洩漏 | **從不改寫** |
| 模式選單被灌爆 | **只有一個「酒館模式」**——而且那是功能不是雜訊 |
| 改卡片要新開對話 | **改完下一輪就生效**（跟 SillyTavern 一樣） |
| 世界書只能塞使用者訊息 | 可用 `agent/pre-step` 替換進入的訊息（＝ST 的 depth 注入） |
| 溫度／top_p 設不了 | `agent/request` 回傳 `LlmCallConfig = {provider, model, reasoningEffort, temperature, maxTokens, stop}` → **可以設** |

### 10.2 ⚠️ 陷阱：`{{` 大括号會讓組裝直接爆掉

`interpolate()` 對**任何**它不認得的 `{{...}}` **直接丟錯**，而且
`dsh-system-prompt/README.md:173` 明講「**沒有**跳脫字面大括号的語法」。

**而 SillyTavern 的角色卡裡到處都是 `{{char}}` 和 `{{user}}`。**
把卡片原文直接塞進 `text` 會讓**每一次模型請求都失敗**。

**解法**：把卡片放進**變數**，section 只寫 `{{card}}`。
因為「替換進去的值不會再被掃描一次」（`lib/index.js:171-172`）：

```js
ctx.systemPrompt.variable('card', (c) => cardTextFor(c))          // 卡片原文放這裡
ctx.systemPrompt.section({ name: 'tavern:card', order: 0,
                           text: '{{card}}', complete: true })      // 只寫參照
```

> 這一條如果沒先知道，會做成「卡片看起來好好的，但一送出就炸」，而且原因極不明顯。

### 10.3 其他硬限制

| 限制 | 出處 | 影響 |
|---|---|---|
| provider 是**同步**的（沒有 await） | `lib/index.js:336-343` | 讀檔只能用 `readFileSync` 或自建快取（用 mtime 快取） |
| **只能有一個** `complete` section | `index.d.ts:65` | preset 裡不能再掛一個 `complete` 的 `dsh-persona` |
| **絕對不要**自創 session 事件型別 | `dsh-session/lib/types/known-event-types.js:14-20`、`dsh-session-persistence/lib/index.js:184` | 讀 log 時遇到不認得又沒標 `ignorable` 的型別會**拒讀**——那個 session 就回不來了。酒館的資料要用**自己的側檔** |
| `agentPreset` 只能是 roster id | `dsh-api-session-controller/lib/types/agent.js:386` | 不能傳路徑；id 只能 `[a-z0-9][a-z0-9-]*` |

### 10.4 session → 角色：用 cwd ＋ 一份側檔

- 開對話時 `session.create({ cwd: <酒館資料夾>, agentPreset: 'dsh-tavern' })`，
  `cwd` 會存進**不可變的** `SessionHeader.cwd`（`dsh-session/lib/types/types.d.ts:69`）。
- 但 `cwd` 只到「哪一間酒館」，還不知道是哪個角色。
- → 酒館在開對話時寫一份側檔：`<酒館>/.sessions/<sessionId>.json` = `{ character, chat }`。
  provider 用 `context.agent.session.id` 去查。

> 不用「自訂 sessionId 把角色編進去」——那是在濫用識別碼，而且 id 的格式不是我們保證的。

### 10.5 退路

Agent 面建不起來（preset 被拒、`systemPrompt` 拿不到、`<dshHome>` 不可寫）時：

→ 退回「**公用 persona preset ＋ 卡片塞使用者訊息**」（＝§5 的甲），對話照樣能用，
只是卡片變成「指示」而不是「身分」。**功能不會消失，只會差一級。**

### 10.6 還沒驗證的

1. **一個套件能不能有第三個入口**（`exports: {"./agent": "./lib/agent.js"}`），
   讓 preset 的一列用 `dsh-tavern/agent` 指名它。研究說 preset 的列也接受
   **絕對路徑**與 `file:` URL，那是更保險的寫法。
2. **`ctx.systemPrompt.context()` 的語意**——文件寫「durable user-role snapshot」，
   聽起來會進 session log。世界書要用它還是用 `agent/pre-step`，**要驗**。
3. **`agent/pre-step` 能不能真的替換進入的訊息**（世界書的 depth 注入靠這條）。
4. **壞掉的 preset 不會波及 `dsh web` 啟動**——推論是不會（session 建立時才掛），但要實測。
5. 上面那五條併成**一個小實驗**：一個只有 agent 面的 preset、一張含 `{{char}}` 的卡、
   問它「你是誰、你能做什麼」，看它是不是只認得卡片、沒有工具、而且改卡片下一輪就生效。

---

## 11. 客戶端 ↔ 宿主：通道與座位（研究補充）

### 11.1 我們的「路由」其實是把 DSH 已經有的東西重寫了一遍

**先講結論**：DSH 不是「也有一些方法可以接收使用者資料」——它**只有一套**，
而且**它自己的每一個功能都用那一套**（改名、送訊息、存設定、上傳檔案…全部）。
那一套是公開 API，插件可以掛上去。所以我們不需要發明，只要走前門。

**現況**：宿主半用 `ctx.webServer.register()` 掛了兩條裸路由
（`/api/dsh-tavern/rpc`、`/api/dsh-tavern/assets`），然後**自己寫**了
四項檢查的來源圍籬（`originFenceFailure`）、自己的 JSON 封套、自己的 op 分派。
原因是 `webServer` 本身**零來源檢查、零驗證**。

**DSH 提供三樣東西**（`dsh-client-connection/lib/types/rpc.d.ts`）：

| API | 位置 | 做什麼 |
|---|---|---|
| `connection.requestRejection(request)` | `:139` | 回 `401 \| 403 \| undefined`。文件原話：**「Apply Connection's Host/Origin checks and browser authentication to another Web route」**——就是為「我自己掛了一條路，但想用你的檢查」設計的 |
| `connection.rpc.handle(channel, handler)` | `:111` | 註冊一個**已驗證的頻道前綴**（例如 `/tavern`）。client 用 `rpc.call()` 打，回傳 `{ok:true,value}` 或 `{ok:false,error}` |
| `connection.fetch.register({path, methods, requestBody, fetch})` | `:101` | 在 **`/api` 底下**掛一條精確路由，`requestBody` 可選 `'buffered'` 或 **`'streaming'`**（二進位上傳／圖片下載用） |

三者的共同點（`lib/index.js:602-619`）：進到我們的 handler **之前**已經跑過信任與驗證。

| 情況 | 回應 |
|---|---|
| 不是受信任的 API 請求 | **403** |
| 沒有瀏覽器 cookie 驗證 | **401** |

**→ 我們現在是自己圍籬笆，而且只擋瀏覽器、擋不掉本機的 curl。**
DSH 的連 cookie 都驗。

#### 三個等級，可以只做第一個

| 等級 | 做法 | 改動量 | 拿到什麼 |
|---|---|---|---|
| **最小** | 保留現在的裸路由，把自寫的 `originFenceFailure` **換成** `ctx.connection.requestRejection(req)` | 幾行 | DSH 的 Host／Origin 檢查 **＋ cookie 驗證** |
| **中等** | 改用 `ctx.connection.rpc.handle('/tavern', handler)` | 換掉路由層 | 上面全部 ＋ 統一的請答封套與錯誤形狀（客戶端 `call()` 直接回 `{ok,value\|error}`），我們自己那套 JSON 封套可以刪掉 |
| **完整** | 再加 `connection.fetch.register()` 處理二進位 | 換掉 assets 路由 | **串流上傳**（我們現在要自己把整個 body 收進記憶體）＋ 圖片走 DSH 的驗證 |

**建議順序**：先做「最小」（風險最低、立刻升級安全），「中等」在重寫 UI 時一起做。

**通道名的規則**：`/^\/[A-Za-z0-9._~-]+$/`，而且 **`/api` 是保留的**
（所以不能叫 `/api/tavern`）。二進位／串流走 `ctx.connection.fetch.register({...})`。

#### 代價與紅線

`connection` 是**第二個**宿主服務。本專案的紅線是「宿主半只依賴 `webServer`」——
理由不是潔癖，是「多依賴一個服務，就多一個『啟動時卡住』的理由：`inject` 等不到的服務
會讓那筆 entry 停在 `pending`」。

**解法（不寫進 `inject`）**：

```js
var connection = ctx.get('connection')        // 拿得到就好，拿不到回 undefined，不會卡住
if (connection && connection.rpc) {
  // 有驗證的通道
} else {
  // 退回現在的裸路由 ＋ 自己的圍籬
}
```

這跟客戶端半拿 `layout` 用的是**同一個防禦寫法**（`lib/client.js` 的 `ctx.get('layout')`）。
兩條路都要留著，`tavern.list` 回一個 `transport` 欄位告訴客戶端現在走哪一條。

> **這是安全升級，不是功能變更**，但它是紅線上的第一次讓步——所以要留退路、要一起測。

### 11.2 我們現在佔的側邊欄座位，可能不必佔

**現況**：`sidebar.workspaces` ＋ `priority: -1`——我們**包下整個側邊欄區塊**，
把 DSH 的原生工作區清單叫進來放進自己的框，下面接酒館街，中間還要自己畫拖曳把手。
**這是這個插件做過最有侵略性的一件事。**

研究列出的「**加進去就好、不會蓋掉別人**」的座位裡有一個 `sidebar.panellist`：

> a panellist id X plus a `main` **keyed** entry X gives you your own main panel

也就是說 DSH 本來就有「**側邊欄一列 ＋ 對應主面板**」的機制，而且**目前沒有住戶**。

→ **列為 UI 階段的選項**：如果 `sidebar.panellist` 夠用，我們可以不再包下原生側邊欄，
把「酒館街」變成側邊欄裡**自己的一列**。風險會小一個數量級。
（但這會改變現在的外觀——酒館街不再是原生清單下面那一段、也沒有拖曳分隔線——
所以那是你的決定，不是我的。）

### 11.3 客戶端半的載入規則（只有兩條）

`dsh-client-modules/lib/index.js:637-666`（`resolveMeta`）＋ `:155-166`（`clientExportOf`）：

1. 這個套件必須是**宿主上一個啟用中的 Cordis Loader entry**（我們已經有了，透過 `cordis.patch.yml`）。
2. `package.json` 要有 `dsh.client.platform === 'web'` **而且**有 `exports["./client"]`。
   少了那個 export **直接丟錯**。

**附帶更正**：我們宣告的

```json
"inject": ["@deepseek-ai/dsh-client-ui-slots"],
"external": ["react"]
```

**兩個都是裝飾性的**。`dsh.client.inject` 官方定義是「資訊性的套件名依賴，**不是** Cordis 服務注入」
（`dsh-package-manifest/lib/types/types.d.ts:38-52`）；`external` 也是 no-op——那九個模組
（`react`、`react-dom`、`cordis`、`dsh-client-ui-slots`…）本來就在凍結的基準模組表裡。
**留著無害，但不要以為它們在做什麼。**

### 11.4 新增一個 export 不是熱的

`dsh-client-hmr` 是**輪詢檔案**（預設 500ms）再推 SSE，不是檔案監看。
**「新加一個 package 或新加一個 export」需要重啟宿主／重新載入頁面**才看得到。
→ 之後加 `exports["./agent"]` 的時候要記得這件事，不然會以為沒生效。

### 11.5 確認：只有 preset 那一列能決定提示詞

研究的總結（多個方向交叉查證後）：

> 只有**掛在 preset 裡的那一列**能（透過 system-prompt registry）決定每個 session 的
> 提示詞與工具。客戶端座位、`webServer` 路由、commands、skills、session projections、
> MCP、hooks **全部只是搬運者或觀察者，不是提示詞的作者**。
> 唯一的例外是 command 或事件監聽可以用 `agent.inject/steer/followup(createUserMessage(...))`
> 加一則**使用者訊息**——永遠碰不到系統提示。

→ **§10 的架構是唯一的路，但它是對的路。**
