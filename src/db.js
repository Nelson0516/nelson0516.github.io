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
const ASSETS_SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema-assets.sql');

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
 * @param {string} [opts.schema] 用邊份 schema（會員定資產）
 */
async function createDb(opts = {}) {
  const db = opts.d1 ? d1Adapter(opts.d1) : localAdapter(opts.file);
  await migrate(db, opts.schema);
  return db;
}

/** 套用 schema.sql（可以重複執行） */
async function migrate(db, schemaPath) {
  const file = schemaPath === 'assets' ? ASSETS_SCHEMA_PATH : schemaPath || SCHEMA_PATH;
  const sql = fs.readFileSync(file, 'utf8');
  for (const stmt of splitStatements(sql)) {
    await db.exec(stmt);
  }
}

/** 將 SQL 檔案拆成一句一句執行（去掉 -- 註解，但保留引號入面嘅內容） */
function splitStatements(sql) {
  const withoutComments = sql
    .split('\n')
    .map((line) => stripLineComment(line))
    .join('\n');

  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 去掉一行入面嘅 -- 註解（但唔會整爛引號入面嘅文字） */
function stripLineComment(line) {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '-' && line[i + 1] === '-' && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }

  return line;
}

module.exports = { createDb, splitStatements, SCHEMA_PATH, ASSETS_SCHEMA_PATH };
