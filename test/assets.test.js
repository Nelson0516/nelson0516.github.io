'use strict';
/*
 * 電腦資產管理測試
 * 開法：npm test
 *
 * 全部用臨時資料庫，唔會整到正式嗰個。
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDb } = require('../src/db');
const { createServer } = require('../server');
const auth = require('../src/auth');
const assetsApi = require('../src/assets');
const importAssets = require('../db/import-assets');
const { makeXlsx } = require('./helpers/make-xlsx');

const ADMIN_PW = 'admin-secret-2026';
const MEMBER_PW = 'member-secret-2026';

let server;
let db;
let assetsDb;
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

async function addUser(username, password, role, name) {
  const hash = await auth.hashPassword(password);
  await db.run(
    'INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, ?)',
    [username, name, hash, role]
  );
}

async function addAsset(row) {
  const { building, room } = assetsApi.parseLocation(row.excel_location);
  await assetsDb.run(
    `INSERT INTO assets
       (bar_code, row_no, arr_date, excel_location, location, building, room,
        equipment_status, asset_group, brand, model_no, serial_no, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.bar_code,
      row.row_no ?? null,
      row.arr_date ?? null,
      row.excel_location ?? null,
      row.excel_location ?? null,
      building,
      room,
      row.equipment_status ?? null,
      row.asset_group ?? null,
      row.brand ?? null,
      row.model_no ?? null,
      row.serial_no ?? null,
      row.status ?? 'active',
    ]
  );
}

async function login(username, password) {
  const res = await req('POST', '/api/login', {
    body: { username, password },
  });
  assert.equal(res.status, 200, `登入失敗：${username}`);
  return res.cookie;
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-test-'));

  db = await createDb({ file: path.join(tmpDir, 'members.db') });
  assetsDb = await createDb({
    file: path.join(tmpDir, 'assets.db'),
    schema: 'assets',
  });

  await addUser('admin', ADMIN_PW, 'admin', '管理員');
  await addUser('member', MEMBER_PW, 'member', '會員甲');

  await addAsset({
    bar_code: 'BC001',
    row_no: '1',
    arr_date: '2016-07-04',
    excel_location: 'LSK 408',
    equipment_status: 'USED',
    asset_group: 'COMPUTER SET',
    brand: 'HP',
    model_no: 'EliteDesk 800',
    serial_no: 'SN001',
  });
  await addAsset({
    bar_code: 'BC002',
    row_no: '2',
    arr_date: '2020-01-15',
    excel_location: 'YIA 606 ERM',
    equipment_status: 'NEW',
    asset_group: 'COMPUTER-NOTEBOOK',
    brand: 'LENOVO',
    model_no: 'ThinkPad T14',
    serial_no: 'SN002',
    status: 'loaned',
  });
  await addAsset({
    bar_code: 'BC003',
    row_no: '3',
    arr_date: '2024-03-01',
    excel_location: 'ST-LSB 12',
    equipment_status: 'NEW',
    asset_group: 'PRINTER',
    brand: 'EPSON',
    model_no: 'L3150',
    serial_no: 'SN003',
  });

  server = createServer(db, { assetsDb, rateLimit: 1000 });
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
  assetsDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
/* ---------- 地點解析 ---------- */

test('位置可以拆成樓宇同房間', () => {
  const cases = [
    ['LSK 408', 'LSK', '408'],
    ['YIA 606 ERM', 'YIA', '606 ERM'],
    ['IT-LSB', 'IT-LSB', null],
    ['LSB', 'LSB', null],
    ['YIA, CYT LT', 'YIA', 'CYT LT'],
    ['SET UP (YIA 606)', 'YIA', '606'],
    ['bus (Waiting No.)', 'BUS', 'Waiting No.'],
  ];

  for (const [input, building, room] of cases) {
    const out = assetsApi.parseLocation(input);
    assert.equal(out.building, building, `「${input}」嘅樓宇唔啱`);
    assert.equal(out.room, room, `「${input}」嘅房間唔啱`);
  }

  assert.deepEqual(assetsApi.parseLocation(''), { building: null, room: null });
  assert.deepEqual(assetsApi.parseLocation(null), { building: null, room: null });
});

/* ---------- 日期解析 ---------- */

test('Excel 嘅 DD.MM.YY 可以轉成標準日期', () => {
  assert.equal(assetsApi.parseDmyDate('04.07.16'), '2016-07-04');
  assert.equal(assetsApi.parseDmyDate('15.01.20'), '2020-01-15');
  assert.equal(assetsApi.parseDmyDate('31.12.99'), '1999-12-31');
  assert.equal(assetsApi.parseDmyDate('乱'), null);
  assert.equal(assetsApi.parseDmyDate('04.07'), null);
});

/* ---------- 未登入 ---------- */

test('未登入就睇唔到資產資料', async () => {
  const paths = [
    '/api/assets',
    '/api/assets/stats',
    '/api/assets/filters',
    '/api/assets/lookup',
    '/api/assets/1',
  ];

  for (const p of paths) {
    const res = await req('GET', p);
    assert.equal(res.status, 401, `${p} 應該要登入先睇到`);
  }
});

/* ---------- 會員權限 ---------- */

test('會員可以睇資料，但唔可以改', async () => {
  const cookie = await login('member', MEMBER_PW);

  const list = await req('GET', '/api/assets', { cookie });
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 3);
  assert.equal(list.data.assets.length, 3);

  const stats = await req('GET', '/api/assets/stats', { cookie });
  assert.equal(stats.status, 200);
  assert.equal(stats.data.stats.total, 3);

  const filters = await req('GET', '/api/assets/filters', { cookie });
  assert.equal(filters.status, 200);
  assert.ok(filters.data.buildings.length > 0);

  const detail = await req('GET', '/api/assets/1', { cookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.asset.bar_code, 'BC001');

  const patch = await req('PATCH', '/api/assets/1', {
    cookie,
    body: { custodian: '我自己改' },
  });
  assert.equal(patch.status, 403, '會員唔應該改到資料');
});

/* ---------- 管理員權限 ---------- */

test('管理員可以改資料，而且會留低變更紀錄', async () => {
  const cookie = await login('admin', ADMIN_PW);

  const patch = await req('PATCH', '/api/assets/1', {
    cookie,
    body: {
      location: 'YIA 999',
      status: 'maintenance',
      custodian: '陳大文',
      department: 'IT',
      note: '搬咗去新位置',
    },
  });
  assert.equal(patch.status, 200);

  const detail = await req('GET', '/api/assets/1', { cookie });
  assert.equal(detail.data.asset.location, 'YIA 999');
  assert.equal(detail.data.asset.status, 'maintenance');
  assert.equal(detail.data.asset.custodian, '陳大文');
  assert.equal(detail.data.asset.department, 'IT');

  // 位置改咗，樓宇同房間要跟住更新
  assert.equal(detail.data.asset.building, 'YIA');
  assert.equal(detail.data.asset.room, '999');
  assert.equal(detail.data.asset.location_edited, 1);

  assert.ok(detail.data.logs.length >= 4, '每個改咗嘅欄位都應該有一行紀錄');
  const fields = detail.data.logs.map((l) => l.field).sort();
  assert.deepEqual(fields, ['位置', '狀態', '負責人', '部門'].sort());
  assert.ok(detail.data.logs.every((l) => l.user_name === '管理員'));
});

test('狀態唔對就唔會改得', async () => {
  const cookie = await login('admin', ADMIN_PW);
  const res = await req('PATCH', '/api/assets/1', {
    cookie,
    body: { status: '隨便乜嘢' },
  });
  assert.equal(res.status, 400);
});

test('搵唔到嘅編號會俾 404', async () => {
  const cookie = await login('admin', ADMIN_PW);
  const res = await req('GET', '/api/assets/999999', { cookie });
  assert.equal(res.status, 404);
});

/* ---------- 篩選同搜尋 ---------- */

test('可以按樓宇、類別、品牌、狀態篩選', async () => {
  const cookie = await login('member', MEMBER_PW);

  const byBuilding = await req('GET', '/api/assets?building=ST-LSB', { cookie });
  assert.equal(byBuilding.data.total, 1);
  assert.equal(byBuilding.data.assets[0].bar_code, 'BC003');

  const byGroup = await req('GET', '/api/assets?asset_group=PRINTER', { cookie });
  assert.equal(byGroup.data.total, 1);
  assert.equal(byGroup.data.assets[0].bar_code, 'BC003');

  const byBrand = await req('GET', '/api/assets?brand=EPSON', { cookie });
  assert.equal(byBrand.data.total, 1);

  const byStatus = await req('GET', '/api/assets?status=loaned', { cookie });
  assert.equal(byStatus.data.total, 1);
  assert.equal(byStatus.data.assets[0].bar_code, 'BC002');

  const byEquipment = await req('GET', '/api/assets?equipment_status=NEW', { cookie });
  assert.equal(byEquipment.data.total, 2);

  const nothing = await req('GET', '/api/assets?brand=冇呢個品牌', { cookie });
  assert.equal(nothing.data.total, 0);
});

test('搜尋可以搵到條碼、型號、序號', async () => {
  const cookie = await login('member', MEMBER_PW);

  for (const q of ['BC003', 'ThinkPad', 'SN001', 'EliteDesk']) {
    const res = await req('GET', `/api/assets?q=${encodeURIComponent(q)}`, { cookie });
    assert.ok(res.data.total >= 1, `「${q}」應該搵到嘢`);
  }

  const res = await req('GET', '/api/assets?q=%E6%97%A0%E9%AD%94%E5%9F%8E', { cookie });
  assert.equal(res.data.total, 0);
});

test('可以排序同分頁', async () => {
  const cookie = await login('member', MEMBER_PW);

  const desc = await req('GET', '/api/assets?sort=bar_code&dir=desc', { cookie });
  assert.equal(desc.data.assets[0].bar_code, 'BC003');

  const page1 = await req('GET', '/api/assets?limit=2&page=1', { cookie });
  assert.equal(page1.data.assets.length, 2);
  assert.equal(page1.data.pages, 2);

  const page2 = await req('GET', '/api/assets?limit=2&page=2', { cookie });
  assert.equal(page2.data.assets.length, 1);
  assert.equal(page2.data.assets[0].bar_code, 'BC003');
});

test('搜尋入面嘅引號唔會整到 SQL 壞', async () => {
  const cookie = await login('member', MEMBER_PW);
  const res = await req(
    'GET',
    `/api/assets?q=${encodeURIComponent("' OR '1'='1")}`,
    { cookie }
  );
  assert.equal(res.status, 200);
  assert.equal(res.data.total, 0);
});

/* ---------- 查找頁面 ---------- */

test('七個欄位每個都可以搵返返相關嘅電腦', async () => {
  const cookie = await login('member', MEMBER_PW);

  const cases = [
    ['bar_code=BC002', 'BC002'],
    ['location=ST-LSB', 'BC003'],
    ['model_no=ThinkPad', 'BC002'],
    ['asset_group=PRINTER', 'BC003'],
    ['brand=EPSON', 'BC003'],
    ['serial_no=SN001', 'BC001'],
    ['status=loaned', 'BC002'],
  ];

  for (const [query, expected] of cases) {
    const res = await req('GET', `/api/assets/lookup?${query}`, { cookie });
    assert.equal(res.status, 200, `${query} 應該查得到`);
    assert.equal(res.data.total, 1, `${query} 應該搵到 ${expected}`);
    assert.equal(res.data.assets[0].bar_code, expected);
  }
});

test('查找可以只填一部分，唔使打晒成個名', async () => {
  const cookie = await login('member', MEMBER_PW);
  const res = await req('GET', '/api/assets/lookup?brand=ep', { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.total, 1);
  assert.equal(res.data.assets[0].bar_code, 'BC003');
});

test('填多過一個欄位，就要全部啱先會顯示', async () => {
  const cookie = await login('member', MEMBER_PW);

  const both = await req('GET', '/api/assets/lookup?brand=LENOVO&model_no=ThinkPad', { cookie });
  assert.equal(both.data.total, 1);
  assert.equal(both.data.assets[0].bar_code, 'BC002');

  const clash = await req('GET', '/api/assets/lookup?brand=LENOVO&model_no=EliteDesk', { cookie });
  assert.equal(clash.data.total, 0);
});

test('乜都冇填就會話你知要填一樣嘢', async () => {
  const cookie = await login('member', MEMBER_PW);
  const res = await req('GET', '/api/assets/lookup', { cookie });
  assert.equal(res.status, 400);
  assert.match(res.data.message, /最少填一個/);
});

test('查找位置會連 Excel 原始位置一齊搵', async () => {
  const cookie = await login('member', MEMBER_PW);

  // BC001 嘅位置已經俾人改咗做 YIA 999，但 Excel 原始位置仍然係 LSK 408
  const current = await req('GET', '/api/assets/lookup?location=YIA+999', { cookie });
  assert.equal(current.data.total, 1);
  assert.equal(current.data.assets[0].bar_code, 'BC001');

  const original = await req('GET', '/api/assets/lookup?location=LSK+408', { cookie });
  assert.equal(original.data.total, 1);
  assert.equal(original.data.assets[0].bar_code, 'BC001');
});

test('可以按樓宇搵，樓宇係完全匹配', async () => {
  const cookie = await login('member', MEMBER_PW);

  // BC001 搬咗去 YIA 999，BC002 原本就喺 YIA 606 ERM
  const yia = await req('GET', '/api/assets/lookup?building=YIA', { cookie });
  assert.equal(yia.data.total, 2);
  assert.deepEqual(
    yia.data.assets.map((a) => a.bar_code).sort(),
    ['BC001', 'BC002']
  );

  const lsb = await req('GET', '/api/assets/lookup?building=ST-LSB', { cookie });
  assert.equal(lsb.data.total, 1);
  assert.equal(lsb.data.assets[0].bar_code, 'BC003');

  const moved = await req('GET', '/api/assets/lookup?building=LSK', { cookie });
  assert.equal(moved.data.total, 0, 'BC001 已經搬咗，LSK 應該冇嘢');
});

test('樓宇可以同其他欄位一齊用', async () => {
  const cookie = await login('member', MEMBER_PW);

  const hit = await req('GET', '/api/assets/lookup?building=YIA&brand=LENOVO', { cookie });
  assert.equal(hit.data.total, 1);
  assert.equal(hit.data.assets[0].bar_code, 'BC002');

  const miss = await req('GET', '/api/assets/lookup?building=YIA&brand=EPSON', { cookie });
  assert.equal(miss.data.total, 0);
});

test('下拉清單有位置同型號俾用', async () => {
  const cookie = await login('member', MEMBER_PW);
  const res = await req('GET', '/api/assets/filters', { cookie });
  assert.equal(res.status, 200);

  assert.ok(res.data.locations.length > 0, '應該有位置清單');
  assert.ok(res.data.models.length > 0, '應該有型號清單');
  assert.ok(res.data.locations.every((r) => typeof r.value === 'string' && r.value));
  assert.ok(res.data.models.every((r) => typeof r.value === 'string' && r.value));
  assert.ok(res.data.models.every((r) => typeof r.n === 'number'));
});

test('查找入面嘅引號唔會整到 SQL 壞', async () => {
  const cookie = await login('member', MEMBER_PW);
  const res = await req(
    'GET',
    `/api/assets/lookup?bar_code=${encodeURIComponent("' OR '1'='1")}`,
    { cookie }
  );
  assert.equal(res.status, 200);
  assert.equal(res.data.total, 0);
});

/* ---------- 資產資料庫唔可以由網頁攞走 ---------- */

test('資產資料庫唔可以由網頁攞走', async () => {
  for (const p of ['/db/assets.db', '/db/assets.db-wal', '/db/schema-assets.sql']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 403, `${p} 應該被擋`);
  }
});

/* ---------- 由 Excel 匯入 ---------- */

const EXCEL_HEADER = [
  'Row No',
  'Bar Code',
  'EA No',
  'Asset No',
  'AC Code',
  'Arr Date',
  'PO/DN_No',
  'PO Date',
  'Location',
  'EquipmentStatus',
  'Asset Group',
  'Supplier/Band',
  'Model No',
  'Serial No',
  'Date',
  'Year',
  'Job No',
  'Ref',
  'Old Serial No',
  'Remark',
  'Last Loc.',
];

function excelRow(barCode, location) {
  return [
    '1',
    barCode,
    'EA001',
    'AST001',
    'AC001',
    '04.07.16',
    'PO-001',
    '01.06.16',
    location,
    'USED',
    'COMPUTER SET',
    'HP',
    'EliteDesk 800',
    'SN-' + barCode,
    { serial: 43831 },
    '2526',
    'JOB1',
    'REF1',
    '',
    '第一行備註',
    '',
  ];
}

test('Excel 可以匯入成資產紀錄', async () => {
  const excelFile = path.join(tmpDir, 'import.xlsx');
  const dbFile = path.join(tmpDir, 'import.db');
  fs.writeFileSync(
    excelFile,
    makeXlsx([
      EXCEL_HEADER,
      excelRow('BC001', 'LSK 408'),
      excelRow('BC002', 'YIA 606 ERM'),
    ])
  );

  const saved = process.env.ASSETS_DB_FILE;
  process.env.ASSETS_DB_FILE = dbFile;
  try {
    await importAssets.run(excelFile, { quiet: true });
  } finally {
    if (saved === undefined) delete process.env.ASSETS_DB_FILE;
    else process.env.ASSETS_DB_FILE = saved;
  }

  const importDb = await createDb({ file: dbFile, schema: 'assets' });
  const rows = await importDb.all('SELECT * FROM assets ORDER BY bar_code');
  assert.equal(rows.length, 2);

  const first = rows[0];
  assert.equal(first.bar_code, 'BC001');
  assert.equal(first.arr_date, '2016-07-04', 'DD.MM.YY 應該變成標準日期');
  assert.equal(first.po_date, '2016-06-01');
  assert.equal(first.reg_date, '2020-01-01', 'Excel 日期序號應該變成日期');
  assert.equal(first.brand, 'HP');
  assert.equal(first.asset_group, 'COMPUTER SET');
  assert.equal(first.equipment_status, 'USED');
  assert.equal(first.building, 'LSK');
  assert.equal(first.room, '408');
  assert.equal(first.location, 'LSK 408');
  assert.equal(first.status, 'active');

  const second = rows[1];
  assert.equal(second.building, 'YIA');
  assert.equal(second.room, '606 ERM');

  await importDb.close();
});

test('人手改過嘅位置，之後匯入 Excel 都唔會被洗走', async () => {
  const excelFile = path.join(tmpDir, 'preserve.xlsx');
  const dbFile = path.join(tmpDir, 'preserve.db');
  fs.writeFileSync(
    excelFile,
    makeXlsx([EXCEL_HEADER, excelRow('BC001', 'LSK 408')])
  );

  const saved = process.env.ASSETS_DB_FILE;
  process.env.ASSETS_DB_FILE = dbFile;
  const importDb = await createDb({ file: dbFile, schema: 'assets' });

  try {
    await importAssets.run(excelFile, { quiet: true });

    // 模擬管理員喺系統改咗位置
    await importDb.run(
      "UPDATE assets SET location = 'YIA 999', building = 'YIA', room = '999', location_edited = 1 WHERE bar_code = 'BC001'"
    );

    // Excel 換咗新位置，再匯入一次
    fs.writeFileSync(
      excelFile,
      makeXlsx([EXCEL_HEADER, excelRow('BC001', 'ST-LSB 12')])
    );
    await importAssets.run(excelFile, { quiet: true });

    const row = await importDb.get('SELECT * FROM assets WHERE bar_code = ?', [
      'BC001',
    ]);

    assert.equal(row.location, 'YIA 999', '人手改嘅位置唔應該被 Excel 覆蓋');
    assert.equal(row.location_edited, 1);
    assert.equal(row.excel_location, 'ST-LSB 12', 'Excel 原始位置仲係要更新');
    assert.equal(row.building, 'YIA');
    assert.equal(row.room, '999');
  } finally {
    await importDb.close();
    if (saved === undefined) delete process.env.ASSETS_DB_FILE;
    else process.env.ASSETS_DB_FILE = saved;
  }
});

test('重複匯入同一份 Excel 唔會整出重複紀錄', async () => {
  const excelFile = path.join(tmpDir, 'idem.xlsx');
  const dbFile = path.join(tmpDir, 'idem.db');
  fs.writeFileSync(
    excelFile,
    makeXlsx([EXCEL_HEADER, excelRow('BC001', 'LSK 408')])
  );

  const saved = process.env.ASSETS_DB_FILE;
  process.env.ASSETS_DB_FILE = dbFile;
  const importDb = await createDb({ file: dbFile, schema: 'assets' });

  try {
    await importAssets.run(excelFile, { quiet: true });
    await importAssets.run(excelFile, { quiet: true });

    const total = await importDb.get('SELECT COUNT(*) AS n FROM assets');
    assert.equal(total.n, 1);
  } finally {
    await importDb.close();
    if (saved === undefined) delete process.env.ASSETS_DB_FILE;
    else process.env.ASSETS_DB_FILE = saved;
  }
});
