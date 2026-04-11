// ================================================================
//  UDD Outline View
//  Tree-based outline editor with editable nodes, drag-and-drop,
//  reference display, media rendering, keyboard navigation
// ================================================================

// ================================================================
//  OUTLINE VIEW
// ================================================================
class OutlineView {
  constructor(container) {
    this.el = container;
    this.focusPath = null;
    this.focusField = 'content';
    this.focusCursorEnd = true;
    this.el.addEventListener('keydown', e => this.onKeyDown(e));
    this.el.addEventListener('input', e => this.onInput(e));
    this.el.addEventListener('focusin', e => this.onFocusIn(e));
    this._dragSrcPath = null;
    this.el.addEventListener('dragstart', e => this.onDragStart(e));
    this.el.addEventListener('dragover', e => this.onDragOver(e));
    this.el.addEventListener('dragleave', e => this.onDragLeave(e));
    this.el.addEventListener('drop', e => this.onDrop(e));
    this.el.addEventListener('dragend', e => this.onDragEnd(e));
    this.el.addEventListener('click', e => this.onClick(e));
    this.el.addEventListener('dblclick', e => this.onRefDblClick(e));
    this.el.addEventListener('focusout', e => this.onFocusOut(e));
  }

  render(data) {
    this.data = data;
    this.el.innerHTML = '';
    const rootKeys = getAllTKeys(data);
    for (const key of rootKeys) {
      this.renderNode(data[key], key, getLevel(key), this.el);
    }
    if (this.focusPath) {
      requestAnimationFrame(() => this.restoreFocus());
    }
    this.updateStatus();
  }

  renderNode(node, path, level, container, readOnly) {
    if (!node || typeof node !== 'object') return;
    const desc = resolveNodeForRender(this.data, node, path, level);
    // readOnly: 来自引用的子节点，禁止编辑
    if (readOnly) {
      desc.contentEditable = false;
      desc.bodyEditable = false;
    }

    const div = document.createElement('div');
    div.className = 'outline-node';
    div.dataset.path = path;

    const row = document.createElement('div');
    row.className = 'outline-row';

    // indent
    const indent = document.createElement('span');
    indent.className = 'indent';
    indent.style.width = (Math.max(0, level - 1) * 24) + 'px';
    row.appendChild(indent);

    // fold arrow
    const childLevel = level + 1;
    const ownChildKeys = getChildTKeys(node, childLevel);
    const srcChildKeys = desc.sourceNode ? getAllTKeys(desc.sourceNode) : [];
    const hasVisibleChildren = ownChildKeys.length > 0 || srcChildKeys.length > 0;
    const arrow = document.createElement('span');
    arrow.className = 'outline-arrow' + (!hasVisibleChildren ? ' leaf' : '');
    arrow.textContent = !hasVisibleChildren ? '•' : (desc.hide ? '▶' : '▼');
    if (hasVisibleChildren) {
      arrow.onclick = () => {
        node.hide = node.hide ? 0 : 1;  // toggle node's OWN hide (render field)
        this.focusPath = path;
        this.render(this.data);
        app.markDirty();
      };
    }
    row.appendChild(arrow);

    // contentWrap
    const contentWrap = document.createElement('div');
    contentWrap.className = 'outline-content-wrap';
    const style = this.getStyle(path, level);

    // numbering (skip t0)
    if (level !== 0) {
      const tg = this.data.type_global || {};
      const numStyle = tg.numbering_style || '1.1.1';
      if (numStyle !== 'none') {
        const numSpan = document.createElement('span');
        numSpan.className = 'outline-num';
        numSpan.draggable = true;
        numSpan.dataset.dragPath = path;
        numSpan.textContent = readOnly ? this._getRefChildNumber(path, numStyle) : this.getNumber(path, numStyle);
        this.applyStyle(numSpan, style);
        contentWrap.appendChild(numSpan);
      }
    }

    // content
    const content = document.createElement('div');
    content.className = 'outline-content';
    content.dataset.path = path;
    content.dataset.field = 'content';
    content.dataset.placeholder = level <= 1 ? '输入标题...' : '输入内容...';
    content.spellcheck = false;
    if (!desc.renderOn) {
      // Render OFF: edit raw source directly
      content.textContent = node.content || '';
      content.contentEditable = 'plaintext-only';
      if (!content.contentEditable || content.contentEditable === 'inherit') content.contentEditable = 'true';
    } else if (desc.hasInlineRefs && desc.inlineSegments) {
      renderInlineSegments(content, desc.inlineSegments, this.data, this, (el, rs) => this.applyStyle(el, rs), style);
      content.contentEditable = 'false';
      content.classList.add('ref-display');
      content.dataset.hasRef = '1';
    } else if (desc.contentEditable) {
      const contentText = stripMediaTags(desc.displayContent);
      renderStyledText(content, contentText, node, 'content', style, (el, runStyle) => this.applyStyle(el, runStyle));
      content.contentEditable = 'plaintext-only';
      if (!content.contentEditable || content.contentEditable === 'inherit') content.contentEditable = 'true';
    } else {
      const contentText = stripMediaTags(desc.displayContent);
      renderStyledText(content, contentText, node, 'content', style, (el, runStyle) => this.applyStyle(el, runStyle));
      content.contentEditable = 'false';
      if (desc.refStr) {
        content.classList.add('ref-display');
        content.dataset.ref = desc.refStr;
        if (!isSheetRef(desc.refStr) && parseRef(desc.refStr).docName) content.dataset.refAsync = desc.refStr;
        const refIcon = createRefIcon(this.data, desc.refStr, this);
        content.appendChild(refIcon);
      }
    }
    this.applyStyle(content, style);
    const fmt = app && app.outlineFmt ? app.outlineFmt : {};
    if (fmt.text_align && style.text_align) contentWrap.style.justifyContent = style.text_align === 'center' ? 'center' : style.text_align === 'right' ? 'flex-end' : 'flex-start';
    contentWrap.appendChild(content);

    // body button — for full-node refs, controls node's OWN hide_body
    const bodyBtn = document.createElement('span');
    bodyBtn.className = 'body-btn';
    if (desc.hasBody) {
      bodyBtn.textContent = desc.hide_body ? '▸' : '▾';
      bodyBtn.title = desc.hide_body ? '展开正文' : '折叠正文';
      bodyBtn.onclick = (e) => {
        e.stopPropagation();
        node.hide_body = node.hide_body ? 0 : 1;  // toggle node's OWN hide_body
        this.focusPath = path;
        this.render(this.data);
        app.markDirty();
      };
    } else if (!desc.isFullRef) {
      // Only show "+" add-body button for non-ref nodes
      bodyBtn.textContent = '+';
      bodyBtn.title = '添加正文';
      bodyBtn.onclick = (e) => {
        e.stopPropagation();
        node.body = '';
        node.hide_body = 0;
        this.focusPath = path;
        this.focusField = 'body';
        this.render(this.data);
        app.markDirty();
      };
    }
    contentWrap.appendChild(bodyBtn);

    row.appendChild(contentWrap);
    div.appendChild(row);

    // Media from content (render ON only)
    if (desc.renderOn && hasMediaTag(desc.displayContent)) {
      const mediaDiv = document.createElement('div');
      mediaDiv.className = 'outline-media';
      mediaDiv.style.marginLeft = (Math.max(0, level - 1) * 24 + 22) + 'px';
      renderTextWithMedia(desc.displayContent, mediaDiv, {path, field:'content'}, {suppressAlign: !fmt.text_align});
      div.appendChild(mediaDiv);
    }

    // body — controlled by node's OWN hide_body
    if (!desc.hide_body && (desc.hasBody || (!desc.isRef && this.isBodyEditing(path)))) {
      const bodyEl = document.createElement('div');
      bodyEl.className = 'outline-body';
      if (app && app.outlineFmt && app.outlineFmt.body_border) bodyEl.classList.add('show-border');
      const bodyStyle = this.getBodyStyle(path);

      if (!desc.renderOn) {
        // Render OFF: edit raw body directly
        bodyEl.textContent = node.body || '';
        bodyEl.contentEditable = 'plaintext-only';
        if (!bodyEl.contentEditable || bodyEl.contentEditable === 'inherit') bodyEl.contentEditable = 'true';
        bodyEl.dataset.path = path;
        bodyEl.dataset.field = 'body';
        bodyEl.spellcheck = false;
        bodyEl.style.marginLeft = (Math.max(0, level - 1) * 24 + 22) + 'px';
        this.applyStyle(bodyEl, bodyStyle);
        div.appendChild(bodyEl);
      } else {

      const bodyText = stripMediaTags(desc.displayBody);

      if (desc.bodyEditable) {
        // Editable body (normal node or non-ref body)
        bodyEl.contentEditable = 'plaintext-only';
        if (!bodyEl.contentEditable || bodyEl.contentEditable === 'inherit') bodyEl.contentEditable = 'true';
        renderStyledText(bodyEl, bodyText, node, 'body', bodyStyle, (el, runStyle) => this.applyStyle(el, runStyle));
        bodyEl.dataset.path = path;
        bodyEl.dataset.field = 'body';
        bodyEl.spellcheck = false;
        // Check if body itself is a field-ref
        const rawBody = node.body || '';
        if (isRef(rawBody)) {
          bodyEl.classList.add('ref-display');
          bodyEl.dataset.ref = rawBody;
          if (parseRef(rawBody).docName) bodyEl.dataset.refAsync = rawBody;
          bodyEl.contentEditable = 'false';
          const bodyRefIcon = createRefIcon(this.data, rawBody, this);
          bodyEl.insertBefore(bodyRefIcon, bodyEl.firstChild);
        }
      } else {
        // Read-only body (from full-node ref source — pure visual clone)
        bodyEl.contentEditable = 'false';
        renderStyledText(bodyEl, bodyText, desc.sourceNode || node, 'body', bodyStyle, (el, runStyle) => this.applyStyle(el, runStyle));
      }
      bodyEl.style.marginLeft = (Math.max(0, level - 1) * 24 + 22) + 'px';
      this.applyStyle(bodyEl, bodyStyle);
      div.appendChild(bodyEl);

      // Media from body (render ON only)
      const bodyMediaSrc = desc.isFullRef ? desc.displayBody : (node.body || '');
      if (hasMediaTag(bodyMediaSrc)) {
        const bodyMediaDiv = document.createElement('div');
        bodyMediaDiv.className = 'outline-media';
        bodyMediaDiv.style.marginLeft = (Math.max(0, level - 1) * 24 + 22) + 'px';
        renderTextWithMedia(bodyMediaSrc, bodyMediaDiv, {path, field:'body'}, {suppressAlign: !fmt.text_align});
        div.appendChild(bodyMediaDiv);
      }
      } // end render ON body block
    }

    // children — node's OWN hide controls visibility
    if (!desc.hide) {
      // 统一渲染: 全节点引用时遍历源节点的子节点，否则遍历自身子节点
      const renderSource = desc.sourceNode || node;
      const renderChildKeys = desc.sourceNode ? getAllTKeys(desc.sourceNode) : ownChildKeys;
      if (renderChildKeys.length > 0) {
        const childContainer = document.createElement('div');
        childContainer.className = 'outline-children';
        if (fmt.tree_lines && level >= 1) {
          childContainer.classList.add('tree-lines');
          childContainer.style.setProperty('--tree-x', ((level - 1) * 24 + 30) + 'px');
        }
        for (const ck of renderChildKeys) {
          const childNode = renderSource[ck];
          if (!childNode || typeof childNode !== 'object') continue;
          // 引用子节点: 用合成路径 + readOnly 标记，走统一 renderNode
          const childPath = desc.sourceNode ? path + '.__ref__.' + ck : path + '.' + ck;
          this.renderNode(childNode, childPath, getLevel(ck), childContainer, !!desc.sourceNode);
        }
        div.appendChild(childContainer);
      }
    }

    container.appendChild(div);
  }

  // 引用子节点的简单编号（path 含 __ref__，无法走正常 getNumber）
  _getRefChildNumber(path, numStyle) {
    if (numStyle === 'bullet') {
      const bullets = ['●','○','■','▪'];
      const refIdx = path.indexOf('.__ref__.');
      const refPart = refIdx >= 0 ? path.slice(refIdx + 9) : path;
      const depth = refPart.split('.').length - 1;
      return bullets[Math.min(depth, bullets.length - 1)];
    }
    if (numStyle === 'bullet-uniform') return '●';
    // Extract the last tNode key and find its sibling index
    const parts = path.split('.');
    const lastKey = parts[parts.length - 1];
    // Simple fallback: just use the number from the key (t2-3 → 3)
    const m = lastKey.match(/^t\d+-(\d+)$/);
    return m ? m[1] : '';
  }

  isBodyEditing(path) { return this.focusPath === path && this.focusField === 'body'; }

  getNumber(path, numStyle) {
    const parts = path.split('.');
    const nums = [];
    let obj = this.data;
    for (const part of parts) {
      const level = getLevel(part);
      if (level === 0) { obj = obj[part]; continue; }
      const siblings = getChildTKeys(obj, level);
      const idx = siblings.indexOf(part);
      nums.push(idx + 1);
      obj = obj[part];
    }
    if (nums.length === 0) return '';
    if (numStyle === '1.1.1') return nums.join('.');
    if (numStyle === '一.1.1') {
      const cn = ['零','一','二','三','四','五','六','七','八','九','十',
                   '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十'];
      const first = cn[nums[0]] || nums[0];
      return nums.length === 1 ? first : first + '.' + nums.slice(1).join('.');
    }
    if (numStyle === 'I.A.1') {
      const roman = ['','I','II','III','IV','V','VI','VII','VIII','IX','X'];
      const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let result = '';
      if (nums[0]) result = roman[nums[0]] || nums[0];
      if (nums[1]) result += '.' + (alpha[nums[1]-1] || nums[1]);
      if (nums[2]) result += '.' + nums[2];
      for (let i = 3; i < nums.length; i++) result += '.' + nums[i];
      return result;
    }
    if (numStyle === 'bullet') {
      const bullets = ['●','○','■','▪'];
      const depth = nums.length - 1;
      return bullets[Math.min(depth, bullets.length - 1)];
    }
    if (numStyle === 'bullet-uniform') return '●';
    return nums.join('.');
  }

  getStyle(path, level) {
    // 引用子节点: 用宿主路径查找样式
    const stylePath = path.includes('.__ref__.') ? path.split('.__ref__.')[0] : path;
    return buildNodeStyle(this.data, stylePath, level, { isBody: false });
  }

  getBodyStyle(path) {
    const stylePath = path.includes('.__ref__.') ? path.split('.__ref__.')[0] : path;
    return buildNodeStyle(this.data, stylePath, undefined, { isBody: true });
  }

  applyStyle(el, style) {
    applyFmtStyle(el, style, app && app.outlineFmt ? app.outlineFmt : {});
  }

  // Sync all editable elements to data
  syncAll() {
    this.el.querySelectorAll('[data-path][data-field]').forEach(el => {
      if (el.dataset.ref || el.dataset.hasRef) return; // skip reference cells
      if (!el.isContentEditable) return;
      const node = getNodeByPath(this.data, el.dataset.path);
      if (!node) return;
      const field = el.dataset.field;
      node[field] = mergeEditableTextAndMedia(node[field], el.textContent);
    });
    // Normalize duplicate media tags after sync (done here, not on every render)
    if (typeof app !== 'undefined' && app._normalizeEmbeddedTagsInData) {
      app._normalizeEmbeddedTagsInData(this.data);
    }
  }

  onInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.path || !el.dataset.field) return;
    if (el.dataset.ref || el.dataset.hasRef) return; // skip reference cells
    if (!el.isContentEditable) return;
    const node = getNodeByPath(this.data, el.dataset.path);
    if (node) {
      node[el.dataset.field] = mergeEditableTextAndMedia(node[el.dataset.field], el.textContent);
      app.markDirty();
    }
    this.updateStatus();
  }

  onFocusOut(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.path || !el.dataset.field) return;
    if (el.dataset.ref || el.dataset.hasRef) return;
    const node = getNodeByPath(this.data, el.dataset.path);
    if (!node) return;
    const val = node[el.dataset.field];
    if (isRef(val)) {
      // Value became a reference — re-render to show resolved value
      this.focusPath = null;
      this.render(this.data);
      app._resolveAsyncRefs(this.el);
    }
  }

  onRefDblClick(e) {
    const el = e.target.closest('[data-path][data-field]');
    if (!el || e.target.classList.contains('ref-icon')) return;
    const refEl = e.target.closest('.ref-display');
    if (!refEl || (!refEl.dataset.ref && !refEl.dataset.hasRef)) return;
    const node = getNodeByPath(this.data, refEl.dataset.path);
    if (!node) return;
    const field = refEl.dataset.field || 'content';
    const raw = node[field] || '';
    this.focusPath = refEl.dataset.path;
    this.focusField = field;
    refEl.classList.remove('ref-display');
    delete refEl.dataset.ref;
    delete refEl.dataset.hasRef;
    delete refEl.dataset.refAsync;
    refEl.textContent = raw;
    refEl.contentEditable = 'plaintext-only';
    if (!refEl.contentEditable || refEl.contentEditable === 'inherit') refEl.contentEditable = 'true';
    refEl.focus();
    const range = document.createRange();
    range.selectNodeContents(refEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  onClick(e) {
    const el = e.target.closest('[data-path][data-field]');
    if (!el) return;
    this.focusPath = el.dataset.path;
    this.focusField = el.dataset.field || 'content';
    app.updateToolbar(this.focusPath);
    this.updateStatus();
    app.updateSidebar(this.focusPath);
  }

  onFocusIn(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.path) return;
    this.focusPath = el.dataset.path;
    this.focusField = el.dataset.field || 'content';
    app.updateToolbar(this.focusPath);
    this.updateStatus();
    app.updateSidebar(this.focusPath);
  }

  _clearDragIndicators() {
    this.el.querySelectorAll('.drag-above,.drag-below,.drag-child').forEach(el => el.classList.remove('drag-above','drag-below','drag-child'));
  }

  onDragStart(e) {
    const num = e.target.closest('[data-drag-path]');
    if (!num) { e.preventDefault(); return; }
    this._dragSrcPath = num.dataset.dragPath;
    const nodeEl = this.el.querySelector(`.outline-node[data-path="${this._dragSrcPath}"]`);
    if (nodeEl) nodeEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this._dragSrcPath);
  }

  onDragOver(e) {
    if (!this._dragSrcPath) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    this._clearDragIndicators();
    const row = e.target.closest('.outline-row');
    if (!row) return;
    const nodeEl = row.closest('.outline-node');
    const dstPath = nodeEl && nodeEl.dataset.path;
    if (!dstPath || dstPath === this._dragSrcPath || dstPath.startsWith(this._dragSrcPath + '.')) return;
    const rect = row.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (y < 0.25) row.classList.add('drag-above');
    else if (y > 0.75) row.classList.add('drag-below');
    else row.classList.add('drag-child');
  }

  onDragLeave(e) {
    const row = e.target.closest('.outline-row');
    if (row) row.classList.remove('drag-above','drag-below','drag-child');
  }

  onDrop(e) {
    e.preventDefault();
    const row = e.target.closest('.outline-row');
    if (!row || !this._dragSrcPath) return;
    const nodeEl = row.closest('.outline-node');
    const dstPath = nodeEl && nodeEl.dataset.path;
    if (!dstPath) return;
    const mode = row.classList.contains('drag-above') ? 'before'
      : row.classList.contains('drag-child') ? 'child' : 'after';
    this._clearDragIndicators();
    this.syncAll();
    app.pushUndo();
    const newPath = moveNodeData(this.data, this._dragSrcPath, dstPath, mode);
    if (newPath) {
      this.focusPath = newPath;
      this.focusField = 'content';
      this.render(this.data);
      app.markDirty();
    }
    this._dragSrcPath = null;
  }

  onDragEnd() {
    this._clearDragIndicators();
    this.el.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    this._dragSrcPath = null;
  }

  onKeyDown(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.path) return;
    const path = el.dataset.path;
    const field = el.dataset.field || 'content';

    if (field === 'body') {
      if (e.key === 'Backspace' && el.textContent === '') {
        e.preventDefault();
        this.syncAll();
        app.pushUndo();
        this.deleteBody(path);
      }
      return;
    }

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        this.syncAll();
        app.pushUndo();
        this.smartEnter(path, el);
        break;
      case 'Tab':
        e.preventDefault();
        this.syncAll();
        app.pushUndo();
        if (e.shiftKey) this.outdentNode(path);
        else this.indentNode(path);
        break;
      case 'Backspace':
        if (el.textContent === '') {
          e.preventDefault();
          this.syncAll();
          app.pushUndo();
          this.deleteNode(path);
        }
        break;
      case 'ArrowUp':
        if (this.getCursorLine(el) === 0) {
          e.preventDefault();
          this.moveFocus(path, -1);
        }
        break;
      case 'ArrowDown':
        if (this.getCursorLine(el) === this.getLineCount(el) - 1) {
          e.preventDefault();
          this.moveFocus(path, 1);
        }
        break;
    }
  }

  getCursorLine() { return 0; }
  getLineCount() { return 1; }

  addSiblingAfter(path) {
    const parts = path.split('.');
    const currentKey = parts[parts.length - 1];
    const level = getLevel(currentKey);
    let parent = parts.length === 1 ? this.data : getNodeByPath(this.data, parts.slice(0,-1).join('.'));
    const newSeqNum = nextSeq(parent, level);
    const newKey = `t${level}-${newSeqNum}`;
    const newNode = { content: '', hide: 0, hide_body: 0 };
    insertAfter(parent, currentKey, newKey, newNode);
    const newPath = parts.length === 1 ? newKey : parts.slice(0,-1).join('.') + '.' + newKey;
    this.focusPath = newPath;
    this.focusField = 'content';
    this.focusCursorEnd = false;
    this.render(this.data);
    app.markDirty();
  }

  addSiblingBefore(path) {
    const parts = path.split('.');
    const currentKey = parts[parts.length - 1];
    const level = getLevel(currentKey);
    let parent = parts.length === 1 ? this.data : getNodeByPath(this.data, parts.slice(0,-1).join('.'));
    const newSeqNum = nextSeq(parent, level);
    const newKey = `t${level}-${newSeqNum}`;
    const newNode = { content: '', hide: 0, hide_body: 0 };
    insertBefore(parent, currentKey, newKey, newNode);
    const newPath = parts.length === 1 ? newKey : parts.slice(0,-1).join('.') + '.' + newKey;
    this.focusPath = newPath;
    this.focusField = 'content';
    this.focusCursorEnd = false;
    this.render(this.data);
    app.markDirty();
  }

  smartEnter(path, el) {
    const text = el.textContent || '';
    const offsets = getSelectionOffsetsWithin(el);
    const cursor = offsets ? offsets.start : text.length;
    if (cursor === 0 && text.length > 0) {
      this.addSiblingBefore(path);
    } else if (cursor >= text.length) {
      this.addSiblingAfter(path);
    } else {
      const parts = path.split('.');
      const currentKey = parts[parts.length - 1];
      const node = getNodeByPath(this.data, path);
      const media = extractMediaTags(node.content);
      const before = text.substring(0, cursor);
      const after = text.substring(cursor);
      node.content = before + media;
      const level = getLevel(currentKey);
      let parent = parts.length === 1 ? this.data : getNodeByPath(this.data, parts.slice(0,-1).join('.'));
      const newSeqNum = nextSeq(parent, level);
      const newKey = `t${level}-${newSeqNum}`;
      const newNode = { content: after, hide: 0, hide_body: 0 };
      insertAfter(parent, currentKey, newKey, newNode);
      const newPath = parts.length === 1 ? newKey : parts.slice(0,-1).join('.') + '.' + newKey;
      this.focusPath = newPath;
      this.focusField = 'content';
      this.focusCursorEnd = false;
      this.render(this.data);
      app.markDirty();
    }
  }

  indentNode(path) {
    const newPath = indentNodeData(this.data, path);
    if (!newPath) return;
    this.focusPath = newPath;
    this.focusField = 'content';
    this.render(this.data);
    app.markDirty();
  }

  outdentNode(path) {
    const newPath = outdentNodeData(this.data, path);
    if (!newPath) return;
    this.focusPath = newPath;
    this.focusField = 'content';
    this.render(this.data);
    app.markDirty();
  }

  deleteNode(path) {
    const parts = path.split('.');
    const currentKey = parts[parts.length - 1];
    const level = getLevel(currentKey);
    let parent = parts.length === 1 ? this.data : getNodeByPath(this.data, parts.slice(0,-1).join('.'));
    const siblings = getChildTKeys(parent, level);

    // Don't delete the very last root node
    if (parts.length === 1 && getAllTKeys(this.data).length <= 1) return;

    const idx = siblings.indexOf(currentKey);
    const node = parent[currentKey];
    const childKeys = getAllTKeys(node);
    if (childKeys.length > 0) {
      if (!confirm('该节点下有子节点，确定删除？')) return;
    }

    delete parent[currentKey];

    // Focus previous sibling or parent
    if (idx > 0) {
      const prevKey = siblings[idx - 1];
      this.focusPath = parts.length === 1 ? prevKey : parts.slice(0,-1).join('.') + '.' + prevKey;
    } else if (parts.length > 1) {
      this.focusPath = parts.slice(0,-1).join('.');
    } else {
      // Find another root node
      const remaining = getAllTKeys(this.data);
      this.focusPath = remaining.length > 0 ? remaining[0] : null;
    }
    this.focusField = 'content';
    this.focusCursorEnd = true;
    this.render(this.data);
    app.markDirty();
  }

  deleteBody(path) {
    const node = getNodeByPath(this.data, path);
    if (!node) return;
    delete node.body;
    node.hide_body = 0;
    this.focusPath = path;
    this.focusField = 'content';
    this.focusCursorEnd = true;
    this.render(this.data);
    app.markDirty();
  }

  moveFocus(currentPath, direction) {
    const visible = this.getVisiblePaths();
    const idx = visible.indexOf(currentPath);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx >= 0 && newIdx < visible.length) {
      this.focusPath = visible[newIdx];
      this.focusField = 'content';
      this.focusCursorEnd = direction > 0 ? false : true;
      this.restoreFocus();
    }
  }

  getVisiblePaths() {
    const paths = [];
    const walk = (obj, prefix) => {
      const tkeys = getAllTKeys(obj);
      for (const k of tkeys) {
        const p = prefix ? prefix + '.' + k : k;
        paths.push(p);
        if (!obj[k].hide) walk(obj[k], p);
      }
    };
    walk(this.data, '');
    return paths;
  }

  restoreFocus() {
    if (!this.focusPath) return;
    const sel = `[data-path="${this.focusPath}"][data-field="${this.focusField}"]`;
    const el = this.el.querySelector(sel);
    if (el) {
      el.focus();
      // Move cursor to end or beginning
      const range = document.createRange();
      const selObj = window.getSelection();
      if (el.childNodes.length > 0) {
        if (this.focusCursorEnd) {
          range.selectNodeContents(el);
          range.collapse(false);
        } else {
          range.selectNodeContents(el);
          range.collapse(true);
        }
        selObj.removeAllRanges();
        selObj.addRange(range);
      }
    }
    this.focusCursorEnd = true;
  }

  updateStatus() {
    let nodeCount = 0, wordCount = 0;
    const countNodes = (obj) => {
      for (const k of getAllTKeys(obj)) {
        nodeCount++;
        wordCount += (obj[k].content || '').length + (obj[k].body || '').length;
        countNodes(obj[k]);
      }
    };
    countNodes(this.data);
    document.getElementById('stat-nodes').textContent = '节点: ' + nodeCount;
    document.getElementById('stat-words').textContent = '字数: ' + wordCount;
    if (this.focusPath) {
      const parts = this.focusPath.split('.');
      const key = parts[parts.length - 1];
      document.getElementById('stat-level').textContent = '层级: ' + getLevel(key);
    }
  }
}
