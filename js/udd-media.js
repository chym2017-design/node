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
    container.appendChild(placeholder);
    return;
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
      } else {
        const cell = ws[addr];
        td.textContent = cell ? (cell.w || (cell.v !== undefined ? String(cell.v) : '')) : '';
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  container.appendChild(table);
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
// 统一的媒体渲染入口:
// 1) 先用公共 collector 深入展开所有 =ref / {{=ref}}，拿到 mediaItems 列表
// 2) 按顺序渲染为 DOM（image/video/audio/table）
// text-between-media 只在 outline/document 的"媒体区"里用到，不在此渲染
// （节点正文本身由 content span / body div 渲染）。
// ================================================================
function renderTextWithMedia(text, container, mediaInfo, opts) {
  if (!text) return;
  const noAlign = opts && opts.suppressAlign;
  const data = (typeof app !== 'undefined' && app.data) ? app.data : null;
  const items = (typeof collectMediaItemsFromText === 'function')
    ? collectMediaItemsFromText(data, text)
    : _legacyCollect(text);

  for (const it of items) {
    if (it.type === 'table') {
      renderInlineTable(container, it.tableRef);
      continue;
    }
    const media = it.meta || {};
    if (it.type === 'image') {
      const alignBox = document.createElement('div');
      if (!noAlign && media['image.align']) alignBox.style.textAlign = media['image.align'];
      const wrapper = document.createElement('div');
      wrapper.className = 'media-wrap';
      const imgW = media['image.width'] || '';
      if (imgW) wrapper.style.width = imgW;
      const img = document.createElement('img');
      _bindMediaSrcWithFallback(img, it.src);
      img.className = 'media-img';
      img.style.width = '100%';
      const imgH = media['image.height'] || '';
      if (imgH && !imgW.endsWith('%')) img.style.height = imgH;
      if (media['image.angle']) img.style.transform = `rotate(${media['image.angle']}deg)`;
      if (media['image.border']) img.style.border = '1px solid var(--gray-300)';
      img.draggable = false;
      img.ondblclick = (e) => { e.stopPropagation(); showLightbox(img.src); };
      img.onclick = (e) => { e.stopPropagation(); showMediaEditor(wrapper, mediaInfo); };
      wrapper.appendChild(img);
      _addMediaEditBtn(wrapper, mediaInfo);
      const handle = document.createElement('div');
      handle.className = 'media-resize-handle';
      handle.onmousedown = (e) => startMediaResize(e, img, wrapper, mediaInfo);
      wrapper.appendChild(handle);
      if (media['image.caption']) {
        const cap = document.createElement('div');
        cap.className = 'media-caption';
        cap.textContent = media['image.caption'];
        wrapper.appendChild(cap);
      }
      alignBox.appendChild(wrapper);
      container.appendChild(alignBox);
    } else if (it.type === 'video') {
      const alignBox = document.createElement('div');
      if (!noAlign && media['video.align']) alignBox.style.textAlign = media['video.align'];
      const wrapper = document.createElement('div');
      wrapper.className = 'media-wrap';
      const vidW = media['video.width'] || '';
      const vidH = media['video.height'] || '';
      if (vidW) wrapper.style.width = vidW;
      const vid = document.createElement('video');
      _bindMediaSrcWithFallback(vid, it.src);
      vid.className = 'media-video';
      vid.controls = true;
      vid.style.width = '100%';
      if (vidH && !vidW.endsWith('%')) vid.style.height = vidH;
      if (media['video.autoplay']) vid.autoplay = true;
      if (media['video.loop']) vid.loop = true;
      if (media['video.poster']) vid.poster = resolveMediaSrc(media['video.poster']);
      // 不在 <video> 上挂 click/dblclick：原生控件（播放/进度/音量）会消化点击；
      // 编辑入口走 wrapper 上的浮动 ✎ 按钮，保证进度条 seek 等原生交互不被打断。
      wrapper.appendChild(vid);
      _addMediaEditBtn(wrapper, mediaInfo);
      const handle = document.createElement('div');
      handle.className = 'media-resize-handle';
      handle.onmousedown = (e) => startMediaResize(e, vid, wrapper, mediaInfo);
      wrapper.appendChild(handle);
      if (media['video.caption']) {
        const cap = document.createElement('div');
        cap.className = 'media-caption';
        cap.textContent = media['video.caption'];
        wrapper.appendChild(cap);
      }
      alignBox.appendChild(wrapper);
      container.appendChild(alignBox);
    } else if (it.type === 'audio') {
      // 音频：用 media-wrap 包一层，支持对齐 + 说明（与图片 / 视频一致）
      const alignBox = document.createElement('div');
      if (!noAlign && media['audio.align']) alignBox.style.textAlign = media['audio.align'];
      const wrapper = document.createElement('div');
      wrapper.className = 'media-wrap media-audio-wrap';
      const audW = media['audio.width'] || '';
      if (audW) wrapper.style.width = audW;
      const aud = document.createElement('audio');
      _bindMediaSrcWithFallback(aud, it.src);
      aud.controls = true;
      aud.className = 'media-audio';
      aud.style.width = '100%';
      if (media['audio.autoplay']) aud.autoplay = true;
      if (media['audio.loop']) aud.loop = true;
      // 同 <video>：不挂 click/dblclick，进度条 seek 走原生；编辑入口走 ✎ 按钮。
      wrapper.appendChild(aud);
      _addMediaEditBtn(wrapper, mediaInfo);
      if (media['audio.caption']) {
        const cap = document.createElement('div');
        cap.className = 'media-caption';
        cap.textContent = media['audio.caption'];
        wrapper.appendChild(cap);
      }
      alignBox.appendChild(wrapper);
      container.appendChild(alignBox);
    }
  }
}

// 在媒体 wrapper 右上角加一个浮动的 ✎ 编辑按钮。
// 为什么不用 <audio>/<video> 自身的 click 事件？
//   原生控件（play / progress / volume）位于浏览器实现的 shadow DOM 内，
//   click 在该层被消化，事件不一定冒泡到我们绑的 onclick；
//   即便冒泡到了，我们的 handler 一旦弹出编辑器，又会反过来打断"点进度条跳播放"的原生行为。
//   做成一个独立浮动按钮，原生控件完全不受影响，编辑入口也始终可用。
function _addMediaEditBtn(wrapper, mediaInfo) {
  if (!mediaInfo) return; // 没有 path/field 信息（如思维导图气泡里）就不挂按钮
  if (!wrapper.style.position) wrapper.style.position = 'relative';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'media-edit-btn';
  btn.title = '编辑媒体属性';
  btn.textContent = '✎';
  btn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); showMediaEditor(wrapper, mediaInfo); };
  wrapper.appendChild(btn);
}

// 回退：仅在 collector 不可用时用；保持和旧行为兼容（不深入 ref）
function _legacyCollect(text) {
  const out = [];
  const parts = text.split(MEDIA_RE);
  for (let i = 1; i < parts.length; i += 2) {
    const media = parseMediaTag(parts[i]);
    if (media && media.image) out.push({ type: 'image', src: media.image, meta: media });
    else if (media && media.video) out.push({ type: 'video', src: media.video, meta: media });
    else if (media && media.audio) out.push({ type: 'audio', src: media.audio, meta: media });
    else {
      const tr = parseTableRef(parts[i]);
      if (tr) out.push({ type: 'table', tableRef: tr });
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
function startMediaResize(e, el, wrapper, mediaInfo) {
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
    if (mediaInfo && mediaInfo.path && mediaInfo.field) {
      const node = getNodeByPath(app.data, mediaInfo.path);
      if (node) {
        const text = node[mediaInfo.field] || '';
        const finalW = wrapper.offsetWidth;
        const pct = Math.round(finalW / parentW * 100);
        const widthStr = pct + '%';
        const mediaType = el.tagName === 'VIDEO' ? 'video' : 'image';
        const updated = text.replace(MEDIA_RE, (match, content) => {
          try {
            const obj = JSON.parse('{' + content + '}');
            if (obj[mediaType]) {
              obj[mediaType + '.width'] = widthStr;
              delete obj[mediaType + '.height'];
              const inner = JSON.stringify(obj).slice(1, -1);
              return '{{' + inner + '}}';
            }
          } catch(ex) {}
          return match;
        });
        node[mediaInfo.field] = updated;
        app.markDirty();
      }
    }
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
function showMediaEditor(mediaEl, mediaInfo) {
  closeMediaEditor();
  const text = (() => {
    const node = getNodeByPath(app.data, mediaInfo.path);
    return node ? (node[mediaInfo.field] || '') : '';
  })();
  const match = text.match(/\{\{(.*?)\}\}/);
  if (!match) return;
  const media = parseMediaTag(match[1]);
  if (!media) return;
  const mediaType = media.image ? 'image' : media.video ? 'video' : 'audio';

  mediaEl.classList.add('media-selected');

  const popup = document.createElement('div');
  popup.className = 'media-editor';
  popup.id = 'media-editor-popup';

  const fields = [];
  if (mediaType === 'image') {
    fields.push(
      {key: 'image.width', label: '宽度', val: media['image.width'] || ''},
      {key: 'image.height', label: '高度', val: media['image.height'] || ''},
      {key: 'image.align', label: '对齐', val: media['image.align'] || '', type: 'select', opts: ['','left','center','right']},
      {key: 'image.angle', label: '旋转', val: media['image.angle'] || ''},
      {key: 'image.caption', label: '说明', val: media['image.caption'] || ''},
      {key: 'image.border', label: '边框', val: media['image.border'] || '', type: 'check'},
    );
  } else if (mediaType === 'video') {
    fields.push(
      {key: 'video.width', label: '宽度', val: media['video.width'] || ''},
      {key: 'video.height', label: '高度', val: media['video.height'] || ''},
      {key: 'video.align', label: '对齐', val: media['video.align'] || '', type: 'select', opts: ['','left','center','right']},
      {key: 'video.caption', label: '说明', val: media['video.caption'] || ''},
      {key: 'video.autoplay', label: '自动播放', val: media['video.autoplay'] || '', type: 'check'},
      {key: 'video.loop', label: '循环', val: media['video.loop'] || '', type: 'check'},
    );
  } else if (mediaType === 'audio') {
    fields.push(
      {key: 'audio.width', label: '宽度', val: media['audio.width'] || ''},
      {key: 'audio.align', label: '对齐', val: media['audio.align'] || '', type: 'select', opts: ['','left','center','right']},
      {key: 'audio.caption', label: '说明', val: media['audio.caption'] || ''},
      {key: 'audio.autoplay', label: '自动播放', val: media['audio.autoplay'] || '', type: 'check'},
      {key: 'audio.loop', label: '循环', val: media['audio.loop'] || '', type: 'check'},
    );
  }

  const titleMap = { image: '图片', video: '视频', audio: '音频' };
  let html = `<div class="media-editor-title">${titleMap[mediaType] || ''}属性</div>`;
  for (const f of fields) {
    if (f.type === 'select') {
      const optHtml = f.opts.map(o => `<option value="${o}"${o===f.val?' selected':''}>${o||'默认'}</option>`).join('');
      html += `<div class="media-editor-row"><label>${f.label}</label><select data-key="${f.key}">${optHtml}</select></div>`;
    } else if (f.type === 'check') {
      html += `<div class="media-editor-row"><label>${f.label}</label><input type="checkbox" data-key="${f.key}" ${f.val?'checked':''}></div>`;
    } else {
      html += `<div class="media-editor-row"><label>${f.label}</label><input type="text" data-key="${f.key}" value="${f.val}" placeholder="${f.label}"></div>`;
    }
  }
  html += `<div class="media-editor-actions"><button class="media-editor-del">删除</button><button class="media-editor-ok">确定</button></div>`;
  popup.innerHTML = html;

  const rect = mediaEl.getBoundingClientRect();
  popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  popup.style.left = (rect.left + window.scrollX) + 'px';
  document.body.appendChild(popup);

  popup.onclick = (e) => e.stopPropagation();

  popup.querySelector('.media-editor-ok').onclick = () => {
    app.pushUndo();
    const node = getNodeByPath(app.data, mediaInfo.path);
    if (!node) return;
    const curText = node[mediaInfo.field] || '';
    const updated = curText.replace(/\{\{(.*?)\}\}/, (m, content) => {
      try {
        const obj = JSON.parse('{' + content + '}');
        popup.querySelectorAll('[data-key]').forEach(el => {
          const k = el.dataset.key;
          if (el.type === 'checkbox') {
            if (el.checked) obj[k] = 1; else delete obj[k];
          } else {
            if (el.value) obj[k] = el.value; else delete obj[k];
          }
        });
        return '{{' + JSON.stringify(obj).slice(1,-1) + '}}';
      } catch(ex) { return m; }
    });
    node[mediaInfo.field] = updated;
    closeMediaEditor();
    app.renderCurrentView();
    app.markDirty();
  };

  popup.querySelector('.media-editor-del').onclick = () => {
    app.pushUndo();
    const node = getNodeByPath(app.data, mediaInfo.path);
    if (!node) return;
    node[mediaInfo.field] = (node[mediaInfo.field] || '').replace(/\{\{.*?\}\}/, '');
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
