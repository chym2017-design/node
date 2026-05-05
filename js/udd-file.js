// ================================================================
//  UDD File & Storage
//  Default data, IndexedDB persistence, undo manager,
//  toast notifications, UDD file format (zip/unzip)
// ================================================================

// ================================================================
//  DEFAULT DATA
// ================================================================
function createDefaultData() {
  // 示例媒体路径（当前目录下的 example 文件夹）
  const IMG_PATH = "d:\\\\projects\\\\node\\\\node\\\\example\\\\庄周梦蝶.png";
  const VID_PATH = "d:\\\\projects\\\\node\\\\node\\\\example\\\\逍遥游样例.mp4";

  return {
    meta: {
      title: "未命名文档", author: "", created: new Date().toISOString(),
      modified: new Date().toISOString(), version: "1.0"
    },
    type_global: {
      "t*-*.font_size": 12,
      "t0-*.font": "微软雅黑", "t0-*.font_size": 16,
      "t0-*.bold": 1,
      "t1-*.font": "微软雅黑", "t1-*.font_size": 14,
      "t1-*.bold": 1, "t1-*.paragraph_before": 1, "t1-*.paragraph_after": 0.5,
      "t2-*.font": "微软雅黑", "t2-*.font_size": 12,
      "t2-*.bold": 1, "t2-*.paragraph_before": 0.5, "t2-*.paragraph_after": 0.3,
      "t3-*.font": "微软雅黑", "t3-*.font_size": 12,
      "t3-*.paragraph_line": 1.3,
      "body.font": "微软雅黑", "body.font_size": 12, "body.color": "51,65,85",
      "body.paragraph_line": 1.8, "body.paragraph_first_indent": 2,
      hide_t: "t>3", numbering_style: "1.1.1"
    },
    // 表格 → 大纲引用（表格 A 列单元格取自大纲节点）
    "_sheetRefs": {
      "Sheet1!A2": "=t1-5.t2-1.content",
      "Sheet1!A3": "=t1-5.t2-2.content",
      "Sheet1!A4": "=t1-5.t2-3.content",
      "Sheet1!A5": "=t1-5.t2-4.content",
      "Sheet1!A6": "=t1-5.t2-5.content"
    },

    // ── 根节点 ──
    "t0-1": {
      content: "UDD 统一数据文档 · 功能总览", hide: 0, hide_body: 0,
      body: "UDD 的核心理念：一份数据，多种视图。大纲、思维导图、文档、表格、演示共享同一棵数据树，通过引用实现数据联动。本文档演示了引用系统、跨文档联动、表格互引、多媒体嵌入、编号控制等核心能力。",

      // ── 1. 引用基础 ──
      "t1-1": {
        content: "引用基础", hide: 0, hide_body: 0,
        body: "UDD 中所有引用使用 {{=引用}} 语法。引用可放在内容任意位置，前后可自由添加文字；点击右侧 ↗ 可跳转到引用源。",
        "t2-1": { content: "原始数据节点", hide: 0, hide_body: 0, body: "这是一段会被其他节点引用的正文。修改这里，所有引用处同步更新。" },
        "t2-2": { content: "=t1-1.t2-1", hide: 0, hide_body: 0 },
        "t2-3": { content: "内容引用：{{=t1-1.t2-1.content}}", hide: 0, hide_body: 0 },
        "t2-4": { content: "正文引用：{{=t1-1.t2-1.body}}", hide: 0, hide_body: 0 }
      },

      // ── 2. 引用进阶 ──
      "t1-2": {
        content: "引用进阶", hide: 0, hide_body: 0,
        body: "引用支持截取和正则提取，可从源数据中精确提取所需片段。",
        "t2-1": { content: "截取前 6 字：{{=t1-1.t2-1.content(0,6)}}", hide: 0, hide_body: 0 },
        "t2-2": { content: "正则提取：{{=t1-1.t2-1.body.match(/修改(.+?)，/).[1]}}", hide: 0, hide_body: 0 }
      },

      // ── 3. 混合内容演示 ──
      "t1-3": {
        content: "混合内容演示", hide: 0, hide_body: 0,
        body: "在同一行中混合手敲文字与多个引用，实现灵活的数据拼接。",
        "t2-1": { content: "产品「{{=t1-5.t2-1.content}}」库存 {{=Sheet1.B2}} 件，单价 {{=Sheet1.C2}} 元，金额 {{=Sheet1.D2}} 元", hide: 0, hide_body: 0 },
        "t2-2": { content: "源节点：{{=t1-1.t2-1.content}}，正文片段：{{=t1-1.t2-1.body(0,10)}}", hide: 0, hide_body: 0 }
      },

      // ── 4. 跨文档引用 ──
      "t1-4": {
        content: "跨文档引用", hide: 0, hide_body: 0,
        body: "引用其他 .udd 文件数据。新语法：{{=路径/文件名.udd.t1-1.content}}（行内）或 =路径/文件名.udd.t1-1（整节点）。文档名必须以 .udd 结尾以与表格名区分。可用相对路径或绝对路径；裸文件名在仓库目录中查找。点击 ↗ 自动打开目标文档并定位。",
        "t2-1": { content: "跨文档数据：{{=测试文档1.udd.t1-1.content}}", hide: 0, hide_body: 0 },
        "t2-2": { content: "跨文档表格：{{\"table\":\"测试文档1.udd.Sheet1.A1:C3\",\"width\":\"100%\",\"border\":1}}", hide: 0, hide_body: 0 }
      },

      // ── 5. 表格↔大纲互引 ──
      "t1-5": {
        content: "表格与大纲互引", hide: 0, hide_body: 0,
        body: "大纲用 {{=Sheet1.B2}} 引用表格单元格，表格用 _sheetRefs 引用大纲节点。切换到「表格」视图，A 列会显示大纲的产品名；修改产品名或数量，另一侧立刻同步。",
        "t2-1": { content: "苹果", hide: 0, hide_body: 0,
          "t3-1": { content: "数量：{{=Sheet1.B2}}，单价：{{=Sheet1.C2}}，金额：{{=Sheet1.D2}}", hide: 0, hide_body: 0 }
        },
        "t2-2": { content: "香蕉", hide: 0, hide_body: 0,
          "t3-1": { content: "数量：{{=Sheet1.B3}}，单价：{{=Sheet1.C3}}，金额：{{=Sheet1.D3}}", hide: 0, hide_body: 0 }
        },
        "t2-3": { content: "橙子", hide: 0, hide_body: 0,
          "t3-1": { content: "数量：{{=Sheet1.B4}}，单价：{{=Sheet1.C4}}，金额：{{=Sheet1.D4}}", hide: 0, hide_body: 0 }
        },
        "t2-4": { content: "葡萄", hide: 0, hide_body: 0,
          "t3-1": { content: "数量：{{=Sheet1.B5}}，单价：{{=Sheet1.C5}}，金额：{{=Sheet1.D5}}", hide: 0, hide_body: 0 }
        },
        "t2-5": { content: "西瓜", hide: 0, hide_body: 0,
          "t3-1": { content: "数量：{{=Sheet1.B6}}，单价：{{=Sheet1.C6}}，金额：{{=Sheet1.D6}}", hide: 0, hide_body: 0 }
        }
      },

      // ── 6. 多媒体嵌入 ──
      "t1-6": {
        content: "多媒体嵌入", hide: 0, hide_body: 0,
        body: "正文中可嵌入 image / video / audio 标签，通用属性：宽度、比例、对齐、旋转、说明、边框、透明度。鼠标移到媒体右下角拖动 ▦ 调宽度，右上角点 ✎ 编辑全部属性。",
        "t2-1": {
          content: "图片：庄周梦蝶", hide: 0, hide_body: 0,
          body: "下方图片来自 example 文件夹。{{\"image\":\"" + IMG_PATH + "\",\"width\":\"60%\",\"align\":\"center\",\"caption\":\"庄周梦蝶 · 逍遥之境\",\"border\":1}}"
        },
        "t2-2": {
          content: "视频：逍遥游样例", hide: 0, hide_body: 0,
          body: "下方视频可直接在文档中播放。{{\"video\":\"" + VID_PATH + "\",\"width\":\"70%\",\"align\":\"center\",\"caption\":\"逍遥游 · 视频样例\"}}"
        },
        "t2-3": {
          content: "媒体引用联动", hide: 0, hide_body: 0,
          body: "媒体节点可被其他节点引用——本段正文引用上面的图片节点正文，图片也会跟着出现：{{=t1-6.t2-1.body}}"
        }
      },

      // ── 7. 内嵌表格 ──
      "t1-7": {
        content: "内嵌表格", hide: 0, hide_body: 0,
        body: "通过工具栏 ☐ 按钮可将表格区域嵌入正文，与其它多媒体共用一套属性（宽度/对齐/说明/边框等）。下方即为工作表 Sheet1 的完整产品清单：{{\"table\":\"Sheet1.A1:D6\",\"width\":\"100%\",\"border\":1}}",
        "t2-1": {
          content: "局部区域引用", hide: 0, hide_body: 0,
          body: "也可以只嵌入部分区域，例如仅表头与前两行：{{\"table\":\"Sheet1.A1:D3\",\"width\":\"100%\",\"border\":1}}"
        }
      },

      // ── 8. 编号控制（Word 式）──
      "t1-8": {
        content: "编号控制", hide: 0, hide_body: 0,
        body: "通过节点属性 no_number（此节点不显示编号且不占位，后续兄弟跳过该号）与 restart_number（从本节点起在同级重新从 1 开始计数）实现 Word 式编号控制。工具栏的 ⊘ 与 ↺1 按钮可一键切换。",
        "t2-1": { content: "正常节点 A", hide: 0, hide_body: 0 },
        "t2-2": { content: "不显示编号（Word 跳过）", hide: 0, hide_body: 0, no_number: 1, body: "该节点没有编号，且后续兄弟节点不会因它而占位——下一个节点仍是 2。" },
        "t2-3": { content: "正常节点 B", hide: 0, hide_body: 0 },
        "t2-4": { content: "从此处重新编号", hide: 0, hide_body: 0, restart_number: 1, body: "该节点是同级的 1；此后的兄弟在此基础上递增。" },
        "t2-5": { content: "重新编号后的 2", hide: 0, hide_body: 0 }
      },

      // ── 9. 设计理念 ──
      "t1-9": {
        content: "UDD 设计特点", hide: 0, hide_body: 0,
        "t2-1": { content: "一份数据，五种视图", hide: 0, hide_body: 0, body: "大纲、思维导图、文档、表格、演示共享同一棵 JSON 数据树，无需重复录入。" },
        "t2-2": { content: "引用即联动", hide: 0, hide_body: 0, body: "修改源节点，所有引用处自动同步。支持节点级、字段级、切片、正则、跨文档、跨表格引用。" },
        "t2-3": { content: "离线优先", hide: 0, hide_body: 0, body: "所有资源本地加载，IndexedDB 自动保存，.udd 文件基于 ZIP 格式自包含。" },
        "t2-4": { content: "结构化存储", hide: 0, hide_body: 0, body: "数据以树形 JSON 存储，支持样式继承、层级折叠、编号控制、多媒体嵌入。" }
      }
    }
  };
}

// ================================================================
//  INDEXEDDB STORAGE
// ================================================================
const DB_NAME = 'udd-db', DB_VER = 2, STORE = 'docs', MEDIA_STORE = 'media';
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE, { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbSave(id, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id, data: deepClone(data), ts: Date.now() });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
async function dbLoad(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function dbSaveMedia(name, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    tx.objectStore(MEDIA_STORE).put({ name, blob });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
async function dbLoadAllMedia() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readonly');
    const req = tx.objectStore(MEDIA_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error);
  });
}

async function dbSaveNamedDoc(name, data) {
  if (!name || name === 'current') return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id: name, data: deepClone(data), ts: Date.now() });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
async function dbListDocs() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve((req.result || []).filter(k => k !== 'current'));
    req.onerror = () => reject(req.error);
  });
}

// ================================================================
//  UNDO MANAGER
// ================================================================
class UndoManager {
  constructor(limit = 80) { this.stack = []; this.pos = -1; this.limit = limit; }
  push(data) {
    this.stack = this.stack.slice(0, this.pos + 1);
    this.stack.push(deepClone(data));
    if (this.stack.length > this.limit) this.stack.shift();
    this.pos = this.stack.length - 1;
  }
  undo() { return this.pos > 0 ? deepClone(this.stack[--this.pos]) : null; }
  redo() { return this.pos < this.stack.length - 1 ? deepClone(this.stack[++this.pos]) : null; }
}

// ================================================================
//  TOAST
// ================================================================
function toast(msg, ms = 2000) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

// ================================================================
//  FILE MANAGER
// ================================================================
async function createUDDBlob(data, opts = {}) {
  const zip = new JSZip();

  // Always clone to avoid mutating live data
  const saveData = JSON.parse(JSON.stringify(data));

  // Embed media files: rewrite paths to udd.media/xxx in saveData
  if (opts.embedMedia && typeof app !== 'undefined' && app.repoServerUrl) {
    await _embedMediaFiles(saveData, zip, app.repoServerUrl);
  }

  // Embed cross-doc references: rewrite =docName.path to =udd.ref-docs.docName.path
  if (opts.embedRefs) {
    _embedRefsInline(saveData);
  }

  const bottom = compressData(saveData);
  zip.file('data.json', JSON.stringify(bottom, null, 2));
  const meta = saveData.meta || {};
  zip.file('meta.json', JSON.stringify({
    format_version: '1.0', app_version: '1.0.0',
    title: meta.title || '', author: meta.author || '',
    created: meta.created || '', modified: new Date().toISOString()
  }, null, 2));
  zip.file('view_state.json', JSON.stringify({ last_view: 'outline' }, null, 2));
  if (typeof app !== 'undefined' && app.sheetView) {
    const xlsxBin = app.sheetView.toBinary();
    if (xlsxBin) zip.file('sheets.xlsx', xlsxBin);
  }
  if (typeof app !== 'undefined' && app.pptView) {
    const fmt = app.pptView.getFormat();
    if (fmt) zip.file('ppt-format.json', JSON.stringify(fmt, null, 2));
  }
  // Write ref-docs.json when embedding refs
  if (opts.embedRefs && typeof _refDocCache !== 'undefined') {
    const refs = {};
    for (const [name, docData] of Object.entries(_refDocCache)) {
      refs[name] = docData;
    }
    if (Object.keys(refs).length > 0) {
      zip.file('ref-docs.json', JSON.stringify(refs));
    }
  }
  return await zip.generateAsync({ type: 'blob' });
}

// Rewrite cross-doc inline refs to udd.ref-docs. prefix in saveData clone
function _embedRefsInline(data) {
  const refRe = /\{\{(=[^}]+)\}\}/g;
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (k === '_sheetRefs') continue; // skip sheet refs
      if (typeof obj[k] === 'string') {
        // Rewrite full-field refs (=docName.path)
        if (isRef(obj[k])) {
          obj[k] = _rewriteRefToUdd(obj[k]);
        }
        // Rewrite inline {{=docName.path}} refs
        if (obj[k].includes('{{=')) {
          obj[k] = obj[k].replace(refRe, (full, refStr) => {
            const rewritten = _rewriteRefToUdd(refStr);
            return '{{' + rewritten + '}}';
          });
        }
      } else if (typeof obj[k] === 'object') {
        walk(obj[k]);
      }
    }
  }
  walk(data);
}

// Rewrite =docName.t1-1.field to =udd.ref-docs.docName.t1-1.field (only cross-doc)
function _rewriteRefToUdd(refStr) {
  if (!refStr.startsWith('=')) return refStr;
  const ref = parseRef(refStr);
  if (!ref.docName) return refStr; // local ref, no change
  if (ref.docName.startsWith('udd.ref-docs.')) return refStr; // already rewritten
  // Rebuild with udd.ref-docs. prefix
  let rebuilt = '=udd.ref-docs.' + ref.docName;
  if (ref.nodePath) rebuilt += '.' + ref.nodePath;
  if (ref.field) rebuilt += '.' + ref.field;
  if (ref.slice) rebuilt += '(' + ref.slice[0] + ',' + ref.slice[1] + ')';
  if (ref.matchExpr) rebuilt += '.match(/' + ref.matchExpr.pattern.source + '/' + ref.matchExpr.pattern.flags + ').[' + ref.matchExpr.index + ']';
  return rebuilt;
}

// Scan all nodes for media paths, fetch them, embed in zip, rewrite paths to udd.media/xxx
async function _embedMediaFiles(data, zip, serverUrl) {
  const mediaFolder = zip.folder('media');
  const pathMap = {}; // original path → 'udd.media/media_N.ext'
  const mediaRe = /\{\{(?!=)(.*?)\}\}/g;
  const pathRe = /("(?:image|video|audio)")\s*:\s*"([^"]+)"/;

  function collectPaths(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        let m;
        mediaRe.lastIndex = 0;
        while ((m = mediaRe.exec(v)) !== null) {
          const pm = m[1].match(pathRe);
          if (!pm) continue;
          const src = pm[2];
          // Collect local absolute paths or existing udd.media/ paths (for re-embed)
          if (/^[A-Za-z]:[\\/]/.test(src) && !pathMap[src]) {
            pathMap[src] = null;
          }
        }
      } else if (typeof v === 'object') {
        collectPaths(v);
      }
    }
  }
  collectPaths(data);

  // Download/fetch each unique path
  let idx = 0;
  for (const origPath of Object.keys(pathMap)) {
    try {
      let fetchBlob = null;
      if (/^[A-Za-z]:[\\/]/.test(origPath)) {
        const resp = await fetch(serverUrl + '/api/readfile?path=' + encodeURIComponent(origPath));
        if (!resp.ok) continue;
        fetchBlob = await resp.blob();
      }
      if (!fetchBlob) continue;
      const ext = origPath.split('.').pop().toLowerCase();
      const fname = 'media_' + (idx++) + '.' + ext;
      mediaFolder.file(fname, fetchBlob);
      pathMap[origPath] = 'udd.media/' + fname;
    } catch (e) { /* skip */ }
  }

  // Rewrite paths in saveData clone
  function rewritePaths(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'string') {
        for (const [orig, embedded] of Object.entries(pathMap)) {
          if (embedded && obj[k].includes(orig)) {
            obj[k] = obj[k].split(orig).join(embedded);
          }
        }
      } else if (typeof obj[k] === 'object') {
        rewritePaths(obj[k]);
      }
    }
  }
  rewritePaths(data);
}

// Returns { data, embeddedMedia, embeddedRefDocs, xlsxBin, pptFormat } — caller stores per-session.
// 不再直接 side-effect 修改 app.sheetView.workbook —— 工作簿应当跟会话挂钩，
// 由调用方在创建/切换 session 时把 xlsxBin 写到 session.xlsxBin 并按需 loadFromBinary。
async function parseUDDBlob(blob) {
  const zip = await JSZip.loadAsync(blob);
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('无效的 .udd 文件：缺少 data.json');
  const json = await dataFile.async('string');
  const bottom = JSON.parse(json);
  const data = decompressData(bottom);

  // Load embedded sheets.xlsx if present —— 仅返回二进制，由调用方决定是否注入到当前 sheetView
  let xlsxBin = null;
  const sheetsFile = zip.file('sheets.xlsx');
  if (sheetsFile) {
    xlsxBin = await sheetsFile.async('uint8array');
  }
  // Load embedded ppt-format.json if present —— 仅返回，由调用方按需 setFormat
  let pptFormat = null;
  const pptFile = zip.file('ppt-format.json');
  if (pptFile) {
    try {
      const pptJson = await pptFile.async('string');
      pptFormat = JSON.parse(pptJson);
    } catch (e) {}
  }

  // Load embedded media files — returned per-session, NOT written to app global
  const embeddedMedia = {};
  const mediaFiles = [];
  zip.forEach((zipPath, entry) => {
    if (zipPath.startsWith('media/') && !entry.dir) mediaFiles.push({ zipPath, entry });
  });
  for (const { zipPath, entry } of mediaFiles) {
    const fileBlob = await entry.async('blob');
    embeddedMedia['udd.' + zipPath] = fileBlob;
  }

  // Load embedded ref-docs — returned per-session
  const embeddedRefDocs = {};
  const refDocsFile = zip.file('ref-docs.json');
  if (refDocsFile) {
    try {
      const refDocs = JSON.parse(await refDocsFile.async('string'));
      Object.assign(embeddedRefDocs, refDocs);
    } catch (e) {}
  }

  return { data, embeddedMedia, embeddedRefDocs, xlsxBin, pptFormat };
}
