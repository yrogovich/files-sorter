'use strict';
const fsp = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const { classify, extOf, FALLBACK } = require('./rules');

const COURSES = 'Courses'; // folders whose content is mostly video
const WALK_LIMIT = 5000;
const WALK_DEPTH = 8;

const PARTIAL = new Set(['crdownload', 'download', 'part', 'partial', 'tmp', 'opdownload']);

function shouldSkip(name) {
  return name.startsWith('.') || PARTIAL.has(extOf(name));
}

// What a folder is, judged by the type that takes up the most space inside it.
async function inspectDir(full, index) {
  const bytes = new Map();
  let count = 0, newest = 0, visited = 0;
  async function walk(d, depth) {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (visited++ > WALK_LIMIT) return;
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < WALK_DEPTH) await walk(p, depth + 1); continue; }
      if (!e.isFile()) continue;
      let st;
      try { st = await fsp.stat(p); } catch { continue; }
      const kind = classify(e.name, index);
      bytes.set(kind, (bytes.get(kind) || 0) + st.size + 1);
      count++;
      newest = Math.max(newest, st.mtimeMs);
    }
  }
  await walk(full, 0);
  if (!count) return null;
  let top = FALLBACK, max = -1, total = 0;
  for (const [k, v] of bytes) { total += v; if (v > max) { max = v; top = k; } }
  return { folder: top === 'Videos' ? COURSES : top, size: total, count, newest };
}

// Loose files (and, optionally, whole folders) directly inside `dir`.
// Symlinks are never touched; destination folders themselves are skipped.
async function scan(dir, index, { minAgeMs = 0, folders = false } = {}) {
  const reserved = new Set([...index.values(), FALLBACK, COURSES].map((n) => n.toLowerCase()));
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (shouldSkip(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isFile()) {
      let st;
      try { st = await fsp.stat(full); } catch { continue; }
      if (minAgeMs > 0 && Date.now() - st.mtimeMs < minAgeMs) continue;
      out.push({ name: e.name, size: st.size, mtime: st.mtimeMs, ext: extOf(e.name), folder: classify(e.name, index), kind: 'file' });
    } else if (folders && e.isDirectory() && !reserved.has(e.name.toLowerCase()) && !index.has(extOf(e.name))) {
      const info = await inspectDir(full, index);
      if (!info) continue;
      if (minAgeMs > 0 && Date.now() - info.newest < minAgeMs) continue;
      out.push({ name: e.name, size: info.size, mtime: info.newest, ext: '', folder: info.folder, kind: 'dir', count: info.count });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function candidate(file, n) {
  if (n === 0) return file;
  const { dir, name, ext } = path.parse(file);
  return path.join(dir, `${name} (${n})${ext}`);
}

// Move without ever overwriting: hard-link fails with EEXIST if the target is taken.
async function safeMove(src, destWanted) {
  const isDir = (await fsp.lstat(src)).isDirectory();
  for (let n = 0; n < 1000; n++) {
    const dest = candidate(destWanted, n);
    if (isDir) {
      try { await fsp.lstat(dest); continue; } catch { /* free */ }
      await fsp.rename(src, dest);
      return dest;
    }
    try {
      await fsp.link(src, dest);
      await fsp.unlink(src);
      return dest;
    } catch (err) {
      if (err.code === 'EEXIST') continue;
      if (err.code === 'ENOENT') throw err;
      // Filesystem without hard links (or cross-device): copy, exclusive.
      try {
        await fsp.copyFile(src, dest, constants.COPYFILE_EXCL);
        await fsp.unlink(src);
        return dest;
      } catch (err2) {
        if (err2.code === 'EEXIST') continue;
        throw err2;
      }
    }
  }
  throw new Error('Too many name collisions');
}

// Sort the given file names (or everything loose, if names is omitted).
async function sortFiles(dir, index, names, { folders = false } = {}) {
  const loose = await scan(dir, index, { folders });
  const byName = new Map(loose.map((f) => [f.name, f]));
  const wanted = names ? names.filter((n) => typeof n === 'string' && n === path.basename(n)) : [...byName.keys()];
  const moved = [];
  const failed = [];
  for (const name of wanted) {
    const f = byName.get(name);
    if (!f) { failed.push({ name, error: 'File is gone or not sortable' }); continue; }
    try {
      await fsp.mkdir(path.join(dir, f.folder), { recursive: true });
      const to = await safeMove(path.join(dir, name), path.join(dir, f.folder, name));
      moved.push({ name, folder: f.folder, from: path.join(dir, name), to });
    } catch (err) {
      failed.push({ name, error: err.message });
    }
  }
  return { moved, failed };
}

// Put a batch of moves back where they came from.
async function undoMoves(moves, folders) {
  let restored = 0;
  for (const m of [...moves].reverse()) {
    try {
      await fsp.access(m.to);
      await safeMove(m.to, m.from);
      restored++;
    } catch { /* file was moved/deleted by the user since; leave it */ }
  }
  for (const f of new Set(folders)) {
    const dir = path.dirname(moves.find((m) => m.folder === f).to);
    try { await fsp.rmdir(dir); } catch { /* not empty: keep */ }
  }
  return restored;
}

module.exports = { scan, sortFiles, undoMoves, safeMove };
