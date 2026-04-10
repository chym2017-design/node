// ================================================================
//  UDD App Controller
//  Session management, toolbar, sidebar, repository panel,
//  file operations, keyboard shortcuts, PWA manifest
// ================================================================

// Strip rendering fields from node data, keeping only content values
function stripRenderFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    // Keep content and body
    if (k === 'content' || k === 'body') { result[k] = v; continue; }
    // Keep child tNode keys (recursively strip)
    if (isTNode(k)) { result[k] = stripRenderFields(v); continue; }
    // Skip everything else (meta, type_global, hide, hide_body, styles, etc.)
  }
  return result;
}

//  APP CONTROLLER
// ================================================================
class App {
  constructor() {
    // Multi-document session management
    this.sessions = [];
    this.activeSessionId = null;

    // Create initial session
    const initData = createDefaultData();
    const initSession = this._createSessionObj('未命名文档', initData, null, null);
    this.sessions.push(initSession);
    this.activeSessionId = initSession.id;

    // Expose convenience accessors
    this.currentView = 'outline';
    this.renderMode = true;
    this.sidebarMode = 'raw'; // 'raw' or 'values'
    this.contentSource = 'embedded'; // 'embedded' | 'repo'
    this._embeddedMedia = {};    // { 'udd.media/media_0.jpg': Blob }
    this._embeddedMediaUrls = {}; // blob URL cache
    this._embeddedRefDocs = {};  // { 'docName': data }

    this.outlineView = new OutlineView(document.getElementById('outline-view'));
    this.mindmapView = new MindmapView(document.getElementById('mindmap-view'));
    this.documentView = new DocumentView(document.getElementById('document-view'));
    this.sheetView = new SheetView(document.getElementById('sheet-view'));
    this.sheetView.resetWithDefaultData();
    this.pptView = new PptView(document.getElementById('ppt-view'));
    this.lastFgColor = '#1e293b';
    this.lastBgColor = '#ffffff';
    this.savedSelection = null;

    // Repository panel state
    this.repoDir = null;
    this.repoServerUrl = '';
    this._repoFiles = [];

    // Format switches
    this.outlineFmt = { font: true, font_size: true, color: true, bold: true,
      italic: false, underline: false, strikethrough: false, background_color: false, text_align: false, tree_lines: false, body_border: false };
    this.documentFmt = { font: true, font_size: true, color: true, bold: true,
      italic: true, underline: true, strikethrough: true, background_color: true, text_align: true, tree_lines: false };
    this.initFmtSwitches();

    // Auto-save
    this.autoSaveTimer = setInterval(() => this.autoSave(), 30000);

    // Keyboard shortcuts
    document.addEventListener('keydown', e => this.onGlobalKey(e));

    // Close palettes on outside click
    document.addEventListener('click', e => {
      if (!e.target.closest('.tool-color-wrap')) this.closeAllPalettes();
    });

    // Save selection before it's lost by toolbar clicks
    document.addEventListener('selectionchange', () => {
      const el = this.getActiveEditableEl();
      if (!el) return;
      const sel = getSelectionOffsetsWithin(el);
      if (sel && sel.end > sel.start) this.savedSelection = sel;
    });

    // Doc title
    document.getElementById('doc-title').addEventListener('input', e => {
      this.data.meta.title = e.target.value;
      this.fileName = e.target.value || '未命名文档';
      document.title = 'UDD - ' + this.fileName;
      this.markDirty();
    });

    this.undoMgr.push(this.data);
    this.initColorPalettes();
  }

  // --- Session property accessors (proxy to active session) ---
  get _activeSession() { return this.sessions.find(s => s.id === this.activeSessionId); }
  get data() { const s = this._activeSession; return s ? s.data : null; }
  set data(v) { const s = this._activeSession; if (s) s.data = v; }
  get fileName() { const s = this._activeSession; return s ? s.fileName : ''; }
  set fileName(v) { const s = this._activeSession; if (s) s.fileName = v; }
  get fileHandle() { const s = this._activeSession; return s ? s.fileHandle : null; }
  set fileHandle(v) { const s = this._activeSession; if (s) s.fileHandle = v; }
  get dirty() { const s = this._activeSession; return s ? s.dirty : false; }
  set dirty(v) { const s = this._activeSession; if (s) s.dirty = v; }
  get undoMgr() { const s = this._activeSession; return s ? s.undoMgr : null; }
  set undoMgr(v) { const s = this._activeSession; if (s) s.undoMgr = v; }

  _createSessionObj(fileName, data, fileHandle, filePath) {
    const undoMgr = new UndoManager();
    return {
      id: String(Date.now()) + '_' + Math.random().toString(36).slice(2, 6),
      fileName, data: deepClone(data), fileHandle, filePath,
      undoMgr, dirty: false,
      focusPath: null, scrollTop: 0
    };
  }

  _saveCurrentSessionState() {
    const s = this._activeSession;
    if (!s) return;
    // Sync editable content
    if (this.currentView === 'outline') this.outlineView.syncAll();
    else if (this.currentView === 'document') this.documentView.syncAll();
    else if (this.currentView === 'mindmap') this.mindmapView.syncAll();
    // Save view state
    const view = this.currentView === 'outline' ? this.outlineView : this.currentView === 'mindmap' ? this.mindmapView : this.documentView;
    s.focusPath = view.focusPath;
    const editorEl = document.getElementById('editor');
    s.scrollTop = editorEl ? editorEl.scrollTop : 0;
  }

  switchSession(sessionId) {
    if (sessionId === this.activeSessionId) return;
    const target = this.sessions.find(s => s.id === sessionId);
    if (!target) return;
    // Save current session state
    this._saveCurrentSessionState();
    // Switch
    this.activeSessionId = sessionId;
    // Restore UI
    document.getElementById('doc-title').value = target.fileName;
    document.title = 'UDD - ' + target.fileName;
    // Reset views
    this.outlineView.focusPath = target.focusPath;
    this.outlineView.focusField = 'content';
    this.documentView.focusPath = target.focusPath;
    this.documentView.focusField = 'content';
    this.mindmapView.focusPath = target.focusPath;
    this.renderCurrentView();
    this._updateSourceBtn();
    this._ensureEmbeddedMediaLoaded();
    // Restore scroll
    requestAnimationFrame(() => {
      const editorEl = document.getElementById('editor');
      if (editorEl) editorEl.scrollTop = target.scrollTop;
    });
    // Update status
    if (target.dirty) {
      document.getElementById('stat-save').textContent = '● 未保存';
      document.getElementById('stat-save').style.color = '#ef4444';
    } else {
      document.getElementById('stat-save').textContent = '✓ 已保存';
      document.getElementById('stat-save').style.color = '#22c55e';
    }
    this._renderOpenDocs();
  }

  closeSession(sessionId) {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;
    if (session.dirty && !confirm(`"${session.fileName}" 未保存，确定关闭？`)) return;
    const idx = this.sessions.indexOf(session);
    this.sessions.splice(idx, 1);
    // Remove from IndexedDB
    this._removeSessionFromDB(session.id);
    if (this.sessions.length === 0) {
      // Create a new empty session
      const newData = createDefaultData();
      const newSession = this._createSessionObj('未命名文档', newData, null, null);
      this.sessions.push(newSession);
      this.activeSessionId = newSession.id;
    } else if (sessionId === this.activeSessionId) {
      // Switch to nearest session
      const newIdx = Math.min(idx, this.sessions.length - 1);
      this.activeSessionId = this.sessions[newIdx].id;
    }
    // Refresh UI
    const s = this._activeSession;
    document.getElementById('doc-title').value = s.fileName;
    document.title = 'UDD - ' + s.fileName;
    this.outlineView.focusPath = s.focusPath;
    this.documentView.focusPath = s.focusPath;
    this.mindmapView.focusPath = s.focusPath;
    this.renderCurrentView();
    this._renderOpenDocs();
  }

  async _removeSessionFromDB(sessionId) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete('session_' + sessionId);
    } catch (e) { /* ignore */ }
  }

  _addSessionAndSwitch(fileName, data, fileHandle, filePath, originPath) {
    // Check if file is already open (by filePath)
    if (filePath) {
      const existing = this.sessions.find(s => s.filePath === filePath);
      if (existing) {
        this.switchSession(existing.id);
        return;
      }
    }
    if (fileHandle) {
      const existing = this.sessions.find(s => s.fileHandle === fileHandle);
      if (existing) {
        this.switchSession(existing.id);
        return;
      }
    }
    // Ensure unique fileName (only for new docs without a source file)
    let name = fileName;
    if (!filePath && !fileHandle) {
      let n = 1;
      while (this.sessions.some(s => s.fileName === name)) {
        n++;
        name = fileName + ' ' + n;
      }
    }
    this._saveCurrentSessionState();
    const session = this._createSessionObj(name, data, fileHandle, filePath);
    if (originPath) session.originPath = originPath;
    session.undoMgr.push(data);
    this.sessions.push(session);
    this.activeSessionId = session.id;
    document.getElementById('doc-title').value = name;
    document.title = 'UDD - ' + name;
    this.outlineView.focusPath = null;
    this.documentView.focusPath = null;
    this.mindmapView.focusPath = null;
    this.renderCurrentView();
    this._renderOpenDocs();
    this._updateSourceBtn();
    this._ensureEmbeddedMediaLoaded();
  }

  _renderOpenDocs() {
    const panel = document.getElementById('open-docs-panel');
    if (!panel) return;
    // Keep title, remove old items
    const title = panel.querySelector('.open-docs-title');
    panel.innerHTML = '';
    if (title) panel.appendChild(title);
    else {
      const t = document.createElement('div');
      t.className = 'open-docs-title';
      t.textContent = '已打开的文档';
      panel.appendChild(t);
    }
    for (const s of this.sessions) {
      const item = document.createElement('div');
      item.className = 'open-doc-item' + (s.id === this.activeSessionId ? ' active' : '');
      // Dirty dot
      const dot = document.createElement('span');
      dot.className = 'open-doc-dot' + (s.dirty ? '' : ' clean');
      item.appendChild(dot);
      // Name
      const name = document.createElement('span');
      name.className = 'open-doc-name';
      name.textContent = s.fileName || '未命名文档';
      name.title = s.originPath || s.filePath || s.fileName || '';
      item.appendChild(name);
      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'open-doc-close';
      closeBtn.textContent = '×';
      closeBtn.title = '关闭';
      closeBtn.onclick = (e) => { e.stopPropagation(); this.closeSession(s.id); };
      item.appendChild(closeBtn);
      // Click to switch
      item.onclick = () => this.switchSession(s.id);
      panel.appendChild(item);
    }
  }

  async init() {

    // Try restore sessions from IndexedDB
    try {
      const idx = await dbLoad('sessions_index');
      if (idx && idx.data && idx.data.list && idx.data.list.length > 0) {
        const sessionList = idx.data.list;
        const restoredSessions = [];
        for (const meta of sessionList) {
          try {
            const saved = await dbLoad('session_' + meta.id);
            if (saved && saved.data) {
              const s = this._createSessionObj(meta.fileName, saved.data, null, meta.filePath);
              s.id = meta.id;
              s.dirty = meta.dirty || false;
              s.undoMgr.push(saved.data);
              restoredSessions.push(s);
            }
          } catch (e) { /* skip */ }
        }
        if (restoredSessions.length > 0) {
          this.sessions = restoredSessions;
          const activeId = idx.data.activeId;
          this.activeSessionId = this.sessions.find(s => s.id === activeId) ? activeId : this.sessions[0].id;
          const s = this._activeSession;
          document.getElementById('doc-title').value = s.fileName;
          document.title = 'UDD - ' + s.fileName;
          toast('已恢复 ' + restoredSessions.length + ' 个文档');
        }
      } else {
        // Fallback: try old 'current' key
        const saved = await dbLoad('current');
        if (saved && saved.data) {
          this.data = saved.data;
          this.fileName = this.data.meta?.title || '未命名文档';
          document.getElementById('doc-title').value = this.fileName;
          document.title = 'UDD - ' + this.fileName;
          this.undoMgr.push(this.data);
          toast('已恢复上次编辑');
        }
      }
    } catch (e) { /* ignore */ }
    this.renderCurrentView();
    this._renderOpenDocs();
  }

  renderCurrentView() {
    this._normalizeEmbeddedTagsInData(this.data);
    if (this.currentView === 'outline') {
      this.outlineView.render(this.data);
      this._resolveAsyncRefs(this.outlineView.el);
    } else if (this.currentView === 'mindmap') {
      this.mindmapView.render(this.data);
    } else if (this.currentView === 'sheet') {
      this.sheetView.render(this.data);
    } else if (this.currentView === 'ppt') {
      this.pptView.render(this.data).catch(e => console.error('PPT render:', e));
    } else {
      this.documentView.render(this.data);
      this._resolveAsyncRefs(this.documentView.el);
    }
  }

  async editSourceField(path, field) {
    const node = getNodeByPath(this.data, path);
    if (!node) return;
    const current = node[field] || '';
    const next = await this._showSourceEditor(current, field === 'body' ? '编辑正文源码' : '编辑内容源码');
    if (next === null || next === current) return;
    this.pushUndo();
    node[field] = next;
    this.markDirty();
    if (this.currentView === 'outline') this.outlineView.focusPath = path;
    if (this.currentView === 'document') this.documentView.focusPath = path;
    this.renderCurrentView();
    this.updateSidebar(path);
  }

  _showSourceEditor(value, title) {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:10000;display:flex;align-items:center;justify-content:center';
      const dlg = document.createElement('div');
      dlg.style.cssText = 'width:min(860px,92vw);background:#fff;border-radius:10px;box-shadow:0 12px 36px rgba(0,0,0,.18);padding:14px';
      dlg.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:15px;font-weight:600">${title}</div>
          <button type="button" data-act="cancel" style="border:none;background:none;font-size:18px;cursor:pointer;color:#64748b">×</button>
        </div>
        <textarea data-role="editor" style="width:100%;height:min(60vh,420px);resize:vertical;border:1px solid #dbe2ea;border-radius:8px;padding:10px;font:13px/1.6 Consolas,Monaco,monospace"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
          <button type="button" data-act="cancel" style="padding:6px 14px;border:1px solid #dbe2ea;background:#fff;border-radius:6px;cursor:pointer">取消</button>
          <button type="button" data-act="ok" style="padding:6px 14px;border:none;background:var(--primary);color:#fff;border-radius:6px;cursor:pointer">确定</button>
        </div>`;
      mask.appendChild(dlg);
      document.body.appendChild(mask);
      const textarea = dlg.querySelector('[data-role="editor"]');
      textarea.value = value;
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      const close = (result) => { mask.remove(); resolve(result); };
      dlg.querySelectorAll('[data-act="cancel"]').forEach(btn => btn.onclick = () => close(null));
      dlg.querySelector('[data-act="ok"]').onclick = () => close(textarea.value);
      mask.onclick = (e) => { if (e.target === mask) close(null); };
      textarea.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          close(textarea.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close(null);
        }
      });
    });
  }

  _normalizeEmbeddedTagsInData(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string' && val.includes('{{')) {
        obj[key] = val.replace(/(\{\{(?!=)(.*?)\}\})(\1)+/g, '$1');
      } else if (val && typeof val === 'object') {
        this._normalizeEmbeddedTagsInData(val);
      }
    }
  }

  _resolveAsyncRefs(viewEl) {
    viewEl.querySelectorAll('[data-ref-async]').forEach(async el => {
      const refStr = el.dataset.refAsync;
      const resolved = await resolveRefAsync(this.data, refStr);
      el.textContent = resolved;
      el.classList.toggle('ref-error', resolved.startsWith('#'));
    });
  }

  switchView(view) {
    if (this.currentView === 'outline') this.outlineView.syncAll();
    else if (this.currentView === 'document') this.documentView.syncAll();
    else if (this.currentView === 'mindmap') this.mindmapView.syncAll();
    else if (this.currentView === 'sheet') this.sheetView.syncAll();
    this.currentView = view;
    document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    document.getElementById('outline-view').classList.toggle('active', view === 'outline');
    document.getElementById('mindmap-view').classList.toggle('active', view === 'mindmap');
    document.getElementById('document-view').classList.toggle('active', view === 'document');
    document.getElementById('sheet-view').classList.toggle('active', view === 'sheet');
    document.getElementById('ppt-view').classList.toggle('active', view === 'ppt');
    this.syncFmtCheckboxes();
    this.renderCurrentView();
  }

  getCurrentFocusPath() {
    const view = this.currentView === 'outline' ? this.outlineView : this.currentView === 'mindmap' ? this.mindmapView : this.documentView;
    return view.focusPath;
  }

  getCurrentFocusField() {
    const view = this.currentView === 'outline' ? this.outlineView : this.currentView === 'mindmap' ? this.mindmapView : this.documentView;
    return view.focusField || 'content';
  }

  getActiveEditableEl() {
    const path = this.getCurrentFocusPath();
    const field = this.getCurrentFocusField();
    if (!path || !field) return null;
    if (this.currentView === 'mindmap') return null;
    const view = this.currentView === 'outline' ? this.outlineView : this.documentView;
    return view.el.querySelector(`[data-path="${path}"][data-field="${field}"]`);
  }

  getCurrentTextSelection() {
    const el = this.getActiveEditableEl();
    if (!el) return this.savedSelection;
    return getSelectionOffsetsWithin(el) || this.savedSelection;
  }

  toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const btn = document.getElementById('sidebar-toggle');
    sb.classList.toggle('active');
    btn.classList.toggle('active');
    if (sb.classList.contains('active')) {
      this.updateSidebar(this.getCurrentFocusPath());
    }
  }

  toggleRenderMode() {
    this.renderMode = !this.renderMode;
    const btn = document.getElementById('render-toggle');
    if (btn) {
      btn.textContent = '渲染 ' + (this.renderMode ? 'on' : 'off');
      btn.style.color = this.renderMode ? 'var(--gray-500)' : 'var(--primary)';
      btn.style.borderColor = this.renderMode ? 'var(--gray-200)' : 'var(--blue-200)';
      btn.style.background = this.renderMode ? 'none' : 'var(--blue-50)';
    }
    this.renderCurrentView();
  }

  toggleContentSource() {
    this.contentSource = this.contentSource === 'embedded' ? 'repo' : 'embedded';
    this._embeddedMediaUrls = {}; // clear blob URL cache on source switch
    this._updateSourceBtn();
    this.renderCurrentView();
  }

  // Lazy-load embedded media/refs from the .udd file if data has udd. paths but blobs are missing
  async _ensureEmbeddedMediaLoaded() {
    const session = this._activeSession;
    if (!session || session._embeddedLoading) return;
    const dataStr = JSON.stringify(session.data || {});
    const needsMedia = dataStr.includes('udd.media/');
    const needsRefs = dataStr.includes('udd.ref-docs.');
    if (!needsMedia && !needsRefs) return;
    const hasMedia = session.embeddedMedia && Object.keys(session.embeddedMedia).length > 0;
    const hasRefs = session.embeddedRefDocs && Object.keys(session.embeddedRefDocs).length > 0;
    if ((needsMedia && hasMedia) && (!needsRefs || hasRefs)) return;
    session._embeddedLoading = true;
    try {
      let blob = null;
      // Try fileHandle first (for local picker-opened files)
      if (session.fileHandle) {
        try {
          const file = await session.fileHandle.getFile();
          blob = file;
        } catch (e) { /* handle may be stale */ }
      }
      // Fallback: try repo server
      if (!blob && session.filePath && this.repoServerUrl) {
        const resp = await fetch(this.repoServerUrl + '/api/readfile?path=' + encodeURIComponent(session.filePath));
        if (resp.ok) blob = await resp.blob();
      }
      if (!blob) return;
      const { embeddedMedia, embeddedRefDocs } = await parseUDDBlob(blob);
      session.embeddedMedia = embeddedMedia || {};
      session.embeddedRefDocs = embeddedRefDocs || {};
      session.embeddedMediaUrls = {};
      this.renderCurrentView();
    } catch (e) { /* skip */ }
    finally { session._embeddedLoading = false; }
  }

  _updateSourceBtn() {
    const btn = document.getElementById('source-toggle');
    if (!btn) return;
    // Show button if current data contains any embedded udd. paths
    const dataStr = this.data ? JSON.stringify(this.data) : '';
    const hasEmbedded = dataStr.includes('udd.media/') || dataStr.includes('udd.ref-docs.');
    btn.style.display = hasEmbedded ? '' : 'none';
    const isEmbed = this.contentSource === 'embedded';
    btn.textContent = '来源:' + (isEmbed ? '嵌入' : '仓库');
    btn.style.color = isEmbed ? 'var(--primary)' : 'var(--gray-500)';
    btn.style.borderColor = isEmbed ? 'var(--blue-200)' : 'var(--gray-200)';
    btn.style.background = isEmbed ? 'var(--blue-50)' : 'none';
  }

  _saveBackPosition(viewInstance) {
    const editorEl = document.getElementById('editor');
    this._backStack = this._backStack || [];
    this._backStack.push({
      view: this.currentView,
      focusPath: viewInstance.focusPath,
      focusField: viewInstance.focusField || 'content',
      scrollTop: editorEl ? editorEl.scrollTop : 0
    });
    document.getElementById('back-btn').style.display = '';
  }

  goBack() {
    if (!this._backStack || !this._backStack.length) return;
    const pos = this._backStack.pop();
    if (this._backStack.length === 0) {
      document.getElementById('back-btn').style.display = 'none';
    }
    // Switch view if needed
    if (pos.view !== this.currentView) {
      this.switchView(pos.view);
    }
    const viewInstance = pos.view === 'outline' ? this.outlineView : pos.view === 'document' ? this.documentView : this.mindmapView;
    viewInstance.focusPath = pos.focusPath;
    viewInstance.focusField = pos.focusField;
    viewInstance.focusCursorEnd = false;
    viewInstance.render(viewInstance.data);
    // Restore scroll
    requestAnimationFrame(() => {
      const editorEl = document.getElementById('editor');
      if (editorEl) editorEl.scrollTop = pos.scrollTop;
      if (pos.focusPath) {
        const el = viewInstance.el.querySelector(`[data-path="${pos.focusPath}"][data-field="${pos.focusField}"]`);
        if (el) el.focus();
      }
    });
  }

  setSidebarMode(mode) {
    this.sidebarMode = mode;
    const rawTab = document.getElementById('sidebar-tab-raw');
    const valTab = document.getElementById('sidebar-tab-values');
    const json = document.getElementById('sidebar-json');
    if (mode === 'values') {
      rawTab.style.borderBottom = 'none';
      rawTab.style.color = 'var(--gray-400)';
      valTab.style.borderBottom = '2px solid var(--primary)';
      valTab.style.color = '';
      json.readOnly = true;
    } else {
      rawTab.style.borderBottom = '2px solid var(--primary)';
      rawTab.style.color = '';
      valTab.style.borderBottom = 'none';
      valTab.style.color = 'var(--gray-400)';
      json.readOnly = false;
    }
    this.updateSidebar(this.getCurrentFocusPath());
  }

  updateSidebar(path) {
    if (!document.getElementById('sidebar').classList.contains('active')) return;
    const json = document.getElementById('sidebar-json');
    let dataToShow;
    if (path) {
      const node = getNodeByPath(this.data, path);
      const parts = path.split('.');
      const key = parts[parts.length - 1];
      const wrapped = {};
      wrapped[key] = node;
      dataToShow = wrapped;
      json.dataset.path = path;
    } else {
      dataToShow = this.data;
      json.dataset.path = '';
    }
    if (this.sidebarMode === 'values') {
      json.value = JSON.stringify(stripRenderFields(dataToShow), null, 2);
    } else {
      json.value = JSON.stringify(dataToShow, null, 2);
    }
  }

  showAllSidebarData() {
    const sb = document.getElementById('sidebar');
    if (!sb.classList.contains('active')) {
      sb.classList.add('active');
      document.getElementById('sidebar-toggle').classList.add('active');
    }
    const json = document.getElementById('sidebar-json');
    json.value = JSON.stringify(this.data, null, 2);
    json.dataset.path = '';
  }

  applySidebarJSON() {
    const json = document.getElementById('sidebar-json');
    const path = json.dataset.path;
    try {
      const parsed = JSON.parse(json.value);
      this.pushUndo();
      if (path) {
        const { parent, key } = getParentAndKey(this.data, path);
        // Handle wrapped format: { "t1-1": {...} }
        if (parsed[key] !== undefined) {
          parent[key] = parsed[key];
        } else {
          parent[key] = parsed;
        }
      } else {
        this.data = parsed;
      }
      this.renderCurrentView();
      this.markDirty();
      toast('已应用修改');
    } catch (e) {
      toast('JSON 格式错误: ' + e.message);
    }
  }

  updateToolbar(path) {
    if (!path) return;
    const level = getLevel(path.split('.').pop());
    const isBody = this.getCurrentFocusField() === 'body';
    const style = buildNodeStyle(this.data, path, level, { isBody });

    if (style.font) document.getElementById('tool-font').value = style.font;
    if (style.font_size) document.getElementById('tool-size').value = style.font_size;
    document.getElementById('tool-bold').classList.toggle('active', !!style.bold);
    document.getElementById('tool-italic').classList.toggle('active', !!style.italic);
    document.getElementById('tool-underline').classList.toggle('active', !!style.underline);
    document.getElementById('tool-strike').classList.toggle('active', !!style.strikethrough);
    if (style.color) {
      const hex = rgbToHex(String(style.color));
      this.lastFgColor = hex;
      document.getElementById('tool-color-preview').style.background = hex;
    }
    if (style.background_color) {
      const hex = rgbToHex(String(style.background_color));
      this.lastBgColor = hex;
      document.getElementById('tool-bg-preview').style.background = hex;
    }
    const align = style.text_align;
    document.getElementById('tool-align-left').classList.toggle('active', align === 'left' || !align);
    document.getElementById('tool-align-center').classList.toggle('active', align === 'center');
    document.getElementById('tool-align-right').classList.toggle('active', align === 'right');
  }

  setNodeStyle(field, value) {
    this.applyStyleChange(field, value, { mode: 'set' });
  }

  toggleStyle(field) {
    this.applyStyleChange(field, null, { mode: 'toggle' });
  }

  applyStyleChange(field, value, opts = {}) {
    const path = this.getCurrentFocusPath();
    if (!path) return;
    this.pushUndo();
    const node = getNodeByPath(this.data, path);
    if (!node) return;
    const focusField = this.getCurrentFocusField();
    const key = focusField === 'body' ? `body.${field}` : field;
    const level = getLevel(path.split('.').pop());
    const isBody = focusField === 'body';
    const style = buildNodeStyle(this.data, path, level, { isBody });
    const baseValue = style[field];
    const selection = this.getCurrentTextSelection();
    this.savedSelection = null;
    const canRange = RANGEABLE_STYLE_FIELDS.has(field);
    const isTextField = focusField === 'content' || focusField === 'body';
    if (selection && selection.end > selection.start && canRange && isTextField) {
      const rawText = node[focusField] || '';
      const text = stripMediaTags(rawText);
      const textLength = text.length;
      let targetValue = value;
      if (opts.mode === 'toggle') {
        const descriptor = getRangeStyleDescriptor(node[key], baseValue);
        const uniform = getValueForRange(descriptor, selection.start, selection.end);
        const enabled = !!uniform;
        targetValue = enabled ? 0 : 1;
      }
      node[key] = applyRangeStyleValue(node[key], targetValue, selection, baseValue, textLength);
    } else if (opts.mode === 'toggle') {
      const current = node[key];
      const resolved = current !== undefined ? resolveStyleBaseValue(current) : baseValue;
      node[key] = resolved ? 0 : 1;
    } else {
      node[key] = value;
    }
    this.renderCurrentView();
    this.markDirty();
  }

  setColor(hex) {
    this.lastFgColor = hex;
    document.getElementById('tool-color-preview').style.background = hex;
    this.setNodeStyle('color', hexToRgb(hex));
  }

  setBgColor(hex) {
    this.lastBgColor = hex;
    document.getElementById('tool-bg-preview').style.background = hex;
    this.setNodeStyle('background_color', hexToRgb(hex));
  }

  applyLastColor(type) {
    if (type === 'fg') this.setColor(this.lastFgColor);
    else this.setBgColor(this.lastBgColor);
  }

  // Color palette
  initColorPalettes() {
    this.buildPalette('palette-fg', 'fg');
    this.buildPalette('palette-bg', 'bg');
  }

  buildPalette(containerId, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const grid = document.createElement('div');
    grid.className = 'color-palette-grid';
    for (const color of PALETTE_COLORS) {
      const span = document.createElement('span');
      span.style.background = color;
      span.onclick = (e) => {
        e.stopPropagation();
        if (type === 'fg') this.setColor(color);
        else this.setBgColor(color);
        this.closeAllPalettes();
      };
      grid.appendChild(span);
    }
    container.appendChild(grid);
    const custom = document.createElement('div');
    custom.className = 'color-palette-custom';
    custom.innerHTML = '自定义: ';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = type === 'fg' ? this.lastFgColor : this.lastBgColor;
    input.onchange = (e) => {
      if (type === 'fg') this.setColor(e.target.value);
      else this.setBgColor(e.target.value);
      this.closeAllPalettes();
    };
    custom.appendChild(input);
    container.appendChild(custom);
  }

  toggleColorPalette(type) {
    const id = type === 'fg' ? 'palette-fg' : 'palette-bg';
    const el = document.getElementById(id);
    const otherId = type === 'fg' ? 'palette-bg' : 'palette-fg';
    document.getElementById(otherId)?.classList.remove('show');
    if (el) {
      const isShowing = el.classList.toggle('show');
      if (isShowing) {
        const wrapId = type === 'fg' ? 'color-wrap-fg' : 'color-wrap-bg';
        const wrap = document.getElementById(wrapId);
        const rect = wrap.getBoundingClientRect();
        el.style.top = rect.bottom + 2 + 'px';
        el.style.left = rect.left + 'px';
      }
    }
  }

  closeAllPalettes() {
    document.querySelectorAll('.color-palette').forEach(p => p.classList.remove('show'));
  }

  // Format switches
  initFmtSwitches() {
    const container = document.getElementById('fmt-switches');
    if (!container) return;
    this.syncFmtCheckboxes();
    container.querySelectorAll('input[data-fmt]').forEach(cb => {
      cb.onchange = () => {
        const fmt = this.currentView === 'outline' ? this.outlineFmt : this.documentFmt;
        fmt[cb.dataset.fmt] = cb.checked;
        this.renderCurrentView();
      };
    });
  }

  syncFmtCheckboxes() {
    const fmt = this.currentView === 'outline' ? this.outlineFmt : this.documentFmt;
    document.querySelectorAll('#fmt-switches input[data-fmt]').forEach(cb => {
      cb.checked = !!fmt[cb.dataset.fmt];
    });
  }

  // Insert table reference
  insertTableRef() {
    const nodePath = this.getCurrentFocusPath();
    if (!nodePath) { toast('请先选中一个节点'); return; }
    const field = this.getCurrentFocusField();
    const sheetNames = (this.sheetView && this.sheetView.workbook) ? this.sheetView.workbook.SheetNames : ['Sheet1'];
    const defaultSheet = sheetNames[0] || 'Sheet1';
    const input = prompt('插入表格引用\n格式: 表格名.起始:结束\n例如: Sheet1.A1:C4\n跨文档: 文件名.Sheet1.A1:C4', defaultSheet + '.A1:C4');
    if (!input) return;
    this.pushUndo();
    const node = getNodeByPath(this.data, nodePath);
    if (!node) return;
    const tag = '{{' + input + '}}';
    const curVal = node[field] || '';
    node[field] = curVal.endsWith(tag) ? curVal : curVal + tag;
    this.markDirty();
    this.renderCurrentView();
  }

  // Media insert
  async insertMedia() {
    const nodePath = this.getCurrentFocusPath();
    if (!nodePath) { toast('请先选中一个节点'); return; }

    if (this.repoServerUrl) {
      this._showMediaPicker(nodePath);
    } else {
      toast('请先连接服务器（运行 node server.js）');
    }
  }

  async _showMediaPicker(nodePath) {
    const MEDIA_EXTS = ['.png','.jpg','.jpeg','.gif','.svg','.webp','.bmp','.mp4','.webm','.ogg','.mov','.avi','.mp3','.wav','.aac'];
    let currentDir = this.repoDir || '';
    let selectedItem = null;

    const mask = document.createElement('div');
    mask.id = 'media-picker-mask';
    const picker = document.createElement('div');
    picker.id = 'media-picker';
    picker.innerHTML = `
      <div class="mp-header"><span>选择媒体文件</span><button onclick="this.closest('#media-picker-mask').remove()" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--gray-400)">×</button></div>
      <div class="mp-nav"><button id="mp-up" title="上级目录">↑</button><span class="mp-path" id="mp-path"></span></div>
      <div class="mp-list" id="mp-list"></div>
      <div class="mp-actions"><button class="btn" id="mp-cancel">取消</button><button class="btn btn-primary" id="mp-ok" disabled>确定</button></div>`;
    mask.appendChild(picker);
    document.body.appendChild(mask);

    const pathEl = picker.querySelector('#mp-path');
    const listEl = picker.querySelector('#mp-list');
    const okBtn = picker.querySelector('#mp-ok');
    const cancelBtn = picker.querySelector('#mp-cancel');
    const upBtn = picker.querySelector('#mp-up');

    const loadDir = async (dir) => {
      currentDir = dir;
      pathEl.textContent = dir;
      listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-400)">加载中...</div>';
      selectedItem = null;
      okBtn.disabled = true;
      try {
        const resp = await fetch(this.repoServerUrl + '/api/files?dir=' + encodeURIComponent(dir));
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const json = await resp.json();
        currentDir = json.dir;
        pathEl.textContent = json.dir;
        listEl.innerHTML = '';
        for (const item of json.items) {
          if (item.type === 'file' && !MEDIA_EXTS.includes(item.ext)) continue;
          const el = document.createElement('div');
          el.className = 'mp-item';
          const icon = document.createElement('span');
          icon.className = 'mp-item-icon';
          if (item.type === 'dir') icon.textContent = '📁';
          else if (['.mp4','.webm','.ogg','.mov','.avi'].includes(item.ext)) icon.textContent = '📹';
          else if (['.mp3','.wav','.aac'].includes(item.ext)) icon.textContent = '🔊';
          else icon.textContent = '🖼';
          el.appendChild(icon);
          const name = document.createElement('span');
          name.className = 'mp-item-name';
          name.textContent = item.name;
          el.appendChild(name);
          el.onclick = () => {
            if (item.type === 'dir') { loadDir(item.path); return; }
            listEl.querySelectorAll('.mp-item').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
            selectedItem = item;
            okBtn.disabled = false;
          };
          el.ondblclick = () => {
            if (item.type === 'dir') { loadDir(item.path); return; }
            selectedItem = item;
            confirmSelection();
          };
          listEl.appendChild(el);
        }
        if (listEl.children.length === 0) {
          listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-400)">无媒体文件</div>';
        }
      } catch (e) {
        listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#ef4444">' + e.message + '</div>';
      }
    };

    const confirmSelection = () => {
      if (!selectedItem) return;
      mask.remove();
      const absPath = selectedItem.path;
      const ext = selectedItem.ext.toLowerCase();
      const isVideo = ['.mp4','.webm','.ogg','.mov','.avi'].includes(ext);
      const isAudio = ['.mp3','.wav','.aac'].includes(ext);
      const mediaType = isVideo ? 'video' : isAudio ? 'audio' : 'image';
      const tag = `{{"${mediaType}":"${absPath.replace(/\\/g, '\\\\')}","${mediaType}.width":"100%"}}`;
      this.pushUndo();
      const node = getNodeByPath(this.data, nodePath);
      if (!node) return;
      const v = this.currentView === 'outline' ? this.outlineView : this.currentView === 'mindmap' ? this.mindmapView : this.documentView;
      const field = v.focusField || 'body';
      if (field === 'body') {
        node.body = (node.body || '') + tag;
        node.hide_body = 0;
      } else {
        node.content = (node.content || '') + tag;
      }
      this.renderCurrentView();
      this.markDirty();
      toast('已插入' + (isVideo ? '视频' : isAudio ? '音频' : '图片'));
    };

    upBtn.onclick = () => {
      const parent = currentDir.replace(/[\\/][^\\/]+$/, '');
      if (parent && parent !== currentDir) loadDir(parent);
    };
    cancelBtn.onclick = () => mask.remove();
    okBtn.onclick = confirmSelection;
    mask.onclick = (e) => { if (e.target === mask) mask.remove(); };

    loadDir(currentDir);
  }

  resolveMediaSrc(src) {
    if (!src) return src;
    // udd.media/ prefix: embedded content stored per-session
    if (src.startsWith('udd.media/')) {
      const useEmbedded = this.contentSource !== 'repo';
      const session = this._activeSession;
      const media = session && session.embeddedMedia;
      if (useEmbedded && media && media[src]) {
        if (!session.embeddedMediaUrls) session.embeddedMediaUrls = {};
        if (!session.embeddedMediaUrls[src]) {
          session.embeddedMediaUrls[src] = URL.createObjectURL(media[src]);
        }
        return session.embeddedMediaUrls[src];
      }
      return '';
    }
    if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('file:')) return src;
    // Use server proxy for local absolute paths
    if (/^[A-Za-z]:[\\/]/.test(src) && this.repoServerUrl) {
      return this.repoServerUrl + '/api/readfile?path=' + encodeURIComponent(src);
    }
    if (/^[A-Za-z]:[\\/]/.test(src)) return 'file:///' + src.replace(/\\/g, '/');
    return src;
  }

  setNumbering(style) {
    this.pushUndo();
    this.data.type_global.numbering_style = style;
    this.renderCurrentView();
    this.markDirty();
  }

  // Undo / Redo
  pushUndo() { this.undoMgr.push(this.data); }
  undo() {
    if (this.currentView === 'outline') this.outlineView.syncAll();
    else if (this.currentView === 'document') this.documentView.syncAll();
    else if (this.currentView === 'mindmap') this.mindmapView.syncAll();
    const d = this.undoMgr.undo();
    if (d) { this.data = d; this.renderCurrentView(); this.markDirty(); toast('撤销'); }
  }
  redo() {
    const d = this.undoMgr.redo();
    if (d) { this.data = d; this.renderCurrentView(); this.markDirty(); toast('重做'); }
  }
  expandToLevel() {
    const n = parseInt(document.getElementById('tool-fold-n').value) || 5;
    this.pushUndo();
    setFoldByLevel(this.data, n);
    this.renderCurrentView(); this.markDirty();
  }
  expandAll() {
    this.pushUndo();
    setFoldByLevel(this.data, Infinity);
    this.renderCurrentView(); this.markDirty();
  }

  // Dirty / save state
  markDirty() {
    this.dirty = true;
    document.getElementById('stat-save').textContent = '● 未保存';
    document.getElementById('stat-save').style.color = '#ef4444';
    this.debouncedAutoSave();
    this.debouncedRefreshRefs();
    this._debouncedRenderOpenDocs();
  }
  markClean() {
    this.dirty = false;
    document.getElementById('stat-save').textContent = '✓ 已保存';
    document.getElementById('stat-save').style.color = '#22c55e';
    this._debouncedRenderOpenDocs();
  }

  _debouncedRenderOpenDocs = debounce(() => this._renderOpenDocs(), 500);

  debouncedAutoSave = debounce(() => this.autoSave(), 5000);
  debouncedRefreshRefs = debounce(() => {
    const viewEl = this.currentView === 'outline' ? this.outlineView.el
      : this.currentView === 'document' ? this.documentView.el : null;
    if (viewEl) refreshRefs(viewEl, this.data);
  }, 300);

  async autoSave() {
    // Save all dirty sessions
    if (this.currentView === 'outline') this.outlineView.syncAll();
    else if (this.currentView === 'document') this.documentView.syncAll();
    else if (this.currentView === 'mindmap') this.mindmapView.syncAll();
    let anyDirty = false;
    try {
      for (const s of this.sessions) {
        if (!s.dirty) continue;
        anyDirty = true;
        s.data.meta.modified = new Date().toISOString();
        await dbSave('session_' + s.id, s.data);
        const docTitle = s.data.meta?.title;
        if (docTitle && docTitle !== '未命名文档') {
          await dbSaveNamedDoc(docTitle, s.data);
        }
      }
      // Save session index
      const index = this.sessions.map(s => ({
        id: s.id, fileName: s.fileName, filePath: s.filePath, dirty: s.dirty
      }));
      await dbSave('sessions_index', { list: index, activeId: this.activeSessionId });
      if (anyDirty || this.dirty) this.markClean();
    } catch (e) { console.error('Auto-save failed:', e); }
  }

  // File operations
  async newFile() {
    const newData = createDefaultData();
    const baseName = '未命名文档';
    let name = baseName;
    let n = 1;
    while (this.sessions.some(s => s.fileName === name)) {
      n++;
      name = baseName + ' ' + n;
    }
    newData.meta.title = name;
    this.sheetView.resetWithDefaultData();
    this._addSessionAndSwitch(name, newData, null, null);
    this.outlineView.focusPath = 't0-1';
    this.renderCurrentView();
    toast('已新建文档');
  }

  async openFile() {
    try {
      let file, handle = null;
      if (window.showOpenFilePicker) {
        const [h] = await window.showOpenFilePicker({
          types: [
            { description: 'UDD文档', accept: { 'application/zip': ['.udd'] } },
            { description: 'JSON文件', accept: { 'application/json': ['.json'] } }
          ]
        });
        handle = h;
        file = await h.getFile();
      } else {
        file = await new Promise(resolve => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.udd,.json';
          input.onchange = () => resolve(input.files[0]);
          input.click();
        });
      }

      if (!file) return;

      let data;
      let embeddedMedia = {}, embeddedRefDocs = {};
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        data = JSON.parse(text);
      } else {
        ({ data, embeddedMedia, embeddedRefDocs } = await parseUDDBlob(file));
      }

      const name = file.name.replace(/\.(udd|json)$/i, '') || data.meta?.title || '未命名文档';
      // Browser security: full path unavailable for local picker; use filename only
      this._addSessionAndSwitch(name, data, handle, null, file.name);
      if (this._activeSession) {
        this._activeSession.embeddedMedia = embeddedMedia;
        this._activeSession.embeddedRefDocs = embeddedRefDocs;
        this._activeSession.embeddedMediaUrls = {};
      }
      this._updateSourceBtn();
      toast('已打开: ' + file.name);
    } catch (e) {
      if (e.name !== 'AbortError') toast('打开失败: ' + e.message);
    }
  }

  // Show save options dialog, returns {embedMedia, embedRefs} or null if cancelled
  _showSaveOptions() {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:9999;display:flex;align-items:center;justify-content:center';
      const dlg = document.createElement('div');
      dlg.style.cssText = 'background:#fff;border-radius:8px;padding:20px 24px;min-width:280px;box-shadow:0 4px 20px rgba(0,0,0,.2)';
      dlg.innerHTML = `
        <div style="font-weight:600;font-size:15px;margin-bottom:12px">保存选项</div>
        <label style="display:block;margin:8px 0;cursor:pointer"><input type="checkbox" id="save-embed-media"> 嵌入媒体（图片/视频/音频文件）</label>
        <label style="display:block;margin:8px 0;cursor:pointer"><input type="checkbox" id="save-embed-refs"> 嵌入引用（跨文档引用、表格数据）</label>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button id="save-cancel" style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer">取消</button>
          <button id="save-ok" style="padding:6px 16px;border:none;border-radius:4px;background:var(--primary);color:#fff;cursor:pointer">保存</button>
        </div>`;
      mask.appendChild(dlg);
      document.body.appendChild(mask);
      dlg.querySelector('#save-cancel').onclick = () => { mask.remove(); resolve(null); };
      mask.onclick = e => { if (e.target === mask) { mask.remove(); resolve(null); } };
      dlg.querySelector('#save-ok').onclick = () => {
        const embedMedia = dlg.querySelector('#save-embed-media').checked;
        const embedRefs = dlg.querySelector('#save-embed-refs').checked;
        mask.remove();
        resolve({ embedMedia, embedRefs });
      };
    });
  }

  async saveFile() {
    if (this.currentView === 'outline') this.outlineView.syncAll();
    else if (this.currentView === 'document') this.documentView.syncAll();
    else if (this.currentView === 'mindmap') this.mindmapView.syncAll();
    this.data.meta.modified = new Date().toISOString();
    this.data.meta.title = this.fileName;

    const opts = await this._showSaveOptions();
    if (!opts) return;

    try {
      toast('正在保存...');
      const blob = await createUDDBlob(this.data, opts);
      if (this.fileHandle) {
        try {
          // Re-request permission if needed (handle may have gone stale)
          if (this.fileHandle.requestPermission) {
            const perm = await this.fileHandle.requestPermission({ mode: 'readwrite' });
            if (perm !== 'granted') throw new Error('未获得写入权限');
          }
          const writable = await this.fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        } catch (handleErr) {
          throw new Error('文件写入失败: ' + handleErr.message);
        }
      } else if (this._activeSession && this._activeSession.filePath && this.repoServerUrl) {
        const resp = await fetch(this.repoServerUrl + '/api/writefile?path=' + encodeURIComponent(this._activeSession.filePath), {
          method: 'POST', body: blob
        });
        if (!resp.ok) throw new Error('服务器写入失败: HTTP ' + resp.status);
      } else {
        await this.saveFileAs();
        return;
      }
      if (this.fileName && this.fileName !== '未命名文档') {
        await dbSaveNamedDoc(this.fileName, this.data);
      }
      this.markClean();
      toast('已保存');
    } catch (e) {
      if (e.name !== 'AbortError') toast('保存失败: ' + e.message);
    }
  }

  async saveFileAs() {
    if (this.currentView === 'outline') this.outlineView.syncAll();
    else if (this.currentView === 'document') this.documentView.syncAll();
    else if (this.currentView === 'mindmap') this.mindmapView.syncAll();
    this.data.meta.modified = new Date().toISOString();
    this.data.meta.title = this.fileName;

    const opts = await this._showSaveOptions();
    if (!opts) return;

    try {
      toast('正在保存...');
      const blob = await createUDDBlob(this.data, opts);
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: this.fileName + '.udd',
          types: [{ description: 'UDD文档', accept: { 'application/zip': ['.udd'] } }]
        });
        this.fileHandle = handle;
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = this.fileName + '.udd';
        a.click(); URL.revokeObjectURL(url);
      }
      this.markClean();
      toast('已保存');
    } catch (e) {
      if (e.name !== 'AbortError') toast('保存失败: ' + e.message);
    }
  }

  async exportJSON() {
    if (this.currentView === 'outline') this.outlineView.syncAll();
    else if (this.currentView === 'document') this.documentView.syncAll();
    else if (this.currentView === 'mindmap') this.mindmapView.syncAll();
    const json = JSON.stringify(this.data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = this.fileName + '.json';
    a.click(); URL.revokeObjectURL(url);
    toast('已导出 JSON');
  }

  async importJSON() {
    try {
      const file = await new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json';
        input.onchange = () => resolve(input.files[0]);
        input.click();
      });
      if (!file) return;
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.meta && !data.type_global) {
        toast('JSON 不符合 UDD 数据格式'); return;
      }
      this.pushUndo();
      this.data = data;
      this.fileName = data.meta?.title || '导入文档';
      document.getElementById('doc-title').value = this.fileName;
      document.title = 'UDD - ' + this.fileName;
      this.renderCurrentView();
      this.markDirty();
      toast('已导入');
    } catch (e) {
      toast('导入失败: ' + e.message);
    }
  }

  // Global keyboard shortcuts
  onGlobalKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 's') { e.preventDefault(); this.saveFile(); }
    if (ctrl && e.key === 'n') { e.preventDefault(); this.newFile(); }
    if (ctrl && e.key === 'o') { e.preventDefault(); this.openFile(); }
    if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
    if (ctrl && e.key === 'z' && e.shiftKey) { e.preventDefault(); this.redo(); }
    if (ctrl && e.key === 'Z') { e.preventDefault(); this.redo(); }
    if (ctrl && e.key === '\\') { e.preventDefault(); this.toggleSidebar(); }
    if (ctrl && e.key === '1') { e.preventDefault(); this.switchView('outline'); }
    if (ctrl && e.key === '2') { e.preventDefault(); this.switchView('mindmap'); }
    if (ctrl && e.key === '3') { e.preventDefault(); this.switchView('document'); }
    if (ctrl && e.key === 'b') { e.preventDefault(); this.toggleStyle('bold'); }
    if (ctrl && e.key === 'i') { e.preventDefault(); this.toggleStyle('italic'); }
    if (ctrl && e.key === 'u') { e.preventDefault(); this.toggleStyle('underline'); }
  }

  // ================================================================
  //  REPOSITORY PANEL
  // ================================================================
  toggleRepo() {
    const panel = document.getElementById('repo-panel');
    const btn = document.getElementById('repo-toggle');
    panel.classList.toggle('active');
    btn.classList.toggle('active');
    if (panel.classList.contains('active') && !this.repoDir) {
      this._detectServer();
    }
  }

  async _detectServer() {
    // Try to detect local server
    const tryUrls = [
      window.location.origin,  // if served from server.js
      'http://localhost:8080',
      'http://localhost:3000',
      'http://127.0.0.1:8080',
    ];
    for (const base of tryUrls) {
      try {
        const resp = await fetch(base + '/api/root', { signal: AbortSignal.timeout(1500) });
        if (resp.ok) {
          const json = await resp.json();
          this.repoServerUrl = base;
          this.repoDir = json.root;
          localStorage.setItem('udd_server_url', base);
          localStorage.setItem('udd_repo_dir', this.repoDir);
          this._renderRepoList();
          return;
        }
      } catch (e) { /* skip */ }
    }
    // No server found
    const savedUrl = localStorage.getItem('udd_server_url');
    if (savedUrl) {
      this.repoServerUrl = savedUrl;
      this.repoDir = localStorage.getItem('udd_repo_dir') || '';
    }
    document.getElementById('repo-status').textContent = '未连接服务器。运行: node server.js';
    document.getElementById('repo-path').textContent = '点击此处配置服务器地址';
  }

  async repoGoUp() {
    if (!this.repoDir || !this.repoServerUrl) return;
    try {
      const resp = await fetch(this.repoServerUrl + '/api/files?dir=' + encodeURIComponent(this.repoDir));
      const json = await resp.json();
      if (json.parent && json.parent !== this.repoDir) {
        this.repoDir = json.parent;
        this._renderRepoList();
      }
    } catch (e) { toast('无法访问: ' + e.message); }
  }

  repoRefresh() {
    this._renderRepoList();
  }

  repoPromptDir() {
    const newDir = prompt('输入目录路径:', this.repoDir || 'D:\\projects\\node');
    if (newDir) {
      this.repoDir = newDir;
      localStorage.setItem('udd_repo_dir', newDir);
      this._renderRepoList();
    }
    if (!this.repoServerUrl) {
      const url = prompt('输入服务器地址:', 'http://localhost:8080');
      if (url) {
        this.repoServerUrl = url.replace(/\/+$/, '');
        localStorage.setItem('udd_server_url', this.repoServerUrl);
        this._renderRepoList();
      }
    }
  }

  async _renderRepoList() {
    const listEl = document.getElementById('repo-list');
    const pathEl = document.getElementById('repo-path');
    const statusEl = document.getElementById('repo-status');
    if (!this.repoDir || !this.repoServerUrl) {
      pathEl.textContent = '点击配置目录';
      listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-400);font-size:12px">请先运行 node server.js<br>然后刷新此页面</div>';
      return;
    }
    pathEl.textContent = this.repoDir;
    statusEl.textContent = '加载中...';
    try {
      const resp = await fetch(this.repoServerUrl + '/api/files?dir=' + encodeURIComponent(this.repoDir));
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const json = await resp.json();
      this.repoDir = json.dir;
      this._repoFiles = json.items;
      listEl.innerHTML = '';

      for (const item of json.items) {
        const el = document.createElement('div');
        el.className = 'repo-item';

        const icon = document.createElement('span');
        icon.className = 'repo-item-icon';
        if (item.type === 'dir') icon.textContent = '📁';
        else if (item.ext === '.udd') icon.textContent = '📄';
        else if (item.ext === '.json') icon.textContent = '📋';
        else if (item.ext === '.md') icon.textContent = '📝';
        else if (['.png','.jpg','.jpeg','.gif','.svg','.webp'].includes(item.ext)) icon.textContent = '🖼';
        else icon.textContent = '📃';
        el.appendChild(icon);

        const name = document.createElement('span');
        name.className = 'repo-item-name';
        name.textContent = item.name;
        el.appendChild(name);

        if (item.ext === '.udd') {
          const badge = document.createElement('span');
          badge.className = 'repo-item-badge';
          badge.textContent = 'UDD';
          el.appendChild(badge);
        }

        el.onclick = () => this._repoItemClick(item);
        el.ondblclick = () => this._repoItemDblClick(item);
        listEl.appendChild(el);
      }

      const uddCount = json.items.filter(i => i.ext === '.udd').length;
      statusEl.textContent = json.items.length + ' 项' + (uddCount > 0 ? '，' + uddCount + ' 个UDD文档' : '');

      // Preload all .udd files in this directory into ref cache
      this._preloadRepoUDDs(json.items.filter(i => i.ext === '.udd'));

    } catch (e) {
      listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#ef4444;font-size:12px">加载失败: ' + e.message + '</div>';
      statusEl.textContent = '错误';
    }
  }

  _repoItemClick(item) {
    if (item.type === 'dir') {
      this.repoDir = item.path;
      this._renderRepoList();
    }
    // Highlight active
    document.querySelectorAll('.repo-item').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');
  }

  async _repoItemDblClick(item) {
    if (item.type === 'dir') return;
    if (item.ext === '.udd' || item.ext === '.json') {
      // Check if already open
      const existing = this.sessions.find(s => s.filePath === item.path);
      if (existing) {
        this.switchSession(existing.id);
        return;
      }
      try {
        const resp = await fetch(this.repoServerUrl + '/api/readfile?path=' + encodeURIComponent(item.path));
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        let data, embeddedMedia = {}, embeddedRefDocs = {};
        if (item.ext === '.json') {
          const text = await resp.text();
          data = JSON.parse(text);
        } else {
          const blob = await resp.blob();
          ({ data, embeddedMedia, embeddedRefDocs } = await parseUDDBlob(blob));
        }
        const name = item.name.replace(/\.(udd|json)$/, '');
        this._addSessionAndSwitch(name, data, null, item.path, item.path);
        if (this._activeSession) {
          this._activeSession.embeddedMedia = embeddedMedia || {};
          this._activeSession.embeddedRefDocs = embeddedRefDocs || {};
          this._activeSession.embeddedMediaUrls = {};
        }
        this._updateSourceBtn();
        toast('已打开: ' + item.name);
      } catch (e) {
        toast('打开失败: ' + e.message);
      }
    }
  }

  // Preload .udd files into the cross-file reference cache
  async _preloadRepoUDDs(uddFiles) {
    for (const item of uddFiles) {
      const docName = item.name.replace(/\.udd$/, '');
      if (_refDocCache[docName]) continue; // already cached
      try {
        const resp = await fetch(this.repoServerUrl + '/api/readfile?path=' + encodeURIComponent(item.path));
        if (!resp.ok) continue;
        const blob = await resp.blob();
        const { data: docData } = await parseUDDBlob(blob);
        _refDocCache[docName] = docData;
        // Also cache with full path as key
        _refDocCache[item.path] = docData;
      } catch (e) { /* skip */ }
    }
    // Re-resolve async refs in current view
    this._resolveAsyncRefs(this.currentView === 'outline' ? this.outlineView.el : this.documentView.el);
  }
}

// ================================================================
//  PWA MANIFEST (inline)
// ================================================================
(function() {
  const manifest = {
    name: 'UDD - 统一数据展示系统',
    short_name: 'UDD',
    description: '一份数据，多种展示',
    start_url: '.',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2563eb',
    icons: [{
      src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#2563eb"/><text x="32" y="42" text-anchor="middle" font-size="24" font-weight="bold" fill="white" font-family="Arial">U</text></svg>'),
      sizes: '64x64', type: 'image/svg+xml'
    }]
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = URL.createObjectURL(blob);
  document.head.appendChild(link);
})();

// ================================================================
//  INITIALIZATION
// ================================================================
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new App();
  app.init();
});

// Prevent accidental close
window.addEventListener('beforeunload', e => {
  if (app && app.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
