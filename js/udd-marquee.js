// ================================================================
//  UDD Marquee Selection — 跨节点矩形框选（大纲视图 / 文档视图）
//
//  背景：每个节点的 content / body 是独立的 contenteditable 编辑宿主，
//  浏览器原生拖动选区无法跨元素，只能选中一个 content 内的文字。
//
//  用法：
//    · 在空白处（行背景、缩进、页面留白）按住左键拖动 → 画出蓝色矩形，
//      矩形框住的所有 content / body 整块高亮选中（可跨任意多个节点）。
//    · 从某个 content 的文字上开始拖动时，先按原生方式选词；一旦拖出
//      该 content 边界 12px，自动升级为矩形框选（以按下点为锚点）。
//    · Alt + 拖动：从任意位置（含文字上）直接强制矩形框选。
//    · 选中后 Ctrl+C 或点击浮动条上的「复制」复制全部文本；Esc / 点击
//      空白处取消。
//
//  实现要点：拖动开始时一次性缓存所有候选元素的视口矩形，mousemove
//  只做纯数学求交 + class 切换，避免大量 getBoundingClientRect 卡顿。
// ================================================================
(function () {
  if (window.__uddMarquee) return;
  window.__uddMarquee = true;

  // 参与框选的文本元素（大纲 + 文档视图）
  const TEXT_SEL = '.outline-content,.outline-body,.doc-h1,.doc-h2,.doc-h3,.doc-h4,.doc-h5,.doc-h6,.doc-body';
  // 按下时跳过（有自己交互语义）的元素
  const SKIP_SEL = 'input,textarea,select,button,a,[draggable="true"],' +
    '.outline-arrow,.body-btn,.ref-icon,.doc-fold,img,video,audio,source,' +
    'table,.outline-media,.media-wrap,.inline-table,.marquee-pill';
  // 从文字拖出源 content 多少像素后升级为矩形框选
  const EDGE = 12;

  const S = {
    down: false,          // 鼠标按住中
    started: false,       // 矩形框选已激活
    fromEditable: false,  // 从 contenteditable 文字上按下（等待升级）
    downPt: null,         // 按下点 {x,y}
    srcRect: null,        // 源编辑元素矩形
    anchor: null, cur: null,
    container: null,
    cached: [],           // [{el, rect}]
    hits: new Set(),
    selected: [],         // 松手后确定的选中元素（DOM 顺序）
  };
  let rectEl = null, pill = null, rafPending = false;

  function views() {
    return [document.getElementById('outline-view'), document.getElementById('document-view')];
  }
  function activeContainer() {
    return document.querySelector('#outline-view.active') || document.querySelector('#document-view.active');
  }
  function inView(target) {
    for (const v of views()) if (v && v.contains(target)) return true;
    return false;
  }
  function editableHost(t) {
    const el = t.closest ? t.closest('[contenteditable]') : null;
    return (el && el.isContentEditable) ? el : null;
  }

  function ensureRectEl() {
    if (!rectEl || !rectEl.isConnected) {
      rectEl = document.createElement('div');
      rectEl.className = 'marquee-rect';
      document.body.appendChild(rectEl);
    }
    return rectEl;
  }
  function removePill() {
    if (pill) { pill.remove(); pill = null; }
  }

  // 拖动期间 DOM 不变（发生重渲染会整体中止），矩形可一次性缓存
  function collectCandidates() {
    S.cached = [];
    if (!S.container) return;
    S.container.querySelectorAll(TEXT_SEL).forEach(el => {
      const text = el.innerText;
      if (!text || !text.trim()) return; // 空节点（占位符）不参与
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      S.cached.push({ el, rect: r });
    });
  }

  function marqueeRect() {
    const x = Math.min(S.anchor.x, S.cur.x), y = Math.min(S.anchor.y, S.cur.y);
    return {
      left: x, top: y,
      right: Math.max(S.anchor.x, S.cur.x),
      bottom: Math.max(S.anchor.y, S.cur.y),
    };
  }

  function applyHits() {
    const m = marqueeRect();
    const newHits = new Set();
    for (const c of S.cached) {
      const r = c.rect;
      const hit = r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top;
      if (hit) newHits.add(c.el);
      if (hit !== S.hits.has(c.el)) c.el.classList.toggle('marquee-hit', hit);
    }
    S.hits = newHits;
  }

  function beginMarquee(x, y) {
    S.started = true;
    S.anchor = { x, y };
    S.cur = { x, y };
    S.container = activeContainer();
    collectCandidates();
    ensureRectEl().classList.remove('show');
    document.body.classList.add('marquee-selecting');
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    const t = e.target;
    if (t.closest && t.closest('.marquee-pill')) return; // 浮动条自身
    if (!inView(t)) {
      // 点在大纲/文档之外（工具栏、侧边栏等）：清掉当前框选
      if (S.selected.length || S.started) clearMarquee();
      return;
    }
    // 任何新按下都先清掉上一次的选中（随后可能立刻开始新的框选）
    if (S.selected.length || S.started) clearMarquee();

    const host = editableHost(t);
    if (e.altKey) {
      // Alt+拖动：强制矩形框选（输入框等仍除外）
      if (skipTarget(t) && !host) return;
      e.preventDefault();
      S.down = true;
      beginMarquee(e.clientX, e.clientY);
      return;
    }
    if (host) {
      // 从文字上按下：先让浏览器做原生选词，拖出边界后再升级
      S.down = true;
      S.fromEditable = true;
      S.downPt = { x: e.clientX, y: e.clientY };
      S.srcRect = host.getBoundingClientRect();
      return;
    }
    if (skipTarget(t)) return;
    e.preventDefault(); // 阻止原生对静态文本（编号等）的选区
    S.down = true;
    beginMarquee(e.clientX, e.clientY);
  }

  function skipTarget(t) {
    return !!(t.closest && t.closest(SKIP_SEL));
  }

  function onMouseMove(e) {
    if (!S.down) return;
    if (!S.started) {
      if (!S.fromEditable || !S.srcRect) return;
      const r = S.srcRect;
      const out = e.clientX > r.right + EDGE || e.clientX < r.left - EDGE ||
                  e.clientY > r.bottom + EDGE || e.clientY < r.top - EDGE;
      if (!out) return;
      // 升级：取消原生选区，改为矩形框选（锚点 = 按下点）
      try { const sel = window.getSelection(); if (sel) sel.removeAllRanges(); } catch (err) {}
      beginMarquee(S.downPt.x, S.downPt.y);
    }
    S.cur = { x: e.clientX, y: e.clientY };
    const m = marqueeRect();
    const w = m.right - m.left, h = m.bottom - m.top;
    const el = ensureRectEl();
    if (w > 3 || h > 3) el.classList.add('show');
    el.style.left = m.left + 'px';
    el.style.top = m.top + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    applyHits();
  }

  function onMouseUp() {
    if (!S.down) return;
    S.down = false;
    document.body.classList.remove('marquee-selecting');
    if (!S.started) { resetDragState(); return; }
    const m = marqueeRect();
    if ((m.right - m.left) < 5 && (m.bottom - m.top) < 5) { clearMarquee(); return; }
    S.selected = Array.from(S.hits);
    if (rectEl) rectEl.classList.remove('show');
    if (!S.selected.length) { clearMarquee(); return; }
    showPill(m);
    resetDragState();
  }

  function resetDragState() {
    S.down = false;
    S.started = false;
    S.fromEditable = false;
    S.srcRect = null;
    S.downPt = null;
  }

  function showPill(m) {
    removePill();
    pill = document.createElement('div');
    pill.className = 'marquee-pill';
    pill.innerHTML =
      '<span>已选 <b>' + S.selected.length + '</b> 项</span>' +
      '<button type="button" data-act="copy">复制</button>' +
      '<button type="button" class="mq-close" data-act="clear" title="取消选择">×</button>';
    pill.addEventListener('mousedown', ev => ev.stopPropagation());
    pill.addEventListener('click', ev => {
      const act = ev.target.dataset && ev.target.dataset.act;
      if (act === 'copy') copySelection();
      else if (act === 'clear') clearMarquee();
    });
    document.body.appendChild(pill);
    const pw = pill.offsetWidth, ph = pill.offsetHeight;
    let x = m.right + 8, y = m.bottom + 8;
    if (x + pw > window.innerWidth - 8) x = Math.max(8, m.left - pw - 8);
    if (y + ph > window.innerHeight - 8) y = Math.max(8, m.top - ph - 8);
    pill.style.left = x + 'px';
    pill.style.top = y + 'px';
  }

  function buildText() {
    const lines = [];
    for (const el of S.selected) {
      const t = (el.innerText || '').replace(/\u00a0/g, ' ').replace(/^\s+|\s+$/g, '');
      if (t) lines.push(t);
    }
    return lines.join('\n');
  }

  async function copySelection() {
    const text = buildText();
    if (!text) { if (typeof toast === 'function') toast('所选内容为空'); return; }
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* fallback below */ }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
    }
    if (typeof toast === 'function') toast(ok ? ('已复制 ' + S.selected.length + ' 项内容') : '复制失败');
  }

  function clearMarquee() {
    S.down = false;
    S.started = false;
    S.fromEditable = false;
    S.srcRect = null;
    S.downPt = null;
    S.cached = [];
    S.selected = [];
    S.hits = new Set();
    document.querySelectorAll('.marquee-hit').forEach(el => el.classList.remove('marquee-hit'));
    if (rectEl) rectEl.classList.remove('show');
    removePill();
    document.body.classList.remove('marquee-selecting');
  }

  // ---- 事件绑定 ----
  document.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (S.selected.length || S.started)) { clearMarquee(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && S.selected.length) {
      e.preventDefault();
      e.stopPropagation();
      copySelection();
    }
  }, true);

  // 拖动期间发生滚动：视口矩形失效，重算（rAF 合并）
  window.addEventListener('scroll', () => {
    if (!S.down || !S.started) return;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!S.down || !S.started) return;
      collectCandidates();
      applyHits();
    });
  }, true);

  // 视图重渲染（切视图/折叠/编辑回写）会重建 DOM，选中集合随之失效
  const mo = new MutationObserver(() => {
    if (S.started || S.selected.length) clearMarquee();
  });
  for (const v of views()) {
    if (v) mo.observe(v, { childList: true, subtree: true });
  }

  window.addEventListener('blur', () => { if (S.down) clearMarquee(); });
  window.addEventListener('resize', () => { if (S.started || S.selected.length) clearMarquee(); });
})();
