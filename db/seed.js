#!/usr/bin/env node
'use strict';
/*
 * 產生 30 個會員帳戶
 *
 * 開法：npm run seed
 *
 * 每個會員都有一個隨機初始密碼，會寫入 db/initial-passwords.txt。
 * 呢個檔案已經加入 .gitignore，唔會上傳到 GitHub。
 * 派發俾會員之後，記得刪走呢個檔案。
 */

const fs = require('node:fs');
const path = require('node:path');

const { createDb } = require('../src/db');
const auth = require('../src/auth');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'members.db');
const OUT_FILE = path.join(__dirname, 'initial-passwords.txt');

// 第一個係管理員（可以睇登入紀錄同管理會員）
const MEMBERS = [
  { username: 'nelson',          name: 'Nelson Cheung', role: 'admin' },
  { username: 'cheung_chi_ming', name: '陳志明' },
  { username: 'lee_ka_yan',      name: '李嘉欣' },
  { username: 'wong_wai_keung',  name: '黃偉強' },
  { username: 'cheung_ka_ho',    name: '張家豪' },
  { username: 'ho_ka_chun',      name: '何家俊' },
  { username: 'lau_mei_ling',    name: '劉美玲' },
  { username: 'chan_ho_yan',     name: '陳可欣' },
  { username: 'cheung_kok_wing', name: '張國榮' },
  { username: 'li_wing_sze',     name: '李詠詩' },
  { username: 'wong_shuk_yi',    name: '黃淑儀' },
  { username: 'ng_kat_sing',     name: '吳日昇' },
  { username: 'cheng_mei_fung',  name: '鄭美鳳' },
  { username: 'chow_wai_man',    name: '周慧敏' },
  { username: 'tsang_chun_kit',  name: '曾俊傑' },
  { username: 'ma_wing_sze',     name: '馬詠詩' },
  { username: 'choi_ya_man',     name: '蔡雅文' },
  { username: 'hui_tak_on',      name: '許德安' },
  { username: 'fung_ka_chun',    name: '馮家俊' },
  { username: 'leung_chi_hou',   name: '梁子豪' },
  { username: 'song_wai_ming',   name: '宋偉明' },
  { username: 'tang_pui_yi',     name: '鄧佩儀' },
  { username: 'ho_si_man',       name: '何思敏' },
  { username: 'lam_pak_hin',     name: '林柏軒' },
  { username: 'yuen_suet_ying',  name: '袁雪凝' },
  { username: 'chan_lok_hang',   name: '陳樂行' },
  { username: 'pan_chi_keung',   name: '潘志強' },
  { username: 'fan_won_wai',     name: '范文慧' },
  { username: 'ko_chun_yu',      name: '高振宇' },
  { username: 'lau_kwok_wai',    name: '劉國偉' },
  { username: 'cheng_siu_mei',   name: '鄭小美' },
];

function freshPassword() {
  let password = auth.generatePassword();
  while (!auth.checkPasswordStrength(password).ok) {
    password = auth.generatePassword();
  }
  return password;
}

async function main() {
  const db = await createDb({ file: DB_FILE });

  const lines = [];
  let created = 0;
  let skipped = 0;

  for (const member of MEMBERS) {
    const existing = await db.get('SELECT id FROM users WHERE username = ?', [member.username]);
    if (existing) {
      skipped += 1;
      continue;
    }

    const password = freshPassword();
    const hash = await auth.hashPassword(password);
    await db.run(
      'INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, ?)',
      [member.username, member.name, hash, member.role || 'member']
    );

    lines.push(
      [member.username.padEnd(18), member.name.padEnd(16), password].join('  ')
    );
    created += 1;
  }

  await db.close();

  if (created > 0) {
    const header = [
      '# 會員初始帳戶密碼',
      '# 派發俾會員之後請刪走呢個檔案（密碼只出現一次）',
      '# 格式：  帳戶名              姓名              初始密碼',
      '',
    ].join('\n');
    fs.writeFileSync(OUT_FILE, header + lines.join('\n') + '\n', { mode: 0o600 });
  }

  console.log('');
  console.log(`  新增會員： ${created} 個`);
  if (skipped) console.log(`  跳過（已經存在）： ${skipped} 個`);
  if (created > 0) {
    console.log(`  密碼寫咗落： ${OUT_FILE}`);
    console.log('  記得派發之後刪走，唔好上載到 GitHub');
  }
  console.log('');
}

main().catch((err) => {
  console.error('搞掂唔到會員資料：', err);
  process.exit(1);
});
