// ================================================================
//  UDD Data Utilities
//  Key/value compression, style field handling, range-style system,
//  tree structure helpers (getLevel, getSeq, isTNode, etc.)
// ================================================================

//  ESCAPE TABLE
// ================================================================
const ESCAPE_TABLE = {
  meta:"m",title:"tt",author:"au",created:"cr",modified:"md",version:"v",
  description:"desc",tags:"tgs",language:"lang",type_global:"tg",
  content:"c",body:"b",note:"nt",comment:"cmt",
  font:"f",font_size:"fs",color:"c1",bold:"bd",italic:"it",
  underline:"ul",underline_color:"ulc",strikethrough:"st",
  superscript:"sup",subscript:"sub",highlight:"hl",
  letter_spacing:"ls",text_shadow:"ts",text_outline:"to",
  small_caps:"sc",font_scale:"fsc",
  align:"al",vertical_align:"va",
  paragraph_before:"pb",paragraph_after:"pa",paragraph_line:"pl",
  paragraph_line_fixed:"plf",paragraph_first_indent:"pfi",
  indent_left:"il",indent_right:"ir",indent_hanging:"ih",
  text_direction:"td",word_wrap:"ww",keep_together:"kt",
  keep_with_next:"kwn",page_break_before:"pbb",widow_control:"wc",
  hide:"h",hide_t:"ht",hide_body:"hb",visible:"vis",
  locked:"loc",read_only:"ro",collapsed_default:"cd",
  numbering_style:"ns",numbering_format:"nf",numbering_start:"nst",list_style:"lst",
  no_number:"nn",restart_number:"rst",
  background_color:"bgc",background_opacity:"bgo",
  ref_color:"rfc",page_size:"ps",
  border:"bdr",border_style:"bdrs",border_color:"bdrc",
  border_width:"bdrw",border_radius:"bdrr",shadow:"shd",opacity:"op",rotation:"rot"
};
const REVERSE_ESCAPE = {};
for (const [k,v] of Object.entries(ESCAPE_TABLE)) REVERSE_ESCAPE[v] = k;

const STYLE_FIELDS = ['font','font_size','color','bold','italic','underline','strikethrough','background_color','text_align'];
const RANGEABLE_STYLE_FIELDS = new Set(['font','font_size','color','bold','italic','underline','strikethrough','background_color']);

function isRangeStyleValue(value) {
  return typeof value === 'string' && value.indexOf(';') !== -1;
}

function parseSimpleStyleValue(val) {
  if (typeof val !== 'string') return val;
  const num = Number(val);
  if (!Number.isNaN(num) && val.trim() !== '') return num;
  return val;
}

function resolveStyleBaseValue(value) {
  if (isRangeStyleValue(value)) {
    const descriptor = parseRangeStyleValue(value);
    return descriptor.base;
  }
  return value;
}

function parseRangeStyleValue(value) {
  if (!isRangeStyleValue(value)) {
    return { base: parseSimpleStyleValue(value), overrides: [] };
  }
  const parts = value.split(';');
  const base = parseSimpleStyleValue(parts.shift());
  const overrides = [];
  for (const part of parts) {
    if (!part) continue;
    const ranges = [];
    part.replace(/\((\d+),(\d+)\)/g, (_, s, e) => {
      const start = Math.max(0, Number(s) - 1);
      const end = Math.max(start, Number(e));
      ranges.push({ start, end });
      return '';
    });
    const val = parseSimpleStyleValue(part.replace(/\((\d+),(\d+)\)/g, '').trim());
    if (ranges.length === 0) continue;
    overrides.push({ value: val, ranges });
  }
  return { base, overrides };
}

function formatRangeStyleValue(descriptor) {
  if (!descriptor || descriptor.overrides.length === 0) return descriptor ? descriptor.base : undefined;
  const parts = [String(descriptor.base ?? '')];
  for (const entry of descriptor.overrides) {
    if (!entry.ranges || entry.ranges.length === 0) continue;
    let segment = String(entry.value ?? '');
    for (const range of entry.ranges) {
      const start = range.start + 1;
      const end = range.end;
      segment += `(${start},${end})`;
    }
    parts.push(segment);
  }
  return parts.join(';');
}

function createRangeStyleDescriptor(currentValue, baseFallback) {
  if (currentValue !== undefined && currentValue !== null) {
    return parseRangeStyleValue(currentValue);
  }
  return { base: baseFallback, overrides: [] };
}

function valuesEqual(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a) === String(b);
}

function clampRange(start, end, length) {
  const s = Math.max(0, Math.min(start, length));
  const e = Math.max(s, Math.min(end, length));
  return { start: s, end: e };
}

function subtractRange(range, start, end) {
  if (end <= range.start || start >= range.end) return [range];
  const result = [];
  if (start > range.start) result.push({ start: range.start, end: start });
  if (end < range.end) result.push({ start: end, end: range.end });
  return result;
}

function mergeRanges(ranges) {
  if (!ranges || ranges.length === 0) return [];
  ranges.sort((a, b) => a.start - b.start);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = ranges[i];
    if (cur.start <= prev.end) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      merged.push({ start: cur.start, end: cur.end });
    }
  }
  return merged;
}

function applyRangeStyleValue(currentValue, newValue, selection, baseValue, textLength) {
  if (!selection || selection.end <= selection.start) return currentValue;
  const { start, end } = clampRange(selection.start, selection.end, textLength);
  if (end <= start) return currentValue;
  if (start === 0 && end === textLength) {
    return newValue;
  }
  const descriptor = createRangeStyleDescriptor(currentValue, baseValue);
  for (const entry of descriptor.overrides) {
    const next = [];
    for (const range of entry.ranges) {
      const pieces = subtractRange(range, start, end);
      next.push(...pieces);
    }
    entry.ranges = next;
  }
  descriptor.overrides = descriptor.overrides.filter(entry => entry.ranges.length > 0);
  if (!valuesEqual(newValue, descriptor.base)) {
    let targetEntry = descriptor.overrides.find(entry => valuesEqual(entry.value, newValue));
    if (!targetEntry) {
      targetEntry = { value: newValue, ranges: [] };
      descriptor.overrides.push(targetEntry);
    }
    targetEntry.ranges.push({ start, end });
    targetEntry.ranges = mergeRanges(targetEntry.ranges);
  }
  descriptor.overrides.sort((a, b) => {
    const aStart = a.ranges[0]?.start ?? 0;
    const bStart = b.ranges[0]?.start ?? 0;
    return aStart - bStart;
  });
  if (descriptor.overrides.length === 0) return descriptor.base;
  return formatRangeStyleValue(descriptor);
}

function getRangeStyleDescriptor(value, baseFallback) {
  const descriptor = createRangeStyleDescriptor(value, baseFallback);
  descriptor.overrides = descriptor.overrides.map(entry => ({
    value: entry.value,
    ranges: entry.ranges.map(r => ({ start: r.start, end: r.end }))
  }));
  return descriptor;
}

function getValueForRange(descriptor, start, end) {
  if (!descriptor) return undefined;
  let current;
  for (let i = start; i < end; i++) {
    const val = getValueAtIndex(descriptor, i);
    if (typeof current === 'undefined') current = val;
    else if (!valuesEqual(current, val)) return undefined;
  }
  return typeof current === 'undefined' ? descriptor.base : current;
}

function getValueAtIndex(descriptor, index) {
  if (!descriptor) return undefined;
  for (const entry of descriptor.overrides) {
    for (const range of entry.ranges) {
      if (index >= range.start && index < range.end) return entry.value;
    }
  }
  return descriptor.base;
}

function buildStyledRuns(node, fieldKey, text, baseStyle) {
  if (!node || !text || !text.length) return null;
  const isBody = fieldKey === 'body';
  const descriptors = {};
  let hasOverride = false;
  for (const field of RANGEABLE_STYLE_FIELDS) {
    const key = isBody ? `body.${field}` : field;
    const descriptor = getRangeStyleDescriptor(node[key], baseStyle[field]);
    descriptors[field] = descriptor;
    if (descriptor && descriptor.overrides && descriptor.overrides.length > 0) {
      hasOverride = true;
    }
  }
  if (!hasOverride) return null;
  const breakpoints = new Set([0, text.length]);
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor) continue;
    for (const entry of descriptor.overrides || []) {
      for (const range of entry.ranges) {
        breakpoints.add(range.start);
        breakpoints.add(range.end);
      }
    }
  }
  const sorted = Array.from(breakpoints).sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end <= start) continue;
    const slice = text.substring(start, end);
    const runStyle = {};
    for (const field of RANGEABLE_STYLE_FIELDS) {
      const descriptor = descriptors[field];
      if (!descriptor) continue;
      const val = getValueForRange(descriptor, start, end);
      if (typeof val !== 'undefined') runStyle[field] = val;
    }
    runs.push({ text: slice, style: runStyle });
  }
  return runs;
}

function renderStyledText(targetEl, text, node, fieldKey, baseStyle, applyFn) {
  if (!text) {
    targetEl.textContent = '';
    return;
  }
  const runs = buildStyledRuns(node, fieldKey, text, baseStyle);
  if (!runs) {
    targetEl.textContent = text;
    return;
  }
  targetEl.innerHTML = '';
  // 标记：本元素已被 per-character range 样式（body.bold / body.color / ...）
  // 切成多个 styled span。applyMdHtml 见此标记即跳过，避免 innerHTML 被 md 输出
  // 覆盖、把 per-char 样式抹掉。per-char 样式与 markdown 渲染在同一字段上互斥。
  targetEl.dataset.uddStyledRuns = '1';
  for (const run of runs) {
    const span = document.createElement('span');
    span.textContent = run.text;
    applyFn(span, Object.assign({}, baseStyle, run.style));
    targetEl.appendChild(span);
  }
}

function compressKey(key) {
  if (ESCAPE_TABLE[key]) return ESCAPE_TABLE[key];
  const dot = key.indexOf('.');
  if (dot > 0) {
    const pre = key.substring(0, dot), suf = key.substring(dot + 1);
    return (ESCAPE_TABLE[pre] || pre) + '.' + compressKey(suf);
  }
  return key;
}
function decompressKey(key) {
  if (REVERSE_ESCAPE[key]) return REVERSE_ESCAPE[key];
  const dot = key.indexOf('.');
  if (dot > 0) {
    const pre = key.substring(0, dot), suf = key.substring(dot + 1);
    return (REVERSE_ESCAPE[pre] || pre) + '.' + decompressKey(suf);
  }
  return key;
}
function compressData(obj) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return obj;
  const r = {};
  for (const [k,v] of Object.entries(obj)) r[compressKey(k)] = compressData(v);
  return r;
}
function decompressData(obj) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return obj;
  const r = {};
  for (const [k,v] of Object.entries(obj)) r[decompressKey(k)] = decompressData(v);
  return r;
}

// ================================================================
//  UTILITY FUNCTIONS
// ================================================================
function getLevel(key) { const m = key.match(/^t(\d+)-/); return m ? +m[1] : 0; }
function getSeq(key) { const m = key.match(/^t\d+-(\d+)$/); return m ? +m[1] : 0; }
function isTNode(key) { return /^t\d+-\d+$/.test(key); }
function getChildTKeys(node, level) {
  if (!node || typeof node !== 'object') return [];
  const re = new RegExp(`^t${level}-\\d+$`);
  return Object.keys(node).filter(k => re.test(k));
}
function getAllTKeys(node) {
  if (!node || typeof node !== 'object') return [];
  return Object.keys(node).filter(k => isTNode(k));
}
function getNodeByPath(data, path) {
  const parts = path.split('.');
  let n = data;
  for (const p of parts) { if (!n || typeof n !== 'object') return null; n = n[p]; }
  return n;
}

// 一次性扫一棵 data 树，建立 tNodeKey -> 完整路径 的反查表。
// 用于 findRefNode / findFullPath 把 O(N) 兜底 DFS 替换成 O(1) 属性查找。
// 用 Object.create(null) 而不是 Map：避免被混淆器的 stringArray 把 .get / .set 等
// 方法名编码成密文（曾观察到 IIFE 跨模块调用时方法名解码错位 → "X.get is not a function"）。
function buildPathIndex(data) {
  const map = Object.create(null);
  function walk(obj, prefix) {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (!isTNode(k)) continue;
      const full = prefix ? prefix + '.' + k : k;
      if (!(k in map)) map[k] = full;
      walk(obj[k], full);
    }
  }
  walk(data, '');
  return map;
}
function getParentAndKey(data, path) {
  const parts = path.split('.');
  const key = parts.pop();
  let parent = data;
  for (const p of parts) parent = parent[p];
  return { parent, key, parentPath: parts.join('.') };
}
function insertAfter(obj, afterKey, newKey, newValue) {
  const entries = Object.entries(obj);
  const temp = {};
  let found = false;
  for (const [k,v] of entries) {
    temp[k] = v;
    if (k === afterKey) { temp[newKey] = newValue; found = true; }
  }
  if (!found) temp[newKey] = newValue;
  for (const k of Object.keys(obj)) delete obj[k];
  Object.assign(obj, temp);
}
function insertBefore(obj, beforeKey, newKey, newValue) {
  const entries = Object.entries(obj);
  const temp = {};
  for (const [k,v] of entries) {
    if (k === beforeKey) temp[newKey] = newValue;
    temp[k] = v;
  }
  for (const k of Object.keys(obj)) delete obj[k];
  Object.assign(obj, temp);
}
function relevelNode(node, levelDiff) {
  const result = {};
  for (const [k,v] of Object.entries(node)) {
    if (isTNode(k)) {
      const nl = getLevel(k) + levelDiff;
      const ns = getSeq(k);
      result[`t${nl}-${ns}`] = relevelNode(v, levelDiff);
    } else {
      result[k] = v;
    }
  }
  return result;
}
function nextSeq(node, level) {
  const keys = getChildTKeys(node, level);
  return keys.reduce((mx, k) => Math.max(mx, getSeq(k)), 0) + 1;
}
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// ================================================================
// 节点编号：纯数据版（path 必须是 rootData 内的 t-key 路径，不含 __ref__）
// 支持 node.no_number（自身不编号且不占编号位，Word 行为）和
// node.restart_number（从该节点起在同级重新计数）。
// 返回字符串编号；命中 no_number 或异常时返回 null —— 调用方据此决定不渲染编号 span。
// ================================================================
function computeNumber(rootData, path, numStyle) {
  if (numStyle === 'none') return null;
  const parts = path.split('.');
  const nums = [];
  let obj = rootData;
  for (const part of parts) {
    const level = getLevel(part);
    if (level === 0) { obj = obj && obj[part]; continue; }
    if (!obj) return null;
    const siblings = getChildTKeys(obj, level);
    const partIdx = siblings.indexOf(part);
    if (partIdx < 0) return null;
    const partNode = obj[part];
    if (partNode && partNode.no_number) return null;
    // 找最近的 restart 锚点（含自己，往前扫）
    let anchor = 0;
    for (let i = partIdx; i >= 0; i--) {
      const sib = obj[siblings[i]];
      if (sib && sib.restart_number) { anchor = i; break; }
    }
    // 计数：从 anchor 起，跳过 no_number 的兄弟
    let seq = 0;
    for (let i = anchor; i <= partIdx; i++) {
      const sib = obj[siblings[i]];
      if (!sib || !sib.no_number) seq++;
    }
    nums.push(seq);
    obj = partNode;
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
  if (numStyle === 'bullet') {
    const bullets = ['●','○','■','▪'];
    const depth = nums.length - 1;
    return bullets[Math.min(depth, bullets.length - 1)];
  }
  if (numStyle === 'bullet-uniform') return '●';
  return nums.join('.');
}
