// ================================================================
//  UDD File & Storage
//  Default data, IndexedDB persistence, undo manager,
//  toast notifications, UDD file format (zip/unzip)
// ================================================================

// ================================================================
//  DEFAULT DATA
// ================================================================
function createDefaultData() {
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
    // 表格→大纲引用
    "_sheetRefs": {
      "Sheet1!A2": "=t1-5.t2-1.content",
      "Sheet1!A3": "=t1-5.t2-2.content",
      "Sheet1!A4": "=t1-5.t2-3.content"
    },

    // ── 根节点 ──
    "t0-1": {
      content: "UDD 统一数据文档", hide: 0, hide_body: 0,
      body: "UDD 的核心理念：一份数据，多种视图。大纲、思维导图、文档、表格共享同一棵数据树，通过引用实现数据联动。",

      // ── 1. 引用基础 ──
      "t1-1": {
        content: "引用基础", hide: 0, hide_body: 0,
        body: "UDD 中所有引用使用 {{=引用}} 语法。引用可放在内容任意位置，前后可自由添加文字。",
        "t2-1": { content: "原始数据节点", hide: 0, hide_body: 0, body: "这是一段会被其他节点引用的正文。修改这里，所有引用处同步更新。" },
        "t2-2": { content: "=t1-1.t2-1", hide: 0, hide_body: 0 },
        "t2-3": { content: "内容引用：{{=t1-1.t2-1.content}}", hide: 0, hide_body: 0 },
        "t2-4": { content: "正文引用：{{=t1-1.t2-1.body}}", hide: 0, hide_body: 0 }
      },

      // ── 2. 引用进阶 ──
      "t1-2": {
        content: "引用进阶", hide: 0, hide_body: 0,
        body: "引用支持截取和正则提取，可从源数据中精确提取所需片段。",
        "t2-1": { content: "截取前6字：{{=t1-1.t2-1.content(0,6)}}", hide: 0, hide_body: 0 },
        "t2-2": { content: "正则提取：{{=t1-1.t2-1.body.match(/修改(.+?)，/).[1]}}", hide: 0, hide_body: 0 }
      },

      // ── 3. 混合内容演示 ──
      "t1-3": {
        content: "混合内容演示", hide: 0, hide_body: 0,
        body: "在同一行中混合手敲文字和多个引用，实现灵活的数据拼接。",
        "t2-1": { content: "产品「{{=t1-5.t2-1.content}}」库存 {{=Sheet1.B2}} 件，单价 {{=Sheet1.C2}} 元", hide: 0, hide_body: 0 },
        "t2-2": { content: "源节点：{{=t1-1.t2-1.content}}，正文片段：{{=t1-1.t2-1.body(0,10)}}", hide: 0, hide_body: 0 }
      },

      // ── 4. 跨文档引用 ──
      "t1-4": {
        content: "跨文档引用", hide: 0, hide_body: 0,
        body: "引用其他 .udd 文件数据。格式：{{=文档名.节点.字段}}。需在同一仓库目录中。",
        "t2-1": { content: "跨文档数据：{{=测试文档1.t1-1.content}}", hide: 0, hide_body: 0 }
      },

      // ── 5. 表格↔大纲互引 ──
      "t1-5": {
        content: "表格与大纲互引", hide: 0, hide_body: 0,
        body: "大纲用 {{=Sheet1.B2}} 引用表格单元格，表格用 _sheetRefs 引用大纲节点。切换到「表格」视图查看。",
        "t2-1": { content: "苹果", hide: 0, hide_body: 0,
          "t3-1": { content: "数量：{{=Sheet1.B2}}，单价：{{=Sheet1.C2}}", hide: 0, hide_body: 0 }
        },
        "t2-2": { content: "香蕉", hide: 0, hide_body: 0,
          "t3-1": { content: "数量：{{=Sheet1.B3}}，单价：{{=Sheet1.C3}}", hide: 0, hide_body: 0 }
        },
        "t2-3": { content: "橙子", hide: 0, hide_body: 0,
          "t3-1": { content: "数量：{{=Sheet1.B4}}，单价：{{=Sheet1.C4}}", hide: 0, hide_body: 0 }
        }
      },

      // ── 6. 设计理念 ──
      "t1-6": {
        content: "UDD 设计特点", hide: 0, hide_body: 0,
        "t2-1": { content: "一份数据，四种视图", hide: 0, hide_body: 0, body: "大纲、思维导图、文档、表格共享同一棵 JSON 数据树，无需重复录入。" },
        "t2-2": { content: "引用即联动", hide: 0, hide_body: 0, body: "修改源节点，所有引用处自动同步。支持节点级、字段级、跨文档、跨表格引用。" },
        "t2-3": { content: "离线优先", hide: 0, hide_body: 0, body: "所有资源本地加载，IndexedDB 自动保存，.udd 文件基于 ZIP 格式自包含。" },
        "t2-4": { content: "结构化存储", hide: 0, hide_body: 0, body: "数据以树形 JSON 存储，支持样式继承、层级折叠、编号系统。" }
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
async function createUDDBlob(data) {
  const zip = new JSZip();
  const bottom = compressData(data);
  zip.file('data.json', JSON.stringify(bottom, null, 2));
  const meta = data.meta || {};
  zip.file('meta.json', JSON.stringify({
    format_version: '1.0', app_version: '1.0.0',
    title: meta.title || '', author: meta.author || '',
    created: meta.created || '', modified: new Date().toISOString()
  }, null, 2));
  zip.file('view_state.json', JSON.stringify({ last_view: 'outline' }, null, 2));
  // Embed sheets.xlsx if sheet data exists
  if (typeof app !== 'undefined' && app.sheetView) {
    const xlsxBin = app.sheetView.toBinary();
    if (xlsxBin) zip.file('sheets.xlsx', xlsxBin);
  }
  // Embed ppt-format.json if PPT format exists
  if (typeof app !== 'undefined' && app.pptView) {
    const fmt = app.pptView.getFormat();
    if (fmt) zip.file('ppt-format.json', JSON.stringify(fmt, null, 2));
  }
  return await zip.generateAsync({ type: 'blob' });
}

async function parseUDDBlob(blob) {
  const zip = await JSZip.loadAsync(blob);
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('无效的 .udd 文件：缺少 data.json');
  const json = await dataFile.async('string');
  const bottom = JSON.parse(json);
  const data = decompressData(bottom);
  // Load embedded sheets.xlsx if present
  const sheetsFile = zip.file('sheets.xlsx');
  if (sheetsFile && typeof app !== 'undefined' && app.sheetView) {
    const xlsxBin = await sheetsFile.async('uint8array');
    app.sheetView.loadFromBinary(xlsxBin);
  }
  // Load embedded ppt-format.json if present
  const pptFile = zip.file('ppt-format.json');
  if (pptFile && typeof app !== 'undefined' && app.pptView) {
    try {
      const pptJson = await pptFile.async('string');
      app.pptView.setFormat(JSON.parse(pptJson));
    } catch (e) {}
  }
  return data;
}
