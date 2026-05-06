// ================================================================
//  UDD Media Rendering
//  Media tag parsing, image/video/audio rendering, lightbox,
//  resize handles, property editor popups
// ================================================================
const MEDIA_RE = /\{\{(.*?)\}\}/g;

function parseMediaTag(tagContent) {
  try { return JSON.parse('{' + tagContent + '}'); }
  catch (e) { return null; }
}

// Inline table: {{Sheet1.A1:C4}} 本档；{{路径/文件名.udd.Sheet1.A1:C4}} 跨档
function parseTableRef(tagContent) {
  // Match: prefix.A1:C4
  const m = tagContent.match(/^(.+)\.([A-Z]{1,3}\d+):([A-Z]{1,3}\d+)$/);
  if (!m) return null;
  const prefix = m[1], startAddr = m[2], endAddr = m[3];

  // 新语法：检测 ".udd." 段作为 docName 边界
  let docName = null, sheetName;
  const uddMark = '.udd.';
  const uddPos = prefix.indexOf(uddMark);
  if (uddPos >= 0) {
    docName = prefix.slice(0, uddPos) + '.udd';
    sheetName = prefix.slice(uddPos + uddMark.length);
  } else {
    // 旧语法：最后一个 dot 之前是 docName，之后是 sheetName
    const dot = prefix.lastIndexOf('.');
    if (dot > 0) {
      docName = prefix.substring(0, dot);
      sheetName = prefix.substring(dot + 1);
    } else {
      sheetName = prefix;
    }
  }
  return { docName, sheetName, startAddr, endAddr };
}

function renderInlineTable(container, ref) {
  const el = buildInlineTable(ref);
  if (el) container.appendChild(el);
}

// 构造内联表格（或"表格未加载"占位符）DOM，返回顶层节点，不主动插入 container。
// 让 renderTextWithMedia 能把它包进 alignBox/wrapper 里（用于应用 width/align/caption/border 等属性）。
function buildInlineTable(ref) {
  const table = document.createElement('table');
  table.className = 'inline-table';
  // Get cell data from sheetView workbook
  let ws = null;
  if (typeof app !== 'undefined' && app.sheetView && app.sheetView.workbook) {
    ws = app.sheetView.workbook.Sheets[ref.sheetName];
  }
  if (!ws) {
    // Workbook not yet loaded — show placeholder and trigger sheet tab init if possible
    const placeholder = document.createElement('span');
    placeholder.className = 'ref-error';
    placeholder.style.cursor = 'pointer';
    placeholder.title = '点击加载表格数据';
    placeholder.textContent = '表格未加载 (' + ref.sheetName + ')';
    placeholder.onclick = () => {
      if (typeof app !== 'undefined') {
        app.switchView('sheet');
        setTimeout(() => app.switchView(app.currentView === 'sheet' ? 'outline' : app.currentView), 100);
      }
    };
    return placeholder;
  }
  const startR = parseInt(ref.startAddr.match(/\d+/)[0]) - 1;
  const startC = colIndex(ref.startAddr.match(/^[A-Z]+/)[0]);
  const endR = parseInt(ref.endAddr.match(/\d+/)[0]) - 1;
  const endC = colIndex(ref.endAddr.match(/^[A-Z]+/)[0]);

  for (let r = startR; r <= endR; r++) {
    const tr = document.createElement('tr');
    for (let c = startC; c <= endC; c++) {
      const td = document.createElement(r === startR ? 'th' : 'td');
      const addr = colName(c) + (r + 1);
      const refKey = ref.sheetName + '!' + addr;
      const sheetRefs = (typeof app !== 'undefined' && app.data && app.data._sheetRefs) ? app.data._sheetRefs : {};
      if (sheetRefs[refKey] && typeof resolveRef === 'function') {
        td.textContent = resolveRef(app.data, sheetRefs[refKey]);
        if (app.renderMode && typeof applyMdHtml === 'function') applyMdHtml(td, app, {inline:true});
      } else {
        const cell = ws[addr];
        td.textContent = cell ? (cell.w || (cell.v !== undefined ? String(cell.v) : '')) : '';
        if (app.renderMode && typeof applyMdHtml === 'function') applyMdHtml(td, app, {inline:true});
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  return table;
}

function colIndex(name) {
  let idx = 0;
  for (let i = 0; i < name.length; i++) idx = idx * 26 + (name.charCodeAt(i) - 64);
  return idx - 1;
}
function colName(c) {
  let name = '';
  c++;
  while (c > 0) { c--; name = String.fromCharCode(65 + (c % 26)) + name; c = Math.floor(c / 26); }
  return name;
}

function resolveMediaSrc(src) {
  if (typeof app !== 'undefined' && app.resolveMediaSrc) return app.resolveMediaSrc(src);
  return src;
}

// ================================================================
// 统一媒体属性键集：image / video / audio / table 共用一套无前缀键。
// 历史数据曾用 image.width / video.caption 等 type-prefixed 键；
// 读取时 _normalizeMediaMeta 折回无前缀，写入始终只用无前缀。
// 部分属性对某些类型视觉无效（如 audio 的 angle、table 的 ratio），
// 但统一命名让渲染/编辑器/resize 逻辑更简单。
// ================================================================
const MEDIA_PROP_KEYS = ['width','height','align','angle','caption','border','opacity','ratio','autoplay','loop','poster'];

function _normalizeMediaMeta(meta, type) {
  if (!meta) return {};
  const out = Object.assign({}, meta);
  const prefix = type + '.';
  for (const k of MEDIA_PROP_KEYS) {
    if (out[k] === undefined && out[prefix + k] !== undefined) {
      out[k] = out[prefix + k];
    }
  }
  return out;
}

// 把归一化后的 meta 应用到 wrapper 和 mediaEl 上。
// 这是四种类型共享的唯一"应用属性"入口。
function _applyMediaProps(wrapper, mediaEl, meta, type) {
  // width
  if (meta.width) wrapper.style.width = meta.width;
  // opacity
  if (meta.opacity !== undefined && meta.opacity !== '') {
    const op = parseFloat(meta.opacity);
    if (!isNaN(op)) wrapper.style.opacity = op;
  }
  // angle → wrapper 整体旋转
  if (meta.angle !== undefined && meta.angle !== '' && meta.angle !== 0 && meta.angle !== '0') {
    const a = parseFloat(meta.angle);
    if (!isNaN(a) && a !== 0) wrapper.style.transform = `rotate(${a}deg)`;
  }
  // border：
  //   image/video/audio → wrapper 外框
  //   table → 控制 .inline-table 单元格边框（默认 ON；0 加 .no-border 去掉）
  if (type === 'table') {
    if (meta.border === 0 || meta.border === '0') {
      const t = wrapper.querySelector('.inline-table');
      if (t) t.classList.add('no-border');
    }
  } else {
    if (meta.border) wrapper.classList.add('has-border');
  }
  // ratio：image/video 按自然尺寸 × ratio 改 aspect-ratio
  if (meta.ratio !== undefined && meta.ratio !== '' && meta.ratio !== 1 && meta.ratio !== '1') {
    const r = parseFloat(meta.ratio);
    if (!isNaN(r) && r > 0 && r !== 1) {
      _applyRatioWhenReady(mediaEl, wrapper, r);
    }
  }
  // 显式 height（老数据可能写，配合非 % 宽度生效）
  if (meta.height && meta.width && typeof meta.width === 'string' && !meta.width.endsWith('%')) {
    if (mediaEl && (mediaEl.tagName === 'IMG' || mediaEl.tagName === 'VIDEO')) {
      mediaEl.style.height = meta.height;
    }
  }
}

// ratio 统一处理——所有四种类型都支持，只是"自然高度"的来源不同：
//   image  → natural_w / natural_h（load 后已知），aspect-ratio 决定 wrapper 高度
//   video  → video_w / video_h（loadedmetadata 后已知），同上
//   audio  → 用浏览器原生控件条高度约 40px 作"自然高"，直接设 element.style.height = 40×ratio
//   table  → 首次渲染后读 offsetHeight 作"自然高"，设 table.style.height = naturalH×ratio
// 对 audio / table，还要解锁 min-height（当 ratio<1 希望压扁时不被 CSS 默认值挡住）。
function _applyRatioWhenReady(mediaEl, wrapper, ratio) {
  if (!mediaEl) return;
  const setAspect = (nw, nh) => {
    if (!nw || !nh) return;
    wrapper.style.aspectRatio = `${nw} / ${nh * ratio}`;
    if (mediaEl.tagName === 'IMG' || mediaEl.tagName === 'VIDEO') {
      mediaEl.style.height = '100%';
      mediaEl.style.objectFit = 'fill';
    }
  };
  if (mediaEl.tagName === 'IMG') {
    if (mediaEl.complete && mediaEl.naturalWidth) setAspect(mediaEl.naturalWidth, mediaEl.naturalHeight);
    else mediaEl.addEventListener('load', () => setAspect(mediaEl.naturalWidth, mediaEl.naturalHeight), { once: true });
  } else if (mediaEl.tagName === 'VIDEO') {
    if (mediaEl.videoWidth) setAspect(mediaEl.videoWidth, mediaEl.videoHeight);
    else mediaEl.addEventListener('loadedmetadata', () => setAspect(mediaEl.videoWidth, mediaEl.videoHeight), { once: true });
  } else if (mediaEl.tagName === 'AUDIO') {
    // Chrome 的 <audio controls> 原生高度 ~40px，ratio 线性缩放。
    // ratio<1 时可能低于 .media-audio-wrap 的 min-height，同步放开。
    const naturalH = 40;
    const targetH = naturalH * ratio;
    mediaEl.style.height = targetH + 'px';
    wrapper.style.minHeight = '0';
  } else if (mediaEl.tagName === 'TABLE') {
    // 表格自然高度 = 首次渲染后的 offsetHeight；RAF 确保 DOM 已插入并布局好。
    requestAnimationFrame(() => {
      const naturalH = mediaEl.offsetHeight;
      if (naturalH > 0) mediaEl.style.height = (naturalH * ratio) + 'px';
    });
  }
}

// 统一给所有类型的 wrapper 加右下角 ▦ 拖宽手柄。
function _addResizeHandle(wrapper, mediaEl, mediaInfo, item) {
  if (!mediaInfo || !item || !item.meta) return;
  const handle = document.createElement('div');
  handle.className = 'media-resize-handle';
  handle.onmousedown = (e) => startMediaResize(e, mediaEl, wrapper, mediaInfo, item);
  wrapper.appendChild(handle);
}

// ================================================================
// 统一的媒体渲染入口:
// 1) 先用公共 collector 深入展开所有 =ref / {{=ref}}，拿到 mediaItems 列表
// 2) 按顺序渲染为 DOM；image/video/audio/table 只在"元素构造"那一步有差别，
//    其它（wrapper / 属性应用 / resize 手柄 / 按钮 / caption）全部共用。
// ================================================================
function renderTextWithMedia(text, container, mediaInfo, opts) {
  if (!text) return;
  const noAlign = opts && opts.suppressAlign;
  const data = (typeof app !== 'undefined' && app.data) ? app.data : null;
  const viewInstance = mediaInfo && mediaInfo.view;
  const items = (typeof collectMediaItemsFromText === 'function')
    ? collectMediaItemsFromText(data, text)
    : _legacyCollect(text);

  for (const it of items) {
    const meta = _normalizeMediaMeta(it.meta, it.type);
    const isRefSourced = !!it.srcRefStr;

    const alignBox = document.createElement('div');
    if (!noAlign && meta.align) alignBox.style.textAlign = meta.align;

    const wrapper = document.createElement('div');
    wrapper.className = 'media-wrap';

    let mediaEl = null;
    if (it.type === 'image') {
      mediaEl = document.createElement('img');
      _bindMediaSrcWithFallback(mediaEl, it.src);
      mediaEl.className = 'media-img';
      mediaEl.style.width = '100%';
      mediaEl.draggable = false;
      mediaEl.ondblclick = (e) => { e.stopPropagation(); showLightbox(mediaEl.src); };
      // 直接 tag 的图片支持单击进编辑器；ref-sourced 图片只给 ↗
      if (!isRefSourced) {
        mediaEl.onclick = (e) => { e.stopPropagation(); showMediaEditor(wrapper, mediaInfo, it); };
      }
    } else if (it.type === 'video') {
      wrapper.classList.add('media-video-wrap');
      mediaEl = document.createElement('video');
      _bindMediaSrcWithFallback(mediaEl, it.src);
      mediaEl.className = 'media-video';
      mediaEl.controls = true;
      mediaEl.style.width = '100%';
      if (meta.autoplay) mediaEl.autoplay = true;
      if (meta.loop) mediaEl.loop = true;
      if (meta.poster) mediaEl.poster = resolveMediaSrc(meta.poster);
      // 不在 <video> 上挂 click/dblclick：原生控件会消化点击，
      // 编辑入口走 wrapper 上的 ✎/↗，保证进度条 seek 不被打断。
    } else if (it.type === 'audio') {
      wrapper.classList.add('media-audio-wrap');
      mediaEl = document.createElement('audio');
      _bindMediaSrcWithFallback(mediaEl, it.src);
      mediaEl.controls = true;
      mediaEl.className = 'media-audio';
      mediaEl.style.width = '100%';
      if (meta.autoplay) mediaEl.autoplay = true;
      if (meta.loop) mediaEl.loop = true;
    } else if (it.type === 'table') {
      wrapper.classList.add('media-table-wrap');
      mediaEl = buildInlineTable(it.tableRef);
    } else {
      continue;
    }

    if (!mediaEl) continue;
    wrapper.appendChild(mediaEl);

    // 统一应用属性（width / align 在 wrapper/alignBox 已处理，这里还处理剩下的）
    _applyMediaProps(wrapper, mediaEl, meta, it.type);

    if (it.type === 'table' && mediaEl.tagName === 'TABLE' && meta.width) {
      mediaEl.style.width = '100%';
    }

    // 按钮：ref-sourced 给 ↗，否则 ✎
    if (isRefSourced) _addMediaRefBtn(wrapper, it.srcRefStr, viewInstance);
    else _addMediaEditBtn(wrapper, mediaInfo, it);
    // 表格无论是否 ref-sourced，都额外提供一个跳转到源表的 ↗ 按钮（与 ✎ 共存）
    if (it.type === 'table' && !isRefSourced && it.tableRef) {
      _addTableJumpBtn(wrapper, it.tableRef, viewInstance);
    }

    // 所有类型统一提供拖宽手柄
    _addResizeHandle(wrapper, mediaEl, mediaInfo, it);

    if (meta.caption) {
      const cap = document.createElement('div');
      cap.className = 'media-caption';
      cap.textContent = meta.caption;
      if (app.renderMode && typeof applyMdHtml === 'function') applyMdHtml(cap, app, {inline:true});
      wrapper.appendChild(cap);
    }

    alignBox.appendChild(wrapper);
    container.appendChild(alignBox);
  }
}

// 在媒体 wrapper 右上角加一个浮动的 ✎ 编辑按钮。
// 为什么不用 <audio>/<video> 自身的 click 事件？
//   原生控件（play / progress / volume）位于浏览器实现的 shadow DOM 内，
//   click 在该层被消化，事件不一定冒泡到我们绑的 onclick；
//   即便冒泡到了，我们的 handler 一旦弹出编辑器，又会反过来打断"点进度条跳播放"的原生行为。
//   做成一个独立浮动按钮，原生控件完全不受影响，编辑入口也始终可用。
// item 携带 collector 给的 type / meta / rawInner，editor 直接用，不再回头扫宿主文本。
function _addMediaEditBtn(wrapper, mediaInfo, item) {
  if (!mediaInfo) return; // 没有 path/field 信息（如思维导图气泡里）就不挂按钮
  // 老数据（例如裸括号 {{Sheet1.A1:C4}}）item.meta 为 null，编辑器用不了 →
  // 直接不挂 ✎，避免"有按钮但点了没反应"的误导。用户用新 ☐ 插入即可拿到属性。
  if (!item || !item.meta || !item.rawInner) return;
  if (!wrapper.style.position) wrapper.style.position = 'relative';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'media-edit-btn';
  btn.title = '编辑媒体属性';
  btn.textContent = '✎';
  btn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); showMediaEditor(wrapper, mediaInfo, item); };
  wrapper.appendChild(btn);
}

// ref-sourced 媒体的跳转按钮：复用 createRefIcon（统一三种跳转：本档 / 跨档 / 表格）。
// 加 .media-ref-btn 类做绝对定位，外观与 ✎ 按钮同位（hover 可见）。
function _addMediaRefBtn(wrapper, refStr, viewInstance) {
  if (!refStr || !viewInstance) return;
  if (typeof createRefIcon !== 'function' || typeof app === 'undefined') return;
  if (!wrapper.style.position) wrapper.style.position = 'relative';
  const icon = createRefIcon(app.data, refStr, viewInstance);
  icon.classList.add('media-ref-btn');
  // 阻止外层捕获（image.onclick / dblclick 之类）
  icon.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  wrapper.appendChild(icon);
}

// 内联表格（非 ref-sourced）的跳转按钮：直接跳到对应工作表的起始单元格。
// 直接用 ↗ 图标 + .ref-icon + .media-ref-btn（与 _addMediaRefBtn 视觉一致），
// 但点击逻辑是 app.gotoSheetCell(sheetName, startAddr, view, docName)。
// docName 为空 → 本档跳转；非空 → 先打开目标 .udd 再跳转（gotoSheetCell 内部处理）。
function _addTableJumpBtn(wrapper, tableRef, viewInstance) {
  if (!tableRef || !tableRef.sheetName) return;
  if (typeof app === 'undefined' || !app.gotoSheetCell) return;
  if (!wrapper.style.position) wrapper.style.position = 'relative';
  const icon = document.createElement('span');
  icon.className = 'ref-icon media-ref-btn';
  icon.textContent = '↗';
  const docPart = tableRef.docName ? (tableRef.docName + '.') : '';
  icon.title = '跳转到表格: ' + docPart + tableRef.sheetName + '!' + tableRef.startAddr + ':' + tableRef.endAddr;
  icon.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  icon.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    app.gotoSheetCell(tableRef.sheetName, tableRef.startAddr, viewInstance, tableRef.docName || null);
  });
  wrapper.appendChild(icon);
}

// 回退：仅在 collector 不可用时用；保持和旧行为兼容（不深入 ref）。
// 同样产出 rawInner / srcRefStr，让 ✎ / ↗ 按钮在 fallback 路径下也有正确数据。
// 表格只认 JSON 形 {{"table":"..."}}；裸括号 {{Sheet1.A1:C4}} 已不支持。
function _legacyCollect(text) {
  const out = [];
  const parts = text.split(MEDIA_RE);
  for (let i = 1; i < parts.length; i += 2) {
    const inner = parts[i];
    const media = parseMediaTag(inner);
    if (!media) continue;
    if (media.image) out.push({ type: 'image', src: media.image, meta: media, rawInner: inner, srcRefStr: null });
    else if (media.video) out.push({ type: 'video', src: media.video, meta: media, rawInner: inner, srcRefStr: null });
    else if (media.audio) out.push({ type: 'audio', src: media.audio, meta: media, rawInner: inner, srcRefStr: null });
    else if (media.table) {
      const tr = parseTableRef(media.table);
      if (tr) out.push({ type: 'table', tableRef: tr, meta: media, rawInner: inner, srcRefStr: null });
    }
  }
  return out;
}

// 为 <img> / <video> / <audio> 绑定 src，并在失败时按候选列表顺序回退。
// 读取优先级（固定，和是否开 server 无关）：
//   1) 嵌入 blob（udd.media/）
//   2) 仓库服务器（需 server + filePath）
//   3) 本机绝对路径代理（需 server）
//   4) 原样
function _bindMediaSrcWithFallback(el, src) {
  const candidates = (typeof app !== 'undefined' && app.resolveMediaSrcCandidates)
    ? app.resolveMediaSrcCandidates(src)
    : [resolveMediaSrc(src)];
  if (!candidates || candidates.length === 0) { el.src = ''; return; }
  let idx = 0;
  const tryNext = () => {
    if (idx >= candidates.length) return;
    el.src = candidates[idx++];
  };
  el.onerror = () => { if (idx < candidates.length) tryNext(); };
  tryNext();
}
// Drag-to-resize
// 统一改写 obj.width（无前缀），同时清理老 type-prefixed 键 (image.width 等)。
// 失败（找不到 origTag / JSON 解析异常）就回退到老的"全字段宽度替换"路径。
function startMediaResize(e, el, wrapper, mediaInfo, item) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startW = wrapper.offsetWidth;
  const alignBox = wrapper.parentElement;
  const parentW = alignBox && alignBox.parentElement ? alignBox.parentElement.offsetWidth : startW;
  wrapper.classList.add('resizing');
  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const newW = Math.max(50, startW + dx);
    wrapper.style.width = newW + 'px';
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    wrapper.classList.remove('resizing');
    if (!mediaInfo || !mediaInfo.path || !mediaInfo.field) return;
    const node = getNodeByPath(app.data, mediaInfo.path);
    if (!node) return;
    const text = node[mediaInfo.field] || '';
    const finalW = wrapper.offsetWidth;
    const pct = Math.round(finalW / parentW * 100);
    const widthStr = pct + '%';
    if (item && item.rawInner) {
      const origTag = '{{' + item.rawInner + '}}';
      if (text.indexOf(origTag) >= 0) {
        try {
          const obj = JSON.parse('{' + item.rawInner + '}');
          obj.width = widthStr;
          // 清理老 type-prefixed 键
          const prefix = item.type + '.';
          for (const k of MEDIA_PROP_KEYS) delete obj[prefix + k];
          // 显式高度被宽度覆盖（百分比时高度由 ratio 决定）
          delete obj.height;
          const newInner = JSON.stringify(obj).slice(1, -1);
          node[mediaInfo.field] = text.replace(origTag, '{{' + newInner + '}}');
          item.rawInner = newInner;
          item.meta = obj;
          app.markDirty();
          return;
        } catch (ex) { /* 落到回退路径 */ }
      }
    }
    // 回退：扫描所有 {{...}} 并按旧规则替换 width（兼容 collector 不可用时）
    const updated = text.replace(MEDIA_RE, (match, content) => {
      try {
        const obj = JSON.parse('{' + content + '}');
        if (obj.image || obj.video || obj.audio || obj.table) {
          obj.width = widthStr;
          for (const t of ['image','video','audio','table']) {
            for (const k of MEDIA_PROP_KEYS) delete obj[t + '.' + k];
          }
          delete obj.height;
          return '{{' + JSON.stringify(obj).slice(1, -1) + '}}';
        }
      } catch (ex) {}
      return match;
    });
    node[mediaInfo.field] = updated;
    app.markDirty();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// Lightbox preview
function showLightbox(src) {
  const mask = document.createElement('div');
  mask.className = 'lightbox-mask';
  const img = document.createElement('img');
  img.src = src;
  img.className = 'lightbox-img';
  mask.appendChild(img);
  mask.onclick = () => mask.remove();
  mask.onwheel = (e) => {
    e.preventDefault();
    const scale = e.deltaY < 0 ? 1.1 : 0.9;
    const cur = parseFloat(img.style.transform.replace(/scale\(([^)]+)\)/, '$1')) || 1;
    img.style.transform = `scale(${cur * scale})`;
  };
  document.body.appendChild(mask);
}

// Media property editor popup
// item（必传，由 collector 给出）：携带 type / meta / rawInner，
// 编辑器直接按它出类型与初始值，写回时用 rawInner 精确替换该 tag——
// 避免旧实现"扫文本拿第一个 {{...}}"造成的"全弹图片属性"和"误改其它 tag"两个 bug。
function showMediaEditor(mediaEl, mediaInfo, item) {
  closeMediaEditor();
  if (!item || !item.meta || !item.rawInner) return;
  const mediaType = item.type;
  if (!['image','video','audio','table'].includes(mediaType)) return;
  // 归一化读取（兼容老 image.X 等旧键）
  const media = _normalizeMediaMeta(item.meta, mediaType);

  mediaEl.classList.add('media-selected');

  const popup = document.createElement('div');
  popup.className = 'media-editor';
  popup.id = 'media-editor-popup';

  // 统一字段集：四种类型共用 7 项。部分属性对某些类型视觉无效（如 audio 的 angle / table 的 ratio），
  // 但写入数据格式一致，渲染/编辑/拖宽都走同一套代码，维护更简。
  // border 对 table 默认 ON（兼容 .inline-table 默认 CSS 边框），其它默认 OFF。
  const borderDefaultOn = mediaType === 'table';
  const borderInitial = media.border === undefined
    ? (borderDefaultOn ? 1 : '')
    : media.border;
  const fields = [
    {key: 'width',   label: '宽度',   val: media.width || '',                                           placeholder: '60% / 300px'},
    {key: 'ratio',   label: '比例',   val: media.ratio !== undefined ? media.ratio : '',               placeholder: '默认 1.0（高=宽×自然比×ratio）'},
    {key: 'align',   label: '对齐',   val: media.align || '',                                           type: 'select', opts: ['','left','center','right']},
    {key: 'angle',   label: '旋转',   val: media.angle !== undefined ? media.angle : '',               placeholder: '度数'},
    {key: 'caption', label: '说明',   val: media.caption || ''},
    {key: 'border',  label: '边框',   val: borderInitial,                                               type: 'check', defaultOn: borderDefaultOn},
    {key: 'opacity', label: '透明度', val: media.opacity !== undefined ? media.opacity : '',           placeholder: '0 - 1'},
  ];

  const titleMap = { image: '图片', video: '视频', audio: '音频', table: '表格' };
  let html = `<div class="media-editor-title">${titleMap[mediaType] || ''}属性</div>`;
  for (const f of fields) {
    if (f.type === 'select') {
      const optHtml = f.opts.map(o => `<option value="${o}"${o===f.val?' selected':''}>${o||'默认'}</option>`).join('');
      html += `<div class="media-editor-row"><label>${f.label}</label><select data-key="${f.key}">${optHtml}</select></div>`;
    } else if (f.type === 'check') {
      html += `<div class="media-editor-row"><label>${f.label}</label><input type="checkbox" data-key="${f.key}" ${f.val?'checked':''}></div>`;
    } else {
      const ph = f.placeholder || f.label;
      html += `<div class="media-editor-row"><label>${f.label}</label><input type="text" data-key="${f.key}" value="${f.val}" placeholder="${ph}"></div>`;
    }
  }
  html += `<div class="media-editor-actions"><button class="media-editor-del">删除</button><button class="media-editor-ok">确定</button></div>`;
  popup.innerHTML = html;

  const rect = mediaEl.getBoundingClientRect();
  // 先放进 DOM 才能量自身尺寸；初始位置随便给个，后面再夹到视口内。
  popup.style.top = '0px';
  popup.style.left = '0px';
  document.body.appendChild(popup);
  // 量出 popup 自身宽高（display 后才有 layout），把它锚定到媒体元素正下方，
  // 并夹紧到视口可见范围；下方放不下时翻到上方。
  // 之前固定写 rect.bottom + scrollY，遇到媒体在视口底部、popup 较高时会被裁切。
  const popRect = popup.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const margin = 8;
  let topVp = rect.bottom + 4; // 视口坐标
  if (topVp + popRect.height > vh - margin) {
    // 下方放不下，尝试放到媒体元素上方
    const above = rect.top - 4 - popRect.height;
    if (above >= margin) topVp = above;
    else topVp = Math.max(margin, vh - margin - popRect.height); // 仍然贴到视口底部
  }
  let leftVp = rect.left;
  if (leftVp + popRect.width > vw - margin) leftVp = vw - margin - popRect.width;
  if (leftVp < margin) leftVp = margin;
  popup.style.top = (topVp + window.scrollY) + 'px';
  popup.style.left = (leftVp + window.scrollX) + 'px';

  popup.onclick = (e) => e.stopPropagation();

  popup.querySelector('.media-editor-ok').onclick = () => {
    app.pushUndo();
    const node = getNodeByPath(app.data, mediaInfo.path);
    if (!node) return;
    const curText = node[mediaInfo.field] || '';
    const origTag = '{{' + item.rawInner + '}}';
    // 以 item.meta 为起点（保留 type 键如 image / video / audio / table 及其它非属性 key）
    const obj = Object.assign({}, item.meta);
    // 写入前清理所有老 type-prefixed 属性键，本轮全部统一到无前缀
    const prefix = mediaType + '.';
    for (const k of MEDIA_PROP_KEYS) delete obj[prefix + k];
    // 从 popup 读字段
    popup.querySelectorAll('[data-key]').forEach(el => {
      const k = el.dataset.key;
      if (el.type === 'checkbox') {
        // 字段默认 ON（如 table 的 border）时，"取消勾选"必须显式写 0，
        // 否则 delete 后再读又按默认 ON 渲染 —— 用户看到"无法关闭"。
        const field = fields.find(f => f.key === k);
        const defaultOn = field && field.defaultOn;
        if (el.checked) obj[k] = 1;
        else if (defaultOn) obj[k] = 0;
        else delete obj[k];
      } else {
        if (el.value) obj[k] = el.value; else delete obj[k];
      }
    });
    const newInner = JSON.stringify(obj).slice(1, -1);
    const newTag = '{{' + newInner + '}}';
    if (curText.indexOf(origTag) >= 0) {
      node[mediaInfo.field] = curText.replace(origTag, newTag);
    } else {
      // 兜底：找不到原 tag（可能数据被外部改过）→ 追加新 tag
      node[mediaInfo.field] = curText + newTag;
    }
    item.rawInner = newInner;
    item.meta = obj;
    closeMediaEditor();
    app.renderCurrentView();
    app.markDirty();
  };

  popup.querySelector('.media-editor-del').onclick = () => {
    app.pushUndo();
    const node = getNodeByPath(app.data, mediaInfo.path);
    if (!node) return;
    const curText = node[mediaInfo.field] || '';
    const origTag = '{{' + item.rawInner + '}}';
    if (curText.indexOf(origTag) >= 0) {
      node[mediaInfo.field] = curText.replace(origTag, '');
    } else {
      // 兜底：按旧规则删第一个媒体 tag（不删 {{=ref}}）
      node[mediaInfo.field] = curText.replace(/\{\{(?!=)(.*?)\}\}/, '');
    }
    closeMediaEditor();
    app.renderCurrentView();
    app.markDirty();
    toast('已删除媒体');
  };

  setTimeout(() => {
    document.addEventListener('click', closeMediaEditorOnOutside);
  }, 0);
}

function closeMediaEditorOnOutside(e) {
  const popup = document.getElementById('media-editor-popup');
  if (popup && !popup.contains(e.target)) closeMediaEditor();
}

function closeMediaEditor() {
  const popup = document.getElementById('media-editor-popup');
  if (popup) popup.remove();
  document.querySelectorAll('.media-selected').forEach(el => el.classList.remove('media-selected'));
  document.removeEventListener('click', closeMediaEditorOnOutside);
}
