// ================================================================
//  UDD Reference System & Shared UI Helpers
//  Content references (=t1-1, cross-doc refs), node rendering,
//  body button, fold toggle, indent/outdent, drag-move,
//  color palette data
// ================================================================

//  CONTENT REFERENCE SYSTEM
// ================================================================
function isRef(value) {
  return typeof value === 'string' && value.startsWith('=') && value.length > 1;
}

// Check if content has inline {{=ref}} patterns
function hasInlineRefs(value) {
  return typeof value === 'string' && value.includes('{{=');
}

// Parse content with {{=ref}} into segments: [{type:'text',value:...}, {type:'ref',raw:...,resolved:...}]
function resolveInlineRefs(data, text) {
  const segments = [];
  const re = /\{\{(=[^}]+)\}\}/g;
  let lastIdx = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) segments.push({ type: 'text', value: text.slice(lastIdx, m.index) });
    const refStr = m[1];
    segments.push({ type: 'ref', raw: refStr, resolved: resolveRef(data, refStr) });
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) segments.push({ type: 'text', value: text.slice(lastIdx) });
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

// Find the full path of a node key in the data tree
function findFullPath(data, nodeKey) {
  if (nodeKey.includes('.')) {
    const parts = nodeKey.split('.');
    // Find the full path of the first segment recursively
    const rootPath = _findPathRecursive(data, parts[0], '');
    if (!rootPath) return null;
    // Build and verify the full path
    const fullPath = rootPath + '.' + parts.slice(1).join('.');
    if (getNodeByPath(data, fullPath)) return fullPath;
    return null;
  }
  return _findPathRecursive(data, nodeKey, '');
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

function parseRef(refStr) {
  const raw = refStr.slice(1); // remove leading '='
  const result = { docName: null, nodePath: null, field: null, slice: null, matchExpr: null, isUddEmbed: false };

  // Extract .match(/pattern/).[index] if present
  let work = raw;
  const matchRe = /\.match\(\/(.+?)\/([gimsuy]*)\)\.\[(\d+)\]$/;
  const mm = work.match(matchRe);
  if (mm) {
    result.matchExpr = { pattern: new RegExp(mm[1], mm[2]), index: parseInt(mm[3]) };
    work = work.slice(0, mm.index);
  }

  // Extract (start,end) slice if present
  const sliceRe = /\((\d+),(\d+)\)$/;
  const sm = work.match(sliceRe);
  if (sm) {
    result.slice = [parseInt(sm[1]), parseInt(sm[2])];
    work = work.slice(0, sm.index);
  }

  // Handle udd.ref-docs. prefix (embedded cross-doc ref)
  const UDD_PREFIX = 'udd.ref-docs.';
  if (work.startsWith(UDD_PREFIX)) {
    result.isUddEmbed = true;
    work = work.slice(UDD_PREFIX.length);
  }

  // Split remaining by '.'
  const parts = work.split('.');
  const tNodeRe = /^t\d+-\d+$/;

  // Determine docName: if first part is NOT a tNode key, it's a doc name
  let idx = 0;
  if (parts.length >= 2 && !tNodeRe.test(parts[0])) {
    result.docName = parts[0];
    idx = 1;
  }

  // Collect consecutive tNode segments as the node path
  const pathParts = [];
  while (idx < parts.length && tNodeRe.test(parts[idx])) {
    pathParts.push(parts[idx]);
    idx++;
  }
  if (pathParts.length > 0) {
    result.nodePath = pathParts.join('.');
  }

  // Remaining part (if any) is the field name
  if (idx < parts.length) {
    result.field = parts[idx];
  }

  return result;
}

function nodeToText(node) {
  if (!node || typeof node !== 'object') return String(node ?? '');
  let text = node.content || '';
  if (node.body) text += '\n' + node.body;
  return text;
}

function resolveRef(data, refStr) {
  if (!isRef(refStr)) return refStr;

  // Sheet reference: =Sheet1.B2 format — detect by splitting on '.'
  const dotIdx = refStr.indexOf('.');
  if (dotIdx > 1) {
    const maybeSheet = refStr.slice(1, dotIdx);
    const maybeAddr = refStr.slice(dotIdx + 1);
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(maybeSheet) && /^[A-Z]{1,3}\d{1,7}$/.test(maybeAddr) && !/^t\d+$/.test(maybeSheet)) {
      if (typeof app !== 'undefined' && app.sheetView) {
        return String(app.sheetView.getCellValue(maybeSheet, maybeAddr) ?? '');
      }
      return '';
    }
  }

  const ref = parseRef(refStr);
  if (!ref.nodePath) return '#REF!';

  // udd.ref-docs. embedded refs: resolve from session embeddedRefDocs or _refDocCache
  if (ref.isUddEmbed && ref.docName) {
    const useEmbed = !app || app.contentSource !== 'repo';
    const sessionRefDocs = app && app._activeSession && app._activeSession.embeddedRefDocs;
    const embedDoc = useEmbed && sessionRefDocs && sessionRefDocs[ref.docName];
    const cacheDoc = _refDocCache[ref.docName];
    const srcData = embedDoc || cacheDoc;
    if (!srcData) return '#REF!';
    const localRef = '=' + ref.nodePath + (ref.field ? '.' + ref.field : '');
    return resolveRef(srcData, localRef);
  }

  // Cross-file refs need async — return placeholder
  if (ref.docName) return '#LOADING...';

  // Find the node — could be a root key or nested path
  const node = findRefNode(data, ref.nodePath);
  if (!node) return '#REF!';

  // Get value
  let value;
  if (ref.field) {
    value = typeof node === 'object' ? (node[ref.field] ?? '') : '';
  } else {
    value = nodeToText(node);
  }
  value = String(value);

  // Apply match expression
  if (ref.matchExpr) {
    const m = value.match(ref.matchExpr.pattern);
    if (m && m[ref.matchExpr.index] !== undefined) {
      value = m[ref.matchExpr.index];
    } else {
      return '#MATCH!';
    }
  }

  // Apply slice
  if (ref.slice) {
    value = value.slice(ref.slice[0], ref.slice[1]);
  }

  return value;
}

function findRefNode(data, nodePath) {
  if (!nodePath) return null;
  // Try direct path from root first (e.g. t0-1.t1-1.t2-1)
  if (nodePath.includes('.')) {
    const segments = nodePath.split('.');
    let current = data;
    let ok = true;
    for (const seg of segments) {
      if (!current || typeof current !== 'object' || !current[seg]) { ok = false; break; }
      current = current[seg];
    }
    if (ok) return current;
    // Direct path failed — search for the first segment recursively, then walk the rest
    const rootKey = segments[0];
    const found = findNodeRecursive(data, rootKey);
    if (!found) return null;
    current = found;
    for (let i = 1; i < segments.length; i++) {
      if (!current || typeof current !== 'object' || !current[segments[i]]) return null;
      current = current[segments[i]];
    }
    return current;
  }
  // Single segment: try direct key first, then recursive search
  if (data[nodePath]) return data[nodePath];
  return findNodeRecursive(data, nodePath);
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

function isSheetRef(refStr) {
  if (!isRef(refStr)) return false;
  const dotIdx = refStr.indexOf('.');
  if (dotIdx <= 1) return false;
  const maybeSheet = refStr.slice(1, dotIdx);
  const maybeAddr = refStr.slice(dotIdx + 1);
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(maybeSheet) && /^[A-Z]{1,3}\d{1,7}$/.test(maybeAddr) && !/^t\d+$/.test(maybeSheet);
}

async function resolveRefAsync(data, refStr) {
  if (!isRef(refStr)) return refStr;
  if (isSheetRef(refStr)) return resolveRef(data, refStr);
  const ref = parseRef(refStr);
  if (!ref.nodePath) return '#REF!';

  if (!ref.docName) return resolveRef(data, refStr);

  // udd.ref-docs. embedded refs: resolve from session embeddedRefDocs (no async needed)
  if (ref.isUddEmbed) {
    const useEmbed = !app || app.contentSource !== 'repo';
    const sessionRefDocs = app && app._activeSession && app._activeSession.embeddedRefDocs;
    const embedDoc = useEmbed && sessionRefDocs && sessionRefDocs[ref.docName];
    const cacheDoc = _refDocCache[ref.docName];
    const srcData = embedDoc || cacheDoc;
    if (!srcData) return '#REF!';
    const localRef = '=' + ref.nodePath + (ref.field ? '.' + ref.field : '');
    return resolveRef(srcData, localRef);
  }

  // Cross-file: load from cache, IndexedDB, or local server
  let docData = _refDocCache[ref.docName];
  if (!docData) {
    // Try IndexedDB first
    try {
      const saved = await dbLoad(ref.docName);
      if (saved && saved.data) {
        docData = saved.data;
        _refDocCache[ref.docName] = docData;
      }
    } catch (e) { /* skip */ }

    // If not in IndexedDB, try loading from local server
    if (!docData) {
      try {
        docData = await _loadDocFromServer(ref.docName);
        if (docData) _refDocCache[ref.docName] = docData;
      } catch (e) { /* skip */ }
    }

    if (!docData) return '#DOC!';
  }

  // Rebuild refStr without docName for local resolution
  let localRef = '=' + ref.nodePath;
  if (ref.field) localRef += '.' + ref.field;
  if (ref.matchExpr) {
    localRef += '.match(/' + ref.matchExpr.pattern.source + '/' +
      ref.matchExpr.pattern.flags + ').[' + ref.matchExpr.index + ']';
  }
  if (ref.slice) localRef += '(' + ref.slice[0] + ',' + ref.slice[1] + ')';

  return resolveRef(docData, localRef);
}

// Try to load a document from the local server by name or path
async function _loadDocFromServer(docName) {
  // Determine server URL from app instance or localStorage
  const serverUrl = (typeof app !== 'undefined' && app.repoServerUrl) || localStorage.getItem('udd_server_url') || '';
  if (!serverUrl) return null;
  const repoDir = (typeof app !== 'undefined' && app.repoDir) || localStorage.getItem('udd_repo_dir') || '';

  // Try several path patterns
  const candidates = [];
  // If docName looks like an absolute path (D:\...), use it directly
  if (/^[A-Za-z]:[\\/]/.test(docName)) {
    candidates.push(docName);
    if (!docName.endsWith('.udd')) candidates.push(docName + '.udd');
  } else {
    // Try as filename in repo dir
    if (repoDir) {
      candidates.push(repoDir + '/' + docName + '.udd');
      candidates.push(repoDir + '\\' + docName + '.udd');
      candidates.push(repoDir + '/' + docName + '.json');
    }
  }

  for (const filePath of candidates) {
    try {
      const resp = await fetch(serverUrl + '/api/readfile?path=' + encodeURIComponent(filePath), { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) continue;
      if (filePath.endsWith('.json')) {
        const text = await resp.text();
        return JSON.parse(text);
      } else {
        const blob = await resp.blob();
        return await parseUDDBlob(blob);
      }
    } catch (e) { continue; }
  }
  return null;
}

function getDisplayValue(data, node, field) {
  const raw = node[field];
  if (!isRef(raw)) return raw || '';
  return resolveRef(data, raw);
}

// ================================================================
//  UNIFIED NODE RENDER DESCRIPTOR
//  Resolves what a node should display, separating content from rendering.
//  Content fields (from source when ref): content, body, children
//  Render fields (always owned by node itself): hide, hide_body, styles
// ================================================================
function resolveNodeForRender(data, node, path, level) {
  const raw = node.content || '';
  const _renderOn = typeof app === 'undefined' || app.renderMode !== false;
  const hasInline = _renderOn && hasInlineRefs(raw);
  const isContentRef = _renderOn && !hasInline && isRef(raw);
  const fullRef = _renderOn && isFullNodeRef(raw);
  const sourceNode = fullRef ? getFullRefNode(data, raw) : null;

  const desc = {
    displayContent: '',
    displayBody: '',
    hasBody: false,
    sourceChildren: null,
    sourceNode: sourceNode,
    isRef: isContentRef,
    isFullRef: fullRef,
    refStr: isContentRef ? raw : null,
    hasInlineRefs: hasInline,
    inlineSegments: null,
    contentEditable: !isContentRef && !hasInline,
    bodyEditable: true,
    hide: node.hide || 0,
    hide_body: node.hide_body || 0,
    renderOn: _renderOn,   // false = show raw text as-is
  };

  if (hasInline) {
    // Mixed content: text + {{=ref}} inline references
    desc.inlineSegments = resolveInlineRefs(data, raw);
    // Build plain display text for search/export
    desc.displayContent = desc.inlineSegments.map(s => s.type === 'ref' ? s.resolved : s.value).join('');
    desc.displayBody = node.body || '';
    desc.hasBody = !!(node.body);
    const rawBody = node.body || '';
    if (hasInlineRefs(rawBody)) {
      desc.bodyInlineSegments = resolveInlineRefs(data, rawBody);
      desc.displayBody = desc.bodyInlineSegments.map(s => s.type === 'ref' ? s.resolved : s.value).join('');
      desc.bodyEditable = false;
    } else if (isRef(rawBody)) {
      desc.bodyEditable = false;
      desc.displayBody = resolveRef(data, rawBody);
    }
  } else if (fullRef && sourceNode) {
    desc.displayContent = sourceNode.content || '';
    desc.displayBody = sourceNode.body || '';
    desc.hasBody = !!(sourceNode.body);
    desc.bodyEditable = false;
    const srcChildKeys = getAllTKeys(sourceNode);
    if (srcChildKeys.length > 0) {
      desc.sourceChildren = srcChildKeys.map(k => ({ key: k, node: sourceNode[k], level: getLevel(k) }));
    }
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
    const rawBody = node.body || '';
    if (isRef(rawBody)) {
      desc.bodyEditable = false;
      desc.displayBody = resolveRef(data, rawBody);
    }
  } else {
    desc.displayContent = raw;
    desc.displayBody = node.body || '';
    desc.hasBody = !!(node.body);
  }

  return desc;
}

// Render inline segments (text + {{=ref}}) into a container element
function renderInlineSegments(container, segments, data, viewInstance, applyStyleFn, baseStyle) {
  container.innerHTML = '';
  for (const seg of segments) {
    if (seg.type === 'text') {
      const span = document.createElement('span');
      span.textContent = seg.value;
      if (applyStyleFn && baseStyle) applyStyleFn(span, baseStyle);
      container.appendChild(span);
    } else {
      const refSpan = document.createElement('span');
      refSpan.className = 'inline-ref';
      refSpan.dataset.ref = seg.raw;
      refSpan.title = seg.raw;
      // Check if cross-doc async needed
      const ref = parseRef(seg.raw);
      if (ref.docName && !isSheetRef(seg.raw)) {
        refSpan.dataset.refAsync = seg.raw;
      }
      refSpan.textContent = seg.resolved;
      if (seg.resolved.startsWith('#')) refSpan.classList.add('ref-error');
      if (viewInstance) {
        const icon = createRefIcon(data, seg.raw, viewInstance);
        refSpan.appendChild(icon);
      }
      container.appendChild(refSpan);
    }
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
  } else if (ref.docName) {
    icon.title = '跳转到: ' + ref.docName + '.' + (ref.nodePath || '');
  } else {
    icon.title = '跳转到: ' + (ref.nodePath || refStr.slice(1));
  }

  icon.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!targetPath) {
      if (ref.docName) {
        toast('跨文档跳转暂不支持');
      } else {
        toast('找不到引用目标');
      }
      return;
    }
    // Jump to the source node
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
  viewEl.querySelectorAll('[data-ref]').forEach(el => {
    const refStr = el.dataset.ref;
    const isFullRef_ = isFullNodeRef(refStr);
    const sourceNode_ = isFullRef_ ? getFullRefNode(data, refStr) : null;
    const resolved = isFullRef_ && sourceNode_ ? (sourceNode_.content || '') : resolveRef(data, refStr);
    // Preserve existing ref-icon if present
    const existingIcon = el.querySelector('.ref-icon');
    if (existingIcon) {
      // Remove all text nodes and non-icon children, keep icon
      Array.from(el.childNodes).forEach(child => {
        if (child !== existingIcon) el.removeChild(child);
      });
      el.appendChild(document.createTextNode(resolved));
    } else {
      el.textContent = resolved;
    }
    el.classList.toggle('ref-error', resolved.startsWith('#'));
  });
  // Handle async refs
  viewEl.querySelectorAll('[data-ref-async]').forEach(async el => {
    const refStr = el.dataset.refAsync;
    const resolved = await resolveRefAsync(data, refStr);
    const existingIcon = el.querySelector('.ref-icon');
    if (existingIcon) {
      Array.from(el.childNodes).forEach(child => {
        if (child !== existingIcon) el.removeChild(child);
      });
      el.appendChild(document.createTextNode(resolved));
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
  const media = normalizeMediaTags(originalRaw);
  if (!media) return editedText || '';
  let cleanText = editedText || '';
  media.replace(/\{\{(?!=)(.*?)\}\}/g, m => { cleanText = cleanText.split(m).join(''); return ''; });
  return cleanText + media;
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
  if (style.paragraph_first_indent) el.style.textIndent = style.paragraph_first_indent + 'em';
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
