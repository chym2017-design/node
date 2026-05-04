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

    this.outlineView = new OutlineView(document.getElementById('outline-view'));
    this.mindmapView = new MindmapView(document.getElementById('mindmap-view'));
    this.documentView = new DocumentView(document.getElementById('document-view'));
    this.sheetView = new SheetView(document.getElementById('sheet-view'));
    this.sheetView.resetWithDefaultData();
    this.pptView = new PptView(document.getElementById('ppt-view'));
    this.graphView = new GraphView(document.getElementById('graph-view'));

    // Create initial session（捕获默认表格簿的二进制写到 session.xlsxBin，
    // 让该会话拥有"自己的"工作簿，避免与后续打开的文档共用同一对象。）
    const initData = createDefaultData();
    let initXlsxBin = null;
    try { initXlsxBin = this.sheetView.toBinary(); } catch (e) {}
    const initSession = this._createSessionObj('未命名文档', initData, null, null, { xlsxBin: initXlsxBin });
    this.sessions.push(initSession);
    this.activeSessionId = initSession.id;

    // Expose convenience accessors
    this.currentView = 'outline';
    this.renderMode = true;
    this.sidebarMode = 'raw'; // 'raw' or 'values'
    this.contentSource = 'embedded'; // 'embedded' | 'repo'
    // Embedded data stored per-session (session.embeddedMedia, session.embeddedRefDocs)

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

  _createSessionObj(fileName, data, fileHandle, filePath, opts) {
    const undoMgr = new UndoManager();
    const o = opts || {};
    return {
      id: String(Date.now()) + '_' + Math.random().toString(36).slice(2, 6),
      fileName, data: deepClone(data), fileHandle, filePath,
      undoMgr, dirty: false,
      focusPath: null, scrollTop: 0,
      // 性能优化（Plan B）：开打文件时一次性算出"是否需要懒加载嵌入引用"，
      // 避免 _ensureEmbeddedMediaLoaded 每次 renderCurrentView 都做全量 JSON.stringify。
      _needsRefDocsLoad: JSON.stringify(data || {}).includes('udd.ref-docs.'),
      // 表格按会话隔离：每个 session 持有自己的 xlsx 二进制，切换会话时把它注入到
      // 共享的 sheetView.workbook。null 表示该会话尚无表格数据（启用默认空白簿）。
      xlsxBin: o.xlsxBin || null,
      sheetActiveSheet: o.sheetActiveSheet || null,
      // PPT 格式同理按会话隔离
      pptFormat: o.pptFormat || null
    };
  }

  // 把 active session 当前 sheetView.workbook 序列化回 session.xlsxBin。
  // 用于：会话切换前 / 关闭前 / autoSave / 保存文件前。
  _captureActiveSessionSheetState() {
    const s = this._activeSession;
    if (!s) return;
    if (this.sheetView && this.sheetView.workbook) {
      try {
        const bin = this.sheetView.toBinary();
        if (bin) s.xlsxBin = bin;
      } catch (e) { /* skip */ }
      s.sheetActiveSheet = this.sheetView.activeSheet || null;
    }
    if (this.pptView && this.pptView.getFormat) {
      try { s.pptFormat = deepClone(this.pptView.getFormat()); } catch (e) {}
    }
  }

  // 把 session 持有的 xlsxBin 注入到 sheetView，让该会话拿到自己的工作簿。
  // 没有 xlsxBin 的会话（例如全新文档 / 从 JSON 导入 / 老格式恢复）→ 装入"默认样板簿"
  // （resetWithDefaultData 的产物，含 A1:D6 表头与 B/C/D 列示例数据），
  // 不再把这份样板二进制当场固化回 session.xlsxBin —— 留给 autoSave 通过正常捕获路径
  // 在用户实际进入/编辑表格视图时记录，避免一份"空白/样板占位"被误当作用户真实工作簿落盘。
  _applySessionSheetState(session) {
    if (!session) return;
    if (this.sheetView) {
      if (session.xlsxBin) {
        this.sheetView.loadFromBinary(session.xlsxBin);
      } else {
        this.sheetView.resetWithDefaultData();
      }
      if (session.sheetActiveSheet && this.sheetView.workbook && this.sheetView.workbook.Sheets[session.sheetActiveSheet]) {
        this.sheetView.activeSheet = session.sheetActiveSheet;
      }
      // 失效 sheet 视图缓存，强制下次切到表格时按新工作簿重渲
      this.sheetView._rendered = false;
    }
    if (this.pptView && session.pptFormat) {
      try { this.pptView.setFormat(deepClone(session.pptFormat)); } catch (e) {}
      this.pptView._rendered = false;
    }
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
    // Save current session state（包含表格工作簿二进制）
    this._captureActiveSessionSheetState();
    this._saveCurrentSessionState();
    // 会话切换=数据完全换了一份，所有视图缓存都必须清空
    this._invalidateAllViews();
    // Switch
    this.activeSessionId = sessionId;
    // 把目标会话的工作簿装入共享 sheetView
    this._applySessionSheetState(target);
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
    // 关闭会话前先把 active session 当前的工作簿 / PPT 格式落盘到会话上
    this._captureActiveSessionSheetState();
    // 关闭会话后很可能切到另一个 session，所有视图缓存都要作废
    this._invalidateAllViews();
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
    // 把新激活会话的工作簿装回 sheetView
    this._applySessionSheetState(s);
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

  _addSessionAndSwitch(fileName, data, fileHandle, filePath, originPath, opts) {
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
    // 切走前把当前 active session 的工作簿存回它自己（避免被新会话覆盖）
    this._captureActiveSessionSheetState();
    this._saveCurrentSessionState();
    const session = this._createSessionObj(name, data, fileHandle, filePath, opts);
    if (originPath) session.originPath = originPath;
    session.undoMgr.push(data);
    this.sessions.push(session);
    this.activeSessionId = session.id;
    // 新打开了一个文档：原有会话的视图缓存在新数据下没意义，全部清空
    this._invalidateAllViews();
    // 把新会话的工作簿 / PPT 格式应用到共享 view
    this._applySessionSheetState(session);
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
              // saved.data 兼容两种历史格式：
              //   1) 老版本：直接是 data 对象
              //   2) 新版本：{ data, xlsxBin, pptFormat, sheetActiveSheet }
              let realData, xlsxBin = null, pptFormat = null, sheetActiveSheet = null;
              if (saved.data && (saved.data.meta || saved.data.type_global || saved.data.t0)) {
                // 老格式：整个 saved.data 就是文档数据
                realData = saved.data;
              } else if (saved.data.data) {
                realData = saved.data.data;
                xlsxBin = saved.data.xlsxBin || null;
                pptFormat = saved.data.pptFormat || null;
                sheetActiveSheet = saved.data.sheetActiveSheet || null;
              } else {
                realData = saved.data;
              }
              const s = this._createSessionObj(meta.fileName, realData, null, meta.filePath, { xlsxBin, pptFormat, sheetActiveSheet });
              s.id = meta.id;
              s.dirty = meta.dirty || false;
              s.undoMgr.push(realData);
              // 老格式没有 xlsxBin：用当前默认 sample workbook 给它一个独立副本，
              // 否则会话之间会"看起来共享一个工作簿"，编辑一个污染另一个。
              if (!s.xlsxBin && this.sheetView) {
                try { s.xlsxBin = this.sheetView.toBinary(); } catch (e) {}
              }
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
          // 把激活会话的工作簿装入 sheetView
          this._applySessionSheetState(s);
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

  // 视图实例按名字映射（便于复用 invalidate/render 逻辑）
  _getViewByName(name) {
    if (name === 'outline') return this.outlineView;
    if (name === 'mindmap') return this.mindmapView;
    if (name === 'document') return this.documentView;
    if (name === 'sheet') return this.sheetView;
    if (name === 'ppt') return this.pptView;
    if (name === 'graph') return this.graphView;
    return null;
  }

  // 把所有视图的缓存标记清空 → 下次切到哪个视图就会重新 render。
  // 用于：数据级变动（撤销/重做/sidebar 应用/格式开关/渲染开关/来源切换/编号样式/会话切换等）。
  _invalidateAllViews() {
    for (const name of ['outline', 'mindmap', 'document', 'sheet', 'ppt', 'graph']) {
      const v = this._getViewByName(name);
      if (v) { v._rendered = false; v._inputDirty = false; }
    }
  }

  // 只把"非当前视图"的缓存标记清空。
  // 用于：当前视图内用户敲字（contentEditable 已经在 DOM 上即时更新），
  //   当前视图不需要重渲，但其它视图下次进入必须重渲以拿到新数据。
  _invalidateOtherViews() {
    for (const name of ['outline', 'mindmap', 'document', 'sheet', 'ppt', 'graph']) {
      if (name === this.currentView) continue;
      const v = this._getViewByName(name);
      if (v) { v._rendered = false; v._inputDirty = false; }
    }
  }

  // 手动刷新按钮入口：强制重渲当前视图（无视缓存），用于引用源文件在外部改动后拉最新。
  // 同时清空跨文档引用缓存 _refDocCache，让被引用文件的最新内容真正重新从磁盘/服务器读取，
  // 否则视图重渲也只会读到旧缓存（=只有浏览器整体刷新才能拿到最新）。
  refreshCurrentView() {
    if (typeof _refDocCache !== 'undefined') {
      for (const k of Object.keys(_refDocCache)) delete _refDocCache[k];
    }
    const v = this._getViewByName(this.currentView);
    if (v) v._rendered = false;
    // 仓库面板若已连上服务器，顺手把目录里的 .udd 重新预加载到引用缓存
    if (this.repoServerUrl && this._repoFiles && this._repoFiles.length) {
      this._preloadRepoUDDs(this._repoFiles.filter(i => i.ext === '.udd'));
    }
    this.renderCurrentView();
    toast('已刷新');
  }

  renderCurrentView() {
    const cur = this._getViewByName(this.currentView);
    // 同步"引用色"CSS 变量到 #editor（数据侧设置→视觉即时生效，各视图无需各自处理）
    const rfc = this.data && this.data.type_global && this.data.type_global.ref_color;
    const editorEl = document.getElementById('editor');
    if (editorEl) editorEl.style.setProperty('--ref-color', rfc ? `rgb(${rfc})` : '');
    this._syncRefColorPreview();
    // 同步页面尺寸（分页样式 + 工具栏下拉框）
    this._applyPageSizeVars();
    if (this.currentView === 'outline') {
      this.outlineView.render(this.data);
      this._resolveAsyncRefs(this.outlineView.el);
    } else if (this.currentView === 'mindmap') {
      this.mindmapView.render(this.data);
    } else if (this.currentView === 'sheet') {
      this.sheetView.render(this.data);
    } else if (this.currentView === 'ppt') {
      this.pptView.render(this.data).catch(e => console.error('PPT render:', e));
    } else if (this.currentView === 'graph') {
      this.graphView.render(this.data).catch(e => console.error('Graph render:', e));
    } else {
      this.documentView.render(this.data);
      this._resolveAsyncRefs(this.documentView.el);
    }
    // 渲染完成后打上缓存标记，下次 switchView 进入时若仍然有效可直接复用
    if (cur) { cur._rendered = true; cur._inputDirty = false; }
    // Lazy-load embedded blobs if needed (non-blocking)
    this._ensureEmbeddedMediaLoaded();
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

  async _resolveAsyncRefs(viewEl) {
    if (this._asyncRefsResolving) return;
    // 性能优化（Plan C）：没有任何跨文档/嵌入引用需要异步解析时直接早退，
    // 避免 querySelectorAll 之后再走一遍空循环 + 状态机开销。
    if (!viewEl || !viewEl.querySelector('[data-ref-async]')) return;
    this._asyncRefsResolving = true;
    const elements = [...viewEl.querySelectorAll('[data-ref-async]')];
    let needsRerender = false;
    for (const el of elements) {
      if (!el.isConnected) continue;
      const refStr = el.dataset.refAsync;
      try {
        const resolved = await resolveRefAsync(this.data, refStr);
        if (!el.isConnected) continue;
        el.classList.toggle('ref-error', resolved.startsWith('#'));
        // 保留已挂载的 ref-icon（↗ 跳转箭头），只替换文本节点。
        // 直接 el.textContent = resolved 会连同子 .ref-icon 一并被擦掉。
        const existingIcon = el.querySelector('.ref-icon');
        if (existingIcon) {
          Array.from(el.childNodes).forEach(c => { if (c !== existingIcon) el.removeChild(c); });
          el.insertBefore(document.createTextNode(resolved), existingIcon);
        } else {
          el.textContent = resolved;
        }
        // If resolved contains media, flag for a single deferred re-render
        if (hasMediaTag(resolved)) needsRerender = true;
      } catch (e) { /* skip */ }
    }
    this._asyncRefsResolving = false;
    // Single deferred re-render after all async refs resolved (not per-element)
    if (needsRerender) {
      requestAnimationFrame(() => this.renderCurrentView());
    }
  }

  switchView(view) {
    // syncAll 里会读当前视图的 contentEditable 文本回写到 node[field]。
    // 配合 Plan D：各视图内部会在 _inputDirty=false 时直接 return，避免无用扫描。
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
    document.getElementById('graph-view').classList.toggle('active', view === 'graph');
    this.syncFmtCheckboxes();
    // 视图缓存：若目标视图已 rendered 且数据未失效，仅跑一次轻量的 async refs 补齐即可，
    // 不再重新 render（这是切换页面卡顿的主因）。
    const target = this._getViewByName(view);
    if (target && target._rendered) {
      if (view === 'outline') this._resolveAsyncRefs(this.outlineView.el);
      else if (view === 'document') this._resolveAsyncRefs(this.documentView.el);
      this._ensureEmbeddedMediaLoaded();
      return;
    }
    this.renderCurrentView();
  }

  getCurrentFocusPath() {
    if (this.currentView === 'graph' || this.currentView === 'sheet' || this.currentView === 'ppt') return null;
    const view = this.currentView === 'outline' ? this.outlineView : this.currentView === 'mindmap' ? this.mindmapView : this.documentView;
    return view.focusPath;
  }

  getCurrentFocusField() {
    if (this.currentView === 'graph' || this.currentView === 'sheet' || this.currentView === 'ppt') return 'content';
    const view = this.currentView === 'outline' ? this.outlineView : this.currentView === 'mindmap' ? this.mindmapView : this.documentView;
    return view.focusField || 'content';
  }

  getActiveEditableEl() {
    const path = this.getCurrentFocusPath();
    const field = this.getCurrentFocusField();
    if (!path || !field) return null;
    if (this.currentView === 'mindmap' || this.currentView === 'graph' || this.currentView === 'sheet' || this.currentView === 'ppt') return null;
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
    // 渲染模式切换影响所有视图（每个视图对 renderMode 的处理方式不同），全部失效
    this._invalidateAllViews();
    this.renderCurrentView();
  }

  toggleContentSource() {
    this.contentSource = this.contentSource === 'embedded' ? 'repo' : 'embedded';
    // source switch — media served via server, no blob cache to clear
    // 内容来源切换（嵌入 vs 仓库）会让媒体 URL 全部变化，所有视图都失效
    this._invalidateAllViews();
    this._updateSourceBtn();
    this.renderCurrentView();
  }

  // Lazy-load embedded media/refs from the .udd file if data has udd. paths but blobs are missing
  // 懒加载嵌入的 ref-docs（跨文档引用数据）。媒体文件通过服务器实时提取，不再需要 blob。
  // 性能优化（Plan B）：不再每次调用都跑 JSON.stringify 全量扫描，
  // 改用打开文件时在 _createSessionObj 里一次性算好的 session._needsRefDocsLoad 标记。
  // 没有嵌入 ref-docs 的文档（绝大多数场景）走 O(1) 早退。
  async _ensureEmbeddedMediaLoaded() {
    const session = this._activeSession;
    if (!session || session._embeddedLoading) return;
    if (!session._needsRefDocsLoad) return;
    const hasRefs = session.embeddedRefDocs && Object.keys(session.embeddedRefDocs).length > 0;
    if (hasRefs) return;
    session._embeddedLoading = true;
    try {
      let blob = null;
      if (session.fileHandle) {
        try { blob = await session.fileHandle.getFile(); } catch (e) { /* stale handle */ }
      }
      if (!blob && session.filePath && this.repoServerUrl) {
        const resp = await fetch(this.repoServerUrl + '/api/readfile?path=' + encodeURIComponent(session.filePath));
        if (resp.ok) blob = await resp.blob();
      }
      if (!blob) return;
      const { embeddedMedia, embeddedRefDocs } = await parseUDDBlob(blob);
      if (embeddedMedia) session.embeddedMedia = embeddedMedia; // keep for fileHandle fallback
      session.embeddedRefDocs = embeddedRefDocs || {};
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
    const entry = {
      sessionId: this.activeSessionId,
      view: this.currentView,
      focusPath: viewInstance.focusPath,
      focusField: viewInstance.focusField || 'content',
      scrollTop: editorEl ? editorEl.scrollTop : 0
    };
    // 去重：同 session+view+path+field 与栈顶一致就不再压栈，避免连点 ↗ 把栈撑爆。
    // 注意 scrollTop 不参与比较（同节点上稍微滚一下不应视为新位置）。
    const top = this._backStack[this._backStack.length - 1];
    if (top
        && top.sessionId === entry.sessionId
        && top.view === entry.view
        && top.focusPath === entry.focusPath
        && top.focusField === entry.focusField) {
      document.getElementById('back-btn').style.display = '';
      return;
    }
    this._backStack.push(entry);
    // 栈深度限制：超出 50 丢弃最早一条，防御性，正常用户不会触达。
    if (this._backStack.length > 50) this._backStack.shift();
    document.getElementById('back-btn').style.display = '';
  }

  goBack() {
    if (!this._backStack || !this._backStack.length) return;
    const pos = this._backStack.pop();
    if (this._backStack.length === 0) {
      document.getElementById('back-btn').style.display = 'none';
    }
    // 跨文档跳转后栈里记录的是源 sessionId；先切回原会话，否则会在错误的 data 上找节点。
    if (pos.sessionId && pos.sessionId !== this.activeSessionId) {
      const target = this.sessions.find(s => s.id === pos.sessionId);
      if (!target) {
        // 该会话已被关闭，跳过这条尝试下一条
        return this.goBack();
      }
      this.switchSession(pos.sessionId);
    }
    // Switch view if needed
    if (pos.view !== this.currentView) {
      this.switchView(pos.view);
    }
    const viewInstance = this._getViewByName(pos.view);
    if (!viewInstance) return;
    viewInstance.focusPath = pos.focusPath;
    viewInstance.focusField = pos.focusField;
    viewInstance.focusCursorEnd = false;
    if (typeof ensureNodeVisible === 'function' && pos.focusPath) {
      ensureNodeVisible(this.data, pos.focusPath);
    }
    viewInstance.render(this.data);
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

  // 跨文档引用跳转：找到 docName 对应的 .udd 文件并打开它，跳转到 nodePath。
  // 查找顺序：
  //   1) 已打开的 session（按 fileName / filePath 匹配）→ switchSession
  //   2) 仓库（开了 server）→ 在 _refDocCache / 当前 repoDir 中找文件路径 → 打开
  // 引用解析失败的不会调到这里（createRefIcon 已在 isError 分支提前返回）。
  // docName 可以是新格式 "path/file.udd"、绝对路径 "D:\xxx.udd"，也可兼容旧裸名 "filename"。
  async openCrossDocRef(docName, nodePath, srcViewInstance) {
    if (!docName) return;
    if (srcViewInstance) this._saveBackPosition(srcViewInstance);

    const hasUdd = docName.endsWith('.udd');
    const bare = hasUdd ? docName.replace(/\.udd$/, '') : docName;
    // 取裸文件名（不含目录）用于和 session.fileName 比较
    const bareLeaf = bare.replace(/^.*[\\/]/, '');

    // 1) 已打开的 session
    const matchOpen = this.sessions.find(s => {
      if (s.fileName === docName || s.fileName === bare || s.fileName === bareLeaf) return true;
      const fp = s.filePath || s.originPath || '';
      if (!fp) return false;
      // 完整路径 / 后缀匹配
      if (fp === docName) return true;
      const sufA = '/' + bare + '.udd', sufB = '\\' + bare + '.udd';
      const sufC = '/' + bareLeaf + '.udd', sufD = '\\' + bareLeaf + '.udd';
      const sufE = '/' + bareLeaf + '.json', sufF = '\\' + bareLeaf + '.json';
      return fp.endsWith(sufA) || fp.endsWith(sufB) || fp.endsWith(sufC) || fp.endsWith(sufD) || fp.endsWith(sufE) || fp.endsWith(sufF);
    });
    if (matchOpen) {
      if (matchOpen.id !== this.activeSessionId) this.switchSession(matchOpen.id);
      requestAnimationFrame(() => this._jumpInCurrentView(nodePath));
      return;
    }

    // 2) 通过仓库服务器加载并打开
    if (!this.repoServerUrl) {
      toast('未连接仓库，无法打开 ' + docName);
      return;
    }
    const candidates = [];
    // 当前文档目录（用于解析相对路径）
    const curFp = this._activeSession && this._activeSession.filePath || '';
    const curDir = curFp ? curFp.replace(/[\\/][^\\/]+$/, '') : '';
    // 绝对路径
    if (/^[A-Za-z]:[\\/]/.test(docName) || docName.startsWith('/')) {
      candidates.push({ path: hasUdd ? docName : docName + '.udd', isUdd: true });
    } else if (docName.includes('/') || docName.includes('\\')) {
      // 相对路径：当前目录与仓库根
      if (curDir) {
        candidates.push({ path: hasUdd ? curDir + '/' + docName : curDir + '/' + docName + '.udd', isUdd: true });
        candidates.push({ path: hasUdd ? curDir + '\\' + docName : curDir + '\\' + docName + '.udd', isUdd: true });
      }
      if (this.repoDir) {
        candidates.push({ path: hasUdd ? this.repoDir + '/' + docName : this.repoDir + '/' + docName + '.udd', isUdd: true });
        candidates.push({ path: hasUdd ? this.repoDir + '\\' + docName : this.repoDir + '\\' + docName + '.udd', isUdd: true });
      }
    } else {
      // 裸文件名：仓库目录优先
      if (this.repoDir) {
        candidates.push({ path: this.repoDir + '/' + bare + '.udd', isUdd: true });
        candidates.push({ path: this.repoDir + '\\' + bare + '.udd', isUdd: true });
        candidates.push({ path: this.repoDir + '/' + bare + '.json', isUdd: false });
      }
    }

    for (const c of candidates) {
      try {
        const resp = await fetch(this.repoServerUrl + '/api/readfile?path=' + encodeURIComponent(c.path));
        if (!resp.ok) continue;
        let data, embeddedMedia = {}, embeddedRefDocs = {}, xlsxBin = null, pptFormat = null;
        if (c.isUdd) {
          const blob = await resp.blob();
          ({ data, embeddedMedia, embeddedRefDocs, xlsxBin, pptFormat } = await parseUDDBlob(blob));
        } else {
          const text = await resp.text();
          data = JSON.parse(text);
        }
        const fileName = c.path.replace(/^.*[\\/]/, '').replace(/\.(udd|json)$/i, '');
        this._addSessionAndSwitch(fileName, data, null, c.path, c.path, { xlsxBin, pptFormat });
        if (this._activeSession) {
          this._activeSession.embeddedMedia = embeddedMedia || {};
          this._activeSession.embeddedRefDocs = embeddedRefDocs || {};
        }
        this._updateSourceBtn();
        requestAnimationFrame(() => this._jumpInCurrentView(nodePath));
        toast('已打开: ' + fileName);
        return;
      } catch (e) { /* try next */ }
    }
    toast('未在仓库中找到: ' + docName);
  }

  // 切换/打开会话之后，在当前视图里跳到指定 nodePath 并高亮（与 jumpToNode 类似但不再压栈）。
  _jumpInCurrentView(nodePath) {
    if (!nodePath) return;
    const viewInstance = this._getViewByName(this.currentView);
    if (!viewInstance) return;
    if (typeof ensureNodeVisible === 'function') ensureNodeVisible(this.data, nodePath);
    viewInstance.focusPath = nodePath;
    viewInstance.focusField = 'content';
    viewInstance.focusCursorEnd = false;
    if (typeof viewInstance.render === 'function') {
      const ret = viewInstance.render(this.data);
      // PPT render 是 async，吃掉错误避免 unhandled rejection
      if (ret && typeof ret.then === 'function') ret.catch(() => {});
    }
    this.updateSidebar(nodePath);
    requestAnimationFrame(() => {
      const el = viewInstance.el && viewInstance.el.querySelector(`[data-path="${nodePath}"][data-field="content"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'background-color 0.3s';
        el.style.backgroundColor = 'var(--blue-100)';
        setTimeout(() => { el.style.backgroundColor = ''; }, 1500);
      }
    });
  }

  // 表格引用跳转：切到表格视图，激活目标工作表，选中目标单元格。
  // 复用 SheetView._selectCell（已含 _parseAddr + rangeStart/End + _updateFormulaBar + render）。
  gotoSheetCell(sheetName, addr, srcViewInstance) {
    const sv = this.sheetView;
    if (!sv || !sv.workbook || !sv.workbook.Sheets[sheetName]) {
      toast('未找到表格: ' + sheetName);
      return;
    }
    if (srcViewInstance) this._saveBackPosition(srcViewInstance);
    if (this.currentView !== 'sheet') this.switchView('sheet');
    sv.activeSheet = sheetName;
    sv._selectCell(addr);
    requestAnimationFrame(() => {
      const td = sv.el && sv.el.querySelector(`td[data-addr="${addr}"]`);
      if (td) td.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

    // 节点级编号 toggle 按钮状态（只在此焦点节点上反映，不继承）
    const focusNode = getNodeByPath(this.data, path);
    const noNumBtn = document.getElementById('tool-no-number');
    const rstBtn = document.getElementById('tool-restart-number');
    if (noNumBtn) noNumBtn.classList.toggle('active', !!(focusNode && focusNode.no_number));
    if (rstBtn) rstBtn.classList.toggle('active', !!(focusNode && focusNode.restart_number));
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

  // 引用背景色：作用于 .ref-display / .inline-ref 的 background（非 per-node），
  // 存在 data.type_global.ref_color。空值 = 无设置（回到 CSS 默认 var(--blue-50) 浅蓝）。
  setRefColor(hex) {
    this.pushUndo();
    if (!this.data.type_global) this.data.type_global = {};
    const preview = document.getElementById('tool-ref-preview');
    if (!hex) {
      delete this.data.type_global.ref_color;
      if (preview) {
        preview.style.background = '#eff6ff';
        preview.style.borderStyle = 'solid';
        preview.style.borderColor = 'var(--blue-200)';
      }
    } else {
      this.lastRefColor = hex;
      this.data.type_global.ref_color = hexToRgb(hex);
      if (preview) {
        preview.style.background = hex;
        preview.style.borderStyle = 'solid';
        preview.style.borderColor = 'var(--gray-200)';
      }
    }
    this._invalidateAllViews();
    this.renderCurrentView();
    this.markDirty();
  }

  applyLastColor(type) {
    if (type === 'fg') this.setColor(this.lastFgColor);
    else if (type === 'bg') this.setBgColor(this.lastBgColor);
    else if (type === 'ref') this.setRefColor(this.lastRefColor || '#dbeafe');
  }

  // Color palette
  initColorPalettes() {
    this.buildPalette('palette-fg', 'fg');
    this.buildPalette('palette-bg', 'bg');
    this.buildPalette('palette-ref', 'ref');
    // 初始同步引用色预览（刷新后恢复自 data.type_global.ref_color）
    this._syncRefColorPreview();
  }

  _syncRefColorPreview() {
    const preview = document.getElementById('tool-ref-preview');
    if (!preview) return;
    const rfc = this.data && this.data.type_global && this.data.type_global.ref_color;
    if (rfc) {
      preview.style.background = `rgb(${rfc})`;
      preview.style.borderStyle = 'solid';
      preview.style.borderColor = 'var(--gray-200)';
    } else {
      preview.style.background = '#eff6ff';
      preview.style.borderStyle = 'solid';
      preview.style.borderColor = 'var(--blue-200)';
    }
  }

  buildPalette(containerId, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    // 引用色专属：顶部一个"无设置"按钮，清空 data.type_global.ref_color（回到默认浅蓝）
    if (type === 'ref') {
      const none = document.createElement('div');
      none.className = 'color-palette-none';
      none.style.cssText = 'padding:4px 6px;margin-bottom:4px;font-size:12px;color:var(--gray-600);border:1px dashed var(--gray-300);border-radius:3px;cursor:pointer;text-align:center';
      none.textContent = '无设置（默认浅蓝背景）';
      none.onclick = (e) => {
        e.stopPropagation();
        this.setRefColor('');
        this.closeAllPalettes();
      };
      container.appendChild(none);
    }
    const grid = document.createElement('div');
    grid.className = 'color-palette-grid';
    for (const color of PALETTE_COLORS) {
      const span = document.createElement('span');
      span.style.background = color;
      span.onclick = (e) => {
        e.stopPropagation();
        if (type === 'fg') this.setColor(color);
        else if (type === 'bg') this.setBgColor(color);
        else this.setRefColor(color);
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
    input.value = type === 'fg' ? this.lastFgColor : type === 'bg' ? this.lastBgColor : (this.lastRefColor || '#2563eb');
    input.onchange = (e) => {
      if (type === 'fg') this.setColor(e.target.value);
      else if (type === 'bg') this.setBgColor(e.target.value);
      else this.setRefColor(e.target.value);
      this.closeAllPalettes();
    };
    custom.appendChild(input);
    container.appendChild(custom);
  }

  toggleColorPalette(type) {
    const id = 'palette-' + type;
    const el = document.getElementById(id);
    // 关掉其他两个
    for (const t of ['fg', 'bg', 'ref']) {
      if (t !== type) document.getElementById('palette-' + t)?.classList.remove('show');
    }
    if (el) {
      const isShowing = el.classList.toggle('show');
      if (isShowing) {
        const wrap = document.getElementById('color-wrap-' + type);
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
    const input = prompt('插入表格引用\n格式: 表格名.起始:结束\n例如: Sheet1.A1:C4\n跨文档: 路径/文件名.udd.Sheet1.A1:C4', defaultSheet + '.A1:C4');
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
    const MEDIA_EXTS = ['.png','.jpg','.jpeg','.gif','.svg','.webp','.bmp','.mp4','.webm','.ogg','.mov','.avi','.mp3','.wav','.aac','.m4a','.flac'];
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
          else if (['.mp3','.wav','.aac','.m4a','.flac'].includes(item.ext)) icon.textContent = '🔊';
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
      const isAudio = ['.mp3','.wav','.aac','.m4a','.flac'].includes(ext);
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

  // ================================================================
  // 媒体路径解析 — 返回候选 URL 列表（按固定优先级），不因是否开 server 改变逻辑。
  // 优先级（严格顺序，失败则由 <img>/<video> 的 onerror 回退到下一个）:
  //   1) 本文档嵌入  udd.media/* → session.embeddedMedia blob
  //   2) 仓库服务器  udd.media/* → server /api/readfile?path=filePath&entry=...
  //                D:\xxx       → server /api/readfile?path=D:\xxx
  //   3) 本机路径    直接原样（浏览器通常无法加载，留给用户自行处理）
  //   4) http/data:  原样返回
  // 是否开 server 只是让其中某些候选能/不能成功读取，读取顺序固定不变。
  // ================================================================
  resolveMediaSrcCandidates(src) {
    if (!src) return [];
    const candidates = [];
    const session = this._activeSession;

    // http / data: 已可用，直接返回
    if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:')) {
      return [src];
    }

    // udd.media/* — 嵌入媒体
    if (src.startsWith('udd.media/')) {
      // 1) 本文档嵌入（blob）
      if (session && session.embeddedMedia && session.embeddedMedia[src]) {
        if (!session._blobUrls) session._blobUrls = {};
        if (!session._blobUrls[src]) session._blobUrls[src] = URL.createObjectURL(session.embeddedMedia[src]);
        candidates.push(session._blobUrls[src]);
      }
      // 2) 仓库：从 .udd zip 提取 entry
      if (session && session.filePath && this.repoServerUrl) {
        const entry = src.slice(4); // "udd.media/xxx" → "media/xxx"
        candidates.push(this.repoServerUrl + '/api/readfile?path=' + encodeURIComponent(session.filePath) + '&entry=' + encodeURIComponent(entry));
      }
      return candidates;
    }

    // 本机绝对路径 D:\xxx — 仅能通过服务器代理
    if (/^[A-Za-z]:[\\/]/.test(src)) {
      if (this.repoServerUrl) {
        candidates.push(this.repoServerUrl + '/api/readfile?path=' + encodeURIComponent(src));
      }
      candidates.push(src); // 兜底原样（通常浏览器不支持，但保留给未来协议处理器）
      return candidates;
    }

    // 其它（相对路径 / 未知）原样返回
    return [src];
  }

  // 兼容接口：返回首选候选（或空串）
  resolveMediaSrc(src) {
    const list = this.resolveMediaSrcCandidates(src);
    return list.length > 0 ? list[0] : '';
  }

  setNumbering(style) {
    this.pushUndo();
    this.data.type_global.numbering_style = style;
    this.renderCurrentView();
    this.markDirty();
  }

  // ================================================================
  // 文档视图分页：存在 data.type_global.page_size
  //   ""/undefined = 不分页；A4/A3/A5/letter/legal/B5 = 对应尺寸
  // 作用：文档视图 .doc-page 的宽高切到 CSS 变量 --page-w / --page-h；
  //       打印/导出 PDF 时 @page { size } 按该尺寸出纸；
  //       导出 Word 时 doc 头里写 @page 与 section 尺寸。
  // ================================================================
  static PAGE_SIZES = {
    A4:     { w: '210mm', h: '297mm', printSize: 'A4' },
    A3:     { w: '297mm', h: '420mm', printSize: 'A3' },
    A5:     { w: '148mm', h: '210mm', printSize: 'A5' },
    letter: { w: '216mm', h: '279mm', printSize: 'Letter' },
    legal:  { w: '216mm', h: '356mm', printSize: 'Legal' },
    B5:     { w: '176mm', h: '250mm', printSize: '176mm 250mm' },
  };

  setPageSize(size) {
    this.pushUndo();
    if (!this.data.type_global) this.data.type_global = {};
    if (!size) delete this.data.type_global.page_size;
    else this.data.type_global.page_size = size;
    this._applyPageSizeVars();
    this._invalidateAllViews();
    this.renderCurrentView();
    this.markDirty();
  }

  // 把 data.type_global.page_size 同步成 #editor 的 CSS 变量 + 下拉框选中项。
  // 在 renderCurrentView / 切换会话后调用，保证打开文档时样式即时生效。
  _applyPageSizeVars() {
    const size = this.data && this.data.type_global && this.data.type_global.page_size;
    const editorEl = document.getElementById('editor');
    if (editorEl) {
      const spec = size && App.PAGE_SIZES[size];
      if (spec) {
        editorEl.style.setProperty('--page-w', spec.w);
        editorEl.style.setProperty('--page-h', spec.h);
        editorEl.classList.add('paged');
      } else {
        editorEl.style.removeProperty('--page-w');
        editorEl.style.removeProperty('--page-h');
        editorEl.classList.remove('paged');
      }
    }
    const sel = document.getElementById('tool-page-size');
    if (sel) sel.value = size || '';
  }

  // 导出 PDF：注入一份临时打印样式，把 #document-view 当作主内容，@page size 按当前选择，
  // 调浏览器打印对话框（用户选"另存为 PDF"）。打印后自动清掉样式。
  exportPDF() {
    // 先确保是文档视图且当前 DOM 是最新的
    if (this.currentView !== 'document') this.switchView('document');
    // 切视图是同步的，但 renderCurrentView 已调用 —— 直接触发打印
    requestAnimationFrame(() => this._runPrint());
  }

  _runPrint() {
    const size = this.data && this.data.type_global && this.data.type_global.page_size;
    const spec = size && App.PAGE_SIZES[size];
    const pageRule = spec ? `@page { size: ${spec.printSize}; margin: 16mm; }` : '@page { margin: 16mm; }';
    // 关键：html / body / #app / #main / #editor 全链路都设置了 height:100% + overflow:hidden，
    // 打印时会把内容裁到一屏 → 只输出第一页。下面把整条链全部解锁为 height:auto + overflow:visible。
    const css = `
      ${pageRule}
      @media print {
        html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
        #app { height: auto !important; min-height: 0 !important; overflow: visible !important; display: block !important; background: #fff !important; }
        #header, #status-bar, #sidebar, #repo-panel, #toast { display: none !important; }
        #main { height: auto !important; min-height: 0 !important; overflow: visible !important; display: block !important; }
        #editor { height: auto !important; min-height: 0 !important; overflow: visible !important; display: block !important; padding: 0 !important; margin: 0 !important; background: #fff !important; position: static !important; }
        #editor > div { display: none !important; }
        #editor > #document-view { display: block !important; }
        #document-view { height: auto !important; min-height: 0 !important; overflow: visible !important; width: 100% !important; background: #fff !important; padding: 0 !important; margin: 0 !important; position: static !important; }
        .doc-page { box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 !important; padding: 0 !important; max-width: none !important; width: 100% !important; min-height: 0 !important; height: auto !important; background: #fff !important; overflow: visible !important; page-break-after: always; break-after: page; }
        .doc-page:last-child { page-break-after: auto; break-after: auto; }
        .doc-node { page-break-inside: avoid; break-inside: avoid; }
        .ref-icon, .body-btn, .doc-fold { display: none !important; }
      }
    `;
    const style = document.createElement('style');
    style.id = 'udd-print-style';
    style.textContent = css;
    document.head.appendChild(style);
    const cleanup = () => {
      style.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    try { window.print(); } catch (e) { cleanup(); toast('打印失败: ' + e.message); }
    // 兜底：有些浏览器不触发 afterprint
    setTimeout(cleanup, 60000);
  }

  // 导出 Word：生成 Word 兼容的 HTML Blob（.doc）。
  // 图片走 fetch → base64 嵌入（与 PPT 一致路径，使用 resolveMediaSrcCandidates 候选回退）；
  // 视频/音频 Word 内联无意义，留占位文本。
  // 页面尺寸通过 <style> 里的 @page 指定。
  async exportWord() {
    if (this.currentView !== 'document') this.switchView('document');
    const docEl = document.getElementById('document-view');
    if (!docEl) { toast('文档视图不可用'); return; }
    toast('正在导出 Word...');
    const clone = docEl.cloneNode(true);
    clone.querySelectorAll('.ref-icon, .body-btn, .doc-fold, .media-resize-handle, .media-editor').forEach(el => el.remove());
    clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));

    // 视频/音频留占位
    clone.querySelectorAll('video,audio').forEach(el => {
      const alt = el.tagName === 'VIDEO' ? '[视频]' : '[音频]';
      const span = document.createElement('span');
      span.style.color = '#888';
      span.textContent = alt;
      el.replaceWith(span);
    });

    // 图片：把每个 <img> 的 src（已是 blob: 或 http: 由 _bindMediaSrcWithFallback 设置）
    // fetch → base64 data URL。失败用 [图片] 占位。
    const imgs = Array.from(clone.querySelectorAll('img'));
    await Promise.all(imgs.map(async (img) => {
      const dataUrl = await this._imgToDataURL(img.src);
      if (dataUrl) {
        img.src = dataUrl;
        img.removeAttribute('srcset');
        img.removeAttribute('crossorigin');
      } else {
        const span = document.createElement('span');
        span.style.color = '#888';
        span.textContent = '[图片]';
        img.replaceWith(span);
      }
    }));

    const size = this.data && this.data.type_global && this.data.type_global.page_size;
    const spec = size && App.PAGE_SIZES[size];
    const pageRule = spec ? `@page WordSection1 { size: ${spec.w} ${spec.h}; margin: 16mm 16mm 16mm 16mm; }` : '@page WordSection1 { margin: 16mm 16mm 16mm 16mm; }';

    const title = (this.fileName || '未命名文档').replace(/[<>&"']/g, '');
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${title}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
body { font-family: '微软雅黑', Arial, sans-serif; font-size: 12pt; color: #1e293b; line-height: 1.6; }
h1,h2,h3,h4,h5,h6 { font-family: '微软雅黑'; color: #1e293b; }
.doc-h1 { font-size: 16pt; font-weight: 700; margin: 18pt 0 10pt; }
.doc-h2 { font-size: 14pt; font-weight: 600; margin: 14pt 0 8pt; }
.doc-h3 { font-size: 12pt; font-weight: 600; margin: 10pt 0 6pt; }
.doc-h4, .doc-h5, .doc-h6 { font-size: 12pt; font-weight: 600; margin: 8pt 0 4pt; }
.doc-body { font-size: 12pt; line-height: 1.8; text-indent: 2em; margin: 4pt 0 10pt; }
.doc-num { margin-right: 6px; font-weight: 400; }
.inline-table { border-collapse: collapse; margin: 6pt 0; font-size: 11pt; }
.inline-table th, .inline-table td { border: 1px solid #cbd5e1; padding: 3pt 6pt; }
.ref-display, .inline-ref { background: #eff6ff; border-radius: 2px; padding: 0 2px; }
.media-wrap { margin: 6pt 0; }
.media-img { max-width: 100%; }
.media-caption { font-size: 10pt; color: #64748b; text-align: center; margin-top: 2pt; }
.doc-page + .doc-page { page-break-before: always; }
${pageRule}
div.WordSection1 { page: WordSection1; }
</style>
</head>
<body>
<div class="WordSection1">
${clone.innerHTML}
</div>
</body>
</html>`;

    const blob = new Blob(['﻿' + html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (this.fileName || '未命名文档') + '.doc';
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出 Word');
  }

  // 把任意 <img> 的当前 src 转换成 base64 data URL（用于 Word 嵌入）。
  // 已是 data: 直接返回；blob: / http: / 服务器代理 URL 全部 fetch + FileReader 转码。
  // 失败返回空串。
  async _imgToDataURL(src) {
    if (!src) return '';
    if (src.startsWith('data:')) return src;
    try {
      const res = await fetch(src);
      if (!res.ok) return '';
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => resolve('');
        fr.readAsDataURL(blob);
      });
    } catch (e) {
      return '';
    }
  }

  // 切换当前焦点节点的 no_number（Word 行为：跳过且不占编号位）
  toggleNoNumber() {
    const path = this.getCurrentFocusPath();
    if (!path) { toast('请先选中一个节点'); return; }
    const node = getNodeByPath(this.data, path);
    if (!node) return;
    this.pushUndo();
    if (node.no_number) delete node.no_number; else node.no_number = 1;
    this._invalidateAllViews();
    this.renderCurrentView();
    this.updateToolbar(path);
    this.markDirty();
  }

  // 切换当前焦点节点的 restart_number（从此节点起在同级重新计数）
  toggleRestartNumber() {
    const path = this.getCurrentFocusPath();
    if (!path) { toast('请先选中一个节点'); return; }
    const node = getNodeByPath(this.data, path);
    if (!node) return;
    this.pushUndo();
    if (node.restart_number) delete node.restart_number; else node.restart_number = 1;
    this._invalidateAllViews();
    this.renderCurrentView();
    this.updateToolbar(path);
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
  // 数据被修改（文本输入 / 样式 / 插入媒体 / undo-redo 等）后调用，
  // 自动失效"其它视图"的缓存——当前视图的 DOM 已即时更新或马上会 renderCurrentView，
  // 但下次切到其它视图必须拿新数据重渲。
  markDirty() {
    this.dirty = true;
    document.getElementById('stat-save').textContent = '● 未保存';
    document.getElementById('stat-save').style.color = '#ef4444';
    this._invalidateOtherViews();
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
    // 把当前活动会话的工作簿快照保存到 session.xlsxBin
    this._captureActiveSessionSheetState();
    let anyDirty = false;
    try {
      for (const s of this.sessions) {
        if (!s.dirty) continue;
        anyDirty = true;
        s.data.meta.modified = new Date().toISOString();
        // 新格式：把表格簿 / PPT 格式一起持久化，避免页面刷新后表格列空白
        await dbSave('session_' + s.id, {
          data: s.data,
          xlsxBin: s.xlsxBin || null,
          pptFormat: s.pptFormat || null,
          sheetActiveSheet: s.sheetActiveSheet || null
        });
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
    // 给新会话准备一份独立的默认表格簿（捕获其二进制后让 _addSessionAndSwitch 写入 session.xlsxBin）
    let xlsxBin = null;
    try {
      const tmp = new SheetView(document.createElement('div'));
      tmp.resetWithDefaultData();
      xlsxBin = tmp.toBinary();
    } catch (e) { /* skip if XLSX unavailable */ }
    this._addSessionAndSwitch(name, newData, null, null, null, { xlsxBin });
    this.outlineView.focusPath = 't0-1';
    // 标脏：让 autoSave 把新会话（含样板表格簿 xlsxBin）真正写进 IndexedDB。
    // 否则下次浏览器刷新时 sessions_index 有这条记录，但 session_<id> 不存在 → 会话丢失，
    // 进而被空 fallback 顶替，最终保存出来的 .udd 里 sheets.xlsx 为空。
    this.markDirty();
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
      let embeddedMedia = {}, embeddedRefDocs = {}, xlsxBin = null, pptFormat = null;
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        data = JSON.parse(text);
      } else {
        ({ data, embeddedMedia, embeddedRefDocs, xlsxBin, pptFormat } = await parseUDDBlob(file));
      }

      const name = file.name.replace(/\.(udd|json)$/i, '') || data.meta?.title || '未命名文档';
      // Browser security: full path unavailable for local picker; use filename only
      this._addSessionAndSwitch(name, data, handle, null, file.name, { xlsxBin, pptFormat });
      if (this._activeSession) {
        this._activeSession.embeddedMedia = embeddedMedia;
        this._activeSession.embeddedRefDocs = embeddedRefDocs;
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
      // 防止当前点击事件循环里其它 outside-click 处理器把刚弹出的对话框当成"外部点击"立即关掉
      // （表现为：第一次点保存看不到对话框，第二次点才出现）。
      // 推迟到下一次事件循环再绑定 mask 的关闭逻辑。
      let armed = false;
      requestAnimationFrame(() => { armed = true; });
      dlg.querySelector('#save-cancel').onclick = () => { mask.remove(); resolve(null); };
      mask.onclick = e => { if (!armed) return; if (e.target === mask) { mask.remove(); resolve(null); } };
      dlg.querySelector('#save-ok').onclick = () => {
        const embedMedia = dlg.querySelector('#save-embed-media').checked;
        const embedRefs = dlg.querySelector('#save-embed-refs').checked;
        mask.remove();
        resolve({ embedMedia, embedRefs });
      };
    });
  }

  // 把保存（另存为 / showSaveFilePicker）后获得的文件 handle 名同步到 fileName / 标题栏 / 浏览器 tab。
  // 用户最初是"未命名文档"，另存为之后浏览器标题应当反映新文件名。
  _applySavedHandleName(handle) {
    if (!handle || !handle.name) return;
    const newName = handle.name.replace(/\.udd$/i, '');
    if (!newName || newName === this.fileName) return;
    this.fileName = newName;
    if (this.data && this.data.meta) this.data.meta.title = newName;
    const titleEl = document.getElementById('doc-title');
    if (titleEl) titleEl.value = newName;
    document.title = 'UDD - ' + newName;
    this._renderOpenDocs();
  }

  async saveFile() {
    if (this._saveDialogOpen) return; // re-entry guard（保险：防止多次点击/Ctrl+S 连击）
    if (this.currentView === 'outline') this.outlineView.syncAll();
    else if (this.currentView === 'document') this.documentView.syncAll();
    else if (this.currentView === 'mindmap') this.mindmapView.syncAll();
    this.data.meta.modified = new Date().toISOString();
    this.data.meta.title = this.fileName;

    this._saveDialogOpen = true;
    let opts;
    try { opts = await this._showSaveOptions(); }
    finally { this._saveDialogOpen = false; }
    if (!opts) return;
    await this._doSave(opts, false);
  }

  async saveFileAs() {
    if (this._saveDialogOpen) return;
    if (this.currentView === 'outline') this.outlineView.syncAll();
    else if (this.currentView === 'document') this.documentView.syncAll();
    else if (this.currentView === 'mindmap') this.mindmapView.syncAll();
    this.data.meta.modified = new Date().toISOString();
    this.data.meta.title = this.fileName;

    this._saveDialogOpen = true;
    let opts;
    try { opts = await this._showSaveOptions(); }
    finally { this._saveDialogOpen = false; }
    if (!opts) return;
    await this._doSave(opts, true);
  }

  // 把"询问 embed 选项"和"实际写入"拆开，避免 saveFile 询问 opts 后再 fall-through 到
  // saveFileAs 时被二次询问（用户表现为"点两次保存才弹系统对话框"）。
  // forceAs=true → 始终走 showSaveFilePicker（另存为）。
  // forceAs=false → 优先走 fileHandle / 服务器；都没有时再回退到 showSaveFilePicker，opts 沿用本次。
  async _doSave(opts, forceAs) {
    try {
      toast('正在保存...');
      const blob = await createUDDBlob(this.data, opts);

      if (!forceAs && this.fileHandle) {
        try {
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
      } else if (!forceAs && this._activeSession && this._activeSession.filePath && this.repoServerUrl) {
        const resp = await fetch(this.repoServerUrl + '/api/writefile?path=' + encodeURIComponent(this._activeSession.filePath), {
          method: 'POST', body: blob
        });
        if (!resp.ok) throw new Error('服务器写入失败: HTTP ' + resp.status);
      } else if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: this.fileName + '.udd',
          types: [{ description: 'UDD文档', accept: { 'application/zip': ['.udd'] } }]
        });
        this.fileHandle = handle;
        this._applySavedHandleName(handle);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = this.fileName + '.udd';
        a.click(); URL.revokeObjectURL(url);
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
        let data, embeddedMedia = {}, embeddedRefDocs = {}, xlsxBin = null, pptFormat = null;
        if (item.ext === '.json') {
          const text = await resp.text();
          data = JSON.parse(text);
        } else {
          const blob = await resp.blob();
          ({ data, embeddedMedia, embeddedRefDocs, xlsxBin, pptFormat } = await parseUDDBlob(blob));
        }
        const name = item.name.replace(/\.(udd|json)$/, '');
        this._addSessionAndSwitch(name, data, null, item.path, item.path, { xlsxBin, pptFormat });
        if (this._activeSession) {
          this._activeSession.embeddedMedia = embeddedMedia || {};
          this._activeSession.embeddedRefDocs = embeddedRefDocs || {};
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
