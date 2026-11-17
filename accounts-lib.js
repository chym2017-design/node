// ================================================================
//  UDD 账号库 — 多用户网页版共用
//
//  存储：$UDD_DATA_ROOT/accounts.json（默认 ~/UDD-Data/accounts.json）
//        {
//          "version": 1,
//          "users":   { "用户名": { salt, hash, createdAt } },
//          "invites": { "邀请码": { createdAt, usedBy, usedAt } }
//        }
//  密码：scrypt(N=16384, r=8, p=1) + 16 字节随机盐，只存哈希
//  用户空间：$UDD_DATA_ROOT/users/<用户名>/
// ================================================================
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const DATA_ROOT = path.resolve(
  process.env.UDD_DATA_ROOT || path.join(os.homedir(), 'UDD-Data')
);
const USERS_DIR = path.join(DATA_ROOT, 'users');
const ACCOUNTS_FILE = path.join(DATA_ROOT, 'accounts.json');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let writeQueue = Promise.resolve();

function withLock(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {});
  return run;
}

function ensureDirs() {
  fs.mkdirSync(USERS_DIR, { recursive: true });
  try { fs.chmodSync(DATA_ROOT, 0o700); } catch (e) { /* ignore */ }
  try { fs.chmodSync(USERS_DIR, 0o700); } catch (e) { /* ignore */ }
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    writeAccounts({ users: {}, invites: {} });
  }
}

function readAccounts() {
  try {
    const j = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    return { users: j.users || {}, invites: j.invites || {} };
  } catch (e) {
    return { users: {}, invites: {} };
  }
}

function writeAccounts(data) {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const tmp = ACCOUNTS_FILE + '.' + process.pid + '.tmp';
  const body = JSON.stringify({
    version: 1,
    users: data.users || {},
    invites: data.invites || {},
  }, null, 2);
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch (e) { /* ignore */ }
  fs.renameSync(tmp, ACCOUNTS_FILE);
}

function isValidUsername(name) {
  if (typeof name !== 'string') return false;
  const s = name.trim();
  // 字母（含中文）/数字开头，后续允许 _ -；2–32 个字符
  return /^[\p{L}\p{N}][\p{L}\p{N}_-]{1,31}$/u.test(s);
}

function userRoot(username) {
  return path.join(USERS_DIR, username);
}

// 返回 { dir, real }；首次创建用户目录时放入一份使用说明书（如果存在）
function ensureWorkspace(username, manualPath) {
  const dir = userRoot(username);
  fs.mkdirSync(dir, { recursive: true });
  try { fs.chmodSync(dir, 0o700); } catch (e) { /* ignore */ }
  if (manualPath && fs.existsSync(manualPath)) {
    const dst = path.join(dir, path.basename(manualPath));
    if (!fs.existsSync(dst)) {
      try { fs.copyFileSync(manualPath, dst); } catch (e) { /* ignore */ }
    }
  }
  return { dir, real: fs.realpathSync(dir) };
}

async function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, s, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt: s, hash: key.toString('hex') };
}

async function verifyPassword(password, rec) {
  if (!rec || !rec.salt || !rec.hash) {
    // 用户不存在时也跑一次 scrypt，避免用响应时间枚举用户名
    try { await scrypt(password, 'udd-nonexistent-user', 64); } catch (e) { /* ignore */ }
    return false;
  }
  const key = await scrypt(password, rec.salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(rec.hash, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(key, expected);
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateInviteCode(len = 12) {
  let out = '';
  for (let i = 0; i < len; i++) out += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
  return out;
}

function envInviteCodes() {
  return String(process.env.UDD_INVITE_CODES || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
}

// 返回 { ok, code, env, reason }
function checkInvite(data, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { ok: false, reason: '请输入邀请码' };
  if (envInviteCodes().includes(code)) return { ok: true, code, env: true };
  const inv = data.invites[code];
  if (!inv) return { ok: false, reason: '邀请码无效' };
  if (inv.usedBy) return { ok: false, reason: '邀请码已被使用' };
  return { ok: true, code, env: false };
}

function markInvite(data, code, username) {
  const inv = data.invites[code];
  if (!inv) return;
  inv.usedBy = username;
  inv.usedAt = new Date().toISOString();
}

module.exports = {
  DATA_ROOT,
  USERS_DIR,
  ACCOUNTS_FILE,
  SESSION_TTL_MS,
  withLock,
  ensureDirs,
  readAccounts,
  writeAccounts,
  isValidUsername,
  userRoot,
  ensureWorkspace,
  hashPassword,
  verifyPassword,
  generateInviteCode,
  checkInvite,
  markInvite,
};
