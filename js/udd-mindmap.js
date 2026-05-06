// ================================================================
//  UDD Mindmap View
//  Interactive mind map with multiple layouts (right/bilateral/org),
//  line styles, color schemes, zoom/pan, export PNG/SVG
// ================================================================
class MindmapView {
  constructor(container) {
    this.el = container;
    this.data = null;
    this.focusPath = null;
    this.focusField = 'content';
    // Plan D：mindmap 是只读渲染，没有 contentEditable 输入；
    //   _rendered 仍然有用（视图缓存命中），_inputDirty 永远为 false。
    this._rendered = false;
    this._inputDirty = false;
    this.selectedPath = null;
    this.pan = { x: 0, y: 0 };
    this.zoom = 1;
    this._dragging = false;
    this._dragStart = null;
    this._nodes = [];  // {path, x, y, w, h, level, parentPath}
    this.layout = 'right'; // right | bilateral | orgchart
    this.lineStyle = 'curve'; // curve | straight | polyline
    this.colorScheme = 'default'; // default | rainbow | mono
    this.nodeShape = 'rounded'; // rounded | rect | ellipse
    this.gapV = 8; // vertical gap between sibling nodes
    this._clipboard = null;
    this._initEvents();
  }

  _initEvents() {
    this._spaceDown = false;
    // Middle-button / right-button / space+left-button drag for canvas pan.
    // 右键拖动：与中键体验一致；右键单击节点仍弹节点菜单（contextmenu 监听里区分）。
    this.el.addEventListener('mousedown', e => {
      if (e.button === 1 || e.button === 2 || (e.button === 0 && this._spaceDown)) {
        e.preventDefault();
        this._dragging = true;
        this._dragMoved = false;
        this._dragButton = e.button;
        this._dragStart = { x: e.clientX - this.pan.x, y: e.clientY - this.pan.y };
        this.el.querySelector('#mindmap-canvas')?.classList.add('grabbing');
      }
    });
    this.el.addEventListener('mousemove', e => {
      if (!this._dragging) return;
      const nx = e.clientX - this._dragStart.x;
      const ny = e.clientY - this._dragStart.y;
      if (!this._dragMoved && (Math.abs(nx - this.pan.x) > 3 || Math.abs(ny - this.pan.y) > 3)) {
        this._dragMoved = true;
      }
      this.pan.x = nx;
      this.pan.y = ny;
      this._applyTransform();
    });
    const stopDrag = () => {
      // 右键拖动结束 + 真发生过位移 → 标记吞掉接下来的 contextmenu，否则会冒出节点/原生菜单
      if (this._dragging && this._dragButton === 2 && this._dragMoved) {
        this._dragJustEnded = true;
      }
      this._dragging = false;
      this.el.querySelector('#mindmap-canvas')?.classList.remove('grabbing');
    };
    this.el.addEventListener('mouseup', stopDrag);
    this.el.addEventListener('mouseleave', stopDrag);
    this.el.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoom = Math.max(0.3, Math.min(3, this.zoom * delta));
      this._applyTransform();
    }, { passive: false });
    // Space key for pan mode
    document.addEventListener('keydown', e => {
      if (app.currentView !== 'mindmap') return;
      if (e.code === 'Space' && !e.target.isContentEditable) {
        e.preventDefault();
        this._spaceDown = true;
        this.el.style.cursor = 'grab';
      }
    });
    document.addEventListener('keyup', e => {
      if (e.code === 'Space') { this._spaceDown = false; this.el.style.cursor = ''; }
    });
    // Keyboard operations
    document.addEventListener('keydown', e => this._onKeyDown(e));
    // 思维导图 body popup 里的双击源码编辑失焦恢复：与大纲/文档同一套路径。
    // 差别仅一步：大纲/文档失焦后跑 this.render(this.data) 重渲整页；思维导图 popup 是
    // 独立浮层，整页重渲会把它清掉 → 改为就地 applyMdHtml(el) 重新渲染即可。
    // 复用 udd-mdhtml.js 的 dataset.refEditing 标记（双击 + 全选蓝色 + 写回比对）一致。
    this.el.addEventListener('focusout', e => this.onFocusOut(e));
    this.el.addEventListener('focusin', e => this.onFocusIn(e));
    // Context menu
    this.el.addEventListener('contextmenu', e => {
      // 刚刚结束的右键拖动 → 吞掉这次 contextmenu
      if (this._dragJustEnded) { e.preventDefault(); this._dragJustEnded = false; return; }
      const nodeEl = e.target.closest('.mm-node');
      if (!nodeEl) return;
      e.preventDefault();
      const path = nodeEl.dataset.path;
      if (path === '__root__') return;
      this.selectedPath = path;
      this.focusPath = path;
      this._showContextMenu(e.clientX, e.clientY, path);
    });
  }

  _applyTransform() {
    const inner = this.el.querySelector('.mm-inner');
    if (inner) inner.style.transform = `translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})`;
  }

  syncAll() { /* mindmap is read-only render, no editable fields to sync */ }

  render(data, opts) {
    const preserveView = opts && opts.preserveView;
    const savedPan = preserveView ? { x: this.pan.x, y: this.pan.y } : null;
    const savedZoom = preserveView ? this.zoom : null;
    this.data = data;
    this._nodes = [];
    const rootKeys = getAllTKeys(data);
    if (!rootKeys.length) { this.el.innerHTML = ''; this._rendered = true; return; }

    // Build tree structure
    const tree = this._tree = this._buildTree(data, rootKeys);

    // Layout
    const GAP_H = 180, GAP_V = this.gapV;
    this._layoutTree(tree, GAP_H, GAP_V);

    // Find bounds
    const allNodes = [];
    this._collectAll(tree, allNodes);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of allNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }

    // Center in viewport
    const rect = this.el.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const treeCx = (minX + maxX) / 2, treeCy = (minY + maxY) / 2;
    const offsetX = cx - treeCx, offsetY = cy - treeCy;

    // Render HTML
    this.el.innerHTML = '';
    const canvas = document.createElement('div');
    canvas.id = 'mindmap-canvas';
    const inner = document.createElement('div');
    inner.className = 'mm-inner';
    inner.style.cssText = 'position:absolute;top:0;left:0;transform-origin:0 0';

    // SVG for lines
    const svgW = maxX - minX + 400, svgH = maxY - minY + 400;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', svgW);
    svg.setAttribute('height', svgH);
    svg.style.cssText = `position:absolute;left:${minX + offsetX - 200}px;top:${minY + offsetY - 200}px;pointer-events:none`;
    const svgOffX = -(minX - 200), svgOffY = -(minY - 200);

    // Pass 1: Render nodes only (no lines yet)
    this._renderNodes(tree, inner, offsetX, offsetY);

    inner.appendChild(svg);
    canvas.appendChild(inner);

    // Attach to DOM so we can measure real node sizes
    this.el.appendChild(canvas);

    // Pass 2: Measure real DOM sizes and draw SVG lines
    this._updateRealSizes(tree);
    this._drawLines(tree, svg, svgOffX, svgOffY);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'mm-toolbar';
    const mv = 'app.mindmapView';
    const layoutLabel = {right:'向右',bilateral:'双向',orgchart:'组织架构'}[this.layout];
    const lineLabel = {curve:'曲线',straight:'直线',polyline:'折线'}[this.lineStyle];
    const colorLabel = {default:'默认',rainbow:'彩虹',mono:'单色'}[this.colorScheme];
    const shapeLabel = {rounded:'圆角',rect:'矩形',ellipse:'椭圆'}[this.nodeShape];
    const dd = (label, prop, opts) => {
      const items = opts.map(([v,t]) => `<div class="${this[prop]===v?'active':''}" onclick="${mv}._setProp('${prop}','${v}')">${t}</div>`).join('');
      return `<span class="mm-dropdown"><button onclick="${mv}._toggleDD(this)">${label}</button><div class="mm-dropdown-menu">${items}</div></span>`;
    };
    toolbar.innerHTML = dd('布局:'+layoutLabel,'layout',[['right','向右'],['bilateral','双向'],['orgchart','组织架构']])
      + `<span style="display:inline-flex;align-items:center;border:1px solid var(--gray-200);border-radius:var(--radius)"><span style="padding:4px 8px;font-size:11px;color:var(--gray-600);white-space:nowrap">间距</span><input type="number" value="${this.gapV}" min="0" max="200" step="1" oninput="${mv}._setGapV(+this.value)" style="width:36px;padding:2px 4px;font-size:11px;border:none;text-align:center;background:transparent;color:var(--gray-600);-moz-appearance:textfield;appearance:textfield"></span>`
      + dd('连线:'+lineLabel,'lineStyle',[['curve','曲线'],['straight','直线'],['polyline','折线']])
      + dd('配色:'+colorLabel,'colorScheme',[['default','默认'],['rainbow','彩虹'],['mono','单色']])
      + dd('形状:'+shapeLabel,'nodeShape',[['rounded','圆角'],['rect','矩形'],['ellipse','椭圆']])
      + `<button onclick="${mv}.exportImage('png')">导出PNG</button><button onclick="${mv}.exportImage('svg')">导出SVG</button><button onclick="${mv}.zoomIn()">+</button><button onclick="${mv}.zoomOut()">−</button><button onclick="${mv}.resetView()">⟲</button>`;
    this.el.appendChild(toolbar);

    if (preserveView && savedPan) {
      this.pan = savedPan;
      this.zoom = savedZoom;
    } else {
      this.pan = { x: 0, y: 0 };
      this.zoom = 1;
    }
    this._applyTransform();
    this._rendered = true; // Plan D：视图缓存命中标记
  }

  _buildTree(data, keys) {
    const title = data.meta?.title || '文档';
    const root = { path: '__root__', label: title, level: 0, w: 0, h: 0, x: 0, y: 0, children: [], node: null };
    for (const key of keys) {
      root.children.push(this._buildNode(data[key], key, getLevel(key)));
    }
    return root;
  }

  _buildNode(node, path, level) {
    const desc = resolveNodeForRender(this.data, node, path, level);
    const ownChildKeys = getChildTKeys(node, level + 1);
    const srcChildKeys = desc.sourceNode ? getAllTKeys(desc.sourceNode) : [];
    const hasChildren = ownChildKeys.length > 0 || srcChildKeys.length > 0;
    const isHidden = node && node.hide === 1;

    const item = {
      path, label: desc.displayContent, level, w: 0, h: 0, x: 0, y: 0,
      children: [], node,
      hasBody: desc.hasBody,
      bodyOpen: desc.hasBody && !desc.hide_body,
      _sourceNode: desc.sourceNode,
      _isRef: desc.isRef
    };

    if (hasChildren && !isHidden) {
      const renderSrc = desc.sourceNode || node;
      const renderKeys = desc.sourceNode ? srcChildKeys : ownChildKeys;
      for (const ck of renderKeys) {
        const childNode = renderSrc[ck];
        if (!childNode || typeof childNode !== 'object') continue;
        const childPath = desc.sourceNode ? path + '.__ref__.' + ck : path + '.' + ck;
        item.children.push(this._buildNode(childNode, childPath, getLevel(ck)));
      }
    }
    item.folded = isHidden && hasChildren;
    item.hasChildren = hasChildren;
    return item;
  }

  _measureNode(item) {
    const len = item.label.length || 1;
    const fontSize = item.level === 0 ? 15 : item.level === 1 ? 13 : 12;
    const padH = item.level === 0 ? 40 : 28;
    const padV = item.level === 0 ? 20 : 12;
    item.w = Math.min(260, len * fontSize * 0.65 + padH);
    item.h = fontSize + padV;
  }

  _layoutTree(tree, gapH, gapV) {
    this._measureAll(tree);
    tree.x = 0; tree.y = 0;
    if (this.layout === 'bilateral') this._layoutBilateral(tree, gapH, gapV);
    else if (this.layout === 'orgchart') this._layoutOrgchart(tree, gapH, gapV);
    else this._layoutRight(tree, gapH, gapV);
  }

  _measureAll(item) {
    this._measureNode(item);
    for (const c of item.children) this._measureAll(c);
  }

  _getSubtreeHeight(item, gapV) {
    if (!item.children.length) return item.h;
    let total = 0;
    for (let i = 0; i < item.children.length; i++) {
      if (i > 0) total += gapV;
      total += this._getSubtreeHeight(item.children[i], gapV);
    }
    return Math.max(item.h, total);
  }

  _layoutRight(item, gapH, gapV) {
    if (!item.children.length) return;
    const totalH = this._getSubtreeHeight(item, gapV);
    let startY = item.y + item.h / 2 - totalH / 2;
    const childX = item.x + item.w + gapH;
    for (const child of item.children) {
      const subH = this._getSubtreeHeight(child, gapV);
      child.x = childX;
      child.y = startY + subH / 2 - child.h / 2;
      this._layoutRight(child, gapH, gapV);
      startY += subH + gapV;
    }
  }

  _layoutBilateral(root, gapH, gapV) {
    if (!root.children.length) return;
    const left = root.children.filter((_, i) => i % 2 === 1);
    const right = root.children.filter((_, i) => i % 2 === 0);
    const layV = (items, dir) => {
      const totalH = items.reduce((s, c, i) => s + (i > 0 ? gapV : 0) + this._getSubtreeHeight(c, gapV), 0);
      let startY = root.y + root.h / 2 - totalH / 2;
      for (const child of items) {
        const subH = this._getSubtreeHeight(child, gapV);
        child.x = dir > 0 ? root.x + root.w + gapH : root.x - child.w - gapH;
        child.y = startY + subH / 2 - child.h / 2;
        child._dir = dir;
        this._layoutBilateralChild(child, gapH, gapV, dir);
        startY += subH + gapV;
      }
    };
    layV(right, 1); layV(left, -1);
  }

  _layoutBilateralChild(item, gapH, gapV, dir) {
    if (!item.children.length) return;
    const totalH = this._getSubtreeHeight(item, gapV);
    let startY = item.y + item.h / 2 - totalH / 2;
    for (const child of item.children) {
      const subH = this._getSubtreeHeight(child, gapV);
      child.x = dir > 0 ? item.x + item.w + gapH : item.x - child.w - gapH;
      child.y = startY + subH / 2 - child.h / 2;
      child._dir = dir;
      this._layoutBilateralChild(child, gapH, gapV, dir);
      startY += subH + gapV;
    }
  }

  _getSubtreeWidth(item, gapH) {
    if (!item.children.length) return item.w;
    let maxW = 0;
    for (const c of item.children) maxW = Math.max(maxW, this._getSubtreeWidth(c, gapH));
    return item.w + gapH + maxW;
  }

  _layoutOrgchart(root, gapH, gapV) {
    if (!root.children.length) return;
    const totalW = root.children.reduce((s, c, i) => s + (i > 0 ? gapH : 0) + this._getSubtreeWidth(c, gapH), 0);
    let startX = root.x + root.w / 2 - totalW / 2;
    const childY = root.y + root.h + gapV * 8;
    for (const child of root.children) {
      const subW = this._getSubtreeWidth(child, gapH);
      child.x = startX + subW / 2 - child.w / 2;
      child.y = childY;
      child._orgchart = true;
      this._layoutOrgchartChild(child, gapH, gapV);
      startX += subW + gapH;
    }
  }

  _layoutOrgchartChild(item, gapH, gapV) {
    if (!item.children.length) return;
    const totalW = item.children.reduce((s, c, i) => s + (i > 0 ? gapH : 0) + this._getSubtreeWidth(c, gapH), 0);
    let startX = item.x + item.w / 2 - totalW / 2;
    const childY = item.y + item.h + gapV * 8;
    for (const child of item.children) {
      const subW = this._getSubtreeWidth(child, gapH);
      child.x = startX + subW / 2 - child.w / 2;
      child.y = childY;
      child._orgchart = true;
      this._layoutOrgchartChild(child, gapH, gapV);
      startX += subW + gapH;
    }
  }

  _collectAll(item, arr) {
    arr.push(item);
    for (const c of item.children) this._collectAll(c, arr);
  }

  _renderNodes(item, container, offX, offY) {
    const div = document.createElement('div');
    div.className = 'mm-node';
    if (item.level === 0) div.classList.add('mm-root');
    else if (item.level === 1) div.classList.add('mm-l1');
    else if (item.level === 2) div.classList.add('mm-l2');
    else div.classList.add('mm-l3');
    if (item.path === this.selectedPath) div.classList.add('selected');
    if (this.nodeShape === 'rect') div.style.borderRadius = '0';
    else if (this.nodeShape === 'ellipse') div.style.borderRadius = '50%';
    if (this.colorScheme === 'rainbow' && item.level > 0) {
      const c = this._RAINBOW[(item.level - 1) % this._RAINBOW.length];
      div.style.borderColor = c;
      div.style.color = c;
    }
    const labelText = stripMediaTags(item.label) || '\u00A0';
    div.textContent = labelText;
    if (typeof applyMdHtml === 'function' && (typeof app !== 'undefined') && app.renderMode) {
      applyMdHtml(div, app, {inline:true});
    }
    if (hasMediaTag(item.label || '')) {
      const parts = (item.label || '').split(MEDIA_RE);
      for (let i = 1; i < parts.length; i += 2) {
        const media = parseMediaTag(parts[i]);
        if (!media) continue;
        const thumb = document.createElement('span');
        thumb.className = 'mm-media-thumb';
        const mediaTag = '{{' + parts[i] + '}}';
        if (media.image) {
          thumb.style.backgroundImage = 'url(' + resolveMediaSrc(media.image) + ')';
        } else if (media.video) {
          thumb.textContent = '▶';
        } else if (media.audio) {
          thumb.textContent = '♪';
        }
        thumb.title = '点击预览';
        thumb.addEventListener('click', e => {
          e.stopPropagation();
          this._showMediaPopup(div, item, mediaTag, 'content', container);
        });
        div.appendChild(thumb);
      }
    }
    div.style.left = (item.x + offX) + 'px';
    div.style.top = (item.y + offY) + 'px';
    div.dataset.path = item.path;
    item._el = div;

    if (item.node && item.level > 0) {
      const style = buildNodeStyle(this.data, item.path, item.level);
      if (style.font) div.style.fontFamily = style.font;
      if (style.font_size) div.style.fontSize = style.font_size;
      if (style.color) div.style.color = rgbToHex(String(style.color));
      if (style.bold) div.style.fontWeight = '700';
      if (style.italic) div.style.fontStyle = 'italic';
      if (style.background_color) div.style.background = rgbToHex(String(style.background_color));
      if (item.node.border) div.style.border = item.node.border;
      if (item.node.border_color) div.style.borderColor = rgbToHex(String(item.node.border_color));
      if (item.node.border_radius) div.style.borderRadius = item.node.border_radius;
    }

    div.addEventListener('click', e => {
      e.stopPropagation();
      this.selectedPath = item.path;
      this.focusPath = item.path;
      this.el.querySelectorAll('.mm-node.selected').forEach(n => n.classList.remove('selected'));
      div.classList.add('selected');
      app.updateSidebar(item.path);
    });

    div.addEventListener('dblclick', e => {
      e.stopPropagation();
      if (item.path === '__root__') return;
      // Check if this is a ref node — if so, show raw formula
      const rawContent = item.node ? (item.node.content || '') : '';
      const isContentRef = isRef(rawContent);

      div.contentEditable = 'true';
      div.focus();
      if (isContentRef || div.classList.contains('udd-md-rendered')) {
        // Show raw source for editing (md-rendered or ref cell)
        div.textContent = rawContent;
        div.classList.remove('udd-md-rendered');
      }
      const sel = window.getSelection();
      sel.selectAllChildren(div);
      sel.collapseToEnd();
      const onBlur = () => {
        div.contentEditable = 'false';
        const newText = div.textContent.trim();
        if (item.node && newText !== (isContentRef ? rawContent : item.label)) {
          app.pushUndo();
          item.node.content = newText;
          app.markDirty();
        }
        // Re-render to show resolved value
        this.render(this.data, { preserveView: true });
        div.removeEventListener('blur', onBlur);
      };
      div.addEventListener('blur', onBlur);
      div.addEventListener('keydown', ke => {
        if (ke.key === 'Enter') { ke.preventDefault(); div.blur(); }
      });
    });

    if (item.hasChildren) {
      const fold = document.createElement('span');
      fold.className = 'mm-fold';
      fold.textContent = item.folded ? '+' : '−';
      if (this.layout === 'orgchart') {
        fold.style.cssText = 'right:auto;left:50%;top:auto;bottom:-18px;transform:translateX(-50%)';
      } else if (this.layout === 'bilateral' && item._dir === -1) {
        fold.style.cssText = 'right:auto;left:-18px;transform:translateY(-50%)';
      }
      fold.addEventListener('click', e => {
        e.stopPropagation();
        if (item.node) {
          app.pushUndo();
          item.node.hide = item.folded ? 0 : 1;
          app.markDirty();
          this.render(this.data, { preserveView: true });
        }
      });
      div.appendChild(fold);
    }

    if (item.hasBody) {
      const dot = document.createElement('span');
      dot.className = 'mm-body-indicator';
      dot.textContent = '▸';
      dot.title = '查看正文';
      dot.addEventListener('click', e => {
        e.stopPropagation();
        const old = this.el.querySelector('.mm-body-popup:not([data-media])');
        if (old && old.dataset.path === item.path) { old.remove(); return; }
        if (old) old.remove();
        const popup = document.createElement('div');
        popup.className = 'mm-body-popup';
        popup.dataset.path = item.path;
        popup.style.left = div.style.left;
        popup.style.top = (parseFloat(div.style.top) + (item._realH || item.h) + 8) + 'px';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'mm-popup-close';
        closeBtn.textContent = '×';
        closeBtn.onclick = ev => { ev.stopPropagation(); popup.remove(); };
        popup.appendChild(closeBtn);
        const effectiveMmNode = item._sourceNode || item.node;
        const rawMmBody = effectiveMmNode.body || '';
        const displayMmBody = isRef(rawMmBody) ? getDisplayValue(this.data, effectiveMmNode, 'body') : rawMmBody;
        const bodyText = stripMediaTags(displayMmBody);
        // 是否允许在 popup 内编辑：本节点的真实 body（非 ref 克隆、非 =ref 字段）才可编辑。
        // 编辑写回到 item.node.body —— ref 克隆请到源节点编辑，避免歧义。
        const editable = !item._sourceNode && !isRef(rawMmBody) && !!item.node;
        if (bodyText) {
          const t = document.createElement('div');
          t.textContent = bodyText;
          if (editable) {
            t.dataset.path = item.path;
            t.dataset.field = 'body';
            // 先 plaintext-only：applyMdHtml 会在元素内容含 md/html 语法时把它锁回 'false'
            // 并把 'plaintext-only' 存到 dataset.uddCePrev，配合 udd-mdhtml.js 的双击-编辑-失焦
            // 流水线（双击 → refEditing + 还原源码；mousedown-outside / focusout → 写回 + 重渲）。
            t.contentEditable = 'plaintext-only';
            if (!t.contentEditable || t.contentEditable === 'inherit') t.contentEditable = 'true';
            t.spellcheck = false;
          }
          popup.appendChild(t);
          // 与标题一致：弹出 body 也走 md/html 渲染（受 app.renderMd / renderHtml 控制）。
          if (typeof applyMdHtml === 'function' && typeof app !== 'undefined' && app.renderMode) {
            applyMdHtml(t, app, { inline: false });
          }
        }
        if (hasMediaTag(rawMmBody)) {
          const md = document.createElement('div');
          renderTextWithMedia(rawMmBody, md, {path: item.path, field:'body', view:this});
          popup.appendChild(md);
        }
        container.appendChild(popup);
      });
      div.appendChild(dot);
    }

    container.appendChild(div);
    for (const child of item.children) {
      this._renderNodes(child, container, offX, offY);
    }
  }

  _updateRealSizes(item) {
    if (item._el) {
      item._realW = item._el.offsetWidth;
      item._realH = item._el.offsetHeight;
    }
    for (const child of item.children) this._updateRealSizes(child);
  }

  _drawLines(item, svg, svgOffX, svgOffY) {
    for (const child of item.children) {
      const pw = item._realW || item.w, ph = item._realH || item.h;
      const cw = child._realW || child.w, ch = child._realH || child.h;
      let x1, y1, x2, y2;
      if (this.layout === 'orgchart') {
        x1 = item.x + pw / 2 + svgOffX; y1 = item.y + ph + svgOffY;
        x2 = child.x + cw / 2 + svgOffX; y2 = child.y + svgOffY;
      } else if (this.layout === 'bilateral' && child._dir === -1) {
        x1 = item.x + svgOffX; y1 = item.y + ph / 2 + svgOffY;
        x2 = child.x + cw + svgOffX; y2 = child.y + ch / 2 + svgOffY;
      } else {
        x1 = item.x + pw + svgOffX; y1 = item.y + ph / 2 + svgOffY;
        x2 = child.x + svgOffX; y2 = child.y + ch / 2 + svgOffY;
      }
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const lineColor = this._getLineColor(item.level);
      if (this.lineStyle === 'straight') {
        ln.setAttribute('d', `M${x1},${y1} L${x2},${y2}`);
      } else if (this.lineStyle === 'polyline') {
        const isOrg = this.layout === 'orgchart';
        const mid = isOrg ? (y1 + y2) / 2 : (x1 + x2) / 2;
        ln.setAttribute('d', isOrg
          ? `M${x1},${y1} L${x1},${mid} L${x2},${mid} L${x2},${y2}`
          : `M${x1},${y1} L${mid},${y1} L${mid},${y2} L${x2},${y2}`);
      } else {
        const isOrg = this.layout === 'orgchart';
        const mx = (x1 + x2) / 2;
        ln.setAttribute('d', isOrg
          ? `M${x1},${y1} C${x1},${(y1+y2)/2} ${x2},${(y1+y2)/2} ${x2},${y2}`
          : `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
      }
      ln.setAttribute('fill', 'none');
      ln.setAttribute('stroke', lineColor);
      ln.setAttribute('stroke-width', '1.5');
      svg.appendChild(ln);
      this._drawLines(child, svg, svgOffX, svgOffY);
    }
  }

  _RAINBOW = ['#4f46e5','#0891b2','#16a34a','#ca8a04','#ea580c','#dc2626','#9333ea','#db2777'];

  _getLineColor(level) {
    if (this.colorScheme === 'rainbow') return this._RAINBOW[level % this._RAINBOW.length];
    if (this.colorScheme === 'mono') return '#64748b';
    return '#94a3b8';
  }

  _onKeyDown(e) {
    if (app.currentView !== 'mindmap') return;
    if (e.target.isContentEditable) return;
    const path = this.selectedPath;
    if (!path || path === '__root__') return;
    if (e.key === 'Enter') { e.preventDefault(); this._addSibling(path); }
    else if (e.key === 'Tab') { e.preventDefault(); this._addChild(path); }
    else if (e.key === 'Delete') { e.preventDefault(); this._deleteNode(path); }
    else if (e.code === 'Space' && !this._spaceDown) { e.preventDefault(); this._toggleFold(path); }
    else if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); this._navigate(e.key); }
  }

  // 与大纲/文档视图完全一致的 refEditing 失焦恢复：dataset.refEditing 是 udd-mdhtml.js 双击时
  // 设上的原始源码，失焦时把当前 textContent 和它比对，有差异就写回 node[field]。
  // 关键差异：大纲/文档走 this.render(this.data)（重建整页），mindmap 改走就地 applyMdHtml(el)
  // —— 避免整页重渲把 body popup 一起清掉。
  onFocusOut(e) {
    const el = e.target;
    if (!el || !el.dataset) return;
    if (el.dataset.refEditing === undefined) return;
    const orig = el.dataset.refEditing;
    const node = (el.dataset.path && typeof getNodeByPath === 'function')
      ? getNodeByPath(this.data, el.dataset.path) : null;
    if (node && el.dataset.field) {
      const edited = el.textContent;
      const normOrig = orig.replace(/[\s​-‏﻿]+/g, '');
      const normEdited = edited.replace(/[\s​-‏﻿]+/g, '');
      if (normEdited !== normOrig) {
        node[el.dataset.field] = edited;
        if (typeof app !== 'undefined') app.markDirty();
      }
    }
    delete el.dataset.refEditing;
    if (typeof applyMdHtml === 'function' && document.contains(el)) {
      applyMdHtml(el, app, { inline: false });
    }
  }

  onFocusIn(e) {
    // 清掉可能残留的旧 uddPreMd / uddCePrev（比如视图重渲后 el 重建，udd-mdhtml.js 自己有兜底
    // 但这里不主动清，避免破坏新 applyMdHtml 留下的状态）。保持空实现作为对称即可。
  }

  _getVisiblePaths() {
    const paths = [];
    const walk = (item) => { paths.push(item.path); for (const c of item.children) walk(c); };
    if (this._tree) walk(this._tree);
    return paths;
  }

  _navigate(key) {
    const paths = this._getVisiblePaths().filter(p => p !== '__root__');
    if (!paths.length) return;
    const idx = paths.indexOf(this.selectedPath);
    let next = idx;
    if (key === 'ArrowUp' || key === 'ArrowLeft') next = Math.max(0, idx - 1);
    else if (key === 'ArrowDown' || key === 'ArrowRight') next = Math.min(paths.length - 1, idx + 1);
    this.selectedPath = paths[next];
    this.focusPath = paths[next];
    this.render(this.data);
    app.updateSidebar(this.selectedPath);
  }

  _addSibling(path) {
    const parts = path.split('.');
    const key = parts[parts.length - 1];
    const level = getLevel(key);
    const parent = parts.length === 1 ? this.data : getNodeByPath(this.data, parts.slice(0, -1).join('.'));
    app.pushUndo();
    const newKey = `t${level}-${nextSeq(parent, level)}`;
    insertAfter(parent, key, newKey, { content: '', hide: 0, hide_body: 0 });
    this.selectedPath = parts.length === 1 ? newKey : parts.slice(0, -1).join('.') + '.' + newKey;
    this.focusPath = this.selectedPath;
    app.markDirty();
    this.render(this.data);
    this._editSelected();
  }

  _addChild(path) {
    const node = getNodeByPath(this.data, path);
    if (!node) return;
    const level = getLevel(path.split('.').pop()) + 1;
    app.pushUndo();
    const newKey = `t${level}-${nextSeq(node, level)}`;
    node[newKey] = { content: '', hide: 0, hide_body: 0 };
    if (node.hide === 1) node.hide = 0;
    this.selectedPath = path + '.' + newKey;
    this.focusPath = this.selectedPath;
    app.markDirty();
    this.render(this.data);
    this._editSelected();
  }

  _deleteNode(path) {
    const parts = path.split('.');
    const key = parts[parts.length - 1];
    const level = getLevel(key);
    const parent = parts.length === 1 ? this.data : getNodeByPath(this.data, parts.slice(0, -1).join('.'));
    if (parts.length === 1 && getAllTKeys(this.data).length <= 1) return;
    const node = parent[key];
    if (getAllTKeys(node).length > 0 && !confirm('该节点下有子节点，确定删除？')) return;
    app.pushUndo();
    const siblings = getChildTKeys(parent, level);
    const idx = siblings.indexOf(key);
    delete parent[key];
    if (idx > 0) this.selectedPath = parts.length === 1 ? siblings[idx - 1] : parts.slice(0, -1).join('.') + '.' + siblings[idx - 1];
    else if (parts.length > 1) this.selectedPath = parts.slice(0, -1).join('.');
    else { const r = getAllTKeys(this.data); this.selectedPath = r.length ? r[0] : null; }
    this.focusPath = this.selectedPath;
    app.markDirty();
    this.render(this.data);
  }

  _toggleFold(path) {
    const node = getNodeByPath(this.data, path);
    if (!node) return;
    app.pushUndo();
    node.hide = node.hide ? 0 : 1;
    app.markDirty();
    this.render(this.data, { preserveView: true });
  }

  _showContextMenu(x, y, path) {
    document.querySelectorAll('.mm-ctx').forEach(m => m.remove());
    const node = getNodeByPath(this.data, path);
    if (!node) return;
    const menu = document.createElement('div');
    menu.className = 'mm-ctx';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    const items = [
      ['添加同级节点', () => this._addSibling(path)],
      ['添加子节点', () => this._addChild(path)],
      ['---'],
      ['复制', () => { this._clipboard = deepClone(node); }],
      ['剪切', () => { this._clipboard = deepClone(node); this._deleteNode(path); }],
      ['粘贴', () => { if (!this._clipboard) return; const lv = getLevel(path.split('.').pop()) + 1; const nk = `t${lv}-${nextSeq(node, lv)}`; app.pushUndo(); node[nk] = deepClone(this._clipboard); if (node.hide === 1) node.hide = 0; app.markDirty(); this.render(this.data); }],
      ['---'],
      [node.hide ? '展开子树' : '折叠子树', () => this._toggleFold(path)],
      [node.hide_body ? '展开正文' : '折叠正文', () => { app.pushUndo(); node.hide_body = node.hide_body ? 0 : 1; app.markDirty(); this.render(this.data, { preserveView: true }); }],
      ['---'],
      ['删除', () => this._deleteNode(path)]
    ];
    for (const it of items) {
      if (it[0] === '---') { menu.appendChild(document.createElement('hr')); continue; }
      const d = document.createElement('div');
      d.textContent = it[0];
      d.onclick = () => { menu.remove(); it[1](); };
      menu.appendChild(d);
    }
    document.body.appendChild(menu);
    const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  _editSelected() {
    const el = this.el.querySelector(`.mm-node[data-path="${this.selectedPath}"]`);
    if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }

  zoomIn() { this.zoom = Math.min(3, this.zoom * 1.2); this._applyTransform(); }
  zoomOut() { this.zoom = Math.max(0.3, this.zoom / 1.2); this._applyTransform(); }
  resetView() { this.zoom = 1; this.pan = { x: 0, y: 0 }; this._applyTransform(); }

  _toggleDD(btn) {
    const menu = btn.nextElementSibling;
    const wasOpen = menu.classList.contains('open');
    document.querySelectorAll('.mm-dropdown-menu.open').forEach(m => m.classList.remove('open'));
    if (!wasOpen) {
      menu.classList.add('open');
      const close = e => { if (!menu.contains(e.target) && e.target !== btn) { menu.classList.remove('open'); document.removeEventListener('mousedown', close); } };
      setTimeout(() => document.addEventListener('mousedown', close), 0);
    }
  }
  _setProp(prop, val) {
    document.querySelectorAll('.mm-dropdown-menu.open').forEach(m => m.classList.remove('open'));
    this[prop] = val;
    this.render(this.data);
  }

  _setGapV(val) {
    val = Math.max(0, Math.round(val));
    if (this.gapV === val) return;
    this.gapV = val;
    this.render(this.data, { preserveView: true });
  }

  _showMediaPopup(anchorDiv, item, mediaTag, field, container) {
    const key = item.path + ':' + field + ':' + mediaTag;
    const old = this.el.querySelector('.mm-body-popup[data-media]');
    if (old && old.dataset.mediaKey === key) { old.remove(); return; }
    if (old) old.remove();
    const popup = document.createElement('div');
    popup.className = 'mm-body-popup';
    popup.dataset.path = item.path;
    popup.dataset.media = '1';
    popup.dataset.mediaKey = key;
    popup.style.left = anchorDiv.style.left;
    popup.style.top = (parseFloat(anchorDiv.style.top) + (item._realH || item.h) + 8) + 'px';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'mm-popup-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = ev => { ev.stopPropagation(); popup.remove(); };
    popup.appendChild(closeBtn);
    const md = document.createElement('div');
    renderTextWithMedia(mediaTag, md, {path: item.path, field: field, view:this});
    popup.appendChild(md);
    container.appendChild(popup);
  }

  exportImage(fmt) {
    const inner = this.el.querySelector('.mm-inner');
    if (!inner) return;
    // Remove toolbar temporarily for clean export
    const tb = this.el.querySelector('.mm-toolbar');
    if (tb) tb.style.display = 'none';
    // Save current transform and reset for capture
    const oldTf = inner.style.transform;
    inner.style.transform = 'none';
    // Get bounds
    const nodes = inner.querySelectorAll('.mm-node');
    const svg = inner.querySelector('svg');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const l = parseFloat(n.style.left), t = parseFloat(n.style.top);
      minX = Math.min(minX, l); minY = Math.min(minY, t);
      maxX = Math.max(maxX, l + n.offsetWidth); maxY = Math.max(maxY, t + n.offsetHeight);
    });
    if (svg) {
      const sl = parseFloat(svg.style.left), st = parseFloat(svg.style.top);
      minX = Math.min(minX, sl); minY = Math.min(minY, st);
      maxX = Math.max(maxX, sl + parseFloat(svg.getAttribute('width')));
      maxY = Math.max(maxY, st + parseFloat(svg.getAttribute('height')));
    }
    const pad = 20, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;

    if (fmt === 'svg') {
      this._exportSVG(inner, minX, minY, w, h, pad);
    } else {
      this._exportPNG(inner, minX, minY, w, h, pad);
    }
    inner.style.transform = oldTf;
    if (tb) tb.style.display = '';
  }

  _exportSVG(inner, minX, minY, w, h, pad) {
    const ns = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(ns, 'svg');
    svgEl.setAttribute('xmlns', ns);
    svgEl.setAttribute('width', w);
    svgEl.setAttribute('height', h);
    svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    // Background
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', w); bg.setAttribute('height', h);
    bg.setAttribute('fill', '#ffffff');
    svgEl.appendChild(bg);
    // Copy lines from existing SVG
    const srcSvg = inner.querySelector('svg');
    if (srcSvg) {
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('transform', `translate(${parseFloat(srcSvg.style.left) - minX + pad},${parseFloat(srcSvg.style.top) - minY + pad})`);
      srcSvg.querySelectorAll('path').forEach(p => g.appendChild(p.cloneNode(true)));
      svgEl.appendChild(g);
    }
    // Nodes as text
    inner.querySelectorAll('.mm-node').forEach(n => {
      const x = parseFloat(n.style.left) - minX + pad + 8;
      const y = parseFloat(n.style.top) - minY + pad;
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', x - 8); rect.setAttribute('y', y);
      rect.setAttribute('width', n.offsetWidth); rect.setAttribute('height', n.offsetHeight);
      rect.setAttribute('rx', '6'); rect.setAttribute('fill', getComputedStyle(n).backgroundColor || '#fff');
      rect.setAttribute('stroke', getComputedStyle(n).borderColor || '#e2e8f0');
      svgEl.appendChild(rect);
      const txt = document.createElementNS(ns, 'text');
      txt.setAttribute('x', x + 6); txt.setAttribute('y', y + n.offsetHeight / 2 + 4);
      txt.setAttribute('font-size', getComputedStyle(n).fontSize);
      txt.setAttribute('fill', getComputedStyle(n).color);
      txt.textContent = n.textContent.replace(/[+−▸]$/, '').trim();
      svgEl.appendChild(txt);
    });
    const blob = new Blob([new XMLSerializer().serializeToString(svgEl)], { type: 'image/svg+xml' });
    this._download(blob, 'mindmap.svg');
  }

  _exportPNG(inner, minX, minY, w, h, pad) {
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    // Draw lines
    const srcSvg = inner.querySelector('svg');
    if (srcSvg) {
      const ox = parseFloat(srcSvg.style.left) - minX + pad;
      const oy = parseFloat(srcSvg.style.top) - minY + pad;
      const svgData = new XMLSerializer().serializeToString(srcSvg);
      const img = new Image();
      const blob = new Blob([svgData], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        ctx.drawImage(img, ox, oy);
        URL.revokeObjectURL(url);
        this._drawPNGNodes(ctx, inner, minX, minY, pad);
        canvas.toBlob(b => this._download(b, 'mindmap.png'), 'image/png');
      };
      img.src = url;
    } else {
      this._drawPNGNodes(ctx, inner, minX, minY, pad);
      canvas.toBlob(b => this._download(b, 'mindmap.png'), 'image/png');
    }
  }

  _drawPNGNodes(ctx, inner, minX, minY, pad) {
    inner.querySelectorAll('.mm-node').forEach(n => {
      const x = parseFloat(n.style.left) - minX + pad;
      const y = parseFloat(n.style.top) - minY + pad;
      const cs = getComputedStyle(n);
      ctx.fillStyle = cs.backgroundColor || '#fff';
      ctx.strokeStyle = cs.borderColor || '#e2e8f0';
      const r = 6;
      ctx.beginPath();
      ctx.roundRect(x, y, n.offsetWidth, n.offsetHeight, r);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = cs.color;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      ctx.textBaseline = 'middle';
      const label = n.textContent.replace(/[+−▸]$/, '').trim();
      ctx.fillText(label, x + 8, y + n.offsetHeight / 2, n.offsetWidth - 16);
    });
  }

  _download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
