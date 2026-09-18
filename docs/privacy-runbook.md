# 個資防線與洩漏處理手冊

> 這份文件的對象是**人和 AI 兩個讀者**。
> 第 0 節是給 AI 的常駐提醒（可直接複製），第 2 節是三道防線，
> 第 3 節是「已經洩漏了怎麼辦」的實戰步驟，第 4 節是踩過的坑。
>
> ⚠️ **這份文件自己必須遵守它描述的規則。** 它被我寫在一個公開 repo 裡，
> 所以底下所有例子一律用樣板（`<你的帳號>`、`<公司專案名>`），
> 沒有任何一個真實的使用者名稱或專案名。`npm test` 會強制檢查這件事。

---

## 0. 給 AI 的常駐提醒

複製下面整段。它可以放在三個地方，效果由強到弱：

| 放哪裡 | 誰會讀到 | 進版控？ |
|---|---|---|
| `AGENTS.md`（repo 根目錄） | **DSH 每次對話自動注入**，不用手貼 | ✅ 要 |
| `AGENTS.local.md` | 同上，但只在你這台機器 | ❌ **不要**（個人覆蓋層） |
| `~/.dsh/AGENTS.md` | 你所有專案的所有對話 | ❌ 不在 repo 裡 |

```
【個資紅線 — 動這個 repo 的每一次都要遵守】

1. 不准在任何會被 commit 的檔案裡寫出真實的使用者名稱或本機絕對路徑。
   正確寫法：C:\Users\<你的帳號>\…、/Users/<user>/…、~/.dsh/…、
            link:<你 clone 的位置>、<repo 的絕對路徑>
2. 不准寫出公司名、內部專案名、客戶名、同事名。要舉例就用「專案A」或
   <公司專案名>。側邊欄的「工作區名稱」就是內部專案名，那也算。
3. 不准把截圖 commit 進 repo。截圖裡的側邊欄會顯示工作區名稱與完整路徑，
   那是真實資料。要附圖就先裁掉側邊欄，或改用文字描述。
4. 改完檔案要跑 npm test（verify.mjs 有個資掃描，會擋）。
5. 要講「上次洩漏了什麼」的時候，只講形狀，不要講內容。
6. 如果發現洩漏已經 commit 了：**force push 沒有用**，GitHub 會繼續用
   SHA 提供舊 commit 全文。要嘛刪掉 repo 重建，要嘛寄 GitHub Support。
   完整步驟見 docs/privacy-runbook.md 第 3 節。
```

DSH 的 `dsh-agent-instructions` 會在**第一次模型請求前**把 `AGENTS.md` 當成
baseline 注入，而且當 `read`／`write`／`edit` 碰到子目錄裡的 `AGENTS.md` 時
會**動態補進來**（所以子目錄可以放更嚴的規則）。單檔上限 1 MiB——
放進去的每個字都會佔每次對話的 context，寫重點就好。

---

## 1. 會洩漏的三種東西

| 種類 | 長什麼樣 | 為什麼會發生 |
|---|---|---|
| **絕對路徑** | `C:\Users\<你的帳號>\...`、`/Users/<user>/...` | 寫文件圖方便，直接貼了終端機的路徑 |
| **名稱** | 公司名、內部專案名、客戶名 | 貼側邊欄截圖、或拿真實專案當例子 |
| **截圖** | `.png` | 畫面裡有工作區名稱、路徑、檔案清單 |

真實案例（這個 repo 自己）：交接文件 `docs/plan.md` 有 9 處完整家目錄路徑
（夾帶使用者名稱），`docs/` 底下 8 張截圖全部要修；第一顆 commit 的 README
示意圖裡還貼了側邊欄的**公司專案名稱**。

**這三種的共同點**：它們在你看畫面的時候「看起來只是路徑／只是示意圖」，
要等到 repo 公開之後才會變成「我公開了我的帳號和公司在做什麼」。

---

## 2. 三道防線

### 2.1 第一道：寫的時候（最有效）

- 路徑一律寫樣板：`C:\Users\<你的帳號>\`、`/Users/<user>/`、`~/.dsh/`、
  `link:<你 clone 的位置>`
- 舉例一律用假名：「專案A」「角色B」「<公司專案名>」
- 要放圖就先裁掉側邊欄

### 2.2 第二道：`npm test` 的個資掃描

`verify.mjs` 有兩層掃描，掃 repo 底下所有 `.md`／`.js`／`.mjs`／`.json`／
`.yml`／`.yaml`／`.txt`（跳過 `.git`、`node_modules`）：

**掃描 A — 家目錄形狀的路徑。** 三個正則：

```
/Users/<名字>          /home/<名字>          C:\Users\<名字>
```

字元類別**刻意排除 `<` 和 `>`**，所以 `C:\Users\<你的帳號>` 這種樣板不會誤判——
這正是我們想推廣的寫法，掃描必須放它過。

**掃描 B — 本地黑名單。** 讀 `.privacy-denylist.txt`（**已 gitignore**，
一行一個詞，`#` 開頭是註解）。

為什麼黑名單要放本機而不是進版控：**黑名單本身就是機密**。把公司名寫進
一個公開檔案來「防止公司名外洩」，是自相矛盾——你會親手把要保護的字串
commit 出去。

沒有這個檔案時這條會顯示「略過」而不是失敗，新 clone 的人不會因為沒有你的
私人黑名單而跑不過檢查。兩台機器要各自建一份。

掃描**不適用**於三個檔案：`.privacy-denylist.txt`（它就是清單本身）、
`AGENTS.local.md`、`CLAUDE.local.md`（gitignored 的個人覆蓋層）——
掃一個不可能被 commit 的檔案沒有意義。

### 2.3 第三道：上傳的時候（最容易被忽略）

> **GitHub 網頁拖檔案上傳不會看 `.gitignore`。**

`.gitignore` 只對 `git add` 有效。用瀏覽器拖一張 PNG 進 issue／README，
它會直接變成 repo 的內容。截圖裡的側邊欄有公司專案名和完整路徑，
`.gitignore` 擋不住這條路。

所以：**圖片一律用文字描述或裁圖**，不要靠 ignore。

---

## 3. 洩漏事故處理手冊

### 步驟 0 — 先確認範圍，不要急著改

```powershell
# 哪幾顆 commit 碰過這個字串（-S 是「新增或刪除該字串」）
& $git -C $repo log --all -S'<關鍵字>' --oneline

# 目前的工作區還有沒有
& $git -C $repo grep -n '<關鍵字>'
```

同時確認暴露面：repo 是 public 還是 private、有幾個 fork。**有 fork 就代表
別人手上有一份，重寫救不回來**——那種情況只能直接刪掉重來，或假設它已經外流。

```powershell
# fork 數、star 數、有沒有 releases／issues（決定刪掉重建的代價）
# https://api.github.com/repos/<owner>/<repo>
```

### 步驟 1 — 本地壓成一個乾淨的 commit

用 `--orphan` 開一個**沒有父節點**的新分支，把目前的工作區內容重刷一顆：

```powershell
$git  = 'C:\Users\<你的帳號>\AppData\Local\Atlassian\SourceTree\git_local\cmd\git.exe'
$repo = '<repo 的絕對路徑>'

# 先把「目前 HEAD 是乾淨的」確認掉（否則只是把髒東西原封不動搬過來）
& $git -C $repo grep -l '<關鍵字>' HEAD      # 不該有輸出

& $git -C $repo checkout --orphan clean
& $git -C $repo add -A
& $git -C $repo commit -m '<訊息>'

# 關鍵驗證：新 commit 跟舊 HEAD 的差異，應該「只有你預期的那幾個檔案」
& $git -C $repo diff --stat <舊 HEAD> HEAD
```

這一步的驗證很重要：如果 diff 冒出你沒預期的檔案，代表 `--orphan` 之後
stage 的內容跟你以為的不一樣。

### 步驟 2 — 換掉 main 並推送

```powershell
& $git -C $repo branch -D main
& $git -C $repo branch -m main

$env:GIT_TERMINAL_PROMPT = '0'
& $git -C $repo push --force origin main
```

> **如果 push 失敗在 TLS 而不是認證**：`schannel: AcquireCredentialsHandle
> failed: SEC_E_NO_CREDENTIALS` 或 `CreateFileMapping ... Win32 error 5`，
> 那是**沙箱**（agent 的檔案／處理程序限制）擋住了 git 的憑證 helper 和
> Windows 憑證存放區，不是 git 壞了、也不是你的 token 過期。
> 換 `-c http.sslBackend=openssl` 只會換一個症狀（credential helper 是 shell
> script，一樣跑不起來）。這件事需要放寬 agent 的權限才有解。

### 步驟 3 — ⚠️ 驗證「遠端是不是真的清了」（最重要的一步）

**`git push --force` 只移除「指標」，不會刪掉 GitHub 上的物件。**
舊 commit 不再被任何分支指向，但只要你還記得 SHA，它**照樣整份讀得出來**——
包含完整的 patch 全文。

```powershell
# 200 = 東西還在（API 會把 commit 全文吐回來）
# 422 = 真的沒了
# https://api.github.com/repos/<owner>/<repo>/commits/<舊的完整 SHA>
```

實測：force push 之後打舊 SHA，回的是 **200 加上完整的 patch 內容**，
不是 404。所以「推上去了、分支看起來乾淨」**不能**當成完成。

其他要一起看的：

```powershell
# 這顆 commit 的 node_id 有沒有換（C_kwDO<base64 的 repo id>…）
# repo 的 size 有沒有掉（沒掉就代表舊物件還在帳上）
# https://api.github.com/repos/<owner>/<repo>
```

### 步驟 4 — 徹底清除：刪掉 repo 重建

唯一保證清乾淨的方法。**先算代價**：

| 看什麼 | 為什麼 |
|---|---|
| `forks_count` | 不是 0 就代表別人有一份，重建也救不回來 |
| `stargazers_count`／`subscribers_count` | 重建會歸零 |
| `open_issues_count`／`/releases` | 重建會全部消失 |

代價可以接受就做：

1. `https://github.com/<owner>/<repo>/settings` → 最底 **Danger Zone**
   → **Delete this repository** → 依指示輸入 `<owner>/<repo>` 確認
2. **馬上** `https://github.com/new` 建一個同名、同 visibility 的 repo，
   ⚠️ **不要勾** Add a README／.gitignore／license——要完全空的，否則推上去會撞
3. 推回去：

```powershell
& $git -C $repo push -u origin main
```

**commit 的 SHA 不會變**（內容定址：內容一樣，雜湊就一樣），所以
`github.com/<owner>/<repo>/commit/<sha>` 這種連結照樣有效。

不想刪 repo 的另一條路：寄 GitHub Support 要求清除不可達物件（unreachable
objects）。保留 stars／issues，但要等幾天，而且不保證一定執行。

### 步驟 5 — 本地也清掉

```powershell
& $git -C $repo reflog expire --expire=now --all
& $git -C $repo gc --prune=now
```

reflog 會讓「已經刪掉的 commit」繼續活著，所以要連它一起過期。

### 步驟 6 — 最終驗證

```powershell
# 1. 本地只剩一顆 commit、一個 ref
& $git -C $repo log --oneline --all
& $git -C $repo show-ref

# 2. 舊 commit 在本地也查不到了
& $git -C $repo cat-file -t <舊 SHA>        # 應該是 fatal: Not a valid object name

# 3. 物件庫縮小了
& $git -C $repo count-objects -vH

# 4. 遠端：舊 SHA 回 422，commits 列表只有一顆
```

---

## 4. 踩過的坑

| 坑 | 真相 |
|---|---|
| 「force push 就清掉了」 | **沒有。** 舊 SHA 照樣回 200 加完整內容。要驗，不要猜 |
| `.gitignore` 有 `*.png` 就安全 | **沒有。** GitHub 網頁拖檔上傳不看 `.gitignore` |
| 把黑名單 commit 進 repo 來防外洩 | 自相矛盾——你會親手把要保護的字串公開 |
| 只掃「家目錄形狀」的路徑 | 抓不到公司名／專案名。實際洩漏的那一次正是後者，掃描放它過了 |
| `git log -S` 只掃得到「新增／刪除」 | 字串只是被搬動位置的話 `-S` 不會回報，要搭配 `git grep` 逐版本掃 |
| 重寫歷史後舊的安裝網址 | `.../archive/<舊 SHA>.tar.gz` 會 404。已裝好的 `node_modules` 照常運作，但重裝會失敗 |
| 沙箱裡的 push 失敗 | `SEC_E_NO_CREDENTIALS`／`CreateFileMapping error 5` 是權限問題，不是 git 或 token 的問題 |
| 兩台機器共用一個 repo | 黑名單、`AGENTS.local.md`、`.privacy-denylist.txt` 都是本機檔，**每台都要各建一份** |

---

## 5. 定期自我檢查

```powershell
# 這份文件有沒有自己犯規（應該要過）
node verify.mjs

# 整個 repo 的完整測試（verify 是第一關）
npm test
```

要新增一個黑名單詞的時候，寫進 `.privacy-denylist.txt` 就好——**不要**
寫進這份文件、README、或任何進版控的地方。
