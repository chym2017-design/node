// ================================================================
//  UDD PPT View
//  Slide preview, format control, PptxGenJS export
// ================================================================

const PPT_THEMES = {
  business_blue:   { name: '商务蓝', accent: '#2563eb', bg: '#ffffff', text: '#1e293b', sub: '#64748b', titleBg: '#eff6ff' },
  tech_dark:       { name: '科技黑', accent: '#06b6d4', bg: '#0f172a', text: '#e2e8f0', sub: '#94a3b8', titleBg: '#1e293b' },
  nature_green:    { name: '自然绿', accent: '#16a34a', bg: '#f0fdf4', text: '#14532d', sub: '#4ade80', titleBg: '#dcfce7' },
  warm_orange:     { name: '暖橙',   accent: '#ea580c', bg: '#fffbeb', text: '#431407', sub: '#fb923c', titleBg: '#fed7aa' },
  elegant_gray:    { name: '优雅灰', accent: '#475569', bg: '#f8fafc', text: '#1e293b', sub: '#94a3b8', titleBg: '#f1f5f9' },
  creative_purple: { name: '创意紫', accent: '#7c3aed', bg: '#faf5ff', text: '#3b0764', sub: '#a78bfa', titleBg: '#ede9fe' }
};

const PPT_LAYOUTS = {
  one_col:       '单栏',
  two_col_left:  '左文右图',
  two_col_right: '左图右文',
  three_col:     '三栏',
  title_only:    '仅标题',
  image_full:    '全屏图片'
};

function getDefaultPptFormat() {
  return {
    theme: 'business_blue',
    global: { slide_per: 't1', content_depth: 4, layout: 'one_col', cover: true, ending: true },
    slides: {}
  };
}

class PptView {
  constructor(container) {
    this.el = container;
    this.data = null;
    this.format = getDefaultPptFormat();
    this.slides = [];
    this.currentSlide = 0;
  }

  setFormat(fmt) { this.format = fmt || getDefaultPptFormat(); }
  getFormat() { return this.format; }

  async render(data) {
    this.data = data;
    this.slides = await this._buildSlides(data, this.format);
    if (this.currentSlide >= this.slides.length) this.currentSlide = Math.max(0, this.slides.length - 1);
    this._renderUI();
  }

  // ---- Build slides from data tree (async for cross-doc refs) ----

  async _buildSlides(data, fmt) {
    const slides = [];
    const g = fmt.global || {};
    const slidePer = g.slide_per || 't1';
    const defaultDepth = g.content_depth || 4;
    const defaultLayout = g.layout || 'one_col';
    const rootKeys = getAllTKeys(data);
    const theme = PPT_THEMES[fmt.theme] || PPT_THEMES.business_blue;

    for (const rk of rootKeys) {
      const rootNode = data[rk];
      if (!rootNode || typeof rootNode !== 'object') continue;

      // Cover slide
      if (g.cover !== false) {
        slides.push({
          type: 'cover', title: await this._resolveContent(rootNode.content),
          subtitle: rootNode.body ? (await this._resolveContent(rootNode.body)).split('\n')[0] : '',
          theme, layout: 'cover', nodePath: rk
        });
      }

      const t1Keys = getChildTKeys(rootNode, 1);
      if (slidePer === 't1') {
        for (const t1k of t1Keys) {
          const t1Node = rootNode[t1k];
          const path = rk + '.' + t1k;
          const override = (fmt.slides || {})[path] || {};
          if (override.split) {
            await this._buildSplitSlides(slides, t1Node, path, override, defaultDepth, defaultLayout, theme);
          } else {
            const depth = override.depth || defaultDepth;
            const layout = override.layout || defaultLayout;
            slides.push(await this._buildContentSlide(t1Node, path, depth, layout, theme, 1));
          }
        }
      } else {
        for (const t1k of t1Keys) {
          const t1Node = rootNode[t1k];
          const t1Path = rk + '.' + t1k;
          const t2Keys = getChildTKeys(t1Node, 2);
          if (t2Keys.length === 0) {
            const override = (fmt.slides || {})[t1Path] || {};
            slides.push(await this._buildContentSlide(t1Node, t1Path, override.depth || defaultDepth, override.layout || defaultLayout, theme, 1));
          } else {
            for (const t2k of t2Keys) {
              const t2Node = t1Node[t2k];
              const path = t1Path + '.' + t2k;
              const override = (fmt.slides || {})[path] || {};
              slides.push(await this._buildContentSlide(t2Node, path, override.depth || defaultDepth, override.layout || defaultLayout, theme, 2));
            }
          }
        }
      }
    }

    if (g.ending !== false) {
      slides.push({ type: 'ending', title: '谢谢', subtitle: '', theme, layout: 'ending' });
    }
    return slides;
  }

  async _buildSplitSlides(slides, node, path, override, defaultDepth, defaultLayout, theme) {
    const splitDef = override.split;
    for (let i = 0; i < splitDef.length; i++) {
      const group = splitDef[i];
      let items, layout, depth;
      if (typeof group === 'string') {
        items = group.split(',').map(s => s.trim());
        layout = override.layout || defaultLayout;
        depth = override.depth || defaultDepth;
      } else {
        items = (group.items || '').split(',').map(s => s.trim());
        layout = group.layout || override.layout || defaultLayout;
        depth = group.depth || override.depth || defaultDepth;
      }
      const bullets = [], images = [];
      for (const itemKey of items) {
        const child = node[itemKey];
        if (!child) continue;
        await this._collectBullets(child, 0, depth - 2, bullets, images);
      }
      slides.push({
        type: 'content', title: await this._resolveContent(node.content),
        notes: node.body ? await this._resolveContent(node.body) : '',
        bullets, images, theme, layout, nodePath: path, splitIndex: i
      });
    }
  }

  async _buildContentSlide(node, path, depth, layout, theme, baseLevel) {
    const bullets = [], images = [];
    const childKeys = getChildTKeys(node, baseLevel + 1);
    for (const ck of childKeys) {
      const child = node[ck];
      if (!child) continue;
      await this._collectBullets(child, 0, depth - baseLevel - 1, bullets, images);
    }
    if (node.body) this._extractImages(node.body, images);
    // Title: for full node refs, use the source node's content as title
    let title = await this._resolveContent(node.content);
    let notes = node.body ? await this._resolveContent(node.body) : '';
    // If no own children but node content is a full node ref, expand it
    if (bullets.length === 0 && isRef(node.content || '') && isFullNodeRef(node.content || '')) {
      const sourceNode = await this._resolveFullNodeAsync(node.content);
      if (sourceNode) {
        title = await this._resolveContent(sourceNode.content);
        if (sourceNode.body) notes = await this._resolveContent(sourceNode.body);
        const srcChildKeys = Object.keys(sourceNode).filter(k => isTNode(k)).sort();
        for (const ck of srcChildKeys) {
          await this._collectBullets(sourceNode[ck], 0, depth - baseLevel - 1, bullets, images);
        }
      }
    }
    return { type: 'content', title, notes, bullets, images, theme, layout, nodePath: path };
  }

  async _collectBullets(node, level, maxDepth, bullets, images) {
    if (!node || typeof node !== 'object') return;
    const raw = node.content || '';

    // Full node ref: expand the source node in-place
    if (isRef(raw) && isFullNodeRef(raw)) {
      const sourceNode = await this._resolveFullNodeAsync(raw);
      if (sourceNode && typeof sourceNode === 'object') {
        await this._collectBullets(sourceNode, level, maxDepth, bullets, images);
        return;
      }
    }

    const content = await this._resolveContent(raw);
    bullets.push({ text: content, level });
    this._extractImages(raw, images);
    if (node.body) {
      const bodyText = await this._resolveContent(node.body);
      const bodyDisplay = bodyText.replace(/\{\{(?!=).*?\}\}/g, '').trim();
      if (bodyDisplay) bullets.push({ text: bodyDisplay, level, isBody: true });
      this._extractImages(node.body, images);
    }
    if (level < maxDepth) {
      const childKeys = Object.keys(node).filter(k => isTNode(k)).sort();
      for (const ck of childKeys) {
        await this._collectBullets(node[ck], level + 1, maxDepth, bullets, images);
      }
    }
  }

  // Resolve a full node ref (=t1-1 or =doc.t1-1) and return the source node object
  async _resolveFullNodeAsync(refStr) {
    const ref = parseRef(refStr);
    if (!ref.nodePath) return null;
    if (ref.docName) {
      let docData = _refDocCache[ref.docName];
      if (!docData) {
        // trigger load via resolveRefAsync (which populates cache)
        await resolveRefAsync(this.data, refStr);
        docData = _refDocCache[ref.docName];
      }
      if (!docData) return null;
      return findRefNode(docData, ref.nodePath);
    }
    return findRefNode(this.data, ref.nodePath);
  }

  _extractImages(text, images) {
    if (!text) return;
    const re = /\{\{(?!=)(.*?)\}\}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const media = parseMediaTag(m[1]);
      if (media && media.image) images.push(media.image);
    }
  }

  async _resolveContent(raw) {
    if (!raw) return '';
    if (hasInlineRefs(raw)) {
      // Resolve each {{=ref}} segment, using async for cross-doc refs
      const segments = [];
      const re = /\{\{(=[^}]+)\}\}/g;
      let lastIdx = 0, m;
      while ((m = re.exec(raw)) !== null) {
        if (m.index > lastIdx) segments.push(raw.slice(lastIdx, m.index));
        segments.push(await resolveRefAsync(this.data, m[1]));
        lastIdx = re.lastIndex;
      }
      if (lastIdx < raw.length) segments.push(raw.slice(lastIdx));
      return segments.join('').replace(/\{\{(?!=).*?\}\}/g, '').trim();
    }
    if (isRef(raw)) return await resolveRefAsync(this.data, raw);
    return raw.replace(/\{\{(?!=).*?\}\}/g, '').trim();
  }

  // ---- Render preview UI ----

  _renderUI() {
    this.el.innerHTML = '';
    const theme = PPT_THEMES[this.format.theme] || PPT_THEMES.business_blue;

    // Main area: thumbs + preview
    const main = document.createElement('div');
    main.className = 'ppt-main';

    // Thumbnails
    const thumbs = document.createElement('div');
    thumbs.className = 'ppt-thumbs';
    this.slides.forEach((slide, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'ppt-thumb' + (i === this.currentSlide ? ' active' : '');
      thumb.onclick = () => { this.currentSlide = i; this._renderUI(); };
      const inner = document.createElement('div');
      inner.className = 'ppt-thumb-inner';
      inner.style.background = slide.theme.bg;
      inner.innerHTML = this._renderSlideHTML(slide, true);
      thumb.appendChild(inner);
      const num = document.createElement('span');
      num.className = 'ppt-thumb-num';
      num.textContent = i + 1;
      thumb.appendChild(num);
      thumbs.appendChild(thumb);
    });
    main.appendChild(thumbs);

    // Preview
    const previewWrap = document.createElement('div');
    previewWrap.className = 'ppt-preview-wrap';
    const frame = document.createElement('div');
    frame.className = 'ppt-slide-frame';
    const slideEl = document.createElement('div');
    slideEl.className = 'ppt-slide';
    if (this.slides[this.currentSlide]) {
      const s = this.slides[this.currentSlide];
      slideEl.style.background = s.theme.bg;
      slideEl.style.color = s.theme.text;
      slideEl.innerHTML = this._renderSlideHTML(s, false);
      if (s.type === 'cover') slideEl.classList.add('slide-cover');
      else if (s.type === 'ending') slideEl.classList.add('slide-ending');
      else if (s.layout === 'title_only') slideEl.classList.add('slide-title-only');
    }
    frame.appendChild(slideEl);
    previewWrap.appendChild(frame);

    // Navigation
    const nav = document.createElement('div');
    nav.className = 'ppt-nav';
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '◀ 上页';
    prevBtn.onclick = () => { if (this.currentSlide > 0) { this.currentSlide--; this._renderUI(); } };
    nav.appendChild(prevBtn);
    const info = document.createElement('span');
    info.className = 'ppt-page-info';
    info.textContent = (this.currentSlide + 1) + ' / ' + this.slides.length;
    nav.appendChild(info);
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '下页 ▶';
    nextBtn.onclick = () => { if (this.currentSlide < this.slides.length - 1) { this.currentSlide++; this._renderUI(); } };
    nav.appendChild(nextBtn);
    const fsBtn = document.createElement('button');
    fsBtn.className = 'ppt-fullscreen-btn';
    fsBtn.textContent = '▣ 全屏';
    fsBtn.onclick = () => { frame.requestFullscreen && frame.requestFullscreen(); };
    nav.appendChild(fsBtn);
    previewWrap.appendChild(nav);
    main.appendChild(previewWrap);
    this.el.appendChild(main);

    // Controls
    this._renderControls();
  }

  _renderSlideHTML(slide, isThumbnail) {
    const t = slide.theme;
    const scale = isThumbnail ? 'font-size:4px' : '';
    if (slide.type === 'cover') {
      return `<div class="slide-title" style="color:${t.accent};${scale}">${this._esc(slide.title)}</div>
              <div class="slide-subtitle" style="${scale}">${this._esc(slide.subtitle)}</div>`;
    }
    if (slide.type === 'ending') {
      return `<div class="slide-title" style="color:${t.accent};${scale}">谢谢</div>`;
    }

    let html = `<div class="slide-title" style="color:${t.accent};border-bottom:2px solid ${t.accent};padding-bottom:8px;${scale}">${this._esc(slide.title)}</div>`;

    const layout = slide.layout || 'one_col';
    const bulletHTML = slide.bullets.map(b => {
      const opacity = b.isBody ? 'opacity:.6;font-style:italic' : '';
      return `<div class="slide-bullet" data-level="${b.level}" style="${opacity};${scale}">${this._esc(b.text)}</div>`;
    }).join('');

    const hasImg = slide.images && slide.images.length > 0;
    const imgHTML = hasImg ? slide.images.map(src => {
      const resolved = (typeof resolveMediaSrc === 'function') ? resolveMediaSrc(src) : src;
      return `<img class="slide-img" src="${this._esc(resolved)}" />`;
    }).join('') : '';

    if (layout === 'title_only') {
      return html;
    } else if (layout === 'two_col_left' && hasImg) {
      html += `<div class="slide-body"><div class="slide-col">${bulletHTML}</div><div class="slide-col">${imgHTML}</div></div>`;
    } else if (layout === 'two_col_right' && hasImg) {
      html += `<div class="slide-body"><div class="slide-col">${imgHTML}</div><div class="slide-col">${bulletHTML}</div></div>`;
    } else if (layout === 'three_col') {
      const third = Math.ceil(slide.bullets.length / 3);
      const cols = [slide.bullets.slice(0, third), slide.bullets.slice(third, third * 2), slide.bullets.slice(third * 2)];
      html += '<div class="slide-body">';
      for (const col of cols) {
        html += '<div class="slide-col">' + col.map(b =>
          `<div class="slide-bullet" data-level="${b.level}" style="${scale}">${this._esc(b.text)}</div>`
        ).join('') + '</div>';
      }
      html += '</div>';
    } else if (layout === 'image_full' && hasImg) {
      const imgSrc0 = (typeof resolveMediaSrc === 'function') ? resolveMediaSrc(slide.images[0]) : slide.images[0];
      html = `<img class="slide-img" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.3" src="${this._esc(imgSrc0)}" />
              <div style="position:relative;z-index:1">${html}<div class="slide-body"><div class="slide-col">${bulletHTML}</div></div></div>`;
    } else {
      // one_col default
      html += `<div class="slide-body"><div class="slide-col">${bulletHTML}</div>`;
      if (hasImg) html += `<div class="slide-col" style="max-width:40%">${imgHTML}</div>`;
      html += '</div>';
    }
    return html;
  }

  _esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  // ---- Controls UI ----

  _renderControls() {
    const ctrl = document.createElement('div');
    ctrl.className = 'ppt-controls';
    const g = this.format.global || {};

    // Theme
    ctrl.appendChild(this._makeCtrl('主题', this._makeSelect(
      Object.entries(PPT_THEMES).map(([k, v]) => ({ value: k, label: v.name })),
      this.format.theme,
      v => { this.format.theme = v; this._onFormatChange(); }
    )));
    ctrl.appendChild(this._sep());

    // Slide per
    ctrl.appendChild(this._makeCtrl('分页', this._makeSelect(
      [{ value: 't1', label: '按 t1' }, { value: 't2', label: '按 t2' }],
      g.slide_per || 't1',
      v => { this.format.global.slide_per = v; this._onFormatChange(); }
    )));

    // Depth
    ctrl.appendChild(this._makeCtrl('深度', this._makeNumberInput(
      g.content_depth || 4, 1, 8,
      v => { this.format.global.content_depth = v; this._onFormatChange(); }
    )));

    // Layout
    ctrl.appendChild(this._makeCtrl('版式', this._makeSelect(
      Object.entries(PPT_LAYOUTS).map(([k, v]) => ({ value: k, label: v })),
      g.layout || 'one_col',
      v => { this.format.global.layout = v; this._onFormatChange(); }
    )));
    ctrl.appendChild(this._sep());

    // Cover / ending checkboxes
    ctrl.appendChild(this._makeCtrl('封面', this._makeCheckbox(g.cover !== false, v => { this.format.global.cover = v; this._onFormatChange(); })));
    ctrl.appendChild(this._makeCtrl('结尾', this._makeCheckbox(g.ending !== false, v => { this.format.global.ending = v; this._onFormatChange(); })));
    ctrl.appendChild(this._sep());

    // Current slide override
    const curSlide = this.slides[this.currentSlide];
    if (curSlide && curSlide.nodePath) {
      const path = curSlide.nodePath;
      const ov = (this.format.slides || {})[path] || {};
      const ovRow = document.createElement('div');
      ovRow.className = 'ppt-override-row';
      ovRow.appendChild(this._makeCtrl('当前页深度', this._makeNumberInput(
        ov.depth || '', 1, 8,
        v => { this._setOverride(path, 'depth', v || undefined); }
      )));
      ovRow.appendChild(this._makeCtrl('版式', this._makeSelect(
        [{ value: '', label: '默认' }].concat(Object.entries(PPT_LAYOUTS).map(([k, v]) => ({ value: k, label: v }))),
        ov.layout || '',
        v => { this._setOverride(path, 'layout', v || undefined); }
      )));
      ctrl.appendChild(ovRow);
    }
    ctrl.appendChild(this._sep());

    // Export button
    const expBtn = document.createElement('button');
    expBtn.className = 'ppt-export-btn';
    expBtn.textContent = '导出 PPTX';
    expBtn.onclick = () => this.exportPptx();
    ctrl.appendChild(expBtn);

    this.el.appendChild(ctrl);
  }

  _makeCtrl(label, input) {
    const g = document.createElement('span');
    g.className = 'ppt-ctrl-group';
    const l = document.createElement('label');
    l.textContent = label + ':';
    g.appendChild(l);
    g.appendChild(input);
    return g;
  }

  _makeSelect(options, value, onChange) {
    const sel = document.createElement('select');
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === value) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => onChange(sel.value);
    return sel;
  }

  _makeNumberInput(value, min, max, onChange) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = min;
    inp.max = max;
    inp.value = value;
    inp.onchange = () => onChange(parseInt(inp.value) || undefined);
    return inp;
  }

  _makeCheckbox(checked, onChange) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.onchange = () => onChange(cb.checked);
    return cb;
  }

  _sep() { const s = document.createElement('span'); s.className = 'ppt-ctrl-sep'; return s; }

  _setOverride(path, key, value) {
    if (!this.format.slides) this.format.slides = {};
    if (!this.format.slides[path]) this.format.slides[path] = {};
    if (value === undefined) delete this.format.slides[path][key];
    else this.format.slides[path][key] = value;
    if (Object.keys(this.format.slides[path]).length === 0) delete this.format.slides[path];
    this._onFormatChange();
  }

  _onFormatChange() {
    if (typeof app !== 'undefined') app.markDirty();
    this.render(this.data).catch(e => console.error('PPT render error:', e));
  }

  // ---- Export to PPTX ----

  exportPptx() {
    if (typeof PptxGenJS === 'undefined') { toast('PptxGenJS 未加载'); return; }
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches (16:9)
    const theme = PPT_THEMES[this.format.theme] || PPT_THEMES.business_blue;

    for (const slide of this.slides) {
      const s = pptx.addSlide();
      const t = slide.theme || theme;
      s.background = { color: t.bg.replace('#', '') };

      if (slide.type === 'cover') {
        s.addText(slide.title, { x: 1, y: 2.5, w: 11, h: 1.5, fontSize: 36, bold: true, color: t.accent.replace('#', ''), align: 'center' });
        if (slide.subtitle) s.addText(slide.subtitle, { x: 2, y: 4.2, w: 9, h: 0.8, fontSize: 18, color: t.sub.replace('#', ''), align: 'center' });
      } else if (slide.type === 'ending') {
        s.addText('谢谢', { x: 1, y: 2.5, w: 11, h: 2, fontSize: 44, bold: true, color: t.accent.replace('#', ''), align: 'center' });
      } else {
        // Title
        s.addText(slide.title, { x: 0.6, y: 0.3, w: 12, h: 0.8, fontSize: 24, bold: true, color: t.accent.replace('#', '') });
        // Accent line
        s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.1, w: 12, h: 0.03, fill: { color: t.accent.replace('#', '') } });

        // Content based on layout
        const layout = slide.layout || 'one_col';
        const bulletTexts = (slide.bullets || []).map(b => ({
          text: '  '.repeat(b.level) + (b.level === 0 ? '• ' : b.level === 1 ? '◦ ' : '▪ ') + b.text,
          options: { fontSize: 14 - b.level, color: t.text.replace('#', ''), breakLine: true, italic: !!b.isBody }
        }));

        if (layout === 'title_only') {
          // nothing more
        } else if ((layout === 'two_col_left' || layout === 'two_col_right') && slide.images && slide.images.length > 0) {
          const textX = layout === 'two_col_left' ? 0.6 : 7;
          const imgX = layout === 'two_col_left' ? 7 : 0.6;
          s.addText(bulletTexts, { x: textX, y: 1.4, w: 5.8, h: 5.5, valign: 'top' });
          // Note: local images need to be base64 or path — skip external for now
          try {
            if (slide.images[0] && slide.images[0].startsWith('data:')) {
              s.addImage({ data: slide.images[0], x: imgX, y: 1.4, w: 5.5, h: 5 });
            }
          } catch (e) {}
        } else if (layout === 'three_col') {
          const third = Math.ceil(bulletTexts.length / 3);
          const cols = [bulletTexts.slice(0, third), bulletTexts.slice(third, third * 2), bulletTexts.slice(third * 2)];
          for (let i = 0; i < 3; i++) {
            s.addText(cols[i], { x: 0.6 + i * 4.1, y: 1.4, w: 3.8, h: 5.5, valign: 'top' });
          }
        } else {
          // one_col
          const textW = (slide.images && slide.images.length > 0) ? 7.5 : 12;
          s.addText(bulletTexts, { x: 0.6, y: 1.4, w: textW, h: 5.5, valign: 'top' });
          if (slide.images && slide.images.length > 0) {
            try {
              if (slide.images[0] && slide.images[0].startsWith('data:')) {
                s.addImage({ data: slide.images[0], x: 8.3, y: 1.4, w: 4.5, h: 5 });
              }
            } catch (e) {}
          }
        }

        // Speaker notes
        if (slide.notes) s.addNotes(slide.notes);
      }
    }

    const title = (this.data && this.data.meta && this.data.meta.title) || '演示文稿';
    pptx.writeFile({ fileName: title + '.pptx' }).then(() => {
      toast('已导出: ' + title + '.pptx');
    }).catch(e => {
      toast('导出失败: ' + e.message);
    });
  }
}
