// udd-mdhtml.js — apply markdown / inline-html rendering on top of UDD's
// existing renderOn DOM. Call applyMdHtml(el, app) AFTER renderStyledText
// / renderInlineSegments / textContent has populated the element.
//
// Rules (driven by app.renderMd / app.renderHtml):
//   md off, html off : no-op (existing color spans / textContent kept).
//   md off, html on  : el.innerHTML = el.textContent  (HTML literal interpreted).
//   md on,  html off : markdown-it({html:false}) on textContent.
//   md on,  html on  : markdown-it({html:true})  on textContent.
//
// Edit lifecycle (single-click preserves render, double-click edits source):
//   1. applyMdHtml stashes pre-md textContent in dataset.uddPreMd, replaces
//      innerHTML, and — if the element was editable — locks contentEditable
//      to 'false' (saving original ce in dataset.uddCePrev). Single click
//      thus does NOT enter edit mode and the rendered form is preserved.
//   2. Global dblclick (capture): find ancestor with dataset.uddPreMd; skip
//      ref/hasRef/refEditing elements (handled by view dblclick) and those
//      that were not originally editable (uddCePrev undefined). For the
//      remaining "rendered editable" elements, restore original ce, swap
//      textContent back to source, **set dataset.refEditing = raw** (same
//      flag used by view's own ref-edit path → reuses view's existing
//      onFocusOut branch which writes back + this.render(this.data)).
//   3. Recovery: ride entirely on the view's onFocusOut refEditing branch.
//      For non-focusable click targets where focusout never fires on el,
//      a one-shot capture-phase mousedown listener triggers the same
//      render-current-view as a fallback.

(function () {
  let _instCache = Object.create(null);

  function getMdInstance(htmlOn) {
    const key = htmlOn ? 'H' : 'h';
    if (_instCache[key]) return _instCache[key];
    if (typeof window.markdownit !== 'function') return null;
    _instCache[key] = window.markdownit({
      html: !!htmlOn,
      breaks: true,
      linkify: true,
      typographer: false
    });
    return _instCache[key];
  }

  function _unwrapSingleP(out) {
    const m = out.match(/^<p>([\s\S]*?)<\/p>\s*$/);
    if (!m) return out;
    if (/<(p|h[1-6]|ul|ol|li|blockquote|pre|hr|table|div)\b/i.test(m[1])) return out;
    return m[1];
  }

  function applyMdHtml(el, app, _opts) {
    if (!el || !app) return;
    const md = !!app.renderMd;
    const htmlOn = !!app.renderHtml;
    if (!md && !htmlOn) return;
    const src = el.textContent;
    if (!src) return;
    const hasHtmlChars = /[<&]/.test(src);

    let out;
    if (md) {
      const inst = getMdInstance(htmlOn);
      if (!inst) return;
      try {
        out = inst.render(src);
      } catch (e) {
        return;
      }
      if (out == null) return;
      out = _unwrapSingleP(out);
      if (out === src && !(htmlOn && hasHtmlChars)) return;
    } else {
      if (!hasHtmlChars) return;
      out = src;
    }

    el.dataset.uddPreMd = src;
    const ce = el.contentEditable;
    if (ce === 'true' || ce === 'plaintext-only') {
      el.dataset.uddCePrev = ce;
      el.contentEditable = 'false';
    }
    el.innerHTML = out;
    el.classList.add('udd-md-rendered');
  }

  function _findRenderedAncestor(target) {
    if (!target || !target.closest) return null;
    return target.closest('[data-udd-pre-md]');
  }

  function _onDblClick(e) {
    if (!e || !e.target) return;
    const el = _findRenderedAncestor(e.target);
    if (!el) return;
    if (el.dataset.refEditing !== undefined) return;
    if (el.dataset.ref || el.dataset.hasRef) return;
    if (el.dataset.uddCePrev === undefined) return;

    // 阻止浏览器默认行为（双击选词）和事件继续冒泡，避免在 textContent 已被换掉之后
    // 浏览器再尝试在原坐标选词导致选区/焦点状态混乱。
    e.preventDefault();
    e.stopPropagation();

    const raw = el.dataset.uddPreMd;
    const cePrev = el.dataset.uddCePrev;
    delete el.dataset.uddPreMd;
    delete el.dataset.uddCePrev;
    el.classList.remove('udd-md-rendered');
    el.contentEditable = cePrev;
    el.textContent = raw;
    // 关键：复用视图自己已有的 ref-edit 失焦恢复路径
    // ([udd-outline.js:347] / [udd-document.js:614] 里 onFocusOut 的
    // `if (el.dataset.refEditing !== undefined)` 分支)。
    // 视图会在失焦时 write back node[field] 并 this.render(this.data)，
    // render 路径再次跑 applyMdHtml，元素自然回到渲染态——和"双击 ref → 单击别处"
    // 走的是同一条函数，行为一致。
    el.dataset.refEditing = raw;
    el.focus();
    // 与 ref 的 onRefDblClick 完全一致：selectNodeContents 全选源码（蓝色高亮），
    // 让用户能立刻看到"已进入编辑态"，并避免浏览器在原坐标 select-word 默认行为
    // 把光标 / 焦点搞乱。
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) {}

    // 兜底：用户点击 ce='false' 的兄弟（已渲染态 md/html）时焦点不会转移
    // → focusout 不在 el 上触发 → 视图的 ref-edit 分支跑不到 → 渲染没人恢复。
    // 这里挂一次性 capture mousedown 识别"点到 el 外部"，但**不抢着删 refEditing**：
    // 用 rAF 等到浏览器把 focusout 派发完（如果它会派发）。
    //   - 如果焦点确实离开了 el：视图的 onFocusOut 已经按 refEditing 分支处理完
    //     （write back + render），rAF 回调里 refEditing 已被视图清掉 → 我什么都不做。
    //   - 如果焦点没离开 el（点的目标不可聚焦）：refEditing 还在 → 我兜底把视图的
    //     onFocusOut 那段逻辑原样跑一遍（write back + render）。
    // 这样 mousedown-outside 只在"focusout 不会到达"时才接管，永远不会和视图自己的
    // ref-edit focusout 路径互相抢。
    const onMouseDownOutside = (ev) => {
      if (!ev || !ev.target) return;
      if (el.contains(ev.target)) return;
      document.removeEventListener('mousedown', onMouseDownOutside, true);
      requestAnimationFrame(() => {
        if (el.dataset.refEditing === undefined) return; // 视图 onFocusOut 已处理
        if (typeof window.app === 'undefined') return;
        // 复刻视图 onFocusOut 的 ref-edit 分支：
        const orig = el.dataset.refEditing;
        const edited = el.textContent;
        const node = (typeof getNodeByPath === 'function' && window.app.data && el.dataset.path)
          ? getNodeByPath(window.app.data, el.dataset.path) : null;
        if (node && el.dataset.field) {
          const normOrig = orig.replace(/[\s​-‏﻿]+/g, '');
          const normEdited = edited.replace(/[\s​-‏﻿]+/g, '');
          if (normEdited !== normOrig) {
            node[el.dataset.field] = edited;
            if (typeof window.app.markDirty === 'function') window.app.markDirty();
          }
        }
        delete el.dataset.refEditing;
        if (typeof window.app.renderCurrentView === 'function') {
          window.app.renderCurrentView();
        }
      });
    };
    document.addEventListener('mousedown', onMouseDownOutside, true);
  }

  function _onFocusIn(e) {
    // Single-click no longer auto-unrenders. Only clear stale render-cache flags
    // when the view enters its own ref-editing flow (it manages textContent).
    const el = e.target;
    if (!el || !el.dataset) return;
    if (el.dataset.refEditing === undefined) return;
    if (el.dataset.uddPreMd === undefined) return;
    delete el.dataset.uddPreMd;
    delete el.dataset.uddCePrev;
    el.classList.remove('udd-md-rendered');
  }

  document.addEventListener('dblclick', _onDblClick, true);
  document.addEventListener('focusin', _onFocusIn, true);

  window.applyMdHtml = applyMdHtml;
  window.__getMdInstance = getMdInstance;
})();


