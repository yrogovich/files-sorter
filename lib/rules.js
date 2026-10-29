'use strict';
const fs = require('fs');
const path = require('path');

// Folder name -> extensions (lowercase, no dot). Override by putting a rules.json
// with the same shape in the data directory (~/.file-sorter/rules.json).
const DEFAULT_RULES = {
  Images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'tif', 'svg', 'avif', 'raw', 'cr2', 'nef', 'ico'],
  Videos: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv'],
  Audio: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'aiff', 'opus'],
  Documents: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'md', 'odt', 'pages', 'epub', 'mobi'],
  Spreadsheets: ['xls', 'xlsx', 'csv', 'tsv', 'numbers', 'ods'],
  Presentations: ['ppt', 'pptx', 'key', 'odp'],
  Archives: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'],
  Installers: ['dmg', 'pkg', 'exe', 'msi', 'apk', 'aab', 'ipa', 'deb', 'rpm', 'appimage'],
  Code: ['js', 'ts', 'jsx', 'tsx', 'py', 'json', 'html', 'css', 'sh', 'java', 'c', 'cpp', 'go', 'rs', 'rb', 'php', 'sql', 'yml', 'yaml', 'xml', 'ipynb'],
  Design: ['psd', 'ai', 'sketch', 'fig', 'xd', 'indd', 'eps'],
  Fonts: ['ttf', 'otf', 'woff', 'woff2'],
};
const FALLBACK = 'Other';

function validFolder(name) {
  return typeof name === 'string' && name && name === path.basename(name) && name !== '.' && name !== '..';
}

function loadRules(dataDir) {
  try {
    const custom = JSON.parse(fs.readFileSync(path.join(dataDir, 'rules.json'), 'utf8'));
    const out = {};
    for (const [folder, exts] of Object.entries(custom)) {
      if (validFolder(folder) && Array.isArray(exts)) out[folder] = exts.map((e) => String(e).toLowerCase().replace(/^\./, ''));
    }
    if (Object.keys(out).length) return out;
  } catch { /* no custom rules */ }
  return DEFAULT_RULES;
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function buildIndex(rules) {
  const map = new Map();
  for (const [folder, exts] of Object.entries(rules)) for (const e of exts) if (!map.has(e)) map.set(e, folder);
  return map;
}

function classify(name, index) {
  return index.get(extOf(name)) || FALLBACK;
}

module.exports = { DEFAULT_RULES, FALLBACK, loadRules, buildIndex, classify, extOf };
