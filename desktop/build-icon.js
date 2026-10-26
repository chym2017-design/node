// ================================================================
//  生成 UDD 应用图标：build/icon.png (256x256) + build/icon.ico
//  纯 Node 实现（zlib + 手写 PNG/ICO 封装），无外部依赖。
//  图形：圆角蓝底 (#2563eb) + 白色几何 U 形（SDF 抗锯齿）。
//  用法: node build-icon.js
// ================================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const OUT_DIR = path.join(__dirname, 'build');

// ---------- 像素绘制（SDF + 1px 覆盖率抗锯齿） ----------
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const cov = d => clamp01(0.5 - d);

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
}
function sdBox(x, y, cx, cy, hw, hh) {
  const dx = Math.abs(x - cx) - hw, dy = Math.abs(y - cy) - hh;
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0);
}

function render() {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const BG = [0x25, 0x63, 0xeb];   // 品牌蓝
  const FG = [0xff, 0xff, 0xff];   // 白
  // U 形参数：两根竖杠 + 下半圆弧带
  const cx = 128, topY = 84, botY = 158;
  const barOff = 52, barHalf = 15;
  const ringR = barOff, ringHalf = 15;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = x + 0.5, py = y + 0.5;
      let r = 0, g = 0, b = 0, a = 0;
      // 底板
      const cbg = cov(sdRoundRect(px, py, 128, 128, 124, 124, 58));
      if (cbg > 0) { r = BG[0]; g = BG[1]; b = BG[2]; a = cbg; }
      // U 形
      const dLeft = sdBox(px, py, cx - barOff, (topY + botY) / 2, barHalf, (botY - topY) / 2);
      const dRight = sdBox(px, py, cx + barOff, (topY + botY) / 2, barHalf, (botY - topY) / 2);
      let dRing = Infinity;
      if (py >= botY) {
        dRing = Math.abs(Math.hypot(px - cx, py - botY) - ringR) - ringHalf;
      }
      const dU = Math.min(dLeft, dRight, dRing);
      const cu = cov(dU);
      if (cu > 0) {
        // 白色盖在蓝底上（alpha 合成）
        const aOut = cu + a * (1 - cu);
        if (aOut > 0) {
          r = (FG[0] * cu + r * a * (1 - cu)) / aOut;
          g = (FG[1] * cu + g * a * (1 - cu)) / aOut;
          b = (FG[2] * cu + b * a * (1 - cu)) / aOut;
          a = aOut;
        }
      }
      const i = (y * SIZE + x) * 4;
      buf[i] = Math.round(r); buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b); buf[i + 3] = Math.round(a * 255);
    }
  }
  return buf;
}

// ---------- PNG 封装 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  // 每行前置 filter byte 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- ICO 封装（256x256 直接内嵌 PNG，Vista+ 支持） ----------
function encodeICO(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: icon
  header.writeUInt16LE(1, 4);      // count
  const entry = Buffer.alloc(16);
  entry[0] = 0;                    // width 256
  entry[1] = 0;                    // height 256
  entry[2] = 0;                    // palette
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);       // planes
  entry.writeUInt16LE(32, 6);      // bpp
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12);     // data offset (6+16)
  return Buffer.concat([header, entry, pngBuf]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const rgba = render();
const png = encodePNG(rgba, SIZE);
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png);
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeICO(png));
console.log('OK: build/icon.png (' + png.length + ' B), build/icon.ico');
