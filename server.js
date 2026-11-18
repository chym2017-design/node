// UDD Server — 桌面版内置服务器 / 网页版服务器
// Usage: node server.js [port] [root_dir]
// Example: node server.js 8080 D:\projects\node
//
// 模式：
//   默认（桌面版）：仅本机 127.0.0.1，无认证，文件 API 可访问任意路径（沿用旧行为）
//   单用户网页版：设置 UDD_PASS 启用 HTTP Basic 认证，可配合 UDD_SANDBOX=1
//   多用户网页版：UDD_MULTIUSER=1，前台注册/登录 + 邀请码 + 每用户独立目录
//
// 环境变量：
//   UDD_HOST=0.0.0.0        监听地址，默认 127.0.0.1（仅本机）
//   UDD_PORT=8080           监听端口
//   UDD_MULTIUSER=1         启用多账号模式
//   UDD_DATA_ROOT=/path     多账号数据根目录，默认 ~/UDD-Data
//   UDD_ROOT=/path          单用户模式的数据根目录（桌面版由主进程传入）
//   UDD_SANDBOX=1           单用户模式：文件 API 只允许访问 UDD_ROOT 内的路径
//   UDD_USER / UDD_PASS     单用户模式 HTTP Basic 认证
//   UDD_ALLOW_ANON=1        非本机监听且无认证时强制放行（危险，仅调试用）
//   UDD_INVITE_CODES=a,b    多账号模式下额外接受的可复用邀请码
//   UDD_MAX_UPLOAD_MB       单次写入上传上限，默认 1024

const http = require('http');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const zlib = require('zlib');
const accounts = require('./accounts-lib');
const space = require('./space-lib');

const APP_DIR = __dirname;
const PORT = parseInt(process.env.UDD_PORT, 10) || parseInt(process.argv[2], 10) || 8080;
const HOST = process.env.UDD_HOST || '127.0.0.1';
const MULTIUSER = process.env.UDD_MULTIUSER === '1';
const SANDBOX = process.env.UDD_SANDBOX === '1' || MULTIUSER;
const LEGACY_ROOT_DIR = path.resolve(process.env.UDD_ROOT || process.argv[3] || APP_DIR);
const AUTH_USER = process.env.UDD_USER || 'udd';
const AUTH_PASS = process.env.UDD_PASS || '';
const ALLOW_ANON = process.env.UDD_ALLOW_ANON === '1';
const MAX_UPLOAD = (parseInt(process.env.UDD_MAX_UPLOAD_MB, 10) || 1024) * 1024 * 1024;
const LOOPBACK = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
const MANUAL_PATH = path.join(APP_DIR, '使用说明书.udd');

const SESSION_COOKIE = 'udd_sid';
const SESSION_TTL_MS = accounts.SESSION_TTL_MS;

if (!LOOPBACK && !MULTIUSER && !AUTH_PASS && !ALLOW_ANON) {
  console.error('\n  [安全] 拒绝在非本机地址上无认证启动。');
  console.error('  多账号模式请设置 UDD_MULTIUSER=1；单用户模式请设置 UDD_PASS=访问密码。');
  console.error('  或 UDD_ALLOW_ANON=1 强制放行（危险）。\n');
  process.exit(1);
}

const LEGACY_ROOT_REAL = (() => {
  try { return fs.realpathSync(LEGACY_ROOT_DIR); } catch (e) { return LEGACY_ROOT_DIR; }
})();
const AUTH_HASH = AUTH_PASS
  ? crypto.createHash('sha256').update(AUTH_USER + '\0' + AUTH_PASS).digest()
  : null;

// ---------------- 多账号：初始化 / 会话 / 限流 ----------------

if (MULTIUSER) {
  accounts.ensureDirs();
  const initial = accounts.readAccounts();
  if (Object.keys(initial.users).length === 0 && Object.keys(initial.invites).length === 0) {
    const code = accounts.generateInviteCode();
    initial.invites[code] = { createdAt: new Date().toISOString(), usedBy: null };
    accounts.writeAccounts(initial);
    console.log(`\n  [账号] 初始邀请码: ${code}`);
    console.log(`  [账号] 注册地址: http://localhost:${PORT}/login\n`);
  }
}

const sessions = new Map();
const workspaceCache = new Map();

function workspaceFor(username) {
  let w = workspaceCache.get(username);
  if (!w) {
    w = accounts.ensureWorkspace(username, MANUAL_PATH);
    workspaceCache.set(username, w);
  }
  return w;
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user: username, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const rec = sessions.get(token);
  if (!rec) return null;
  if (rec.expires <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return rec;
}

function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
}

function requestIsHttps(req) {
  if (req.socket && req.socket.encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

function setSessionCookie(req, res, token, maxAgeMs) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (requestIsHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (requestIsHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

setInterval(() => {
  const now = Date.now();
  for (const [token, rec] of sessions) {
    if (rec.expires <= now) sessions.delete(token);
  }
}, 60 * 60 * 1000).unref();

// 登录/注册限流（按来源 IP，窗口 10 分钟）
const rateState = new Map();

function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || '').trim()
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress)
    || 'unknown';
}

function tooMany(ip, key, max, windowMs = 10 * 60 * 1000) {
  const k = key + ':' + ip;
  const now = Date.now();
  let rec = rateState.get(k);
  if (!rec || now > rec.reset) {
    rec = { count: 0, reset: now + windowMs };
    rateState.set(k, rec);
  }
  return rec.count >= max;
}

function recordAttempt(ip, key, windowMs = 10 * 60 * 1000) {
  const k = key + ':' + ip;
  const now = Date.now();
  let rec = rateState.get(k);
  if (!rec || now > rec.reset) rec = { count: 0, reset: now + windowMs };
  rec.count += 1;
  rateState.set(k, rec);
}

function clearAttempts(ip, key) {
  rateState.delete(key + ':' + ip);
}

// ---------------- 通用工具 ----------------

function sendJSON(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, msg, status = 500) {
  sendJSON(res, { error: msg }, status);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('请求体过大');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        const err = new Error('JSON 格式错误');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (e) {
    return false;
  }
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isAuthorizedLegacy(req) {
  if (!AUTH_HASH) return true;
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  let decoded;
  try { decoded = Buffer.from(m[1], 'base64').toString('utf8'); }
  catch (e) { return false; }
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  const hash = crypto.createHash('sha256')
    .update(decoded.slice(0, sep) + '\0' + decoded.slice(sep + 1))
    .digest();
  return safeEqual(hash, AUTH_HASH);
}

function setCors(res) {
  if (AUTH_HASH) return;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// 沙箱：把用户传入的路径解析成真实路径，拒绝跑出 root 的读写。
// 目标文件尚不存在（新建/写入）时用父目录的 realpath 判断，防止通过符号链接逃逸。
function resolveSandboxed(p, rootReal, enabled) {
  const resolved = path.resolve(p);
  if (!enabled) return resolved;
  let target;
  try {
    target = fs.realpathSync(resolved);
  } catch (e) {
    let parent;
    try { parent = fs.realpathSync(path.dirname(resolved)); }
    catch (e2) { parent = path.dirname(resolved); }
    target = path.join(parent, path.basename(resolved));
  }
  if (target !== rootReal && !target.startsWith(rootReal + path.sep)) {
    const err = new Error('路径不在工作目录内');
    err.statusCode = 403;
    throw err;
  }
  // 标签元数据与回收站属于系统内部文件，不允许普通文件 API 读写
  const rel = path.relative(rootReal, target).split(path.sep).join('/');
  if (space.isReservedRel(rel)) {
    const err = new Error('该路径不可访问');
    err.statusCode = 403;
    throw err;
  }
  return resolved;
}

// 文件整理操作与标签写入串行执行，避免并发改名/移动把元数据写乱
let fsQueue = Promise.resolve();
function withFsLock(fn) {
  const run = fsQueue.then(fn, fn);
  fsQueue = run.catch(() => {});
  return run;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.udd': 'application/octet-stream',
  '.md': 'text/markdown; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// 静态资源只放行网页自身用到的类型，避免把应用目录里的数据文件直接公开
const STATIC_EXTS = new Set([
  '.html', '.js', '.css', '.json', '.map', '.png', '.jpg', '.jpeg', '.gif',
  '.webp', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf',
]);

// ---------------- 文件 API（桌面/单用户/多用户共用） ----------------

async function handleFileApi(req, res, pathname, params, ctx) {
  const { rootDir, rootReal, sandbox } = ctx;

  // === Get server root dir ===
  if (pathname === '/api/root') {
    sendJSON(res, { root: rootDir, personal: !!ctx.personal });
    return true;
  }

  // === Create folder ===
  if (pathname === '/api/mkdir' && req.method === 'POST') {
    const dir = params.get('dir') || rootDir;
    const rawName = String(params.get('name') || '').trim();
    if (!rawName) { sendError(res, '请输入文件夹名称', 400); return true; }
    if (rawName.length > 100 || rawName === '.' || rawName === '..'
        || rawName.startsWith('.') || /[\\/:*?"<>|\x00-\x1f]/.test(rawName)) {
      sendError(res, '文件夹名称不合法', 400);
      return true;
    }
    try {
      const parent = resolveSandboxed(dir, rootReal, sandbox);
      const target = resolveSandboxed(path.join(parent, rawName), rootReal, sandbox);
      if (fs.existsSync(target)) {
        sendError(res, '同名文件或文件夹已存在', 409);
        return true;
      }
      fs.mkdirSync(target);
      sendJSON(res, { ok: true, path: target, name: rawName });
    } catch (e) {
      sendError(res, e.message, e.statusCode || 400);
    }
    return true;
  }

  // === List directory ===
  if (pathname === '/api/files') {
    const dir = params.get('dir') || rootDir;
    try {
      const resolved = resolveSandboxed(dir, rootReal, sandbox);
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const meta = space.readMeta(rootDir);
      const items = entries
        .filter(e => !e.name.startsWith('.'))
        .map(e => {
          const abs = path.join(resolved, e.name);
          let st = null;
          try { st = fs.statSync(abs); } catch (err) { /* ignore */ }
          const rel = space.relOf(rootDir, abs);
          return {
            name: e.name,
            type: e.isDirectory() || (st && st.isDirectory()) ? 'dir' : 'file',
            ext: e.isFile() ? path.extname(e.name).toLowerCase() : '',
            path: abs,
            mtime: st ? st.mtimeMs : 0,
            size: st && st.isFile() ? st.size : 0,
            tags: meta ? (meta.items[rel] || []) : [],
          };
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name, 'zh-CN');
        });
      let atRoot = false;
      try { atRoot = fs.realpathSync(resolved) === rootReal; } catch (e2) {}
      const parent = sandbox && atRoot ? resolved : path.dirname(resolved);
      sendJSON(res, { dir: resolved, parent, items });
    } catch (e) {
      sendError(res, e.message, e.statusCode || 400);
    }
    return true;
  }

  // === Read file (raw binary), optionally extract entry from .udd zip ===
  if (pathname === '/api/readfile') {
    const filePath = params.get('path');
    const entryPath = params.get('entry');
    if (!filePath) { sendError(res, 'Missing path', 400); return true; }
    try {
      const resolved = resolveSandboxed(filePath, rootReal, sandbox);
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) { sendError(res, 'Not a file', 400); return true; }
      const disposition = params.get('download') === '1'
        ? { 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(resolved)) }
        : {};

      if (entryPath) {
        const zipBuf = fs.readFileSync(resolved);
        const entry = _extractZipEntry(zipBuf, entryPath);
        if (!entry) { sendError(res, 'Entry not found: ' + entryPath, 404); return true; }
        const ext = path.extname(entryPath).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        const total = entry.length;

        const rangeHeader = req.headers.range;
        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
          res.writeHead(206, {
            'Content-Type': mime,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
          });
          res.end(entry.slice(start, end + 1));
        } else {
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': total,
            'Accept-Ranges': 'bytes',
          });
          res.end(entry);
        }
        return true;
      }

      const ext = path.extname(resolved).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      const total = stat.size;

      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
        if (isNaN(start) || start < 0) start = 0;
        if (isNaN(end) || end >= total) end = total - 1;
        if (start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${total}` });
          res.end();
          return true;
        }
        res.writeHead(206, {
          'Content-Type': mime,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          ...disposition,
        });
        fs.createReadStream(resolved, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': total,
          'Accept-Ranges': 'bytes',
          ...disposition,
        });
        fs.createReadStream(resolved).pipe(res);
      }
    } catch (e) {
      sendError(res, e.message, e.statusCode || 404);
    }
    return true;
  }

  // === Read .udd raw bytes ===
  if (pathname === '/api/readudd') {
    const filePath = params.get('path');
    if (!filePath) { sendError(res, 'Missing path', 400); return true; }
    try {
      const resolved = resolveSandboxed(filePath, rootReal, sandbox);
      const data = fs.readFileSync(resolved);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length,
      });
      res.end(data);
    } catch (e) {
      sendError(res, e.message, e.statusCode || 404);
    }
    return true;
  }

  // === Write file (binary body, streamed to a temp file) ===
  if (pathname === '/api/writefile' && req.method === 'POST') {
    const filePath = params.get('path');
    if (!filePath) { sendError(res, 'Missing path', 400); return true; }
    let resolved;
    try {
      resolved = resolveSandboxed(filePath, rootReal, sandbox);
    } catch (e) {
      sendError(res, e.message, e.statusCode || 403);
      return true;
    }
    const tmpPath = resolved + '.' + process.pid + '.' + Date.now() + '.tmp';
    const out = fs.createWriteStream(tmpPath);
    let bytes = 0;
    let finished = false;
    const fail = (err, status) => {
      if (finished) return;
      finished = true;
      try { req.unpipe(out); } catch (e2) {}
      try { out.destroy(); } catch (e2) {}
      fs.unlink(tmpPath, () => {});
      if (!res.headersSent) sendError(res, err, status || 500);
    };
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_UPLOAD) {
        fail('文件超过上传大小限制', 413);
        try { req.destroy(); } catch (e2) {}
      }
    });
    req.on('error', err => fail(err.message, 400));
    req.on('close', () => { if (!req.complete) fail('请求中断', 400); });
    out.on('error', err => fail(err.message, 500));
    out.on('finish', () => {
      if (finished) return;
      finished = true;
      try {
        fs.renameSync(tmpPath, resolved);
      } catch (renameErr) {
        try {
          fs.copyFileSync(tmpPath, resolved);
          fs.unlinkSync(tmpPath);
        } catch (copyErr) {
          sendError(res, copyErr.message, 500);
          return;
        }
      }
      sendJSON(res, { ok: true, path: resolved, size: bytes });
    });
    req.pipe(out);
    return true;
  }

  // ================================================================
  //  文件整理 / 标签 / 回收站（个人空间与本地仓库）
  // ================================================================
  const readJson = async () => {
    try { return await readJsonBody(req); }
    catch (e) { sendError(res, e.message, e.statusCode || 400); return null; }
  };
  const validEntryName = name => {
    const s = String(name || '').trim();
    return s && s !== '.' && s !== '..' && !s.startsWith('.')
      && s.length <= 200 && !/[\\/:*?"<>|\x00-\x1f]/.test(s) ? s : null;
  };
  const failJson = e => sendError(res, e.message, e.statusCode || 500);

  // --- 标签 ---
  if (pathname === '/api/tags' && req.method === 'GET') {
    const meta = space.readMeta(rootDir);
    const counts = {};
    for (const [rel, ids] of Object.entries(meta.items)) {
      let ok = false;
      try { resolveSandboxed(space.absOf(rootDir, rel), rootReal, true); ok = true; } catch (e) {}
      if (!ok) continue;
      for (const id of ids) counts[id] = (counts[id] || 0) + 1;
    }
    sendJSON(res, { tags: meta.tags, counts });
    return true;
  }

  if (pathname === '/api/tags/create' && req.method === 'POST') {
    const body = await readJson(); if (!body) return true;
    const name = String(body.name || '').trim();
    const color = String(body.color || '#3b82f6');
    if (!name || name.length > 24) { sendError(res, '标签名称需为 1–24 个字符', 400); return true; }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) { sendError(res, '标签颜色格式不正确', 400); return true; }
    try {
      const tag = await withFsLock(() => {
        const meta = space.readMeta(rootDir);
        const dup = Object.values(meta.tags).some(t => String(t.name).toLowerCase() === name.toLowerCase());
        if (dup) { const err = new Error('同名标签已存在'); err.statusCode = 409; throw err; }
        const id = 't_' + crypto.randomBytes(4).toString('hex');
        meta.tags[id] = { name, color, createdAt: new Date().toISOString() };
        space.writeMeta(rootDir, meta);
        return { id, name, color };
      });
      sendJSON(res, { ok: true, tag });
    } catch (e) { failJson(e); }
    return true;
  }

  if (pathname === '/api/tags/update' && req.method === 'POST') {
    const body = await readJson(); if (!body) return true;
    const id = String(body.id || '');
    try {
      const tag = await withFsLock(() => {
        const meta = space.readMeta(rootDir);
        if (!meta.tags[id]) { const err = new Error('标签不存在'); err.statusCode = 404; throw err; }
        const name = body.name != null ? String(body.name).trim() : meta.tags[id].name;
        const color = body.color != null ? String(body.color) : meta.tags[id].color;
        if (!name || name.length > 24) { const err = new Error('标签名称需为 1–24 个字符'); err.statusCode = 400; throw err; }
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) { const err = new Error('标签颜色格式不正确'); err.statusCode = 400; throw err; }
        meta.tags[id] = { ...meta.tags[id], name, color };
        space.writeMeta(rootDir, meta);
        return { id, name, color };
      });
      sendJSON(res, { ok: true, tag });
    } catch (e) { failJson(e); }
    return true;
  }

  if (pathname === '/api/tags/delete' && req.method === 'POST') {
    const body = await readJson(); if (!body) return true;
    const id = String(body.id || '');
    try {
      await withFsLock(() => {
        const meta = space.readMeta(rootDir);
        delete meta.tags[id];
        for (const rel of Object.keys(meta.items)) {
          const next = meta.items[rel].filter(t => t !== id);
          if (next.length) meta.items[rel] = next;
          else delete meta.items[rel];
        }
        space.writeMeta(rootDir, meta);
      });
      sendJSON(res, { ok: true });
    } catch (e) { failJson(e); }
    return true;
  }

  if (pathname === '/api/tags/assign' && req.method === 'POST') {
    const body = await readJson(); if (!body) return true;
    const paths = Array.isArray(body.paths) ? body.paths.slice(0, 500) : [];
    if (!paths.length) { sendError(res, '未选择文件', 400); return true; }
    try {
      const rels = [];
      for (const p of paths) {
        const abs = resolveSandboxed(String(p), rootReal, true);
        try { if (fs.statSync(abs)) rels.push(space.relOf(rootDir, abs)); } catch (e) {}
      }
      const result = await withFsLock(() => {
        const meta = space.readMeta(rootDir);
        const add = (Array.isArray(body.add) ? body.add : []).filter(id => meta.tags[id]);
        const remove = (Array.isArray(body.remove) ? body.remove : []).filter(id => meta.tags[id]);
        space.assignTags(meta, rels, add, remove);
        space.writeMeta(rootDir, meta);
        return { updated: rels.length };
      });
      sendJSON(res, { ok: true, ...result });
    } catch (e) { failJson(e); }
    return true;
  }

  if (pathname === '/api/tag-items' && req.method === 'GET') {
    const tagId = String(params.get('tag') || '');
    const meta = space.readMeta(rootDir);
    if (!meta.tags[tagId]) { sendError(res, '标签不存在', 404); return true; }
    const items = [];
    for (const rel of Object.keys(meta.items)) {
      if (!meta.items[rel].includes(tagId)) continue;
      const abs = space.absOf(rootDir, rel);
      let st = null;
      try {
        if (resolveSandboxed(abs, rootReal, true)) st = fs.statSync(abs);
      } catch (e) { st = null; }
      if (!st) continue;
      items.push({
        name: path.basename(abs),
        type: st.isDirectory() ? 'dir' : 'file',
        ext: st.isFile() ? path.extname(abs).toLowerCase() : '',
        path: abs,
        dir: space.relOf(rootDir, path.dirname(abs)),
        mtime: st.mtimeMs,
        size: st.isFile() ? st.size : 0,
        tags: meta.items[rel],
      });
    }
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    sendJSON(res, { tag: { id: tagId, ...meta.tags[tagId] }, items });
    return true;
  }

  // --- 重命名 ---
  if (pathname === '/api/rename' && req.method === 'POST') {
    const body = await readJson(); if (!body) return true;
    const name = validEntryName(body.name);
    if (!name) { sendError(res, '名称不合法', 400); return true; }
    try {
      const src = resolveSandboxed(String(body.path || ''), rootReal, true);
      const st = fs.statSync(src);
      const dst = path.join(path.dirname(src), name);
      if (dst === src) { sendJSON(res, { ok: true, path: src }); return true; }
      resolveSandboxed(dst, rootReal, true);
      await withFsLock(() => {
        if (fs.existsSync(dst)) { const err = new Error('同名文件或文件夹已存在'); err.statusCode = 409; throw err; }
        fs.renameSync(src, dst);
        const meta = space.readMeta(rootDir);
        space.remapTags(meta, space.relOf(rootDir, src), space.relOf(rootDir, dst));
        space.writeMeta(rootDir, meta);
      });
      sendJSON(res, { ok: true, path: dst, type: st.isDirectory() ? 'dir' : 'file' });
    } catch (e) { failJson(e); }
    return true;
  }

  // --- 移动 ---
  if (pathname === '/api/move' && req.method === 'POST') {
    const body = await readJson(); if (!body) return true;
    const paths = Array.isArray(body.paths) ? body.paths.slice(0, 200) : [];
    if (!paths.length) { sendError(res, '未选择文件', 400); return true; }
    try {
      const destDir = resolveSandboxed(String(body.destDir || ''), rootReal, true);
      if (!fs.statSync(destDir).isDirectory()) { sendError(res, '目标不是文件夹', 400); return true; }
      const rels = space.filterTopLevel(paths.map(p => space.relOf(rootDir, resolveSandboxed(String(p), rootReal, true))));
      const moves = [];
      const seen = new Set();
      for (const rel of rels) {
        const src = space.absOf(rootDir, rel);
        const st = fs.statSync(src);
        if (st.isDirectory() && (destDir === src || destDir.startsWith(src + path.sep))) {
          sendError(res, '不能把文件夹移动到它自己里面', 400);
          return true;
        }
        const target = path.join(destDir, path.basename(src));
        if (seen.has(target) || fs.existsSync(target)) {
          sendError(res, '目标位置已存在同名文件: ' + path.basename(src), 409);
          return true;
        }
        seen.add(target);
        moves.push({ src, target, fromRel: rel, toRel: space.relOf(rootDir, target) });
      }
      await withFsLock(() => {
        for (const m of moves) fs.renameSync(m.src, m.target);
        const meta = space.readMeta(rootDir);
        for (const m of moves) space.remapTags(meta, m.fromRel, m.toRel);
        space.writeMeta(rootDir, meta);
      });
      sendJSON(res, { ok: true, paths: moves.map(m => m.target) });
    } catch (e) { failJson(e); }
    return true;
  }

  // --- 复制 ---
  if (pathname === '/api/copy' && req.method === 'POST') {
    const body = await readJson(); if (!body) return true;
    const paths = Array.isArray(body.paths) ? body.paths.slice(0, 200) : [];
    if (!paths.length) { sendError(res, '未选择文件', 400); return true; }
    try {
      const destDir = resolveSandboxed(String(body.destDir || ''), rootReal, true);
      if (!fs.statSync(destDir).isDirectory()) { sendError(res, '目标不是文件夹', 400); return true; }
      const rels = space.filterTopLevel(paths.map(p => space.relOf(rootDir, resolveSandboxed(String(p), rootReal, true))));
      const copies = [];
      for (const rel of rels) {
        const src = space.absOf(rootDir, rel);
        const st = fs.statSync(src);
        if (st.isDirectory() && (destDir === src || destDir.startsWith(src + path.sep))) {
          sendError(res, '不能把文件夹复制到它自己里面', 400);
          return true;
        }
        const targetName = space.uniqueNameInDir(destDir, path.basename(src));
        const target = path.join(destDir, targetName);
        copies.push({ src, target, isDir: st.isDirectory(), fromRel: rel, toRel: space.relOf(rootDir, target) });
      }
      await withFsLock(() => {
        for (const c of copies) {
          if (c.isDir) fs.cpSync(c.src, c.target, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
          else fs.copyFileSync(c.src, c.target);
        }
        const meta = space.readMeta(rootDir);
        for (const c of copies) space.copyTags(meta, c.fromRel, c.toRel);
        space.writeMeta(rootDir, meta);
      });
      sendJSON(res, { ok: true, paths: copies.map(c => c.target) });
    } catch (e) { failJson(e); }
    return true;
  }

  // --- 删除（移到回收站） ---
  if (pathname === '/api/delete' && req.method === 'POST') {
    const body = await readJson(); if (!body) return true;
    const paths = Array.isArray(body.paths) ? body.paths.slice(0, 200) : [];
    if (!paths.length) { sendError(res, '未选择文件', 400); return true; }
    try {
      const rels = space.filterTopLevel(paths.map(p => space.relOf(rootDir, resolveSandboxed(String(p), rootReal, true))));
      const trashed = await withFsLock(() => {
        const meta = space.readMeta(rootDir);
        const entries = space.trashPaths(rootDir, meta, rels);
        space.writeMeta(rootDir, meta);
        return entries.map(e => ({ id: e.id, name: e.name, originalRel: e.originalRel }));
      });
      sendJSON(res, { ok: true, trashed });
    } catch (e) { failJson(e); }
    return true;
  }

  // --- 回收站 ---
  if (pathname === '/api/trash' && req.method === 'GET') {
    const items = space.listTrash(rootDir).map(e => ({
      id: e.id,
      name: e.name,
      originalRel: e.originalRel,
      type: e.type,
      deletedAt: e.deletedAt,
    }));
    sendJSON(res, { items, count: items.length });
    return true;
  }

  if (pathname === '/api/trash/restore' && req.method === 'POST') {
    const body = await readJson(); if (!body) return true;
    const ids = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
    if (!ids.length) { sendError(res, '未选择回收站项目', 400); return true; }
    try {
      const restored = await withFsLock(() => {
        const meta = space.readMeta(rootDir);
        const out = space.restoreTrash(rootDir, meta, ids.map(String));
        space.writeMeta(rootDir, meta);
        return out;
      });
      sendJSON(res, { ok: true, restored });
    } catch (e) { failJson(e); }
    return true;
  }

  if (pathname === '/api/trash/empty' && req.method === 'POST') {
    try {
      await withFsLock(() => space.emptyTrash(rootDir));
      sendJSON(res, { ok: true });
    } catch (e) { failJson(e); }
    return true;
  }

  return false;
}

// Extract a named entry from a ZIP buffer (no external deps, handles deflate + stored)
function _extractZipEntry(buf, entryName) {
  let i = 0;
  while (i < buf.length - 4) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const compression = buf.readUInt16LE(i + 8);
      const compSize = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
      const dataStart = i + 30 + nameLen + extraLen;
      if (name === entryName) {
        const compData = buf.slice(dataStart, dataStart + compSize);
        if (compression === 0) return compData;
        if (compression === 8) return zlib.inflateRawSync(compData);
        return null;
      }
      i = dataStart + compSize;
    } else {
      i++;
    }
  }
  return null;
}

// ---------------- 静态资源 / 登录页 / 应用页 ----------------

function serveStatic(req, res, pathname) {
  const relPath = pathname === '/' ? '/udd-app.html' : pathname;
  const absPath = path.resolve(APP_DIR, '.' + relPath);
  if (absPath !== APP_DIR && !absPath.startsWith(APP_DIR + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(absPath).toLowerCase();
    if (!STATIC_EXTS.has(ext)) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const isCode = ext === '.html' || ext === '.js' || ext === '.css';
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      // 代码文件不缓存，避免部署新版本后浏览器仍用旧脚本
      'Cache-Control': isCode ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(absPath).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end(e.message);
  }
}

function serveLoginPage(res) {
  const p = path.join(APP_DIR, 'login.html');
  if (!fs.existsSync(p)) { res.writeHead(500); res.end('login.html missing'); return; }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(p).pipe(res);
}

function serveFilesPage(res) {
  const p = path.join(APP_DIR, 'files.html');
  if (!fs.existsSync(p)) { res.writeHead(500); res.end('files.html missing'); return; }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(p).pipe(res);
}

function serveAppHtml(res, username) {
  const p = path.join(APP_DIR, 'udd-app.html');
  fs.readFile(p, 'utf8', (err, html) => {
    if (err) { res.writeHead(500); res.end(err.message); return; }
    const safeUser = JSON.stringify(String(username)).replace(/</g, '\\u003c');
    const inject = `<script>window.__UDD_ACCOUNT_USER__=${safeUser};</script>\n`
      + '<script src="/account-ui.js"></script>\n';
    const out = html.indexOf('</body>') >= 0
      ? html.replace('</body>', inject + '</body>')
      : html + inject;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(out);
  });
}

// ---------------- 多账号认证接口 ----------------

async function handleRegister(req, res) {
  if (!sameOrigin(req)) return sendError(res, '跨站请求被拒绝', 403);
  const ip = clientIp(req);
  if (tooMany(ip, 'register', 5)) return sendError(res, '注册尝试过于频繁，请稍后再试', 429);
  recordAttempt(ip, 'register');

  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendError(res, e.message, e.statusCode || 400); }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const invite = String(body.invite || '');

  if (!accounts.isValidUsername(username)) {
    return sendError(res, '用户名需 2–32 位，以中文/字母/数字开头，可含 _ -', 400);
  }
  if (password.length < 8 || password.length > 128) {
    return sendError(res, '密码长度需 8–128 位', 400);
  }

  const hashed = await accounts.hashPassword(password);

  let result;
  try {
    result = await accounts.withLock(async () => {
      const data = accounts.readAccounts();
      if (data.users[username]) return { status: 409, error: '用户名已被注册' };
      const inv = accounts.checkInvite(data, invite);
      if (!inv.ok) return { status: 403, error: inv.reason || '邀请码无效' };
      if (!inv.env) accounts.markInvite(data, inv.code, username);
      data.users[username] = {
        salt: hashed.salt,
        hash: hashed.hash,
        createdAt: new Date().toISOString(),
      };
      accounts.writeAccounts(data);
      return { ok: true };
    });
  } catch (e) {
    return sendError(res, '账号创建失败，请稍后重试', 500);
  }

  if (!result.ok) return sendError(res, result.error, result.status);

  workspaceFor(username);
  const token = createSession(username);
  setSessionCookie(req, res, token, SESSION_TTL_MS);
  clearAttempts(ip, 'register');
  console.log(`[账号] 注册: ${username}  (${ip})`);
  sendJSON(res, { ok: true, user: username });
}

async function handleLogin(req, res) {
  if (!sameOrigin(req)) return sendError(res, '跨站请求被拒绝', 403);
  const ip = clientIp(req);
  if (tooMany(ip, 'login', 10)) return sendError(res, '登录尝试过于频繁，请稍后再试', 429);
  recordAttempt(ip, 'login');

  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendError(res, e.message, e.statusCode || 400); }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return sendError(res, '请输入用户名和密码', 400);

  const data = accounts.readAccounts();
  const rec = data.users[username];
  const ok = await accounts.verifyPassword(password, rec);
  if (!rec || !ok) {
    return sendError(res, '用户名或密码错误', 401);
  }

  workspaceFor(username);
  const token = createSession(username);
  setSessionCookie(req, res, token, SESSION_TTL_MS);
  clearAttempts(ip, 'login');
  console.log(`[账号] 登录: ${username}  (${ip})`);
  sendJSON(res, { ok: true, user: username });
}

function handleLogout(req, res) {
  destroySession(req);
  clearSessionCookie(req, res);
  sendJSON(res, { ok: true });
}

function handleMe(req, res) {
  const s = getSession(req);
  if (!s) return sendJSON(res, { error: '未登录' }, 401);
  sendJSON(res, { user: s.user });
}

// ---------------- 请求分发 ----------------

async function handleMultiuser(req, res, pathname, params) {
  if (pathname === '/login' && req.method === 'GET') {
    if (getSession(req)) return redirect(res, '/');
    return serveLoginPage(res);
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') return handleLogin(req, res);
  if (pathname === '/api/auth/register' && req.method === 'POST') return handleRegister(req, res);
  if (pathname === '/api/auth/logout' && req.method === 'POST') return handleLogout(req, res);
  if (pathname === '/api/auth/me' && req.method === 'GET') return handleMe(req, res);

  const session = getSession(req);
  const isApp = pathname === '/' || pathname === '/udd-app.html' || pathname === '/index.html';
  const isFiles = pathname === '/files' || pathname === '/files.html';

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return sendJSON(res, { error: '未登录', login: true }, 401);
    }
    if (isApp || isFiles) {
      const next = encodeURIComponent(isFiles ? '/files' : (pathname === '/' ? '/' : pathname));
      return redirect(res, '/login?next=' + next);
    }
    return serveStatic(req, res, pathname);
  }

  if (isFiles) return serveFilesPage(res);
  if (isApp) return serveAppHtml(res, session.user);

  if (pathname.startsWith('/api/')) {
    const w = workspaceFor(session.user);
    const ctx = { rootDir: w.dir, rootReal: w.real, sandbox: true, personal: true };
    if (await handleFileApi(req, res, pathname, params, ctx)) return;
    return sendJSON(res, { error: 'Not found' }, 404);
  }

  return serveStatic(req, res, pathname);
}

async function handleLegacy(req, res, pathname, params) {
  if (!isAuthorizedLegacy(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="UDD", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('需要登录');
    return;
  }

  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (pathname.startsWith('/api/')) {
    const ctx = { rootDir: LEGACY_ROOT_DIR, rootReal: LEGACY_ROOT_REAL, sandbox: SANDBOX, personal: false };
    if (await handleFileApi(req, res, pathname, params, ctx)) return;
    return sendJSON(res, { error: 'Not found' }, 404);
  }

  if (pathname === '/files' || pathname === '/files.html') return serveFilesPage(res);

  return serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  let parsed;
  try { parsed = new URL(req.url, 'http://localhost'); }
  catch (e) { res.writeHead(400); res.end('Bad request'); return; }

  let pathname;
  try { pathname = decodeURIComponent(parsed.pathname); }
  catch (e) { res.writeHead(400); res.end('Bad request'); return; }

  res.setHeader('X-Content-Type-Options', 'nosniff');

  const handler = MULTIUSER ? handleMultiuser : handleLegacy;
  handler(req, res, pathname, parsed.searchParams).catch(err => {
    console.error('[请求处理失败]', err);
    if (!res.headersSent) sendError(res, '服务器内部错误', 500);
    else res.end();
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`  [错误] 端口 ${PORT} 已被占用`);
  } else {
    console.error('  [错误] 服务器启动失败: ' + err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  UDD Server running at:`);
  if (LOOPBACK) {
    console.log(`  http://localhost:${PORT}`);
  } else {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  http://${net.address}:${PORT}`);
        }
      }
    }
    console.log(`  http://localhost:${PORT} (本机)`);
  }
  console.log('');
  if (MULTIUSER) {
    console.log(`  Mode:           多账号`);
    console.log(`  Data directory: ${accounts.DATA_ROOT}`);
    console.log(`  Login:          http://localhost:${PORT}/login`);
  } else {
    console.log(`  Root directory: ${LEGACY_ROOT_DIR}`);
    console.log(`  Auth:           ${AUTH_HASH ? 'enabled (user: ' + AUTH_USER + ')' : 'disabled'}`);
    console.log(`  Sandbox:        ${SANDBOX ? 'on' : 'off'}`);
  }
  console.log(`  Listen:         ${HOST}:${PORT}`);
  console.log(`\n  Press Ctrl+C to stop.\n`);
});
