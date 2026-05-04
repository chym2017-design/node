// UDD Local Server — provides file system access for the UDD app
// Usage: node server.js [port] [root_dir]
// Example: node server.js 8080 D:\projects\node

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

const PORT = parseInt(process.argv[2]) || 8080;
const ROOT_DIR = process.argv[3] || __dirname;

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

  // === API: Read file (raw binary), optionally extract entry from .udd zip ===
  if (pathname === '/api/readfile') {
    const filePath = parsed.query.path;
    const entryPath = parsed.query.entry; // e.g. "media/media_0.png" inside a .udd
    if (!filePath) { sendError(res, 'Missing path', 400); return; }
    try {
      const resolved = path.resolve(filePath);
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) { sendError(res, 'Not a file', 400); return; }

      // If entry requested, extract from .udd zip (ZIP local file record)
      if (entryPath) {
        const zipBuf = fs.readFileSync(resolved);
        const entry = _extractZipEntry(zipBuf, entryPath);
        if (!entry) { sendError(res, 'Entry not found: ' + entryPath, 404); return; }
        const ext = path.extname(entryPath).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        const total = entry.length;

        // Support Range requests (required for video/audio seeking)
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
            'Access-Control-Allow-Origin': '*',
          });
          res.end(entry.slice(start, end + 1));
        } else {
          res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': total,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(entry);
        }
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      const total = stat.size;

      // Range 请求支持：浏览器 <audio>/<video> 进度条 seek 必需。
      // 没这条响应时，浏览器看到没 Accept-Ranges 头就拒绝发送 Range 请求，
      // 表现为"点进度条没反应/不跳"。
      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
        if (isNaN(start) || start < 0) start = 0;
        if (isNaN(end) || end >= total) end = total - 1;
        if (start > end) {
          res.writeHead(416, {
            'Content-Range': `bytes */${total}`,
            'Access-Control-Allow-Origin': '*',
          });
          res.end();
          return;
        }
        res.writeHead(206, {
          'Content-Type': mime,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Access-Control-Allow-Origin': '*',
        });
        // 流式分片返回，避免大视频读进内存
        fs.createReadStream(resolved, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': total,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        });
        fs.createReadStream(resolved).pipe(res);
      }
    } catch (e) {
      sendError(res, e.message, 404);
    }
    return;
  }

  // Extract a named entry from a ZIP buffer (no external deps, handles deflate + stored)
  function _extractZipEntry(buf, entryName) {
    // Scan local file headers (PK\x03\x04)
    let i = 0;
    while (i < buf.length - 4) {
      if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x03 && buf[i+3] === 0x04) {
        const compression = buf.readUInt16LE(i + 8);
        const compSize    = buf.readUInt32LE(i + 18);
        const uncompSize  = buf.readUInt32LE(i + 22);
        const nameLen     = buf.readUInt16LE(i + 26);
        const extraLen    = buf.readUInt16LE(i + 28);
        const name        = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
        const dataStart   = i + 30 + nameLen + extraLen;
        if (name === entryName) {
          const compData = buf.slice(dataStart, dataStart + compSize);
          if (compression === 0) return compData; // stored
          if (compression === 8) return zlib.inflateRawSync(compData); // deflate
          return null; // unsupported compression
        }
        i = dataStart + compSize;
      } else {
        i++;
      }
    }
    return null;
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

  // === API: Write file (binary body) ===
  if (pathname === '/api/writefile' && req.method === 'POST') {
    const filePath = parsed.query.path;
    if (!filePath) { sendError(res, 'Missing path', 400); return; }
    try {
      const resolved = path.resolve(filePath);
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          // Write to temp file first, then rename — avoids EBUSY on Windows
          const tmpPath = resolved + '.' + Date.now() + '.tmp';
          fs.writeFileSync(tmpPath, buffer);
          try {
            fs.renameSync(tmpPath, resolved);
          } catch (renameErr) {
            // Fallback: copy + delete (cross-device or rename failed)
            fs.copyFileSync(tmpPath, resolved);
            fs.unlinkSync(tmpPath);
          }
          sendJSON(res, { ok: true, path: resolved, size: buffer.length });
        } catch (writeErr) {
          sendError(res, writeErr.message, 500);
        }
      });
    } catch (e) {
      sendError(res, e.message, 500);
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
