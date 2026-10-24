#!/usr/bin/env node
'use strict';
/*
 * 網站伺服器 — 零外部依賴，唔使 npm install
 *
 * 做兩件事：
 *   1. 送出網站檔案（HTML、CSS、JS、圖片）
 *   2. 處理 /api/... 嘅會員登入同管理後台
 *
 * 開發時（npm run dev）仲會自動重新載入瀏覽器。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { createDb } = require('./src/db');
const { createApi } = require('./src/api');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'db', 'members.db');
const IS_DEV = process.env.NODE_ENV !== 'production';

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

/* ---------- 開發用：檔案一有改動就重新載入 ---------- */

let version = 0;
let watcher = null;

function startWatching() {
  if (!IS_DEV || watcher) return;
  try {
    watcher = fs.watch(ROOT, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const name = String(filename);
      // 資料庫同 Git 資料夾唔理，唔需要為咗佢哋重新載入
      if (name.startsWith('db') || name.includes('node_modules') || name.includes('.git')) return;
      version += 1;
    });
  } catch {
    // 某啲檔案系統唔支援 recursive watch，唔影響正常使用
  }
}

function stopWatching() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

function reloadSnippet(nonce) {
  return `<script nonce="${nonce}">
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
}

/* ---------- 安全標頭 ---------- */

function securityHeaders(nonce, secure) {
  const csp = [
    "default-src 'self'",
    `script-src 'self'${IS_DEV ? ` 'nonce-${nonce}'` : ''}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  const headers = {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  };

  if (secure) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }

  return headers;
}

/* ---------- 工具 ---------- */

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function isSecure(req) {
  if (req.socket.encrypted) return true;
  const proto = req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',')[0].trim() === 'https';
}

function sendFile(req, res, nonce, secure) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/__ping') {
    const body = String(version);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...securityHeaders(nonce, secure),
    });
    res.end(body);
    return;
  }

  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(ROOT, pathname);

  // 安全檢查：唔准讀到專案以外嘅檔案
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...securityHeaders(nonce, secure),
      });
      res.end('搵唔到呢個檔案：' + pathname);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';

    let body = data;
    if (ext === '.html' && IS_DEV) {
      body = data
        .toString('utf8')
        .replace('</body>', reloadSnippet(nonce) + '\n</body>');
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      ...securityHeaders(nonce, secure),
    });
    res.end(body);
  });
}

/* ---------- 開伺服器 ---------- */

function createServer(db, opts = {}) {
  const handleApi = createApi(db, opts);

  return http.createServer(async (req, res) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    const secure = isSecure(req);

    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (url.pathname.startsWith('/api/')) {
        const ctx = {
          url,
          ip: clientIp(req),
          userAgent: req.headers['user-agent'] || '',
          host: req.headers.host || '',
          secure,
          params: {},
        };

        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        if (secure) {
          res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        const handled = await handleApi(req, res, ctx);
        if (!handled && !res.headersSent) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, message: '冇呢個 API' }));
        }
        return;
      }

      sendFile(req, res, nonce, secure);
    } catch (err) {
      console.error('伺服器錯誤：', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, message: '伺服器出錯' }));
      }
    }
  });
}

async function start() {
  startWatching();
  const db = await createDb({ file: DB_FILE });
  const server = createServer(db);

  await new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${PORT} 已經俾其他程式用緊。\n` +
              `可以用另一個 port 開：PORT=4322 npm run dev`
          )
        );
      } else {
        reject(err);
      }
    });
    server.listen(PORT, HOST, resolve);
  }).catch((err) => {
    stopWatching();
    db.close();
    throw err;
  });

  console.log('');
  console.log('  網站開咗：  http://localhost:' + PORT);
  console.log('  資料庫：    ' + DB_FILE);
  console.log('  按 Ctrl + C 停止');
  console.log('');

  const shutdown = () => {
    stopWatching();
    server.close(() => {
      server.closeAllConnections();
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    console.error('開唔到伺服器：', err);
    process.exit(1);
  });
}

module.exports = { createServer, start, stopWatching, DB_FILE, IS_DEV };
