(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const stage = $('#stage'), foldersEl = $('#folders'), cardsEl = $('#cards'), emptyEl = $('#empty');
  const sortBtn = $('#sort'), statusEl = $('#status'), undoBtn = $('#undo'), autoEl = $('#auto'), foldersEl2 = $('#folders-opt'), dirEl = $('#dir');

  const META = {
    Images: ['🖼️', 200], Videos: ['🎬', 340], Audio: ['🎵', 280], Documents: ['📄', 215],
    Spreadsheets: ['📊', 145], Presentations: ['📽️', 25], Archives: ['🗜️', 45], Courses: ['🎓', 5], 'Figma exports': ['✏️', 330], Installers: ['💿', 260],
    Code: ['💻', 170], Design: ['🎨', 315], Fonts: ['🔤', 70], Other: ['🗂️', 230],
  };
  const hashHue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const meta = (f) => META[f] || ['📁', hashHue(f)];

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CARD_W = 74, CARD_H = 92, MAX_CARDS = 120;
  const rand = (a, b) => a + Math.random() * (b - a);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  let state = 'loading'; // loading | empty | idle | sorting | done
  let files = [];
  let signature = '';
  let cards = [];
  let view = { folders: [], counts: {} };
  let folderPos = {}, folderEls = {};

  async function api(path, body) {
    const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
  }

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('err', isError);
  }

  // ---- layout ----------------------------------------------------------
  function layoutFolders(list) {
    const w = stage.clientWidth, h = stage.clientHeight;
    const cx = w / 2, cy = h / 2 - 8;
    const rx = Math.max(130, w / 2 - 80), ry = Math.max(110, h / 2 - 80);
    const pos = {};
    list.forEach((f, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / list.length;
      pos[f] = { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
    });
    return pos;
  }

  function drawFolders() {
    foldersEl.replaceChildren();
    folderEls = {};
    folderPos = layoutFolders(view.folders);
    view.folders.forEach((name, i) => {
      const [icon, hue] = meta(name);
      const el = document.createElement('div');
      el.className = 'folder';
      el.style.setProperty('--hue', hue);
      el.style.setProperty('--i', `${i * 45}ms`);
      el.style.transform = `translate(${folderPos[name].x - 55}px, ${folderPos[name].y - 42}px)`;
      el.innerHTML = '<div class="fd"><i class="back"></i><i class="front"></i></div><span class="fname"></span><b class="badge"></b>';
      el.querySelector('.front').textContent = icon;
      el.querySelector('.fname').textContent = name;
      const badge = el.querySelector('.badge');
      const n = view.counts[name] || 0;
      badge.textContent = n;
      badge.hidden = n === 0;
      foldersEl.append(el);
      folderEls[name] = el;
    });
  }

  // Group files into cards; past MAX_CARDS a card stands for several files.
  function buildCards(list) {
    const groups = new Map();
    for (const f of list) (groups.get(f.folder) || groups.set(f.folder, []).get(f.folder)).push(f);
    const out = [];
    for (const [folder, items] of groups) {
      const n = list.length <= MAX_CARDS ? items.length : Math.max(1, Math.round((MAX_CARDS * items.length) / list.length));
      const per = items.length / n;
      for (let i = 0; i < n; i++) {
        const chunk = items.slice(Math.round(i * per), Math.round((i + 1) * per));
        out.push({ folder, files: chunk, weight: chunk.length });
      }
    }
    return out.sort(() => Math.random() - 0.5);
  }

  const cardTransform = (x, y, rot, scale = 1) => `translate(${x - CARD_W / 2}px, ${y - CARD_H / 2}px) rotate(${rot}deg) scale(${scale})`;

  function makeCardEl(c) {
    const el = document.createElement('div');
    el.className = 'card';
    const f = c.files[0];
    el.innerHTML = '<div class="in"><i class="band"></i><b class="ext"></b><span class="nm"></span></div>';
    el.firstChild.style.setProperty('--hue', meta(c.folder)[1]);
    el.firstChild.style.setProperty('--d', `${-rand(0, 4)}s`);
    el.querySelector('.ext').textContent = c.weight > 1 ? `×${c.weight}` : f.kind === 'dir' ? 'DIR' : f.ext || 'file';
    el.querySelector('.nm').textContent = c.weight > 1 ? `${c.weight} items` : f.kind === 'dir' ? `${f.name}/` : f.name;
    el.title = c.weight > 1 ? `${c.weight} files → ${c.folder}` : `${f.name} → ${c.folder}`;
    return el;
  }

  function render(list, animate = true) {
    const prevPos = folderPos;
    emptyEl.hidden = true;
    cardsEl.replaceChildren();
    const folders = [...new Set(list.map((f) => f.folder))].sort();
    view = { folders, counts: {} };
    drawFolders();

    cards = buildCards(list);
    const w = stage.clientWidth, h = stage.clientHeight;
    const radius = Math.min(120, Math.min(w, h) * 0.15);
    cards.forEach((c, i) => {
      const a = rand(0, Math.PI * 2), r = radius * Math.sqrt(Math.random());
      c.x = w / 2 + Math.cos(a) * r;
      c.y = h / 2 - 8 + Math.sin(a) * r * 0.85;
      c.rot = rand(-38, 38);
      c.el = makeCardEl(c);
      c.el.style.transform = cardTransform(c.x, c.y, c.rot);
      cardsEl.append(c.el);
      if (animate && !reduce) {
        const from = prevPos[c.folder] || edgePoint(w, h);
        c.el.animate(
          [
            { transform: cardTransform(from.x, from.y, rand(-300, 300), 0.3), opacity: 0 },
            { transform: cardTransform(c.x, c.y, c.rot), opacity: 1 },
          ],
          { duration: 700, delay: Math.min(i * 14, 600), easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'backwards' },
        );
      }
    });

    sortBtn.style.top = `${h / 2 - 8 - 20}px`;
    sortBtn.textContent = `Sort ${plural(list.length, 'file')}`;
    sortBtn.classList.remove('fade');
    sortBtn.hidden = false;
    stage.classList.remove('busy');
    setStatus(`${plural(list.length, 'loose file')} → ${plural(folders.length, 'folder')}. Click the pile to sort.`);
  }

  function edgePoint(w, h) {
    const a = rand(0, Math.PI * 2);
    return { x: w / 2 + Math.cos(a) * w, y: h / 2 + Math.sin(a) * h };
  }

  function renderEmpty() {
    cardsEl.replaceChildren();
    foldersEl.replaceChildren();
    cards = [];
    view = { folders: [], counts: {} };
    emptyEl.hidden = false;
    sortBtn.hidden = true;
    stage.classList.remove('busy');
    setStatus('Downloads is already tidy.');
  }

  // ---- the fun part ------------------------------------------------------
  function fly(c, delay) {
    const to = folderPos[c.folder];
    const dx = to.x - c.x, dy = to.y - c.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const arc = (Math.random() < 0.5 ? -1 : 1) * Math.min(150, dist * 0.35);
    const mx = c.x + dx / 2 + (-dy / dist) * arc;
    const my = c.y + dy / 2 + (dx / dist) * arc;
    const spin = dx > 0 ? 1 : -1;
    const anim = c.el.animate(
      [
        { transform: cardTransform(c.x, c.y, c.rot, 1), opacity: 1, offset: 0 },
        { transform: cardTransform(mx, my, c.rot + spin * 180, 1.12), opacity: 1, offset: 0.5 },
        { transform: cardTransform(to.x, to.y - 6, c.rot + spin * 380, 0.16), opacity: 0.15, offset: 1 },
      ],
      { duration: reduce ? 150 : rand(850, 1100), delay: reduce ? 0 : delay, easing: 'cubic-bezier(.5,.05,.35,1)', fill: 'forwards' },
    );
    return anim.finished.then(() => {
      c.el.remove();
      arrive(c.folder, c.weight);
    });
  }

  function arrive(folder, weight) {
    const el = folderEls[folder];
    if (!el) return;
    const n = (view.counts[folder] = (view.counts[folder] || 0) + weight);
    const badge = el.querySelector('.badge');
    badge.hidden = false;
    badge.textContent = n;
    if (reduce) return;
    el.querySelector('.fd').animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.14) translateY(-3px)' }, { transform: 'scale(1)' }],
      { duration: 320, easing: 'ease-out' },
    );
    el.querySelector('.front').animate(
      [{ transform: 'perspective(260px) rotateX(0)' }, { transform: 'perspective(260px) rotateX(-30deg)' }, { transform: 'perspective(260px) rotateX(0)' }],
      { duration: 380, easing: 'ease-out' },
    );
    badge.animate([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.3,1.5,.5,1)' });
  }

  function celebrate() {
    if (reduce) return;
    Object.values(folderEls).forEach((el, i) => {
      el.querySelector('.fd').animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-14px)' }, { transform: 'translateY(0)' }],
        { duration: 500, delay: i * 70, easing: 'cubic-bezier(.3,1.4,.5,1)' },
      );
    });
  }

  async function doSort() {
    if (state !== 'idle' || !cards.length) return;
    state = 'sorting';
    stage.classList.add('busy');
    sortBtn.classList.add('fade');
    setStatus('Sorting…');
    const total = files.length;
    const request = api('/api/sort', { names: files.map((f) => f.name) }).then((r) => ({ r }), (e) => ({ e }));
    const stagger = Math.min(45, 1500 / cards.length);
    await Promise.all(cards.map((c, i) => fly(c, i * stagger)));
    const { r, e } = await request;
    if (e) {
      state = 'idle';
      setStatus(`Sorting failed: ${e.message}`, true);
      await refresh(true);
      return;
    }
    state = 'done';
    sortBtn.hidden = true;
    celebrate();
    const failed = r.failed.length;
    const folders = view.folders.length;
    setStatus(failed
      ? `Sorted ${r.moved} of ${total} files. ${plural(failed, 'file')} could not be moved.`
      : `✓ Sorted ${plural(r.moved, 'file')} into ${plural(folders, 'folder')}.`, failed > 0);
    undoBtn.hidden = false;
    signature = '';
    setTimeout(() => refresh(), 1200);
  }

  async function undo() {
    if (state === 'sorting') return;
    undoBtn.disabled = true;
    try {
      const { restored } = await api('/api/undo', {});
      undoBtn.hidden = true;
      state = 'loading';
      await refresh(true);
      setStatus(restored ? `Put ${plural(restored, 'file')} back.` : 'Nothing to undo.');
    } catch (err) {
      setStatus(`Undo failed: ${err.message}`, true);
    } finally {
      undoBtn.disabled = false;
    }
  }

  // ---- data --------------------------------------------------------------
  async function refresh(force = false) {
    if (state === 'sorting') return;
    let data;
    try {
      data = await api('/api/scan');
    } catch (err) {
      setStatus(`Cannot read folder: ${err.message}`, true);
      return;
    }
    dirEl.textContent = data.dir;
    autoEl.checked = data.auto;
    foldersEl2.checked = data.folders;
    if (!data.canUndo) undoBtn.hidden = true;
    else if (state === 'done' || force) undoBtn.hidden = false;
    const sig = data.files.map((f) => `${f.name}:${f.size}`).join('|');
    if (!force && sig === signature) return;
    signature = sig;
    files = data.files;
    if (files.length) {
      state = 'idle';
      render(files);
    } else if (state !== 'done') {
      state = 'empty';
      renderEmpty();
    }
  }

  // ---- events --------------------------------------------------------------
  cardsEl.addEventListener('click', doSort);
  sortBtn.addEventListener('click', doSort);
  undoBtn.addEventListener('click', undo);
  $('#rescan').addEventListener('click', () => refresh(true));
  autoEl.addEventListener('change', async () => {
    try {
      await api('/api/auto', { enabled: autoEl.checked });
      setStatus(autoEl.checked ? 'Auto-sort on: new downloads get filed within seconds.' : 'Auto-sort off.');
    } catch (err) {
      autoEl.checked = !autoEl.checked;
      setStatus(err.message, true);
    }
  });

  foldersEl2.addEventListener('change', async () => {
    try {
      await api('/api/folders', { enabled: foldersEl2.checked });
      await refresh(true);
    } catch (err) {
      foldersEl2.checked = !foldersEl2.checked;
      setStatus(err.message, true);
    }
  });

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state === 'idle') render(files, false);
      else if (state === 'done') drawFolders();
    }, 150);
  });

  setInterval(() => { if (!document.hidden) refresh(); }, 4000);
  refresh(true);
})();
