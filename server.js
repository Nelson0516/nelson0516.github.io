#!/usr/bin/env node
/*
 * 本地預覽伺服器 — 零外部依賴，唔使 npm install
 * 用途：改完檔案，瀏覽器自動重新載入
 * 開法：npm run dev
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// 檔案一有改動就遞加版本號，瀏覽器見到版本號不同就自動 reload
let version = 0;
try {
  fs.watch(ROOT, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    if (filename.includes('node_modules') || filename.includes('.git')) return;
    version += 1;
  });
} catch {
  // 某些檔案系統唔支援 recursive watch，唔影響一般使用
}

const RELOAD_SNIPPET = `<script>
(() => {
  let last = null;
  setInterval(async () => {
    try {
      const res = await fetch('/__ping', { cache: 'no-store' });
      const now = await res.text();
      if (last !== null && now !== last) location.reload();
      last = now;
    } catch (e) {}
  }, 600);
})();
</script>`;

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  // 自動重新載入用的心跳
  if (pathname === '/__ping') {
    return send(res, 200, String(version), 'text/plain; charset=utf-8');
  }

  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(ROOT, pathname);
  // 安全檢查：唔准讀到專案以外嘅檔案
  if (!filePath.startsWith(ROOT)) {
    return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, '搵唔到呢個檔案：' + pathname, 'text/plain; charset=utf-8');
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';

    if (ext === '.html') {
      const html = data.toString('utf8').replace('</body>', RELOAD_SNIPPET + '\n</body>');
      return send(res, 200, html, type);
    }
    send(res, 200, data, type);
  });
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  網站開咗：  http://localhost:' + PORT);
  console.log('  按 Ctrl + C 停止');
  console.log('');
});
