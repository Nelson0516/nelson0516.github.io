-- ============================================================
--  會員系統資料庫結構
--  SQLite（本機 node:sqlite）同 Cloudflare D1 都用同一份，
--  因為兩個都係 SQLite，SQL 語法完全一樣。
-- ============================================================

-- 會員帳戶
-- 注意：password_hash 存嘅係 PBKDF2 雜湊，唔係明文密碼，
--       連管理員都冇辦法睇返原始密碼。
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,      -- 登入用嘅名稱
  name          TEXT    NOT NULL,             -- 真實姓名／顯示名稱
  password_hash TEXT    NOT NULL,             -- pbkdf2-sha512$迭代數$salt$hash
  role          TEXT    NOT NULL DEFAULT 'member',  -- member | admin
  is_active     INTEGER NOT NULL DEFAULT 1,        -- 0 = 停用
  failed_count  INTEGER NOT NULL DEFAULT 0,        -- 連續失敗次數
  locked_until  TEXT,                              -- 鎖定到幾點（UTC）
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT                            -- 最近一次成功登入時間（UTC）
);

-- 登入工作階段（session）
-- 存嘅係 token 嘅 SHA-256，唔係 token 本身，
-- 即係就算資料庫外洩都唔可以直接偷 session。
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL,
  ip         TEXT,
  user_agent TEXT
);

-- 登入紀錄：成功同失敗都會記低
-- 永遠唔會記低「輸入咗咩密碼」—— 只記住帳戶名同結果。
CREATE TABLE IF NOT EXISTS login_logs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  username_attempted TEXT    NOT NULL,   -- 嘗試用嘅帳戶名
  user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  succeeded          INTEGER NOT NULL DEFAULT 0,
  reason             TEXT    NOT NULL,   -- ok | wrong_password | unknown_user | locked | inactive | rate_limited
  ip                 TEXT,
  user_agent         TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logs_created ON login_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_name    ON login_logs(username_attempted);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
