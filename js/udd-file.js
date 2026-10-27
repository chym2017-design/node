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
      "body.paragraph_line": 1.8,
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
      body: "UDD 的两大核心思想：\n① 一份数据，多种视图——大纲、思维导图、文档、表格、演示共享同一棵数据树，通过引用实现联动。\n② 天地与我并生，万物与我为一 · 数据的物化——取庄子《齐物论》之境，万物本无界，故一段文字、一张表、一帧图、一段视频，皆是同一份数据在不同形相上的「物化」。改其一处，万象同迁；正如庄周梦蝶，蝶我无别，唯「道通为一」。\n本文档演示了引用系统、跨文档联动、表格互引、多媒体嵌入、Markdown / HTML 渲染、编号控制等核心能力。",

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

      // ── 9. Markdown / HTML 渲染 ──
      "t1-9": {
        content: "Markdown / HTML 渲染", hide: 0, hide_body: 0,
        body: "正文与标题支持 Markdown 与内联 HTML 渲染——在工具栏「更多渲染」面板勾选 **Markdown** 与 **HTML** 即可开关。单击保留渲染态、双击回到源码编辑，所见与所改两不相误。",
        "t2-1": {
          content: "Markdown 语法示例", hide: 0, hide_body: 0,
          body: "支持常见语法：**加粗**、*斜体*、`行内代码`、[链接](https://example.com)，以及列表、引用块、标题等。\n\n- 项目一\n- 项目二\n- 项目三\n\n> 子非鱼，安知鱼之乐？——《庄子·秋水》"
        },
        "t2-2": {
          content: "HTML 内联示例", hide: 0, hide_body: 0,
          body: "可直接书写 HTML 标签：<span style=\"color:#c2410c;font-weight:600\">朱砂色强调</span>、<u>下划线</u>、<kbd>Ctrl</kbd>+<kbd>S</kbd>。Markdown 与 HTML 同时开启时可混排。"
        },
        "t2-3": {
          content: "渲染与引用联动", hide: 0, hide_body: 0,
          body: "Markdown / HTML 渲染发生在引用解析之后，因此 {{=t1-1.t2-1.content}} 这类引用同样会按当前开关渲染——数据物化为何种形相，由视图决定。"
        }
      },

      // ── 10. 设计理念 ──
      "t1-10": {
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
//  BLANK DATA
//  "新建空白文档"：只保留必要的 meta / type_global 与一个空根节点，
//  正文、子节点、示例引用、_sheetRefs 全部为空。配套的表格簿也不注入
//  示例数据（newBlankFile 中跳过 resetWithDefaultData，用构造函数的空 A1:A1）。
// ================================================================
function createBlankData() {
  return {
    meta: {
      title: "未命名文档", author: "", created: new Date().toISOString(),
      modified: new Date().toISOString(), version: "1.0"
    },
    type_global: {
      "t*-*.font_size": 12,
      "t0-*.font": "微软雅黑", "t0-*.font_size": 16, "t0-*.bold": 1,
      "t1-*.font": "微软雅黑", "t1-*.font_size": 14,
      "t1-*.bold": 1, "t1-*.paragraph_before": 1, "t1-*.paragraph_after": 0.5,
      "t2-*.font": "微软雅黑", "t2-*.font_size": 12,
      "t2-*.bold": 1, "t2-*.paragraph_before": 0.5, "t2-*.paragraph_after": 0.3,
      "t3-*.font": "微软雅黑", "t3-*.font_size": 12,
      "t3-*.paragraph_line": 1.3,
      "body.font": "微软雅黑", "body.font_size": 12, "body.color": "51,65,85",
      "body.paragraph_line": 1.8,
      hide_t: "t>3", numbering_style: "1.1.1"
    },
    "t0-1": {
      content: "", hide: 0, hide_body: 0, body: ""
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

  // 会话内嵌媒体（粘贴图片 / 打开文件后已有的 udd.media/*）写入 zip。
  // 这些 blob 只存在于内存 session.embeddedMedia 中，若不写入，重新保存会把媒体丢掉。
  // 先写入，_embedMediaFiles 再处理外部文件路径（重名会另行避让）。
  if (typeof app !== 'undefined' && app._activeSession && app._activeSession.embeddedMedia) {
    const mediaFolder = zip.folder('media');
    for (const [key, blob] of Object.entries(app._activeSession.embeddedMedia)) {
      if (!key || !key.startsWith('udd.media/') || !blob) continue;
      const rel = key.slice('udd.media/'.length);
      if (!rel || zip.file('media/' + rel)) continue;
      mediaFolder.file(rel, blob);
    }
  }

  // Embed media files: rewrite paths to udd.media/xxx in saveData
  if (opts.embedMedia && typeof app !== 'undefined' && app.repoServerUrl) {
    await _embedMediaFiles(saveData, zip, app.repoServerUrl);
  }

  // Embed cross-doc references: rewrite =docName.path to =udd.ref-docs.docName.path
  // refs 合并：仓库缓存（可能更新）+ 当前文件自带的嵌入引用（避免重存丢引用）
  let refs = null;
  if (opts.embedRefs) {
    refs = {};
    const sessionDocs = (typeof app !== 'undefined' && app._activeSession && app._activeSession.embeddedRefDocs) || {};
    for (const [name, docData] of Object.entries(sessionDocs)) {
      if (name && docData) refs[name] = docData;
    }
    if (typeof _refDocCache !== 'undefined') {
      for (const [name, docData] of Object.entries(_refDocCache)) {
        if (name && docData) refs[name] = docData; // 仓库缓存优先（更新鲜）
      }
    }
    // 顺手修复历史数据：旧版本误把本档表格引用改写为 =udd.ref-docs.Sheet1.B2，
    // 保存时还原为 =Sheet1.B2（渲染期的自愈只影响显示，这里让文件本身也变干净）。
    _repairLegacyEmbeddedSheetRefs(saveData, refs);
    _embedRefsInline(saveData);
    // 跨文档表格数据：被引用文档的 sheets.xlsx 一并打包（离线/跨目录也能出表），
    // 并把成功嵌入的引用改写成显式 udd.ref-docs. 语法（与节点引用一致，消除歧义）。
    try {
      const embeddedDocs = await _embedCrossDocSheets(saveData, zip);
      _prefixEmbeddedSheetRefs(saveData, embeddedDocs);
    } catch (e) { /* skip */ }
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
  // Write ref-docs.json when embedding refs（合并后的 refs，含文件自带嵌入引用）
  if (opts.embedRefs && refs && Object.keys(refs).length > 0) {
    zip.file('ref-docs.json', JSON.stringify(refs));
  }
  return await zip.generateAsync({ type: 'blob' });
}

// 把历史损坏的 =udd.ref-docs.Sheet1.B2（本档表格引用被误改写）还原成 =Sheet1.B2。
// 判定：去掉 udd.ref-docs. 后没有匹配任何嵌入文档键，且能解析为本档单元格引用。
function _repairLegacyEmbeddedSheetRefs(data, refDocs) {
  const keys = Object.keys(refDocs || {});
  const PRE = 'udd.ref-docs.';
  const fixRef = (refStr) => {
    if (typeof refStr !== 'string' || !refStr.startsWith('=' + PRE)) return refStr;
    const rest = refStr.slice(1 + PRE.length);
    for (const k of keys) {
      if (k && (rest === k || rest.startsWith(k + '.'))) return refStr; // 确实指向嵌入文档
    }
    const sr = parseSheetRef('=' + rest);
    if (sr && !sr.docName) return '=' + rest;
    return refStr;
  };
  const refRe = /\{\{(=[^}]+)\}\}/g;
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (k === '_sheetRefs') continue;
      if (typeof obj[k] === 'string') {
        let v = obj[k];
        if (isRef(v)) v = fixRef(v);
        if (v.indexOf('{{=') >= 0) v = v.replace(refRe, (full, refStr) => '{{' + fixRef(refStr) + '}}');
        obj[k] = v;
      } else if (typeof obj[k] === 'object') {
        walk(obj[k]);
      }
    }
  };
  walk(data);
}

// 收集内容中引用到的跨文档表格 docName：
//   ① 表格标签 {{"table":"doc.udd.Sheet1.A1:C3"}} ② 跨档单元格引用 =doc.udd.Sheet1.B2（含行内形态）
function _collectCrossDocSheetNames(data) {
  const names = new Set();
  const tableRe = /"table"\s*:\s*"([^"]+)"/g;
  const inlineRefRe = /\{\{(=[^}]+)\}\}/g;
  const addTable = (v) => {
    tableRe.lastIndex = 0;
    let m;
    while ((m = tableRe.exec(v)) !== null) {
      let tr = null;
      try { tr = (typeof parseTableRef === 'function') ? parseTableRef(m[1]) : null; } catch (e) { tr = null; }
      if (tr && tr.docName) names.add(tr.docName);
    }
  };
  const addRef = (refStr) => {
    try {
      const sr = parseSheetRef(refStr);
      if (sr && sr.docName) names.add(sr.docName);
    } catch (e) { /* skip */ }
  };
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string') {
        if (v.indexOf('{{') >= 0) {
          addTable(v);
          v.replace(inlineRefRe, (full, refStr) => { addRef(refStr); return full; });
        }
        if (isRef(v)) addRef(v);
      } else if (v && typeof v === 'object') {
        walk(v);
      }
    }
  };
  walk(data);
  return [...names];
}

// 把内容引用到的跨文档工作簿打包进 zip：ref-sheets/N.xlsx + ref-sheets.json 清单
// 返回成功嵌入的 docName 集合（用于把引用改写成显式 udd.ref-docs. 语法）。
async function _embedCrossDocSheets(data, zip) {
  const names = _collectCrossDocSheetNames(data);
  const embedded = new Set();
  if (!names.length) return embedded;
  const session = (typeof app !== 'undefined' && app._activeSession) || null;
  const manifest = {};
  let idx = 0;
  for (const name of names) {
    let bin = null;
    if (session && session.embeddedSheetBins && session.embeddedSheetBins[name]) bin = session.embeddedSheetBins[name];
    if (!bin && typeof _refDocSheetBins !== 'undefined' && _refDocSheetBins[name]) bin = _refDocSheetBins[name];
    if (!bin && typeof _loadDocFromServer === 'function') {
      try { await _loadDocFromServer(name); } catch (e) { /* skip */ }
      if (typeof _refDocSheetBins !== 'undefined') bin = _refDocSheetBins[name] || null;
    }
    if (!bin) continue;
    const entry = 'ref-sheets/' + (idx++) + '.xlsx';
    zip.file(entry, bin);
    manifest[name] = entry;
    embedded.add(name);
  }
  if (Object.keys(manifest).length > 0) {
    zip.file('ref-sheets.json', JSON.stringify(manifest));
  }
  return embedded;
}

// 把已成功嵌入的跨文档表格/单元格引用改写成显式快照语法（与节点引用 udd.ref-docs. 一致）：
//   表格标签：{{"table":"doc.udd.Sheet1.A1:C3"}} → {{"table":"udd.ref-docs.doc.udd.Sheet1.A1:C3"}}
//   单元格引用：=doc.udd.Sheet1.B2 → =udd.ref-docs.doc.udd.Sheet1.B2（含行内 {{=...}}）
// 未成功嵌入的引用保持原样（继续按实时来源解析）。
function _prefixEmbeddedSheetRefs(data, embeddedNames) {
  if (!embeddedNames || !embeddedNames.size) return;
  const tableValRe = /("table"\s*:\s*")([^"]+)(")/g;
  const inlineRefRe = /\{\{(=[^}]+)\}\}/g;
  const refWho = (refStr) => {
    try {
      const sr = parseSheetRef(refStr);
      return (sr && sr.docName && !sr.isEmbed && embeddedNames.has(sr.docName)) ? '=udd.ref-docs.' + refStr.slice(1) : refStr;
    } catch (e) { return refStr; }
  };
  const tableWho = (value) => {
    try {
      const tr = parseTableRef(value);
      if (tr && tr.docName && !tr.isEmbed && embeddedNames.has(tr.docName)) return 'udd.ref-docs.' + value;
    } catch (e) { /* skip */ }
    return value;
  };
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (k === '_sheetRefs') continue;
      const v = obj[k];
      if (typeof v === 'string') {
        let out = v;
        if (out.indexOf('"table"') >= 0) {
          tableValRe.lastIndex = 0;
          out = out.replace(tableValRe, (full, pre, value, post) => pre + tableWho(value) + post);
        }
        if (isRef(out)) out = refWho(out);
        if (out.indexOf('{{=') >= 0) {
          out = out.replace(inlineRefRe, (full, refStr) => '{{' + refWho(refStr) + '}}');
        }
        obj[k] = out;
      } else if (v && typeof v === 'object') {
        walk(v);
      }
    }
  };
  walk(data);
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

// Rewrite =docName.t1-1.field to =udd.ref-docs.docName.t1-1.field (only cross-doc node refs)
function _rewriteRefToUdd(refStr) {
  if (!refStr.startsWith('=')) return refStr;
  // 表格单元格引用（本档 =Sheet1.B2 / 跨档 =file.udd.Sheet1.B2）不参与内嵌重写：
  // 本档表格数据由 sheets.xlsx 内嵌；跨档表格无法用 ref-docs.json 表达。
  // 旧版本漏了这条判断，把 =Sheet1.B2 误当成跨档节点引用改写成
  // =udd.ref-docs.Sheet1.B2，导致保存后内嵌引用全部失效。
  if (parseSheetRef(refStr)) return refStr;
  const ref = parseRef(refStr);
  if (ref.isUddEmbed) return refStr; // 已是嵌入形态，避免重复加前缀
  if (!ref.docName) return refStr; // local ref, no change
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
  const pathMap = {}; // 原始字面路径 src → { fetchPath, embedded }
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
          // 绝对/相对媒体都允许嵌入：相对路径按当前文档加载路径解析到原文件。
          const fileCandidates = (typeof app !== 'undefined' && app.resolveMediaFilePathCandidates)
            ? app.resolveMediaFilePathCandidates(src)
            : ((/^[A-Za-z]:[\\/]/.test(src) || src.startsWith('/')) ? [src] : []);
          const fetchPath = fileCandidates[0];
          if (fetchPath && !pathMap[src]) {
            pathMap[src] = { fetchPath, embedded: null };
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
  for (const entry of Object.values(pathMap)) {
    try {
      let fetchBlob = null;
      const fetchPath = entry.fetchPath;
      if (/^[A-Za-z]:[\\/]/.test(fetchPath) || fetchPath.startsWith('/')) {
        const resp = await fetch(serverUrl + '/api/readfile?path=' + encodeURIComponent(fetchPath));
        if (!resp.ok) continue;
        fetchBlob = await resp.blob();
      }
      if (!fetchBlob) continue;
      const ext = fetchPath.split('.').pop().toLowerCase();
      let fname = 'media_' + (idx++) + '.' + ext;
      // 避免与会话内嵌媒体（先写入的 media/ 文件）重名覆盖
      while (zip.file('media/' + fname)) fname = 'media_' + (idx++) + '.' + ext;
      mediaFolder.file(fname, fetchBlob);
      entry.embedded = 'udd.media/' + fname;
    } catch (e) { /* skip */ }
  }

  // Rewrite paths in saveData clone
  function rewritePaths(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'string') {
        for (const [orig, entry] of Object.entries(pathMap)) {
          if (entry.embedded && obj[k].includes(orig)) {
            obj[k] = obj[k].split(orig).join(entry.embedded);
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

  // Load embedded cross-doc workbooks（ref-sheets.json: { docName: "ref-sheets/N.xlsx" }）
  // 保存「嵌入引用」时连同跨文档表格数据一起打包，离线/跨目录也能出表。
  const embeddedSheets = {};
  const embeddedSheetBins = {};
  const refSheetsFile = zip.file('ref-sheets.json');
  if (refSheetsFile) {
    try {
      const manifest = JSON.parse(await refSheetsFile.async('string'));
      for (const [docName, entryName] of Object.entries(manifest || {})) {
        if (!docName || !entryName) continue;
        const f = zip.file(entryName);
        if (!f) continue;
        const bin = await f.async('uint8array');
        embeddedSheetBins[docName] = bin;
        if (typeof XLSX !== 'undefined') {
          try { embeddedSheets[docName] = XLSX.read(bin, { type: 'array' }); } catch (e) {}
        }
      }
    } catch (e) {}
  }

  return { data, embeddedMedia, embeddedRefDocs, embeddedSheets, embeddedSheetBins, xlsxBin, pptFormat };
}

// ================================================================
//  通用确认 / 输入对话框（Electron 兼容）
//
//  Electron 不支持 window.confirm / window.prompt（静默返回 false/undefined），
//  桌面端：confirm 走主进程系统对话框（同步 IPC），prompt 走页面内模态；
//  浏览器端：保持原生行为。
// ================================================================

// 同步确认框，返回 true=确定 / false=取消
function uddConfirm(message, detail) {
  if (typeof window !== 'undefined' && window.uddDesktop && window.uddDesktop.confirmSync) {
    try { return !!window.uddDesktop.confirmSync(String(message || ''), String(detail || '')); } catch (e) {}
  }
  try { return window.confirm(message); } catch (e) { return false; }
}

// 输入框（Promise<string|null>）：桌面端无法用原生 prompt，用页面内模态实现
function uddPrompt(message, defaultValue) {
  if (typeof window !== 'undefined' && window.uddDesktop && window.uddDesktop.isDesktop) {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;display:flex;align-items:center;justify-content:center';
      const dlg = document.createElement('div');
      dlg.style.cssText = 'background:#fff;border-radius:8px;padding:18px 20px;min-width:420px;max-width:80vw;box-shadow:0 8px 30px rgba(0,0,0,.25)';
      const msg = document.createElement('div');
      msg.style.cssText = 'font-size:13px;color:#374151;white-space:pre-wrap;margin-bottom:12px;line-height:1.6';
      msg.textContent = message || '';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = defaultValue == null ? '' : String(defaultValue);
      input.style.cssText = 'width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;outline:none;box-sizing:border-box';
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px';
      const cancel = document.createElement('button');
      cancel.textContent = '取消';
      cancel.style.cssText = 'padding:6px 16px;border:1px solid #d1d5db;border-radius:5px;background:#fff;cursor:pointer;font-size:13px';
      const ok = document.createElement('button');
      ok.textContent = '确定';
      ok.style.cssText = 'padding:6px 16px;border:none;border-radius:5px;background:#2563eb;color:#fff;cursor:pointer;font-size:13px';
      btns.appendChild(cancel); btns.appendChild(ok);
      dlg.appendChild(msg); dlg.appendChild(input); dlg.appendChild(btns);
      mask.appendChild(dlg);
      document.body.appendChild(mask);
      const finish = v => { mask.remove(); resolve(v); };
      cancel.onclick = () => finish(null);
      ok.onclick = () => finish(input.value);
      mask.onclick = ev => { if (ev.target === mask) finish(null); };
      input.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Enter') finish(input.value);
        else if (ev.key === 'Escape') finish(null);
      });
      // 延迟一帧再聚焦/绑外部关闭，避免触发页面上其它 click 处理器
      requestAnimationFrame(() => { input.focus(); input.select(); });
    });
  }
  try {
    const v = window.prompt(message, defaultValue == null ? '' : String(defaultValue));
    return Promise.resolve(v);
  } catch (e) {
    return Promise.resolve(null);
  }
}
