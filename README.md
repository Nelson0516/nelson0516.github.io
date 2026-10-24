# 我嘅網站

一個用 HTML + CSS + JavaScript 寫嘅個人網站骨架。
冇任何第三方套件，所以日後幾乎唔使維護依賴。

---

## 一、日常流程：改網站

### 1. 開返個網站

打開「終端機」（Terminal，喺 Applications 嘅 Utilities 入面），或者喺 VS Code 入面
撳 `Ctrl + ~` 打開內置終端機，然後：

```bash
cd ~/Documents/Codex/2026-10-24/hi/outputs/my-website
npm run dev
```

跟住用瀏覽器打開 **http://localhost:4321**

> 撳 `Ctrl + C` 就會關掉個網站。

### 2. 改內容

用 VS Code 打開 `my-website` 資料夾（VS Code 開新檔案嗰陣選 "Open Folder"）。

主要要改嘅檔案：

| 檔案 | 改咩 |
|---|---|
| `index.html` | 所有文字內容：名、標題、簡介、作品、聯絡 |
| `css/style.css` | 外觀：顏色、字型、間距。最上面有「設計變數」可以改色調 |
| `js/main.js` | 互動效果 |
| `server.js` | 本機預覽伺服器（一般唔使郁） |

**最常改嘅三樣嘢：**

- 想換主色 → 改 `css/style.css` 最上面 `--accent`（例如 `#0d6e63` 變 `#1d4ed8`）
- 想換深色模式嘅顏色 → 改 `@media (prefers-color-scheme: dark)` 入面
- 想加一個新段落 → 喺 `index.html` 搵返 `<section class="band" id="work">`，
  照住格式加一個新 `<section>`，記得加返 `id`

存咗檔案之後，瀏覽器會**自動重新載入**，唔使手動 refresh。

### 3. 儲存個版本（Git）

呢步好重要。Git 會記低你每次改咗咩，改壞咗可以還原返。

呢個專案已經初始化咗 Git 並且有咗第一個版本。你只需要改返自己嘅名同電郵：

```bash
git config user.name "陳大文"
git config user.email "you@example.com"
```

（如果想在所有專案都生效，兩個 `git config` 後面加 `--global`。）

之後每次改完：

```bash
git add .
git commit -m "更新咗作品列表"
```

寫個易明嘅訊息就可以，日後 `git log` 睇返就知改過咩。

---

## 二、會員系統（登入 + 資料庫）

個網站加咗一套會員系統：可以登入、可以睇返自己嘅資料，
管理員仲可以喺後台睇全部會員同登入紀錄（包括邊個幾點登入、密碼有冇錯）。

### 邊個檔案做咩

| 檔案 | 用途 |
|---|---|
| `db/schema.sql` | 資料庫結構（3 個表：`users` `sessions` `login_logs`） |
| `db/seed.js` | 產生 30 個會員帳戶 |
| `src/auth.js` | 密碼雜湊、session token、密碼強度檢查 |
| `src/db.js` | 資料庫存取層（本機 SQLite / 將來 Cloudflare D1 通用） |
| `src/api.js` | 所有 API：登入、登出、會員中心、管理後台 |
| `server.js` | 伺服器：派網站檔案 + 處理 API |
| `login.html` | 登入頁 |
| `account.html` | 會員中心 |
| `admin.html` | 管理後台 |
| `js/login.js` `js/account.js` `js/admin.js` | 三個頁面嘅互動邏輯 |
| `css/members.css` | 會員系統嘅樣式 |
| `test/api.test.js` | 自動測試（17 個） |

### 開返個網站

同之前一樣：

```bash
cd ~/Documents/Codex/2026-10-24/hi/outputs/my-website
npm run dev
```

打開 **http://localhost:4321/login.html** 就見到登入頁。
首頁右上角有「會員」掣可以跳去。

### 產生 30 個會員

```bash
npm run seed
```

會做兩件事：

1. 喺 `db/members.db` 開 30 個會員帳戶（第一個 `nelson` 係管理員）
2. 將隨機生成嘅初始密碼寫落 `db/initial-passwords.txt`

> **派發之後記得刪走 `db/initial-passwords.txt`。**
> 呢個檔案已經喺 `.gitignore` 入面，唔會上傳到 GitHub，
> 但係派完密碼之後留喺度始終唔安全。密碼本身喺資料庫只存雜湊，
> 就算你想再睇返都睇唔到。

### 圖形化管理資料庫

已經裝咗 **DBeaver Community**（免費開源）。用法：

1. 開 DBeaver → **Database → New Database Connection** → 揀 **SQLite**
2. 揀 `~/Documents/Codex/2026-10-24/hi/outputs/my-website/db/members.db`
3. 撳 Test Connection → Finish

之後就可以用滑鼠直接睇 `users`、`sessions`、`login_logs` 三個表。

> ⚠️ **唔好用 GUI 改密碼或者登入紀錄。** 咁樣會漏咗寫入紀錄，
> 亦可能撞到資料庫鎖。管理會員嘅動作請行返入網頁版後台（`admin.html`），
> GUI 用嚟睇數據同做備份。

想用更簡單嘅工具，可以裝 DB Browser for SQLite：
`brew install --cask db-browser-for-sqlite`

### 資料庫結構

```text
users         會員帳戶：帳戶名、姓名、密碼雜湊、身分、狀態、
              連續失敗次數、鎖定時間、最後登入時間
sessions      登入狀態：只存 token 嘅 SHA-256，7 日後自動失效
login_logs    登入紀錄：幾點、邊個帳戶、成功定失敗、IP、裝置
```

### 安全設計

- **資料庫永遠冇明文密碼。** 用 PBKDF2-HMAC-SHA512、210,000 次迭代（OWASP 建議值），
  每個密碼獨立隨機 salt。連管理員都睇唔返原始密碼。
- **登入紀錄唔會記低輸入咗咩密碼**，只記帳戶名同結果。
- **密碼錯同帳戶唔存在，回覆完全一樣**，防止有人逐個帳戶試出邊個存在。
- **連續錯 5 次鎖 15 分鐘**；同一 IP 每分鐘最多 20 次嘗試。
- **Session token 喺資料庫只存 SHA-256**；cookie 係 `HttpOnly` + `SameSite=Strict` + `Secure`。
- **修改資料嘅請求會檢查來源**（Origin），防止跨站請求偽造。
- **有安全標頭**：CSP、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`。
- **SQL 全部用參數綁定**，唔會有 SQL 注入。

### 自動測試

```bash
npm test
```

會用一個臨時資料庫跑 17 個測試（登入、鎖定、權限、改密、限流、SQL 注入…），
唔會整到正式資料庫。

### 備份

SQLite 嘅備份好簡單 —— 淨係複製一個檔案：

```bash
sqlite3 db/members.db ".backup '~/Desktop/members-backup.db'"
```

> 伺服器開住嗰陣，資料庫有三個檔案：`.db`、`.db-wal`、`.db-shm`。
> 用上面 `.backup` 指令最穩陣，因為佢會將三個檔案嘅內容一齊寫入去。

### ⚠️ GitHub Pages 跑唔到呢部分

GitHub Pages 只係派靜態檔案，冇後端程式，所以**登入系統喺 GitHub Pages 係行唔到**。
要公開使用，需要將網站搬到會行程式嘅地方：

| 方案 | 優點 | 代價 |
|---|---|---|
| **A. 喺你部 Mac mini 行** | 零新帳戶、零月費 | 電腦要開住；要處理外網連線同 HTTPS 證書 |
| **B. Cloudflare Pages + D1** | 全年免費、24 小時唔會斷、HTTPS 自動 | 要開多一個 Cloudflare 免費帳戶 |

如果行方案 B，D1 本身就係 SQLite，`db/schema.sql` 唔使改，
淨係要將 `src/api.js` 改成 Cloudflare Pages Function 嘅寫法。

### 私隱提醒

記錄 30 個人嘅登入時間、IP 同裝置，喺香港《個人資料（私隱）條例》
屬於個人資料。建議：

- 會員名單只畀需要嘅管理員睇
- 定期清理過期嘅登入紀錄（例如只保留 90 日）
- 同會員講清楚會記錄咩資料

### 將來加功能

想加會員自行改密碼、email 驗證、兩步驗證、忘記密碼？
直接講聲，喺呢個基礎上加就得，唔使重頭嚟。

---

## 三、擺上網（部署）

呢個網站**已經上咗線**：https://nelson0516.github.io/

用嘅係 GitHub Pages —— 免費、唔使另外開帳戶、唔使設定伺服器，
而且每次 `git push` 就會自動重新部署。

> ⚠️ 但係**會員系統（登入、資料庫）喺 GitHub Pages 行唔到**，
> 因為 GitHub Pages 只會派靜態檔案，冇後端程式。
> 會員系統而家行喺你部 Mac mini（`npm run dev`）。
> 想公開使用就睇「二、會員系統」入面嘅搬遷選項。

### 步驟 A：首次設定（做一次就得）

1. 去 [github.com](https://github.com) 開個帳戶（用電郵或者 Google 登入都可以）
2. 喺 Terminal 執行：

   ```bash
   cd ~/Documents/Codex/2026-10-24/hi/outputs/my-website

# 話畀 Git 你叫咩名、用咩電郵（email 要同 GitHub 帳戶嗰個一樣）
git config user.name "Nelson Cheung"
git config user.email "11511414+Nelson0516@users.noreply.github.com"

   # 登入 GitHub：會開個瀏覽器畀你撳授權
   gh auth login --git-protocol https --web
   ```

3. 建立 GitHub 專案並推上去（`gh` 會自動幫你接好 remote）：

   ```bash
   gh repo create nelson0516.github.io --public --source=. --remote=origin --push
   ```

   個 repo 名用 `nelson0516.github.io`，GitHub Pages 就會直接用
   **https://nelson0516.github.io/** 做網址，最簡單唔使另外設定。

   > 順帶一提：用 `users.noreply.github.com` 呢種電郵，GitHub 仍然認得係你，
   > 但公開咗嘅 commit 唔會泄露你真實嘅私人電郵地址。

### 步驟 B：開啟 GitHub Pages（自動更新）

去 repo 嘅 **Settings → Pages**，Source 揀 **Deploy from a branch**，
Branch 揀 `main`、folder 揀 `/ (root)`，撳 Save。

或者喺 Terminal 一次搞掂：

```bash
gh api repos/Nelson0516/nelson0516.github.io/pages -X POST \
  -f 'source[branch]=main' -f 'source[path]=/'
```

之後你每次在 Terminal 執行 `git push`，GitHub 會自動重新部署，通常 1–2 分鐘生效。

> **要自訂網域**：去 **Settings → Pages → Custom domain** 加你想用嘅域名，
> 再喺網域註冊商嗰邊將 DNS 指向 GitHub Pages（`username.github.io`）。
> GitHub 免費版提供 HTTPS 證書，唔使另外買。

> **想將 repo 收埋（唔畀人睇 source code）？** GitHub Pages 免費版要求 repo 係公開。
> 如果想收埋 source code 但網站照樣公開，可以改用 Cloudflare Pages 或者 Netlify，
> 佢哋支援 private repo。

### 日後用 `gh` 嘅懶人指令

```bash
gh repo view              # 睇 repo 資料
gh repo open             # 用瀏覽器打開
gh pr list                # 有 pull request 就用
gh auth status            # 睇登入狀態
```

---

## 四、長線維護

### 每月做一次（約 5 分鐘）

```bash
# 1. 檢查有冇新版本
brew outdated

# 2. 更新 Node.js
brew update && brew upgrade node

# 3. 更新 Homebrew 本身
brew update
```

### 每次改完網站之後

1. 喺本地開 `npm run dev`，睇清楚啱唔啱
2. 喺手機都睇一次（手機同電腦連同一個 Wi-Fi，用電腦嘅區域網 IP 加上 `:4321`）
3. `git add .` + `git commit`
4. `git push` → 網站自動更新
5. **去真正嘅網址確認一次**，唔好淨係信本地預覽

### 幾個月一次

- 檢查網站啲連結仲啱唔啱（尤其係電郵地址）
- 試下用 Google 搜尋你個網站名，睇下排名
- 確認域名仲有得續（到期前一個月就要續，唔好等停咗先算）

### 資料安全

- **唔好**將任何密鑰、密碼、API key 放入 `index.html` 然後 commit
- 需要存敏感資料（例如接支付 API）時，用 `.env` 檔案，`.gitignore` 已經幫你擋住唔會意外提交
- `git log` 係公開嘅歷史紀錄，就算而家刪走一個檔案，歷史入面仲係搵得返 —— 所以唔好由頭到尾都靠「刪檔案」嚟保密

---

## 五、檔案結構

```text
my-website/
├─ index.html          ← 頁面內容（你大部分時間喺度改）
├─ login.html          ← 登入頁
├─ account.html        ← 會員中心
├─ admin.html          ← 管理後台
├─ css/
│  ├─ style.css       ← 外觀
│  └─ members.css     ← 會員系統嘅樣式
├─ js/
│  ├─ main.js         ← 首頁互動效果
│  ├─ common.js       ← 共用工具（時間格式、API）
│  ├─ login.js        ← 登入頁邏輯
│  ├─ account.js      ← 會員中心邏輯
│  └─ admin.js        ← 管理後台邏輯
├─ src/
│  ├─ auth.js         ← 密碼雜湊、session
│  ├─ db.js           ← 資料庫存取層
│  └─ api.js          ← 所有 API
├─ db/
│  ├─ schema.sql      ← 資料庫結構
│  ├─ seed.js         ← 產生 30 個會員
│  ├─ members.db      ← 正式資料庫（唔會 commit）
│  └─ initial-passwords.txt ← 初始密碼（唔會 commit，派完就刪）
├─ test/
│  └─ api.test.js     ← 自動測試
├─ server.js           ← 伺服器（派檔案 + 處理 API + 自動 reload）
├─ package.json        ← 專案設定
├─ favicon.svg         ← 網站圖示
├─ .nojekyll           ← 令 GitHub Pages 唔經 Jekyll 處理
├─ .gitignore          ← 唔好提交嘅嘢
└─ README.md           ← 呢份說明
```

---

## 六、常聞問題

**Q: 撳 `npm run dev` 話 `command not found: npm`？**

Node.js 啱啱裝好，Terminal 未重新開。閂咗再開一個 Terminal 就得。

**Q: 顯示 `EADDRINUSE: port 4321 already in use`？**

上一個網站仲開住。搵返個 Terminal 撳 `Ctrl + C`，
或者換個 port：`PORT=5000 npm run dev`

**Q: 改咗 CSS 但畫面冇變？**

硬刷新一下（Mac：`Cmd + Shift + R`），或者檢查下係咪改錯咗檔案。

**Q: 網站上線之後，`npm run dev` 仲有用㗎？**

冇用，亦唔需要。上線咗之後你就唔使再開本機預覽。

**Q: 之後想加功能（例如聯絡表單、會員系統）點算？**

會員系統已經做好咗（見「二、會員系統」）。之後想加聯絡表單、
會員自行改密碼、email 驗證、兩步驗證等等，直接叫 AI 助手（例如 Codex）
幫手擴充就得，唔使拆重嚟。

**Q: 會員密碼唔見咗點算？**

去 `admin.html` 用管理員帳戶登入，喺會員名單嗰行撳「重設密碼」，
會即刻產生一個新密碼畀你。舊密碼即刻失效。
密碼本身係雜湊咗存，連管理員都睇唔返。

**Q: `npm test` 話 listen 唔到？**

測試程式要喺本機開一個臨時 port（127.0.0.1）。
如果係喺沙盒／受限環境入面跑，會被擋住，喺正常 Terminal 度跑就冇問題。

**Q: 點解用 SQLite 唔用 PostgreSQL？**

呢個規模（30 個人、得一個後端程式）SQLite 完全綽綽有餘，
而且慳好多嘢：零背景服務、零開機自動啟動、備份只係複製一個檔案、
冇網絡埠所以攻擊面更細。DBeaver Community 支援所有主流資料庫，
所以將來真係要轉 PostgreSQL 都唔會浪費咗個工具。
