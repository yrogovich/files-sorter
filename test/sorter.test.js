'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_RULES, buildIndex } = require('../lib/rules');
const { scan, sortFiles, undoMoves } = require('../lib/sorter');

const index = buildIndex(DEFAULT_RULES);
const tmp = () => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'sorter-'));

test('sorts by extension, skips hidden/partial/folders', async () => {
  const dir = tmp();
  for (const n of ['a.jpg', 'b.pdf', 'c.xyz', '.hid.jpg', 'x.crdownload']) fs.writeFileSync(path.join(dir, n), n);
  fs.mkdirSync(path.join(dir, 'Images'));
  const { moved } = await sortFiles(dir, index);
  assert.deepStrictEqual(moved.map((m) => m.folder).sort(), ['Documents', 'Images', 'Other']);
  assert.ok(fs.existsSync(path.join(dir, '.hid.jpg')) && fs.existsSync(path.join(dir, 'x.crdownload')));
});

test('never overwrites an existing file; undo restores', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'Images'));
  fs.writeFileSync(path.join(dir, 'Images', 'a.jpg'), 'old');
  fs.writeFileSync(path.join(dir, 'a.jpg'), 'new');
  const { moved } = await sortFiles(dir, index);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'Images', 'a.jpg'), 'utf8'), 'old');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'Images', 'a (1).jpg'), 'utf8'), 'new');
  await undoMoves(moved, moved.map((m) => m.folder));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a.jpg'), 'utf8'), 'new');
  assert.strictEqual((await scan(dir, index)).length, 1);
});

test('rejects path traversal in requested names', async () => {
  const dir = tmp();
  const { moved } = await sortFiles(dir, index, ['../etc/passwd']);
  assert.strictEqual(moved.length, 0);
});

test('folders are filed by their dominant content; undo moves them back', async () => {
  const dir = tmp();
  const mk = (rel, size = 1) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'.repeat(size)); };
  mk('Photoshop Setup/installer.dmg', 5000); mk('Photoshop Setup/readme.txt', 10);
  mk('React Course/01/lesson.mp4', 9000); mk('React Course/slides.pdf', 100);
  mk('Images/keep.jpg'); mk('Empty/.hidden');
  assert.strictEqual((await scan(dir, index)).length, 0); // off by default
  const { moved } = await sortFiles(dir, index, undefined, { folders: true });
  const by = Object.fromEntries(moved.map((m) => [m.name, m.folder]));
  assert.deepStrictEqual(by, { 'Photoshop Setup': 'Installers', 'React Course': 'Courses' });
  assert.ok(fs.existsSync(path.join(dir, 'Courses/React Course/01/lesson.mp4')));
  await undoMoves(moved, moved.map((m) => m.folder));
  assert.ok(fs.existsSync(path.join(dir, 'React Course/slides.pdf')) && !fs.existsSync(path.join(dir, 'Courses')));
});

test('small design-image-only folders are Figma exports, whatever their name', async () => {
  const dir = tmp();
  const mk = (rel) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); };
  mk('hero/m/bento-card.png'); mk('Contact/Desktop/NEW/section/section/awwwards.svg'); mk('Pricing v2/01-plan.jpg'); mk('logo/mark.svg');
  mk('Holiday/IMG_0001.jpg'); mk('Holiday/IMG_0002.jpg');          // camera photos
  mk('Mixed/a.png'); fs.writeFileSync(path.join(dir, 'Mixed/notes.pdf'), 'x'.repeat(500)); mk('Layers/m/image 12.png');                         // not image-only
  for (let i = 0; i < 4; i++) mk(`Big/${i}.png`);                    // too many for an export
  const { moved } = await sortFiles(dir, index, undefined, { folders: true });
  const by = Object.fromEntries(moved.map((m) => [m.name, m.folder]));
  assert.deepStrictEqual(by, { hero: 'Figma exports', Contact: 'Figma exports', 'Pricing v2': 'Figma exports', logo: 'Figma exports', Layers: 'Figma exports', Holiday: 'Images', Mixed: 'Documents', Big: 'Images' });
});

test('dev projects go to Code; image+video-only folders go to Videos; video+extras are Courses', async () => {
  const dir = tmp();
  const mk = (rel, size = 1) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'.repeat(size)); };
  mk('e2e-main/package.json'); mk('e2e-main/README.md', 5000); mk('e2e-main/tests/a.js');
  mk('app-main/app-main/pyproject.toml'); mk('app-main/app-main/docs/guide.md', 9000);
  mk('Trip/VID1.mp4', 9000); mk('Trip/IMG1.jpg', 100); mk('Trip/IMG2.jpg', 100);
  mk('Learn React/01.mp4', 9000); mk('Learn React/01.srt', 10); mk('Learn React/slides.pdf', 100);
  const { moved } = await sortFiles(dir, index, undefined, { folders: true });
  const by = Object.fromEntries(moved.map((m) => [m.name, m.folder]));
  assert.deepStrictEqual(by, { 'e2e-main': 'Code', 'app-main': 'Code', Trip: 'Videos', 'Learn React': 'Courses' });
});
