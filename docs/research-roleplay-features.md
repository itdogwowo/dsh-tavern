# 角色扮演聊天前端功能盤點（研究報告）

> 目的：替「酒館模式」插件做功能盤點與優先序建議。
> 方法：官方文件 + GitHub Issues（API 查詢）+ 社群外掛 + 第三方比較文章。
> 撰寫時間：2026-09-18。**只做研究，不含程式碼。**

## 0. 使用頻率標記的定義

| 標記 | 意義 |
|---|---|
| **核心** | 幾乎每個使用者每次開起來都會用到 |
| **常用** | 多數活躍使用者會用，但不是每次 |
| **進階** | 少數重度使用者／特定情境才會碰 |
| **選配** | 擴充或外掛提供，需要的人很需要，其他人完全不用 |

---

## 1. SillyTavern 完整功能盤點

### 1.1 角色與身分

| 功能區 | 一句話：它解決什麼問題 | 頻率 |
|---|---|---|
| **角色卡 CRUD／匯入匯出** | 把「一個角色的設定」變成一個可攜檔案，讓提示詞不用每次重打、卡片能互相交換 | **核心** |
| **PNG 卡內嵌（`chara`/`ccv3` tEXt chunk）** | 讓卡是「一張圖 + 資料」的單檔，社群可以拖放即用；PNG 是它的**儲存**格式，JSON 只是交換格式 | **核心** |
| **Character Library 側欄＋搜尋** | 在幾十到幾百張卡裡找到你要的那張 | **核心** |
| **標籤（Tags）＋資料夾** | 用主題／來源／品質分群，解決「卡片太多難管理」 | **常用** |
| **我的最愛／隨機排序** | 快速回到常聊的卡；隨機抽卡當探索 | **常用** |
| **備用問候（Alternate Greetings）** | 同一張卡給多個開場，讓每次開新對話不一樣 | **常用** |
| **Persona（使用者身分）** | 讓模型知道「我是誰」——沒有 persona 就沒有沉浸感的錨點 | **常用** |
| **Persona 綁定（chat／character／default lock）** | 進到某個對話自動換成對應身分，不用每次手動切 | **進階** |
| **Persona Lorebook** | 讓「我的背景設定」也能關鍵字觸發 | **進階** |
| **角色 ⇄ Persona 互轉** | 把一個角色當成自己來演，或反過來 | **選配** |
| **Character Version／進階欄位（Depth Prompt、系統提示覆寫）** | 卡片層級的細部覆寫，作者用來控制格式 | **進階** |
| **Bulk edit／批次標籤** | 一次整理大量卡 | **進階** |

來源：[Character Design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/)、[Personas](https://docs.sillytavern.app/usage/personas/)、[Tags](https://docs.sillytavern.app/usage/core-concepts/tags/)

### 1.2 對話本身

| 功能區 | 一句話：它解決什麼問題 | 頻率 |
|---|---|---|
| **逐字串流輸出** | 不用等整段生成完才看到字，體感快很多 | **核心** |
| **思考（reasoning）顯示** | 把推理模型的思考過程摺疊起來，看得見但不干擾正文 | **常用** |
| **Swipe（重新生成／多候選）** | 同一則回覆產生多個版本，挑一個最好的，不用重開對話 | **核心** |
| **訊息編輯／刪除** | 模型寫壞一句話時就地修，不用整段重來 | **核心** |
| **Continue（續寫）** | 回覆被截斷時接著寫下去 | **常用** |
| **分支（Branch）／檢查點（Checkpoint）** | 從某一句話複製出另一條時間線，敢於嘗試劇情；checkpoint 記錄「母對話」連結 | **常用** |
| **改名／刪除／匯出對話（`.jsonl`／`.txt`）** | 找回、整理、帶走對話 | **常用** |
| **對話搜尋（`/api/chats/search`＋外掛）** | **在對話內容裡找字串**——ST 本體很晚才有，社群另外做了外掛 | **常用** |
| **自動摘要（Summarize）** | 把長對話壓成摘要塞回上下文，對抗「角色失憶」 | **常用** |
| **對話向量化（Chat Vectorization）** | 從歷史訊息裡向量檢索相關段落，把舊訊息拉回上下文 | **進階** |
| **對話備份（保留 50 份）** | 誤刪／存檔壞掉時救回來 | **選配（但出事時救命）** |
| **群組聊天（多角色同房）** | 讓多個角色互相對話，做群像劇 | **進階** |
| **群組回覆順序策略（Natural／List／Pooled／Manual）＋ Talkativeness** | 決定「誰先講話」，避免群聊變成一團亂 | **進階** |
| **群組角色卡合併模式（Swap／Join）** | 前綴快取友善 vs. 角色混淆的取捨 | **進階** |
| **Auto-mode（自動輪轉）** | 放手讓角色自己演下去 | **選配** |
| **訊息附件（對話層級檔案）** | 把參考資料綁在特定對話 | **選配** |
| **Visual Novel Mode＋MovingUI** | 把聊天室變成視覺小說版面，立繪可以拖位置 | **選配** |

來源：[Chat File Management](https://docs.sillytavern.app/usage/core-concepts/chatfilemanagement/)、[Group Chats](https://docs.sillytavern.app/usage/core-concepts/groupchats/)、[Summarize](https://docs.sillytavern.app/extensions/summarize/)、[Chat Vectorization](https://docs.sillytavern.app/extensions/chat-vectorization/)、[Visual Novel Mode](https://docs.sillytavern.app/usage/user-settings/visual-novel/)

### 1.3 世界書／Lorebook

| 功能區 | 一句話：它解決什麼問題 | 頻率 |
|---|---|---|
| **關鍵字觸發條目** | 只在提到某個詞時才把設定塞進上下文，省 token 又不硬塞世界觀 | **核心（重度使用者）／常用（一般）** |
| **`constant`（永遠插入）** | 放「整場都成立」的規則 | **常用** |
| **`key` / `keysecondary` / `selectiveLogic`** | 用「A 而且要 B」這種條件控制觸發 | **進階** |
| **Regex 當關鍵字** | 用正則匹配更動態的觸發條件 | **進階** |
| **遞迴掃描（Recursion）** | 條目 A 觸發條目 B，讓世界觀可以互相引用 | **進階** |
| **插入位置／深度（position／depth／role）** | 控制「這段設定離回覆多近」，越近影響越大 | **進階** |
| **機率／黏著／冷卻／延遲（probability／sticky／cooldown／delay）** | 讓設定不是每次都出現，製造變化 | **選配** |
| **角色專屬／Persona 專屬／對話專屬世界書** | 同一個世界觀綁在對的東西上，不用每次手動選 | **常用** |
| **世界書綁定隨卡匯出（`character_book`）** | 一張卡帶著自己的世界走 | **常用** |
| **Entry Budget／token 上限** | 防止世界觀把上下文吃光 | **進階** |

來源：[World Info](https://docs.sillytavern.app/usage/worldinfo/)

### 1.4 提示詞與生成控制

| 功能區 | 一句話：它解決什麼問題 | 頻率 |
|---|---|---|
| **Prompt Manager（可拖曳排序的提示詞區塊）** | 讓使用者精確控制「送出去的字到底長什麼樣」 | **進階** |
| **Quick Prompts（Main／Auxiliary／Post-History）** | 常用提示詞不用翻進去改 | **常用** |
| **Advanced Formatting（Text Completion 用）** | 對齊不同模型家族的 prompt 格式 | **進階** |
| **Context Template／Instruct Mode** | 把 ST 的格式翻譯成模型聽得懂的格式 | **進階** |
| **System Prompt 管理** | 分開管理「系統層」與「角色層」提示 | **常用** |
| **Author's Note（含 depth／frequency／position）** | 一句話即時修正方向（「回覆要 300 token」「記得前面的指令」），不用改卡 | **常用** |
| **Preset（生成參數＋提示詞組）＋每個模型一份** | 換模型不用重調；社群預設可以直接匯入 | **常用** |
| **Sampler 參數（temperature／top_p／penalty…）** | 控制創意程度與重複度 | **常用** |
| **Tokenizer 顯示／token 計數** | 知道哪裡把上下文吃光了 | **常用** |
| **CFG Scale** | 更嚴格地貼著提示詞走 | **選配** |
| **Regex 腳本（輸入／輸出／請求／顯示）** | 清理模型輸出、做自訂顯示格式、把狀態欄變成 GUI | **常用（社群預設重度依賴）** |
| **Macros（`{{char}}`／`{{user}}`／變數／自動補全）** | 讓提示詞可以重複使用、可參數化 | **常用** |
| **STscript／Slash Commands（`/` 指令語言）** | 把一堆操作變成一行可存可分享的腳本 | **進階** |
| **Quick Replies（最多 100 顆按鈕＋預設組）** | 常用指令變成一鍵，等於自製工具列 | **常用** |
| **World Info／Author's Note 注入模板** | 控制「插進去的東西被包成什麼樣子」 | **進階** |
| **Prompt Inspector（外掛）** | 送出前先看／改真正要送出的提示詞 | **進階** |

來源：[Prompt Manager](https://docs.sillytavern.app/usage/prompts/prompt-manager/)、[Author's Note](https://docs.sillytavern.app/usage/core-concepts/authors-note/)、[Advanced Formatting](https://docs.sillytavern.app/usage/core-concepts/advancedformatting/)、[Macros](https://docs.sillytavern.app/usage/macros/)、[Slash Commands](https://docs.sillytavern.app/usage/core-concepts/slashcommands/)

### 1.5 擴充與周邊

| 功能區 | 一句話：它解決什麼問題 | 頻率 |
|---|---|---|
| **Extensions 系統（內建＋可安裝＋第三方）** | 把「每個人要的東西都不一樣」變成可插拔 | **核心（生態本身）** |
| **Character Expressions（表情差分／立繪）** | 讓角色有臉、會依情緒換圖 | **常用** |
| **Image Generation（SD／FLUX／DALL·E）** | 在對話裡生插圖 | **常用** |
| **Image Captioning** | 讓模型「看見」圖，補足多模態 | **選配** |
| **TTS（ElevenLabs／Silero／XTTS／AllTalk…）** | 讓角色有聲音 | **常用（愛用者極愛）** |
| **Speech Recognition** | 用說的取代打字 | **選配** |
| **翻譯（Chat Translation／Translate Input）** | 跨語言玩別人的卡，或把外語輸出轉成母語 | **常用（非英語圈很高）** |
| **Web Search／RSS／Weather（function tool＋slash command）** | 把即時資訊餵進提示詞 | **進階** |
| **Data Bank（RAG：檔案／網頁／YouTube／Fandom 匯入）** | 把外部文件變成可檢索的知識庫 | **進階** |
| **Smart Context（Extras）** | 從向量庫挑最相關的上下文片段 | **進階** |
| **Notebook** | 隨手記筆記 | **選配** |
| **Timelines（時間線導覽）** | 在長對話裡快速跳段 | **選配** |
| **Variable Viewer** | 看／改 STscript 變數 | **選配** |
| **Duplicate Finder** | 找出重複匯入的卡 | **選配** |
| **Dynamic Audio／Blip／Live2D／VRM／EmulatorJS／Chess／D&D Dice** | 氛圍、沉浸、小遊戲 | **選配** |
| **Push Notifications／Idle prompting** | 離開時的通知；閒置後自動推進劇情 | **選配** |
| **Multi-user（多帳號）** | 一台機器多人用 | **選配** |
| **UI 自訂（主題色、背景、自訂 CSS、MovingUI）** | 讓介面變成自己喜歡的樣子 | **常用** |
| **行動裝置友善版面／PWA** | 手機也能玩 | **常用** |

來源：[Extensions](https://docs.sillytavern.app/extensions/)、[Data Bank](https://docs.sillytavern.app/usage/core-concepts/data-bank/)、[UI Customization](https://docs.sillytavern.app/usage/user-settings/uicustomization/)

---

## 2. 同類前端的獨特功能

| 前端 | 定位 | SillyTavern 沒有／做得更好的地方 | 介面上的創新 |
|---|---|---|---|
| **RisuAI** | 輕量、跨平台（Tauri 桌面＋iOS/Android 真 App） | **記憶系統一整套**：SuperMemory（滿了自動摘要、摘要再摘要）、**HypaMemory V2/V3（記憶壓縮）**、Hanurai Memory；**Inlay Assets**（圖片／音訊／**影片**直接嵌進對話與背景）；**Module 系統**（可分享的角色擴充模組，含 HypaMemory、自訂 UI）；**Trigger Script**（條件觸發式腳本）；**CBS（Callback System）** 函式庫；**MCP 整合**；內建 Hub／Realm 卡庫市集 | **Regex 把文字變成 GUI**：模型只輸出 `[status]`，前端用 regex 換成 HTML 狀態欄——用極少 token 做自訂介面；**三套主題（Classic／WaifuLike／WaifuCut）**；**真桌機／行動原生 App**（不用 Node、不用終端機、5 分鐘上手） |
| **Agnai（AgnAistic）** | 多使用者共享伺服器 | **唯一有可信多用戶模式**：帳號、角色權限分離、共享角色與對話擁有權；Persona 綁在帳號上 | 共享伺服器＝「同一間店、不同客人」的介面；權限與角色分離的設定頁 |
| **Chub AI（Venus 前端）** | 卡庫＋聊天一體 | **發現（Discovery）做得比 ST 好**：6 萬＋社群卡、`trending`、標籤與 NSFW 標記篩選、創作者頁與 creator notes、**Memory 按鈕**（一鍵把這場壓成跨對話記憶）、Macro、模型分級訂閱 | **「卡庫就是首頁」**：一牆頭像＋搜尋＋tag，先逛再聊；**聊天／作者後台雙模式**（Creator dashboard） |
| **TavernAI** | 最早的開源前端（2023-02，ST 的上游） | 現代前端的功能都由它長出來（角色卡、Persona、群聊、世界書雛形）；本體已停止維護 | 證明了「以角色卡為中心＋聊天氣泡」這個版面是對的 |
| **KoboldAI／KoboldCpp** | 後端（單檔執行檔），但**內建 KoboldAI Lite 前端** | **一個檔案什麼都有**：生圖、生影片、STT（Whisper）、TTS、生音樂、視覺、MCP／tool calling；**Lite UI 內建** memory／world info／author's note／characters／scenarios；**多種模式（chat／adventure／instruct／storywriter）** 切換；**多種介面主題**（aesthetic roleplay／classic writer／corporate assistant／messenger）；RAG via TextDB | **「同一個模型，換一種玩法」**：模式與主題的組合讓同一個後端服務完全不同用途 |
| **Chronicler**（2026 新秀） | 單一角色、數百小時的長期連續性 | **結構化記憶**（canon／heuristic／reflex 三層＋升降級路徑）；**記憶衝突偵測**；**記憶檢視器**（忘掉／升級／retcon）；**provenance（為什麼這段被檢索出來）**；**不可移除的反幻覺條款**；**Scene Intensity 下拉**（Neutral／Fade to Black／Tasteful／Explicit）——把親密場景當一級功能而非越獄；**關係漂移軸**（信任↑↓、依賴↑↓、開放↑↓、防衛↑↓）；**Prompt Inspector**（含檢索分解與截斷） | 把「記憶」變成一個**看得見、可操作的物件**，而不是黑箱 |

來源：[RisuAI README](https://github.com/kwaroran/RisuAI)、[RisuAI SupaMemory](https://github.com/kwaroran/RisuAI/wiki/SupaMemory)、[RisuAI DeepWiki](https://deepwiki.com/kwaroran/Risuai/5.5-image-generation-and-dynamic-assets)、[KoboldCpp README](https://github.com/LostRuins/koboldcpp)、[Chronicler COMPARISON.md](https://github.com/yantrikos/chronicler/blob/main/docs/COMPARISON.md)、[PromptQuorum 三前端比較](https://www.promptquorum.com/zh/power-local-llm/sillytavern-vs-agnai-vs-risuai-roleplay)、[Chub Venus 評測](https://www.techsuggest.io/blog/chub-venus-ai-from-my-screen-an-honest-user-review-/)、[Venus AI 評測](https://fosspost.org/venus-ai/)

### 2.1 三個「別人做對、ST 沒做」的結構性差異

1. **記憶是一個物件，不是一段文字。** RisuAI 與 Chronicler 都把長期記憶做成**可檢視、可編輯、可分層**的東西；ST 的做法是「Summarize 擴充 + 世界書 + 你自己想辦法」，使用者要自己拼。
2. **發現（Discovery）不是搜尋框。** Chub／Venus 的首頁是卡庫，有 trending、tag、creator；ST 的側欄是檔案清單。這是「逛」與「管理」的差別。
3. **上手成本被當成設計目標。** RisuAI 用桌面／行動原生 App 把首次運行壓到 5 分鐘；ST 的官方立場是「陡峭的學習曲線是樂趣的一部分」（[官方文件原文](https://docs.sillytavern.app/)）。兩者服務不同人。

---

## 3. 角色扮演玩家的實際痛點

> 註：Reddit 端點對自動化抓取回傳登入頁，直接引用受到限制；以下以 **GitHub Issues（API 實查）** 與**社群自己寫的外掛**為主證據。社群的「自製外掛」是最誠實的痛點清單——**有人願意寫一整支外掛，就代表本體真的缺那件事**。

### 3.1 痛點 ← 證據對照表

| # | 痛點 | 具體症狀 | 證據（來源） |
|---|---|---|---|
| 1 | **找不到對話** | ST 是「角色中心」而非「對話中心」：要換到某段舊對話得「點角色 → Manage chat files → 禱告你取了好名字 → 找到它」。沒有跨角色的最近對話、沒有釘選、沒有對話資料夾 | 社群外掛 [ChatsPlus](https://github.com/SoFizzticated/SillyTavern-ChatPlus) 開頭就寫 "SillyTavern is a wonderful tool but very Character-centric, making managing conversations across characters cumbersome" |
| 2 | **對話內容不能搜尋** | 只能搜角色名，不能搜「我記得我們聊過某件事」。社群做了**需要裝後端索引外掛**的 [ChatSearch](https://github.com/LenAnderson/SillyTavern-ChatSearch)（第一次啟動還要花幾分鐘建索引）；本體的 `/api/chats/search` 也因此有多次效能 PR | ChatSearch 外掛、ST Issue [#4275](https://github.com/SillyTavern/SillyTavern/issues/4275)、[#1797](https://github.com/SillyTavern/SillyTavern/issues/1797) |
| 3 | **誤刪／存檔壞掉救不回** | 「換預設導致紀錄消失」「誤刪對話」。中文圈有人專門寫了**救援工具** | [RecordRecoveryAssistant（对话纪录海底捞）](https://github.com/SenriYuki/RecordRecoveryAssistant) |
| 4 | **角色失憶／劇情不連貫** | 早期約定被忘掉、物品消失又出現、時間線錯亂、人設漂移。整個中文圈有人寫了一整套「記憶引擎」 | [ST-BaiBai-Book 柏宝书](https://github.com/baibai-git/ST-BaiBai-Book) 開頭：「聊得越久，AI 越容易忘事」；ST Issues [#1297 MemGPT／True Unlimited Memory](https://github.com/SillyTavern/SillyTavern/issues/1297)、[#2022 讓角色卡與角色 Lore 隨對話更新](https://github.com/SillyTavern/SillyTavern/issues/2022)、[#623 low memory of characters](https://github.com/SillyTavern/SillyTavern/issues/623) |
| 5 | **卡片太多難管理** | 幾百張卡、重複匯入、找不到、不知道哪張好 | 社群做了獨立的卡管理器 [SillyInnkeeper](https://github.com/dmitryplyaskin/SillyInnkeeper)（掃 PNG、抽 metadata、產生預覽、整理大量收藏）；瀏覽器擴充 [Character Card Manager](https://chromewebstore.google.com/detail/character-card-manager-fo/jkeelklilnekgjlbhkjdkcpegmnpajfm)；ST 本體也要到很晚才有標籤，Issue [#448 角色資料夾](https://github.com/SillyTavern/SillyTavern/issues/448) |
| 6 | **介面臃腫、功能找不到** | 「選項重複、按鈕分散、重要欄位不在該在的位置」——連官方 repo 都有重構票 | ST Issue [#3863 \[REFRACTOR\] Character Edit Menu Bloated](https://github.com/SillyTavern/SillyTavern/issues/3863)；第三方評測：「功能介面可能使首次用戶感到不知所措」「設定分散（多個 JSON、預設、世界書、regex）需要時間學習」 |
| 7 | **提示詞太難調／預設是黑魔法** | 社群 preset 互相衝突、卡片夾帶越獄提示與取樣覆寫；「在創意模型上用預設取樣參數」是常見錯誤 | [PromptQuorum 常見錯誤](https://www.promptquorum.com/zh/power-local-llm/sillytavern-vs-agnai-vs-risuai-roleplay)：「匯入的社群卡片可能攜帶隱藏行為：長越獄系統提示、取樣覆寫、人格矛盾」 |
| 8 | **世界書不會用** | 觸發條件、遞迴、插入位置、depth 這些旋鈕太多；ST 自己也要靠社群寫「World Info Encyclopedia」才講得清 | [World Info 文件](https://docs.sillytavern.app/usage/worldinfo/) 開頭就外連 rentry 的百科；Issue [#4508 More world info Positions](https://github.com/SillyTavern/SillyTavern/issues/4508)、[#3344 Negative depth](https://github.com/SillyTavern/SillyTavern/issues/3344)、[#3469 一個對話只能一本世界書](https://github.com/SillyTavern/SillyTavern/issues/3469) |
| 9 | **同一個對話想有更細的 Lore 綁定** | 「對話綁定的世界書」「依對話訊息動態產生條目」都是長年 feature request | [#1226 Chat Bound Lore Book + Dynamic entries](https://github.com/SillyTavern/SillyTavern/issues/1226)、[#3469](https://github.com/SillyTavern/SillyTavern/issues/3469) |
| 10 | **分支／檢查點不好用** | 「Improved bookmarks branching」（[#363](https://github.com/SillyTavern/SillyTavern/issues/363)）、「分支時要確認對話框」（[PR #5619](https://github.com/SillyTavern/SillyTavern/pull/5619)）、「Summarize 在分支下會壞」（[#3945](https://github.com/SillyTavern/SillyTavern/issues/3945)）；社群還在提「分支導覽 UI＋視覺化圖＋持久化 metadata」（[PR #5283](https://github.com/SillyTavern/SillyTavern/pull/5283)） |
| 11 | **只有最後一則能重刷（swipe）** | 想重刷舊回覆只能砍掉後面重來 | [#1731 Swipes on every AI message（32 留言、11 👍）](https://github.com/SillyTavern/SillyTavern/issues/1731) |
| 12 | **回應長度不受控** | 「回覆太短」是長年抱怨；ST 的解法是叫你自己寫 Author's Note（`[Your next response must be 300 tokens in length]`） | [Author's Note 文件的常見用法](https://docs.sillytavern.app/usage/core-concepts/authors-note/) |
| 13 | **搜尋框位置／空間被擠** | 連「搜尋框不該跟其他按鈕擠在一起」都有 16 則留言 | [#4275](https://github.com/SillyTavern/SillyTavern/issues/4275) |
| 14 | **角色名 ≠ 卡名** | 想要「對話中顯示的名字」跟「卡庫裡的名字」不同 | [#4357（16 留言）](https://github.com/SillyTavern/SillyTavern/issues/4357)、[#1549](https://github.com/SillyTavern/SillyTavern/issues/1549) |
| 15 | **Persona 與角色應該是同一種東西** | 資料模型分裂導致功能重複、參數不能綁在角色上 | [#3139 \[EPIC\] Merge Personas into Characters（12 留言）](https://github.com/SillyTavern/SillyTavern/issues/3139) |
| 16 | **存取門檻／可靠性** | 首次設定約 15 分鐘；行動端只能靠 Termux 很麻煩；社群抱怨服務不穩、更新後行為改變 | PromptQuorum 比較、Chub Venus 評測的「What Frustrates Me」、[RisuAI 的 5 分鐘首跑定位](https://www.promptquorum.com/zh/power-local-llm/sillytavern-vs-agnai-vs-risuai-roleplay) |

### 3.2 玩家「最想要」的排序（依證據強度）

1. **記得住的記憶**（最多人願意為它寫外掛、最多 feature request 反覆出現）
2. **找得到東西**（對話搜尋、最近對話、釘選、資料夾）
3. **不會弄丟東西**（備份、救援、原子寫入）
4. **卡片庫的整理與發現**（標籤、資料夾、重複偵測、trending）
5. **更少要調的旋鈕**（好預設、一鍵修正方向、看得懂的世界書）
6. **更好的分支體驗**（視覺化、命名、每則訊息都能重刷）

---

## 4. 「酒館」隱喻還能做什麼

設計原則：**每個隱喻都必須對應一件真實資料運算**，不能只是換名字。以下每一項都標了「它實際在算什麼」，並且只依賴**檔案 I/O**（符合這個插件「零執行期依賴、按了才做」的硬規則）。

### 4.1 酒館街與店面（大廳層）

| 隱喻 | 對應功能 | 它實際在算什麼 |
|---|---|---|
| **招牌／營業中 · 打烊** | 每間酒館一個狀態：有幾份「進行中」的對話（最後一則訊息在 N 天內） | 讀 `chats/` 的 mtime 與訊息數 |
| **今日特調（酒保推薦）** | 「你不知道要跟誰聊？」→ 推薦 3 張：很久沒聊的常客、從沒開過對話的新卡、最近新增的卡 | 純本地統計（最後對話時間、對話數、檔案建立時間），**不需要模型** |
| **掛牌公告（店規）** | 把這間酒館的「世界觀前提／共同規則」放一處，之後每個新對話都自動帶入 | 寫進 `tavern.json`，由 agent 半注入系統提示 |
| **街上其他店家（酒館地圖）** | 多間酒館的清單加上「類型／招牌／常客數」，像街景而不是資料夾清單 | 彙總各酒館的 summary |

### 4.2 常客與卡司（人物層）

| 隱喻 | 對應功能 | 它實際在算什麼 |
|---|---|---|
| **常客名單（Regulars）** | 依「來訪次數＝對話數」、「停留時間＝總訊息數」、「最後光臨」排序；分「常客／生面孔／已搬走（很久沒來）」 | 掃 `chats/<角色>/` 的檔數與行數 |
| **第一次來的客人** | 匯入了卻從沒聊過的卡，單獨一區，避免「買了一堆卡都沒用」 | 卡片清單與對話清單取差集 |
| **酒保認識你（顧客檔案）** | Persona 管理，但用「這間店的常客資料」呈現：你在這間店用過幾個身分、各自身分跟誰聊過 | Persona 清單＋對話歸屬 |
| **熟客的習慣（偏好筆記）** | 每張卡上掛「我對這角色的偏好」：想要的回覆長度、語氣、地雷 | 卡片旁的本地 metadata 檔（不動卡本身） |
| **後台（員工通道）** | 快速跳到設定／檔案總管／原始 JSON | 既有 op 的入口整理 |

### 4.3 包廂與吧檯（對話層）

| 隱喻 | 對應功能 | 它實際在算什麼 |
|---|---|---|
| **包廂預訂** | 先開好包廂（命名＋指定角色＋指定插圖＋指定世界書），但不急著聊 | 建立 chat 檔＋metadata，**不生成任何訊息** |
| **吧檯（快速一問）** | 不建立正式對話的臨時問答，聊完可以「升格成包廂」 | 暫存對話 → 一鍵搬成正式 `chats/` 檔 |
| **續攤（把這場接下去）** | 從舊對話「帶資料開新對話」：把摘要／物品／計畫／世界書狀態一起帶走（柏寶書的「带数据创建新对话」） | 複製＋合併 metadata，寫新檔 |
| **牆上的時刻表（時間線瀏覽）** | 在長對話裡按「故事內時間」或「樓層摘要」跳段 | 解析使用者標記的錨點／既有 timestamp |
| **今晚的包廂狀態** | 對話清單上顯示「聊到第幾則／多久沒動／有沒有插圖」 | 現有 summary 擴充 |

### 4.4 藏書與帳簿（資料層）

| 隱喻 | 對應功能 | 它實際在算什麼 |
|---|---|---|
| **藏書樓目錄卡（全酒館搜尋）** | 跨角色、跨對話、跨世界書的全文搜尋（含對話內容） | **純字串掃描**；需要時才建可丟棄的索引 |
| **酒保筆記（Book of the Keeper）** | 每則訊息可 Mark、可寫一句註解；彙整成「這間店的名場面」 | 訊息旁的 metadata（`.jsonl` 的 `extra`） |
| **帳簿（Tab Ledger）** | 未了結的事：角色立下的約定、埋的伏筆、未解的謎。了結就核銷 | **規則式抽取**（引號句、問句、使用者標記）＋手動增刪；**不呼叫模型** |
| **酒窖（Cellar）** | 動手改檔案前先留原樣快照；可以「開一瓶」回到某個時間點（唯讀預覽＋另存新檔，不覆蓋） | 複製到 `cellar/<日期>/`，與 `originals/` 同一個原則 |
| **訪客簿（Guest Book）** | 這間店發生過什麼：第一次對話、最長的一場、里程碑 | 從檔案統計出來，不需模型 |
| **酒單（Menu）** | 世界書的「可讀版」：每本世界書的條目清單、關鍵字、啟用狀態 | 讀世界書 JSON（**原始 JSON 編輯器仍然是後備**） |

### 4.5 服務與氛圍（體驗層）

| 隱喻 | 對應功能 | 它實際在算什麼 |
|---|---|---|
| **打烊存檔（Last Call）** | 一顆按鈕：把這間酒館打包成一份可帶走的快照（含世界書／卡片／對話／插圖清單） | 遞迴複製／壓縮 |
| **進貨單（匯入批次）** | 一次丟 20 張 PNG 卡：預覽清單、顯示哪些已存在、決定要不要覆蓋 | 解析 PNG tEXt＋比對現有 id |
| **店內音樂／燈光** | 每間酒館的背景圖、色調、圖示（已有店面圖與燈籠 → 再加「燈光＝主題色」） | 既有 theme op |
| **駐店表演** | 把插圖升級成「會動的」：輪播、依時間換圖、立繪位置 | 純前端計時器 |
| **包廂鈴（服務生）** | 對話「待回覆」的提醒：你有沒有還沒回的話 | 最後一則訊息的 `is_user` |

### 4.6 值得做但**現在不要做**的（明確列出，避免膨脹）

| 想法 | 為什麼先不做 |
|---|---|
| 酒館之間的「街道事件」「鄰居互動」 | 需要跨酒館的執行期狀態，違反「一間酒館＝一個資料夾」 |
| 自動化「跑劇情」「每天自動推進」 | 這是 v1 弄死 DSH 的同一類風險（啟動／背景執行） |
| 酒客之間的社交（分享卡、留言） | 需要伺服器，違反零依賴與「資料是使用者的」 |
| 用模型自動生成摘要／記憶 | 可以由 **agent 半的使用者明確觸發**，但不該是插件的背景行為 |

---

## 5. 優先順序建議

### 5.1 三級分類

#### 🔴 一定要有（沒有它，使用者會覺得這插件「不完全」）

| 功能 | 為什麼 | 現況 |
|---|---|---|
| **原子寫入（temp＋rename）** | 斷電／當機落在寫入中間，使用者的卡會變成半個檔案。成本一行級，防的是不可逆的資料損壞 | ⚠️ 尚未（`docs/design-comparison.md` P1） |
| **原版／工作版分離** | 匯入的卡先無損留存原始位元組。這是目前唯一真正的資料安全缺口 | ⚠️ PNG 卡有 `originals/`，純 JSON 卡沒有 |
| **卡片庫的可管理性：標籤＋搜尋＋我的最愛** | 這是「卡片太多難管理」的直接解；SillyTavern 自己都補到很晚，社群還要外掛 | ❌ 完全沒有 tag／folder／search op |
| **收藏／最近對話／對話釘選** | 痛點 #1：ST 是角色中心，換對話極麻煩。這是**最容易做、體感最好**的一條 | ❌ |
| **全文搜尋（對話內容、卡片、世界書）** | 痛點 #2，純檔案掃描、零模型、零新依賴；社群為此寫了要裝後端索引的插件 | ❌ |
| **正常關閉／匯出整間酒館** | 「一間酒館＝一個資料夾，帶走就好」是這個插件的核心承諾，但目前只能自己用檔案總管搬 | ❌ |

#### 🟡 有了更好（做完上表之後，這些決定它能不能長期被留下來用）

| 功能 | 為什麼 |
|---|---|
| **角色／世界書／對話綁定（角色 Lore、對話 Lore）** | 世界書現在是「散裝」的；綁定後「這張卡帶著它的世界走」 |
| **酒保筆記（標記＋註解）＋精選回顧** | 讓長對話可以被「回顧」，是搜尋之外的第二種找回方式 |
| **帳簿（未了結的約定／伏筆）** | 規則式抽取即可，直接對應「角色失憶／劇情斷線」這個最大痛點 |
| **酒窖（改檔前快照）** | 與原版分離同一個原則，擴大到世界書與對話 |
| **世界書的可讀目錄（酒單）** | 「世界書不會用」的解：先看得懂，再編輯原始 JSON |
| **常客名單／第一次來的客人／今日特調** | 解決「買了一堆卡沒用」與「不知道聊什麼」；純本地統計 |
| **續攤（帶資料開新對話）** | 長篇劇情的續接；柏寶書證明這是真實需求 |
| **打烊存檔（一鍵打包）** | 讓「備份」變成一個動作而不是一段教學 |
| **Persona 管理（顧客檔案）** | 沒有 persona 就沒有沉浸感的錨點；ST 的痛點 #15 是它資料模型分裂 |
| **包廂預訂（先建好、指定世界書與插圖）** | 把「開對話」變成「佈置場景」 |

#### 🟢 錦上添花（有資源再做，或永遠不做）

| 功能 | 什麼時候值得做 |
|---|---|
| **群組聊天（多角色同房）** | 只有當使用者明確要群像劇。它會把提示詞組裝複雜度推高一個量級 |
| **表情標籤／依情緒換圖** | 標籤本身沒有用；要有「產生標籤的東西」才有效（ST 也是靠分類器）。先做「手動選圖」 |
| **TTS／語音** | 需要額外模型與網路，違反零依賴；適合作為**獨立插件** |
| **翻譯** | 對非英語圈價值高，但需要外部服務；可以先用「匯出／匯入」繞過 |
| **生成插圖（生圖 API）** | 與「使用者自己的圖」哲學衝突；適合作為獨立插件 |
| **時間線視覺化／分支圖** | ST 自己都還在提案階段（PR #5283）；等對話量大到需要再說 |
| **STscript／Quick Replies 等價物** | 這是「在別人的機器上跑腳本」的風險，v1 已經證明會出事 |
| **多使用者／共享酒館** | 需要伺服器；Agnai 已經證明這是另一個產品 |

### 5.2 這個插件最該補的 5 個功能

> 排序理由：**先修不可逆的損失，再解最高頻的搜尋／組織痛點，最後才是「智慧」。** 前兩項幾乎零風險、零新依賴；第三、四項需要設計但仍在檔案 I/O 範圍內。

#### 1️⃣ 原子寫入 ＋ 原版／工作版分離（資料安全）

**為什麼是第一名**：唯一的**不可逆**風險。其他功能做錯只是不好用，這兩個做錯是「使用者的卡變成半個檔案／原始欄位被我們洗掉」。而成本極低——`temp file + rename` 是幾行，`originals/` 這個模式在 PNG 卡上已經驗證可行。
**對應痛點**：痛點 #3（弄丟東西）。
**來源**：ST 幾乎所有寫入都走 `write-file-atomic`；ST 在格式遷移前一定先快照（見 `docs/design-comparison.md` §6）。

#### 2️⃣ 全文搜尋（跨角色／跨對話／跨世界書）

**為什麼是第二名**：**投報率最高**。純字串掃描，零依賴、零模型、零背景程序，完全符合「按了才做」。而它解的是痛點 #1＋#2 這一組——社群為了這件事寫了 [ChatSearch](https://github.com/LenAnderson/SillyTavern-ChatSearch)（還要裝後端 plugin、第一次啟動建索引幾分鐘），代表需求真實且 ST 本體沒有。
**實作提示**：搜尋結果要能**直接跳到那一則訊息**，否則等於沒有；索引要可丟棄（刪掉重掃就好），不要變成第二份真相。

#### 3️⃣ 卡片庫的可管理性：標籤 ＋ 我的最愛 ＋ 最近對話／釘選

**為什麼是第三名**：這是「這插件能不能被長期使用」的分水嶺。目前 38 個 op 裡**完全沒有** tag／folder／favorite／search，一旦使用者的卡超過 30 張就會退化成「用檔案總管找」。
**證據**：ST 自己到很晚才有標籤（Issue [#448](https://github.com/SillyTavern/SillyTavern/issues/448)）；社群另外寫了獨立卡管理器 [SillyInnkeeper](https://github.com/dmitryplyaskin/SillyInnkeeper) 與瀏覽器擴充；痛點 #1 的 [ChatsPlus](https://github.com/SoFizzticated/SillyTavern-ChatPlus) 證明「對話中心」的入口是必要的。
**注意**：標籤要存在**卡片之外的本地 metadata**（不要寫進卡的信封），否則會污染匯出。

#### 4️⃣ 角色／對話的世界書綁定 ＋ 世界書可讀目錄

**為什麼是第四名**：世界書是這個插件**已經做了 90% 的功能**（關鍵字觸發、四種 `selectiveLogic`、`constant`），但它是「散裝」的——沒有角色 Lore、沒有對話 Lore、沒有目錄。使用者現在的體驗是「有一堆世界書，但我不知道哪本該配哪張卡」。
**ST 的現況可借鏡**：ST 有 Character／Persona／Chat 三種綁定，而且**只有主要那一本會隨卡匯出**。我們可以只做「角色 Lore ＋ 對話 Lore」，成本低、語意清楚。
**附加價值**：可讀目錄（酒單）解痛點 #8「世界書不會用」。

#### 5️⃣ 酒保筆記 ＋ 帳簿（把「找回」變成「回顧」）

**為什麼是第五名**：搜尋解的是「我知道我在找什麼」；但長篇角色扮演最真實的需求是「**我不知道我錯過了什麼**」——未了結的約定、埋了沒收的伏筆、上次聊到哪。
**為什麼不排更前面**：它需要設計（怎麼標記、怎麼呈現），而且沒有它插件仍然可用。但它有一個關鍵優勢：**用規則式抽取＋手動標記就能做，完全不需要碰模型**。所以它比「自動摘要／向量記憶」更適合這個插件的架構。
**證據**：[柏寶書](https://github.com/baibai-git/ST-BaiBai-Book) 花了整套系統在做「物品帳本／人物名冊／場景地圖／懸念簿」——這是被驗證過的需求形狀，我們可以只做其中「懸念簿」那一塊的最便宜版本。

### 5.3 一句話的判斷

> **先把「不會弄丟」做滿（1），再把「找得到」做滿（2、3），最後才做「記得住」（4、5）。**
> 前三名全部是**純檔案、零依賴、零模型**的改動，而且直接打在玩家最常抱怨的地方。
> 「記憶／摘要／向量」是這個領域最大的痛點，但它需要模型；在這個插件的架構下，**正確的做法是把它留給 agent 半由使用者明確觸發，而不是做成插件的背景行為**。

---

## 附錄：來源清單

### 官方文件（SillyTavern）

- <https://docs.sillytavern.app/>
- <https://docs.sillytavern.app/usage/core-concepts/characterdesign/>
- <https://docs.sillytavern.app/usage/personas/>
- <https://docs.sillytavern.app/usage/core-concepts/tags/>
- <https://docs.sillytavern.app/usage/core-concepts/chatfilemanagement/>
- <https://docs.sillytavern.app/usage/core-concepts/groupchats/>
- <https://docs.sillytavern.app/usage/worldinfo/>
- <https://docs.sillytavern.app/usage/core-concepts/authors-note/>
- <https://docs.sillytavern.app/usage/prompts/prompt-manager/>
- <https://docs.sillytavern.app/usage/core-concepts/advancedformatting/>
- <https://docs.sillytavern.app/usage/macros/>
- <https://docs.sillytavern.app/usage/core-concepts/data-bank/>
- <https://docs.sillytavern.app/usage/user-settings/visual-novel/>
- <https://docs.sillytavern.app/extensions/>
- <https://docs.sillytavern.app/extensions/summarize/>
- <https://docs.sillytavern.app/extensions/chat-vectorization/>

### GitHub Issues／PR（實查，2026-09-18）

- [#3863 Character Edit Menu Bloated](https://github.com/SillyTavern/SillyTavern/issues/3863)
- [#1731 Swipes on every AI message](https://github.com/SillyTavern/SillyTavern/issues/1731)
- [#1297 MemGPT／True Unlimited Memory](https://github.com/SillyTavern/SillyTavern/issues/1297)
- [#2022 角色卡與角色 Lore 隨對話更新](https://github.com/SillyTavern/SillyTavern/issues/2022)
- [#1226 Chat Bound Lore Book + Dynamic entries](https://github.com/SillyTavern/SillyTavern/issues/1226)
- [#3469 一個對話多本世界書](https://github.com/SillyTavern/SillyTavern/issues/3469)
- [#4508 More world info Positions](https://github.com/SillyTavern/SillyTavern/issues/4508)
- [#3344 Negative depth for world info](https://github.com/SillyTavern/SillyTavern/issues/3344)
- [#448 Character folders in list](https://github.com/SillyTavern/SillyTavern/issues/448)
- [#4275 搜尋框不該跟其他按鈕擠](https://github.com/SillyTavern/SillyTavern/issues/4275)
- [#1797 Fragment search for Manage chat files](https://github.com/SillyTavern/SillyTavern/issues/1797)
- [#363 Improve bookmarks branching](https://github.com/SillyTavern/SillyTavern/issues/363)
- [#3945 Summarize 在分支下會壞](https://github.com/SillyTavern/SillyTavern/issues/3945)
- [#4357 對話中顯示名與卡名分離](https://github.com/SillyTavern/SillyTavern/issues/4357)
- [#3139 Merge Personas into Characters](https://github.com/SillyTavern/SillyTavern/issues/3139)
- [PR #5283 Branch navigation UI](https://github.com/SillyTavern/SillyTavern/pull/5283)
- [#3335 MCP for Tool Calling](https://github.com/SillyTavern/SillyTavern/issues/3335)

### 社群外掛（作為痛點證據）

- [ChatsPlus（對話中心介面／釘選／資料夾）](https://github.com/SoFizzticated/SillyTavern-ChatPlus)
- [ChatSearch（全對話搜尋，需後端索引）](https://github.com/LenAnderson/SillyTavern-ChatSearch)
- [RecordRecoveryAssistant（對話救援）](https://github.com/SenriYuki/RecordRecoveryAssistant)
- [ST-BaiBai-Book 柏宝书（記憶引擎）](https://github.com/baibai-git/ST-BaiBai-Book)
- [SillyInnkeeper（獨立卡管理器）](https://github.com/dmitryplyaskin/SillyInnkeeper)
- [Character Card Manager（瀏覽器擴充）](https://chromewebstore.google.com/detail/character-card-manager-fo/jkeelklilnekgjlbhkjdkcpegmnpajfm)

### 同類前端

- [RisuAI](https://github.com/kwaroran/RisuAI)／[SupaMemory](https://github.com/kwaroran/RisuAI/wiki/SupaMemory)／[Lorebook](https://github.com/kwaroran/RisuAI/wiki/Lorebook)／[Regex Script](https://github.com/kwaroran/RisuAI/wiki/Regex-Script)／[DeepWiki：Inlay 與動態素材](https://deepwiki.com/kwaroran/Risuai/5.5-image-generation-and-dynamic-assets)
- [KoboldCpp（內建 KoboldAI Lite）](https://github.com/LostRuins/koboldcpp)
- [Chronicler 功能對照表](https://github.com/yantrikos/chronicler/blob/main/docs/COMPARISON.md)
- [PromptQuorum：SillyTavern vs Agnai vs RisuAI](https://www.promptquorum.com/zh/power-local-llm/sillytavern-vs-agnai-vs-risuai-roleplay)
- [Chub Venus 使用者評測](https://www.techsuggest.io/blog/chub-venus-ai-from-my-screen-an-honest-user-review-/)
- [Venus AI 評測（FOSS Post）](https://fosspost.org/venus-ai/)
