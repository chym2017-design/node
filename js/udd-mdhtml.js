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
//      textContent back to source, focus and place caret at end.
//   3. Global focusout (bubble, deferred via rAF): re-apply applyMdHtml on
//      the (possibly edited) textContent so md re-renders and locks again.

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
    // Not originally editable — let the view's own dblclick handler manage
    // (e.g., mindmap label, sheet cell, caption).
    if (el.dataset.uddCePrev === undefined) return;

    const raw = el.dataset.uddPreMd;
    const cePrev = el.dataset.uddCePrev;
    delete el.dataset.uddPreMd;
    delete el.dataset.uddCePrev;
    el.classList.remove('udd-md-rendered');
    el.contentEditable = cePrev;
    el.textContent = raw;
    el.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) {}
  }

  function _onFocusIn(e) {
    // Single-click no longer auto-unrenders. Only clear stale flags when the
    // view enters its own ref-editing flow (it manages textContent itself).
    const el = e.target;
    if (!el || !el.dataset) return;
    if (el.dataset.refEditing === undefined) return;
    if (el.dataset.uddPreMd === undefined) return;
    delete el.dataset.uddPreMd;
    delete el.dataset.uddCePrev;
    el.classList.remove('udd-md-rendered');
  }

  function _onFocusOut(e) {
    const el = e.target;
    if (!el || !el.dataset) return;
    if (el.dataset.refEditing !== undefined) return;
    const ce = el.contentEditable;
    if (ce !== 'true' && ce !== 'plaintext-only') return;
    if (typeof window.app === 'undefined') return;
    // Defer until after any synchronous DOM rebuild done by view handlers;
    // skip if the element was replaced.
    requestAnimationFrame(() => {
      if (!document.contains(el)) return;
      if (el.dataset.refEditing !== undefined) return;
      const ce2 = el.contentEditable;
      if (ce2 !== 'true' && ce2 !== 'plaintext-only') return;
      applyMdHtml(el, window.app, {});
    });
  }

  document.addEventListener('dblclick', _onDblClick, true);
  document.addEventListener('focusin', _onFocusIn, true);
  document.addEventListener('focusout', _onFocusOut, false);

  window.applyMdHtml = applyMdHtml;
  window.__getMdInstance = getMdInstance;
})();


