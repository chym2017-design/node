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
    // 分页模式：把第一页的溢出内容拆分到后续 .doc-page。
    // 只在 #editor 带 .paged 时生效（即 data.type_global.page_size 已设置）。
    if (document.getElementById('editor')?.classList.contains('paged')) {
      requestAnimationFrame(() => this._paginate());
    }
    if (this.focusPath) {
      requestAnimationFrame(() => this.restoreFocus());
    }
    // 渲染后 DOM 与 data 一致；打上缓存命中标记，清脏
    this._rendered = true;
    this._inputDirty = false;
  }

  // 把 #document-view 里第一页的溢出内容按「叶子」级别（标题/正文/媒体/表格）搬到后续页，
  // 递归处理以保证 Word 风格「行填满再翻页」。
  // 叶子选择器：.doc-h1~h6 / .doc-body / .media-wrap / .inline-table。
  // 包裹它们的 .doc-node 仅作容器，自动被浅克隆以保留嵌套结构。
  _paginate() {
    const firstPage = this.el.querySelector('.doc-page');
    if (!firstPage) return;
    const pageH = this._readPageHeightPx();
    if (!pageH) return;
    this._splitPagesFrom(firstPage, pageH);
  }

  // 把 var(--page-h) 解析成像素：建临时 div 设置 height: var(--page-h) 测量。
  _readPageHeightPx() {
    const editor = document.getElementById('editor');
    if (!editor) return 0;
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.height = 'var(--page-h)';
    probe.style.width = '1px';
    editor.appendChild(probe);
    const px = probe.offsetHeight;
    probe.remove();
    return px;
  }

  // 递归分页：在 page 里找第一个 bottom 超出容量的叶子，从那里拆分。
  _splitPagesFrom(page, pageHeightPx) {
    const cs = window.getComputedStyle(page);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const cap = pageHeightPx - padTop - padBottom;
    if (cap <= 0) return;

    const leafSel = '.doc-h1, .doc-h2, .doc-h3, .doc-h4, .doc-h5, .doc-h6, .doc-body, .media-wrap, .inline-table';
    const all = Array.from(page.querySelectorAll(leafSel));
    // 去掉嵌套在另一个叶子里的元素（比如 .ref-display 在 .doc-body 里，不算独立叶子）
    const leaves = all.filter(el => {
      let p = el.parentElement;
      while (p && p !== page) {
        if (p.matches && p.matches(leafSel)) return false;
        p = p.parentElement;
      }
      return true;
    });
    if (leaves.length === 0) return;

    const pageRect = page.getBoundingClientRect();
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      const r = leaf.getBoundingClientRect();
      const bottom = r.bottom - pageRect.top - padTop;
      if (bottom <= cap) continue;
      // 第 0 个叶子就已超长：该叶子过大，无法再拆，让当前页自然延伸
      if (i === 0) return;
      const newPage = this._splitAtLeaf(page, leaf);
      if (newPage) this._splitPagesFrom(newPage, pageHeightPx);
      return;
    }
  }

  // 把 leaf 及其后续 DOM（按文档顺序）从 page 移到新建的 .doc-page，
  // 沿 leaf→page 的祖先链浅克隆 .doc-node 容器，保持嵌套结构。
  _splitAtLeaf(page, leaf) {
    const newPage = document.createElement('div');
    newPage.className = 'doc-page';
    page.parentElement.insertBefore(newPage, page.nextSibling);

    // 祖先链：从 page 的直接子节点到 leaf（从外到内）
    const chain = [];
    let cur = leaf;
    while (cur && cur.parentElement !== page) {
      chain.unshift(cur);
      cur = cur.parentElement;
    }
    if (!cur) return null;
    chain.unshift(cur);

    let parentNew = newPage;
    for (let i = 0; i < chain.length; i++) {
      const wrap = chain[i];
      const laterSibs = [];
      let sib = wrap.nextSibling;
      while (sib) { laterSibs.push(sib); sib = sib.nextSibling; }

      if (i === chain.length - 1) {
        // 最后一层（leaf）：先把 leaf 本身搬到 parentNew，再追加后续兄弟，保持原顺序
        parentNew.appendChild(wrap);
        for (const s of laterSibs) parentNew.appendChild(s);
        break;
      }
      // 中间层：先追加克隆容器，再在其后追加后续兄弟（顺序：克隆首位、兄弟在后）
      const newWrap = wrap.cloneNode(false);
      parentNew.appendChild(newWrap);
      for (const s of laterSibs) parentNew.appendChild(s);
      parentNew = newWrap;
    }
    return newPage;
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
        renderInlineSegments(contentSpan, desc.inlineSegments, this.data, this, (el, rs) => this.applyInlineStyle(el, rs), style, node, 'content');
        if (typeof applyMdHtml === 'function') applyMdHtml(contentSpan, app, {inline:true});
        contentSpan.contentEditable = 'false';
        contentSpan.classList.add('ref-display');
        contentSpan.dataset.hasRef = '1';
      } else if (desc.contentEditable) {
        const contentText = stripMediaTags(desc.displayContent);
        renderStyledText(contentSpan, contentText, node, 'content', style, (el, runStyle) => this.applyInlineStyle(el, runStyle));
        contentSpan.contentEditable = 'plaintext-only';
        if (!contentSpan.contentEditable || contentSpan.contentEditable === 'inherit') contentSpan.contentEditable = 'true';
        if (typeof applyMdHtml === 'function') applyMdHtml(contentSpan, app, {inline:true});
      } else {
        const contentText = stripMediaTags(desc.displayContent);
        renderStyledText(contentSpan, contentText, node, 'content', style, (el, runStyle) => this.applyInlineStyle(el, runStyle));
        if (typeof applyMdHtml === 'function') applyMdHtml(contentSpan, app, {inline:true});
        contentSpan.contentEditable = 'false';
        if (desc.refStr) {
          contentSpan.classList.add('ref-display');
          contentSpan.dataset.ref = desc.refStr;
          if (refNeedsAsyncLoad(desc.refStr)) contentSpan.dataset.refAsync = desc.refStr;
          const docRefIcon = createRefIcon(this.data, desc.refStr, this);
          contentSpan.appendChild(docRefIcon);
        } else if (desc.hasOwnMedia) {
          // 仅含媒体 tag 的 content：双击进入源码编辑（与 outline 一致）
          contentSpan.classList.add('ref-display');
          contentSpan.dataset.hasRef = '1';
        }
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
        renderTextWithMedia(contentMediaSrc, mediaDiv, {path, field:'content', view:this});
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
          if (typeof applyMdHtml === 'function') applyMdHtml(bodyDiv, app, {inline:false});
          bodyDiv.dataset.path = path;
          bodyDiv.dataset.field = 'body';
          bodyDiv.spellcheck = false;
        } else {
          // 与 outline 一致：根据 body 形态分别挂上能让 onRefDblClick 进入源码编辑的标记。
          //   1) {{=ref}} 内联引用 → renderInlineSegments + ref-display + data-hasRef='1'
          //   2) 整段 =ref           → ref-display + data-ref + ↗ 图标
          //   3) 全节点引用宿主克隆 body → 普通文本 + data-ref-body
          //   4) 仅含媒体 tag 的 body → ref-display + data-hasRef='1'，双击改源码
          const rawDocBody = node.body || '';
          bodyDiv.contentEditable = 'false';
          bodyDiv.dataset.path = path;
          bodyDiv.dataset.field = 'body';
          bodyDiv.spellcheck = false;
          if (desc.bodyInlineSegments) {
            renderInlineSegments(bodyDiv, desc.bodyInlineSegments, this.data, this, (el, rs) => this.applyInlineStyle(el, rs), bodyStyle, node, 'body');
            if (typeof applyMdHtml === 'function') applyMdHtml(bodyDiv, app, {inline:false});
            bodyDiv.classList.add('ref-display');
            bodyDiv.dataset.hasRef = '1';
          } else if (isRef(rawDocBody)) {
            renderStyledText(bodyDiv, bodyText, node, 'body', bodyStyle, (el, rs) => this.applyInlineStyle(el, rs));
            if (typeof applyMdHtml === 'function') applyMdHtml(bodyDiv, app, {inline:false});
            bodyDiv.classList.add('ref-display');
            bodyDiv.dataset.ref = rawDocBody;
            if (refNeedsAsyncLoad(rawDocBody)) bodyDiv.dataset.refAsync = rawDocBody;
            bodyDiv.appendChild(createRefIcon(this.data, rawDocBody, this));
          } else {
            renderStyledText(bodyDiv, bodyText, desc.sourceNode || node, 'body', bodyStyle, (el, runStyle) => this.applyInlineStyle(el, runStyle));
            if (typeof applyMdHtml === 'function') applyMdHtml(bodyDiv, app, {inline:false});
            if (desc.refStr) bodyDiv.dataset.refBody = desc.refStr;
            if (hasMediaTag(rawDocBody) && !desc.sourceNode) {
              bodyDiv.classList.add('ref-display');
              bodyDiv.dataset.hasRef = '1';
            }
          }
        }
        this.applyInlineStyle(bodyDiv, bodyStyle);
        nodeDiv.appendChild(bodyDiv);

        const bodyMediaSrc = desc.isFullRef ? (desc.sourceNode ? (desc.sourceNode.body || '') : desc.displayBody) : (node.body || '');
        if (hasMediaTag(bodyMediaSrc) || isRef(bodyMediaSrc) || hasInlineRefs(bodyMediaSrc)) {
          const bodyMediaDiv = document.createElement('div');
          bodyMediaDiv.className = 'media-inline';
          renderTextWithMedia(bodyMediaSrc, bodyMediaDiv, {path, field:'body', view:this});
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
      renderInlineSegments(contentSpan, desc.inlineSegments, this.data, this, (el, rs) => this.applyInlineStyle(el, rs), style, node, 'content');
      contentSpan.contentEditable = 'false';
      contentSpan.classList.add('ref-display');
      contentSpan.dataset.hasRef = '1';
    } else {
      renderStyledText(contentSpan, contentText, node, 'content', style, (el, rs) => this.applyInlineStyle(el, rs));
    }
    if (desc.renderOn && typeof applyMdHtml === 'function') applyMdHtml(contentSpan, app, {inline:true});
    // dataset.path/field 始终写：双击进入"原始 ref 源码编辑"以及 closest 选择器都依赖这两个属性。
    // 之前仅 !readOnly 时写，导致引用 (__ref__) 子节点的 dblclick 取不到 path → 沉默无响应。
    contentSpan.dataset.path = path;
    contentSpan.dataset.field = 'content';
    contentSpan.spellcheck = false;
    if (desc.refStr) {
      contentSpan.classList.add('ref-display');
      contentSpan.dataset.ref = desc.refStr;
      if (refNeedsAsyncLoad(desc.refStr)) contentSpan.dataset.refAsync = desc.refStr;
      contentSpan.appendChild(createRefIcon(this.data, desc.refStr, this));
    } else if (desc.hasOwnMedia && !readOnly) {
      // 仅含媒体 tag 的 content：双击进入源码编辑
      contentSpan.classList.add('ref-display');
      contentSpan.dataset.hasRef = '1';
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
      renderTextWithMedia(rcMediaSrc, mediaDiv, {path, field:'content', view:this});
      if (mediaDiv.childNodes.length > 0) nodeDiv.appendChild(mediaDiv);
    }

    // Body
    if (!node.hide_body && hasBody) {
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'doc-body doc-editable';
      const bodyStyle = this.getBodyStyle(path);

      if (!desc.renderOn) {
        // 渲染 off：直接展示 raw body，可编辑（非 readOnly 情况），不渲染媒体。
        // 与 outline 视图及 _renderMainNode 的 renderOn off 分支保持一致。
        bodyDiv.textContent = node.body || '';
        if (!readOnly) {
          bodyDiv.contentEditable = 'plaintext-only';
          if (!bodyDiv.contentEditable || bodyDiv.contentEditable === 'inherit') bodyDiv.contentEditable = 'true';
          bodyDiv.dataset.path = path;
          bodyDiv.dataset.field = 'body';
          bodyDiv.spellcheck = false;
        } else {
          bodyDiv.contentEditable = 'false';
        }
        this.applyInlineStyle(bodyDiv, bodyStyle);
        nodeDiv.appendChild(bodyDiv);
      } else {
        const bodyText = stripMediaTags(desc.displayBody);
        const rawDocBody = node.body || '';
        bodyDiv.dataset.path = path;
        bodyDiv.dataset.field = 'body';
        bodyDiv.spellcheck = false;
        if (desc.bodyEditable && !readOnly) {
          // 普通可编辑 body
          bodyDiv.contentEditable = 'plaintext-only';
          if (!bodyDiv.contentEditable || bodyDiv.contentEditable === 'inherit') bodyDiv.contentEditable = 'true';
          renderStyledText(bodyDiv, bodyText, node, 'body', bodyStyle, (el, rs) => this.applyInlineStyle(el, rs));
          if (typeof applyMdHtml === 'function') applyMdHtml(bodyDiv, app, {inline:false});
        } else {
          // 与 outline / _renderMainNode 一致：按 body 形态挂 ref-display 标记，让双击进入源码编辑。
          bodyDiv.contentEditable = 'false';
          if (desc.bodyInlineSegments) {
            renderInlineSegments(bodyDiv, desc.bodyInlineSegments, this.data, this, (el, rs) => this.applyInlineStyle(el, rs), bodyStyle, node, 'body');
            if (typeof applyMdHtml === 'function') applyMdHtml(bodyDiv, app, {inline:false});
            bodyDiv.classList.add('ref-display');
            bodyDiv.dataset.hasRef = '1';
          } else if (isRef(rawDocBody)) {
            renderStyledText(bodyDiv, bodyText, node, 'body', bodyStyle, (el, rs) => this.applyInlineStyle(el, rs));
            if (typeof applyMdHtml === 'function') applyMdHtml(bodyDiv, app, {inline:false});
            bodyDiv.classList.add('ref-display');
            bodyDiv.dataset.ref = rawDocBody;
            if (refNeedsAsyncLoad(rawDocBody)) bodyDiv.dataset.refAsync = rawDocBody;
            bodyDiv.appendChild(createRefIcon(this.data, rawDocBody, this));
          } else {
            renderStyledText(bodyDiv, bodyText, desc.sourceNode || node, 'body', bodyStyle, (el, rs) => this.applyInlineStyle(el, rs));
            if (typeof applyMdHtml === 'function') applyMdHtml(bodyDiv, app, {inline:false});
            if (desc.sourceNode) {
              bodyDiv.classList.add('ref-display');
              bodyDiv.dataset.hasRef = '1';
              if (desc.refStr) bodyDiv.dataset.refBody = desc.refStr;
            } else if (hasMediaTag(rawDocBody) && !readOnly) {
              bodyDiv.classList.add('ref-display');
              bodyDiv.dataset.hasRef = '1';
            }
          }
        }
        this.applyInlineStyle(bodyDiv, bodyStyle);
        nodeDiv.appendChild(bodyDiv);

        const bodyMediaSrc = desc.sourceNode ? (desc.sourceNode.body || '') : (node.body || '');
        if (hasMediaTag(bodyMediaSrc) || isRef(bodyMediaSrc) || hasInlineRefs(bodyMediaSrc)) {
          const bodyMediaDiv = document.createElement('div');
          bodyMediaDiv.className = 'media-inline';
          renderTextWithMedia(bodyMediaSrc, bodyMediaDiv, {path, field:'body', view:this});
          if (bodyMediaDiv.childNodes.length > 0) nodeDiv.appendChild(bodyMediaDiv);
        }
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
    // 引用子节点（路径含 __ref__）→ 源码在源节点里，不能原地编辑；提示用户到源节点编辑
    if (refEl.dataset.path && refEl.dataset.path.includes('.__ref__.')) {
      if (typeof toast === 'function') toast('引用克隆节点不可直接编辑，请到源节点修改');
      return;
    }
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
    range.collapse(false);
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
        return;
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
