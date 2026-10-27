const http = require('http'); const net = require('net'); const crypto = require('crypto');
const fs = require('fs'); const path = require('path');
function getJson(port, p) { return new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port, path: p }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 200))); } }); }).on('error', reject); }); }
function connectWs(url) {
  return new Promise((resolve, reject) => {
    const m = /^ws:\/\/([^:/]+):(\d+)(\/.*)$/.exec(url);
    if (!m) return reject(new Error('bad ws url'));
    const [, host, port, requestPath] = m; const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(Number(port), host, () => { sock.write(`GET ${requestPath} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`); });
    let buf = Buffer.alloc(0); let handshaken = false; let onMessage = null;
    sock.on('error', reject);
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshaken) { const idx = buf.indexOf('\r\n\r\n'); if (idx < 0) return; const head = buf.slice(0, idx).toString(); if (!/101/.test(head)) return reject(new Error('handshake failed')); buf = buf.slice(idx + 4); handshaken = true; resolve(api); }
      while (true) {
        if (buf.length < 2) break;
        const opcode = buf[0] & 0x0f; let len = buf[1] & 0x7f; let off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = (buf[1] & 0x80) !== 0; const maskLen = masked ? 4 : 0;
        if (buf.length < off + maskLen + len) break;
        let payload = buf.slice(off + maskLen, off + maskLen + len);
        if (masked) { const mask = buf.slice(off, off + 4); payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4])); }
        buf = buf.slice(off + maskLen + len);
        if (opcode === 0x1) { try { onMessage && onMessage(JSON.parse(payload.toString())); } catch (e) {} } else if (opcode === 0x8) { sock.end(); return; }
      }
    });
    function sendFrame(text) {
      const data = Buffer.from(text); const mask = crypto.randomBytes(4); let header;
      if (data.length < 126) header = Buffer.from([0x81, 0x80 | data.length]);
      else if (data.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2); }
      else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
      const masked = Buffer.from(data.map((b, i) => b ^ mask[i % 4])); sock.write(Buffer.concat([header, mask, masked]));
    }
    let nextId = 1; const pending = new Map();
    const api = { send(method, params) { const id = nextId++; sendFrame(JSON.stringify({ id, method, params: params || {} })); return new Promise((res, rej) => { pending.set(id, { res, rej }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout: ' + method)); } }, 60000); }); }, close() { try { sock.destroy(); } catch (e) {} } };
    onMessage = msg => { if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); if (msg.error) rej(new Error(msg.error.message)); else res(msg.result); } };
  });
}
async function main() {
  const port = Number(process.argv[2] || 9333); const stepsFile = process.argv[3];
  const steps = JSON.parse(fs.readFileSync(path.resolve(stepsFile), 'utf8'));
  const targets = await getJson(port, '/json');
  const page = targets.find(t => t.type === 'page' && (t.url || '').includes('udd-app.html')) || targets.find(t => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = await connectWs(page.webSocketDebuggerUrl);
  const results = [];
  for (let si = 0; si < (steps.steps || []).length; si++) {
    const step = steps.steps[si];
    try {
      if (step.eval) {
        const r = await ws.send('Runtime.evaluate', { expression: `(async () => { ${step.eval} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
        results.push(r.exceptionDetails ? { step: step.label || ('eval' + si), error: JSON.stringify(r.exceptionDetails).slice(0, 500) } : { step: step.label || ('eval' + si), value: r.result.value });
      }
      if (step.wait) await new Promise(r => setTimeout(r, step.wait));
    } catch (e) { results.push({ step: step.label || ('step' + si), ERROR: e.message }); }
  }
  console.log(JSON.stringify(results, null, 1)); ws.close(); process.exit(0);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
