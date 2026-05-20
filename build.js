/* eslint-disable no-console */
/**
 * UDD Standalone Build
 * --------------------
 * 流程：
 *   1. 读取 udd-app.html，按 <link>/<script> 顺序拉取 CSS / JS
 *   2. CSS 内联为 <style>
 *   3. vendor 库 (*.min.js) 直接透传，不再处理（已经压缩过）
 *   4. own 文件先过 terser 压缩
 *   5. 三个核心文件 (udd-data / udd-ref / udd-mindmap) 再过 javascript-obfuscator 重度混淆
 *   6. 全部内联回 HTML，输出 dist/udd-app.standalone.html (单文件)
 *
 * 跨文件引用安全：
 *   - terser 配置 mangle.toplevel = false → 顶层函数 / 变量名保留
 *   - obfuscator 配置 renameGlobals = false → 不改全局名
 *   - reservedNames 列表保护 inline HTML 处理器（onclick="app.xxx()"）依赖的全局
 *
 * 兼容性取舍：
 *   - 关闭 selfDefending / debugProtection（这两个开关有 5–10% 兼容性事故率）
 *   - 控制流平坦化阈值 0.7、死代码 0.3 (不是 1.0)，避免运行慢 5×
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { minify } = require('terser');
const JsObfuscator = require('javascript-obfuscator');

const ROOT = __dirname;
const HTML_FILE = path.join(ROOT, 'udd-app.html');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'udd-app.standalone.html');

// 重度混淆的核心文件
const CORE_FILES = new Set(['udd-data.js', 'udd-ref.js', 'udd-mindmap.js']);

// vendor 库识别（已经压缩过，直接透传）
const VENDOR_PATTERN = /\.min\.js$/i;

// 不能 mangle 的全局名（被 inline onclick / 跨文件引用）
const RESERVED_BASE = [
  'app', 'App',
  'OutlineView', 'DocumentView', 'MindmapView',
  'SheetView', 'PPTView', 'GraphView',
  'UDD',
  'JSZip', 'XLSX', 'PptxGenJS',
  'markdownit', 'markdownIt',
];

// 这些是 vendor 库已经在前面 <script> 里挂上 window 的名字，
// 即便源文件里出现 `const JSZip = ...` 之类，也不要在 IIFE 末尾再 expose 一次
// 否则会用本文件作用域内同名的（很可能是 undefined）覆盖掉 vendor 实例。
const VENDOR_GLOBALS = new Set(['JSZip', 'XLSX', 'PptxGenJS', 'markdownit', 'markdownIt']);

// 跑时填充：扫描所有 own 文件的顶层声明（function / class / const / let / var）
let RESERVED = [...RESERVED_BASE];

// 是否启用 obfuscator（默认关：先验证 terser-only 能跑通，再加混淆）
//   不加任何环境变量      → 只跑 terser，所有 own 文件都只压缩、不混淆
//   OBFUSCATE=1          → 对三个核心文件 (udd-data / udd-ref / udd-mindmap) 启用重度混淆
//   OBFUSCATE=udd-data    → 仅混淆 udd-data.js（bisect 用：定位是哪个文件的混淆导致问题）
//   OBFUSCATE=udd-ref     → 仅混淆 udd-ref.js
//   OBFUSCATE=udd-mindmap → 仅混淆 udd-mindmap.js
//   RAW=1                → 完全不处理，所有文件按原样合并 (诊断用)
const OBFUSCATE = process.env.OBFUSCATE || '';
const RAW = process.env.RAW === '1';

function shouldObfuscate(file) {
  if (!OBFUSCATE) return false;
  if (OBFUSCATE === '1') return CORE_FILES.has(file);
  return file.includes(OBFUSCATE);  // 允许 'udd-data' / 'udd-ref' / 'udd-mindmap'
}

/**
 * 从一段 JS 源码里提取所有"顶层声明"的标识符。
 * 严格只匹配列 0 起始的 function / async function / class / const / let / var 声明，
 * 不带前导空白——避免把函数体里 `  const num = ...` 这种局部变量误识别为顶层。
 * 如果项目里有 `\t` 缩进或 BOM，需要在调用前先 normalize。
 */
function extractTopLevelIdentifiers(code) {
  const ids = new Set();
  const patterns = [
    /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm,  // function / async function / function*
    /^class\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:=|,|;|\s)/gm,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code)) !== null) ids.add(m[1]);
  }
  return ids;
}

async function terserPass(code, file) {
  const result = await minify(code, {
    ecma: 2020,
    compress: {
      drop_console: false,
      drop_debugger: true,
      passes: 2,
      pure_funcs: [],
    },
    mangle: {
      toplevel: false,        // ← 关键：保留顶层名
      reserved: RESERVED,
    },
    format: { comments: false },
  });
  if (!result.code) throw new Error(`terser failed on ${file}`);
  return result.code;
}

function hashSeed(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

function obfuscatePass(code, file) {
  // 每个文件用基于文件名的不同 seed：避免多文件混淆时 stringArray 等 var _0xXXXX 全局名撞车
  // （撞名会导致后加载文件覆盖前一个的常量数组，前一个运行时拿到错的字符串 → 二进制路径输出乱字节
  //  → XLSX 看到非 ZIP 头报 "Unsupported ZIP file"。和 identifiersPrefix 等价但不进 obfuscator 慢路径。）
  const result = JsObfuscator.obfuscate(code, {
    compact: true,
    target: 'browser',
    renameGlobals: false,                    // ← 关键：不改全局名
    reservedNames: RESERVED,
    seed: hashSeed(file),                    // ← 关键：每个文件不同 seed，避免跨文件 var 撞名

    // 控制流平坦化（核心防护）—— 阈值不要给到 1.0，会显著拖慢运行
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,

    // 死代码注入：性能杀手 / 防护废物 比例最高的开关，关闭。
    //   - 成本：每个函数体被插入垃圾分支，热路径（递归 / 每次 render 触发的引用解析）
    //          会被显著拖慢，曾观察到跨文档引用从 2s 拖到 10s+ 甚至超过 fetch 的 3s 超时
    //          导致"有时找不到"。
    //   - 收益：AI 一眼识别死代码模板（if(!![]){...} 之类），保护价值很低。
    deadCodeInjection: false,
    deadCodeInjectionThreshold: 0.2,

    // 字符串加密（保留：这是混淆的主要价值）
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 0.7,
    splitStrings: false,                     // ← 关闭：曾观察到偶发问题，价值低
    splitStringsChunkLength: 8,

    // 标识符与数字变形
    identifierNamesGenerator: 'mangled-shuffled',
    transformObjectKeys: false,              // ← 关键：保留对象键名（核心模块可能向外暴露常量对象，例如 UDD_STYLE_FIELDS）
    numbersToExpressions: false,             // ← 关闭：这个变换在某些边界情况会破坏 typed-array / 二进制数据相关代码路径

    // 关闭兼容性敏感项（见文件头注释）
    selfDefending: false,
    debugProtection: false,
    disableConsoleOutput: false,
  });
  return result.getObfuscatedCode();
}

function escapeForScript(code) {
  return code.replace(/<\/script>/gi, '<\\/script>');
}

async function processOwnJs(file, content) {
  if (RAW) return content;
  const t = await terserPass(content, file);
  if (!shouldObfuscate(file)) return t;

  // —— IIFE 包裹 + 显式 expose ——
  // obfuscator 生成的 var _0xXXXX (stringArray、RC4 解码器、CFF dispatcher state 等)
  // 默认是 top-level var，会挂到 window。当多个文件都被混淆时，这些短名极易撞车
  //（mangled-shuffled 字母表就 a-zA-Z0-9，撞名概率随文件数指数增长），
  // 后加载文件的 var iV = ... 覆盖 window.iV，前一个文件运行时调到错的解码器
  // → 解码出错的方法名 → "regex[xxx] is not a function" 等怪异报错。
  //
  // 修法：把整个混淆产物包进 IIFE，所有 obfuscator 内部 var 留在闭包里、不进 window。
  // 然后把"本文件"用户定义的顶层符号显式挂回 window，让其他文件能继续以全局名引用。
  const ownIds = [...extractTopLevelIdentifiers(content)]
    .filter((id) => !VENDOR_GLOBALS.has(id));
  const obfuscated = obfuscatePass(t, file);
  const expose = ownIds.length > 0
    ? `\n;Object.assign(typeof window!=='undefined'?window:globalThis,{${ownIds.join(',')}});`
    : '';
  return `(function(){\n${obfuscated}${expose}\n})();`;
}

function readText(p) { return fs.readFileSync(p, 'utf8'); }

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

async function build() {
  const html = readText(HTML_FILE);

  // 1. 解析 <script src> 顺序
  const scriptRe = /<script\s+src="([^"]+)"\s*><\/script>/g;
  const scripts = [];
  let m;
  while ((m = scriptRe.exec(html)) !== null) scripts.push(m[1]);

  // 1.5 预扫描：从所有 own 文件提取顶层标识符，扩充 RESERVED
  //     这是修复 "debounce is not defined" 等跨文件引用断裂的关键
  console.log('=== SCAN ===');
  const allIds = new Set(RESERVED_BASE);
  for (const src of scripts) {
    const file = path.basename(src);
    if (VENDOR_PATTERN.test(file)) continue;
    const raw = readText(path.join(ROOT, src));
    const ids = extractTopLevelIdentifiers(raw);
    ids.forEach((id) => allIds.add(id));
    console.log(`  ${file.padEnd(22)} +${ids.size} ids`);
  }
  RESERVED = [...allIds];
  const mode = RAW ? 'RAW (no terser, no obfuscator)'
                   : OBFUSCATE === '1' ? 'TERSER + OBFUSCATE (all core)'
                   : OBFUSCATE ? `TERSER + OBFUSCATE only [${OBFUSCATE}]`
                   : 'TERSER only (set OBFUSCATE=1 to enable, OBFUSCATE=udd-data to isolate, RAW=1 to skip all)';
  console.log(`  Total reserved: ${RESERVED.length}   Mode: ${mode}`);

  // 2. 处理每个脚本（保留每个源文件一个 <script> 标签的原始边界，
  //    避免 'use strict' 串联污染 vendor 库 + 避免混淆器变量名跨模块冲突）
  console.log('=== JS ===');
  const scriptBlocks = [];
  for (const src of scripts) {
    const file = path.basename(src);
    const full = path.join(ROOT, src);
    const raw = readText(full);
    const before = raw.length;

    let out, tag;
    if (VENDOR_PATTERN.test(file)) {
      out = raw; tag = 'VENDOR  ';
    } else {
      out = await processOwnJs(file, raw);
      tag = RAW ? 'RAW     ' : shouldObfuscate(file) ? 'OBFUSC  ' : 'TERSER  ';
    }
    console.log(`  [${tag}] ${file.padEnd(22)} ${fmtSize(before).padStart(9)} → ${fmtSize(out.length).padStart(9)}`);
    scriptBlocks.push(`<script>/* ${file} */\n${escapeForScript(out)}\n</script>`);
  }
  const bundleJs = scriptBlocks.join('\n');

  // 3. 内联 CSS
  console.log('=== CSS ===');
  let outHtml = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, (_, href) => {
    const css = readText(path.join(ROOT, href));
    console.log(`  [INLINE] ${path.basename(href).padEnd(22)} ${fmtSize(css.length).padStart(9)}`);
    return `<style>\n${css}\n</style>`;
  });

  // 4. 移除原 <script src> 标签，把合并好的多 <script> 块插到 </body> 前
  //    注意：必须用函数回调形式的 replace，否则 bundleJs 里的 $`、$&、$' 等
  //    会被 String.prototype.replace 解释为特殊替换模式（例如 udd-data.js 的
  //    `new RegExp(`^t${level}-\\d+$`)` 末尾的 $` 会被替换成"匹配项前的整段 HTML"）
  outHtml = outHtml.replace(/[ \t]*<script\s+src="[^"]+"\s*><\/script>\s*\n?/g, '');
  outHtml = outHtml.replace('</body>', () => `${bundleJs}\n</body>`);

  // 5. 加水印（用于追踪溯源）
  const watermarkId = crypto.randomBytes(8).toString('hex');
  const watermark =
    `<!-- UDD Standalone | build ${new Date().toISOString()} | id ${watermarkId} -->\n`;
  outHtml = watermark + outHtml;

  // 6. 写出
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, outHtml);

  // 6.5 输出 manifest.txt：把"输出 HTML 的某行" 映射回 "源文件"
  //     当浏览器报 "udd-app.standalone.html:730 ..." 时，可以查表知道是哪个 js 文件
  const lines = outHtml.split('\n');
  const manifest = [];
  let openFile = null, openLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^<script>\/\* (.+?) \*\//);
    if (m) {
      if (openFile) manifest.push({ file: openFile, start: openLine, end: i });
      openFile = m[1]; openLine = i + 1;
    } else if (openFile && /^<\/script>/.test(line)) {
      manifest.push({ file: openFile, start: openLine, end: i + 1 });
      openFile = null;
    }
  }
  const manifestPath = path.join(OUT_DIR, 'manifest.txt');
  fs.writeFileSync(manifestPath,
    'line-range  file\n' +
    '----------  ----\n' +
    manifest.map(e => `${String(e.start).padStart(5)}-${String(e.end).padEnd(5)}  ${e.file}`).join('\n') + '\n'
  );

  const finalSize = fs.statSync(OUT_FILE).size;
  console.log('=== OUT ===');
  console.log(`  ${OUT_FILE}`);
  console.log(`  Size: ${fmtSize(finalSize)}    Watermark: ${watermarkId}`);
  console.log(`  Manifest: ${manifestPath}`);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
