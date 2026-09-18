# 給 AI 的專案指示（dsh-tavern）

這個 repo 是**公開**的。動任何檔案之前先讀完這一頁。

## 個資紅線

> 完整版（三道防線與事故處理步驟）：**載入 `privacy-guard` 技能**。

1. **不寫**真實使用者名稱或本機絕對路徑 → 用 `C:\Users\<你的帳號>\`、`/Users/<user>/`、`~/.dsh/`、`link:<你 clone 的位置>`
2. **不寫**公司名／內部專案名／客戶名 → 用「專案A」。⚠️ **側邊欄的「工作區名稱」就是內部專案名**
3. **不 commit 截圖** → 側邊欄會連路徑一起入鏡。⚠️ GitHub 網頁拖檔上傳**不看 `.gitignore`**
4. **改完跑 `npm test`**（`verify.mjs` 有個資掃描會擋）
5. **講「上次洩漏了什麼」只講形狀，不講內容**
6. 已 commit 的洩漏，**`force push` 沒有用**（GitHub 照樣用 SHA 提供全文）→ 刪 repo 重建

## 既有約束

- **零執行期依賴**：`lib/*.js` 只准 import `node:` 與自己的相對檔案。
  宿主半載入失敗 ＝ **整個 `dsh web` 起不來**。`verify.mjs` 強制檢查。
- 三個面（宿主半／瀏覽器半／Agent 面）的版本標記要一起改。
- 改 `lib/client.js` 可在真瀏覽器驗；改 `lib/index.js` **一定要重啟 `dsh web`**。

## 省錢：工具輸出要節制

**每次對話都付這個成本，而且它比上面所有規則加起來還貴。**

- **不要整份 dump。** 用 `Select-String`／`Select-Object -Last N`／`-First N` 只取需要的部分。
  （反例：為了確認「有沒有人在聽 3085」印了 150 行 netstat，其實 2 行就夠。）
- **先過濾再讀檔**：`grep` 找位置 → `read` 只讀那一段，不要整檔讀進來。
- **大的 API／網頁回應先挑欄位**，貼全文會一次吃掉幾十 KB。
- 不確定要不要的輸出，就先不要；需要時再查一次比一次灌進來便宜。

## 文件

- `docs/privacy-runbook.md` — 個資防線與洩漏事故處理手冊
- `docs/plan.md` — 交接文件
- `docs/implementation-spec.md` — R1–R13 規則與設計理由
