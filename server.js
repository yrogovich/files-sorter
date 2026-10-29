#!/usr/bin/env node
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { loadRules, buildIndex } = require('./lib/rules');
const { scan, sortFiles, undoMoves } = require('./lib/sorter');
const { readJson, writeJson } = require('./lib/store');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const DIR = path.resolve(args.dir || process.env.SORT_DIR || path.join(os.homedir(), 'Downloads'));
const DATA = path.resolve(args.data || process.env.FILE_SORTER_HOME || path.join(os.homedir(), '.file-sorter'));
const PORT = Number(args.port || process.env.PORT || 4827);
const AUTO_INTERVAL_MS = 10_000;
const AUTO_MIN_AGE_MS = 10_000; // leave files alone while they may still be downloading

const HISTORY_FILE = path.join(DATA, 'history.json');
const CONFIG_FILE = path.join(DATA, 'config.json');
const index = buildIndex(loadRules(DATA));
const config = { auto: false, folders: true, ...readJson(CONFIG_FILE, {}) };

const pretty = (p) => (p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p);

// ---- history (for undo) ---------------------------------------------------
function pushHistory(moved, source) {
  if (!moved.length) return;
  const history = readJson(HISTORY_FILE, []);
  history.push({ time: Date.now(), source, moves: moved.map(({ name, folder, from, to }) => ({ name, folder, from, to })) });
  writeJson(HISTORY_FILE, history.slice(-20));
}

// A single lock keeps manual sorts, undo and the auto-sorter from interleaving.
let chain = Promise.resolve();
const locked = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
};

// ---- auto sorting ---------------------------------------------------------
let autoTimer = null;
function setAuto(enabled) {
  config.auto = enabled;
  writeJson(CONFIG_FILE, config);
  clearInterval(autoTimer);
  autoTimer = null;
  if (!enabled) return;
  autoTimer = setInterval(() => {
    locked(async () => {
      const ready = await scan(DIR, index, { minAgeMs: AUTO_MIN_AGE_MS, folders: config.folders });
      if (!ready.length) return;
      const { moved } = await sortFiles(DIR, index, ready.map((f) => f.name), { folders: config.folders });
      pushHistory(moved, 'auto');
      if (moved.length) console.log(`[auto] sorted ${moved.length} file(s)`);
    }).catch((err) => console.error('[auto]', err.message));
  }, AUTO_INTERVAL_MS);
  autoTimer.unref?.();
}

// ---- http -----------------------------------------------------------------
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new Error('Bad JSON')); }
    });
  });
}

// Only the page we serve may talk to the API (blocks DNS rebinding and cross-site POSTs).
function originOk(req) {
  const allowed = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  if (!allowed.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !allowed.has(origin.replace(/^https?:\/\//, ''))) return false;
  return true;
}

const routes = {
  'GET /api/scan': async () => {
    const files = await scan(DIR, index, { folders: config.folders });
    return { dir: pretty(DIR), files, auto: config.auto, folders: config.folders, canUndo: readJson(HISTORY_FILE, []).length > 0 };
  },
  'POST /api/sort': async (body) => locked(async () => {
    const { moved, failed } = await sortFiles(DIR, index, Array.isArray(body.names) ? body.names : undefined, { folders: config.folders });
    pushHistory(moved, 'manual');
    return { moved: moved.length, failed };
  }),
  'POST /api/undo': async () => locked(async () => {
    const history = readJson(HISTORY_FILE, []);
    const last = history.pop();
    if (!last) return { restored: 0 };
    const restored = await undoMoves(last.moves, last.moves.map((m) => m.folder));
    writeJson(HISTORY_FILE, history);
    return { restored };
  }),
  'POST /api/folders': async (body) => {
    config.folders = Boolean(body.enabled);
    writeJson(CONFIG_FILE, config);
    return { folders: config.folders };
  },
  'POST /api/auto': async (body) => {
    setAuto(Boolean(body.enabled));
    return { auto: config.auto };
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost').pathname;
  try {
    if (!originOk(req)) return send(res, 403, { error: 'Forbidden' });
    if (req.method === 'GET' && STATIC[url]) {
      const [file, type] = STATIC[url];
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', file)), type);
    }
    const route = routes[`${req.method} ${url}`];
    if (!route) return send(res, 404, { error: 'Not found' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    send(res, 200, await route(body));
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Downloads Sorter\n  folder: ${DIR}\n  open:   ${url}`);
  if (config.auto) setAuto(true);
  if (!args['no-open']) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    execFile(opener, process.platform === 'win32' ? ['/c', 'start', url] : [url], () => {});
  }
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is busy; pass --port <n>` : err.message);
  process.exit(1);
});

module.exports = { server };
