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
