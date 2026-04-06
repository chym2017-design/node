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

      const num = this.getNumber(path, numStyle);
      const style = this.getStyle(level, path);

      // Node wrapper
      const nodeDiv = document.createElement('div');
      nodeDiv.className = 'doc-node';
      nodeDiv.dataset.path = path;

      // Fold toggle — must account for source children
      const desc = resolveNodeForRender(this.data, node, path, level);
      const ownChildKeys = getChildTKeys(node, level + 1);
      const hasDocChildren = ownChildKeys.length > 0 || (desc.sourceChildren && desc.sourceChildren.length > 0);
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

      // Numbering (skip for t0 and 'none')
      if (level !== 0 && numStyle !== 'none') {
        if (numStyle === 'bullet') {
          const bullet = document.createElement('span');
          bullet.className = 'doc-num';
          const bullets = ['●','○','■','▪'];
          bullet.textContent = bullets[Math.min(level - 1, bullets.length - 1)] + ' ';
          this.applyInlineStyle(bullet, style);
          heading.appendChild(bullet);
        } else if (numStyle === 'bullet-uniform') {
          const bullet = document.createElement('span');
          bullet.className = 'doc-num';
          bullet.textContent = '● ';
          this.applyInlineStyle(bullet, style);
          heading.appendChild(bullet);
        } else {
          const numSpan = document.createElement('span');
          numSpan.className = 'doc-num';
          numSpan.textContent = num;
          this.applyInlineStyle(numSpan, style);
          heading.appendChild(numSpan);
        }
      }

      // === Content, body, children use desc from fold toggle above ===

      // Content span
      const contentSpan = document.createElement('span');
      contentSpan.className = 'doc-editable';
      contentSpan.dataset.path = path;
      contentSpan.dataset.field = 'content';
      contentSpan.dataset.placeholder = level <= 1 ? '输入标题...' : '输入内容...';
      contentSpan.spellcheck = false;
      if (desc.hasInlineRefs && desc.inlineSegments) {
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

      // Media from content
      if (hasMediaTag(desc.displayContent)) {
        const mediaDiv = document.createElement('div');
        mediaDiv.className = 'media-inline';
        renderTextWithMedia(desc.displayContent, mediaDiv, {path, field:'content'});
        nodeDiv.appendChild(mediaDiv);
      }

      // Body — controlled by node's OWN hide_body
      if (!desc.hide_body && (desc.hasBody || (!desc.isRef && this.focusPath === path && this.focusField === 'body'))) {
        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'doc-body doc-editable';
        const bodyStyle = this.getBodyStyle(path);
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

        const bodyMediaSrc = desc.isFullRef ? desc.displayBody : (node.body || '');
        if (hasMediaTag(bodyMediaSrc)) {
          const bodyMediaDiv = document.createElement('div');
          bodyMediaDiv.className = 'media-inline';
          renderTextWithMedia(bodyMediaSrc, bodyMediaDiv, {path, field:'body'});
          nodeDiv.appendChild(bodyMediaDiv);
        }
      }

      container.appendChild(nodeDiv);

      // Recurse — node's OWN hide controls folding
      if (!desc.hide) {
        if (desc.sourceChildren && desc.sourceChildren.length > 0) {
          this._renderRefCloneChildren(desc.sourceNode, path, level, container, numStyle, desc.refStr);
        } else if (!desc.isFullRef) {
          this.renderChildren(node, path, level, container, numStyle);
        }
      }
    }
  }

  // Render cloned children from a full-node reference source (DocumentView)
  _renderRefCloneChildren(sourceNode, refHostPath, parentLevel, container, numStyle, refStr) {
    const tkeys = getAllTKeys(sourceNode);
    for (const key of tkeys) {
      const child = sourceNode[key];
      const childLevel = getLevel(key);
      this._renderRefCloneNode(child, refHostPath, key, childLevel, container, numStyle, refStr, sourceNode);
    }
  }

  _renderRefCloneNode(node, refHostPath, sourceChildKey, level, container, numStyle, refStr, sourceParentNode) {
    if (!node || typeof node !== 'object') return;
    const style = this.getStyle(level, refHostPath);

    const nodeDiv = document.createElement('div');
    nodeDiv.className = 'doc-node';

    // Fold toggle (functional for collapse)
    const childKeys = getChildTKeys(node, level + 1);
    const fold = document.createElement('span');
    fold.className = 'doc-fold' + (childKeys.length === 0 ? ' leaf' : '');
    fold.textContent = childKeys.length === 0 ? '•' : (node.hide ? '▶' : '▼');
    if (childKeys.length > 0) {
      fold.onclick = () => {
        node.hide = node.hide ? 0 : 1;
        app.renderCurrentView();
      };
    }
    nodeDiv.appendChild(fold);

    // Heading
    const hClass = level === 0 ? 'doc-h1' : (level <= 3 ? `doc-h${level}` : 'doc-h4');
    const heading = document.createElement('div');
    heading.className = hClass;
    this.applyInlineStyle(heading, style);

    // Numbering
    if (level !== 0 && numStyle !== 'none') {
      if (numStyle === 'bullet') {
        const bullet = document.createElement('span');
        bullet.className = 'doc-num';
        const bullets = ['●','○','■','▪'];
        bullet.textContent = bullets[Math.min(level - 1, bullets.length - 1)] + ' ';
        this.applyInlineStyle(bullet, style);
        heading.appendChild(bullet);
      } else if (numStyle === 'bullet-uniform') {
        const bullet = document.createElement('span');
        bullet.className = 'doc-num';
        bullet.textContent = '● ';
        this.applyInlineStyle(bullet, style);
        heading.appendChild(bullet);
      } else {
        // Simple index numbering for cloned nodes
        const siblings = getChildTKeys(sourceParentNode, level);
        const idx = siblings.indexOf(sourceChildKey.split('.').pop());
        const numSpan = document.createElement('span');
        numSpan.className = 'doc-num';
        numSpan.textContent = (idx + 1);
        this.applyInlineStyle(numSpan, style);
        heading.appendChild(numSpan);
      }
    }

    // Content (read-only clone)
    const contentSpan = document.createElement('span');
    contentSpan.className = 'doc-editable';
    contentSpan.contentEditable = 'false';
    const rawDocCloneContent = node.content || '';
    const contentText = stripMediaTags(rawDocCloneContent);
    contentSpan.textContent = contentText;
    this.applyInlineStyle(contentSpan, style);
    heading.appendChild(contentSpan);

    // body button (fold/unfold)
    const hasDocCloneBody = node.body !== undefined && node.body !== '';
    if (hasDocCloneBody) {
      const bodyBtn = document.createElement('span');
      bodyBtn.className = 'body-btn';
      bodyBtn.textContent = node.hide_body ? '▸' : '▾';
      bodyBtn.title = node.hide_body ? '展开正文' : '折叠正文';
      bodyBtn.onclick = (e) => {
        e.stopPropagation();
        node.hide_body = node.hide_body ? 0 : 1;
        app.renderCurrentView();
      };
      heading.appendChild(bodyBtn);
    }

    nodeDiv.appendChild(heading);

    // media from content
    if (hasMediaTag(rawDocCloneContent)) {
      const mediaDiv = document.createElement('div');
      mediaDiv.className = 'media-inline';
      renderTextWithMedia(rawDocCloneContent, mediaDiv, {path: refHostPath, field: 'content'});
      nodeDiv.appendChild(mediaDiv);
    }

    // Body (read-only)
    if (!node.hide_body && hasDocCloneBody) {
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'doc-body doc-editable';
      bodyDiv.contentEditable = 'false';
      const bodyStyle = this.getBodyStyle(refHostPath);
      const rawDocCloneBody = node.body || '';
      const bodyText = stripMediaTags(rawDocCloneBody);
      bodyDiv.textContent = bodyText;
      this.applyInlineStyle(bodyDiv, bodyStyle);
      nodeDiv.appendChild(bodyDiv);
      // media from body
      if (hasMediaTag(rawDocCloneBody)) {
        const bodyMediaDiv = document.createElement('div');
        bodyMediaDiv.className = 'media-inline';
        renderTextWithMedia(rawDocCloneBody, bodyMediaDiv, {path: refHostPath, field: 'body'});
        nodeDiv.appendChild(bodyMediaDiv);
      }
    }

    container.appendChild(nodeDiv);

    // Recurse children
    if (!node.hide && childKeys.length > 0) {
      for (const ck of childKeys) {
        this._renderRefCloneNode(node[ck], refHostPath, sourceChildKey + '.' + ck, getLevel(ck), container, numStyle, refStr, node);
      }
    }
  }

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
    return nums.join('.');
  }

  getStyle(level, path) {
    return buildNodeStyle(this.data, path, level, { isBody: false });
  }

  getBodyStyle(path) {
    return buildNodeStyle(this.data, path, undefined, { isBody: true });
  }

  applyInlineStyle(el, style) {
    applyFmtStyle(el, style, app && app.documentFmt ? app.documentFmt : {});
  }

  // Sync all editable elements to data
  syncAll() {
    this.el.querySelectorAll('[data-path][data-field]').forEach(el => {
      if (el.dataset.ref || el.dataset.hasRef) return;
      const node = getNodeByPath(this.data, el.dataset.path);
      if (!node) return;
      const field = el.dataset.field;
      const media = extractMediaTags(node[field]);
      node[field] = el.textContent + media;
    });
  }

  onInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.path || !el.dataset.field) return;
    if (el.dataset.ref || el.dataset.hasRef) return;
    const node = getNodeByPath(this.data, el.dataset.path);
    if (node) {
      const media = extractMediaTags(node[el.dataset.field]);
      node[el.dataset.field] = el.textContent + media;
      app.markDirty();
    }
  }

  onRefDblClick(e) {
    const el = e.target.closest('.ref-display');
    if (!el) return;
    if (!el.dataset.ref && !el.dataset.hasRef) return;
    if (el.dataset.hasRef) {
      const node = getNodeByPath(this.data, el.dataset.path);
      if (!node) return;
      const field = el.dataset.field || 'content';
      const newVal = prompt('编辑内容（{{=引用}} 语法）:', node[field]);
      if (newVal !== null && newVal !== node[field]) {
        node[field] = newVal;
        app.markDirty();
        this.render(this.data);
      }
      return;
    }
    if (!el.dataset.ref) return;
    // Don't enter edit mode if clicking the ref icon
    if (e.target.classList.contains('ref-icon')) return;
    const refStr = el.dataset.ref;
    el.contentEditable = 'plaintext-only';
    if (!el.contentEditable || el.contentEditable === 'inherit') el.contentEditable = 'true';
    el.classList.remove('ref-display');
    el.textContent = refStr;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const onBlur = () => {
      el.removeEventListener('blur', onBlur);
      const newVal = el.textContent.trim();
      const node = getNodeByPath(this.data, el.dataset.path);
      if (!node) return;
      node[el.dataset.field] = newVal;
      app.markDirty();
      // Re-render to properly show ref icon and full-node refs
      this.focusPath = null;
      this.render(this.data);
      app._resolveAsyncRefs(this.el);
    };
    el.addEventListener('blur', onBlur);
  }

  onFocusOut(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.path || !el.dataset.field) return;
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
