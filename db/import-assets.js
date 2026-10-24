'use strict';
/*
 * 由 Excel 匯入電腦資產資料
 *
 * 用法：
 *   npm run import-assets                      ← 自動搵 ~/Documents 入面嘅 Excel
 *   npm run import-assets -- /path/to/file.xlsx
 *
 * 匯入係「智能」嘅：
 *   - 條碼（Bar Code）做主鍵，Excel 有咩就更新咩
 *   - 系統自己加嘅欄位（狀態、負責人、備註）唔會被洗走
 *   - 如果管理員喺系統改過位置，Excel 嘅位置唔會覆蓋返
 *
 * 所以你可以隔幾個禮拜再匯入新一次 Excel，都唔會失去自己加嘅資料。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readXlsx } = require('../src/xlsx');
const { createDb } = require('../src/db');
const { parseLocation, mapSheetRow } = require('../src/assets');

const DB_FILE = process.env.ASSETS_DB_FILE || path.join(__dirname, 'assets.db');

// 由 Excel 匯入嘅欄位（每次匯入都會更新）
const EXCEL_COLUMNS = [
  'row_no',
  'ea_no',
  'asset_no',
  'ac_code',
  'arr_date',
  'po_no',
  'po_date',
  'excel_location',
  'equipment_status',
  'asset_group',
  'brand',
  'model_no',
  'serial_no',
  'reg_date',
  'fin_year',
  'job_no',
  'ref_code',
  'old_serial_no',
  'remark',
  'last_location',
];

function findExcelFile(explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`搵唔到呢個檔案：${resolved}`);
    }
    return resolved;
  }

  const home = os.homedir();
  const candidates = [];

  // ~/Documents 入面所有 Excel
  const docs = path.join(home, 'Documents');
  if (fs.existsSync(docs)) {
    for (const name of fs.readdirSync(docs)) {
      if (!/\.xlsx$/i.test(name)) continue;
      if (name.startsWith('~$')) continue; // Excel 開住嗰陣嘅暫存檔
      const full = path.join(docs, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        candidates.push({ full, mtime: stat.mtimeMs, name });
      } catch {
        // 權限問題就跳過
      }
    }
  }

  if (!candidates.length) {
    throw new Error(
      '~/Documents 入面搵唔到 Excel 檔案。\n' +
        '請直接指定個檔案：npm run import-assets -- ~/Documents/你嘅檔案.xlsx'
    );
  }

  // 有 "CUHK" 或者 "Computer" 字眼嘅優先，其次係最新修改嘅
  candidates.sort((a, b) => {
    const score = (c) => (/CUHK|Computer|電腦|資產/i.test(c.name) ? 1 : 0);
    const diff = score(b) - score(a);
    if (diff) return diff;
    return b.mtime - a.mtime;
  });

  return candidates[0].full;
}

function pickSheet(book) {
  // 攞第一張有資料嘅工作表
  for (const sheet of book.sheets) {
    if (sheet.rows.length > 1) return sheet;
  }
  if (book.sheets.length) return book.sheets[0];
  throw new Error('個 Excel 入面搵唔到工作表');
}

async function run(explicitPath, options = {}) {
  const quiet = !!options.quiet;
  const say = (...args) => {
    if (!quiet) console.log(...args);
  };

  const arg =
    explicitPath ?? process.argv.slice(2).find((a) => !a.startsWith('-'));
  const file = findExcelFile(arg);
  const dbFile = process.env.ASSETS_DB_FILE || DB_FILE;

  say('');
  say('  讀取 Excel：', file);

  const book = readXlsx(file);
  const sheet = pickSheet(book);
  const header = sheet.rows[0];

  say('  工作表：', sheet.name, '（', sheet.rows.length - 1, '行 ）');
  say('');

  const db = await createDb({
    file: dbFile,
    schema: path.join(__dirname, 'schema-assets.sql'),
  });

  try {
    const existing = await db.all('SELECT * FROM assets');
    const byBarCode = new Map(existing.map((a) => [a.bar_code, a]));

    let added = 0;
    let updated = 0;
    let skipped = 0;
    const seen = new Set();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    for (let i = 1; i < sheet.rows.length; i++) {
      const raw = sheet.rows[i];
      if (!raw || raw.every((v) => v === null || v === '')) continue;

      const data = mapSheetRow(header, raw);
      const barCode = data.bar_code;

      if (!barCode) {
        skipped++;
        continue;
      }

      seen.add(barCode);

      const { building, room } = parseLocation(data.excel_location);
      const current = byBarCode.get(barCode);

      if (!current) {
        await db.run(
          `INSERT INTO assets
             (bar_code, ${EXCEL_COLUMNS.join(', ')}, location, building, room, status, imported_at)
           VALUES (?, ${EXCEL_COLUMNS.map(() => '?').join(', ')}, ?, ?, ?, 'active', ?)`,
          [
            barCode,
            ...EXCEL_COLUMNS.map((c) => data[c] ?? null),
            data.excel_location ?? null,
            building,
            room,
            now,
          ]
        );
        added++;
        continue;
      }

      // 已經喺資料庫入面：更新 Excel 欄位，但保留系統自己嘅資料
      const updates = EXCEL_COLUMNS.map((c) => `${c} = ?`);
      const params = EXCEL_COLUMNS.map((c) => data[c] ?? null);

      // 位置：如果管理員喺系統改過，就用返人手改嘅；
      //       冇改過就同 Excel 一致。樓宇同房間永遠跟住「現行位置」計。
      const effectiveLocation = current.location_edited
        ? current.location
        : (data.excel_location ?? null);
      const effective = parseLocation(effectiveLocation);

      updates.push('location = ?');
      params.push(effectiveLocation);
      updates.push('building = ?');
      params.push(effective.building);
      updates.push('room = ?');
      params.push(effective.room);

      updates.push('imported_at = ?');
      params.push(now);
      params.push(current.id);

      await db.run(`UPDATE assets SET ${updates.join(', ')} WHERE id = ?`, params);
      updated++;
    }

    // 資料庫有、但新 Excel 冇嘅
    const missing = existing.filter((a) => !seen.has(a.bar_code));

    say('  匯入完成：');
    say('    新增：', added, '部');
    say('    更新：', updated, '部');
    if (skipped) say('    冇條碼跳過：', skipped, '行');

    if (missing.length) {
      say('');
      say('  ⚠️  資料庫有，但今次 Excel 冇嘅（' + missing.length + ' 部）：');
      for (const m of missing.slice(0, 15)) {
        say('      ', m.bar_code, '｜', m.brand ?? '', m.model_no ?? '', '｜', m.location ?? '');
      }
      if (missing.length > 15) say('       …… 仲有', missing.length - 15, '部');
      say('    （呢啲紀錄冇被刪除，只係提醒你留意。）');
    }

    const total = await db.get('SELECT COUNT(*) AS n FROM assets');
    say('');
    say('  資料庫總數：', total?.n ?? 0, '部');
    say('');
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('');
    console.error('  匯入失敗：', err.message);
    console.error('');
    process.exit(1);
  });
}

module.exports = { run, findExcelFile, EXCEL_COLUMNS };
