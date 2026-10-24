'use strict';
/*
 * 極簡 XLSX 讀取器 —— 零依賴（只用 Node 內置嘅 zlib）
 *
 * 點解唔用 npm 裝套件？
 *   呢個專案一路都係「零 npm 依賴」嘅設計，咁樣日後唔使理依賴更新。
 *   xlsx 其實就係一個 ZIP 入面放幾個 XML 檔案，用內置 zlib 解壓就得。
 *
 * 支援：
 *   - sharedStrings（共用字串，Excel 最常見嘅做法）
 *   - inlineStr（直接寫喺格仔入面嘅字串）
 *   - 數字、日期（用 Excel 嘅日期序號）
 *   - 布林值
 *
 * 用法：
 *   const { readXlsx } = require('./src/xlsx');
 *   const book = readXlsx('/path/to/file.xlsx');
 *   book.sheets[0].name   // 工作表名
 *   book.sheets[0].rows   // 二維陣列，格仔可能係 字串 / 數字 / Date / null
 */

const fs = require('node:fs');
const zlib = require('node:zlib');

/* ---------- ZIP ---------- */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEndOfCentralDirectory(buf) {
  // ZIP 結尾最多可以喺檔尾前 65557 + 22 個位元組
  const floor = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function readCentralDirectory(buf) {
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) throw new Error('唔係一個有效嘅 .xlsx 檔案（ZIP 結構損壞）');

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CEN_SIG) break;
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

function readZipEntry(buf, entry) {
  const off = entry.localOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== LOC_SIG) {
    throw new Error('ZIP 檔案損壞');
  }
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const start = off + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compSize);

  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`未支援嘅壓縮方式（method ${entry.method}）`);
}

/* ---------- XML 小工具 ---------- */

function decodeEntities(text) {
  return text.replace(
    /&(?:#x([0-9a-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g,
    (whole, hex, dec, name) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[name];
    }
  );
}

function parseAttributes(tag) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) out[m[1]] = decodeEntities(m[2]);
  return out;
}

/** 抽出一個節點入面所有 <t> 文字（處理 <si> 入面有好多 <r> run 嘅情況） */
function extractText(xml) {
  const parts = [];
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    parts.push(m[1] === undefined ? '' : decodeEntities(m[1]));
  }
  return parts.join('');
}

/** Excel 欄位名轉欄號：A → 0、Z → 25、AA → 26 */
function columnIndex(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

/* ---------- 日期格式 ---------- */

// Excel 內置格式入面，邊啲係日期／時間
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

function parseStyles(xml) {
  const custom = new Map();
  const nfRe = /<numFmt\b[^>]*\/>/g;
  let m;
  while ((m = nfRe.exec(xml))) {
    const a = parseAttributes(m[0]);
    const id = Number(a.numFmtId);
    if (Number.isFinite(id)) custom.set(id, a.formatCode ?? '');
  }

  const dateStyles = new Set();
  const cxMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!cxMatch) return { dateStyles };

  const xfRe = /<xf\b[^>]*\/?>/g;
  let index = 0;
  while ((m = xfRe.exec(cxMatch[1]))) {
    const a = parseAttributes(m[0]);
    const id = Number(a.numFmtId ?? 0);
    let isDate = BUILTIN_DATE_FORMATS.has(id);

    if (!isDate && custom.has(id)) {
      // 自訂格式：拎走引號內嘅文字同方括號條件，再睇有冇日期字母
      const code = custom
        .get(id)
        .replace(/"[^"]*"/g, '')
        .replace(/\[[^\]]*\]/g, '');
      isDate = /[ymdhs]/i.test(code);
    }

    if (isDate) dateStyles.add(index);
    index++;
  }

  return { dateStyles };
}

/** Excel 日期序號 → JS Date（用 1900 日期系統） */
function serialToDate(serial) {
  const days = Math.floor(serial);
  const ms = Date.UTC(1899, 11, 30) + days * 86400000;
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
}

/* ---------- 工作表 ---------- */

function parseSharedStrings(xml) {
  const out = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    out.push(m[1] === undefined ? '' : extractText(m[1]));
  }
  return out;
}

function parseSheet(xml, shared, dateStyles) {
  if (!xml) return [];

  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let rm;

  while ((rm = rowRe.exec(xml))) {
    if (rm[1] === undefined) {
      rows.push([]);
      continue;
    }

    const cells = [];
    const cellRe = /<c\b[^>]*>([\s\S]*?)<\/c>|<c\b[^>]*\/>/g;
    let cm;

    while ((cm = cellRe.exec(rm[1]))) {
      if (cm[1] === undefined) continue;

      const openTag = /<c\b([^>]*)>/.exec(cm[0]);
      const attrs = parseAttributes(openTag ? openTag[1] : '');
      const ref = attrs.r ?? '';
      const col = ref ? columnIndex(ref) : cells.length;
      const type = attrs.t ?? 'n';
      const styleIdx = Number(attrs.s ?? NaN);

      let value = null;

      if (type === 'inlineStr') {
        value = extractText(cm[1]);
      } else {
        const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cm[1]);
        const raw = vMatch ? decodeEntities(vMatch[1]) : '';

        if (type === 's') {
          const idx = Number(raw);
          value = Number.isInteger(idx) ? (shared[idx] ?? '') : '';
        } else if (type === 'b') {
          value = raw === '1';
        } else if (type === 'str' || type === 'e') {
          value = raw;
        } else if (raw !== '') {
          const num = Number(raw);
          if (Number.isFinite(num)) {
            value = Number.isInteger(styleIdx) && dateStyles.has(styleIdx)
              ? serialToDate(num)
              : num;
          } else {
            value = raw;
          }
        }
      }

      // 補齊中間嘅空格，令每行欄位對得齊
      while (cells.length < col) cells.push(null);
      cells[col] = value;
    }

    rows.push(cells);
  }

  return rows;
}

/* ---------- 公開接口 ---------- */

function readXlsx(filePath) {
  const buf = fs.readFileSync(filePath);
  const entries = readCentralDirectory(buf);

  const getText = (name) => {
    const entry = entries.get(name);
    if (!entry) return null;
    return readZipEntry(buf, entry).toString('utf8');
  };

  const sharedXml = getText('xl/sharedStrings.xml');
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  const stylesXml = getText('xl/styles.xml');
  const { dateStyles } = stylesXml ? parseStyles(stylesXml) : { dateStyles: new Set() };

  // 工作表名稱同檔案嘅對應關係
  const workbookXml = getText('xl/workbook.xml') ?? '';
  const relsXml = getText('xl/_rels/workbook.xml.rels') ?? '';
  const relTargets = new Map();
  const relRe = /<Relationship\b[^>]*\/>/g;
  let rm;
  while ((rm = relRe.exec(relsXml))) {
    const a = parseAttributes(rm[0]);
    if (a.Id && a.Target) relTargets.set(a.Id, a.Target.replace(/^\/?xl\//, ''));
  }

  const sheets = [];
  const sheetRe = /<sheet\b[^>]*\/>/g;
  let sm;
  while ((sm = sheetRe.exec(workbookXml))) {
    const a = parseAttributes(sm[0]);
    const rid = a['r:id'] ?? a.id;
    const target = relTargets.get(rid);
    if (!target) continue;
    sheets.push({ name: a.name ?? '', path: `xl/${target.replace(/^\.?\//, '')}` });
  }

  if (!sheets.length) {
    // 退而求其次：直接用第一張工作表
    for (const name of entries.keys()) {
      if (/^xl\/worksheets\/.*\.xml$/.test(name)) {
        sheets.push({ name: '工作表1', path: name });
        break;
      }
    }
  }

  const parsed = sheets.map((sheet) => ({
    name: sheet.name,
    rows: parseSheet(getText(sheet.path), shared, dateStyles),
  }));

  return { sheets: parsed };
}

module.exports = { readXlsx, serialToDate, columnIndex, decodeEntities };
