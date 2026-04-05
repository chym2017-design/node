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
    "t0-1": {
      content: "内容引用示例", hide: 0, hide_body: 0,
      "t1-1": { content: "源数据：HelloWorld 2026", hide: 0, hide_body: 0,
        "t2-1": { content: "标题1-1", hide: 0, hide_body: 0 }
      , body: "标题1的正文" },
      "t1-2": { content: "=t1-1", hide: 0, hide_body: 0 },
      "t1-3": { content: "=t1-1.content", hide: 0, hide_body: 0 },
      "t1-4": { content: "=示例文档.t1-1.content", hide: 0, hide_body: 0 },
      "t1-5": { content: "=t1-1.content(0,3)", hide: 0, hide_body: 0 },
      "t1-6": { content: "=t1-1.content.match(/\\d+/).[0]", hide: 0, hide_body: 0 }
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
  return await zip.generateAsync({ type: 'blob' });
}

async function parseUDDBlob(blob) {
  const zip = await JSZip.loadAsync(blob);
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('无效的 .udd 文件：缺少 data.json');
  const json = await dataFile.async('string');
  const bottom = JSON.parse(json);
  return decompressData(bottom);
}
