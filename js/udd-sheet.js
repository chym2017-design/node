// ================================================================
//  UDD Sheet View
//  SheetJS integration, cell editing, range selection,
//  copy/paste (Excel compatible), fill-down, auto-expand,
//  UDD reference support, multi-sheet tabs
// ================================================================

class SheetView {
  constructor(container) {
    this.el = container;
    this.workbook = null;
    this.activeSheet = null;
    this.selectedCell = 'A1';
    this.rangeStart = { r: 0, c: 0 };  // selection anchor
    this.rangeEnd   = { r: 0, c: 0 };  // selection end
    this.editingCell = null;
    this._colWidths = {};
    this.data = null;
    this.focusPath = null;
    this.focusField = 'content';
    this._fillDrag = null; // { startAddr, startR, c, table }
    this._visibleRange = { maxR: 49, maxC: 25 };
    // Plan D：sheet 视图缓存标记
    this._rendered = false;
    this._inputDirty = false;

    this._initDefaultWorkbook();
  }

  _initDefaultWorkbook() {
    if (typeof XLSX === 'undefined') return;
    this.workbook = XLSX.utils.book_new();
    // Create sheet manually without aoa_to_sheet (works in all XLSX builds)
    const ws = { '!ref': 'A1:A1' };
    XLSX.utils.book_append_sheet(this.workbook, ws, 'Sheet1');
    this.activeSheet = 'Sheet1';
  }

  loadFromBinary(binaryData) {
    if (!binaryData || typeof XLSX === 'undefined') return;
    try {
      this.workbook = XLSX.read(binaryData, { type: 'array' });
      this.activeSheet = this.workbook.SheetNames[0] || 'Sheet1';
    } catch (e) {
      console.error('Failed to load sheets.xlsx:', e);
      this._initDefaultWorkbook();
    }
  }

  toBinary() {
    if (!this.workbook || typeof XLSX === 'undefined') return null;
    this._syncRefsToWorkbook();
    try {
      return XLSX.write(this.workbook, { type: 'array', bookType: 'xlsx' });
    } catch (e) {
      console.error('Failed to write xlsx:', e);
      return null;
    }
  }

  setData(data) { this.data = data; }

  // Initialize workbook with default cross-reference sample data
  resetWithDefaultData() {
    if (typeof XLSX === 'undefined') return;
    this.workbook = XLSX.utils.book_new();
    const ws = {
      '!ref': 'A1:D6',
      'A1': { v: '产品名称', t: 's' },
      'B1': { v: '数量（件）', t: 's' },
      'C1': { v: '单价（元）', t: 's' },
      'D1': { v: '金额（元）', t: 's' },
      // A2~A6 由 _sheetRefs 提供（UDD 引用大纲），workbook 中留空
      'B2': { v: 100, t: 'n' }, 'C2': { v: 5.5, t: 'n' }, 'D2': { v: 550, t: 'n' },
      'B3': { v: 200, t: 'n' }, 'C3': { v: 3.8, t: 'n' }, 'D3': { v: 760, t: 'n' },
      'B4': { v: 150, t: 'n' }, 'C4': { v: 4.2, t: 'n' }, 'D4': { v: 630, t: 'n' },
      'B5': { v: 80,  t: 'n' }, 'C5': { v: 12.0, t: 'n' }, 'D5': { v: 960, t: 'n' },
      'B6': { v: 30,  t: 'n' }, 'C6': { v: 25.0, t: 'n' }, 'D6': { v: 750, t: 'n' }
    };
    XLSX.utils.book_append_sheet(this.workbook, ws, 'Sheet1');
    this.activeSheet = 'Sheet1';
    this.selectedCell = 'A1';
    this.rangeStart = { r: 0, c: 0 };
    this.rangeEnd   = { r: 0, c: 0 };
  }

  syncAll() {
    if (this.editingCell) this._commitEdit();
  }

  // ---- Rendering ----

  render(data) {
    this.data = data;
    if (!this.workbook) this._initDefaultWorkbook();
    if (!this.workbook) {
      this.el.innerHTML = '<div style="padding:20px;color:var(--gray-400)">SheetJS 未加载</div>';
      this._rendered = true;
      return;
    }

    // Ensure activeSheet exists
    if (!this.workbook.Sheets[this.activeSheet]) {
      this.activeSheet = this.workbook.SheetNames[0];
      if (!this.activeSheet) {
        const ws = { '!ref': 'A1:A1' };
        XLSX.utils.book_append_sheet(this.workbook, ws, 'Sheet1');
        this.activeSheet = 'Sheet1';
      }
    }

    this.el.innerHTML = '';

    // Formula bar
    const formulaBar = document.createElement('div');
    formulaBar.className = 'sheet-formula-bar';
    const addrInput = document.createElement('input');
    addrInput.className = 'sheet-cell-addr';
    addrInput.id = 'sheet-addr';
    addrInput.value = this.selectedCell;
    addrInput.readOnly = true;
    formulaBar.appendChild(addrInput);
    const formulaInput = document.createElement('input');
    formulaInput.className = 'sheet-formula-input';
    formulaInput.id = 'sheet-formula';
    formulaInput.placeholder = '输入值或公式（以 = 开头）';
    formulaInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { this._applyFormulaBar(formulaInput.value); e.preventDefault(); }
      if (e.key === 'Escape') { this._updateFormulaBar(); formulaInput.blur(); }
    });
    formulaBar.appendChild(formulaInput);
    this.el.appendChild(formulaBar);

    // Grid wrapper
    const gridWrap = document.createElement('div');
    gridWrap.className = 'sheet-grid-wrap';
    const ws = this.workbook.Sheets[this.activeSheet];
    const range = this._getSheetRange(ws);
    this._visibleRange = range;
    const table = document.createElement('table');
    table.className = 'sheet-grid';

    // Selection range bounds
    const selMinR = Math.min(this.rangeStart.r, this.rangeEnd.r);
    const selMaxR = Math.max(this.rangeStart.r, this.rangeEnd.r);
    const selMinC = Math.min(this.rangeStart.c, this.rangeEnd.c);
    const selMaxC = Math.max(this.rangeStart.c, this.rangeEnd.c);
    const { r: selR, c: selC } = this._parseAddr(this.selectedCell);

    // Header row
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'sheet-corner';
    hRow.appendChild(corner);
    for (let c = 0; c <= range.maxC; c++) {
      const th = document.createElement('th');
      th.className = 'sheet-col-hdr';
      if (c >= selMinC && c <= selMaxC) th.classList.add('selected');
      th.textContent = this._colName(c);
      th.dataset.col = c;
      th.onclick = () => this._selectCol(c);
      const resizer = document.createElement('div');
      resizer.className = 'sheet-col-resize';
      resizer.onmousedown = (e) => this._startColResize(e, c, table);
      th.style.position = 'relative';
      th.appendChild(resizer);
      hRow.appendChild(th);
    }
    thead.appendChild(hRow);
    table.appendChild(thead);

    // Data rows
    const tbody = document.createElement('tbody');
    const sheetRefs = (this.data && this.data._sheetRefs) || {};
    for (let r = 0; r <= range.maxR; r++) {
      const tr = document.createElement('tr');
      const rowHdr = document.createElement('th');
      rowHdr.className = 'sheet-row-hdr';
      if (r >= selMinR && r <= selMaxR) rowHdr.classList.add('selected');
      rowHdr.textContent = r + 1;
      rowHdr.onclick = () => this._selectRow(r);
      tr.appendChild(rowHdr);

      for (let c = 0; c <= range.maxC; c++) {
        const addr = this._cellAddr(r, c);
        const td = document.createElement('td');
        td.dataset.addr = addr;
        td.dataset.r = r;
        td.dataset.c = c;

        // Determine cell content
        const refKey = this.activeSheet + '!' + addr;
        const uddRef = sheetRefs[refKey];
        const cell = ws[addr];

        if (uddRef && isRef(uddRef)) {
          const resolved = resolveRef(this.data, uddRef);
          td.textContent = resolved;
          if (app.renderMode && typeof applyMdHtml === 'function') applyMdHtml(td, app, {inline:true});
          td.classList.add('sheet-ref');
          td.title = uddRef;
        } else if (cell) {
          td.textContent = cell.w || (cell.v !== undefined ? String(cell.v) : '');
          if (app.renderMode && typeof applyMdHtml === 'function') applyMdHtml(td, app, {inline:true});
          if (cell.f) td.title = '=' + cell.f;
        }

        // Selection highlight
        const isSelected = (r === selR && c === selC);
        const inRange = (r >= selMinR && r <= selMaxR && c >= selMinC && c <= selMaxC);
        if (isSelected) td.classList.add('selected');
        else if (inRange) td.classList.add('in-range');

        // Column width
        const cw = this._colWidths[this._colName(c)];
        if (cw) td.style.width = cw + 'px';

        td.onclick = (e) => this._selectCell(addr, e);
        td.ondblclick = () => this._startEdit(addr);

        // Fill handle on selected cell
        if (isSelected) {
          const handle = document.createElement('div');
          handle.className = 'sheet-fill-handle';
          handle.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._startFillDrag(e, addr, r, c, table);
          };
          td.appendChild(handle);
        }

        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    gridWrap.appendChild(table);

    // Keyboard / clipboard
    gridWrap.tabIndex = 0;
    gridWrap.addEventListener('keydown', e => this._onGridKeyDown(e));
    gridWrap.addEventListener('copy', e => this._onCopy(e));
    gridWrap.addEventListener('paste', e => this._onPaste(e));

    // Auto-expand on scroll
    gridWrap.addEventListener('scroll', () => {
      const threshold = 80;
      if (gridWrap.scrollTop + gridWrap.clientHeight >= gridWrap.scrollHeight - threshold ||
          gridWrap.scrollLeft + gridWrap.clientWidth >= gridWrap.scrollWidth - threshold) {
        this._expandSheet(ws, 20, 5);
      }
    });

    this.el.appendChild(gridWrap);
    this._gridWrap = gridWrap;

    // Sheet tabs
    const tabs = document.createElement('div');
    tabs.className = 'sheet-tabs';
    for (const name of this.workbook.SheetNames) {
      const tab = document.createElement('span');
      tab.className = 'sheet-tab' + (name === this.activeSheet ? ' active' : '');
      tab.textContent = name;
      tab.onclick = () => { this.activeSheet = name; this.selectedCell = 'A1'; this.rangeStart = { r: 0, c: 0 }; this.rangeEnd = { r: 0, c: 0 }; this.render(this.data); };
      tab.oncontextmenu = (e) => { e.preventDefault(); this._showTabMenu(e.clientX, e.clientY, name); };
      tabs.appendChild(tab);
    }
    const addBtn = document.createElement('button');
    addBtn.className = 'sheet-tab-add';
    addBtn.textContent = '+';
    addBtn.title = '新建工作表';
    addBtn.onclick = () => this._addSheet();
    tabs.appendChild(addBtn);
    this.el.appendChild(tabs);

    this._updateFormulaBar();
    requestAnimationFrame(() => gridWrap.focus());
    this._rendered = true; // Plan D：视图缓存命中标记
  }

  // ---- Sheet range ----

  _getSheetRange(ws) {
    if (!ws || !ws['!ref']) return { maxR: 49, maxC: 25 };
    const parts = ws['!ref'].split(':');
    const end = parts[1] ? this._parseAddr(parts[1]) : this._parseAddr(parts[0]);
    // Add buffer rows/cols beyond data extent
    return { maxR: end.r + 20, maxC: Math.max(end.c + 5, 25) };
  }

  _expandSheet(ws, addRows, addCols) {
    const cur = this._visibleRange;
    const newMaxR = cur.maxR + addRows;
    const newMaxC = cur.maxC + addCols;
    this._visibleRange = { maxR: newMaxR, maxC: newMaxC };
    // Update ws ref to cover the expanded area
    const curRef = ws['!ref'] || 'A1:A1';
    const parts = curRef.split(':');
    const end = parts[1] ? this._parseAddr(parts[1]) : { r: 0, c: 0 };
    ws['!ref'] = 'A1:' + this._cellAddr(Math.max(end.r, newMaxR - 20), Math.max(end.c, newMaxC - 5));
    // Re-render without full refresh (update DOM)
    this.render(this.data);
  }

  // ---- Cell addressing helpers ----

  _colName(c) {
    let name = '';
    c++;
    while (c > 0) { c--; name = String.fromCharCode(65 + (c % 26)) + name; c = Math.floor(c / 26); }
    return name;
  }

  _colIndex(name) {
    let idx = 0;
    for (let i = 0; i < name.length; i++) idx = idx * 26 + (name.charCodeAt(i) - 64);
    return idx - 1;
  }

  _cellAddr(r, c) { return this._colName(c) + (r + 1); }

  _parseAddr(addr) {
    const m = addr.match(/^([A-Z]+)(\d+)$/);
    if (!m) return { r: 0, c: 0 };
    return { r: parseInt(m[2]) - 1, c: this._colIndex(m[1]) };
  }

  // ---- Selection ----

  _selectCell(addr, e) {
    if (this.editingCell) this._commitEdit();
    const { r, c } = this._parseAddr(addr);
    if (e && e.shiftKey) {
      // Extend range
      this.rangeEnd = { r, c };
    } else {
      this.selectedCell = addr;
      this.rangeStart = { r, c };
      this.rangeEnd = { r, c };
    }
    this._updateFormulaBar();
    this.render(this.data);
  }

  _selectCol(c) {
    const maxR = this._visibleRange.maxR;
    this.selectedCell = this._cellAddr(0, c);
    this.rangeStart = { r: 0, c };
    this.rangeEnd = { r: maxR, c };
    this._updateFormulaBar();
    this.render(this.data);
  }

  _selectRow(r) {
    const maxC = this._visibleRange.maxC;
    this.selectedCell = this._cellAddr(r, 0);
    this.rangeStart = { r, c: 0 };
    this.rangeEnd = { r, c: maxC };
    this._updateFormulaBar();
    this.render(this.data);
  }

  _updateFormulaBar() {
    const addrEl = document.getElementById('sheet-addr');
    const formulaEl = document.getElementById('sheet-formula');
    if (addrEl) addrEl.value = this.selectedCell;
    if (!formulaEl) return;
    const ws = this.workbook && this.workbook.Sheets[this.activeSheet];
    if (!ws) { formulaEl.value = ''; return; }
    const sheetRefs = (this.data && this.data._sheetRefs) || {};
    const refKey = this.activeSheet + '!' + this.selectedCell;
    const uddRef = sheetRefs[refKey];
    if (uddRef) {
      formulaEl.value = uddRef;
    } else {
      const cell = ws[this.selectedCell];
      if (cell && cell.f) formulaEl.value = '=' + cell.f;
      else if (cell && cell.v !== undefined) formulaEl.value = String(cell.v);
      else formulaEl.value = '';
    }
  }

  // ---- Editing ----

  _startEdit(addr) {
    this.editingCell = addr;
    const td = this.el.querySelector(`td[data-addr="${addr}"]`);
    if (!td) return;
    td.classList.add('editing');
    const editor = document.createElement('input');
    editor.className = 'sheet-cell-editor';
    editor.style.display = 'block';
    const ws = this.workbook.Sheets[this.activeSheet];
    const sheetRefs = (this.data && this.data._sheetRefs) || {};
    const refKey = this.activeSheet + '!' + addr;
    const uddRef = sheetRefs[refKey];
    if (uddRef) editor.value = uddRef;
    else {
      const cell = ws && ws[addr];
      if (cell && cell.f) editor.value = '=' + cell.f;
      else if (cell && cell.v !== undefined) editor.value = String(cell.v);
      else editor.value = '';
    }
    td.textContent = '';
    td.appendChild(editor);
    editor.focus();
    editor.select();
    editor.addEventListener('keydown', e => {
      if (e.key === 'Enter') { this._commitEdit(); e.preventDefault(); this._moveSelection(1, 0, false); }
      else if (e.key === 'Tab') { this._commitEdit(); e.preventDefault(); this._moveSelection(0, e.shiftKey ? -1 : 1, false); }
      else if (e.key === 'Escape') { this._cancelEdit(); }
    });
    editor.addEventListener('blur', () => {
      if (this.editingCell === addr) this._commitEdit();
    });
  }

  _writeCell(addr, value) {
    const ws = this.workbook.Sheets[this.activeSheet];
    if (!this.data._sheetRefs) this.data._sheetRefs = {};
    const refKey = this.activeSheet + '!' + addr;

    if (value === '' || value === null || value === undefined) {
      delete ws[addr];
      delete this.data._sheetRefs[refKey];
    } else if (typeof value === 'string' && value.startsWith('=') && isRef(value)) {
      this.data._sheetRefs[refKey] = value;
      const resolved = resolveRef(this.data, value);
      ws[addr] = { v: resolved, t: 's' };
    } else if (typeof value === 'string' && value.startsWith('=')) {
      delete this.data._sheetRefs[refKey];
      ws[addr] = { f: value.slice(1) };
    } else {
      delete this.data._sheetRefs[refKey];
      const str = String(value);
      const num = Number(str);
      if (str !== '' && !isNaN(num) && str.trim() !== '') {
        ws[addr] = { v: num, t: 'n' };
      } else {
        ws[addr] = { v: str, t: 's' };
      }
    }
    this._updateSheetRange(ws, addr);
  }

  _commitEdit() {
    if (!this.editingCell) return;
    const addr = this.editingCell;
    const td = this.el.querySelector(`td[data-addr="${addr}"]`);
    const editor = td ? td.querySelector('.sheet-cell-editor') : null;
    const value = editor ? editor.value : '';
    this.editingCell = null;
    this._writeCell(addr, value);
    if (typeof app !== 'undefined') app.markDirty();
    this.render(this.data);
  }

  _cancelEdit() {
    this.editingCell = null;
    this.render(this.data);
  }

  _applyFormulaBar(value) {
    const addr = this.selectedCell;
    this._writeCell(addr, value);
    if (typeof app !== 'undefined') app.markDirty();
    this.render(this.data);
  }

  _updateSheetRange(ws, addr) {
    const { r, c } = this._parseAddr(addr);
    const oldRef = ws['!ref'] || 'A1';
    const parts = oldRef.split(':');
    const end = parts[1] ? this._parseAddr(parts[1]) : this._parseAddr(parts[0]);
    const maxR = Math.max(end.r, r);
    const maxC = Math.max(end.c, c);
    ws['!ref'] = 'A1:' + this._cellAddr(maxR, maxC);
  }

  // ---- Navigation ----

  _moveSelection(dr, dc, extendRange = false) {
    const { r, c } = this._parseAddr(this.selectedCell);
    const nr = Math.max(0, r + dr);
    const nc = Math.max(0, c + dc);
    const newAddr = this._cellAddr(nr, nc);

    if (extendRange) {
      this.rangeEnd = { r: nr, c: nc };
    } else {
      this.selectedCell = newAddr;
      this.rangeStart = { r: nr, c: nc };
      this.rangeEnd = { r: nr, c: nc };
    }

    this._updateFormulaBar();

    // Auto-expand if moving beyond current visible range
    const ws = this.workbook.Sheets[this.activeSheet];
    if (nr > this._visibleRange.maxR - 5 || nc > this._visibleRange.maxC - 2) {
      const addR = nr > this._visibleRange.maxR - 5 ? 20 : 0;
      const addC = nc > this._visibleRange.maxC - 2 ? 5 : 0;
      this._visibleRange = { maxR: this._visibleRange.maxR + addR, maxC: this._visibleRange.maxC + addC };
    }

    this.render(this.data);
  }

  _onGridKeyDown(e) {
    if (this.editingCell) return;
    const shift = e.shiftKey;
    if (e.key === 'ArrowUp')    { e.preventDefault(); this._moveSelection(-1, 0, shift); }
    else if (e.key === 'ArrowDown')  { e.preventDefault(); this._moveSelection(1, 0, shift); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); this._moveSelection(0, -1, shift); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); this._moveSelection(0, 1, shift); }
    else if (e.key === 'Enter') { e.preventDefault(); this._startEdit(this.selectedCell); }
    else if (e.key === 'Tab')   { e.preventDefault(); this._moveSelection(0, e.shiftKey ? -1 : 1, false); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this._deleteRange();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      this._startEdit(this.selectedCell);
      requestAnimationFrame(() => {
        const editor = this.el.querySelector('.sheet-cell-editor');
        if (editor) { editor.value = e.key; editor.setSelectionRange(1, 1); }
      });
    }
  }

  _deleteRange() {
    const selMinR = Math.min(this.rangeStart.r, this.rangeEnd.r);
    const selMaxR = Math.max(this.rangeStart.r, this.rangeEnd.r);
    const selMinC = Math.min(this.rangeStart.c, this.rangeEnd.c);
    const selMaxC = Math.max(this.rangeStart.c, this.rangeEnd.c);
    const ws = this.workbook.Sheets[this.activeSheet];
    for (let r = selMinR; r <= selMaxR; r++) {
      for (let c = selMinC; c <= selMaxC; c++) {
        const addr = this._cellAddr(r, c);
        delete ws[addr];
        const refKey = this.activeSheet + '!' + addr;
        if (this.data._sheetRefs) delete this.data._sheetRefs[refKey];
      }
    }
    if (typeof app !== 'undefined') app.markDirty();
    this.render(this.data);
  }

  // ---- Copy / Paste (Excel compatible range) ----

  _onCopy(e) {
    e.preventDefault();
    const ws = this.workbook.Sheets[this.activeSheet];
    const sheetRefs = (this.data && this.data._sheetRefs) || {};
    const selMinR = Math.min(this.rangeStart.r, this.rangeEnd.r);
    const selMaxR = Math.max(this.rangeStart.r, this.rangeEnd.r);
    const selMinC = Math.min(this.rangeStart.c, this.rangeEnd.c);
    const selMaxC = Math.max(this.rangeStart.c, this.rangeEnd.c);

    const rows = [];
    for (let r = selMinR; r <= selMaxR; r++) {
      const cols = [];
      for (let c = selMinC; c <= selMaxC; c++) {
        const addr = this._cellAddr(r, c);
        const refKey = this.activeSheet + '!' + addr;
        const uddRef = sheetRefs[refKey];
        if (uddRef && isRef(uddRef)) {
          cols.push(resolveRef(this.data, uddRef));
        } else {
          const cell = ws && ws[addr];
          cols.push(cell && cell.v !== undefined ? String(cell.v) : '');
        }
      }
      rows.push(cols.join('\t'));
    }
    e.clipboardData.setData('text/plain', rows.join('\n'));
  }

  _onPaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const ws = this.workbook.Sheets[this.activeSheet];
    const { r: startR, c: startC } = this._parseAddr(this.selectedCell);
    const rows = text.split(/\r?\n/);
    if (!this.data._sheetRefs) this.data._sheetRefs = {};

    for (let ri = 0; ri < rows.length; ri++) {
      if (!rows[ri] && ri === rows.length - 1) break;
      const cols = rows[ri].split('\t');
      for (let ci = 0; ci < cols.length; ci++) {
        const addr = this._cellAddr(startR + ri, startC + ci);
        this._writeCell(addr, cols[ci]);
      }
    }
    if (typeof app !== 'undefined') app.markDirty();
    this.render(this.data);
  }

  // ---- Fill down (drag handle) ----

  _startFillDrag(e, startAddr, startR, startC, table) {
    this._fillDrag = { startAddr, startR, startC, table };
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;cursor:crosshair;z-index:9999';
    document.body.appendChild(overlay);

    const onMove = (ev) => {
      // Find target row from mouse position
      const tableRect = table.getBoundingClientRect();
      const rowHeight = 25; // approximate
      const relY = ev.clientY - tableRect.top - 22; // subtract header height
      const targetR = Math.max(startR, Math.floor(relY / rowHeight));
      this._fillDrag.targetR = targetR;
      // Highlight range
      table.querySelectorAll('td.fill-preview').forEach(td => td.classList.remove('fill-preview'));
      for (let r = startR + 1; r <= targetR; r++) {
        const td = table.querySelector(`td[data-r="${r}"][data-c="${startC}"]`);
        if (td) td.classList.add('fill-preview');
      }
    };

    const onUp = () => {
      overlay.remove();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (this._fillDrag && this._fillDrag.targetR > startR) {
        this.fillDown(startAddr, this._fillDrag.targetR - startR);
      }
      this._fillDrag = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  fillDown(startAddr, count) {
    const ws = this.workbook.Sheets[this.activeSheet];
    if (!this.data._sheetRefs) this.data._sheetRefs = {};
    const sheetRefs = this.data._sheetRefs;
    const refKey = this.activeSheet + '!' + startAddr;
    const uddRef = sheetRefs[refKey];
    const cell = ws && ws[startAddr];
    const { r: startR, c } = this._parseAddr(startAddr);

    for (let i = 1; i <= count; i++) {
      const newAddr = this._cellAddr(startR + i, c);
      if (uddRef && isRef(uddRef)) {
        const newRef = this._incrementRef(uddRef, i);
        sheetRefs[this.activeSheet + '!' + newAddr] = newRef;
        if (!ws[newAddr]) ws[newAddr] = {};
        ws[newAddr] = { v: resolveRef(this.data, newRef), t: 's' };
      } else if (cell && cell.f) {
        const newFormula = this._incrementFormula(cell.f, i, 'row');
        ws[newAddr] = { f: newFormula };
      } else if (cell && cell.v !== undefined) {
        const num = Number(cell.v);
        if (!isNaN(num)) ws[newAddr] = { v: num + i, t: 'n' };
        else ws[newAddr] = { v: cell.v, t: cell.t || 's' };
      }
      this._updateSheetRange(ws, newAddr);
    }
    if (typeof app !== 'undefined') app.markDirty();
    this.render(this.data);
  }

  _incrementRef(refStr, delta) {
    return refStr.replace(/(t\d+-?)(\d+)/, (m, prefix, num) => prefix + (parseInt(num) + delta));
  }

  _incrementFormula(formula, delta, dir) {
    return formula.replace(/([A-Z]+)(\d+)/g, (m, col, row) => {
      return dir === 'row' ? col + (parseInt(row) + delta) : m;
    });
  }

  // ---- Sheet tab management ----

  _addSheet() {
    const names = this.workbook.SheetNames;
    let n = names.length + 1;
    let name = 'Sheet' + n;
    while (names.includes(name)) { n++; name = 'Sheet' + n; }
    const ws = { '!ref': 'A1:A1' };
    XLSX.utils.book_append_sheet(this.workbook, ws, name);
    this.activeSheet = name;
    this.selectedCell = 'A1';
    this.rangeStart = { r: 0, c: 0 };
    this.rangeEnd = { r: 0, c: 0 };
    if (typeof app !== 'undefined') app.markDirty();
    this.render(this.data);
  }

  _showTabMenu(x, y, sheetName) {
    document.querySelectorAll('.sheet-tab-ctx').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'sheet-tab-ctx';
    menu.style.left = x + 'px';
    menu.style.top = (y - 80) + 'px';
    const items = [
      ['重命名', () => {
        const newName = prompt('工作表名称:', sheetName);
        if (newName && newName !== sheetName && !this.workbook.SheetNames.includes(newName)) {
          const ws = this.workbook.Sheets[sheetName];
          delete this.workbook.Sheets[sheetName];
          this.workbook.Sheets[newName] = ws;
          const idx = this.workbook.SheetNames.indexOf(sheetName);
          this.workbook.SheetNames[idx] = newName;
          if (this.data._sheetRefs) {
            const newRefs = {};
            for (const [k, v] of Object.entries(this.data._sheetRefs)) {
              newRefs[k.replace(sheetName + '!', newName + '!')] = v;
            }
            this.data._sheetRefs = newRefs;
          }
          if (this.activeSheet === sheetName) this.activeSheet = newName;
          if (typeof app !== 'undefined') app.markDirty();
          this.render(this.data);
        }
      }],
      ['删除', () => {
        if (this.workbook.SheetNames.length <= 1) { toast('至少保留一个工作表'); return; }
        if (!confirm('确定删除 "' + sheetName + '"？')) return;
        const idx = this.workbook.SheetNames.indexOf(sheetName);
        this.workbook.SheetNames.splice(idx, 1);
        delete this.workbook.Sheets[sheetName];
        if (this.activeSheet === sheetName) this.activeSheet = this.workbook.SheetNames[0];
        if (typeof app !== 'undefined') app.markDirty();
        this.render(this.data);
      }]
    ];
    for (const [label, fn] of items) {
      const d = document.createElement('div');
      d.textContent = label;
      d.onclick = () => { menu.remove(); fn(); };
      menu.appendChild(d);
    }
    document.body.appendChild(menu);
    setTimeout(() => {
      const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
      document.addEventListener('mousedown', close);
    }, 0);
  }

  // ---- Column resize ----

  _startColResize(e, colIdx, table) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const colName = this._colName(colIdx);
    const startW = this._colWidths[colName] || 80;
    const onMove = (ev) => {
      const newW = Math.max(30, startW + ev.clientX - startX);
      this._colWidths[colName] = newW;
      table.querySelectorAll(`td[data-c="${colIdx}"]`).forEach(td => td.style.width = newW + 'px');
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ---- Sync UDD refs into workbook values ----

  _syncRefsToWorkbook() {
    if (!this.data || !this.data._sheetRefs) return;
    for (const [key, refStr] of Object.entries(this.data._sheetRefs)) {
      const parts = key.split('!');
      if (parts.length !== 2) continue;
      const [sheetName, addr] = parts;
      const ws = this.workbook.Sheets[sheetName];
      if (!ws) continue;
      if (isRef(refStr)) {
        ws[addr] = { v: resolveRef(this.data, refStr), t: 's' };
      }
    }
  }

  // ---- Resolve sheet cell value (for reverse ref from outline) ----

  getCellValue(sheetName, addr) {
    if (!this.workbook) return '';
    const ws = this.workbook.Sheets[sheetName];
    if (!ws) return '';
    const cell = ws[addr];
    if (!cell) return '';
    return cell.v !== undefined ? cell.v : '';
  }
}
