'use strict';
/*
 * 密碼雜湊同 session 管理
 *
 * 密碼：用 PBKDF2-HMAC-SHA512，210,000 次迭代（OWASP 建議值）
 *       每個密碼都有獨立隨機 salt，資料庫外洩都解唔返原文。
 *
 * 呢個檔案刻意淨係用 Web Crypto API（globalThis.crypto），
 * 因為 Node 18+ 同 Cloudflare Workers 都有提供，
 * 唔使引入任何 npm 套件，日後想搬到雲端都唔使改密碼邏輯。
 */

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();

const SCHEME = 'pbkdf2-sha512';
const ITERATIONS = 210000;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/* ---------- 細細嘅工具 ---------- */

function randomBytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * 比較兩個字串，時間差唔會因為頭一個唔同就提早返回，
 * 外面睇唔出密碼係咪頭一位就啱。
 */
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function randomInt(min, max) {
  const range = max - min;
  const bytes = randomBytes(4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return min + (view.getUint32(0) % range);
}

/* ---------- 密碼 ---------- */

async function pbkdf2(password, salt, iterations, keyBytes) {
  const material = await subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-512' },
    material,
    keyBytes * 8
  );
  return new Uint8Array(bits);
}

/** 產生可以放入資料庫嘅密碼雜湊字串 */
async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const hash = await pbkdf2(password, salt, ITERATIONS, KEY_BYTES);
  return [SCHEME, ITERATIONS, toBase64(salt), toBase64(hash)].join('$');
}

/** 檢查密碼係咪啱；唔啱或者格式壞咗都當唔啱 */
async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== SCHEME) return false;

  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < 1) return false;

  let salt;
  let expected;
  try {
    salt = fromBase64(parts[2]);
    expected = fromBase64(parts[3]);
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await pbkdf2(password, salt, iterations, expected.length);
  if (actual.length !== expected.length) return false;
  return constantTimeEqual(actual, expected);
}

/**
 * 產生一個「假雜湊」，用嚟喺帳戶唔存在時做一樣多嘅運算，
 * 令外面冇辦法靠回應時間推測邊個帳戶係真嘅。
 */
let decoyHash = null;
async function dummyVerify(password) {
  if (!decoyHash) decoyHash = await hashPassword('decoy-' + toHex(randomBytes(16)));
  await verifyPassword(password, decoyHash);
  return false;
}

/* ---------- Session ---------- */

const SESSION_DAYS = 7;

function newSessionToken() {
  return toBase64(randomBytes(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hashToken(token) {
  const bits = await subtle.digest('SHA-256', encoder.encode(token));
  return toHex(new Uint8Array(bits));
}

/** Session 有效到幾點（UTC，格式同 SQLite 一致） */
function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 86400 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

/* ---------- 密碼強度 ---------- */

/**
 * 檢查密碼夠唔夠強。回傳 { ok, message }
 * 規則：最少 10 個字元，而且要有字母 + 數字
 */
function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return { ok: false, message: '密碼最少要 10 個字元' };
  }
  if (password.length > 200) {
    return { ok: false, message: '密碼太長（最多 200 個字元）' };
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, message: '密碼要同時有英文字母同數字' };
  }
  const common = ['password', '12345678', 'qwerty', 'letmein', 'admin', 'welcome'];
  if (common.some((c) => password.toLowerCase().includes(c))) {
    return { ok: false, message: '密碼太常見，請改用其他組合' };
  }
  return { ok: true, message: '' };
}

/** 產生一個容易讀但隨機嘅初始密碼，例如 `Amber!4821amb` */
function generatePassword() {
  const words = [
    'amber', 'breeze', 'cedar', 'delta', 'ember', 'fjord', 'grove', 'harbor',
    'indigo', 'jasper', 'kelp', 'lantern', 'meadow', 'nimbus', 'onyx', 'pebble',
    'quartz', 'ridge', 'summit', 'thistle', 'umber', 'velvet', 'willow', 'zephyr',
  ];
  const word = words[randomInt(0, words.length)];
  const num = String(randomInt(1000, 10000));
  const sym = '!@#$%&*+-='[randomInt(0, 10)];
  const cap = word[0].toUpperCase() + word.slice(1);
  return `${cap}${sym}${num}${word.slice(0, 3)}`;
}

module.exports = {
  hashPassword,
  verifyPassword,
  dummyVerify,
  newSessionToken,
  hashToken,
  sessionExpiry,
  checkPasswordStrength,
  generatePassword,
  constantTimeEqual,
  SESSION_DAYS,
};
