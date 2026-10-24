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

## 二、擺上網（部署）

呢個網站**已經上咗線**：https://nelson0516.github.io/

用嘅係 GitHub Pages —— 免費、唔使另外開帳戶、唔使設定伺服器，
而且每次 `git push` 就會自動重新部署。

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

## 三、長線維護

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

## 四、檔案結構

```text
my-website/
├─ index.html          ← 頁面內容（你大部分時間喺度改）
├─ css/
│  └─ style.css       ← 外觀
├─ js/
│  └─ main.js         ← 互動效果
├─ server.js           ← 本機預覽伺服器（自動 reload）
├─ package.json        ← 專案設定
├─ favicon.svg         ← 網站圖示
├─ .nojekyll           ← 令 GitHub Pages 唔經 Jekyll 處理
├─ .gitignore          ← 唔好提交嘅嘢
└─ README.md           ← 呢份說明
```

---

## 五、常見問題

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

呢個先至係重點。到時需要裝嘢同埋一個後端，可以叫 AI 助手
（例如 Codex）幫手擴充。呢個骨架係特意保持簡單，
方便日後加嘢時唔會要拆重來。
