'use strict';
/*
 * 資料庫存取層
 *
 * 支援兩個 backend：
 *   - 本機：node:sqlite（Node 內置，零 npm 依賴）
 *   - 雲端：Cloudflare D1（同一套 SQL）
 *
 * 兩邊嘅 method 全部係 async，所以上面嘅程式碼唔使理會用緊邊個。
 */

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

/* ---------- 本機 SQLite ---------- */

function localAdapter(file) {
  const { DatabaseSync } = require('node:sqlite');

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');

  return {
    kind: 'sqlite',
    file,
    async exec(sql) {
      raw.exec(sql);
    },
    async all(sql, params = []) {
      return raw.prepare(sql).all(...params);
    },
    async get(sql, params = []) {
      return raw.prepare(sql).get(...params) ?? null;
    },
    async run(sql, params = []) {
      const r = raw.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    async close() {
      raw.close();
    },
  };
}

/* ---------- Cloudflare D1 ---------- */

function d1Adapter(d1) {
  return {
    kind: 'd1',
    async exec(sql) {
      await d1.exec(sql);
    },
    async all(sql, params = []) {
      const stmt = d1.prepare(sql);
      const bound = params.length ? stmt.bind(...params) : stmt;
      return (await bound.all()).results ?? [];
    },
    async get(sql, params = []) {
      const stmt = d1.prepare(sql);
      const bound = params.length ? stmt.bind(...params) : stmt;
      return (await bound.first()) ?? null;
    },
    async run(sql, params = []) {
      const stmt = d1.prepare(sql);
      const bound = params.length ? stmt.bind(...params) : stmt;
      const r = await bound.run();
      return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) };
    },
    async close() {},
  };
}

/* ---------- 公開接口 ---------- */

/**
 * @param {object} opts
 * @param {string} [opts.file] 本機 SQLite 檔案路徑
 * @param {object} [opts.d1]   Cloudflare D1 binding（如果用雲端）
 */
async function createDb(opts = {}) {
  const db = opts.d1 ? d1Adapter(opts.d1) : localAdapter(opts.file);
  await migrate(db);
  return db;
}

/** 套用 schema.sql（可以重複執行） */
async function migrate(db) {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  for (const stmt of splitStatements(sql)) {
    await db.exec(stmt);
  }
}

/** 將 SQL 檔案拆成一句一句執行（去掉 -- 註解） */
function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = { createDb, splitStatements };
