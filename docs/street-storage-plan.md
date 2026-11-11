# 酒館街與儲存佈局（草案）

> 狀態：**P1–P6 已實作（2.8.0–2.10.0）**。這一頁回答三件事：
> 1. 「酒館街」放在哪、點進去的順序是什麼；
> 2. 對話現在存在哪、為什麼會覺得怪、要改成什麼形狀；
> 3. 插件有沒有自己的資料庫。
>
> 相關：[`plan.md`](plan.md)（交接）、[`room-layout.md`](room-layout.md)（目前的房間佈局）、
> [`storage-layout.md`](storage-layout.md)（目前的檔案規則）。

## 0. 一句話

> **街在插件頁、燈籠是捷徑；一間酒館＝一個資料夾；一間房＝`rooms/<roomId>/`；
> `chat.jsonl` 是使用者的對話，DSH session 是引擎，`.sessions/` 是可重建的索引。**

## 1. 入口與層級

```
插件頁（sidebar 的「插件」圖示 / main:plugins）
└─ 分頁「酒館街」（plugins.tab）
   ├─ 酒館 A 卡片
   ├─ 酒館 B 卡片
   └─ ＋ 新增酒館（選一個資料夾）
        │
        └─ 點卡片 → main:tavern（這一間酒館）
             ├─ 🏠 大廳　💬 包廂　🎭 卡司　📖 藏書　⚙️ 設定
             └─ 點一間房 → main:tavern-chats（對話頁）
```

- **酒館街＝插件頁的一個分頁**（`plugins.tab`，`id: 'tavern-street'`，label「酒館街」，
  order 100，排在官方「發現」之後）。這是官方公開的擴充點，不是接管別人的座位。
- **燈籠＝同一條街的捷徑**（`sidebar.panellist`，`id: 'tavern-street'`）。
  按燈籠直接到街，不必先開插件頁；街再進酒館。
- **主面板多一個 `main:tavern-street`**：街是一個真正的主面板（不是塞在插件頁裏的
  一塊），所以燈籠、插件分頁、上一頁按鈕三個入口都指向同一個地方。
- 點酒館卡片的**本體**：`tavern.select(id)` → `selectPanel('tavern')`（酒館頁）。
- 卡片上的**「繼續」**：直接開這一間酒館最近的一間房（`main:tavern-chats`）。
  日常聊天就是「燈籠 → 繼續」兩下；「插件 → 酒館街 → 酒館 → 對話」是
  **瀏覽／建立很多酒館**的路，不是每天都要走的路。
- 點「＋」：`tavern.add`（選資料夾、建結構），完成後刷新街。
- 酒館頁的標題列要有「← 酒館街」；對話頁要有「← <酒館名>」。
  以前的導航是側邊欄那棵樹，側邊欄收掉之後，**上一頁必須畫在頁面上**。

> **為什麼不把街放回側邊欄工作區？** 2.7.1 試過接管 `sidebar.workspaces`，
> 結果是 `renderSlot` 的授權邊界一踩就整條街退位（見 `CHANGELOG.md` 2.7.2）。
> 插件頁的分頁是官方座位，不會跟原生工作區搶，也不用鏡射任何子座位。

街要的資料一次回完，不要 N 間酒館打 N 次 `room.list`。新的宿主 op：

```json
// street.cards → （一次掃完名冊）
{
  "activeId": "…",
  "cards": [
    {
      "id": "…", "name": "酒館", "path": "<酒館資料夾>", "icon": "", "active": true,
      "front": "/api/dsh-tavern/assets/tavern/店面.png",
      "missing": false,
      "counts": { "characters": 2, "worldbooks": 1, "rooms": 1 },
      "rooms": [
        { "room": "mujuvqwg-aauk", "name": "老闆娘-aauk", "host": "老闆娘", "lastAt": "…" }
      ]
    }
  ]
}
```

- `missing: true`＝名冊上的資料夾不見了；街照樣畫卡片，但只有「移除」。
- 計數與最近房間都是**掃資料夾算出來的**，不建索引；真的慢再加可重建快取。

## 2. 現在哪裏怪

### 2.1 房間的路徑裏有一個「角色」，但它不是房主

```
chats/<角色>/<roomId>/          ← 現在
```

- 一間房可以有多個角色（`room.json` 的 `cast`，2.7.0），但資料夾還是掛在
  **建立時選的那個角色**底下。那個角色只是「房主／預設發言人」，不是所有者。
- 同一個概念在兩個地方：路徑裏的角色，和 `room.json` 的 `cast`。加人、換人、
  刪卡都不動路徑——路徑就變成一個**歷史遺跡**。
- 連帶影響資產 URL：`chat:<角色>/<roomId>`、`chats/<角色>/<roomId>/art/`。

### 2.2 同一段關係寫在三個地方

| 檔案 | 寫什麼 | 誰需要 |
|---|---|---|
| `room.json` | 房間設定（**目前沒有 session**） | 房間頁、每房設定 |
| `.sessions/<sessionId>.json` | `{sessionId, character, room, chat, boundAt}` | **agent 面**（每一輪靠它反查房間） |
| `chat.jsonl` 標頭 | `chat_metadata.dsh_session_id` | 索引掉了時的修復麵包屑 |

三個地方會走散，所以才有 `session.rebuild`（從 `.jsonl` 標頭重建）。
但重建只救得回**房主那一個 session**——多人房間的其他角色各自有 session，
那些綁定只存在 `.sessions/`，掉了就找不回。

### 2.3 對話有兩份，而且「有歷史」不等於「模型記得」

| 層 | 位置 | 性質 |
|---|---|---|
| 使用者的對話 | `<酒館>/chats/.../chat.jsonl` | 可讀、可帶走、SillyTavern 格式 |
| 引擎的對話 | `~/.dsh/sessions/…`（DSH 自己管） | 模型真正續聊的上下文 |

- DSH **沒有**「把一段 JSONL 匯入成 session」的公開 API；只有 `fork`（複製既有
  session 的前綴）。所以 tavern 檔裏有歷史、DSH session 不見了的時候，
  **模型不會自動記得那些話**。
- 現在的畫面沒有把這件事說出來：房間看得到歷史，送出去卻像換了一個人。
- 把整個酒館資料夾搬到另一台機器：歷史還在，session 不在——同上。

### 2.4 命名

UI 叫「房間／包廂」，資料夾叫 `chats/`；`room.json` 是設定、`chat.jsonl` 是對話，
而「chat」同時指房間和訊息。這是小問題，但每次解釋都要多一句。

## 3. 目標佈局

```
~/.dsh/taverns.json                     ← 街的名冊（全域；id → 資料夾路徑）
<酒館資料夾>/
├── tavern.json                         ← { version, layout: 3, name, note, createdAt }
├── characters/<id>.{json,png}
├── worldbooks/<id>.json
├── rooms/                              ← 房間（取代 chats/）
│   └── <roomId>/                       ← 身分＝資料夾名，永遠不變
│       ├── room.json                   ← 這一間房的**唯一**清單
│       ├── chat.jsonl                  ← 對話（ST 格式，一行一則）
│       ├── art/                        ← 這一間房的圖
│       ├── files/                      ← 訊息附件
│       └── runs/                       ← 工作樓執行紀錄（可丟）
├── art/                                ← 角色／世界書／店面的圖
├── workflows/
└── .sessions/<sessionId>.json          ← session → 房間（agent 用的反向索引）
```

`room.json` 的新形狀：

```json
{
  "version": 2,
  "layout": 3,
  "name": "雨夜",
  "host": "老闆娘",
  "cast": ["老闆娘", "酒保"],
  "sessions": {
    "老闆娘": "session-…",
    "酒保": "session-…"
  },
  "createdAt": "…",
  "model": "",
  "roomPrompt": "",
  "worldbookPosition": null,
  "worldbookOverrides": {},
  "worldbookEntryOverrides": {},
  "workflow": ""
}
```

- `host`：這一間房的預設發言人／頭像；建立時選的角色。
- `cast`：成員（有序，第一個＝房主）；`[]`＝只有房主（舊房間不用補）。
- `sessions`：**房間 → session**。有了它，房間自己講得出「我有哪些 session」，
  不必每次掃 `.sessions/`。
- `.sessions/<sessionId>.json` 保留：它是**反向索引**（agent 只有 session id，
  需要立刻知道是哪一間房）。兩邊是同一段關係的兩個方向；`sessions` 是新的真相，
  `.sessions/` 是可重建的索引。

## 4. 身分與區分

| 東西 | 身分 | 顯示 | 備註 |
|---|---|---|---|
| 酒館 | `taverns.json` 的 `id`（UUID） | `name` ＋ 圖示 | 資料夾可以搬；名冊記路徑 |
| 房間 | `roomId`（時間 base36＋隨機 4 碼） | `room.json.name` | 改名不動路徑；同名可以並存 |
| session | DSH 的 session id | 不直接給使用者看 | 一間房最多 N 個（一個成員一個） |

- **房間清單按 `chat.jsonl` 的 mtime 排**（最後一句話），不是資料夾 mtime
  （改設定、丟圖都會動到資料夾 mtime，排序會亂跳）。
- 名稱重複：id 才是身分；UI 可以在撞名時補上短後綴，但**不要**用名稱當 key。
- 對話頁的「這一間房有誰」讀 `cast`；`cast` 空＝只有 `host`。
- 送訊息那條路用**房主**的 session；工作樓的每顆角色節點用它自己的 session。

## 5. 真相、複本與失敗

**規則（建議寫進 `implementation-spec.md` 的 R 系列）：**

1. **使用者的資料＝酒館資料夾。** `room.json`、`chat.jsonl`、`art/`、`files/`
   是真相；備份、搬移、手改都以這個資料夾為準。
2. **DSH session 是引擎，不是使用者的檔案。** 它住在 `~/.dsh/sessions/`，
   由 DSH 管；酒館只記「這一間房用哪些 session」。
3. **`chat.jsonl` 只增不改。** 一輪結束後把使用者與角色的訊息 append 進去；
   **不寫 DSH 專屬事件**（reasoning、tool call）——那是 R3 的既有規則。
4. **綁定有兩個方向。** `room.json.sessions`（房間→session）是新的真相；
   `.sessions/<sessionId>.json`（session→房間）是 agent 需要的索引，可重建。
   `chat.jsonl` 標頭的 `dsh_session_id` 降級成**最後一道修復麵包屑**。
5. **session 不見了要說出來。** 房間照樣開、歷史照樣看，但標成
   「這個房間的 session 不見了」；送訊息前問一次：
   - **用新 session 繼續**（模型不會記得舊對話——這是事實，不要假裝）；
   - **只看歷史**（不送）。
   不要用「把舊對話再喂一次」假裝續聊：那會多花錢、也改變模型行為。
6. **搬到別台機器**：資料夾帶走＝歷史帶走；session 不帶走（除非另外備份
   `~/.dsh/sessions/`）。打開房間時走第 5 條，不是壞掉。

## 6. 插件有沒有自己的資料庫？

**有「宿主儲存」，但沒有給插件用的使用者資料庫。**

- DSH 宿主有 `ctx.storageDomain`：schema 驗證的 KV，後面可接 JSON 或 SQLite
  後端。桌面版已經掛了 JSON 後端（`~/.dsh/storages/`），workspace 就在用。
  但它是**宿主半專用**（client 半拿不到）、而且是 DSH 自己的資料目錄，
  **不是**酒館資料夾的一部分，也不能跟著酒館帶走。
- DSH 的 session 是 JSONL；另外有 `dsh-session-query-sqlite` 這個查詢索引，
  但那是「搜尋 session」用的，不是插件資料庫。
- 插件 API 沒有「每個插件一個 SQL 資料庫」。真要 SQLite 只能自己 bundle
  （違反零執行期依賴，也破壞可攜性）。
- **酒館的決定：檔案是真相，不引入資料庫。** 需要加速時，只做**可重建的快取**
  （宿主記憶體；要跨重啟就放 `ctx.storageDomain`），而且快取永遠不是真相。
  現在的 `~/.dsh/taverns.json` 是唯一一份全域檔（街的名冊）。

## 7. 遷移：`chats/<角色>/<roomId>` → `rooms/<roomId>`

**一次、冪等、不刪資料。** 觸發點：宿主第一次讀到 `tavern.json` 的
`layout` 小於 3（或沒有 `layout`）。

1. 建 `rooms/`。
2. 掃 `chats/<X>/`：
   - 如果 `<X>/room.json` 存在（上次做到一半）→ 搬到 `rooms/<X>/`。
   - 否則把 `<X>/<Y>/room.json` 的每一個 `<Y>` → 搬到 `rooms/<Y>/`。
3. `room.json` 補上：
   - `host`：舊路徑的 `<X>`（沒有才補；已有就不動）。
   - `cast`：原樣（`[]` 仍是 `[]`）。
   - `sessions`：從 `.sessions/` 找到 `room === <Y>` 的紀錄，按 `character` 分組；
     找不到就從 `chat.jsonl` 標頭補房主那一個。
   - `layout: 3`。
4. `tavern.json` 寫 `layout: 3`。舊的 `chats/<X>/*.jsonl`（2.6 以前的格式）
   **留在原地不動、也不讀**；空的 `<X>/` 可以移除。
5. 中途 crash：`rooms/` 裏已經搬過去的房間不會再搬；`chats/` 裏剩下的下次接著搬。
   **不做覆蓋**：`rooms/<Y>` 已存在就停下來回報，不猜哪一個才對。
6. 資產 owner 從 `chat:<角色>/<roomId>` 改成 `chat:<roomId>`；解析器仍接受兩段
   （舊連結）並取最後一段當 roomId。

> ⚠️ 這是**動使用者資料夾**的一次改動。它只做 `rename`（同一個磁碟分割區上是原子
> 的），不複製、不改內容；任何一個房間搬不動就整批停下來，`layout` 不升級，
> 資料留在原地。

## 8. 要改的檔案

| 檔案 | 動什麼 |
|---|---|
| `lib/workspace.js` | `roomDir` 拿掉角色參數；`createRoom` 建 `rooms/<id>`；`listAllRooms` 掃 `rooms/`、排序看 `chat.jsonl`；`room.json` 的 `host`／`sessions`；遷移 |
| `lib/assets.js` | `chat` 的 owner 改成一段（roomId）；`assetDir` 指向 `rooms/<room>/art` |
| `lib/index.js` | 新 op `street.cards`（一次回每間酒館的卡片：計數＋最近房間）；`tavern.*`／`room.*` 的路徑參數；遷移觸發 |
| `lib/agent.js` | 仍然是 `.sessions/<sessionId>.json`；房間路徑改走 `rooms/` |
| `lib/client.js` | `main:tavern-street` 街頁；`plugins.tab` 分頁；燈籠的 id／選取；酒館頁與對話頁的「上一頁」；房間卡的 cast／時間 |
| `test-workspace.mjs`／`test-client.mjs`／`smoke.mjs` | 路徑、遷移、街頁、session 狀態 |
| `docs/` | 這一頁、`room-layout.md`、`storage-layout.md`、`plan.md` |

## 9. 分期

| 期 | 做什麼 | 為什麼先做 |
|---|---|---|
| **P1** | 街頁（`main:tavern-street`）＋ `plugins.tab` 分頁＋燈籠改指向街；酒館頁／對話頁的上一頁 | 不動資料，先把導航補回來；使用者馬上看到街 |
| **P2** | `room.json` 的 `host`／`sessions`，綁定收斂成「房間→session 是真相、`.sessions` 是索引」 | 不動路徑，先讓「一間房有哪些 session」講得清楚 |
| **P3** | `chats/<角色>/<roomId>` → `rooms/<roomId>` ＋ 遷移 ＋ 資產 owner | 動資料，最後做；有 P2 的 `sessions` 才搬得安全 |
| **P4** | session 不見了的狀態列／「用新 session 繼續」；房間排序看最後一句話 | 把 2.3 的「有歷史但模型不記得」講明白 |
| **P5** | 街的卡片牆（店面圖、計數、最近房間） | 純外觀，等前三期穩定 |

## 10. 已決定（2.8.0）

1. **`rooms/` 改名**：✅ 連 `chats/` 一起改成 `rooms/`。
2. **遷移時機**：✅ 第一次被讀到就自動遷移（`migrateLayout()`，冪等）。
3. **`cast` 空陣列**：✅ 維持 `[]`＝只有房主；遷移只補 `host`。
4. **街的卡片**：✅ 先做簡單卡片（名字／路徑／計數／最近一間房），店面卡片牆留到 P5。

**實作時多做的三件**：

- 舊的「接管側邊欄」整組刪除（不是只停用）；燈籠 id 改成 `tavern-street`。
- `plugins.tab` 分頁與 `main:tavern-street` 共用同一個 `TavernStreetPage`。
- 房間資產的 owner 改成房間 id；舊的 `角色/roomId` 仍然收（取最後一段）。

**還沒做**：舊側邊欄對話列的「分支」搬到房間頁。（P4 的 session 狀態列已補：
進房時讀 `room.json.sessions` ＋ `remote.session.list`，不見了就在送訊息前說；
P5 的店面卡已補：店面圖／遮陽棚、街招、骨架卡；P6 再補牌坊、左右店面、
DSH 原生配色、房間內五個換色 preset。）
