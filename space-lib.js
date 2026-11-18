// ================================================================
//  个人空间文件管理 — 标签元数据与回收站
//
//  每个账号空间内：
//    .udd-meta.json   标签定义 + 路径→标签映射（隐藏文件）
//    .trash/          回收站（隐藏目录，index.json 记录原始路径与标签）
//
//  这些文件/目录对普通文件 API 不可见，也不能被用户读写。
// ================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const META_NAME = '.udd-meta.json';
const TRASH_NAME = '.trash';
const TRASH_INDEX = 'index.json';

function normalizeRel(rel) {
  return String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function relOf(root, abs) {
  return normalizeRel(path.relative(root, abs));
}

function absOf(root, rel) {
  const r = normalizeRel(rel);
  return r ? path.join(root, ...r.split('/')) : root;
}

function isReservedRel(rel) {
  const r = normalizeRel(rel);
  return r === META_NAME || r === TRASH_NAME || r.startsWith(TRASH_NAME + '/');
}

function hasParentSegment(rel) {
  return normalizeRel(rel).split('/').includes('..');
}

function readMeta(root) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, META_NAME), 'utf8'));
    return {
      version: 1,
      tags: j.tags || {},
      items: j.items || {},
    };
  } catch (e) {
    return { version: 1, tags: {}, items: {} };
  }
}

function writeMeta(root, meta) {
  const p = path.join(root, META_NAME);
  const tmp = p + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({
    version: 1,
    tags: meta.tags || {},
    items: meta.items || {},
  }, null, 2), { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch (e) { /* ignore */ }
  fs.renameSync(tmp, p);
}

function assignTags(meta, rels, add, remove) {
  const addIds = Array.isArray(add) ? add : [];
  const removeIds = new Set(Array.isArray(remove) ? remove : []);
  for (const raw of rels) {
    const rel = normalizeRel(raw);
    if (!rel) continue;
    const set = new Set(meta.items[rel] || []);
    for (const id of addIds) if (id) set.add(id);
    for (const id of removeIds) set.delete(id);
    if (set.size) meta.items[rel] = Array.from(set);
    else delete meta.items[rel];
  }
}

// 取出某个路径及其子路径的标签（删除/移入回收站时保存），并从 meta 中移除
function extractTags(meta, rawRel) {
  const rel = normalizeRel(rawRel);
  const out = {};
  if (!rel) return out;
  for (const key of Object.keys(meta.items)) {
    if (key === rel || key.startsWith(rel + '/')) {
      const sub = key === rel ? '' : key.slice(rel.length + 1);
      out[sub] = meta.items[key];
      delete meta.items[key];
    }
  }
  return out;
}

// 恢复标签：sub → 相对路径（'' 表示根项本身）
function applyExtractedTags(meta, rawRel, tagsMap) {
  const rel = normalizeRel(rawRel);
  if (!rel || !tagsMap) return;
  for (const sub of Object.keys(tagsMap)) {
    const target = sub ? rel + '/' + sub : rel;
    const set = new Set(meta.items[target] || []);
    for (const id of tagsMap[sub] || []) {
      if (meta.tags[id]) set.add(id);
    }
    if (set.size) meta.items[target] = Array.from(set);
  }
}

function remapTags(meta, fromRaw, toRaw) {
  const from = normalizeRel(fromRaw);
  const to = normalizeRel(toRaw);
  if (!from || !to || from === to) return;
  const moves = [];
  for (const key of Object.keys(meta.items)) {
    if (key === from || key.startsWith(from + '/')) {
      moves.push([key, to + key.slice(from.length), meta.items[key]]);
    }
  }
  for (const [oldKey] of moves) delete meta.items[oldKey];
  for (const [, newKey, tags] of moves) {
    const set = new Set(meta.items[newKey] || []);
    for (const id of tags) set.add(id);
    if (set.size) meta.items[newKey] = Array.from(set);
  }
}

function copyTags(meta, fromRaw, toRaw) {
  const from = normalizeRel(fromRaw);
  const to = normalizeRel(toRaw);
  if (!from || !to) return;
  for (const key of Object.keys(meta.items)) {
    if (key === from || key.startsWith(from + '/')) {
      const target = to + key.slice(from.length);
      meta.items[target] = Array.from(new Set(meta.items[target] || meta.items[key]));
    }
  }
}

// 只保留最上层路径，避免同时删除父目录和子文件时子路径已不存在
function filterTopLevel(rels) {
  const list = Array.from(new Set((rels || []).map(normalizeRel).filter(Boolean)))
    .sort((a, b) => a.length - b.length);
  const out = [];
  for (const rel of list) {
    if (isReservedRel(rel)) continue;
    if (out.some(p => rel === p || rel.startsWith(p + '/'))) continue;
    out.push(rel);
  }
  return out;
}

function splitExt(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

// （目标目录中）生成不冲突的名称；suffix 默认“副本”
function uniqueNameInDir(dirAbs, name, suffix) {
  const sfx = suffix || ' 副本';
  const { base, ext } = splitExt(name);
  let candidate = base + sfx + ext;
  let n = 2;
  while (fs.existsSync(path.join(dirAbs, candidate))) {
    candidate = base + sfx + ' ' + n + ext;
    n += 1;
  }
  return candidate;
}

// ---------------- 回收站 ----------------

function trashRoot(root) {
  return path.join(root, TRASH_NAME);
}

function readTrashIndex(root) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(trashRoot(root), TRASH_INDEX), 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch (e) {
    return [];
  }
}

function writeTrashIndex(root, entries) {
  const dir = trashRoot(root);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, TRASH_INDEX);
  const tmp = p + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
}

function listTrash(root) {
  const entries = readTrashIndex(root).filter(e => {
    const tr = normalizeRel(e.trashRel);
    if (!tr.startsWith(TRASH_NAME + '/') || hasParentSegment(tr)) return false;
    try { return fs.existsSync(absOf(root, tr)); } catch (err) { return false; }
  });
  entries.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  return entries;
}

function trashPaths(root, meta, rels) {
  const list = filterTopLevel(rels);
  if (!list.length) return [];
  const batch = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
    + '-' + crypto.randomBytes(3).toString('hex');
  const batchDir = path.join(trashRoot(root), batch);
  fs.mkdirSync(batchDir, { recursive: true });

  const index = readTrashIndex(root);
  const created = [];
  for (const rel of list) {
    const abs = absOf(root, rel);
    let stat;
    try { stat = fs.statSync(abs); } catch (e) { continue; }
    const id = crypto.randomBytes(8).toString('hex');
    const dest = path.join(batchDir, id);
    fs.renameSync(abs, dest);
    const tags = extractTags(meta, rel);
    const entry = {
      id,
      name: path.basename(abs),
      originalRel: rel,
      trashRel: relOf(root, dest),
      type: stat.isDirectory() ? 'dir' : 'file',
      deletedAt: new Date().toISOString(),
      tags,
    };
    index.push(entry);
    created.push(entry);
  }
  writeTrashIndex(root, index);
  return created;
}

function restoreTrash(root, meta, ids) {
  const want = new Set(ids || []);
  const index = readTrashIndex(root);
  const restored = [];
  const keep = [];
  for (const entry of index) {
    if (!want.has(entry.id)) { keep.push(entry); continue; }
    const trashRel = normalizeRel(entry.trashRel);
    if (!trashRel.startsWith(TRASH_NAME + '/') || hasParentSegment(trashRel)) continue;
    const src = absOf(root, trashRel);
    if (!fs.existsSync(src)) continue;
    let targetRel = normalizeRel(entry.originalRel);
    if (!targetRel || isReservedRel(targetRel) || hasParentSegment(targetRel)) continue;
    let target = absOf(root, targetRel);
    if (fs.existsSync(target)) {
      const dir = path.dirname(target);
      const name = uniqueNameInDir(dir, path.basename(target), ' 恢复的副本');
      target = path.join(dir, name);
      targetRel = relOf(root, target);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(src, target);
    applyExtractedTags(meta, targetRel, entry.tags || {});
    restored.push({ id: entry.id, name: entry.name, restoredTo: targetRel });
  }
  writeTrashIndex(root, keep);
  // 清掉空批次目录
  try {
    const dir = trashRoot(root);
    for (const name of fs.readdirSync(dir)) {
      if (name === TRASH_INDEX) continue;
      const p = path.join(dir, name);
      try { if (fs.statSync(p).isDirectory() && fs.readdirSync(p).length === 0) fs.rmdirSync(p); } catch (e) {}
    }
  } catch (e) { /* ignore */ }
  return restored;
}

function emptyTrash(root) {
  fs.rmSync(trashRoot(root), { recursive: true, force: true });
}

module.exports = {
  META_NAME,
  TRASH_NAME,
  normalizeRel,
  relOf,
  absOf,
  isReservedRel,
  readMeta,
  writeMeta,
  assignTags,
  extractTags,
  applyExtractedTags,
  remapTags,
  copyTags,
  filterTopLevel,
  uniqueNameInDir,
  listTrash,
  trashPaths,
  restoreTrash,
  emptyTrash,
};
