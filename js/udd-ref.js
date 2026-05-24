// ================================================================
//  UDD Reference System & Shared UI Helpers
//  Content references (=t1-1, cross-doc refs), node rendering,
//  body button, fold toggle, indent/outdent, drag-move,
//  color palette data
// ================================================================

//  CONTENT REFERENCE SYSTEM
// ================================================================
// 严格 ref 判定：必须是 "=" + 合法首字符开头（避免尾部空白、零宽字符、IME 残留
// 把普通文本误判为引用）。首字符允许: t-node 前缀 "t"、字母、下划线、中文、
// 以及 udd. 嵌入前缀的 "u"。
function isRef(value) {
  if (typeof value !== 'string' || value.length < 2 || value[0] !== '=') return false;
  const c = value.charCodeAt(1);
  // A-Z a-z 0-9 _ 中文
  const isAscii = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c === 0x5f;
  const isCJK = c >= 0x4e00 && c <= 0x9fff;
  if (!isAscii && !isCJK) return false;
  // 结构校验（统一走 parseSheetRef，覆盖本档 + 跨档单元格引用，不依赖首字符是否拉丁）
  if (parseSheetRef(value)) return true;
  try {
    const r = parseRef(value);
    return !!r.nodePath;
  } catch (e) { return false; }
}

// 解析单元格引用（本档 / 跨档），统一返回 {docName, sheetName, addr} 或 null。
//   本档:  =Sheet1.A1                       → {docName: null, sheetName: 'Sheet1', addr: 'A1'}
//   跨档:  =path/file.udd.Sheet1.A1          → {docName: 'path/file.udd', sheetName: 'Sheet1', addr: 'A1'}
//   跨档:  =D:/x/file.udd.Sheet1.A1          → 同上（绝对路径）
// 单元格区间 (A1:B2) 不在这里处理；那是 `{{"table":"..."}}` 媒体语义，由 parseTableRef 负责。
function parseSheetRef(refStr) {
  if (typeof refStr !== 'string' || refStr.length < 2 || refStr[0] !== '=') return null;
  const body = refStr.slice(1);
  // 跨档：检测 .udd. 边界，前为 docName，后为 SheetName.Addr
  const uddPos = body.indexOf('.udd.');
  if (uddPos > 0) {
    const docName = body.slice(0, uddPos) + '.udd';
    const after = body.slice(uddPos + 5);
    const m = after.match(/^([A-Za-z][A-Za-z0-9_]*)\.([A-Z]{1,3}\d{1,7})$/);
    if (m && !/^t\d+$/.test(m[1])) {
      return { docName, sheetName: m[1], addr: m[2] };
    }
    return null;
  }
  // 本档：SheetName.Addr，且 SheetName 必须以拉丁字母开头（与中文节点路径区分）
  const m = body.match(/^([A-Za-z][A-Za-z0-9_]*)\.([A-Z]{1,3}\d{1,7})$/);
  if (m && !/^t\d+$/.test(m[1])) {
    return { docName: null, sheetName: m[1], addr: m[2] };
  }
  return null;
}

// Check if content has inline {{=ref}} patterns
function hasInlineRefs(value) {
  return typeof value === 'string' && value.includes('{{=');
}

// Parse content with {{=ref}} into segments: [{type:'text',value:...}, {type:'ref',raw:...,resolved:...}]
// 渲染规则：
//   - text 段：剥掉用户写在文本里的媒体 tag（{{"image":...}} / {{"table":...}} 等）。这些 tag
//     由独立的媒体 collector 单独渲染成块级图/视/表，不应在 inline 文本里再以字面 {{...}} 出现。
//   - ref 段：resolved 同样剥媒体 tag（避免被引用的源 body 里夹带的媒体 tag 被当作字面文本写出来），
//     并把换行折成空格 —— 防止 markdown-it 的 breaks:true 把源字段里的 \n 转成 <br>，导致内联引用
//     渲染后出现"值 → 大空白 → ↗"的换行 gap。
//   该清理逻辑被 refreshRefs / _resolveAsyncRefs 复用（见 inlineRefDisplay），保证 DOM 刷新路径
//   不会用未清理的原始 resolveRef 结果覆盖掉初次渲染时的清理。
function inlineRefDisplay(s) {
  if (typeof s !== 'string') return '';
  return stripMediaTags(s).replace(/[\r\n]+/g, ' ');
}

function resolveInlineRefs(data, text) {
  const segments = [];
  const re = /\{\{(=[^}]+)\}\}/g;
  let lastIdx = 0, m;
  const cleanText = (s) => (typeof s === 'string' ? stripMediaTags(s) : '');
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) segments.push({ type: 'text', value: cleanText(text.slice(lastIdx, m.index)) });
    const refStr = m[1];
    segments.push({ type: 'ref', raw: refStr, resolved: inlineRefDisplay(resolveRef(data, refStr)) });
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) segments.push({ type: 'text', value: cleanText(text.slice(lastIdx)) });
  return segments;
}

// Check if a reference is a "full node" reference (e.g. =t1-1, no .field suffix)
function isFullNodeRef(refStr) {
  if (!isRef(refStr)) return false;
  const ref = parseRef(refStr);
  return ref.nodePath && !ref.field && !ref.slice && !ref.matchExpr;
}

// Get the source node for a full node reference (local or cross-doc)
function getFullRefNode(data, refStr) {
  if (!isRef(refStr)) return null;
  const ref = parseRef(refStr);
  if (!ref.nodePath || ref.field || ref.slice || ref.matchExpr) return null;
  if (ref.docName) {
    // Cross-doc full ref: look up from cache synchronously
    const docData = _refDocCache[ref.docName];
    if (!docData) return null;  // not loaded yet — will show as loading
    return findRefNode(docData, ref.nodePath);
  }
  return findRefNode(data, ref.nodePath);
}

// Get the path string that a reference points to (for jump-to-source)
function getRefTargetPath(data, refStr) {
  if (!isRef(refStr)) return null;
  const ref = parseRef(refStr);
  if (!ref.nodePath) return null;
  if (ref.docName) return null; // cross-doc jump not supported
  // Verify the node exists and find its full path in the data tree
  const node = findRefNode(data, ref.nodePath);
  if (!node) return null;
  return findFullPath(data, ref.nodePath);
}

// 拿/建 path index（lazy）。tree 编辑后调用方应把 data._pathIndex 置 null。
// idx 是 Object.create(null) 字典，用属性访问 idx[key] 而非 Map.get(key)，
// 避免混淆器对方法名 get/set 的 stringArray 编码出错。
function _getPathIndex(data) {
  const m = data._pathIndex;
  // 健壮检测：null / undefined / 不是字典对象 → 重建
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    return data._pathIndex = buildPathIndex(data);
  }
  return m;
}

// 按段走树取节点。任何一段 miss 返回 null。
function _walkPath(obj, segments) {
  let cur = obj;
  for (const seg of segments) {
    if (!cur || typeof cur !== 'object' || !cur[seg]) return null;
    cur = cur[seg];
  }
  return cur;
}

// Find the full path of a node key in the data tree
function findFullPath(data, nodeKey) {
  if (nodeKey.includes('.')) {
    const parts = nodeKey.split('.');
    let idx = _getPathIndex(data);
    let rootPath = idx[parts[0]];
    if (!rootPath) {
      // 索引可能因 tree 编辑变 stale；重建一次再试
      data._pathIndex = idx = buildPathIndex(data);
      rootPath = idx[parts[0]];
      if (!rootPath) return null;
    }
    const fullPath = parts.length > 1 ? rootPath + '.' + parts.slice(1).join('.') : rootPath;
    if (getNodeByPath(data, fullPath)) return fullPath;
    // fullPath miss：再重建一次（中间段也可能动了）
    data._pathIndex = idx = buildPathIndex(data);
    rootPath = idx[parts[0]];
    if (!rootPath) return null;
    const fullPath2 = parts.length > 1 ? rootPath + '.' + parts.slice(1).join('.') : rootPath;
    return getNodeByPath(data, fullPath2) ? fullPath2 : null;
  }
  // 单段：索引一查到底
  let idx = _getPathIndex(data);
  let p = idx[nodeKey];
  if (p && getNodeByPath(data, p)) return p;
  data._pathIndex = idx = buildPathIndex(data);
  p = idx[nodeKey];
  return (p && getNodeByPath(data, p)) ? p : null;
}

function _findPathRecursive(obj, targetKey, prefix) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    if (!isTNode(k)) continue;
    const path = prefix ? prefix + '.' + k : k;
    if (k === targetKey) return path;
    const found = _findPathRecursive(obj[k], targetKey, path);
    if (found) return found;
  }
  return null;
}

// ================================================================
//  parseRef 性能优化基础：正则提到模块顶层（避免每次调用重新构造）
//  + memo cache（refStr 是纯输入，结果可永久缓存）
//  + .udd 快路径（同档引用直接跳过 docName 检测循环）
// ================================================================
const REF_MATCH_RE = /\.match\(\/(.+?)\/([gimsuy]*)\)\.\[(\d+)\]$/;
const REF_SLICE_RE = /\((\d+),(\d+)\)$/;
const REF_TNODE_RE = /^t\d+-\d+$/;
const REF_UDD_EMBED_PREFIX = 'udd.ref-docs.';
const _parseRefCache = new Map();

// 把 work 字符串（已经剥掉 docName 部分）解析成 { nodePath, field }，写入 result。
// 也兼容旧语法：当 result.docName 还是 null、首段非 tNode 时把首段当 docName。
function _parseRefRest(result, work) {
  const parts = work.split('.');
  let idx = 0;
  if (!result.docName && !result.isUddEmbed && parts.length >= 2 && !REF_TNODE_RE.test(parts[0])) {
    result.docName = parts[0];
    idx = 1;
  }
  const pathParts = [];
  while (idx < parts.length && REF_TNODE_RE.test(parts[idx])) {
    pathParts.push(parts[idx]);
    idx++;
  }
  if (pathParts.length > 0) result.nodePath = pathParts.join('.');
  if (idx < parts.length) result.field = parts[idx];
}

function parseRef(refStr) {
  const cached = _parseRefCache.get(refStr);
  if (cached) return cached;

  const result = { docName: null, nodePath: null, field: null, slice: null, matchExpr: null, isUddEmbed: false };
  let raw = refStr.slice(1); // remove leading '='

  // 后缀 .match(/pattern/).[idx]（少见，先 strip）
  const matchM = raw.match(REF_MATCH_RE);
  if (matchM) {
    result.matchExpr = { pattern: new RegExp(matchM[1], matchM[2]), index: parseInt(matchM[3]) };
    raw = raw.slice(0, matchM.index);
  }

  // 后缀 (start,end) slice
  const sliceM = raw.match(REF_SLICE_RE);
  if (sliceM) {
    result.slice = [parseInt(sliceM[1]), parseInt(sliceM[2])];
    raw = raw.slice(0, sliceM.index);
  }

  // —— 三种形态分发，避免每次都 split + 循环找 udd 段 ——

  // (1) 嵌入引用：udd.ref-docs.<docKey>.<rest>
  if (raw.startsWith(REF_UDD_EMBED_PREFIX)) {
    result.isUddEmbed = true;
    _parseRefRest(result, raw.slice(REF_UDD_EMBED_PREFIX.length));
    _parseRefCache.set(refStr, result);
    return result;
  }

  // (2) 跨档引用：<path>.udd.<rest>  ← 你提到的 .udd 快路径
  //   indexOf 是 O(n) 的简单字符串扫描，比 split + 数组扫描快得多
  const uddSep = raw.indexOf('.udd.');
  if (uddSep >= 0) {
    result.docName = raw.slice(0, uddSep + 4);   // "...path/file.udd"
    _parseRefRest(result, raw.slice(uddSep + 5)); // 5 = '.udd.' 长度
    _parseRefCache.set(refStr, result);
    return result;
  }

  // (3) 同档引用 + 旧语法兜底
  _parseRefRest(result, raw);
  _parseRefCache.set(refStr, result);
  return result;
}

function nodeToText(node) {
  if (!node || typeof node !== 'object') return String(node ?? '');
  let text = node.content || '';
  if (node.body) text += '\n' + node.body;
  return text;
}

// ================================================================
// FUNCTION 1: resolveRef — synchronous resolution for =refStr
// Lookup order: 1.本文档 → 2.嵌入(udd.ref-docs) → 3.跨文档(#LOADING... for async)
// ================================================================
function resolveRef(data, refStr) {
  if (!isRef(refStr)) return refStr;

  // Sheet reference: =Sheet1.B2 (本档) 或 =doc.udd.Sheet1.B2 (跨档)
  const sr = parseSheetRef(refStr);
  if (sr) {
    if (sr.docName) {
      // 跨档单元格：从 _refDocSheets 同步取 workbook；未加载则触发懒加载，返回 #LOADING...
      const wb = (typeof getCrossDocWorkbook === 'function') ? getCrossDocWorkbook(sr.docName) : null;
      if (!wb) {
        if (typeof loadCrossDocSheetsAsync === 'function') {
          loadCrossDocSheetsAsync(sr.docName, () => {
            if (typeof app !== 'undefined' && app.renderCurrentView) {
              requestAnimationFrame(() => app.renderCurrentView());
            }
          });
        }
        return '#LOADING...';
      }
      const ws = wb.Sheets[sr.sheetName];
      if (!ws) return '#REF!';
      const cell = ws[sr.addr];
      return cell ? String(cell.w || (cell.v !== undefined ? cell.v : '')) : '';
    }
    // 本档
    if (typeof app !== 'undefined' && app.sheetView) {
      return String(app.sheetView.getCellValue(sr.sheetName, sr.addr) ?? '');
    }
    return '';
  }

  const ref = parseRef(refStr);
  if (!ref.nodePath) return '#REF!';

  // --- Lookup order ---

  // 1. 嵌入引用 (udd.ref-docs.xxx): 从当前文件的 ref-docs.json 读取
  if (ref.isUddEmbed && ref.docName) {
    const sessionRefDocs = typeof app !== 'undefined' && app._activeSession && app._activeSession.embeddedRefDocs;
    const srcData = sessionRefDocs && sessionRefDocs[ref.docName];
    if (!srcData) return '#LOADING...';
    return _resolveLocalRef(srcData, ref);
  }

  // 2. 跨文档引用 (=docName.xxx): 需要异步加载
  if (ref.docName) {
    // Try _refDocCache (populated from actual server reads, not browser cache)
    if (_refDocCache[ref.docName]) {
      return _resolveLocalRef(_refDocCache[ref.docName], ref);
    }
    return '#LOADING...';
  }

  // 3. 本文档引用: 直接从 data 树查找
  return _resolveLocalRef(data, ref);
}

// Internal: resolve a parsed ref against a specific data tree
function _resolveLocalRef(data, ref) {
  const node = findRefNode(data, ref.nodePath);
  if (!node) return '#REF!';

  let value;
  if (ref.field) {
    value = typeof node === 'object' ? (node[ref.field] ?? '') : '';
  } else {
    value = nodeToText(node);
  }
  value = String(value);

  if (ref.matchExpr) {
    const m = value.match(ref.matchExpr.pattern);
    if (m && m[ref.matchExpr.index] !== undefined) value = m[ref.matchExpr.index];
    else return '#MATCH!';
  }
  if (ref.slice) value = value.slice(ref.slice[0], ref.slice[1]);

  return value;
}

function findRefNode(data, nodePath) {
  if (!nodePath) return null;
  const segments = nodePath.includes('.') ? nodePath.split('.') : [nodePath];

  // ① 直接路径（命中场景：=t0-1.xxx 形式的根级引用）
  const direct = _walkPath(data, segments);
  if (direct !== null) return direct;

  // ② 路径索引（命中场景：=t1-1.xxx 形式的子节点引用，最常见）
  let idx = _getPathIndex(data);
  let fullPath = idx[segments[0]];
  if (fullPath) {
    const fullSegs = fullPath.split('.');
    for (let i = 1; i < segments.length; i++) fullSegs.push(segments[i]);
    const found = _walkPath(data, fullSegs);
    if (found !== null) return found;

    // ③ 索引 stale（tree 刚编辑过）：重建后重试
    data._pathIndex = idx = buildPathIndex(data);
    fullPath = idx[segments[0]];
    if (fullPath) {
      const fullSegs2 = fullPath.split('.');
      for (let i = 1; i < segments.length; i++) fullSegs2.push(segments[i]);
      return _walkPath(data, fullSegs2);
    }
  }
  return null;
}

// ================================================================
//  UNIFIED MEDIA ITEM COLLECTOR
//  原始数据 → 多种渲染 的公共底座：
//  扫描一段文本，深入解析所有 =ref / {{=ref}}，
//  按出现顺序产出 mediaItems（image/video/audio/table）。
//  所有视图（outline、document、mindmap、ppt、sheet）共用。
//  查找顺序严格遵循 resolveRef / resolveRefAsync 的规则，不读浏览器缓存。
// ================================================================
function collectMediaItemsFromText(data, text, visited) {
  const out = [];
  _collectMediaItemsSync(data, text, out, visited || new Set(), null);
  return out;
}

async function collectMediaItemsFromTextAsync(data, text, visited) {
  const out = [];
  await _collectMediaItemsAsyncImpl(data, text, out, visited || new Set(), null);
  return out;
}

// item 上额外挂两个字段：
//   rawInner    {{...}} 里花括号内的原始字符串，editor 写回时按它精确定位该 tag
//   srcRefStr   若本 item 是沿 =ref / {{=ref}} 递归进来的，这里是 **最外层** 那个 ref 字符串
//               （供 ↗ 跳转用）；直接在宿主文本里出现的 tag 则为 null。
function _emitMediaTag(inner, out, curRef) {
  const media = typeof parseMediaTag === 'function' ? parseMediaTag(inner) : null;
  if (media && media.image) { out.push({ type: 'image', src: media.image, meta: media, rawInner: inner, srcRefStr: curRef || null }); return true; }
  if (media && media.video) { out.push({ type: 'video', src: media.video, meta: media, rawInner: inner, srcRefStr: curRef || null }); return true; }
  if (media && media.audio) { out.push({ type: 'audio', src: media.audio, meta: media, rawInner: inner, srcRefStr: curRef || null }); return true; }
  // JSON 形 {{"table":"Sheet1.A1:C4","width":"60%",...}} —— 与 image/video/audio 一致。
  // 旧裸括号 {{Sheet1.A1:C4}} 不再支持；默认数据已改成 JSON 形。
  if (media && media.table && typeof parseTableRef === 'function') {
    const tr = parseTableRef(media.table);
    if (tr) { out.push({ type: 'table', tableRef: tr, meta: media, rawInner: inner, srcRefStr: curRef || null }); return true; }
  }
  return false;
}

function _collectMediaItemsSync(data, text, out, visited, curRef) {
  if (!text || typeof text !== 'string') return;
  // 整段是 =ref（无 {{}}）→ 深入源节点 content + body
  if (isRef(text) && !text.includes('{{')) {
    if (visited.has(text)) return;
    visited.add(text);
    const nextRef = curRef || text;
    if (isFullNodeRef(text)) {
      const src = getFullRefNode(data, text);
      if (src && typeof src === 'object') {
        _collectMediaItemsSync(data, src.content || '', out, visited, nextRef);
        _collectMediaItemsSync(data, src.body || '', out, visited, nextRef);
      }
      return;
    }
    const resolved = resolveRef(data, text);
    if (typeof resolved === 'string' && !resolved.startsWith('#')) {
      _collectMediaItemsSync(data, resolved, out, visited, nextRef);
    }
    return;
  }
  // 扫描所有 {{...}}
  const re = /\{\{(.*?)\}\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1];
    if (inner.startsWith('=')) {
      const refStr = '=' + inner.slice(1);
      if (visited.has(refStr)) continue;
      visited.add(refStr);
      const nextRef = curRef || refStr;
      // {{=fullNodeRef}}：按全节点展开，媒体来自源节点的 content+body
      if (isFullNodeRef(refStr)) {
        const src = getFullRefNode(data, refStr);
        if (src && typeof src === 'object') {
          _collectMediaItemsSync(data, src.content || '', out, visited, nextRef);
          _collectMediaItemsSync(data, src.body || '', out, visited, nextRef);
        }
        continue;
      }
      const resolved = resolveRef(data, inner);
      if (typeof resolved === 'string' && !resolved.startsWith('#')) {
        _collectMediaItemsSync(data, resolved, out, visited, nextRef);
      }
      continue;
    }
    _emitMediaTag(inner, out, curRef);
  }
}

async function _collectMediaItemsAsyncImpl(data, text, out, visited, curRef) {
  if (!text || typeof text !== 'string') return;
  if (isRef(text) && !text.includes('{{')) {
    if (visited.has(text)) return;
    visited.add(text);
    const nextRef = curRef || text;
    if (isFullNodeRef(text)) {
      let src = getFullRefNode(data, text);
      if (!src) {
        // 触发异步加载跨文档 / 嵌入，再重试
        await resolveRefAsync(data, text);
        src = getFullRefNode(data, text);
      }
      if (src && typeof src === 'object') {
        await _collectMediaItemsAsyncImpl(data, src.content || '', out, visited, nextRef);
        await _collectMediaItemsAsyncImpl(data, src.body || '', out, visited, nextRef);
      }
      return;
    }
    const resolved = await resolveRefAsync(data, text);
    if (typeof resolved === 'string' && !resolved.startsWith('#')) {
      await _collectMediaItemsAsyncImpl(data, resolved, out, visited, nextRef);
    }
    return;
  }
  const re = /\{\{(.*?)\}\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1];
    if (inner.startsWith('=')) {
      const refStr = '=' + inner.slice(1);
      if (visited.has(refStr)) continue;
      visited.add(refStr);
      const nextRef = curRef || refStr;
      if (isFullNodeRef(refStr)) {
        let src = getFullRefNode(data, refStr);
        if (!src) {
          await resolveRefAsync(data, refStr);
          src = getFullRefNode(data, refStr);
        }
        if (src && typeof src === 'object') {
          await _collectMediaItemsAsyncImpl(data, src.content || '', out, visited, nextRef);
          await _collectMediaItemsAsyncImpl(data, src.body || '', out, visited, nextRef);
        }
        continue;
      }
      const resolved = await resolveRefAsync(data, inner);
      if (typeof resolved === 'string' && !resolved.startsWith('#')) {
        await _collectMediaItemsAsyncImpl(data, resolved, out, visited, nextRef);
      }
      continue;
    }
    _emitMediaTag(inner, out, curRef);
  }
}

// ================================================================
// 节点编号（渲染用）：处理引用子节点 path 中的 __ref__
// 引用子节点 path 形如 "host.__ref__.t2-1.t3-1"，需要基于源根 + sub-path 计算，
// 这样源节点的 no_number / restart_number 才能被引用出来的子节点继承。
// 普通 path 直接转给 computeNumber（在 udd-data.js）。
// 返回字符串编号；null 表示不渲染编号 span。
// ================================================================
function computeNumberForRender(rootData, path, numStyle) {
  const refIdx = path.indexOf('.__ref__.');
  if (refIdx < 0) return computeNumber(rootData, path, numStyle);
  const hostPath = path.slice(0, refIdx);
  const subPath = path.slice(refIdx + '.__ref__.'.length);
  const hostNode = getNodeByPath(rootData, hostPath);
  if (!hostNode) return null;
  const raw = (hostNode.content || '').trim();
  if (!isFullNodeRef(raw)) return null;
  const sourceRoot = getFullRefNode(rootData, raw);
  if (!sourceRoot) return null; // 跨文档源未加载等
  return computeNumber(sourceRoot, subPath, numStyle);
}

function findNodeRecursive(obj, targetKey) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj[targetKey]) return obj[targetKey];
  for (const k of Object.keys(obj)) {
    if (isTNode(k) && typeof obj[k] === 'object') {
      const found = findNodeRecursive(obj[k], targetKey);
      if (found) return found;
    }
  }
  return null;
}

const _refDocCache = {};
// 跨文档表格用：docName -> 已 XLSX.read 后的 workbook（或 null 表示已尝试但无 sheets.xlsx）。
// 与 _refDocCache 解耦，避免一次表格请求触发整个 ref 解析路径，且让多次 buildInlineTable 命中缓存。
const _refDocSheets = {};
// 标记某 docName 的跨文档 sheets 正在异步加载，避免并发重复 fetch。
const _refDocSheetsLoading = {};

// 同步获取跨文档 workbook（已加载则返回，否则返回 null）。
function getCrossDocWorkbook(docName) {
  if (!docName) return null;
  return _refDocSheets[docName] || null;
}

// 触发跨文档 sheets 的异步加载（懒加载）；加载完成后调用 onLoaded()，
// 通常用于让占位元素重新渲染。同一 docName 多次触发只发起一次实际 fetch。
function loadCrossDocSheetsAsync(docName, onLoaded) {
  if (!docName) return;
  if (_refDocSheets[docName] !== undefined) {
    // 已经加载过（成功 workbook 或 null 失败），无需再 fetch
    if (typeof onLoaded === 'function') onLoaded(_refDocSheets[docName]);
    return;
  }
  if (_refDocSheetsLoading[docName]) {
    // 已有加载在途；累加回调
    if (typeof onLoaded === 'function') _refDocSheetsLoading[docName].callbacks.push(onLoaded);
    return;
  }
  const callbacks = onLoaded ? [onLoaded] : [];
  _refDocSheetsLoading[docName] = { callbacks };
  (async () => {
    try {
      await _loadDocFromServer(docName);
    } catch (e) { /* skip */ }
    const wb = _refDocSheets[docName] || null;
    const cbs = _refDocSheetsLoading[docName].callbacks;
    delete _refDocSheetsLoading[docName];
    for (const cb of cbs) {
      try { cb(wb); } catch (e) { /* skip */ }
    }
  })();
}

function isSheetRef(refStr) {
  return !!parseSheetRef(refStr);
}

// 判定一个 ref 字符串是否需要异步加载才能完整解析（用来决定渲染时挂不挂 data-ref-async）。
//   sheet ref：本档 ws 永远在内存中 → 不需要；跨档 ws 来自 _refDocSheets，可能尚未拉取 → 需要。
//   node ref：跨档 / 嵌入 → 需要；本档 → 不需要。
function refNeedsAsyncLoad(refStr) {
  const sr = parseSheetRef(refStr);
  if (sr) return !!sr.docName;
  try {
    const r = parseRef(refStr);
    return !!(r.docName || r.isUddEmbed);
  } catch (e) { return false; }
}

// ================================================================
// resolveRefAsync — async resolution for refs that returned #LOADING...
// Lookup order: 1.嵌入(懒加载) → 2.仓库服务器 → 3.本机路径
// ================================================================
async function resolveRefAsync(data, refStr) {
  if (!isRef(refStr)) return refStr;
  // Sheet ref（本档同步直接走；跨档先 await 加载，再同步取值）
  const sr = parseSheetRef(refStr);
  if (sr) {
    if (!sr.docName) return resolveRef(data, refStr);
    let wb = (typeof getCrossDocWorkbook === 'function') ? getCrossDocWorkbook(sr.docName) : null;
    if (!wb && typeof loadCrossDocSheetsAsync === 'function') {
      await new Promise(resolve => loadCrossDocSheetsAsync(sr.docName, resolve));
      wb = getCrossDocWorkbook(sr.docName);
    }
    if (!wb) return '#REF!';
    const ws = wb.Sheets[sr.sheetName];
    if (!ws) return '#REF!';
    const cell = ws[sr.addr];
    return cell ? String(cell.w || (cell.v !== undefined ? cell.v : '')) : '';
  }
  const ref = parseRef(refStr);
  if (!ref.nodePath) return '#REF!';
  if (!ref.docName) return resolveRef(data, refStr);

  // 1. 嵌入引用: 触发懒加载从实际文件读取 ref-docs.json
  if (ref.isUddEmbed) {
    const sessionRefDocs = typeof app !== 'undefined' && app._activeSession && app._activeSession.embeddedRefDocs;
    let srcData = sessionRefDocs && sessionRefDocs[ref.docName];
    if (!srcData && typeof app !== 'undefined' && app._ensureEmbeddedMediaLoaded) {
      await app._ensureEmbeddedMediaLoaded();
      const reloaded = app._activeSession && app._activeSession.embeddedRefDocs;
      srcData = reloaded && reloaded[ref.docName];
    }
    if (!srcData) return '#REF!';
    return _resolveLocalRef(srcData, ref);
  }

  // 2. 跨文档: 从仓库服务器实际读取文件
  let docData = _refDocCache[ref.docName];
  if (!docData) {
    try {
      docData = await _loadDocFromServer(ref.docName);
      if (docData) _refDocCache[ref.docName] = docData;
    } catch (e) { /* skip */ }
  }
  if (!docData) return '#DOC!';

  return _resolveLocalRef(docData, ref);
}

// Try to load a document from the local server by name or path
async function _loadDocFromServer(docName) {
  // Determine server URL from app instance or localStorage
  const serverUrl = (typeof app !== 'undefined' && app.repoServerUrl) || localStorage.getItem('udd_server_url') || '';
  if (!serverUrl) return null;
  const repoDir = (typeof app !== 'undefined' && app.repoDir) || localStorage.getItem('udd_repo_dir') || '';
  // 当前文档所在目录（用于解析相对路径）
  const curFilePath = (typeof app !== 'undefined' && app._activeSession && app._activeSession.filePath) || '';
  const curDir = curFilePath ? curFilePath.replace(/[/\\][^/\\]+$/, '') : '';

  const hasUdd = docName.endsWith('.udd');
  const candidates = [];

  // 绝对 Windows 路径 D:\... 或 /...
  if (/^[A-Za-z]:[\\/]/.test(docName) || docName.startsWith('/')) {
    candidates.push(docName);
    if (!hasUdd) candidates.push(docName + '.udd');
  } else if (docName.includes('/') || docName.includes('\\')) {
    // 相对路径：相对当前文档目录
    if (curDir) {
      candidates.push(curDir + '/' + docName);
      candidates.push(curDir + '\\' + docName);
      if (!hasUdd) {
        candidates.push(curDir + '/' + docName + '.udd');
        candidates.push(curDir + '\\' + docName + '.udd');
      }
    }
    if (repoDir) {
      candidates.push(repoDir + '/' + docName);
      candidates.push(repoDir + '\\' + docName);
      if (!hasUdd) {
        candidates.push(repoDir + '/' + docName + '.udd');
        candidates.push(repoDir + '\\' + docName + '.udd');
      }
    }
  } else {
    // 裸文件名：仓库目录下查找
    if (repoDir) {
      if (hasUdd) {
        candidates.push(repoDir + '/' + docName);
        candidates.push(repoDir + '\\' + docName);
      } else {
        candidates.push(repoDir + '/' + docName + '.udd');
        candidates.push(repoDir + '\\' + docName + '.udd');
        candidates.push(repoDir + '/' + docName + '.json');
      }
    }
  }

  for (const filePath of candidates) {
    try {
      const resp = await fetch(serverUrl + '/api/readfile?path=' + encodeURIComponent(filePath), { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) continue;
      if (filePath.endsWith('.json')) {
        const text = await resp.text();
        const parsed = JSON.parse(text);
        // .json 文件没有 sheets.xlsx；标记 null 让后续 getCrossDocWorkbook 不再重复加载
        _refDocSheets[docName] = null;
        return parsed;
      } else {
        const blob = await resp.blob();
        const result = await parseUDDBlob(blob);
        // 顺手把 sheets.xlsx 解析成 workbook 缓存到 _refDocSheets，
        // 让 buildInlineTable 在跨文档表格场景下能直接命中。
        if (result && result.xlsxBin && typeof XLSX !== 'undefined') {
          try {
            _refDocSheets[docName] = XLSX.read(result.xlsxBin, { type: 'array' });
          } catch (e) {
            _refDocSheets[docName] = null;
          }
        } else {
          _refDocSheets[docName] = null;
        }
        return result && result.data ? result.data : result;
      }
    } catch (e) { continue; }
  }
  // 所有候选都失败：明确标记 null，避免后续重复触发加载（直到下次手动刷新）
  if (_refDocSheets[docName] === undefined) _refDocSheets[docName] = null;
  return null;
}

function getDisplayValue(data, node, field) {
  const raw = node[field];
  if (!isRef(raw)) return raw || '';
  return resolveRef(data, raw);
}

// ================================================================
//  UNIFIED NODE RENDER DESCRIPTOR
//  核心思路: 原始数据 → 多种渲染
//  遇到 "=" 引用时，先读取源数据，再用统一方式渲染。
//  sourceNode 不为 null 时，渲染函数直接遍历 sourceNode 的内容和子节点。
// ================================================================
function resolveNodeForRender(data, node, path, level) {
  const raw = node.content || '';
  const _renderOn = typeof app === 'undefined' || app.renderMode !== false;
  const hasInline = _renderOn && hasInlineRefs(raw);
  const isContentRef = _renderOn && !hasInline && isRef(raw);
  const fullRef = _renderOn && isFullNodeRef(raw);
  const sourceNode = fullRef ? getFullRefNode(data, raw) : null;
  // 用户设计：如果是有引用等渲染的，不能直接编辑；双击后显示原文进入源码编辑模式。
  // "渲染的" 包括：=ref / {{=ref}} 内联引用、媒体 tag {{...}}（非 =ref 形式）。
  // hasOwnMedia 标记 content 自身含媒体 tag（不算引用），让渲染层把这种 content 也走源码编辑。
  const hasOwnMedia = _renderOn && hasMediaTag(raw) && !hasInline && !isContentRef && !fullRef;

  const desc = {
    // 渲染用的显示内容（文本部分，去掉 media tag 后由渲染函数处理）
    displayContent: '',
    displayBody: '',
    hasBody: false,
    // 全节点引用: sourceNode 是源节点对象，渲染函数直接遍历它
    sourceNode: sourceNode,
    isRef: isContentRef,
    isFullRef: fullRef,
    refStr: isContentRef ? raw : null,
    hasInlineRefs: hasInline,
    inlineSegments: null,
    contentEditable: !isContentRef && !hasInline && !hasOwnMedia,
    bodyEditable: true,
    hasOwnMedia: hasOwnMedia,
    // hide/hide_body 始终取自当前节点（引用宿主控制折叠）
    hide: node.hide || 0,
    hide_body: node.hide_body || 0,
    renderOn: _renderOn,
  };

  if (hasInline) {
    desc.inlineSegments = resolveInlineRefs(data, raw);
    desc.displayContent = desc.inlineSegments.map(s => s.type === 'ref' ? s.resolved : s.value).join('');
    desc.displayBody = node.body || '';
    desc.hasBody = !!(node.body);
  } else if (fullRef && sourceNode) {
    // 全节点引用成功: 用源节点的 content/body 渲染，子节点也用源节点的
    desc.displayContent = sourceNode.content || '';
    desc.displayBody = sourceNode.body || '';
    desc.hasBody = !!(sourceNode.body);
    desc.bodyEditable = false;
  } else if (fullRef && !sourceNode) {
    desc.displayContent = '#LOADING...';
    desc.displayBody = '';
    desc.hasBody = false;
    desc.bodyEditable = false;
    desc._needsAsyncLoad = true;
  } else if (isContentRef) {
    desc.displayContent = resolveRef(data, raw);
    desc.displayBody = node.body || '';
    desc.hasBody = !!(node.body);
  } else {
    desc.displayContent = raw;
    desc.displayBody = node.body || '';
    desc.hasBody = !!(node.body);
  }

  // body 自身的引用解析（与上面的分支无关）：
  //   {{=ref}} 内联引用 → 替换为解析值（含可能的媒体 tag 一并交给后续 stripMediaTags
  //                       与媒体 collector 处理）。
  //   纯 =ref           → 替换为解析值。
  // 之前只有 if (hasInline) 分支里才处理 body 的内联引用，导致 content 是普通
  // 文本但 body 含 {{=ref}} 的节点（用户的"媒体引用联动"用法）渲染时残留字面 tag、
  // 引用文本也没有展开。
  if (!fullRef) {
    const rawBody = node.body || '';
    if (hasInlineRefs(rawBody)) {
      desc.bodyInlineSegments = resolveInlineRefs(data, rawBody);
      desc.displayBody = desc.bodyInlineSegments.map(s => s.type === 'ref' ? s.resolved : s.value).join('');
      desc.bodyEditable = false;
    } else if (isRef(rawBody)) {
      desc.bodyEditable = false;
      desc.displayBody = resolveRef(data, rawBody);
    } else if (hasMediaTag(rawBody)) {
      // body 仅含媒体 tag（非引用形式）：与"渲染内容不可直接编辑"原则一致 → 改走双击源码编辑
      desc.bodyEditable = false;
    }
  }

  return desc;
}

// Render inline segments (text + {{=ref}}) into a container element.
// node / fieldKey 可选——传入后会基于 node[`${fieldKey}.<style>`] 的 range 样式
// 在 segments 拼出的"显示文本"坐标系下切片应用 per-character 样式（与
// renderStyledText 的坐标系保持一致：DOM 选区给出的 offset 也是 segments 拼出的
// 已解析文本的偏移）。ref 段视为原子单位：若整段在某属性上样式统一就一并应用，
// 否则该属性回退到 baseStyle，避免把单个 .inline-ref 拆成多个、破坏 ref-icon。
function renderInlineSegments(container, segments, data, viewInstance, applyStyleFn, baseStyle, node, fieldKey) {
  container.innerHTML = '';
  const fullText = segments.map(s => s.type === 'text' ? s.value : s.resolved).join('');
  const runs = (node && fieldKey && fullText) ? buildStyledRuns(node, fieldKey, fullText, baseStyle) : null;
  // 同 renderStyledText：本容器内填了 styled span，applyMdHtml 必须跳过，否则
  // innerHTML 被 md 重写、per-char 样式 + .inline-ref 结构都会丢。
  container.dataset.uddStyledRuns = '1';

  // 用 run 序列在区间 [a, b) 上聚合样式：每个字段若整个区间内同值就采用该值，
  // 否则该字段不写入（让调用方继承 baseStyle）。
  function uniformStyleOver(a, b) {
    if (!runs || a >= b) return null;
    const out = {};
    const seen = {};
    let cursor = 0;
    for (const run of runs) {
      const rEnd = cursor + run.text.length;
      if (rEnd <= a) { cursor = rEnd; continue; }
      if (cursor >= b) break;
      for (const k of Object.keys(run.style)) {
        if (seen[k] === undefined) {
          seen[k] = true;
          out[k] = run.style[k];
        } else if (out[k] !== run.style[k]) {
          delete out[k];
          seen[k] = 'mixed';
        }
      }
      cursor = rEnd;
    }
    return out;
  }

  let offset = 0;
  for (const seg of segments) {
    const segText = seg.type === 'text' ? seg.value : seg.resolved;
    const segEnd = offset + segText.length;

    if (seg.type === 'text') {
      if (!runs) {
        const span = document.createElement('span');
        span.textContent = segText;
        if (applyStyleFn && baseStyle) applyStyleFn(span, baseStyle);
        container.appendChild(span);
      } else {
        // 按 run 边界切分该 text segment
        let cursor = 0;
        for (const run of runs) {
          const rEnd = cursor + run.text.length;
          if (rEnd <= offset) { cursor = rEnd; continue; }
          if (cursor >= segEnd) break;
          const a = Math.max(cursor, offset);
          const b = Math.min(rEnd, segEnd);
          const span = document.createElement('span');
          span.textContent = fullText.substring(a, b);
          if (applyStyleFn) applyStyleFn(span, Object.assign({}, baseStyle, run.style));
          container.appendChild(span);
          cursor = rEnd;
        }
      }
    } else {
      const refSpan = document.createElement('span');
      refSpan.className = 'inline-ref';
      refSpan.dataset.ref = seg.raw;
      refSpan.title = seg.raw;
      // Mark for async resolution: 跨档/嵌入的节点引用，或跨档单元格引用 — 都需要懒加载
      if (refNeedsAsyncLoad(seg.raw)) refSpan.dataset.refAsync = seg.raw;
      refSpan.textContent = seg.resolved;
      if (seg.resolved.startsWith('#')) refSpan.classList.add('ref-error');
      // ref 段作为原子单位应用样式：跨段统一的属性叠加到 baseStyle 之上
      const segStyle = uniformStyleOver(offset, segEnd);
      const finalStyle = segStyle ? Object.assign({}, baseStyle, segStyle) : baseStyle;
      if (applyStyleFn && finalStyle) applyStyleFn(refSpan, finalStyle);
      if (viewInstance) {
        const icon = createRefIcon(data, seg.raw, viewInstance);
        refSpan.appendChild(icon);
      }
      container.appendChild(refSpan);
    }
    offset = segEnd;
  }
}

// Create a clickable reference icon with tooltip and jump-to-source
function createRefIcon(data, refStr, viewInstance) {
  const icon = document.createElement('span');
  icon.className = 'ref-icon';
  icon.textContent = '↗';

  const ref = parseRef(refStr);
  const targetPath = getRefTargetPath(data, refStr);
  const resolved = resolveRef(data, refStr);
  const isError = resolved.startsWith('#');

  if (isError) {
    icon.classList.add('ref-icon-error');
    icon.title = '引用错误: ' + resolved;
  } else if (isSheetRef(refStr)) {
    const sr = parseSheetRef(refStr);
    const docPart = sr.docName ? (sr.docName + '.') : '';
    icon.title = '跳转到表格: ' + docPart + sr.sheetName + '!' + sr.addr;
  } else if (ref.docName) {
    icon.title = '跳转到: ' + ref.docName + '.' + (ref.nodePath || '');
  } else {
    icon.title = '跳转到: ' + (ref.nodePath || refStr.slice(1));
  }

  icon.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    // 表格引用：最高优先级（与 resolveRef 一致，sheet 先判）。docName 非空 → gotoSheetCell 内部会先打开目标 .udd
    if (isSheetRef(refStr)) {
      const sr = parseSheetRef(refStr);
      if (typeof app !== 'undefined' && app.gotoSheetCell) {
        app.gotoSheetCell(sr.sheetName, sr.addr, viewInstance, sr.docName || null);
      }
      return;
    }
    // 跨文档引用：找到对应的 .udd 文件并打开它，跳转到目标节点
    if (ref.docName && !isError) {
      if (typeof app !== 'undefined' && app.openCrossDocRef) {
        app.openCrossDocRef(ref.docName, ref.nodePath, viewInstance);
      }
      return;
    }
    if (!targetPath) {
      if (ref.docName) {
        // 引用解析失败（如未连接仓库）— 这种情况不跳转，仅提示
        toast('引用未成功解析，无法跳转：' + (resolved || ref.docName));
      } else {
        toast('找不到引用目标');
      }
      return;
    }
    // Jump to the source node in current document
    jumpToNode(targetPath, viewInstance);
  });

  return icon;
}

// Jump to a node in the current view
function jumpToNode(targetPath, viewInstance) {
  if (!targetPath || !viewInstance) return;

  // Save current position for "back" navigation
  if (typeof app !== 'undefined') {
    app._saveBackPosition(viewInstance);
  }

  // Ensure the target node is visible (unfold ancestors)
  ensureNodeVisible(app.data, targetPath);

  // Set focus to target and re-render
  viewInstance.focusPath = targetPath;
  viewInstance.focusField = 'content';
  viewInstance.focusCursorEnd = false;
  viewInstance.render(viewInstance.data);
  app.updateSidebar(targetPath);

  // Scroll into view
  requestAnimationFrame(() => {
    const el = viewInstance.el.querySelector(`[data-path="${targetPath}"][data-field="content"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight effect
      el.style.transition = 'background-color 0.3s';
      el.style.backgroundColor = 'var(--blue-100)';
      setTimeout(() => { el.style.backgroundColor = ''; }, 1500);
    }
  });
}

// Ensure all ancestors of a node are unfolded so it's visible
function ensureNodeVisible(data, targetPath) {
  const parts = targetPath.split('.');
  let current = data;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current[key] && current[key].hide) {
      current[key].hide = 0;
    }
    current = current[key];
  }
}

function refreshRefs(viewEl, data) {
  if (!viewEl) return;

  // 单 pass 缓存：同一次 refreshRefs 内，相同 refStr 只解析一次。
  // 文档里大量重复引用（同一个 =t1-1.content 在多处出现）时，把 N 次
  // parseRef + findRefNode + nodeToText 折叠成 1 次，N→1 倍速。
  const passCache = new Map();
  function resolveOnce(refStr, isFullRef_) {
    if (passCache.has(refStr)) return passCache.get(refStr);
    const sourceNode_ = isFullRef_ ? getFullRefNode(data, refStr) : null;
    const resolved = isFullRef_ && sourceNode_ ? (sourceNode_.content || '') : resolveRef(data, refStr);
    passCache.set(refStr, resolved);
    return resolved;
  }

  viewEl.querySelectorAll('[data-ref]').forEach(el => {
    const refStr = el.dataset.ref;
    let resolved = resolveOnce(refStr, isFullNodeRef(refStr));
    // 内联引用（.inline-ref）做完整清理：剥媒体 tag + 折换行；
    // 整段 =ref（无 .inline-ref 类，块级显示）仅剥媒体 tag，保留多行结构由 CSS / md 处理。
    if (typeof resolved === 'string') {
      resolved = el.classList.contains('inline-ref') ? inlineRefDisplay(resolved) : stripMediaTags(resolved);
    }
    // 保留现有 ref-icon（↗），让它始终位于文本之后（右下角）
    const existingIcon = el.querySelector('.ref-icon');
    if (existingIcon) {
      Array.from(el.childNodes).forEach(child => {
        if (child !== existingIcon) el.removeChild(child);
      });
      el.insertBefore(document.createTextNode(resolved), existingIcon);
    } else {
      el.textContent = resolved;
    }
    el.classList.toggle('ref-error', resolved.startsWith('#'));
  });
  // 全节点引用 (=t1-1.t2-1) 的宿主 body：渲染时只克隆源节点 body，没有 data-ref（那是给 content 的），
  // 单独用 data-ref-body 标记。源节点 body 改动后这里把宿主 body 文本同步过来，
  // 与内联引用 ({{=t1-1.t2-1.body}}) 享有相同的实时刷新策略。
  viewEl.querySelectorAll('[data-ref-body]').forEach(el => {
    const refStr = el.dataset.refBody;
    const sourceNode_ = isFullNodeRef(refStr) ? getFullRefNode(data, refStr) : null;
    if (!sourceNode_) return;
    const newBody = stripMediaTags(sourceNode_.body || '');
    // body 没有挂 ref-icon（renderStyledText 直接重写 innerHTML），可直接 textContent 替换
    el.textContent = newBody;
  });
  // Handle async refs（异步路径暂不复用 passCache：await 期间 DOM 可能已切换，
  // 而且多数情况下异步 ref 在文档里出现次数远少于同步 ref，重复解析的乘数效应弱）
  viewEl.querySelectorAll('[data-ref-async]').forEach(async el => {
    const refStr = el.dataset.refAsync;
    let resolved = await resolveRefAsync(data, refStr);
    if (typeof resolved === 'string') {
      resolved = el.classList.contains('inline-ref') ? inlineRefDisplay(resolved) : stripMediaTags(resolved);
    }
    const existingIcon = el.querySelector('.ref-icon');
    if (existingIcon) {
      Array.from(el.childNodes).forEach(child => {
        if (child !== existingIcon) el.removeChild(child);
      });
      el.insertBefore(document.createTextNode(resolved), existingIcon);
    } else {
      el.textContent = resolved;
    }
    el.classList.toggle('ref-error', resolved.startsWith('#'));
  });
}

function setFoldByLevel(data, maxLevel) {
  const walk = (node) => {
    for (const k of Object.keys(node)) {
      if (!isTNode(k)) continue;
      const lv = getLevel(k);
      const child = node[k];
      if (maxLevel === Infinity) child.hide = 0;
      else child.hide = lv >= maxLevel ? 1 : 0;
      walk(child);
    }
  };
  walk(data);
}
function rgbToHex(rgb) {
  if (!rgb || typeof rgb !== 'string') return '#1e293b';
  const parts = rgb.split(',').map(s => +s.trim());
  if (parts.length < 3) return '#1e293b';
  return '#' + parts.slice(0,3).map(n => Math.max(0,Math.min(255,n)).toString(16).padStart(2,'0')).join('');
}
function hexToRgb(hex) {
  const h = hex.replace('#','');
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)].join(',');
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function stripMediaTags(text) {
  if (!text) return '';
  // Remove {{...}} media tags but preserve {{=ref}} inline references
  return text.replace(/\{\{(?!=)(.*?)\}\}/g, '');
}
function extractMediaTags(text) {
  if (!text) return '';
  const tags = [];
  text.replace(/\{\{(?!=)(.*?)\}\}/g, m => { tags.push(m); return ''; });
  return tags.join('');
}
function normalizeMediaTags(text) {
  if (!text) return '';
  const tags = [];
  text.replace(/\{\{(?!=)(.*?)\}\}/g, m => { if (tags[tags.length - 1] !== m) tags.push(m); return ''; });
  return tags.join('');
}
function mergeEditableTextAndMedia(originalRaw, editedText) {
  // 用户设计：不自动填充。任何含 ref / 媒体 tag 的 content / body 都已在 resolveNodeForRender
  // 里被标记为 bodyEditable=false / contentEditable=false（hasOwnMedia / hasInlineRefs / isRef），
  // 走 ref-display + 双击源码编辑路径；普通可编辑路径只面向"无 tag 的纯文本"，不需要把媒体
  // tag 重新拼回来。直接把 editedText 原样写回 → 用户敲什么就存什么，不会出现"自动追加"。
  return editedText || '';
}
function hasMediaTag(text) {
  return text && text.indexOf('{{') !== -1 && text.indexOf('}}') !== -1;
}

function applyFmtStyle(el, style, fmt) {
  if (fmt.font && style.font) el.style.fontFamily = style.font;
  if (fmt.font_size && style.font_size) el.style.fontSize = style.font_size + 'pt';
  if (fmt.color && style.color) el.style.color = rgbToHex(String(style.color));
  el.style.fontWeight = (fmt.bold && style.bold) ? '700' : 'normal';
  if (fmt.italic && style.italic) el.style.fontStyle = 'italic';
  if (fmt.underline && style.underline) el.style.textDecoration = 'underline';
  if (fmt.strikethrough && style.strikethrough) {
    el.style.textDecoration = (el.style.textDecoration || '') + ' line-through';
  }
  if (fmt.background_color && style.background_color) el.style.backgroundColor = rgbToHex(String(style.background_color));
  if (fmt.text_align && style.text_align) el.style.textAlign = style.text_align;
  if (style.paragraph_line) el.style.lineHeight = style.paragraph_line;
}

function buildNodeStyle(data, path, level, opts = {}) {
  const { isBody = false } = opts;
  const tg = data.type_global || {};
  const style = {};
  const computedLevel = (typeof level === 'number') ? level : (path ? getLevel(path.split('.').pop()) : 0);
  const node = path ? getNodeByPath(data, path) : null;

  if (isBody) {
    for (const [k,v] of Object.entries(tg)) {
      if (k.startsWith('body.')) style[k.substring(5)] = resolveStyleBaseValue(v);
    }
    const prefix = `t${computedLevel}-*.body.`;
    for (const [k,v] of Object.entries(tg)) {
      if (k.startsWith(prefix)) style[k.substring(prefix.length)] = resolveStyleBaseValue(v);
    }
  } else {
    const wildcard = 't*-*.';
    for (const [k,v] of Object.entries(tg)) {
      if (k.startsWith(wildcard)) {
        const field = k.substring(wildcard.length);
        if (field.startsWith('body.')) continue;
        style[field] = resolveStyleBaseValue(v);
      }
    }
    const prefix = `t${computedLevel}-*.`;
    for (const [k,v] of Object.entries(tg)) {
      if (k.startsWith(prefix)) {
        const field = k.substring(prefix.length);
        if (field.startsWith('body.')) continue;
        style[field] = resolveStyleBaseValue(v);
      }
    }
  }

  if (node) {
    for (const field of STYLE_FIELDS) {
      const key = isBody ? `body.${field}` : field;
      if (node[key] !== undefined) style[field] = resolveStyleBaseValue(node[key]);
    }
  }
  return style;
}

function getSelectionOffsetsWithin(el) {
  if (!el) return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const start = getOffsetWithin(el, range.startContainer, range.startOffset);
  const end = getOffsetWithin(el, range.endContainer, range.endOffset);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function getOffsetWithin(root, node, offset) {
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(node, offset);
  return pre.toString().length;
}

// ================================================================
//  SHARED BODY BUTTON
// ================================================================
function createBodyBtn(node, path, view) {
  const hasBody = node.body !== undefined && node.body !== '';
  const btn = document.createElement('span');
  btn.className = 'body-btn';
  if (hasBody) {
    btn.textContent = node.hide_body ? '▸' : '▾';
    btn.title = node.hide_body ? '展开正文' : '折叠正文';
    btn.onclick = (e) => {
      e.stopPropagation();
      node.hide_body = node.hide_body ? 0 : 1;
      view.focusPath = path;
      view.render(view.data);
      app.markDirty();
    };
  } else {
    btn.textContent = '+';
    btn.title = '添加正文';
    btn.onclick = (e) => {
      e.stopPropagation();
      node.body = '';
      node.hide_body = 0;
      view.focusPath = path;
      view.focusField = 'body';
      view.render(view.data);
      app.markDirty();
    };
  }
  return btn;
}

function createFoldToggle(node, path, level, view, className) {
  const childKeys = getChildTKeys(node, level + 1);
  const el = document.createElement('span');
  el.className = className + (childKeys.length === 0 ? ' leaf' : '');
  el.textContent = childKeys.length === 0 ? '•' : (node.hide ? '▶' : '▼');
  el.onclick = () => {
    if (childKeys.length === 0) return;
    node.hide = node.hide ? 0 : 1;
    view.focusPath = path;
    view.render(view.data);
    app.markDirty();
  };
  return el;
}

function indentNodeData(data, path) {
  const parts = path.split('.');
  const currentKey = parts[parts.length - 1];
  const level = getLevel(currentKey);
  let parent = parts.length === 1 ? data : getNodeByPath(data, parts.slice(0,-1).join('.'));
  let prevKey;
  if (parts.length === 1) {
    const allRootKeys = getAllTKeys(parent);
    const idx = allRootKeys.indexOf(currentKey);
    if (idx <= 0) return null;
    prevKey = allRootKeys[idx - 1];
  } else {
    const siblings = getChildTKeys(parent, level);
    const idx = siblings.indexOf(currentKey);
    if (idx <= 0) return null;
    prevKey = siblings[idx - 1];
  }
  const prevNode = parent[prevKey];
  const node = parent[currentKey];
  delete parent[currentKey];
  const prevLevel = getLevel(prevKey);
  const newLevel = prevLevel + 1;
  const levelDiff = newLevel - level;
  const newSeqNum = nextSeq(prevNode, newLevel);
  const newKey = `t${newLevel}-${newSeqNum}`;
  prevNode[newKey] = levelDiff !== 0 ? relevelNode(node, levelDiff) : Object.assign({}, node);
  prevNode[newKey].content = node.content;
  prevNode[newKey].body = node.body;
  prevNode[newKey].hide = node.hide || 0;
  prevNode[newKey].hide_body = node.hide_body || 0;
  for (const k of Object.keys(node)) {
    if (!isTNode(k) && prevNode[newKey][k] === undefined) prevNode[newKey][k] = node[k];
  }
  prevNode.hide = 0;
  const prevPath = parts.length === 1 ? prevKey : parts.slice(0,-1).join('.') + '.' + prevKey;
  data._pathIndex = null;  // tree shape changed → 失效路径索引
  return prevPath + '.' + newKey;
}

function outdentNodeData(data, path) {
  const parts = path.split('.');
  const currentKey = parts[parts.length - 1];
  const level = getLevel(currentKey);
  if (parts.length === 1) {
    if (level === 0) return null;
    const node = data[currentKey];
    const newSeqNum = nextSeq(data, level - 1);
    const newKey = `t${level - 1}-${newSeqNum}`;
    const newNode = relevelNode(node, -1);
    newNode.content = node.content;
    newNode.body = node.body;
    newNode.hide = node.hide || 0;
    newNode.hide_body = node.hide_body || 0;
    for (const k of Object.keys(node)) {
      if (!isTNode(k) && newNode[k] === undefined) newNode[k] = node[k];
    }
    const entries = Object.entries(data);
    const temp = {};
    for (const [k, v] of entries) {
      if (k === currentKey) temp[newKey] = newNode;
      else temp[k] = v;
    }
    for (const k of Object.keys(data)) delete data[k];
    Object.assign(data, temp);
    data._pathIndex = null;  // tree shape changed
    return newKey;
  }
  const parentPath = parts.slice(0, -1).join('.');
  const parentParts = parentPath.split('.');
  const parentKey = parentParts[parentParts.length - 1];
  let grandParent = parentParts.length === 1 ? data : getNodeByPath(data, parentParts.slice(0,-1).join('.'));
  let parentNode = grandParent[parentKey];
  const node = parentNode[currentKey];
  delete parentNode[currentKey];
  const newLevel = level - 1;
  const newSeqNum = nextSeq(grandParent, newLevel);
  const newKey = `t${newLevel}-${newSeqNum}`;
  const newNode = relevelNode(node, -1);
  newNode.content = node.content;
  newNode.body = node.body;
  newNode.hide = node.hide || 0;
  newNode.hide_body = node.hide_body || 0;
  for (const k of Object.keys(node)) {
    if (!isTNode(k) && newNode[k] === undefined) newNode[k] = node[k];
  }
  insertAfter(grandParent, parentKey, newKey, newNode);
  data._pathIndex = null;  // tree shape changed
  return parentParts.length === 1 ? newKey : parentParts.slice(0,-1).join('.') + '.' + newKey;
}

// Move node (with children) to a new position: 'before'/'after' target, or 'child' of target
function moveNodeData(data, srcPath, dstPath, mode) {
  if (srcPath === dstPath) return null;
  // Prevent moving into own descendant
  if (dstPath.startsWith(srcPath + '.')) return null;
  const srcParts = srcPath.split('.');
  const srcKey = srcParts[srcParts.length - 1];
  const srcParent = srcParts.length === 1 ? data : getNodeByPath(data, srcParts.slice(0,-1).join('.'));
  const node = srcParent[srcKey];
  if (!node) return null;
  // Clone and remove from source
  const clone = deepClone(node);
  delete srcParent[srcKey];
  const dstParts = dstPath.split('.');
  const dstKey = dstParts[dstParts.length - 1];
  const dstParent = dstParts.length === 1 ? data : getNodeByPath(data, dstParts.slice(0,-1).join('.'));
  if (mode === 'child') {
    const target = dstParent[dstKey];
    const srcLevel = getLevel(srcKey);
    const dstLevel = getLevel(dstKey);
    const newLevel = dstLevel + 1;
    const leveled = relevelNode(clone, newLevel - srcLevel);
    leveled.content = clone.content; leveled.body = clone.body;
    leveled.hide = clone.hide || 0; leveled.hide_body = clone.hide_body || 0;
    for (const k of Object.keys(clone)) { if (!isTNode(k) && leveled[k] === undefined) leveled[k] = clone[k]; }
    const seq = nextSeq(target, newLevel);
    const newKey = `t${newLevel}-${seq}`;
    target[newKey] = leveled;
    target.hide = 0;
    data._pathIndex = null;  // tree shape changed
    return dstPath + '.' + newKey;
  }
  // before / after: same level as target
  const srcLevel = getLevel(srcKey);
  const targetLevel = getLevel(dstKey);
  const leveled = relevelNode(clone, targetLevel - srcLevel);
  leveled.content = clone.content; leveled.body = clone.body;
  leveled.hide = clone.hide || 0; leveled.hide_body = clone.hide_body || 0;
  for (const k of Object.keys(clone)) { if (!isTNode(k) && leveled[k] === undefined) leveled[k] = clone[k]; }
  const seq = nextSeq(dstParent, targetLevel);
  const newKey = `t${targetLevel}-${seq}`;
  if (mode === 'before') insertBefore(dstParent, dstKey, newKey, leveled);
  else insertAfter(dstParent, dstKey, newKey, leveled);
  data._pathIndex = null;  // tree shape changed
  return dstParts.length === 1 ? newKey : dstParts.slice(0,-1).join('.') + '.' + newKey;
}

// ================================================================
//  COLOR PALETTE DATA
// ================================================================
const PALETTE_COLORS = [
  '#000000','#434343','#666666','#999999','#b7b7b7','#cccccc','#d9d9d9','#ffffff',
  '#980000','#ff0000','#ff9900','#ffff00','#00ff00','#00ffff','#4a86e8','#0000ff',
  '#9900ff','#ff00ff','#e6b8af','#f4cccc','#fce5cd','#fff2cc','#d9ead3','#d0e0e3',
  '#c9daf8','#cfe2f3','#d9d2e9','#ead1dc','#dd7e6b','#ea9999','#f9cb9c','#ffe599',
  '#b6d7a8','#a2c4c9','#a4c2f4','#9fc5e8','#b4a7d6','#d5a6bd','#cc4125','#e06666',
  '#f6b26b','#ffd966','#93c47d','#76a5af','#6d9eeb','#6fa8dc','#8e7cc3','#c27ba0'
];
