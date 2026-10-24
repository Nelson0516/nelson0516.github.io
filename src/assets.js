'use strict';
/*
 * 電腦資產管理：資料整理、查詢、統計同埋改動紀錄
 *
 * 資料來源係一份 Excel（由 db/import-assets.js 匯入）。
 * 匯入嗰陣會做兩件事：
 *   1. 將 Excel 嘅欄位對應落資料庫
 *   2. 把「地點」拆成「樓宇」同「房間」，方便按樓宇統計
 *
 * 系統自己加嘅欄位（status、custodian…）唔會被匯入覆蓋，
 * 除非管理員喺系統改咗位置（location_edited 旗標）。
 */

const ASSET_STATUSES = ['active', 'maintenance', 'loaned', 'retired', 'lost'];

const ASSET_STATUS_LABELS = {
  active: '使用中',
  maintenance: '維修中',
  loaned: '借出中',
  retired: '已棄置',
  lost: '遺失',
};

// Excel 欄名 → 資料庫欄名
const COLUMN_MAP = {
  'row no': 'row_no',
  'bar code': 'bar_code',
  'ea no': 'ea_no',
  'asset no': 'asset_no',
  'ac code': 'ac_code',
  'arr date': 'arr_date',
  'po/dn_no': 'po_no',
  'po date': 'po_date',
  location: 'excel_location',
  equipmentstatus: 'equipment_status',
  'asset group': 'asset_group',
  'supplier/band': 'brand',
  'model no': 'model_no',
  'serial no': 'serial_no',
  date: 'reg_date',
  year: 'fin_year',
  'job no': 'job_no',
  ref: 'ref_code',
  'old serial no': 'old_serial_no',
  remark: 'remark',
  'last loc.': 'last_location',
};

/* ---------- 地點解析 ---------- */

/**
 * 將 Excel 嘅位置拆成樓宇同房間。
 *
 *   "LSK 408"          → 樓宇 LSK，房間 408
 *   "YIA 606 ERM"      → 樓宇 YIA，房間 606 ERM
 *   "IT-LSB"           → 樓宇 IT-LSB，冇房間
 *   "SET UP (YIA 606)" → 樓宇 YIA，房間 606
 *   "bus (Waiting No.)" → 樓宇 BUS，房間 Waiting No.
 */
function parseLocation(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { building: null, room: null };

  // 括號：括號入面通常先係真正嘅地點
  const paren = text.match(/^([^(]*)\(([^)]*)\)\s*$/);
  if (paren) {
    const inner = paren[2].trim();
    const fromInner = splitBuilding(inner);
    if (fromInner.building) return fromInner;
    const prefix = paren[1].trim();
    return {
      building: prefix ? prefix.toUpperCase() : null,
      room: inner || null,
    };
  }

  // "YIA, CYT LT" → 樓宇 YIA
  if (text.includes(',')) {
    const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
    return {
      building: parts[0] ? parts[0].toUpperCase() : null,
      room: parts.slice(1).join(', ') || null,
    };
  }

  return splitBuilding(text);
}

function splitBuilding(text) {
  const value = String(text ?? '').trim();
  if (!value) return { building: null, room: null };

  // "LSK 408"、"YIA 606 ERM"
  const withRoom = value.match(/^([A-Z][A-Z0-9-]*)\s+(.+)$/);
  if (withRoom) {
    return { building: withRoom[1].toUpperCase(), room: withRoom[2].trim() };
  }

  // "IT-LSB"、"LSB"
  const only = value.match(/^([A-Z][A-Z0-9-]*)$/);
  if (only) {
    return { building: only[1].toUpperCase(), room: null };
  }

  // 樓宇名唔係全大寫（例如 "bus"）：淨係當房間
  return { building: null, room: value };
}

/* ---------- 日期 ---------- */

/** Excel 嘅 "04.07.16" → "2016-07-04" */
function parseDmyDate(text) {
  const m = String(text ?? '').trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  year += year < 70 ? 2000 : 1900;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** JS Date → "YYYY-MM-DD" */
function toIsoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  // 已經係 "YYYY-MM-DD" 格式嘅文字
  const text = String(value ?? '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/** 而家嘅時間（UTC 字串，同會員系統一致） */
function utcNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/* ---------- Excel 行 → 資料庫行 ---------- */

/**
 * 將一行 Excel 變成可以入資料庫嘅物件。
 * 欄位靠表頭對應，所以 Excel 加欄或者調次序都唔會壞。
 */
function mapSheetRow(headerRow, dataRow) {
  const out = {};

  headerRow.forEach((header, index) => {
    const key = String(header ?? '').trim().toLowerCase();
    const column = COLUMN_MAP[key];
    if (!column) return;

    let value = dataRow[index];
    if (value === undefined) value = null;

    // 日期欄位要特別處理：
    //   - Excel 用日期格式儲存嘅格仔，讀出嚟係 Date 物件
    //   - 或者係文字「04.07.16」
    if (column === 'arr_date' || column === 'po_date' || column === 'reg_date') {
      value = parseDmyDate(value) ?? toIsoDate(value) ?? null;
    } else if (value instanceof Date) {
      value = toIsoDate(value);
    } else if (typeof value === 'string') {
      value = value.trim();
      if (value === '') value = null;
    } else if (typeof value === 'number') {
      value = String(value);
    }

    out[column] = value ?? null;
  });

  return out;
}

/* ---------- 查詢 ---------- */

const SORTABLE = {
  bar_code: 'a.bar_code',
  arr_date: 'a.arr_date',
  brand: 'a.brand',
  location: 'a.location',
  building: 'a.building',
  room: 'a.room',
  asset_group: 'a.asset_group',
  status: 'a.status',
  model_no: 'a.model_no',
  serial_no: 'a.serial_no',
};

// 查找頁面可以逐個欄位填，填咗幾個就幾個都要啱（AND）
const LOOKUP_FIELDS = {
  bar_code: 'a.bar_code',
  location: 'a.location',
  model_no: 'a.model_no',
  serial_no: 'a.serial_no',
  asset_group: 'a.asset_group',
  brand: 'a.brand',
  status: 'a.status',
};

/**
 * 查找用嘅篩選：每個欄位都可以淨係填一部分，幾個欄位之間係 AND。
 *
 *   位置會同 Excel 原始位置一齊搵，
 *   咁就算管理員喺系統改咗位置，舊位置都仲搵得返。
 */
function buildLookupFilters(ctx) {
  const p = ctx.url.searchParams;
  const where = [];
  const params = [];
  let filled = 0;

  for (const [key, column] of Object.entries(LOOKUP_FIELDS)) {
    const value = (p.get(key) || '').trim();
    if (!value) continue;
    filled += 1;

    if (key === 'location') {
      where.push('(a.location LIKE ? OR a.excel_location LIKE ?)');
      params.push(`%${value}%`, `%${value}%`);
    } else {
      where.push(`${column} LIKE ?`);
      params.push(`%${value}%`);
    }
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { clause, params, filled };
}

function buildFilters(ctx) {
  const p = ctx.url.searchParams;
  const where = [];
  const params = [];

  const q = (p.get('q') || '').trim();
  if (q) {
    where.push(
      `(a.bar_code LIKE ? OR a.serial_no LIKE ? OR a.model_no LIKE ? OR a.location LIKE ?
        OR a.room LIKE ? OR a.building LIKE ? OR a.brand LIKE ? OR a.asset_no LIKE ?
        OR a.ea_no LIKE ? OR a.custodian LIKE ? OR a.department LIKE ? OR a.remark LIKE ?
        OR a.managed_note LIKE ? OR a.po_no LIKE ?)`
    );
    const like = `%${q}%`;
    for (let i = 0; i < 14; i++) params.push(like);
  }

  const building = (p.get('building') || '').trim();
  if (building) {
    where.push('a.building = ?');
    params.push(building);
  }

  const brand = (p.get('brand') || '').trim();
  if (brand) {
    where.push('a.brand = ?');
    params.push(brand);
  }

  const group = (p.get('asset_group') || '').trim();
  if (group) {
    where.push('a.asset_group = ?');
    params.push(group);
  }

  const status = (p.get('status') || '').trim();
  if (status && ASSET_STATUSES.includes(status)) {
    where.push('a.status = ?');
    params.push(status);
  }

  const equipment = (p.get('equipment_status') || '').trim();
  if (equipment) {
    where.push('a.equipment_status = ?');
    params.push(equipment);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { clause, params };
}

async function listAssets(db, req, res, ctx) {
  const p = ctx.url.searchParams;
  const limit = Math.min(200, Math.max(1, Number(p.get('limit')) || 50));
  const page = Math.max(1, Number(p.get('page')) || 1);
  const offset = (page - 1) * limit;

  const sortKey = SORTABLE[p.get('sort')] || 'a.bar_code';
  const dir = p.get('dir') === 'desc' ? 'DESC' : 'ASC';

  const { clause, params } = buildFilters(ctx);

  const rows = await db.all(
    `SELECT a.id, a.bar_code, a.row_no, a.location, a.excel_location, a.building, a.room,
            a.equipment_status, a.asset_group, a.brand, a.model_no, a.serial_no,
            a.arr_date, a.status, a.custodian, a.department,
            a.location_edited, a.updated_at, a.updated_by
       FROM assets a
       ${clause}
      ORDER BY ${sortKey} ${dir}, a.id ASC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const total = await db.get(`SELECT COUNT(*) AS n FROM assets a ${clause}`, params);
  const count = total?.n ?? 0;

  return json(res, 200, {
    ok: true,
    assets: rows,
    total: count,
    page,
    limit,
    pages: Math.max(1, Math.ceil(count / limit)),
  });
}

async function assetStats(db, req, res) {
  const total = await db.get('SELECT COUNT(*) AS n FROM assets');

  const byStatus = await db.all(
    'SELECT status, COUNT(*) AS n FROM assets GROUP BY status ORDER BY n DESC'
  );
  const byEquipment = await db.all(
    'SELECT equipment_status, COUNT(*) AS n FROM assets GROUP BY equipment_status ORDER BY n DESC'
  );
  const byBrand = await db.all(
    'SELECT brand, COUNT(*) AS n FROM assets WHERE brand IS NOT NULL GROUP BY brand ORDER BY n DESC'
  );
  const byGroup = await db.all(
    'SELECT asset_group, COUNT(*) AS n FROM assets GROUP BY asset_group ORDER BY n DESC'
  );
  const byBuilding = await db.all(
    'SELECT building, COUNT(*) AS n FROM assets WHERE building IS NOT NULL GROUP BY building ORDER BY n DESC'
  );

  const summary = await db.get(
    `SELECT SUM(CASE WHEN arr_date >= '2024-01-01' THEN 1 ELSE 0 END) AS recent,
            MIN(arr_date) AS oldest,
            MAX(arr_date) AS newest,
            SUM(CASE WHEN location_edited = 1 THEN 1 ELSE 0 END) AS moved
       FROM assets`
  );

  const imported = await db.get('SELECT MAX(imported_at) AS at FROM assets');

  return json(res, 200, {
    ok: true,
    stats: {
      total: total?.n ?? 0,
      byStatus: byStatus.map((r) => ({
        ...r,
        label: ASSET_STATUS_LABELS[r.status] ?? r.status,
      })),
      byEquipment: byEquipment.map((r) => ({
        ...r,
        label:
          r.equipment_status === 'NEW'
            ? '全新'
            : r.equipment_status === 'USED'
              ? '用過'
              : r.equipment_status,
      })),
      byBrand,
      byGroup,
      byBuilding,
      recent: summary?.recent ?? 0,
      oldest: summary?.oldest ?? null,
      newest: summary?.newest ?? null,
      moved: summary?.moved ?? 0,
      importedAt: imported?.at ?? null,
    },
  });
}

async function assetFilters(db, req, res) {
  const buildings = await db.all(
    'SELECT building AS value, COUNT(*) AS n FROM assets WHERE building IS NOT NULL GROUP BY building ORDER BY building'
  );
  const brands = await db.all(
    'SELECT brand AS value, COUNT(*) AS n FROM assets WHERE brand IS NOT NULL GROUP BY brand ORDER BY brand'
  );
  const groups = await db.all(
    'SELECT asset_group AS value, COUNT(*) AS n FROM assets GROUP BY asset_group ORDER BY asset_group'
  );

  return json(res, 200, {
    ok: true,
    buildings,
    brands,
    groups,
    statuses: ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] })),
  });
}

/**
 * 查找：逐個欄位填資料，搵返相關嘅電腦
 */
async function lookupAssets(db, req, res, ctx) {
  const { clause, params, filled } = buildLookupFilters(ctx);

  if (!filled) {
    return json(res, 400, {
      ok: false,
      message: '請最少填一個欄位先搵得到',
    });
  }

  const limit = Math.min(200, Math.max(1, Number(ctx.url.searchParams.get('limit')) || 50));

  const rows = await db.all(
    `SELECT a.id, a.bar_code, a.row_no, a.location, a.excel_location, a.building, a.room,
            a.equipment_status, a.asset_group, a.brand, a.model_no, a.serial_no,
            a.arr_date, a.po_no, a.po_date, a.reg_date, a.remark,
            a.status, a.custodian, a.department, a.location_edited, a.updated_at
       FROM assets a
       ${clause}
      ORDER BY a.bar_code
      LIMIT ?`,
    [...params, limit]
  );

  const total = await db.get(`SELECT COUNT(*) AS n FROM assets a ${clause}`, params);

  return json(res, 200, {
    ok: true,
    assets: rows,
    total: total?.n ?? 0,
    limit,
    truncated: (total?.n ?? 0) > limit,
  });
}

async function assetDetail(db, req, res, ctx) {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return json(res, 400, { ok: false, message: '編號唔啱' });

  const asset = await db.get('SELECT * FROM assets WHERE id = ?', [id]);
  if (!asset) return json(res, 404, { ok: false, message: '搵唔到呢部電腦' });

  const logs = await db.all(
    `SELECT id, field, old_value, new_value, note, user_name, created_at
       FROM asset_logs WHERE asset_id = ? ORDER BY id DESC LIMIT 100`,
    [id]
  );

  return json(res, 200, { ok: true, asset, logs });
}

/* ---------- 修改 ---------- */

const EDITABLE = {
  location: '位置',
  status: '狀態',
  custodian: '負責人',
  department: '部門',
  condition_note: '狀況備註',
  managed_note: '管理備註',
};

async function updateAsset(db, req, res, ctx, body) {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) return json(res, 400, { ok: false, message: '編號唔啱' });

  const target = await db.get('SELECT * FROM assets WHERE id = ?', [id]);
  if (!target) return json(res, 404, { ok: false, message: '搵唔到呢部電腦' });

  const user = ctx.user;
  const updates = [];
  const params = [];
  const changes = [];

  for (const [field, label] of Object.entries(EDITABLE)) {
    if (body[field] === undefined) continue;

    let value = body[field] === null ? null : String(body[field]).trim();
    if (value === '') value = null;

    if (field === 'status' && (!value || !ASSET_STATUSES.includes(value))) {
      return json(res, 400, { ok: false, message: '狀態唔啱' });
    }

    if (value !== null && value.length > 200) value = value.slice(0, 200);

    const oldValue = target[field] ?? null;
    if (oldValue === value) continue;

    updates.push(`${field} = ?`);
    params.push(value);
    changes.push({ field, label, oldValue, newValue: value });
  }

  // 冇改過嘢唔算錯，係正常情況
  if (!updates.length) return json(res, 200, { ok: true, changed: 0 });

  // 改咗位置，就記低「呢個位置係人手改嘅」，之後匯入 Excel 唔會洗走
  const locationChanged = changes.some((c) => c.field === 'location');
  if (locationChanged) updates.push('location_edited = 1');

  params.push(id);
  await db.run(`UPDATE assets SET ${updates.join(', ')} WHERE id = ?`, params);

  // 位置改咗，樓宇同房間要跟住更新（用新嘅位置，唔係舊嘅）
  if (locationChanged) {
    const newLocation = changes.find((c) => c.field === 'location').newValue;
    const { building, room } = parseLocation(newLocation);
    await db.run('UPDATE assets SET building = ?, room = ? WHERE id = ?', [building, room, id]);
  }

  // 記低最後修改嘅時間同邊個改嘅
  await db.run('UPDATE assets SET updated_at = ?, updated_by = ? WHERE id = ?', [
    utcNow(),
    user?.name ?? null,
    id,
  ]);

  for (const change of changes) {
    await db.run(
      `INSERT INTO asset_logs (asset_id, field, old_value, new_value, note, user_id, user_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        change.label,
        change.oldValue,
        change.newValue,
        typeof body.note === 'string' ? body.note.slice(0, 200) : null,
        user?.id ?? null,
        user?.name ?? null,
      ]
    );
  }

  return json(res, 200, { ok: true, changed: changes.length });
}

/* ---------- 小工具 ---------- */

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

module.exports = {
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  COLUMN_MAP,
  parseLocation,
  splitBuilding,
  parseDmyDate,
  toIsoDate,
  mapSheetRow,
  buildFilters,
  buildLookupFilters,
  listAssets,
  assetStats,
  assetFilters,
  lookupAssets,
  assetDetail,
  updateAsset,
};
