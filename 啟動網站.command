#!/bin/bash
# 雙擊呢個檔案就可以開個網站。
# 關嘅話：喺呢個視窗撳 Control + C

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  搵唔到 Node.js。"
  echo "  請先安裝：https://nodejs.org 或者用 Homebrew：brew install node"
  echo ""
  read -r -p "  撣一下撳 Return 關閉…" _
  exit 1
fi

echo ""
echo "  正在啟動網站…"
echo ""

if lsof -nP -iTCP:4321 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  ⚠️  Port 4321 已經俾其他程式用緊。"
  echo "     如果係之前開咗嘅伺服器，撳 Control + C 關咗佢先。"
  echo ""
  read -r -p "  撣一下撳 Return 關閉…" _
  exit 1
fi

node server.js

echo ""
echo "  伺服器已停止。"
read -r -p "  撣一下撳 Return 關閉…" _
