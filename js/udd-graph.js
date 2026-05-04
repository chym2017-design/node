// ================================================================
//  UDD Graph View
//  以当前文档为中心，按跨文档引用关系展开放射状图谱。
//  控制 N 层深度；节点双击打开对应 .udd。
// ================================================================

class GraphView {
  constructor(container) {
    this.el = container;
    this.depth = 3;
    this.docs = new Map();   // docName -> { children: [docName], loaded: bool }
    this.layout = [];        // [{ name, x, y, level, parent, loaded }]
    this._rendered = false;
    this._inputDirty = false;
  }

  syncAll() { /* read-only */ }

  // 视图入口：渲染当前 app.data 为根。重渲会重新扫描跨文档引用并按当前 this.depth 展开。
  async render(data) {
    this.data = data;
    this.docs.clear();
    const rootName = (typeof app !== 'undefined' && app.fileName) || '当前文档';
    this._rootName = rootName;
    this._renderUI();   // 先把 UI 框架挂上（控件 + loading 提示）
    await this._loadDoc(rootName, data, 0);
    this._computeLayout(rootName);
    this._renderSVG();
    this._rendered = true;
  }

  // 递归加载到 maxDepth。loaded=false 表示文件未拿到（未连仓库 / 路径找不到）。
  async _loadDoc(name, data, level) {
    if (this.docs.has(name)) return;
    const refs = data ? this._findCrossDocRefs(data) : [];
    this.docs.set(name, { children: refs, loaded: !!data, level });
    if (level >= this.depth) return;
    for (const childName of refs) {
      if (this.docs.has(childName)) continue; // 已加载或正在加载（避免环）
      let childData = (typeof _refDocCache !== 'undefined') ? _refDocCache[childName] : null;
      if (!childData && typeof _loadDocFromServer === 'function') {
        try {
          childData = await _loadDocFromServer(childName);
          if (childData && typeof _refDocCache !== 'undefined') _refDocCache[childName] = childData;
        } catch (e) { /* skip */ }
      }
      await this._loadDoc(childName, childData, level + 1);
    }
  }

  // 扫描 data 树，收集所有跨文档 docName（去重）。
  // 严格规则（用户要求）：
  //   "只要 docName 以 .udd 结尾，就是文档"。不考虑 Sheet 引用、嵌入引用等其它情况。
  _findCrossDocRefs(data) {
    const out = new Set();
    const refRe = /\{\{(=[^}]+)\}\}/g;
    function tryAdd(refStr) {
      try {
        const r = parseRef(refStr);
        if (!r || !r.docName) return;
        if (!/\.udd$/i.test(r.docName)) return;
        out.add(r.docName);
      } catch (e) {}
    }
    function walk(obj) {
      if (!obj || typeof obj !== 'object') return;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === 'string') {
          if (typeof isRef === 'function' && isRef(v)) tryAdd(v);
          let m;
          refRe.lastIndex = 0;
          while ((m = refRe.exec(v)) !== null) tryAdd(m[1]);
        } else if (typeof v === 'object') walk(v);
      }
    }
    walk(data);
    return Array.from(out);
  }

  // 放射状布局：根在 (0,0)；每层一个圆环（半径 baseR * level）。
  // 每层节点按角度均分；同层节点不区分父，避免父子分支重叠的几何复杂度。
  // 放射状布局（父向感知）：根据父节点所处角度与分配到的角度扇形，把子节点聚到父节点附近，
  // 避免子节点被放到其它分支下面造成"测试文档3 看起来挂在 文件名 下面"这类错觉连线。
  // 每个布局节点除 x/y 外还记录 angle（自身在环上的角度）与 angleSpan（可分配给下级的扇形宽度）。
  _computeLayout(rootName) {
    this.layout = [];

    // 根节点占整个 2π 作为下一级的分配扇形；根自身位于原点，无角度意义。
    this.layout.push({
      name: rootName, x: 0, y: 0, level: 0, parent: null,
      angle: -Math.PI / 2, angleSpan: 2 * Math.PI, loaded: true
    });

    // BFS 展开每一级
    const queue = [rootName];
    const placed = new Set([rootName]);
    const baseR = 160;

    while (queue.length > 0) {
      const name = queue.shift();
      const parentEntry = this.layout.find(n => n.name === name);
      if (!parentEntry || parentEntry.level >= this.depth) continue;
      const info = this.docs.get(name);
      if (!info) continue;

      // 未摆过的子节点
      const children = info.children.filter(c => !placed.has(c));
      if (children.length === 0) continue;

      const childLevel = parentEntry.level + 1;
      const R = baseR * childLevel;
      const span = parentEntry.angleSpan;
      const slot = span / children.length;

      // 子节点占据 [parent.angle - span/2, parent.angle + span/2] 的扇形，
      // 各自在其 slot 中心；L1 时父即根，parent.angle = -π/2 → 子节点从顶部起分布一周。
      const startAngle = parentEntry.angle - span / 2;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        placed.add(child);
        const childAngle = startAngle + (i + 0.5) * slot;
        const childInfo = this.docs.get(child) || {};
        this.layout.push({
          name: child,
          x: R * Math.cos(childAngle),
          y: R * Math.sin(childAngle),
          level: childLevel,
          parent: name,
          angle: childAngle,
          angleSpan: slot,
          loaded: !!childInfo.loaded
        });
        queue.push(child);
      }
    }
  }

  _renderUI() {
    this.el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'graph-wrap';

    // 控件栏
    const ctrl = document.createElement('div');
    ctrl.className = 'graph-controls';
    ctrl.innerHTML = `
      <span class="graph-title">文档关联图谱</span>
      <label>层数 <input type="number" id="graph-depth" min="1" max="10" value="${this.depth}" style="width:50px"></label>
      <button id="graph-refresh">刷新</button>
      <span class="graph-hint">双击节点打开文档；空白处拖动平移；滚轮缩放</span>
    `;
    wrap.appendChild(ctrl);

    // 占位 SVG 容器
    const svgWrap = document.createElement('div');
    svgWrap.className = 'graph-svg-wrap';
    svgWrap.id = 'graph-svg-wrap';
    svgWrap.innerHTML = '<div class="graph-loading">加载中...</div>';
    wrap.appendChild(svgWrap);

    this.el.appendChild(wrap);

    document.getElementById('graph-depth').onchange = (e) => {
      const v = parseInt(e.target.value);
      if (!v || v < 1) return;
      this.depth = v;
      this.render(this.data);
    };
    document.getElementById('graph-refresh').onclick = () => {
      if (typeof _refDocCache !== 'undefined') {
        for (const k of Object.keys(_refDocCache)) delete _refDocCache[k];
      }
      this.render(this.data);
    };
  }

  _renderSVG() {
    const wrap = document.getElementById('graph-svg-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    const W = wrap.clientWidth || 800;
    const H = wrap.clientHeight || 600;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    // 根据层数动态调整 viewBox 尺寸（保证最远节点在视野内）
    const baseR = 160;
    const maxR = baseR * this.depth + 80;
    const vbW = Math.max(W, maxR * 2.2);
    const vbH = Math.max(H, maxR * 2.2);
    svg.setAttribute('viewBox', `${-vbW / 2} ${-vbH / 2} ${vbW} ${vbH}`);
    svg.style.cursor = 'grab';

    // 拖动 + 缩放（修改 viewBox）
    const state = { vx: -vbW / 2, vy: -vbH / 2, vw: vbW, vh: vbH, dragging: false, sx: 0, sy: 0 };
    const applyVB = () => svg.setAttribute('viewBox', `${state.vx} ${state.vy} ${state.vw} ${state.vh}`);
    svg.addEventListener('mousedown', (e) => {
      // 点到节点不进入平移
      if (e.target.closest('.graph-node')) return;
      state.dragging = true;
      state.sx = e.clientX; state.sy = e.clientY;
      svg.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!state.dragging) return;
      const dx = (e.clientX - state.sx) * (state.vw / wrap.clientWidth);
      const dy = (e.clientY - state.sy) * (state.vh / wrap.clientHeight);
      state.vx -= dx; state.vy -= dy;
      state.sx = e.clientX; state.sy = e.clientY;
      applyVB();
    });
    window.addEventListener('mouseup', () => { state.dragging = false; svg.style.cursor = 'grab'; });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      // 以鼠标位置为缩放中心
      const rect = wrap.getBoundingClientRect();
      const mx = state.vx + (e.clientX - rect.left) * (state.vw / rect.width);
      const my = state.vy + (e.clientY - rect.top) * (state.vh / rect.height);
      state.vw *= k; state.vh *= k;
      state.vx = mx - (e.clientX - rect.left) * (state.vw / rect.width);
      state.vy = my - (e.clientY - rect.top) * (state.vh / rect.height);
      applyVB();
    }, { passive: false });

    // 边
    const edges = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    edges.setAttribute('class', 'graph-edges');
    for (const node of this.layout) {
      if (!node.parent) continue;
      const p = this.layout.find(n => n.name === node.parent);
      if (!p) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', p.x);
      line.setAttribute('y1', p.y);
      line.setAttribute('x2', node.x);
      line.setAttribute('y2', node.y);
      line.setAttribute('stroke', '#cbd5e1');
      line.setAttribute('stroke-width', '1.5');
      edges.appendChild(line);
    }
    svg.appendChild(edges);

    // 节点：实点漂浮，层级越深越小、颜色越浅；文档名显示在点旁边（根据角度自动放左/右）。
    // 默认尺寸 = 上一版的 3 倍：根 r=21（直径 42px），后续 18, 15, 12, 10.5, 9, 9。
    // 字号：根 36，其余 33。鼠标悬停时点扩大到 1.5 倍，过渡 0.15s。
    const LEVEL_COLORS = ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe'];
    const LEVEL_RADII  = [21, 18, 15, 12, 10.5, 9, 9];
    const HOVER_SCALE  = 1.5;
    const nodesG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodesG.setAttribute('class', 'graph-nodes');
    for (const node of this.layout) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'graph-node');
      g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      g.style.cursor = 'pointer';

      const lv = Math.min(node.level, LEVEL_COLORS.length - 1);
      const r = LEVEL_RADII[lv];
      const color = node.loaded ? LEVEL_COLORS[lv] : '#cbd5e1';

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', r);
      circle.setAttribute('fill', color);
      circle.setAttribute('stroke', 'none');
      circle.style.transition = 'r 0.15s ease';
      g.appendChild(circle);

      // 文档名标签：根据节点相对中心的位置决定左/右对齐，避免和圆环互相覆盖
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const isRoot = node.level === 0;
      const onRight = node.x >= 0;
      const fontSize = isRoot ? 36 : 33;
      const gap = r + 8;
      label.setAttribute('x', isRoot ? 0 : (onRight ? gap : -gap));
      label.setAttribute('y', isRoot ? r + fontSize : 0);
      label.setAttribute('text-anchor', isRoot ? 'middle' : (onRight ? 'start' : 'end'));
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('fill', node.loaded ? '#1e293b' : '#94a3b8');
      label.setAttribute('font-size', fontSize);
      label.setAttribute('pointer-events', 'none');
      const display = node.name.replace(/^.*[\\/]/, '').replace(/\.udd$/i, '');
      label.textContent = display + (node.loaded ? '' : ' (未找到)');
      g.appendChild(label);

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = node.name + (node.loaded ? '' : ' (未加载)');
      g.appendChild(title);

      // 鼠标接触实点边缘：圆点放大到 HOVER_SCALE 倍。在 circle 上监听确保只对实点生效，
      // 不会因为 hover 到（点击区外的）label 而触发。
      circle.addEventListener('mouseenter', () => {
        circle.setAttribute('r', r * HOVER_SCALE);
      });
      circle.addEventListener('mouseleave', () => {
        circle.setAttribute('r', r);
      });

      g.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (isRoot) return;
        if (typeof app !== 'undefined' && app.openCrossDocRef) {
          app.openCrossDocRef(node.name, null, this);
        }
      });
      nodesG.appendChild(g);
    }
    svg.appendChild(nodesG);
    wrap.appendChild(svg);
  }
}
