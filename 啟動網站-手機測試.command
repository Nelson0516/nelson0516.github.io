#!/bin/bash
# 雙擊呢個檔案，可以用同一個 Wi-Fi 嘅手機、平板試用網站。
# 關嘅話：喺呢個視窗撳 Control + C
#
# 注意：呢個模式會令同一個 Wi-Fi 入面嘅其他人都打得開個登入頁，
#       試完記得閂咗。資料庫、密碼同原始碼係封鎖咗嘅，
#       其他人只會見到網頁同登入頁，拎唔到會員資料。

cd "$(dirname "$0")" || exit 1

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  搵唔到 Node.js。請先安裝：https://nodejs.org"
  echo ""
  read -r -p "  撣一下撳 Return 關閉…" _
  exit 1
fi

echo ""
echo "  手機測試模式（區域網）。"
if [ -n "$IP" ]; then
  echo ""
  echo "  用手機瀏覽器打開："
  echo "      http://$IP:4321/login.html"
  echo ""
  echo "  （手機要同電腦連同一個 Wi-Fi）"
else
  echo "  搵唔到本機 IP，試下喺系統設定睇。"
fi
echo ""

HOST=0.0.0.0 node server.js

echo ""
echo "  伺服器已停止。"
read -r -p "  撣一下撳 Return 關閉…" _
