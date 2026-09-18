# 給 AI 的專案指示（dsh-tavern）

這個 repo 是**公開**的。動任何檔案之前先讀完這一頁——DSH 會在每次對話的
第一次請求前自動注入它，所以沒有「我不知道」這個選項。

## 個資紅線

1. **不准寫出真實的使用者名稱或本機絕對路徑。**
   正確寫法：`C:\Users\<你的帳號>\…`、`/Users/<user>/…`、`~/.dsh/…`、
   `link:<你 clone 的位置>`、`<repo 的絕對路徑>`。
2. **不准寫出公司名、內部專案名、客戶名、同事名。**
   要舉例就用「專案A」或 `<公司專案名>`。側邊欄的「工作區名稱」就是內部專案名，
   那也算。
3. **不准把截圖 commit 進 repo。** 截圖裡的側邊欄會顯示工作區名稱與完整路徑，
   那是真實資料。⚠️ GitHub 網頁拖檔上傳**不會**看 `.gitignore`，所以不能靠 ignore。
   要附圖就先裁掉側邊欄，或改用文字描述。
4. **改完要跑 `npm test`。** `verify.mjs` 有個資掃描會擋（路徑形狀 + 本地黑名單）。
5. **講「上次洩漏了什麼」只講形狀，不講內容。**
6. **已經 commit 的洩漏，`force push` 沒有用**——GitHub 會繼續用 SHA 提供舊
   commit 全文（實測回 200 加完整 patch，不是 404）。要嘛刪掉 repo 重建，要嘛寄
   GitHub Support。完整步驟見 `docs/privacy-runbook.md` 第 3 節。

## 動手前的既有約束

- **零執行期依賴**：`lib/*.js` 只准 import `node:` 與自己的相對檔案。
  DSH 的 loader 啟動時同步導入 loader entry，任何一個插件解析失敗，
  **整個 `dsh web` 就起不來**。`verify.mjs` 會強制檢查。
- **兩個面（宿主半／瀏覽器半）＋ Agent 面**，三個版本標記要一起改。
- 改了 `lib/client.js` 可以在真瀏覽器驗；改了 `lib/index.js` 一定要重啟 `dsh web`。

## 文件

- `docs/privacy-runbook.md` — 個資防線與洩漏處理手冊（**先讀這份**）
- `docs/plan.md` — 交接文件
- `docs/implementation-spec.md` — R1–R13 規則與設計理由
