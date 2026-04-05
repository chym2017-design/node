// UDD Local Server — provides file system access for the UDD app
// Usage: node server.js [port] [root_dir]
// Example: node server.js 8080 D:\projects\node

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = parseInt(process.argv[2]) || 8080;
const ROOT_DIR = process.argv[3] || process.cwd();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.udd': 'application/octet-stream',
  '.md': 'text/markdown; charset=utf-8',
};

function sendJSON(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, msg, status = 500) {
  sendJSON(res, { error: msg }, status);
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  // === API: List directory ===
  if (pathname === '/api/files') {
    const dir = parsed.query.dir || ROOT_DIR;
    try {
      const resolved = path.resolve(dir);
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const items = entries
        .filter(e => !e.name.startsWith('.'))
        .map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
          ext: e.isFile() ? path.extname(e.name).toLowerCase() : '',
          path: path.join(resolved, e.name),
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name, 'zh-CN');
        });
      sendJSON(res, { dir: resolved, parent: path.dirname(resolved), items });
    } catch (e) {
      sendError(res, e.message, 400);
    }
    return;
  }

  // === API: Read file (raw binary) ===
  if (pathname === '/api/readfile') {
    const filePath = parsed.query.path;
    if (!filePath) { sendError(res, 'Missing path', 400); return; }
    try {
      const resolved = path.resolve(filePath);
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) { sendError(res, 'Not a file', 400); return; }
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(resolved).pipe(res);
    } catch (e) {
      sendError(res, e.message, 404);
    }
    return;
  }

  // === API: Read .udd file and return decompressed JSON ===
  if (pathname === '/api/readudd') {
    const filePath = parsed.query.path;
    if (!filePath) { sendError(res, 'Missing path', 400); return; }
    try {
      const resolved = path.resolve(filePath);
      const data = fs.readFileSync(resolved);
      // UDD files are ZIP archives — we send raw bytes, client-side JSZip handles decompression
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    } catch (e) {
      sendError(res, e.message, 404);
    }
    return;
  }

  // === API: Get server root dir ===
  if (pathname === '/api/root') {
    sendJSON(res, { root: ROOT_DIR });
    return;
  }

  // === Static file serving ===
  let filePath = pathname === '/' ? '/udd-app.html' : pathname;
  const absPath = path.join(ROOT_DIR, filePath);
  try {
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(absPath).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end(e.message);
  }
});

server.listen(PORT, () => {
  console.log(`\n  UDD Server running at:`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Root directory: ${ROOT_DIR}`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
