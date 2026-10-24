'use strict';
/*
 * API 路由：會員登入、登出、會員中心同管理員後台
 *
 * 安全設計重點：
 *   - 密碼只存 PBKDF2 雜湊，資料庫永遠冇明文
 *   - 登入紀錄只記「邊個帳戶、幾點、成功定失敗」，
 *     永遠唔會記低對方輸入咗咩密碼
 *   - 密碼錯同帳戶唔存在，回覆完全一樣，避免有人逐個帳戶試
 *   - 連續錯 5 次鎖 15 分鐘；同一 IP 每分鐘最多 20 次嘗試
 *   - Session token 喺資料庫只存 SHA-256，cookie 本身 HttpOnly
 */

const auth = require('./auth');

const SESSION_COOKIE = 'sid';
const MAX_FAILED = 5;           // 連續錯幾多次就鎖
const LOCK_MINUTES = 15;        // 鎖幾耐
const RATE_LIMIT = 20;          // 同一 IP 每分鐘最多試幾多次
const RATE_WINDOW_MS = 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const SESSION_MAX_AGE = 7 * 24 * 3600;

const GENERIC_FAIL = '帳戶或密碼不正確';

/* ---------- 小工具 ---------- */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function utcNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function utcInMinutes(minutes) {
  return new Date(Date.now() + minutes * 60000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

/** 將 SQLite 嘅 UTC 時間字串轉成毫秒時間戳 */
function parseUtc(text) {
  if (!text) return null;
  const ms = Date.parse(text.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : null;
}

function json(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(extraHeaders || {}),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('bad_json'));
      }
    });
    req.on('error', reject);
  });
}

function buildCookie(name, value, maxAge, secure) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/* ---------- 每 IP 登入限流 ---------- */

function rateLimitOk(buckets, ip, limit) {
  const now = Date.now();

  // 順手清走過期嘅桶，唔好無限脹大
  if (buckets.size > 500) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/* ---------- 資料存取 ---------- */

async function logAttempt(db, entry) {
  await db.run(
    `INSERT INTO login_logs
       (username_attempted, user_id, succeeded, reason, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entry.username,
      entry.userId ?? null,
      entry.succeeded ? 1 : 0,
      entry.reason,
      entry.ip ?? null,
      entry.userAgent ?? null,
    ]
  );
}

async function getSessionUser(db, req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const tokenHash = await auth.hashToken(token);
  const row = await db.get(
    `SELECT s.token_hash, s.expires_at,
            u.id, u.username, u.name, u.role, u.is_active, u.last_login_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [tokenHash]
  );
  if (!row) return null;
  if (!row.is_active) return null;

  const expires = parseUtc(row.expires_at);
  if (expires === null || expires < Date.now()) {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    return null;
  }
  return row;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    is_active: !!user.is_active,
    last_login_at: user.last_login_at ?? null,
  };
}

/* ---------- 處理器 ---------- */

async function handleLogin(db, req, res, ctx) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { ok: false, message: '送過嚟嘅資料唔完整' });
  }

  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!username || !password) {
    return json(res, 400, { ok: false, message: '請填埋帳戶名同密碼' });
  }

  if (!rateLimitOk(ctx.buckets, ctx.ip, ctx.rateLimit)) {
    await logAttempt(db, {
      username,
      reason: 'rate_limited',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return json(res, 429, { ok: false, message: '嘗試太密，請等一分鐘再試' });
  }

  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

  if (!user) {
    // 帳戶唔存在：照樣做晒啱當嘅運算，令回應時間睇唔出分別
    await auth.dummyVerify(password);
    await logAttempt(db, {
      username,
      reason: 'unknown_user',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return json(res, 401, { ok: false, message: GENERIC_FAIL });
  }

  const lockedUntil = parseUtc(user.locked_until);
  if (lockedUntil !== null && lockedUntil > Date.now()) {
    await auth.dummyVerify(password);
    await logAttempt(db, {
      username,
      userId: user.id,
      reason: 'locked',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    const mins = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));
    return json(res, 423, {
      ok: false,
      message: `呢個帳戶暫時鎖定咗，仲有約 ${mins} 分鐘。唔通就搵管理員。`,
    });
  }

  const correct = await auth.verifyPassword(password, user.password_hash);

  if (!correct) {
    const failed = (user.failed_count || 0) + 1;
    if (failed >= MAX_FAILED) {
      await db.run(
        'UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?',
        [failed, utcInMinutes(LOCK_MINUTES), user.id]
      );
    } else {
      await db.run('UPDATE users SET failed_count = ? WHERE id = ?', [failed, user.id]);
    }
    await logAttempt(db, {
      username,
      userId: user.id,
      reason: 'wrong_password',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    // 同「帳戶唔存在」嘅回覆一模一樣，唔會透露帳戶係咪真係存在
    return json(res, 401, { ok: false, message: GENERIC_FAIL });
  }

  if (!user.is_active) {
    await logAttempt(db, {
      username,
      userId: user.id,
      reason: 'inactive',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return json(res, 403, { ok: false, message: '呢個帳戶已經停用，請搵管理員' });
  }

  // 登入成功
  await db.run(
    'UPDATE users SET failed_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?',
    [utcNow(), user.id]
  );

  const token = auth.newSessionToken();
  const tokenHash = await auth.hashToken(token);
  await db.run(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [tokenHash, user.id, auth.sessionExpiry(), ctx.ip, ctx.userAgent]
  );

  await logAttempt(db, {
    username,
    userId: user.id,
    succeeded: 1,
    reason: 'ok',
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return json(
    res,
    200,
    {
      ok: true,
      user: publicUser(user),
      redirect: user.role === 'admin' ? '/admin.html' : '/account.html',
    },
    { 'Set-Cookie': buildCookie(SESSION_COOKIE, token, SESSION_MAX_AGE, ctx.secure) }
  );
}

async function handleLogout(db, req, res, ctx) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    const tokenHash = await auth.hashToken(token);
    await db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
  }
  return json(
    res,
    200,
    { ok: true },
    { 'Set-Cookie': buildCookie(SESSION_COOKIE, '', 0, ctx.secure) }
  );
}

async function handleMe(db, req, res) {
  const user = await getSessionUser(db, req);
  if (!user) return json(res, 401, { ok: false, message: '未登入' });
  return json(res, 200, { ok: true, user: publicUser(user) });
}

async function requireAdmin(db, req, res) {
  const user = await getSessionUser(db, req);
  if (!user) {
    json(res, 401, { ok: false, message: '未登入' });
    return null;
  }
  if (user.role !== 'admin') {
    json(res, 403, { ok: false, message: '只有管理員可以睇呢度' });
    return null;
  }
  return user;
}

async function handleAdminUsers(db, req, res) {
  const admin = await requireAdmin(db, req, res);
  if (!admin) return;

  const users = await db.all(
    `SELECT u.id, u.username, u.name, u.role, u.is_active, u.failed_count,
            u.locked_until, u.created_at, u.last_login_at, u.note,
            (SELECT COUNT(*) FROM login_logs l
              WHERE l.user_id = u.id AND l.succeeded = 1) AS login_count,
            (SELECT COUNT(*) FROM login_logs l
              WHERE l.user_id = u.id AND l.succeeded = 0) AS fail_count
       FROM users u
      ORDER BY u.id`
  );

  return json(res, 200, {
    ok: true,
    users: users.map((u) => ({
      ...u,
      is_active: !!u.is_active,
      locked: (parseUtc(u.locked_until) ?? 0) > Date.now(),
    })),
  });
}

async function handleAdminLogs(db, req, res, ctx) {
  const admin = await requireAdmin(db, req, res);
  if (!admin) return;

  const limit = Math.min(500, Math.max(1, Number(ctx.url.searchParams.get('limit')) || 100));
  const offset = Math.max(0, Number(ctx.url.searchParams.get('offset')) || 0);
  const name = (ctx.url.searchParams.get('name') || '').trim();
  const onlyFailed = ctx.url.searchParams.get('failed') === '1';

  const where = [];
  const params = [];
  if (name) {
    where.push('l.username_attempted LIKE ?');
    params.push(`%${name}%`);
  }
  if (onlyFailed) where.push('l.succeeded = 0');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const logs = await db.all(
    `SELECT l.id, l.username_attempted, l.user_id, l.succeeded, l.reason,
            l.ip, l.user_agent, l.created_at, u.name
       FROM login_logs l
       LEFT JOIN users u ON u.id = l.user_id
       ${clause}
      ORDER BY l.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const total = await db.get(
    `SELECT COUNT(*) AS n FROM login_logs l ${clause}`,
    params
  );

  return json(res, 200, { ok: true, logs, total: total?.n ?? 0, limit, offset });
}

async function handleAdminStats(db, req, res) {
  const admin = await requireAdmin(db, req, res);
  if (!admin) return;

  const dayStart = utcNow().slice(0, 10) + ' 00:00:00';

  const users = await db.get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive,
            SUM(CASE WHEN locked_until IS NOT NULL AND locked_until > ? THEN 1 ELSE 0 END) AS locked
       FROM users`,
    [utcNow()]
  );

  const today = await db.get(
    `SELECT SUM(CASE WHEN succeeded = 1 THEN 1 ELSE 0 END) AS ok,
            SUM(CASE WHEN succeeded = 0 THEN 1 ELSE 0 END) AS fail
       FROM login_logs WHERE created_at >= ?`,
    [dayStart]
  );

  const recent = await db.get(
    `SELECT COUNT(*) AS n FROM login_logs WHERE created_at >= ?`,
    [utcNow().slice(0, 10) + ' 00:00:00']
  );

  return json(res, 200, {
    ok: true,
    stats: {
      total: users?.total ?? 0,
      active: users?.active ?? 0,
      inactive: users?.inactive ?? 0,
      locked: users?.locked ?? 0,
      loginToday: today?.ok ?? 0,
      failToday: today?.fail ?? 0,
      logToday: recent?.n ?? 0,
    },
  });
}

async function handleCreateUser(db, req, res, ctx) {
  const admin = await requireAdmin(db, req, res);
  if (!admin) return;

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { ok: false, message: '送過嚟嘅資料唔完整' });
  }

  const username = String(body.username ?? '').trim().toLowerCase();
  const name = String(body.name ?? '').trim();
  const role = body.role === 'admin' ? 'admin' : 'member';

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return json(res, 400, {
      ok: false,
      message: '帳戶名要用 3 至 32 個字，只可以英文字母、數字、點、底線或連字號',
    });
  }
  if (!name || name.length > 60) {
    return json(res, 400, { ok: false, message: '請填姓名（最多 60 個字）' });
  }

  const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    return json(res, 409, { ok: false, message: '呢個帳戶名已經有人用' });
  }

  let password = String(body.password ?? '');
  if (!password) {
    do {
      password = auth.generatePassword();
    } while (!auth.checkPasswordStrength(password).ok);
  } else {
    const strength = auth.checkPasswordStrength(password);
    if (!strength.ok) {
      return json(res, 400, { ok: false, message: strength.message });
    }
  }

  const hash = await auth.hashPassword(password);
  const result = await db.run(
    'INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, ?)',
    [username, name, hash, role]
  );

  return json(res, 201, {
    ok: true,
    id: result.lastInsertRowid,
    username,
    name,
    role,
    // 密碼只喺呢一刻出現一次，管理員之後都睇唔返
    password,
  });
}

async function handleUpdateUser(db, req, res, ctx) {
  const admin = await requireAdmin(db, req, res);
  if (!admin) return;

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) {
    return json(res, 400, { ok: false, message: '會員編號唔啱' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { ok: false, message: '送過嚟嘅資料唔完整' });
  }

  const target = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!target) return json(res, 404, { ok: false, message: '搵唔到呢個會員' });

  if (body.is_active !== undefined && id === admin.id && !body.is_active) {
    return json(res, 400, { ok: false, message: '你唔可以停用自己嘅帳戶' });
  }

  const updates = [];
  const params = [];

  if (body.is_active !== undefined) {
    updates.push('is_active = ?');
    params.push(body.is_active ? 1 : 0);
  }
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 60) {
      return json(res, 400, { ok: false, message: '請填姓名（最多 60 個字）' });
    }
    updates.push('name = ?');
    params.push(name);
  }
  if (body.note !== undefined) {
    updates.push('note = ?');
    params.push(String(body.note).slice(0, 200));
  }

  if (!updates.length) return json(res, 400, { ok: false, message: '冇嘢要改' });

  params.push(id);
  await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

  // 停用就即刻踢走對方所有 session
  if (body.is_active === false) {
    await db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
  }

  return json(res, 200, { ok: true });
}

async function handleResetPassword(db, req, res, ctx) {
  const admin = await requireAdmin(db, req, res);
  if (!admin) return;

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) {
    return json(res, 400, { ok: false, message: '會員編號唔啱' });
  }

  const target = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!target) return json(res, 404, { ok: false, message: '搵唔到呢個會員' });

  let password = auth.generatePassword();
  while (!auth.checkPasswordStrength(password).ok) {
    password = auth.generatePassword();
  }

  const hash = await auth.hashPassword(password);
  await db.run(
    'UPDATE users SET password_hash = ?, failed_count = 0, locked_until = NULL WHERE id = ?',
    [hash, id]
  );
  // 重設密碼之後，舊嘅登入狀態全部失效
  await db.run('DELETE FROM sessions WHERE user_id = ?', [id]);

  return json(res, 200, { ok: true, username: target.username, password });
}

async function handleUnlock(db, req, res, ctx) {
  const admin = await requireAdmin(db, req, res);
  if (!admin) return;

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) {
    return json(res, 400, { ok: false, message: '會員編號唔啱' });
  }

  await db.run('UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = ?', [id]);
  return json(res, 200, { ok: true });
}

/* ---------- 路由 ---------- */

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * 處理所有 /api/... 嘅請求
 * 傳返 true 表示已經處理，false 表示唔關 API 嘅事
 */
function createApi(db, opts = {}) {
  const buckets = new Map();
  const rateLimit = opts.rateLimit ?? RATE_LIMIT;

  return async function handleApi(req, res, ctx) {
    const pathname = ctx.url.pathname;
    if (!pathname.startsWith('/api/')) return false;

    // 所有會改資料嘅請求都要檢查來源，
    // 防止有人喺另一個網站偷偷提交（跨站請求偽造）
    if (WRITE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        let originHost = '';
        try {
          originHost = new URL(origin).host;
        } catch {
          return json(res, 403, { ok: false, message: '來源唔正確' }), true;
        }
        if (originHost !== ctx.host) {
          return json(res, 403, { ok: false, message: '來源唔正確' }), true;
        }
      }
    }

    const method = req.method;
    ctx.buckets = buckets;
    ctx.rateLimit = rateLimit;

    if (pathname === '/api/login' && method === 'POST') {
      await handleLogin(db, req, res, ctx);
      return true;
    }
    if (pathname === '/api/logout' && method === 'POST') {
      await handleLogout(db, req, res, ctx);
      return true;
    }
    if (pathname === '/api/me' && method === 'GET') {
      await handleMe(db, req, res);
      return true;
    }
    if (pathname === '/api/admin/stats' && method === 'GET') {
      await handleAdminStats(db, req, res);
      return true;
    }
    if (pathname === '/api/admin/users' && method === 'GET') {
      await handleAdminUsers(db, req, res);
      return true;
    }
    if (pathname === '/api/admin/users' && method === 'POST') {
      await handleCreateUser(db, req, res, ctx);
      return true;
    }
    if (pathname === '/api/admin/logs' && method === 'GET') {
      await handleAdminLogs(db, req, res, ctx);
      return true;
    }

    const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)(\/[a-z-]+)?$/);
    if (userMatch) {
      ctx.params = { id: userMatch[1] };
      const action = userMatch[2];

      if (!action && method === 'PATCH') {
        await handleUpdateUser(db, req, res, ctx);
        return true;
      }
      if (action === '/reset-password' && method === 'POST') {
        await handleResetPassword(db, req, res, ctx);
        return true;
      }
      if (action === '/unlock' && method === 'POST') {
        await handleUnlock(db, req, res, ctx);
        return true;
      }
    }

    return json(res, 404, { ok: false, message: '冇呢個 API' }), true;
  };
}

module.exports = {
  createApi,
  parseCookies,
  SESSION_COOKIE,
  MAX_FAILED,
  LOCK_MINUTES,
  RATE_LIMIT,
};
