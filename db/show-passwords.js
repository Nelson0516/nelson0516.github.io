#!/usr/bin/env node
'use strict';
/*
 * 喺終端機直接睇返所有會員嘅初始密碼
 *
 * 開法：npm run passwords
 *
 * （如果已經派發咗密碼、刪走咗個檔案，呢個指令就會話畀你聽）
 */

const fs = require('node:fs');
const path = require('node:path');

const OUT_FILE = path.join(__dirname, 'initial-passwords.txt');

if (!fs.existsSync(OUT_FILE)) {
  console.log('');
  console.log('  搵唔到 db/initial-passwords.txt。');
  console.log('  可能已經派發咗密碼之後刪咗。');
  console.log('');
  console.log('  如果你係管理員，可以喺 http://localhost:4321/admin.html');
  console.log('  用「重設密碼」產生一個新密碼。');
  console.log('');
  process.exit(0);
}

const lines = fs.readFileSync(OUT_FILE, 'utf8').split('\n');
const rows = lines
  .filter((line) => line.trim() && !line.trim().startsWith('#'))
  .map((line) => line.trim().split(/\s{2,}/));

console.log('');
console.log('  ' + '帳戶名'.padEnd(18) + '姓名'.padEnd(18) + '初始密碼');
console.log('  ' + '-'.repeat(60));
for (const [username, name, password] of rows) {
  console.log('  ' + String(username).padEnd(18) + String(name).padEnd(18) + password);
}
console.log('');
console.log(`  共 ${rows.length} 個帳戶`);
console.log('  派發完之後記得刪走 db/initial-passwords.txt');
console.log('');
