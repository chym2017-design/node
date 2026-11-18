// ================================================================
//  UDD 文件管理页面
//  浏览个人空间、拖拽移动、移动/复制/重命名/删除、回收站、标签
// ================================================================
(function () {
  'use strict';

  const PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#64748b'];
  const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];
  const VIDEO_EXTS = ['.mp4', '.webm', '.ogg', '.mov', '.avi'];
  const AUDIO_EXTS = ['.mp3', '.wav', '.aac', '.m4a', '.flac'];

  const state = {
    root: '',
    cwd: '',
    items: [],
    selected: new Set(),
    view: 'all',          // all | tag | trash
    activeTag: null,
    tags: {},
    tagCounts: {},
    trashCount: 0,
    account: '',
    lastIndex: -1,
    loadSeq: 0,
  };

  const $ = id => document.getElementById(id);
  const listEl = $('file-list');
  const crumbsEl = $('crumbs');

  // ---------------- 基础工具 ----------------

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  async function api(url, opts) {
    const o = opts || {};
    const init = { method: o.method || 'GET', headers: {} };
    if (o.json !== undefined) {
      init.method = init.method === 'GET' ? 'POST' : init.method;
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(o.json);
    }
    if (o.body !== undefined) init.body = o.body;
    const r = await fetch(url, init);
    if (r.status === 401) {
      location.href = '/login?next=' + encodeURIComponent('/files');
      throw new Error('未登录');
    }
    let data = {};
    try { data = await r.json(); } catch (e) { /* ignore */ }
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  function joinPath(dir, name) {
    return String(dir || '').replace(/[\\/]+$/, '') + '/' + name;
  }

  function relPath(abs) {
    if (!abs || abs === state.root) return '';
    const r = String(abs).replace(/\\/g, '/');
    const root = String(state.root).replace(/\\/g, '/');
    if (r === root) return '';
    if (r.startsWith(root + '/')) return r.slice(root.length + 1);
    return r;
  }

  function fmtSize(n) {
    if (!n) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function fmtTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = x => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fileIcon(item) {
    let name = 'file';
    let cls = 'file-doc';
    const ext = String(item.ext || '').toLowerCase();
    if (item.type === 'dir') { name = 'folder'; cls = 'file-dir'; }
    else if (ext === '.udd') { name = 'udd'; cls = 'file-udd'; }
    else if (IMAGE_EXTS.includes(ext)) { name = 'image'; cls = 'file-image'; }
    else if (VIDEO_EXTS.includes(ext)) { name = 'media'; cls = 'file-media'; }
    else if (AUDIO_EXTS.includes(ext)) { name = 'audio'; cls = 'file-audio'; }
    else if (ext === '.xlsx' || ext === '.csv') { name = 'sheet'; cls = 'file-sheet'; }
    const icon = el('span', 'icon ' + cls);
    icon.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="#file-i-' + name + '"/></svg>';
    return icon;
  }

  let toastTimer = null;
  function toast(msg) {
    let box = document.getElementById('udd-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'udd-toast';
      box.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:3000;'
        + 'background:rgba(15,23,42,.9);color:#fff;padding:8px 14px;border-radius:8px;font-size:12px;'
        + 'max-width:80vw;opacity:0;transition:opacity .15s;pointer-events:none';
      document.body.appendChild(box);
    }
    box.textContent = msg;
    box.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.style.opacity = '0'; }, 2200);
  }

  // ---------------- 数据加载 ----------------

  async function init() {
    try {
      const me = await api('/api/auth/me');
      state.account = me.user || '';
      $('account').textContent = state.account ? '账号：' + state.account : '';
    } catch (e) { /* 登录页会处理 */ }

    const info = await api('/api/root');
    state.root = info.root;
    state.cwd = state.root;

    await Promise.all([loadTags(), loadTrashCount()]);
    await loadDir(state.root);
  }

  async function loadTags() {
    const data = await api('/api/tags');
    state.tags = data.tags || {};
    state.tagCounts = data.counts || {};
    renderTags();
  }

  async function loadTrashCount() {
    try {
      const data = await api('/api/trash');
      state.trashCount = data.count || 0;
      $('trash-count').textContent = state.trashCount ? String(state.trashCount) : '';
    } catch (e) {
      state.trashCount = 0;
    }
  }

  async function loadDir(dir) {
    const seq = ++state.loadSeq;
    state.view = 'all';
    state.activeTag = null;
    state.cwd = dir;
    try {
      const data = await api('/api/files?dir=' + encodeURIComponent(dir));
      if (seq !== state.loadSeq) return;
      state.cwd = data.dir;
      state.items = data.items || [];
      state.selected.clear();
      state.lastIndex = -1;
      renderAll();
    } catch (e) {
      if (seq === state.loadSeq) toast('加载失败: ' + e.message);
    }
  }

  async function loadTag(tagId) {
    const seq = ++state.loadSeq;
    state.view = 'tag';
    state.activeTag = tagId;
    try {
      const data = await api('/api/tag-items?tag=' + encodeURIComponent(tagId));
      if (seq !== state.loadSeq) return;
      state.items = data.items || [];
      state.selected.clear();
      state.lastIndex = -1;
      renderAll();
    } catch (e) {
      if (seq === state.loadSeq) toast('加载失败: ' + e.message);
    }
  }

  async function loadTrash() {
    const seq = ++state.loadSeq;
    state.view = 'trash';
    state.activeTag = null;
    try {
      const data = await api('/api/trash');
      if (seq !== state.loadSeq) return;
      state.items = data.items || [];
      state.selected.clear();
      state.lastIndex = -1;
      state.trashCount = data.count || 0;
      renderAll();
    } catch (e) {
      if (seq === state.loadSeq) toast('加载失败: ' + e.message);
    }
  }

  async function reloadCurrent() {
    if (state.view === 'trash') return loadTrash();
    if (state.view === 'tag' && state.activeTag) return loadTag(state.activeTag);
    return loadDir(state.cwd);
  }

  async function refreshAfterMetaChange() {
    await Promise.all([loadTags(), loadTrashCount()]);
    await reloadCurrent();
  }

  // ---------------- 渲染 ----------------

  function renderAll() {
    renderTags();
    renderNav();
    renderCrumbs();
    renderList();
    updateToolbar();
  }

  function renderNav() {
    $('nav-all').classList.toggle('active', state.view === 'all');
    $('nav-trash').classList.toggle('active', state.view === 'trash');
    const isTrash = state.view === 'trash';
    $('actions-all').hidden = isTrash;
    $('actions-trash').hidden = !isTrash;
    $('create-actions').hidden = isTrash;
    $('view-title').textContent = isTrash ? '回收站' : state.view === 'tag'
      ? (state.tags[state.activeTag]?.name || '标签文件') : '全部文件';
  }

  function renderTags() {
    const box = $('tag-list');
    box.innerHTML = '';
    const entries = Object.entries(state.tags).sort((a, b) =>
      String(a[1].name).localeCompare(String(b[1].name), 'zh-CN'));
    if (!entries.length) {
      box.appendChild(el('div', 'side-empty', '还没有标签。\n给文件加标签后会出现在这里。'));
      return;
    }
    for (const [id, tag] of entries) {
      const row = el('div', 'tag-row' + (state.view === 'tag' && state.activeTag === id ? ' active' : ''));
      const dot = el('span', 'tag-dot');
      dot.style.background = tag.color || '#64748b';
      row.appendChild(dot);
      row.appendChild(el('span', 'tag-name', tag.name));
      row.appendChild(el('span', 'tag-count', String(state.tagCounts[id] || 0)));
      const more = el('button', 'tag-more', '⋯');
      more.type = 'button';
      more.title = '管理标签';
      more.onclick = ev => {
        ev.stopPropagation();
        const r = more.getBoundingClientRect();
        showContextMenu(r.left - 100, r.bottom + 4, [
          { label: '重命名 / 改颜色', fn: () => editTag(id) },
          { type: 'sep' },
          { label: '删除标签', danger: true, fn: () => deleteTag(id) },
        ]);
      };
      row.appendChild(more);
      row.onclick = () => loadTag(id);
      row.oncontextmenu = ev => {
        ev.preventDefault();
        showContextMenu(ev.clientX, ev.clientY, [
          { label: '重命名 / 改颜色', fn: () => editTag(id) },
          { type: 'sep' },
          { label: '删除标签', danger: true, fn: () => deleteTag(id) },
        ]);
      };
      box.appendChild(row);
    }
  }

  function renderCrumbs() {
    crumbsEl.innerHTML = '';
    const addCrumb = (label, current, onClick) => {
      const b = el('button', 'crumb' + (current ? ' current' : ''), label);
      b.type = 'button';
      b.title = label;
      if (onClick) b.onclick = onClick;
      crumbsEl.appendChild(b);
    };
    const addSep = () => crumbsEl.appendChild(el('span', 'crumb-sep', '/'));

    if (state.view === 'trash') {
      addCrumb('回收站', true, null);
      return;
    }
    if (state.view === 'tag') {
      addCrumb('标签', false, () => loadDir(state.root));
      addSep();
      const t = state.tags[state.activeTag];
      addCrumb(t ? t.name : '标签', true, null);
      return;
    }

    addCrumb('我的空间', state.cwd === state.root, () => loadDir(state.root));
    const rel = relPath(state.cwd);
    if (rel) {
      const parts = rel.split('/');
      let acc = state.root;
      parts.forEach((part, i) => {
        acc = joinPath(acc, part);
        addSep();
        addCrumb(part, i === parts.length - 1, i === parts.length - 1 ? null : () => loadDir(acc));
      });
    }
  }

  function tagChips(tagIds) {
    const wrap = el('span', 'meta');
    const ids = (tagIds || []).slice(0, 2);
    let shown = 0;
    for (const id of ids) {
      const tag = state.tags[id];
      if (!tag) continue;
      const chip = el('span', 'tag-chip');
      const dot = el('span', 'tag-dot');
      dot.style.background = tag.color || '#64748b';
      chip.appendChild(dot);
      chip.appendChild(el('span', 'chip-name', tag.name));
      chip.title = tag.name;
      wrap.appendChild(chip);
      shown += 1;
    }
    const extra = (tagIds || []).length - shown;
    if (extra > 0) wrap.appendChild(el('span', 'tag-chip', '+' + extra));
    return wrap;
  }

  function renderList() {
    listEl.innerHTML = '';
    $('meta-head').textContent = state.view === 'tag' ? '位置' : '标签';
    const selectAll = $('select-all');
    selectAll.disabled = state.view === 'trash';
    if (state.view === 'trash') { selectAll.checked = false; selectAll.indeterminate = false; }

    if (state.view === 'trash') {
      if (!state.items.length) {
        listEl.appendChild(emptyState('回收站是空的', '删除的文件会先放到这里。'));
      } else {
        for (const item of state.items) listEl.appendChild(trashRow(item));
      }
      updateStatus();
      return;
    }

    if (!state.items.length) {
      const msg = state.view === 'tag'
        ? emptyState('这个标签下还没有文件', '给文件打上标签后会显示在这里。')
        : emptyState('这个文件夹是空的', '可以把文件拖进来，或点上方「上传」。');
      listEl.appendChild(msg);
      updateStatus();
      return;
    }

    state.items.forEach((item, index) => listEl.appendChild(fileRow(item, index)));
    updateStatus();
  }

  function emptyState(title, detail) {
    const box = el('div', 'empty');
    box.appendChild(el('div', null, title));
    box.appendChild(el('div', null, detail));
    return box;
  }

  function fileRow(item, index) {
    const row = el('div', 'row' + (state.selected.has(item.path) ? ' selected' : ''));
    row.dataset.path = item.path;
    row.draggable = state.view === 'all';

    const checkWrap = el('label', 'check');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(item.path);
    cb.onclick = ev => ev.stopPropagation();
    cb.onchange = () => {
      if (cb.checked) state.selected.add(item.path);
      else state.selected.delete(item.path);
      row.classList.toggle('selected', cb.checked);
      updateToolbar();
      updateStatus();
    };
    checkWrap.appendChild(cb);

    row.appendChild(checkWrap);
    row.appendChild(fileIcon(item));

    const name = el('div', 'name');
    name.appendChild(el('span', 'name-text' + (item.type === 'dir' ? ' dir' : ''), item.name));
    row.appendChild(name);

    if (state.view === 'tag') {
      const meta = el('div', 'meta');
      const loc = item.dir ? relPath(item.dir) : '';
      meta.appendChild(el('span', 'location', loc ? '我的空间 / ' + loc : '我的空间'));
      row.appendChild(meta);
    } else {
      row.appendChild(tagChips(item.tags));
    }

    row.appendChild(el('span', 'size', item.type === 'dir' ? '—' : fmtSize(item.size)));
    row.appendChild(el('span', 'time', fmtTime(item.mtime)));

    row.onclick = ev => handleRowClick(ev, item, index, cb);
    row.ondblclick = () => openItem(item);
    row.oncontextmenu = ev => showFileMenu(ev, item);

    if (state.view === 'all' && item.type === 'dir') {
      row.addEventListener('dragover', ev => {
        if (hasDrag(ev)) {
          ev.preventDefault();
          row.classList.add('drop-target');
        }
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', ev => {
        row.classList.remove('drop-target');
        handleDrop(ev, item.path);
      });
    }

    if (row.draggable) {
      row.addEventListener('dragstart', ev => {
        if (!state.selected.has(item.path)) selectOnly(item.path);
        ev.dataTransfer.setData('application/x-udd-paths', JSON.stringify(Array.from(state.selected)));
        ev.dataTransfer.setData('text/plain', item.path);
        ev.dataTransfer.effectAllowed = 'move';
      });
    }

    return row;
  }

  function trashRow(item) {
    const row = el('div', 'row');
    row.appendChild(el('label', 'check'));
    row.appendChild(fileIcon(item));
    row.appendChild(el('span', 'name-text', item.name));
    const meta = el('div', 'meta');
    meta.appendChild(el('span', 'location', '原位置：' + (item.originalRel || '/')));
    const restore = el('button', 'btn', '恢复');
    restore.style.padding = '2px 8px';
    restore.onclick = async ev => {
      ev.stopPropagation();
      try {
        await api('/api/trash/restore', { method: 'POST', json: { ids: [item.id] } });
        toast('已恢复：' + item.name);
        await refreshAfterMetaChange();
      } catch (e) { toast('恢复失败: ' + e.message); }
    };
    meta.appendChild(restore);
    row.appendChild(meta);
    row.appendChild(el('span', 'size', '—'));
    row.appendChild(el('span', 'time', fmtTime(Date.parse(item.deletedAt))));
    return row;
  }

  function handleRowClick(ev, item, index, cb) {
    if (ev.shiftKey && state.lastIndex >= 0) {
      const a = Math.min(state.lastIndex, index);
      const b = Math.max(state.lastIndex, index);
      state.selected.clear();
      for (let i = a; i <= b; i++) state.selected.add(state.items[i].path);
    } else if (ev.metaKey || ev.ctrlKey) {
      if (state.selected.has(item.path)) state.selected.delete(item.path);
      else state.selected.add(item.path);
    } else {
      state.selected.clear();
      state.selected.add(item.path);
    }
    state.lastIndex = index;
    syncSelectionUI();
  }

  function selectOnly(path) {
    state.selected.clear();
    state.selected.add(path);
    state.lastIndex = state.items.findIndex(i => i.path === path);
    syncSelectionUI();
  }

  function syncSelectionUI() {
    listEl.querySelectorAll('.row').forEach(row => {
      const on = state.selected.has(row.dataset.path);
      row.classList.toggle('selected', on);
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = on;
    });
    updateToolbar();
    updateStatus();
  }

  function updateStatus() {
    $('status-count').textContent = state.items.length + ' 项';
    $('status-selected').textContent = state.selected.size ? ('已选择 ' + state.selected.size + ' 项') : '';
    $('status-path').textContent = state.view === 'trash'
      ? '回收站'
      : state.view === 'tag'
        ? ('标签：' + (state.tags[state.activeTag] ? state.tags[state.activeTag].name : ''))
        : (relPath(state.cwd) ? '我的空间 / ' + relPath(state.cwd) : '我的空间');
  }

  function selectedItems() {
    return state.items.filter(i => state.selected.has(i.path));
  }

  function updateToolbar() {
    const items = selectedItems();
    const one = items.length === 1;
    const singleFile = one && items[0].type === 'file';
    $('btn-rename').disabled = !one;
    $('btn-move').disabled = !items.length;
    $('btn-copy').disabled = !items.length;
    $('btn-tag').disabled = !items.length;
    $('btn-download').disabled = !singleFile;
    $('btn-delete').disabled = !items.length;
    const inTag = state.view === 'tag';
    $('btn-new-folder').disabled = inTag;
    $('btn-upload').disabled = inTag;
    $('btn-empty-trash').disabled = !state.trashCount;
    const all = state.items.length > 0 && state.selected.size === state.items.length;
    $('select-all').checked = all;
    $('select-all').indeterminate = state.selected.size > 0 && !all;
  }

  // ---------------- 打开 / 下载 ----------------

  function openItem(item) {
    if (item.type === 'dir') return loadDir(item.path);
    const ext = String(item.ext || '').toLowerCase();
    if (ext === '.udd') {
      window.open('/?open=' + encodeURIComponent(item.path), '_blank');
      return;
    }
    if (IMAGE_EXTS.includes(ext) || VIDEO_EXTS.includes(ext) || AUDIO_EXTS.includes(ext)
        || ext === '.pdf' || ext === '.txt' || ext === '.md' || ext === '.json') {
      window.open('/api/readfile?path=' + encodeURIComponent(item.path), '_blank');
      return;
    }
    downloadItem(item);
  }

  function downloadItem(item) {
    const a = document.createElement('a');
    a.href = '/api/readfile?path=' + encodeURIComponent(item.path) + '&download=1';
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------------- 选择 / 拖拽 ----------------

  function hasDrag(ev) {
    const t = ev.dataTransfer && ev.dataTransfer.types;
    if (!t) return false;
    return Array.prototype.indexOf.call(t, 'application/x-udd-paths') >= 0
      || Array.prototype.indexOf.call(t, 'Files') >= 0;
  }

  async function handleDrop(ev, dirPath) {
    ev.preventDefault();
    if (!ev.dataTransfer) return;
    if (ev.dataTransfer.files && ev.dataTransfer.files.length) {
      await uploadFiles(ev.dataTransfer.files, dirPath);
      return;
    }
    const raw = ev.dataTransfer.getData('application/x-udd-paths');
    if (!raw) return;
    let paths = [];
    try { paths = JSON.parse(raw); } catch (e) { return; }
    if (!Array.isArray(paths) || !paths.length) return;
    await movePaths(paths, dirPath);
  }

  // ---------------- 文件操作 ----------------

  async function newFolder() {
    const name = await promptModal('新建文件夹', '文件夹名称', '');
    if (!name) return;
    try {
      await api('/api/mkdir?dir=' + encodeURIComponent(state.cwd) + '&name=' + encodeURIComponent(name), { method: 'POST' });
      toast('已创建文件夹');
      await reloadCurrent();
    } catch (e) { toast('新建失败: ' + e.message); }
  }

  async function renameSelected() {
    const items = selectedItems();
    if (items.length !== 1) return;
    const item = items[0];
    const name = await promptModal('重命名', '新名称', item.name);
    if (!name || name === item.name) return;
    try {
      await api('/api/rename', { method: 'POST', json: { path: item.path, name } });
      toast('已重命名');
      await refreshAfterMetaChange();
    } catch (e) { toast('重命名失败: ' + e.message); }
  }

  async function moveSelected() {
    const items = selectedItems();
    if (!items.length) return;
    const dest = await folderPicker('移动到文件夹', state.cwd);
    if (!dest) return;
    await movePaths(items.map(i => i.path), dest);
  }

  async function movePaths(paths, destDir) {
    try {
      await api('/api/move', { method: 'POST', json: { paths, destDir } });
      toast('已移动 ' + paths.length + ' 项');
      state.selected.clear();
      await refreshAfterMetaChange();
    } catch (e) { toast('移动失败: ' + e.message); }
  }

  async function copySelected() {
    const items = selectedItems();
    if (!items.length) return;
    const dest = await folderPicker('复制到文件夹', state.cwd);
    if (!dest) return;
    try {
      await api('/api/copy', { method: 'POST', json: { paths: items.map(i => i.path), destDir: dest } });
      toast('已复制 ' + items.length + ' 项');
      state.selected.clear();
      await refreshAfterMetaChange();
    } catch (e) { toast('复制失败: ' + e.message); }
  }

  async function deleteSelected() {
    const items = selectedItems();
    if (!items.length) return;
    const names = items.slice(0, 3).map(i => i.name).join('、') + (items.length > 3 ? ' 等' : '');
    const ok = await confirmModal('移到回收站', '确定把“' + names + '”移到回收站吗？\n之后可以在回收站恢复。', '移到回收站', true);
    if (!ok) return;
    try {
      await api('/api/delete', { method: 'POST', json: { paths: items.map(i => i.path) } });
      toast('已移到回收站');
      state.selected.clear();
      await refreshAfterMetaChange();
    } catch (e) { toast('删除失败: ' + e.message); }
  }

  async function emptyTrash() {
    if (!state.trashCount) return;
    const ok = await confirmModal('清空回收站', '清空后无法恢复，确定继续吗？', '清空', true);
    if (!ok) return;
    try {
      await api('/api/trash/empty', { method: 'POST', json: {} });
      toast('回收站已清空');
      await refreshAfterMetaChange();
    } catch (e) { toast('清空失败: ' + e.message); }
  }

  async function uploadFiles(fileList, dirPath) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try {
      const data = await api('/api/files?dir=' + encodeURIComponent(dirPath));
      const existing = new Set((data.items || []).map(i => i.name));
      let n = 0;
      for (const file of files) {
        let name = file.name;
        if (existing.has(name)) {
          const ok = await confirmModal('覆盖文件', '“' + name + '”已存在，是否覆盖？', '覆盖', true);
          if (!ok) continue;
        }
        n += 1;
        toast('上传中 ' + n + '/' + files.length + '：' + name);
        const r = await fetch('/api/writefile?path=' + encodeURIComponent(joinPath(dirPath, name)), {
          method: 'POST', body: file,
        });
        if (!r.ok) {
          let msg = 'HTTP ' + r.status;
          try { const j = await r.json(); if (j.error) msg = j.error; } catch (e) {}
          throw new Error(name + ': ' + msg);
        }
        existing.add(name);
      }
      toast('上传完成');
      await refreshAfterMetaChange();
    } catch (e) { toast('上传失败: ' + e.message); }
  }

  // ---------------- 标签 ----------------

  async function tagSelected() {
    const items = selectedItems();
    if (!items.length) return;
    const result = await tagEditor(items);
    if (!result) return;
    if (!result.add.length && !result.remove.length) { toast('标签没有变化'); return; }
    try {
      await api('/api/tags/assign', {
        method: 'POST',
        json: { paths: items.map(i => i.path), add: result.add, remove: result.remove },
      });
      toast('标签已更新');
      await refreshAfterMetaChange();
    } catch (e) { toast('设置标签失败: ' + e.message); }
  }

  function tagEditor(items) {
    const body = document.createElement('div');
    const list = document.createElement('div');
    body.appendChild(list);
    const states = {};
    const created = [];

    function computeInitial(id) {
      let count = 0;
      for (const item of items) if ((item.tags || []).includes(id)) count += 1;
      return count === items.length ? 'all' : (count ? 'some' : 'none');
    }

    function capture() {
      list.querySelectorAll('input[data-tag]').forEach(cb => {
        const id = cb.dataset.tag;
        if (!states[id]) states[id] = { initial: computeInitial(id) };
        states[id].checked = cb.checked;
        states[id].indeterminate = cb.indeterminate;
      });
    }

    function renderRows() {
      list.innerHTML = '';
      const entries = Object.entries(state.tags).sort((a, b) =>
        String(a[1].name).localeCompare(String(b[1].name), 'zh-CN'));
      if (!entries.length) list.appendChild(el('div', 'modal-note', '还没有标签，可以在下面新建。'));
      for (const [id, tag] of entries) {
        if (!states[id]) {
          const initial = computeInitial(id);
          states[id] = {
            initial: initial,
            checked: initial === 'all',
            indeterminate: initial === 'some',
          };
        }
        const s = states[id];
        const row = el('div', 'tag-edit-row');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.tag = id;
        cb.checked = !!s.checked;
        cb.indeterminate = !!s.indeterminate;
        const dot = el('span', 'tag-dot');
        dot.style.background = tag.color || '#64748b';
        row.appendChild(cb);
        row.appendChild(dot);
        row.appendChild(el('span', 'tag-name', tag.name));
        list.appendChild(row);
      }
    }

    renderRows();

    const create = el('div', 'tag-create');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = '新标签名称';
    nameInput.maxLength = 24;
    let newColor = PALETTE[4];
    const palette = el('div', 'color-palette');
    const swatches = PALETTE.map(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-swatch' + (c === newColor ? ' active' : '');
      b.style.background = c;
      b.onclick = () => {
        newColor = c;
        swatches.forEach(x => x.classList.toggle('active', x === b));
      };
      palette.appendChild(b);
      return b;
    });
    const createBtn = el('button', 'btn', '新建');
    createBtn.type = 'button';
    createBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { toast('请输入标签名称'); return; }
      try {
        const data = await api('/api/tags/create', { method: 'POST', json: { name, color: newColor } });
        capture();
        state.tags[data.tag.id] = data.tag;
        created.push(data.tag.id);
        states[data.tag.id] = { initial: 'none', checked: true, indeterminate: false };
        nameInput.value = '';
        renderRows();
        loadTags().catch(() => {});
      } catch (e) { toast('创建标签失败: ' + e.message); }
    };
    nameInput.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); createBtn.click(); }
    });
    create.appendChild(nameInput);
    create.appendChild(createBtn);
    body.appendChild(create);
    body.appendChild(el('div', 'modal-note', '勾选会给所有选中项加上标签；取消勾选会从所有选中项移除。'));

    return modal({
      title: '标签',
      body: body,
      okText: '应用',
      onOk: () => {
        const add = [];
        const remove = [];
        list.querySelectorAll('input[data-tag]').forEach(cb => {
          const id = cb.dataset.tag;
          const initial = states[id] ? states[id].initial : 'none';
          if (cb.checked && initial !== 'all') add.push(id);
          if (!cb.checked && initial === 'all') remove.push(id);
        });
        for (const id of created) if (!add.includes(id)) add.push(id);
        return { add, remove };
      },
    });
  }

  async function createTagFlow() {
    const result = await tagFormModal(null);
    if (!result) return;
    try {
      const data = await api('/api/tags/create', { method: 'POST', json: result });
      toast('标签已创建：' + data.tag.name);
      await loadTags();
    } catch (e) { toast('创建标签失败: ' + e.message); }
  }

  function tagFormModal(tag) {
    const body = document.createElement('div');
    const field = el('div', 'field');
    const label = document.createElement('label');
    label.textContent = '标签名称';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 24;
    input.value = tag ? tag.name : '';
    field.appendChild(label);
    field.appendChild(input);
    body.appendChild(field);

    let color = tag ? (tag.color || PALETTE[4]) : PALETTE[4];
    const picker = el('div', 'color-palette');
    const swatches = PALETTE.map(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-swatch' + (c === color ? ' active' : '');
      b.style.background = c;
      b.onclick = () => {
        color = c;
        swatches.forEach(x => x.classList.toggle('active', x === b));
      };
      picker.appendChild(b);
      return b;
    });
    body.appendChild(el('div', 'field', '颜色'));
    body.appendChild(picker);

    return modal({
      title: tag ? '编辑标签' : '新建标签',
      body: body,
      okText: '保存',
      onOk: () => {
        const name = input.value.trim();
        if (!name) { toast('请输入标签名称'); return false; }
        return { name, color };
      },
    });
  }

  async function editTag(id) {
    const tag = state.tags[id];
    if (!tag) return;
    const result = await tagFormModal(tag);
    if (!result) return;
    try {
      await api('/api/tags/update', { method: 'POST', json: { id, name: result.name, color: result.color } });
      toast('标签已更新');
      await refreshAfterMetaChange();
    } catch (e) { toast('更新标签失败: ' + e.message); }
  }

  async function deleteTag(id) {
    const tag = state.tags[id];
    if (!tag) return;
    const ok = await confirmModal('删除标签', '删除标签“' + tag.name + '”？\n文件本身不会被删除，只会移除这个标签。', '删除', true);
    if (!ok) return;
    try {
      await api('/api/tags/delete', { method: 'POST', json: { id } });
      toast('标签已删除');
      if (state.view === 'tag' && state.activeTag === id) state.activeTag = null;
      await refreshAfterMetaChange();
    } catch (e) { toast('删除标签失败: ' + e.message); }
  }

  // ---------------- 弹窗 ----------------

  const modalStack = [];

  function modal(opts) {
    return new Promise(resolve => {
      const token = {};
      modalStack.push(token);
      const mask = el('div', 'modal-mask');
      const modalEl = el('div', 'modal');
      const head = el('div', 'modal-head');
      head.appendChild(el('span', null, opts.title || ''));
      const closeBtn = el('button', null, '×');
      closeBtn.type = 'button';
      head.appendChild(closeBtn);
      const body = el('div', 'modal-body');
      if (typeof opts.body === 'string') body.innerHTML = opts.body;
      else if (opts.body) body.appendChild(opts.body);
      const foot = el('div', 'modal-foot');
      const cancelBtn = el('button', 'btn', opts.cancelText || '取消');
      cancelBtn.type = 'button';
      const okBtn = el('button', 'btn ' + (opts.danger ? 'danger' : 'primary'), opts.okText || '确定');
      okBtn.type = 'button';
      foot.appendChild(cancelBtn);
      foot.appendChild(okBtn);
      modalEl.appendChild(head);
      modalEl.appendChild(body);
      modalEl.appendChild(foot);
      mask.appendChild(modalEl);

      let closed = false;
      const close = value => {
        if (closed) return;
        closed = true;
        const i = modalStack.indexOf(token);
        if (i >= 0) modalStack.splice(i, 1);
        document.removeEventListener('keydown', onKey);
        mask.remove();
        resolve(value);
      };
      const onKey = ev => {
        // 只让最上层弹窗响应键盘，避免嵌套弹窗（如文件夹选择器里新建文件夹）被一起提交
        if (modalStack[modalStack.length - 1] !== token) return;
        if (ev.key === 'Escape') close(null);
        if (ev.key === 'Enter' && ev.target && ev.target.tagName === 'INPUT') {
          ev.preventDefault();
          okBtn.click();
        }
      };
      cancelBtn.onclick = () => close(null);
      closeBtn.onclick = () => close(null);
      mask.onclick = ev => { if (ev.target === mask) close(null); };
      okBtn.onclick = async () => {
        try {
          const v = opts.onOk ? await opts.onOk() : true;
          if (v === false) return;
          close(v);
        } catch (e) { toast(e.message); }
      };
      document.addEventListener('keydown', onKey);
      $('modal-root').appendChild(mask);
      setTimeout(() => {
        const inp = body.querySelector('input[type="text"]');
        if (inp) { inp.focus(); inp.select(); }
      }, 30);
    });
  }

  function promptModal(title, label, defaultValue) {
    const body = document.createElement('div');
    const field = el('div', 'field');
    const lab = document.createElement('label');
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = defaultValue == null ? '' : String(defaultValue);
    field.appendChild(lab);
    field.appendChild(input);
    body.appendChild(field);
    return modal({
      title: title,
      body: body,
      okText: '确定',
      onOk: () => {
        const v = input.value.trim();
        if (!v) { toast('请输入内容'); return false; }
        return v;
      },
    });
  }

  function confirmModal(title, message, okText, danger) {
    const body = document.createElement('div');
    body.className = 'modal-note';
    body.textContent = message;
    return modal({
      title: title,
      body: body,
      okText: okText || '确定',
      danger: !!danger,
      onOk: () => true,
    });
  }

  function folderPicker(title, startDir) {
    const body = document.createElement('div');
    const nav = el('div', 'picker-nav');
    const up = el('button', 'btn', '↑');
    up.type = 'button';
    up.style.padding = '3px 9px';
    const pathEl = el('span', 'picker-path', startDir || '');
    const newBtn = el('button', 'btn', '＋ 文件夹');
    newBtn.type = 'button';
    nav.appendChild(up);
    nav.appendChild(pathEl);
    nav.appendChild(newBtn);
    const list = el('div', 'picker-list');
    body.appendChild(nav);
    body.appendChild(list);
    let current = '';
    let parent = '';

    async function load(dir) {
      list.innerHTML = '';
      const loading = el('div', 'picker-empty', '加载中...');
      list.appendChild(loading);
      try {
        const data = await api('/api/files?dir=' + encodeURIComponent(dir));
        current = data.dir;
        parent = data.parent || '';
        pathEl.textContent = relPath(current) ? '我的空间 / ' + relPath(current) : '我的空间';
        up.style.visibility = (parent && parent !== current) ? 'visible' : 'hidden';
        list.innerHTML = '';
        const dirs = (data.items || []).filter(i => i.type === 'dir');
        for (const item of dirs) {
          const row = el('div', 'picker-item');
          row.appendChild(el('span', null, '📁'));
          row.appendChild(el('span', null, item.name));
          row.onclick = () => load(item.path);
          list.appendChild(row);
        }
        if (!dirs.length) list.appendChild(el('div', 'picker-empty', '当前文件夹下没有子文件夹'));
      } catch (e) {
        list.innerHTML = '';
        list.appendChild(el('div', 'picker-empty', '加载失败：' + e.message));
      }
    }

    up.onclick = () => { if (parent && parent !== current) load(parent); };
    newBtn.onclick = async () => {
      const name = await promptModal('新建文件夹', '文件夹名称', '');
      if (!name) return;
      try {
        const data = await api('/api/mkdir?dir=' + encodeURIComponent(current) + '&name=' + encodeURIComponent(name), { method: 'POST' });
        await load(data.path);
      } catch (e) { toast('新建失败: ' + e.message); }
    };

    load(startDir || state.root);
    return modal({
      title: title,
      body: body,
      okText: '选择此文件夹',
      onOk: () => current || false,
    });
  }

  // ---------------- 右键菜单 ----------------

  function showContextMenu(x, y, entries) {
    closeContextMenu();
    const menu = el('div', 'context-menu');
    for (const entry of entries) {
      if (entry.type === 'sep') {
        menu.appendChild(el('div', 'sep'));
        continue;
      }
      const b = el('button', entry.danger ? 'danger' : null, entry.label);
      b.type = 'button';
      b.onclick = () => { closeContextMenu(); entry.fn(); };
      menu.appendChild(b);
    }
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - 180)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - 40 - entries.length * 30)) + 'px';
    menu.id = 'udd-context-menu';
    document.body.appendChild(menu);
    setTimeout(() => {
      document.addEventListener('mousedown', outsideClose, true);
      document.addEventListener('keydown', escClose, true);
    }, 0);
  }

  function outsideClose(ev) {
    const menu = document.getElementById('udd-context-menu');
    if (menu && !menu.contains(ev.target)) closeContextMenu();
  }

  function escClose(ev) {
    if (ev.key === 'Escape') closeContextMenu();
  }

  function closeContextMenu() {
    const menu = document.getElementById('udd-context-menu');
    if (menu) menu.remove();
    document.removeEventListener('mousedown', outsideClose, true);
    document.removeEventListener('keydown', escClose, true);
  }

  function showFileMenu(ev, item) {
    ev.preventDefault();
    if (!state.selected.has(item.path)) selectOnly(item.path);
    const items = selectedItems();
    const one = items.length === 1;
    const singleFile = one && items[0].type === 'file';
    const entries = [];
    entries.push({ label: item.type === 'dir' ? '打开文件夹' : '打开', fn: () => openItem(item) });
    if (one) entries.push({ label: '重命名', fn: renameSelected });
    entries.push({ label: '移动到…', fn: moveSelected });
    entries.push({ label: '复制到…', fn: copySelected });
    entries.push({ label: '标签…', fn: tagSelected });
    if (singleFile) entries.push({ label: '下载', fn: downloadSelected });
    entries.push({ type: 'sep' });
    entries.push({ label: '删除（移到回收站）', danger: true, fn: deleteSelected });
    showContextMenu(ev.clientX, ev.clientY, entries);
  }

  async function downloadSelected() {
    const items = selectedItems();
    if (items.length !== 1 || items[0].type !== 'file') return;
    downloadItem(items[0]);
  }

  // ---------------- 事件绑定 ----------------

  $('nav-all').onclick = () => { state.selected.clear(); loadDir(state.root); };
  $('nav-trash').onclick = () => loadTrash();
  $('new-tag').onclick = () => createTagFlow();
  $('btn-new-folder').onclick = newFolder;
  $('btn-upload').onclick = () => $('upload-input').click();
  $('btn-refresh').onclick = () => reloadCurrent();
  $('btn-rename').onclick = renameSelected;
  $('btn-move').onclick = moveSelected;
  $('btn-copy').onclick = copySelected;
  $('btn-tag').onclick = tagSelected;
  $('btn-download').onclick = downloadSelected;
  $('btn-delete').onclick = deleteSelected;
  $('btn-empty-trash').onclick = emptyTrash;

  $('upload-input').onchange = async ev => {
    const files = ev.target.files;
    ev.target.value = '';
    if (state.view === 'all') await uploadFiles(files, state.cwd);
  };

  $('select-all').onchange = ev => {
    state.selected.clear();
    if (ev.target.checked) for (const item of state.items) state.selected.add(item.path);
    syncSelectionUI();
  };

  listEl.addEventListener('dragover', ev => {
    if (hasDrag(ev)) ev.preventDefault();
  });
  listEl.addEventListener('drop', ev => {
    if (ev.target === listEl) {
      if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
        ev.preventDefault();
        if (state.view === 'all') uploadFiles(ev.dataTransfer.files, state.cwd);
      }
    }
  });

  document.addEventListener('keydown', ev => {
    const tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (ev.target && ev.target.isContentEditable)) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (state.selected.size) { ev.preventDefault(); deleteSelected(); }
    } else if (ev.key === 'F2') {
      if (state.selected.size === 1) { ev.preventDefault(); renameSelected(); }
    } else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'a') {
      ev.preventDefault();
      state.selected.clear();
      for (const item of state.items) state.selected.add(item.path);
      syncSelectionUI();
    } else if (ev.key === 'Enter') {
      const items = selectedItems();
      if (items.length === 1) { ev.preventDefault(); openItem(items[0]); }
    }
  });

  init().catch(e => {
    if (e && e.message === '未登录') return;
    listEl.innerHTML = '';
    const box = el('div', 'empty', '加载失败：' + (e && e.message || e));
    listEl.appendChild(box);
  });
})();
