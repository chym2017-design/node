#!/usr/bin/env node
// ================================================================
//  UDD 账号管理 CLI
//
//  用法：
//    node accounts-admin.js list
//    node accounts-admin.js invite [数量]
//    node accounts-admin.js passwd <用户名> [新密码]
//
//  数据文件：~/UDD-Data/accounts.json（可用 UDD_DATA_ROOT 覆盖）
// ================================================================
const path = require('path');
const readline = require('readline');
const A = require('./accounts-lib');

const cmd = process.argv[2] || '';

function usage() {
  console.log(`用法:
  node accounts-admin.js list
  node accounts-admin.js invite [数量]
  node accounts-admin.js passwd <用户名> [新密码]`);
}

function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

(async function main() {
  A.ensureDirs();

  if (cmd === 'list') {
    const data = A.readAccounts();
    const users = Object.keys(data.users);
    console.log(`数据目录: ${A.DATA_ROOT}`);
    console.log(`用户数: ${users.length}`);
    for (const name of users) {
      console.log(`  - ${name}  注册于 ${data.users[name].createdAt || '未知'}`);
    }
    const unused = Object.keys(data.invites).filter(c => !data.invites[c].usedBy);
    console.log(`未使用邀请码: ${unused.length}`);
    for (const c of unused) {
      console.log(`  ${c}  创建于 ${data.invites[c].createdAt || '未知'}`);
    }
    return;
  }

  if (cmd === 'invite') {
    const count = Math.max(1, Math.min(50, parseInt(process.argv[3], 10) || 1));
    const codes = await A.withLock(async () => {
      const data = A.readAccounts();
      const out = [];
      for (let i = 0; i < count; i++) {
        let code;
        do { code = A.generateInviteCode(); } while (data.invites[code]);
        data.invites[code] = { createdAt: new Date().toISOString(), usedBy: null };
        out.push(code);
      }
      A.writeAccounts(data);
      return out;
    });
    console.log('已生成邀请码（一次性）：');
    for (const c of codes) console.log('  ' + c);
    return;
  }

  if (cmd === 'passwd') {
    const user = String(process.argv[3] || '').trim();
    if (!user) { usage(); process.exit(1); }
    let pw = process.argv[4];
    if (!pw) {
      pw = await prompt(`为 ${user} 设置新密码（至少 8 位）: `);
    }
    if (String(pw).length < 8) {
      console.error('密码至少 8 位');
      process.exit(1);
    }
    const rec = await A.hashPassword(String(pw));
    const ok = await A.withLock(async () => {
      const data = A.readAccounts();
      if (!data.users[user]) return false;
      data.users[user].salt = rec.salt;
      data.users[user].hash = rec.hash;
      data.users[user].passwordChangedAt = new Date().toISOString();
      A.writeAccounts(data);
      return true;
    });
    if (!ok) {
      console.error('用户不存在: ' + user);
      process.exit(1);
    }
    console.log('密码已更新: ' + user);
    return;
  }

  usage();
})();
