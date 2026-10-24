-- ============================================================
--  電腦資產管理系統資料庫結構
--  同會員系統分開兩個檔案，兩邊都係 SQLite（Cloudflare D1 都一樣）
-- ============================================================

-- 電腦資產
-- bar_code 係 Excel 入面嘅條碼，全份資料都唔重複，所以做主鍵。
--
-- 留意：欄位分兩類 ——
--   前面嗰批（excel_* 同基本資料）係由 Excel 匯入，每次匯入會更新；
--   後面嗰批（status、custodian…）係系統自己管理，匯入唔會碰，
--   除非管理員喺系統改咗（location_edited 呢個旗標就係咁用）。
CREATE TABLE IF NOT EXISTS assets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,

  -- === 由 Excel 匯入 ===
  bar_code          TEXT    NOT NULL UNIQUE,  -- 條碼（主鍵）
  row_no            TEXT,                    -- Excel Row No
  ea_no             TEXT,                    -- EA No
  asset_no          TEXT,                    -- Asset No
  ac_code           TEXT,                    -- AC Code
  arr_date          TEXT,                    -- 到貨日期 YYYY-MM-DD
  po_no             TEXT,                    -- PO / DN 號碼
  po_date           TEXT,                    -- PO 日期 YYYY-MM-DD
  excel_location    TEXT,                    -- Excel 入面嘅原始位置
  equipment_status  TEXT,                    -- NEW / USED（Excel 原始狀態）
  asset_group       TEXT,                    -- 資產類別
  brand             TEXT,                    -- 品牌
  model_no          TEXT,                    -- 型號
  serial_no         TEXT,                    -- 序號
  reg_date          TEXT,                    -- 登記日期 YYYY-MM-DD
  fin_year          TEXT,                    -- 財務年度碼，例如 2526
  job_no            TEXT,                    -- Job No
  ref_code          TEXT,                    -- Ref
  old_serial_no     TEXT,                    -- 舊序號
  remark            TEXT,                    -- Excel 備註
  last_location     TEXT,                    -- Last Loc.

  -- === 系統管理 ===
  location          TEXT,                    -- 現行位置
  location_edited   INTEGER NOT NULL DEFAULT 0, -- 1 = 喺系統改過，唔好再被 Excel 覆蓋
  building          TEXT,                    -- 樓宇（由位置拆出嚟）
  room              TEXT,                    -- 房間（由位置拆出嚟）
  status            TEXT    NOT NULL DEFAULT 'active', -- active|maintenance|loaned|retired|lost
  custodian         TEXT,                    -- 負責人／借用人
  department        TEXT,                    -- 部門
  condition_note    TEXT,                    -- 狀況備註
  managed_note      TEXT,                    -- 管理備註

  imported_at       TEXT,                    -- 上次匯入時間
  updated_at        TEXT,                    -- 上次修改時間
  updated_by        TEXT                     -- 上次修改嘅人
);

-- 每次改動都留低紀錄，方便查返部機嘅歷史
CREATE TABLE IF NOT EXISTS asset_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id   INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  field      TEXT    NOT NULL,              -- 改咗邊個欄位
  old_value  TEXT,
  new_value  TEXT,
  note       TEXT,                          -- 原因／備註
  user_id    INTEGER,
  user_name  TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assets_building ON assets(building);
CREATE INDEX IF NOT EXISTS idx_assets_brand    ON assets(brand);
CREATE INDEX IF NOT EXISTS idx_assets_group    ON assets(asset_group);
CREATE INDEX IF NOT EXISTS idx_assets_status   ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_location ON assets(location);
CREATE INDEX IF NOT EXISTS idx_logs_asset       ON asset_logs(asset_id, id DESC);
