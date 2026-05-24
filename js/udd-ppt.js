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
  two_col:       '双栏',
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
    // Plan D：PPT 是只读演示渲染，不接受 contentEditable 输入；
    //   _rendered 用于视图缓存命中（避免每次切到 PPT 都重新构建 slides 和媒体异步收集）
    this._rendered = false;
    this._inputDirty = false;
  }

  setFormat(fmt) { this.format = fmt || getDefaultPptFormat(); }
  getFormat() { return this.format; }

  // PPT 没有 contentEditable，syncAll 是 no-op。保留方法签名让 app.switchView 可以无差别调用。
  syncAll() { /* no-op: ppt is read-only render */ }

  async render(data) {
    this.data = data;
    this.slides = await this._buildSlides(data, this.format);
    if (this.currentSlide >= this.slides.length) this.currentSlide = Math.max(0, this.slides.length - 1);
    this._renderUI();
    this._rendered = true; // Plan D：视图缓存命中标记
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
      const bullets = [], mediaItems = [], orderedItems = [];
      // 与 _buildContentSlide 对齐：主节点 body 作为第一条 bullet
      if (node.body) {
        const bodyText = await this._resolveContent(node.body);
        const bodyDisplay = bodyText.replace(/\{\{(?!=).*?\}\}/g, '').trim();
        if (bodyDisplay) {
          const b = { text: bodyDisplay, level: 0, isBody: true, path, typeLevel: 1 };
          bullets.push(b);
          orderedItems.push({ kind: 'bullet', ...b });
        }
      }
      for (const itemKey of items) {
        const child = node[itemKey];
        if (!child) continue;
        const childPath = path + '.' + itemKey;
        await this._collectBullets(child, childPath, getLevel(itemKey), 0, depth - 2, bullets, mediaItems, orderedItems);
      }
      if (node.content) await this._collectMediaAsync(node.content, mediaItems, orderedItems);
      if (node.body) await this._collectMediaAsync(node.body, mediaItems, orderedItems);
      slides.push({
        type: 'content', title: await this._resolveContent(node.content),
        notes: node.body ? await this._resolveContent(node.body) : '',
        bullets, mediaItems, orderedItems, theme, layout, nodePath: path, titleLevel: 1, splitIndex: i
      });
    }
  }

  async _buildContentSlide(node, path, depth, layout, theme, baseLevel) {
    const bullets = [], mediaItems = [], orderedItems = [];
    // 主节点自身的 body 作为第一条 bullet（level 0）展示在标题与子节点之间。
    // 之前只把它塞进 notes（演讲者备注），与 _collectBullets 对子节点 body 的处理
    // 不对称——content 显示了 body 也应显示，这才是大纲/文档/演示三视图一致的行为。
    if (node.body) {
      const bodyText = await this._resolveContent(node.body);
      const bodyDisplay = bodyText.replace(/\{\{(?!=).*?\}\}/g, '').trim();
      if (bodyDisplay) {
        const b = { text: bodyDisplay, level: 0, isBody: true, path, typeLevel: baseLevel };
        bullets.push(b);
        orderedItems.push({ kind: 'bullet', ...b });
      }
    }
    const childKeys = getChildTKeys(node, baseLevel + 1);
    for (const ck of childKeys) {
      const child = node[ck];
      if (!child) continue;
      const childPath = path + '.' + ck;
      await this._collectBullets(child, childPath, getLevel(ck), 0, depth - baseLevel - 1, bullets, mediaItems, orderedItems);
    }
    // 主节点自己的 content / body 里的媒体（含 =ref 深入解析）
    if (node.content) await this._collectMediaAsync(node.content, mediaItems, orderedItems);
    if (node.body) await this._collectMediaAsync(node.body, mediaItems, orderedItems);
    // Title: for full node refs, use the source node's content as title
    let title = await this._resolveContent(node.content);
    let notes = node.body ? await this._resolveContent(node.body) : '';
    // If no own children but node content is a full node ref, expand it
    if (bullets.length === 0 && isRef(node.content || '') && isFullNodeRef(node.content || '')) {
      const sourceNode = await this._resolveFullNodeAsync(node.content);
      if (sourceNode) {
        title = await this._resolveContent(sourceNode.content);
        if (sourceNode.body) notes = await this._resolveContent(sourceNode.body);
        // 源节点自身 content/body 媒体也要收集
        if (sourceNode.content) await this._collectMediaAsync(sourceNode.content, mediaItems, orderedItems);
        if (sourceNode.body) await this._collectMediaAsync(sourceNode.body, mediaItems, orderedItems);
        const srcChildKeys = Object.keys(sourceNode).filter(k => isTNode(k)).sort();
        for (const ck of srcChildKeys) {
          const subPath = path + '.' + ck;
          await this._collectBullets(sourceNode[ck], subPath, getLevel(ck), 0, depth - baseLevel - 1, bullets, mediaItems, orderedItems);
        }
      }
    }
    return { type: 'content', title, notes, bullets, mediaItems, orderedItems, theme, layout, nodePath: path, titleLevel: baseLevel };
  }

  // 收集节点及其子节点的文本/媒体，按出现顺序产出三份视图：
  //   bullets      —— 纯文本条目（兼容旧布局 two_col_left/right、three_col、image_full 及 PPTX 导出）
  //   mediaItems   —— 纯媒体条目（同上）
  //   orderedItems —— 文本 + 媒体按出现顺序混排（新的 one_col / two_col 纯顺序布局使用）
  // nodePath / typeLevel：用于 PPTX 导出按节点级别（t1-*. / t2-*.）取 type_global 字体样式
  async _collectBullets(node, nodePath, typeLevel, level, maxDepth, bullets, mediaItems, orderedItems) {
    if (!node || typeof node !== 'object') return;
    const raw = node.content || '';

    // Full node ref: expand the source node in-place
    if (isRef(raw) && isFullNodeRef(raw)) {
      const sourceNode = await this._resolveFullNodeAsync(raw);
      if (sourceNode && typeof sourceNode === 'object') {
        await this._collectBullets(sourceNode, nodePath, typeLevel, level, maxDepth, bullets, mediaItems, orderedItems);
        return;
      }
    }

    const content = await this._resolveContent(raw);
    if (content) {
      const b = { text: content, level, path: nodePath, typeLevel };
      bullets.push(b);
      if (orderedItems) orderedItems.push({ kind: 'bullet', ...b });
    }
    await this._collectMediaAsync(raw, mediaItems, orderedItems);
    if (node.body) {
      const bodyText = await this._resolveContent(node.body);
      const bodyDisplay = bodyText.replace(/\{\{(?!=).*?\}\}/g, '').trim();
      if (bodyDisplay) {
        const b = { text: bodyDisplay, level, isBody: true, path: nodePath, typeLevel };
        bullets.push(b);
        if (orderedItems) orderedItems.push({ kind: 'bullet', ...b });
      }
      await this._collectMediaAsync(node.body, mediaItems, orderedItems);
    }
    if (level < maxDepth) {
      const childKeys = Object.keys(node).filter(k => isTNode(k)).sort();
      for (const ck of childKeys) {
        const childPath = nodePath + '.' + ck;
        await this._collectBullets(node[ck], childPath, getLevel(ck), level + 1, maxDepth, bullets, mediaItems, orderedItems);
      }
    }
  }

  // 公共 collector 的异步包装：深入 =ref / {{=ref}} 展开所有媒体
  // orderedItems 可选，若传入则同步往里 push {kind:'media', ...}
  // 保留 it.meta（含 image.caption / video.caption / audio.caption / image.width 等）以便 PPT 导出
  async _collectMediaAsync(text, mediaItems, orderedItems) {
    if (!text) return;
    if (typeof collectMediaItemsFromTextAsync === 'function') {
      const items = await collectMediaItemsFromTextAsync(this.data, text);
      for (const it of items) {
        if (it.type === 'table' && it.tableRef) {
          const rows = this._readTableRows(it.tableRef);
          if (rows && rows.length) {
            mediaItems.push({ type: 'table', rows });
            if (orderedItems) orderedItems.push({ kind: 'media', type: 'table', rows });
          }
        } else {
          const m = { type: it.type, src: it.src, meta: it.meta || null };
          mediaItems.push(m);
          if (orderedItems) orderedItems.push({ kind: 'media', ...m });
        }
      }
      return;
    }
    // 回退：旧行为
    this._collectMediaItems(text, mediaItems, orderedItems);
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

  // Collect images and tables in order of appearance into mediaItems array
  _collectMediaItems(text, mediaItems, orderedItems) {
    if (!text) return;
    const re = /\{\{(?!=)(.*?)\}\}/g;
    let m;
    const push = (obj) => {
      mediaItems.push(obj);
      if (orderedItems) orderedItems.push({ kind: 'media', ...obj });
    };
    while ((m = re.exec(text)) !== null) {
      const media = parseMediaTag(m[1]);
      if (media && media.image) {
        push({ type: 'image', src: media.image, meta: media });
      } else if (media && media.video) {
        push({ type: 'video', src: media.video, meta: media });
      } else if (media && media.audio) {
        push({ type: 'audio', src: media.audio, meta: media });
      } else if (typeof parseTableRef === 'function') {
        const tableRef = parseTableRef(m[1]);
        if (tableRef) {
          const rows = this._readTableRows(tableRef);
          if (rows && rows.length) push({ type: 'table', rows });
        }
      }
    }
  }

  _readTableRows(ref) {
    if (!app || !app.sheetView || !app.sheetView.workbook) return [];
    const ws = app.sheetView.workbook.Sheets[ref.sheetName];
    if (!ws) return [];
    const startR = parseInt(ref.startAddr.match(/\d+/)[0], 10) - 1;
    const startC = this._colIndex(ref.startAddr.match(/^[A-Z]+/)[0]);
    const endR = parseInt(ref.endAddr.match(/\d+/)[0], 10) - 1;
    const endC = this._colIndex(ref.endAddr.match(/^[A-Z]+/)[0]);
    const sheetRefs = (app.data && app.data._sheetRefs) ? app.data._sheetRefs : {};
    const rows = [];
    for (let r = startR; r <= endR; r++) {
      const row = [];
      for (let c = startC; c <= endC; c++) {
        const addr = this._colName(c) + (r + 1);
        const refKey = ref.sheetName + '!' + addr;
        if (sheetRefs[refKey] && typeof resolveRef === 'function') {
          row.push(resolveRef(app.data, sheetRefs[refKey]));
        } else {
          const cell = ws[addr];
          row.push(cell ? (cell.w || (cell.v !== undefined ? String(cell.v) : '')) : '');
        }
      }
      rows.push(row);
    }
    return rows;
  }

  _colIndex(name) {
    let idx = 0;
    for (let i = 0; i < name.length; i++) idx = idx * 26 + (name.charCodeAt(i) - 64);
    return idx - 1;
  }

  _colName(c) {
    let name = '';
    c++;
    while (c > 0) { c--; name = String.fromCharCode(65 + (c % 26)) + name; c = Math.floor(c / 26); }
    return name;
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
      this._bindMediaElements(inner);
      this._applyMdHtmlToSlide(inner);
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
      this._bindMediaElements(slideEl);
      this._applyMdHtmlToSlide(slideEl);
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

    const mediaItems = slide.mediaItems || [];
    const hasMedia = mediaItems.length > 0;

    // Build ordered media HTML (images and tables in appearance order)
    // 用 data-mediasrc 占位，innerHTML 后统一绑定候选 URL + onerror 回退
    const buildMediaHTML = (items) => items.map(m => {
      if (m.type === 'image') {
        return `<img class="slide-img" data-mediasrc="${this._esc(m.src)}" />`;
      } else if (m.type === 'video') {
        return `<video class="slide-video" controls style="max-width:100%;max-height:60vh" data-mediasrc="${this._esc(m.src)}"></video>`;
      } else if (m.type === 'audio') {
        return `<audio controls data-mediasrc="${this._esc(m.src)}"></audio>`;
      } else {
        return `<table class="slide-table">${(m.rows || []).map((row, ri) => `<tr>${row.map(cell => ri === 0 ? `<th>${this._esc(cell)}</th>` : `<td>${this._esc(cell)}</td>`).join('')}</tr>`).join('')}</table>`;
      }
    }).join('');

    // 把 orderedItems（混排的 bullet/media）渲染成 HTML
    // 单栏 / 双栏 都用这个，区别只是外层容器是单栏还是 column-count:2
    const buildOrderedHTML = (items) => (items || []).map(it => {
      if (it.kind === 'bullet') {
        const opacity = it.isBody ? 'opacity:.6;font-style:italic' : '';
        return `<div class="slide-bullet" data-level="${it.level}" style="${opacity};${scale}">${this._esc(it.text)}</div>`;
      }
      // media
      return buildMediaHTML([it]);
    }).join('');

    const mediaHTML = buildMediaHTML(mediaItems);
    const orderedHTML = buildOrderedHTML(slide.orderedItems);

    if (layout === 'title_only') {
      return html;
    } else if (layout === 'two_col') {
      // 新双栏：左栏从上往下排，溢出后继续到右栏。文本/媒体不区分，按出现顺序混排。
      // CSS columns 自然实现：column-count:2 + column-fill:auto + 固定高度容器
      // break-inside:avoid 防止单条媒体被纵向截断
      html += `<div class="slide-body slide-two-col">${orderedHTML}</div>`;
    } else if (layout === 'two_col_left') {
      html += `<div class="slide-body"><div class="slide-col">${bulletHTML}</div><div class="slide-col" style="overflow:auto">${mediaHTML}</div></div>`;
    } else if (layout === 'two_col_right') {
      html += `<div class="slide-body"><div class="slide-col" style="overflow:auto">${mediaHTML}</div><div class="slide-col">${bulletHTML}</div></div>`;
    } else if (layout === 'three_col') {
      const third = Math.ceil(slide.bullets.length / 3);
      const cols = [slide.bullets.slice(0, third), slide.bullets.slice(third, third * 2), slide.bullets.slice(third * 2)];
      html += '<div class="slide-body">';
      for (let ci = 0; ci < cols.length; ci++) {
        // Distribute media: assign each mediaItem to a column by round-robin index
        const colMedia = mediaItems.filter((_, mi) => mi % 3 === ci);
        html += `<div class="slide-col">${cols[ci].map(b =>
          `<div class="slide-bullet" data-level="${b.level}" style="${b.isBody ? 'opacity:.6;font-style:italic' : ''};${scale}">${this._esc(b.text)}</div>`
        ).join('')}${buildMediaHTML(colMedia)}</div>`;
      }
      html += '</div>';
    } else if (layout === 'image_full' && hasMedia && mediaItems[0].type === 'image') {
      html = `<img class="slide-img" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.3" data-mediasrc="${this._esc(mediaItems[0].src)}" />
              <div style="position:relative;z-index:1">${html}<div class="slide-body"><div class="slide-col">${bulletHTML}</div></div></div>`;
    } else {
      // one_col：纯顺序展示，不区分图文，从上到下混排
      html += `<div class="slide-body slide-one-col">${orderedHTML}</div>`;
    }
    return html;
  }

  // 把 innerHTML 里所有 [data-mediasrc] 的 <img>/<video>/<audio>
  // 通过公共 _bindMediaSrcWithFallback 绑定候选 URL + onerror 回退。
  _bindMediaElements(rootEl) {
    if (!rootEl || typeof _bindMediaSrcWithFallback !== 'function') return;
    rootEl.querySelectorAll('[data-mediasrc]').forEach(el => {
      const src = el.getAttribute('data-mediasrc');
      el.removeAttribute('data-mediasrc');
      _bindMediaSrcWithFallback(el, src);
    });
  }

  _applyMdHtmlToSlide(rootEl) {
    if (!rootEl || typeof applyMdHtml !== 'function' || typeof app === 'undefined' || !app.renderMode) return;
    rootEl.querySelectorAll('.slide-title, .slide-subtitle, .slide-bullet, .slide-table th, .slide-table td').forEach(el => {
      applyMdHtml(el, app, {inline:true});
    });
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

  // 通过 app.resolveMediaSrcCandidates 获取所有候选 URL，依次 fetch 直至成功，
  // 转成 base64 data URL（含 mime）。失败返回 null。
  async _fetchMediaAsBase64(src) {
    if (!src) return null;
    if (src.startsWith('data:')) return src;
    let candidates = [];
    if (typeof app !== 'undefined' && app.resolveMediaSrcCandidates) {
      candidates = app.resolveMediaSrcCandidates(src);
    } else {
      candidates = [src];
    }
    for (const url of candidates) {
      if (!url) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const blob = await res.blob();
        const dataUrl = await new Promise(resolve => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => resolve(null);
          fr.readAsDataURL(blob);
        });
        if (dataUrl) return dataUrl;
      } catch (e) { /* try next */ }
    }
    return null;
  }

  // 预读所有 slide 的图片 / 视频 / 音频为 base64 → 写到 m._dataUrl 上，
  // 之后 exportPptx 同步走 PptxGenJS API 即可。
  async _prefetchAllMedia() {
    const tasks = [];
    const visit = (m) => {
      if (!m || !m.src) return;
      if (m.type !== 'image' && m.type !== 'video' && m.type !== 'audio') return;
      if (m._dataUrl !== undefined) return; // 已处理
      tasks.push(this._fetchMediaAsBase64(m.src).then(d => { m._dataUrl = d || null; }));
    };
    for (const slide of this.slides) {
      (slide.mediaItems || []).forEach(visit);
      (slide.orderedItems || []).forEach(it => { if (it.kind === 'media') visit(it); });
    }
    await Promise.all(tasks);
  }

  // 由 type_global 的 t{level}-*.字段生成 PptxGenJS 文本 options。
  // 与 outline / document 的 applyFmtStyle 同源 —— 都从 buildNodeStyle 取数据。
  _bulletTextOptions(b, theme) {
    const styleObj = (typeof buildNodeStyle === 'function')
      ? buildNodeStyle(this.data, b.path || '', (typeof b.typeLevel === 'number') ? b.typeLevel : (b.level || 0), { isBody: !!b.isBody })
      : {};
    const opts = { breakLine: true };
    if (styleObj.font) opts.fontFace = styleObj.font;
    if (styleObj.font_size) opts.fontSize = +styleObj.font_size;
    else opts.fontSize = Math.max(8, 14 - (b.level || 0));
    if (styleObj.bold) opts.bold = true;
    if (styleObj.italic || b.isBody) opts.italic = true;
    if (styleObj.underline) opts.underline = { style: 'sng' };
    if (styleObj.strikethrough) opts.strike = 'sngStrike';
    // color: 节点 / 类型样式优先；缺省退回主题文字色
    const colorRgb = styleObj.color ? (typeof rgbToHex === 'function' ? rgbToHex(String(styleObj.color)).replace('#','') : null) : null;
    opts.color = colorRgb || theme.text.replace('#', '');
    if (styleObj.text_align) opts.align = styleObj.text_align;
    return opts;
  }

  // 标题行的字体 options：取标题节点（slide.nodePath / slide.titleLevel）的 type_global 样式
  _titleTextOptions(slide, theme) {
    const styleObj = (typeof buildNodeStyle === 'function')
      ? buildNodeStyle(this.data, slide.nodePath || '', (typeof slide.titleLevel === 'number') ? slide.titleLevel : 1, { isBody: false })
      : {};
    const opts = { bold: true, color: theme.accent.replace('#', '') };
    if (styleObj.font) opts.fontFace = styleObj.font;
    opts.fontSize = styleObj.font_size ? Math.max(18, +styleObj.font_size + 8) : 24;
    if (styleObj.italic) opts.italic = true;
    if (styleObj.underline) opts.underline = { style: 'sng' };
    return opts;
  }

  async exportPptx() {
    if (typeof PptxGenJS === 'undefined') { toast('PptxGenJS 未加载'); return; }
    toast('正在导出 PPT，预读媒体...');
    // 预读所有图片 / 视频 / 音频为 base64 —— 缺这一步视频会被静默丢弃
    await this._prefetchAllMedia();

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
        // Title — 字体由节点级别样式决定
        const titleOpts = this._titleTextOptions(slide, t);
        s.addText(slide.title, { x: 0.6, y: 0.3, w: 12, h: 0.8, ...titleOpts });
        // Accent line
        s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.1, w: 12, h: 0.03, fill: { color: t.accent.replace('#', '') } });

        // Content based on layout
        const layout = slide.layout || 'one_col';
        const mediaItems = slide.mediaItems || [];
        const hasMedia = mediaItems.length > 0;
        // 每条 bullet 的字体 options 由该节点的 type_global 级别样式决定
        const bulletTexts = (slide.bullets || []).map(b => ({
          text: '  '.repeat(b.level) + (b.level === 0 ? '• ' : b.level === 1 ? '◦ ' : '▪ ') + b.text,
          options: this._bulletTextOptions(b, t)
        }));

        // 单条媒体 + 标题（caption）的高度估算（inch）
        const MEDIA_H = { image: 2.5, video: 2.5, audio: 0.5, table: null };
        const CAPTION_H = 0.3;

        // Helper: add all mediaItems starting at given x,y,w bounds, returning advanced y.
        // 图片 / 视频走 base64（_dataUrl 在 _prefetchAllMedia 阶段写入）；
        // 音频也通过 addMedia 嵌入；找不到源文件就降级为 [视频]/[音频] 文本占位。
        const addMediaItems = (items, x, y, w) => {
          let curY = y;
          for (const m of items) {
            const meta = m.meta || {};
            // 统一无前缀键优先；老 type-prefixed 键 (image.caption 等) 兜底，兼容历史数据。
            const caption = (meta.caption !== undefined ? meta.caption : meta[m.type + '.caption']) || '';
            try {
              if (m.type === 'image') {
                if (m._dataUrl) {
                  s.addImage({ data: m._dataUrl, x, y: curY, w, h: MEDIA_H.image });
                  curY += MEDIA_H.image + 0.05;
                } else {
                  s.addText('[图片缺失]', { x, y: curY, w, h: 0.3, fontSize: 11, italic: true, color: '888888' });
                  curY += 0.35;
                }
              } else if (m.type === 'video') {
                if (m._dataUrl) {
                  s.addMedia({ type: 'video', data: m._dataUrl, x, y: curY, w, h: MEDIA_H.video });
                  curY += MEDIA_H.video + 0.05;
                } else {
                  s.addText('[视频缺失]', { x, y: curY, w, h: 0.3, fontSize: 11, italic: true, color: '888888' });
                  curY += 0.35;
                }
              } else if (m.type === 'audio') {
                if (m._dataUrl) {
                  s.addMedia({ type: 'audio', data: m._dataUrl, x, y: curY, w: Math.min(w, 4), h: MEDIA_H.audio });
                  curY += MEDIA_H.audio + 0.05;
                } else {
                  s.addText('[音频缺失]', { x, y: curY, w, h: 0.3, fontSize: 11, italic: true, color: '888888' });
                  curY += 0.35;
                }
              } else if (m.type === 'table' && m.rows && m.rows.length) {
                const tableRows = m.rows.map((row, ri) => row.map(cell => ({
                  text: cell,
                  options: ri === 0 ? { bold: true, fill: { color: 'F0F0F0' }, color: t.text.replace('#', '') } : { color: t.text.replace('#', '') }
                })));
                s.addTable(tableRows, { x, y: curY, w, fontSize: 11, border: { pt: 0.5, color: 'CCCCCC' } });
                curY += m.rows.length * 0.3 + 0.2;
              }
              // 媒体说明（image.caption / video.caption / audio.caption）
              if (caption && (m.type === 'image' || m.type === 'video' || m.type === 'audio')) {
                s.addText(caption, { x, y: curY, w, h: CAPTION_H, fontSize: 10, italic: true, color: '64748B', align: 'center' });
                curY += CAPTION_H + 0.05;
              }
            } catch (e) { /* 单个媒体失败不阻断其它 */ }
          }
          return curY;
        };

        if (layout === 'title_only') {
          // nothing more
        } else if (layout === 'two_col_left') {
          s.addText(bulletTexts, { x: 0.6, y: 1.4, w: 5.8, h: 5.5, valign: 'top' });
          if (hasMedia) addMediaItems(mediaItems, 7, 1.4, 5.5);
        } else if (layout === 'two_col_right') {
          if (hasMedia) addMediaItems(mediaItems, 0.6, 1.4, 5.5);
          s.addText(bulletTexts, { x: 7, y: 1.4, w: 5.8, h: 5.5, valign: 'top' });
        } else if (layout === 'three_col') {
          const third = Math.ceil(bulletTexts.length / 3);
          const cols = [bulletTexts.slice(0, third), bulletTexts.slice(third, third * 2), bulletTexts.slice(third * 2)];
          for (let i = 0; i < 3; i++) {
            const colX = 0.6 + i * 4.1;
            if (cols[i].length) s.addText(cols[i], { x: colX, y: 1.4, w: 3.8, h: 3.5, valign: 'top' });
            const colMedia = mediaItems.filter((_, mi) => mi % 3 === i);
            if (colMedia.length) addMediaItems(colMedia, colX, 5.0, 3.8);
          }
        } else if (layout === 'image_full' && hasMedia && mediaItems[0].type === 'image') {
          if (mediaItems[0]._dataUrl) {
            s.addImage({ data: mediaItems[0]._dataUrl, x: 0, y: 0, w: 13.33, h: 7.5 });
          }
          s.addText(bulletTexts, { x: 0.6, y: 1.4, w: 12, h: 5.5, valign: 'top' });
        } else if (layout === 'two_col') {
          const ord = slide.orderedItems || [];
          const half = Math.ceil(ord.length / 2);
          this._addOrderedColumn(s, ord.slice(0, half), 0.6, 1.4, 5.8, t, addMediaItems);
          this._addOrderedColumn(s, ord.slice(half),   7,   1.4, 5.8, t, addMediaItems);
        } else {
          // one_col
          this._addOrderedColumn(s, slide.orderedItems || [], 0.6, 1.4, 12, t, addMediaItems);
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

  // 把 orderedItems 顺序排版到 PPTX 的一个矩形区域里（用于 one_col / two_col 的每一栏）。
  // 文本块按 bullet 字体 options 集中累积后调一次 addText，遇到媒体再 flush 文本。
  // 媒体推进 curY 走 addMediaItems 的返回值（含 caption 高度），不再重复用估值表。
  _addOrderedColumn(slide, items, x, y, w, theme, addMediaItems) {
    if (!items || !items.length) return;
    let curY = y;
    let pendingText = [];
    const flushText = () => {
      if (!pendingText.length) return;
      const h = Math.min(7.5 - curY, pendingText.length * 0.3 + 0.2);
      slide.addText(pendingText, { x, y: curY, w, h, valign: 'top' });
      curY += h;
      pendingText = [];
    };
    for (const it of items) {
      if (it.kind === 'bullet') {
        pendingText.push({
          text: '  '.repeat(it.level) + (it.level === 0 ? '• ' : it.level === 1 ? '◦ ' : '▪ ') + it.text,
          options: this._bulletTextOptions(it, theme)
        });
      } else {
        flushText();
        const newY = addMediaItems([it], x, curY, w);
        if (typeof newY === 'number') curY = newY;
      }
    }
    flushText();
  }
}
