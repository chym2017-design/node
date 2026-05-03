// ================================================================
//  UDD Document View
//  Page-style document rendering with headings, body text,
//  reference clones, media, and inline editing
// ================================================================

//  DOCUMENT VIEW
// ================================================================
class DocumentView {
  constructor(container) {
    this.el = container;
    this.focusPath = null;
    this.focusField = 'content';
    // Plan D：_rendered 做视图缓存，_inputDirty 让 syncAll 在未输入时早退
    this._rendered = false;
    this._inputDirty = false;
    this.el.addEventListener('click', e => this.onClick(e));
    this.el.addEventListener('input', e => this.onInput(e));
    this.el.addEventListener('focusin', e => this.onFocusIn(e));
    this.el.addEventListener('keydown', e => this.onKeyDown(e));
    this.el.addEventListener('dblclick', e => this.onRefDblClick(e));
    this.el.addEventListener('focusout', e => this.onFocusOut(e));
  }

  render(data) {
    this.data = data;
    this.el.innerHTML = '';
    const page = document.createElement('div');
    page.className = 'doc-page';
    const tg = data.type_global || {};
    const numStyle = tg.numbering_style || '1.1.1';
    this.counters = {};
    this.renderChildren(data, '', 0, page, numStyle);
    this.el.appendChild(page);
    if (this.focusPath) {
      requestAnimationFrame(() => this.restoreFocus());
    }
    // 渲染后 DOM 与 data 一致；打上缓存命中标记，清脏
    this._rendered = true;
    this._inputDirty = false;
  }

  renderChildren(parentObj, parentPath, parentLevel, container, numStyle) {
    const tkeys = getAllTKeys(parentObj);
    for (const key of tkeys) {
      const node = parentObj[key];
      const level = getLevel(key);
      const path = parentPath ? parentPath + '.' + key : key;

      // Count for numbering (skip t0)
      if (level !== 0) {
        const counterKey = parentPath + '|' + level;
        this.counters[counterKey] = (this.counters[counterKey] || 0) + 1;
      }

      const num = level !== 0 ? computeNumberForRender(this.data, path, numStyle) : null;
      const style = this.getStyle(level, path);

      // Node wrapper
      const nodeDiv = document.createElement('div');
      nodeDiv.className = 'doc-node';
      nodeDiv.dataset.path = path;

      // Fold toggle — must account for source children
      const desc = resolveNodeForRender(this.data, node, path, level);
      const ownChildKeys = getChildTKeys(node, level + 1);
      const srcDocChildKeys = desc.sourceNode ? getAllTKeys(desc.sourceNode) : [];
      const hasDocChildren = ownChildKeys.length > 0 || srcDocChildKeys.length > 0;
      const fold = document.createElement('span');
      fold.className = 'doc-fold' + (!hasDocChildren ? ' leaf' : '');
      fold.textContent = !hasDocChildren ? '•' : (desc.hide ? '▶' : '▼');
      if (hasDocChildren) {
        fold.onclick = () => {
          node.hide = node.hide ? 0 : 1;
          this.focusPath = path;
          this.render(this.data);
          app.markDirty();
        };
      }
      nodeDiv.appendChild(fold);

      // Heading
      const hClass = level === 0 ? 'doc-h1' : (level <= 3 ? `doc-h${level}` : 'doc-h4');
      const heading = document.createElement('div');
      heading.className = hClass;
      this.applyInlineStyle(heading, style);

      // Numbering (skip t0 / 'none' / no_number)
      if (level !== 0 && num !== null) {
        const numSpan = document.createElement('span');
        numSpan.className = 'doc-num';
        numSpan.textContent = num + (numStyle === 'bullet' || numStyle === 'bullet-uniform' ? ' ' : '');
        this.applyInlineStyle(numSpan, style);
        heading.appendChild(numSpan);
      }

      // === Content, body, children use desc from fold toggle above ===

      // Content span
      const contentSpan = document.createElement('span');
      contentSpan.className = 'doc-editable';
      contentSpan.dataset.path = path;
      contentSpan.dataset.field = 'content';
      contentSpan.dataset.placeholder = level <= 1 ? '输入标题...' : '输入内容...';
      contentSpan.spellcheck = false;
      if (!desc.renderOn) {
        contentSpan.textContent = node.content || '';
        contentSpan.contentEditable = 'plaintext-only';
        if (!contentSpan.contentEditable || contentSpan.contentEditable === 'inherit') contentSpan.contentEditable = 'true';
      } else if (desc.hasInlineRefs && desc.inlineSegments) {
        renderInlineSegments(contentSpan, desc.inlineSegments, this.data, this, (el, rs) => this.applyInlineStyle(el, rs), style);
        contentSpan.contentEditable = 'false';
        contentSpan.classList.add('ref-display');
        contentSpan.dataset.hasRef = '1';
      } else if (desc.contentEditable) {
        const contentText = stripMediaTags(desc.displayContent);
        renderStyledText(contentSpan, contentText, node, 'content', style, (el, runStyle) => this.applyInlineStyle(el, runStyle));
        contentSpan.contentEditable = 'plaintext-only';
        if (!contentSpan.contentEditable || contentSpan.contentEditable === 'inherit') contentSpan.contentEditable = 'true';
      } else {
        const contentText = stripMediaTags(desc.displayContent);
        renderStyledText(contentSpan, contentText, node, 'content', style, (el, runStyle) => this.applyInlineStyle(el, runStyle));
        contentSpan.contentEditable = 'false';
        contentSpan.classList.add('ref-display');
        contentSpan.dataset.ref = desc.refStr;
        if (!isSheetRef(desc.refStr) && parseRef(desc.refStr).docName) contentSpan.dataset.refAsync = desc.refStr;
        const docRefIcon = createRefIcon(this.data, desc.refStr, this);
        contentSpan.appendChild(docRefIcon);
      }
      this.applyInlineStyle(contentSpan, style);
      heading.appendChild(contentSpan);

      // Body button — controls node's OWN hide_body
      const bodyBtn = document.createElement('span');
      bodyBtn.className = 'body-btn';
      if (desc.hasBody) {
        bodyBtn.textContent = desc.hide_body ? '▸' : '▾';
        bodyBtn.title = desc.hide_body ? '展开正文' : '折叠正文';
        bodyBtn.onclick = (e) => {
          e.stopPropagation();
          node.hide_body = node.hide_body ? 0 : 1;
          this.focusPath = path;
          this.focusField = 'content';
          this.render(this.data);
          app.markDirty();
        };
      } else if (!desc.isFullRef) {
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
      heading.appendChild(bodyBtn);

      nodeDiv.appendChild(heading);

      // Media from content (render ON only) — 统一 collector 深入展开 =ref / {{=ref}}
      const contentMediaSrc = desc.sourceNode ? (desc.sourceNode.content || '') : (node.content || '');
      if (desc.renderOn && (hasMediaTag(contentMediaSrc) || isRef(contentMediaSrc) || hasInlineRefs(contentMediaSrc))) {
        const mediaDiv = document.createElement('div');
        mediaDiv.className = 'media-inline';
        renderTextWithMedia(contentMediaSrc, mediaDiv, {path, field:'content'});
        if (mediaDiv.childNodes.length > 0) nodeDiv.appendChild(mediaDiv);
      }

      // Body — controlled by node's OWN hide_body
      if (!desc.hide_body && (desc.hasBody || (!desc.isRef && this.focusPath === path && this.focusField === 'body'))) {
        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'doc-body doc-editable';
        const bodyStyle = this.getBodyStyle(path);

        if (!desc.renderOn) {
          bodyDiv.textContent = node.body || '';
          bodyDiv.contentEditable = 'plaintext-only';
          if (!bodyDiv.contentEditable || bodyDiv.contentEditable === 'inherit') bodyDiv.contentEditable = 'true';
          bodyDiv.dataset.path = path;
          bodyDiv.dataset.field = 'body';
          bodyDiv.spellcheck = false;
          this.applyInlineStyle(bodyDiv, bodyStyle);
          nodeDiv.appendChild(bodyDiv);
        } else {

        const bodyText = stripMediaTags(desc.displayBody);

        if (desc.bodyEditable) {
          bodyDiv.contentEditable = 'plaintext-only';
          if (!bodyDiv.contentEditable || bodyDiv.contentEditable === 'inherit') bodyDiv.contentEditable = 'true';
          renderStyledText(bodyDiv, bodyText, node, 'body', bodyStyle, (el, runStyle) => this.applyInlineStyle(el, runStyle));
          bodyDiv.dataset.path = path;
          bodyDiv.dataset.field = 'body';
          bodyDiv.spellcheck = false;
          const rawDocBody = node.body || '';
          if (isRef(rawDocBody)) {
            bodyDiv.classList.add('ref-display');
            bodyDiv.dataset.ref = rawDocBody;
            if (!isSheetRef(rawDocBody) && parseRef(rawDocBody).docName) bodyDiv.dataset.refAsync = rawDocBody;
            bodyDiv.contentEditable = 'false';
            const docBodyRefIcon = createRefIcon(this.data, rawDocBody, this);
            bodyDiv.appendChild(docBodyRefIcon);
          }
        } else {
          bodyDiv.contentEditable = 'false';
          renderStyledText(bodyDiv, bodyText, desc.sourceNode || node, 'body', bodyStyle, (el, runStyle) => this.applyInlineStyle(el, runStyle));
        }
        this.applyInlineStyle(bodyDiv, bodyStyle);
        nodeDiv.appendChild(bodyDiv);

        const bodyMediaSrc = desc.isFullRef ? (desc.sourceNode ? (desc.sourceNode.body || '') : desc.displayBody) : (node.body || '');
        if (hasMediaTag(bodyMediaSrc) || isRef(bodyMediaSrc) || hasInlineRefs(bodyMediaSrc)) {
          const bodyMediaDiv = document.createElement('div');
          bodyMediaDiv.className = 'media-inline';
          renderTextWithMedia(bodyMediaSrc, bodyMediaDiv, {path, field:'body'});
          if (bodyMediaDiv.childNodes.length > 0) nodeDiv.appendChild(bodyMediaDiv);
        }
        } // end render ON body block
      }

      container.appendChild(nodeDiv);

      // Recurse children — 统一渲染: 引用时遍历源节点子节点，否则遍历自身
      if (!desc.hide) {
        const renderSrc = desc.sourceNode || node;
        const renderKeys = desc.sourceNode ? srcDocChildKeys : ownChildKeys;
        if (renderKeys.length > 0) {
          this._renderChildNodes(renderSrc, renderKeys, path, level, container, numStyle, !!desc.sourceNode);
        }
      }
    }
  }

  // 统一子节点渲染（正常节点和引用源节点共用）
  _renderChildNodes(parentObj, childKeys, parentPath, parentLevel, container, numStyle, readOnly) {
    for (const key of childKeys) {
      const childNode = parentObj[key];
      if (!childNode || typeof childNode !== 'object') continue;
      const childLevel = getLevel(key);
      const childPath = readOnly ? parentPath + '.__ref__.' + key : parentPath + '.' + key;

      if (childLevel !== 0) {
        const counterKey = parentPath + '|' + childLevel;
        this.counters[counterKey] = (this.counters[counterKey] || 0) + 1;
      }

      const num = childLevel !== 0 ? computeNumberForRender(this.data, childPath, numStyle) : null;
      this._renderSingleNode(childNode, childPath, childLevel, container, numStyle, num, readOnly);
    }
  }

  // 渲染单个节点（正常 + 引用共用）
  _renderSingleNode(node, path, level, container, numStyle, num, readOnly) {
    if (!node || typeof node !== 'object') return;
    const desc = resolveNodeForRender(this.data, node, path, level);
    if (readOnly) {
      desc.contentEditable = false;
      desc.bodyEditable = false;
    }
    const style = this.getStyle(level, path);

    const nodeDiv = document.createElement('div');
    nodeDiv.className = 'doc-node';
    nodeDiv.dataset.path = path;

    const ownChildKeys = getChildTKeys(node, level + 1);
    const srcChildKeys = desc.sourceNode ? getAllTKeys(desc.sourceNode) : [];
    const hasChildren = ownChildKeys.length > 0 || srcChildKeys.length > 0;
    const fold = document.createElement('span');
    fold.className = 'doc-fold' + (!hasChildren ? ' leaf' : '');
    fold.textContent = !hasChildren ? '•' : (node.hide ? '▶' : '▼');
    if (hasChildren) {
      fold.onclick = () => { node.hide = node.hide ? 0 : 1; app.renderCurrentView(); };
    }
    nodeDiv.appendChild(fold);

    const hClass = level === 0 ? 'doc-h1' : (level <= 3 ? `doc-h${level}` : 'doc-h4');
    const heading = document.createElement('div');
    heading.className = hClass;
    this.applyInlineStyle(heading, style);

    // Numbering
    if (level !== 0 && num !== null) {
      const numSpan = document.createElement('span');
      numSpan.className = 'doc-num';
      numSpan.textContent = num + (numStyle === 'bullet' || numStyle === 'bullet-uniform' ? ' ' : '');
      this.applyInlineStyle(numSpan, style);
      heading.appendChild(numSpan);
    }

    // Content
    const contentSpan = document.createElement('span');
    contentSpan.className = 'doc-editable';
    contentSpan.contentEditable = desc.contentEditable ? 'plaintext-only' : 'false';
    if (!desc.contentEditable && !contentSpan.contentEditable) contentSpan.contentEditable = 'false';
    const rawContent = desc.displayContent;
    const contentText = stripMediaTags(rawContent);
    if (desc.hasInlineRefs && desc.inlineSegments) {
      renderInlineSegments(contentSpan, desc.inlineSegments, this.data, this, (el, rs) => this.applyInlineStyle(el, rs), style);
      contentSpan.contentEditable = 'false';
      contentSpan.classList.add('ref-display');
    } else {
      renderStyledText(contentSpan, contentText, node, 'content', style, (el, rs) => this.applyInlineStyle(el, rs));
    }
    if (!readOnly) {
      contentSpan.dataset.path = path;
      contentSpan.dataset.field = 'content';
      contentSpan.spellcheck = false;
    }
    if (desc.refStr) {
      contentSpan.classList.add('ref-display');
      contentSpan.dataset.ref = desc.refStr;
      if (!isSheetRef(desc.refStr) && parseRef(desc.refStr).docName) contentSpan.dataset.refAsync = desc.refStr;
      contentSpan.appendChild(createRefIcon(this.data, desc.refStr, this));
    }
    this.applyInlineStyle(contentSpan, style);
    heading.appendChild(contentSpan);

    // Body button
    const hasBody = desc.hasBody;
    if (hasBody) {
      const bodyBtn = document.createElement('span');
      bodyBtn.className = 'body-btn';
      bodyBtn.textContent = node.hide_body ? '▸' : '▾';
      bodyBtn.onclick = (e) => { e.stopPropagation(); node.hide_body = node.hide_body ? 0 : 1; app.renderCurrentView(); };
      heading.appendChild(bodyBtn);
    }
    nodeDiv.appendChild(heading);

    // Media from content — 统一 collector
    const rcMediaSrc = desc.sourceNode ? (desc.sourceNode.content || '') : (node.content || '');
    if (desc.renderOn && (hasMediaTag(rcMediaSrc) || isRef(rcMediaSrc) || hasInlineRefs(rcMediaSrc))) {
      const mediaDiv = document.createElement('div');
      mediaDiv.className = 'media-inline';
      renderTextWithMedia(rcMediaSrc, mediaDiv, {path, field:'content'});
      if (mediaDiv.childNodes.length > 0) nodeDiv.appendChild(mediaDiv);
    }

    // Body
    if (!node.hide_body && hasBody) {
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'doc-body doc-editable';
      bodyDiv.contentEditable = desc.bodyEditable ? 'plaintext-only' : 'false';
      if (!desc.bodyEditable && !bodyDiv.contentEditable) bodyDiv.contentEditable = 'false';
      const bodyStyle = this.getBodyStyle(path);
      const bodyText = stripMediaTags(desc.displayBody);
      renderStyledText(bodyDiv, bodyText, desc.sourceNode || node, 'body', bodyStyle, (el, rs) => this.applyInlineStyle(el, rs));
      if (!readOnly) {
        bodyDiv.dataset.path = path;
        bodyDiv.dataset.field = 'body';
        bodyDiv.spellcheck = false;
      }
      this.applyInlineStyle(bodyDiv, bodyStyle);
      nodeDiv.appendChild(bodyDiv);

      const bodyMediaSrc = desc.sourceNode ? (desc.sourceNode.body || '') : (node.body || '');
      if (hasMediaTag(bodyMediaSrc) || isRef(bodyMediaSrc) || hasInlineRefs(bodyMediaSrc)) {
        const bodyMediaDiv = document.createElement('div');
        bodyMediaDiv.className = 'media-inline';
        renderTextWithMedia(bodyMediaSrc, bodyMediaDiv, {path, field:'body'});
        if (bodyMediaDiv.childNodes.length > 0) nodeDiv.appendChild(bodyMediaDiv);
      }
    }

    container.appendChild(nodeDiv);

    // Recurse children — 统一
    if (!node.hide) {
      const renderSrc = desc.sourceNode || node;
      const renderKeys = desc.sourceNode ? srcChildKeys : ownChildKeys;
      if (renderKeys.length > 0) {
        this._renderChildNodes(renderSrc, renderKeys, path, level, container, numStyle, readOnly || !!desc.sourceNode);
      }
    }
  }

  // _renderRefCloneChildren / _renderRefCloneNode 已移除，统一使用 _renderChildNodes + _renderSingleNode

  getStyle(level, path) {
    const stylePath = path.includes('.__ref__.') ? path.split('.__ref__.')[0] : path;
    return buildNodeStyle(this.data, stylePath, level, { isBody: false });
  }

  getBodyStyle(path) {
    const stylePath = path.includes('.__ref__.') ? path.split('.__ref__.')[0] : path;
    return buildNodeStyle(this.data, stylePath, undefined, { isBody: true });
  }

  applyInlineStyle(el, style) {
    applyFmtStyle(el, style, app && app.documentFmt ? app.documentFmt : {});
  }

  // Sync all editable elements to data
  syncAll() {
    // Plan D 早退：期间没有真正发生 input，就跳过全树 querySelectorAll
    if (!this._inputDirty) return;
    this.el.querySelectorAll('[data-path][data-field]').forEach(el => {
      if (el.dataset.ref || el.dataset.hasRef) return;
      if (el.dataset.refEditing !== undefined) return; // 编辑原始 ref 源码期间不写回
      if (!el.isContentEditable) return;
      const node = getNodeByPath(this.data, el.dataset.path);
      if (!node) return;
      const field = el.dataset.field;
      node[field] = mergeEditableTextAndMedia(node[field], el.textContent);
    });
    if (typeof app !== 'undefined' && app._normalizeEmbeddedTagsInData) {
      app._normalizeEmbeddedTagsInData(this.data);
    }
    this._inputDirty = false;
  }

  onInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.path || !el.dataset.field) return;
    if (el.dataset.ref || el.dataset.hasRef) return;
    if (el.dataset.refEditing !== undefined) return;
    if (!el.isContentEditable) return;
    const node = getNodeByPath(this.data, el.dataset.path);
    if (!node) return;
    const field = el.dataset.field;
    const cur = node[field] || '';
    const edited = el.textContent;
    // 原值是 =ref 或 {{=ref}} 时，只有真的被改动才写回；避免编辑器副作用污染
    if (isRef(cur) || hasInlineRefs(cur)) {
      if (edited.replace(/[\s​-‏﻿]+/g, '') === cur.replace(/[\s​-‏﻿]+/g, '')) {
        return;
      }
    }
    node[field] = mergeEditableTextAndMedia(cur, edited);
    this._inputDirty = true; // Plan D：真改了才标脏
    app.markDirty();
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
    refEl.dataset.refEditing = raw;
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

  onFocusOut(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.path || !el.dataset.field) return;
    if (el.dataset.refEditing !== undefined) {
      const orig = el.dataset.refEditing;
      const node = getNodeByPath(this.data, el.dataset.path);
      if (node) {
        const edited = el.textContent;
        const normOrig = orig.replace(/[\s​-‏﻿]+/g, '');
        const normEdited = edited.replace(/[\s​-‏﻿]+/g, '');
        if (normEdited !== normOrig) {
          node[el.dataset.field] = edited;
          app.markDirty();
        }
      }
      delete el.dataset.refEditing;
      this.focusPath = null;
      this.render(this.data);
      app._resolveAsyncRefs(this.el);
      return;
    }
    if (el.dataset.ref || el.dataset.hasRef) return;
    const node = getNodeByPath(this.data, el.dataset.path);
    if (!node) return;
    const val = node[el.dataset.field];
    if (isRef(val) || hasInlineRefs(val)) {
      this.focusPath = null;
      this.render(this.data);
      app._resolveAsyncRefs(this.el);
    }
  }

  onFocusIn(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.path) return;
    this.focusPath = el.dataset.path;
    this.focusField = el.dataset.field || 'content';
    app.updateToolbar(this.focusPath);
    app.updateSidebar(this.focusPath);
  }

  onClick(e) {
    const el = e.target.closest('[data-path][data-field]');
    if (!el) return;
    this.focusPath = el.dataset.path;
    this.focusField = el.dataset.field || 'content';
    app.updateToolbar(this.focusPath);
    app.updateSidebar(this.focusPath);
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

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.syncAll();
      app.pushUndo();
      this.smartEnter(path, el);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.syncAll();
      app.pushUndo();
      if (e.shiftKey) this.outdentNode(path);
      else this.indentNode(path);
    } else if (e.key === 'Backspace' && el.textContent === '') {
      e.preventDefault();
      this.syncAll();
      app.pushUndo();
      this.deleteNode(path);
    }
  }

  addSiblingAfter(path) {
    const parts = path.split('.');
    const currentKey = parts[parts.length - 1];
    const level = getLevel(currentKey);
    let parent = parts.length === 1 ? this.data : getNodeByPath(this.data, parts.slice(0,-1).join('.'));
    const newSeqNum = nextSeq(parent, level);
    const newKey = `t${level}-${newSeqNum}`;
    insertAfter(parent, currentKey, newKey, { content: '', hide: 0, hide_body: 0 });
    this.focusPath = parts.length === 1 ? newKey : parts.slice(0,-1).join('.') + '.' + newKey;
    this.focusField = 'content';
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
    insertBefore(parent, currentKey, newKey, { content: '', hide: 0, hide_body: 0 });
    this.focusPath = parts.length === 1 ? newKey : parts.slice(0,-1).join('.') + '.' + newKey;
    this.focusField = 'content';
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
      node.content = text.substring(0, cursor) + media;
      const level = getLevel(currentKey);
      let parent = parts.length === 1 ? this.data : getNodeByPath(this.data, parts.slice(0,-1).join('.'));
      const newSeqNum = nextSeq(parent, level);
      const newKey = `t${level}-${newSeqNum}`;
      insertAfter(parent, currentKey, newKey, { content: text.substring(cursor), hide: 0, hide_body: 0 });
      this.focusPath = parts.length === 1 ? newKey : parts.slice(0,-1).join('.') + '.' + newKey;
      this.focusField = 'content';
      this.render(this.data);
      app.markDirty();
    }
  }

  deleteNode(path) {
    const parts = path.split('.');
    const currentKey = parts[parts.length - 1];
    const level = getLevel(currentKey);
    let parent = parts.length === 1 ? this.data : getNodeByPath(this.data, parts.slice(0,-1).join('.'));
    if (parts.length === 1 && getAllTKeys(this.data).length <= 1) return;
    const siblings = getChildTKeys(parent, level);
    const idx = siblings.indexOf(currentKey);
    const node = parent[currentKey];
    if (getAllTKeys(node).length > 0 && !confirm('该节点下有子节点，确定删除？')) return;
    delete parent[currentKey];
    if (idx > 0) {
      this.focusPath = parts.length === 1 ? siblings[idx - 1] : parts.slice(0,-1).join('.') + '.' + siblings[idx - 1];
    } else if (parts.length > 1) {
      this.focusPath = parts.slice(0,-1).join('.');
    } else {
      const remaining = getAllTKeys(this.data);
      this.focusPath = remaining.length > 0 ? remaining[0] : null;
    }
    this.focusField = 'content';
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
    this.render(this.data);
    app.markDirty();
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

  restoreFocus() {
    if (!this.focusPath) return;
    const sel = `[data-path="${this.focusPath}"][data-field="${this.focusField}"]`;
    const el = this.el.querySelector(sel);
    if (el) {
      el.focus();
      const range = document.createRange();
      const selObj = window.getSelection();
      if (el.childNodes.length > 0) {
        range.selectNodeContents(el);
        range.collapse(false);
        selObj.removeAllRanges();
        selObj.addRange(range);
      }
    }
  }
}
