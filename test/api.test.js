'use strict';
/*
 * 會員系統測試
 * 開法：npm test
 *
 * 用一個臨時資料庫，唔會整到正式嗰個。
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDb } = require('../src/db');
const { createServer } = require('../server');
const auth = require('../src/auth');

const ADMIN_PW = 'admin-secret-2026';
const MEMBER_PW = 'member-secret-2026';

let server;
let db;
let base;
let tmpDir;

async function req(method, urlPath, options = {}) {
  const headers = Object.assign({}, options.headers);
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.cookie) headers.Cookie = options.cookie;

  const res = await fetch(base + urlPath, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual',
  });

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  const setCookie = res.headers.getSetCookie();
  const jar = setCookie.map((c) => c.split(';')[0]).join('; ');

  return { status: res.status, data, setCookie, cookie: jar };
}

async function addUser(username, password, role = 'member', name = '測試會員') {
  const hash = await auth.hashPassword(password);
  const result = await db.run(
    'INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, ?)',
    [username, name, hash, role]
  );
  return result.lastInsertRowid;
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'members-test-'));
  db = await createDb({ file: path.join(tmpDir, 'test.db') });

  await addUser('admin', ADMIN_PW, 'admin', '管理員');
  await addUser('member', MEMBER_PW, 'member', '會員甲');

  server = createServer(db, { rateLimit: 1000 });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('密碼啱可以登入，會派 session cookie', async () => {
  const res = await req('POST', '/api/login', {
    body: { username: 'member', password: MEMBER_PW },
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.user.username, 'member');
  assert.equal(res.data.redirect, '/account.html');

  assert.ok(res.setCookie.length > 0, '應該有 Set-Cookie');
  assert.match(res.setCookie[0], /^sid=/);
  assert.match(res.setCookie[0], /HttpOnly/);
  assert.match(res.setCookie[0], /SameSite=Strict/);
});

test('帶住 cookie 就查得到自己', async () => {
  const login = await req('POST', '/api/login', {
    body: { username: 'member', password: MEMBER_PW },
  });
  const me = await req('GET', '/api/me', { cookie: login.cookie });

  assert.equal(me.status, 200);
  assert.equal(me.data.user.name, '會員甲');
});

test('未登入就查唔到自己', async () => {
  const res = await req('GET', '/api/me');
  assert.equal(res.status, 401);
});

test('密碼錯同帳戶唔存在，回覆一模一樣', async () => {
  const wrong = await req('POST', '/api/login', {
    body: { username: 'member', password: 'wrong-password-000' },
  });
  const unknown = await req('POST', '/api/login', {
    body: { username: 'no-such-person', password: 'wrong-password-000' },
  });

  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.data.message, unknown.data.message);
});

test('資料庫永遠冇明文密碼', async () => {
  const rows = await db.all('SELECT username, password_hash FROM users');
  for (const row of rows) {
    assert.ok(!row.password_hash.includes(MEMBER_PW), '唔應該有明文密碼');
    assert.ok(!row.password_hash.includes(ADMIN_PW), '唔應該有明文密碼');
    assert.match(row.password_hash, /^pbkdf2-sha512\$\d+\$/);
  }
});

test('連續錯 5 次會鎖 15 分鐘', async () => {
  await addUser('lockme', 'lockme-secret-2026', 'member', '鎖定測試');

  for (let i = 0; i < 5; i++) {
    const res = await req('POST', '/api/login', {
      body: { username: 'lockme', password: 'definitely-wrong' },
    });
    assert.equal(res.status, 401);
  }

  const locked = await req('POST', '/api/login', {
    body: { username: 'lockme', password: 'lockme-secret-2026' },
  });
  assert.equal(locked.status, 423, '第 6 次應該顯示鎖定');
  assert.match(locked.data.message, /鎖定/);

  const row = await db.get(
    'SELECT locked_until, failed_count FROM users WHERE username = ?',
    ['lockme']
  );
  assert.ok(row.locked_until, '應該有鎖定時間');
  assert.equal(row.failed_count, 5);
});

test('一般會員入唔到管理 API', async () => {
  const login = await req('POST', '/api/login', {
    body: { username: 'member', password: MEMBER_PW },
  });

  const users = await req('GET', '/api/admin/users', { cookie: login.cookie });
  assert.equal(users.status, 403);

  const logs = await req('GET', '/api/admin/logs', { cookie: login.cookie });
  assert.equal(logs.status, 403);

  const nobody = await req('GET', '/api/admin/users');
  assert.equal(nobody.status, 401);
});

test('管理員可以睇會員名單同登入紀錄', async () => {
  const login = await req('POST', '/api/login', {
    body: { username: 'admin', password: ADMIN_PW },
  });

  const users = await req('GET', '/api/admin/users', { cookie: login.cookie });
  assert.equal(users.status, 200);
  assert.ok(users.data.users.length >= 3);

  const logs = await req('GET', '/api/admin/logs', { cookie: login.cookie });
  assert.equal(logs.status, 200);
  assert.ok(logs.data.logs.length > 0);
});

test('登入紀錄有記低成功同失敗，但冇記低密碼', async () => {
  const login = await req('POST', '/api/login', {
    body: { username: 'admin', password: ADMIN_PW },
  });
  const logs = await req('GET', '/api/admin/logs?limit=200', { cookie: login.cookie });

  const reasons = new Set(logs.data.logs.map((l) => l.reason));
  assert.ok(reasons.has('ok'), '應該有成功紀錄');
  assert.ok(reasons.has('wrong_password'), '應該有密碼錯誤紀錄');
  assert.ok(reasons.has('unknown_user'), '應該有帳戶不存在紀錄');

  const raw = JSON.stringify(logs.data);
  assert.ok(!raw.includes(MEMBER_PW), '紀錄唔應該出現密碼');
  assert.ok(!raw.includes('definitely-wrong'), '紀錄唔應該出現輸入咗嘅密碼');
});

test('管理員可以新增會員，新會員即刻可以登入', async () => {
  const login = await req('POST', '/api/login', {
    body: { username: 'admin', password: ADMIN_PW },
  });

  const created = await req('POST', '/api/admin/users', {
    cookie: login.cookie,
    body: { username: 'newbie', name: '新會員', role: 'member' },
  });

  assert.equal(created.status, 201);
  assert.ok(created.data.password, '應該回傳一次性密碼');

  const loginNew = await req('POST', '/api/login', {
    body: { username: 'newbie', password: created.data.password },
  });
  assert.equal(loginNew.status, 200);
});

test('重設密碼之後，舊密碼即刻失效', async () => {
  const admin = await req('POST', '/api/login', {
    body: { username: 'admin', password: ADMIN_PW },
  });
  const row = await db.get('SELECT id FROM users WHERE username = ?', ['newbie']);

  const reset = await req('POST', `/api/admin/users/${row.id}/reset-password`, {
    cookie: admin.cookie,
  });
  assert.equal(reset.status, 200);
  assert.ok(reset.data.password);

  const withNew = await req('POST', '/api/login', {
    body: { username: 'newbie', password: reset.data.password },
  });
  assert.equal(withNew.status, 200);

  const row2 = await db.get('SELECT id FROM users WHERE username = ?', ['newbie']);
  const reset2 = await req('POST', `/api/admin/users/${row2.id}/reset-password`, {
    cookie: admin.cookie,
  });
  const withOld = await req('POST', '/api/login', {
    body: { username: 'newbie', password: reset.data.password },
  });
  assert.equal(withOld.status, 401, '舊密碼應該用唔到');
  assert.ok(reset2.data.password);
});

test('停用會員之後就登入唔到', async () => {
  const admin = await req('POST', '/api/login', {
    body: { username: 'admin', password: ADMIN_PW },
  });
  const row = await db.get('SELECT id FROM users WHERE username = ?', ['newbie']);

  const off = await req('PATCH', `/api/admin/users/${row.id}`, {
    cookie: admin.cookie,
    body: { is_active: false },
  });
  assert.equal(off.status, 200);

  const row2 = await db.get('SELECT id FROM users WHERE username = ?', ['newbie']);
  const reset = await req('POST', `/api/admin/users/${row2.id}/reset-password`, {
    cookie: admin.cookie,
  });
  const blocked = await req('POST', '/api/login', {
    body: { username: 'newbie', password: reset.data.password },
  });
  assert.equal(blocked.status, 403);
  assert.match(blocked.data.message, /停用/);
});

test('登出之後 session 立即失效', async () => {
  const login = await req('POST', '/api/login', {
    body: { username: 'member', password: MEMBER_PW },
  });
  assert.equal((await req('GET', '/api/me', { cookie: login.cookie })).status, 200);

  const out = await req('POST', '/api/logout', { cookie: login.cookie });
  assert.equal(out.status, 200);

  assert.equal((await req('GET', '/api/me', { cookie: login.cookie })).status, 401);
});

test('來源唔啱嘅修改請求會被擋住', async () => {
  const login = await req('POST', '/api/login', {
    body: { username: 'admin', password: ADMIN_PW },
  });

  const res = await req('POST', '/api/admin/users', {
    cookie: login.cookie,
    headers: { Origin: 'https://example.com' },
    body: { username: 'hacker', name: '壞人' },
  });
  assert.equal(res.status, 403);
});

test('同一 IP 嘗試太密會被限流', async () => {
  const limitedDb = await createDb({ file: path.join(tmpDir, 'limit-test.db') });
  await addUser('ratelimit', 'ratelimit-secret-2026', 'member', '限流測試');

  const limitedServer = createServer(limitedDb, { rateLimit: 3 });
  await new Promise((resolve, reject) => {
    limitedServer.once('error', reject);
    limitedServer.listen(0, '127.0.0.1', resolve);
  });
  const savedBase = base;
  base = `http://127.0.0.1:${limitedServer.address().port}`;

  let sawLimit = false;
  for (let i = 0; i < 6; i++) {
    const res = await req('POST', '/api/login', {
      body: { username: 'ratelimit', password: 'wrong' },
    });
    if (res.status === 429) {
      sawLimit = true;
      break;
    }
  }

  base = savedBase;
  limitedServer.closeAllConnections();
  await new Promise((resolve) => limitedServer.close(resolve));
  limitedDb.close();

  assert.ok(sawLimit, '應該有回 429');
});

test('管理員唔可以停用自己', async () => {
  const login = await req('POST', '/api/login', {
    body: { username: 'admin', password: ADMIN_PW },
  });
  const row = await db.get('SELECT id FROM users WHERE username = ?', ['admin']);

  const res = await req('PATCH', `/api/admin/users/${row.id}`, {
    cookie: login.cookie,
    body: { is_active: false },
  });
  assert.equal(res.status, 400);
});

test('SQL 都係注入唔到', async () => {
  const res = await req('POST', '/api/login', {
    body: { username: "admin' OR '1'='1", password: 'whatever-123' },
  });
  assert.equal(res.status, 401);

  const count = await db.get('SELECT COUNT(*) AS n FROM users');
  assert.ok(count.n > 0);
});

test('資料庫、密碼檔、原始碼唔可以由網頁攞走', async () => {
  const sensitive = [
    '/db/initial-passwords.txt',
    '/db/members.db',
    '/db/members.db-wal',
    '/db/members.db-shm',
    '/server.js',
    '/src/db.js',
    '/src/auth.js',
    '/src/api.js',
    '/test/api.test.js',
    '/package.json',
    '/.gitignore',
    '/.env',
    '/db/../db/members.db',
    // macOS 檔案系統唔分大小寫，所以大小寫變體都要擋
    '/DB/initial-passwords.txt',
    '/DB/members.db',
    '/Db/Members.db',
    '/SERVER.JS',
    '/SRC/db.js',
    '/Package.json',
  ];

  for (const p of sensitive) {
    const res = await fetch(base + p);
    assert.equal(res.status, 403, `${p} 應該被擋，唔應該派出去`);
  }
});

test('正常嘅網站檔案照樣派得出去', async () => {
  const publicFiles = [
    '/',
    '/index.html',
    '/login.html',
    '/account.html',
    '/admin.html',
    '/assets.html',
    '/css/style.css',
    '/css/members.css',
    '/css/assets.css',
    '/js/main.js',
    '/js/common.js',
    '/js/login.js',
    '/js/account.js',
    '/js/admin.js',
    '/js/assets.js',
    '/favicon.svg',
  ];

  for (const p of publicFiles) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, `${p} 應該派得出去`);
  }
});
