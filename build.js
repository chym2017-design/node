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

// 跑时填充：扫描所有 own 文件的顶层声明（function / class / const / let / var）
let RESERVED = [...RESERVED_BASE];

// 是否启用 obfuscator（默认关：先验证 terser-only 能跑通，再加混淆）
//   不加任何环境变量 → 只跑 terser，所有 own 文件都只压缩、不混淆
//   设 OBFUSCATE=1 → 对三个核心文件 (udd-data / udd-ref / udd-mindmap) 启用重度混淆
//   设 RAW=1       → 完全不处理，所有文件按原样合并 (诊断用)
const OBFUSCATE = process.env.OBFUSCATE === '1';
const RAW = process.env.RAW === '1';

/**
 * 从一段 JS 源码里提取所有"顶层声明"的标识符。
 * 仅匹配每行起始（无缩进）位置的 function / class / const / let / var 声明，
 * 不会进入函数体内部局部变量。
 */
function extractTopLevelIdentifiers(code) {
  const ids = new Set();
  const patterns = [
    /^\s*function\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*class\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:=|,|;|\s)/gm,
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

function obfuscatePass(code) {
  const result = JsObfuscator.obfuscate(code, {
    compact: true,
    target: 'browser',
    renameGlobals: false,                    // ← 关键：不改全局名
    reservedNames: RESERVED,

    // 控制流平坦化（核心防护）
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.7,

    // 死代码注入（中度，避免体积过大）
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.3,

    // 字符串加密
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 0.8,
    splitStrings: true,
    splitStringsChunkLength: 8,

    // 标识符与数字变形
    identifierNamesGenerator: 'mangled-shuffled',
    transformObjectKeys: false,              // ← 关键：保留对象键名（核心模块可能向外暴露常量对象，例如 UDD_STYLE_FIELDS）
    numbersToExpressions: true,

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
  if (OBFUSCATE && CORE_FILES.has(file)) return obfuscatePass(t);
  return t;
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
                   : OBFUSCATE ? 'TERSER + OBFUSCATE'
                               : 'TERSER only (set OBFUSCATE=1 to enable obfuscator, RAW=1 to disable all)';
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
      tag = RAW ? 'RAW     ' : (OBFUSCATE && CORE_FILES.has(file)) ? 'OBFUSC  ' : 'TERSER  ';
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
