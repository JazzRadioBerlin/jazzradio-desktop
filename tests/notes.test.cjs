/* Run: node --test tests/notes.test.cjs. No Electron or real user stores. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const clone = v => JSON.parse(JSON.stringify(v));
const sample = { id: 'one', text: 'Original', createdAt: '2026-09-19T10:00:00Z', anchor: { artist: 'Artist', title: 'Track', at: '2026-09-19T10:00:00Z' } };
function load(file, mocks = {}, globals = {}) {
  const cache = new Map();
  function moduleAt(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(output, { module, exports: module.exports, console, ...globals, require(name) {
      if (name in mocks) return mocks[name];
      return name.startsWith('.') ? moduleAt(path.resolve(path.dirname(file), name + '.ts')) : require(name);
    } }, { filename: file });
    return module.exports;
  }
  return moduleAt(path.resolve(root, file));
}
test('note updates preserve metadata, order and other notes; reject empty/missing/oversize without writing', () => {
  const other = { id: 'two', text: 'Other', createdAt: sample.createdAt };
  let disk = [clone(sample), other], writes = 0, fail = false;
  class Store {
    get() { return clone(disk); }
    set(key, value) { if (fail) throw Error('disk full'); writes++; disk = clone(value); }
  }
  const store = load('src/main/store.ts', { 'electron-store': { default: Store }, electron: {} });
  store.updateNote('one', ' Revised\ntext ');
  assert.deepEqual(disk, [{ ...sample, text: 'Revised\ntext' }, other]);
  for (const [id, text] of [['one', '  '], ['missing', 'text'], ['one', 'x'.repeat(8001)]]) {
    assert.throws(() => store.updateNote(id, text));
  }
  assert.equal(writes, 1);
  fail = true;
  assert.throws(() => store.updateNote('one', 'Unsaved'), /disk full/);
  assert.equal(disk[0].text, 'Revised\ntext');
  fail = false;
  store.removeNote('one');
  assert.deepEqual(disk, [other]);
});

function rendererHarness() {
  let document;
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.handlers = {}; this.value = ''; this.hidden = false; this.classList = { toggle() {}, contains: () => false }; }
    append(...nodes) { for (const n of nodes) this.insertBefore(n, null); }
    insertBefore(n, before) { n.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, n); n.parent = this; }
    remove() { if (this.parent) { const i = this.parent.children.indexOf(this); this.parent.children.splice(i, 1); this.parent = null; } }
    after(node) { this.parent?.append(node); }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(k, fn) { (this.handlers[k] ??= []).push(fn); }
    focus() { document.activeElement = this; }
    async fire(k, event = {}) { await Promise.all((this.handlers[k] ?? []).map(fn => fn({ preventDefault() {}, stopPropagation() {}, ...event }))); }
  }
  const list = new Element(), compose = new Element('textarea'), notes = new Element(), anchor = new Element(), tab = new Element('button');
  notes.append(compose);
  const selectors = { '.js-notes-list': list, '.js-note-compose': compose, '.js-notes': notes, '.js-anchor': anchor, '.tab[data-panel="notizen"]': tab };
  document = { createElement: tag => new Element(tag), querySelector: s => selectors[s] ?? null, activeElement: null };
  const callbacks = {};
  let stored = [clone(sample)];
  let fail = false, saveCalls = 0, waitForSave; 
  const api = {
    listNotes: async () => clone(stored),
    onNotesChanged: fn => callbacks.notes = fn,
    onSettingsChanged: fn => callbacks.settings = fn,
    onNowPlaying: fn => callbacks.track = fn,
    onNotesFocus() {},
    updateNote: async (id, text) => {
      saveCalls++;
      if (waitForSave) await waitForSave;
      if (fail) throw Error('disk full');
      stored = stored.map(n => n.id === id ? { ...n, text: text.trim() } : n);
      callbacks.notes(clone(stored)); // Broadcast reaches renderer before invoke response.
      return clone(stored);
    },
    addNote: async () => { if (fail) throw Error('disk full'); return clone(stored); },
    removeNote: async id => { stored = stored.filter(n => n.id !== id); callbacks.notes(clone(stored)); return clone(stored); },
  };
  const strings = new Proxy({}, { get: (_, key) => String(key) });
  const mod = load('src/renderer/notes.ts', {
    './strings': { strings }, './nowplaying': { getCurrentTrack: () => null },
    './player': { isPlaying: () => false, onPlaybackChange: fn => callbacks.play = fn },
    './playlist': { setPanel() {} },
    '../shared/export': { berlinClock: () => '12:00', deNumericDate: () => '19.09.2026' },
  }, { document, window: { jazzradio: api }, requestAnimationFrame: fn => fn() });
  const settings = { notepadEnabled: true, notepadSkin: 'paper' };
  mod.initNotes(settings);
  const nodes = () => {
    const row = list.children[0];
    const field = row.children.find(n => n.tag === 'textarea');
    const buttons = row.children.find(n => n.className === 'note-actions').children;
    return { row, field, body: row.children[0], actions: row.children.find(n => n.className === 'note-actions'), button: key => key === 'noteDelete' ? row.children.find(n => n.className === 'note-delete') : buttons.find(n => n.dataset.noteLabel === key) };
  };
  return { mod, callbacks, settings, list, compose, document, nodes, setFail: value => fail = value, calls: () => saveCalls, holdSave: promise => waitForSave = promise };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('editing survives metadata/settings/locale/list refresh with focus and selection; failed saves retain draft', async () => {
  const h = rendererHarness(); await settle();
  const n = h.nodes(); await n.body.fire('click');
  n.field.value = 'Draft\nline'; n.field.selectionStart = 3; n.field.selectionEnd = 5;
  h.callbacks.track(); h.callbacks.settings(h.settings); h.mod.refreshNotesLocale(); h.callbacks.notes([clone(sample)]);
  assert.equal(h.nodes().field, n.field);
  assert.equal(n.field.value, 'Draft\nline');
  assert.equal(n.field.selectionStart, 3); assert.equal(n.field.selectionEnd, 5);
  assert.equal(h.document.activeElement, n.field);
  h.setFail(true); await n.field.fire('keydown', { key: 'Enter' }); await settle();
  assert.equal(n.field.value, 'Draft\nline'); assert.equal(n.field.hidden, false); assert.equal(n.field.readOnly, false);
  h.setFail(false); await n.field.fire('keydown', { key: 'Enter' }); await settle();
  assert.equal(n.field.hidden, true); assert.equal(n.row.children[0].textContent, 'Draft\nline');
});

test('empty edits and IME/Shift Enter do not save; Escape cancels; failed compose retains text', async () => {
  const h = rendererHarness(); await settle();
  const n = h.nodes();
  assert.equal(n.actions.hidden, true);
  assert.equal(n.body.attrs.role, 'button');
  assert.equal(n.body.tabIndex, 0);
  await n.body.fire('keydown', { key: 'Enter' });
  assert.equal(n.actions.hidden, false);
  n.field.value = '  '; await n.field.fire('keydown', { key: 'Enter' }); await settle();
  assert.equal(h.calls(), 0); assert.equal(n.field.hidden, false);
  n.field.value = 'Draft'; await n.field.fire('keydown', { key: 'Enter', shiftKey: true });
  await n.field.fire('keydown', { key: 'Enter', isComposing: true });
  assert.equal(h.calls(), 0);
  await n.field.fire('keydown', { key: 'Escape' }); assert.equal(n.field.hidden, true);
  assert.equal(n.row.children[0].textContent, sample.text);
  assert.equal(h.document.activeElement, n.body);
  assert.equal(n.actions.hidden, true);
  await n.body.fire('keydown', { key: ' ' });
  assert.equal(n.field.hidden, false);
  await n.button('noteCancel').fire('click');
  assert.equal(n.field.hidden, true);
  h.compose.value = 'Unsaved new note'; h.setFail(true);
  await h.compose.fire('keydown', { key: 'Enter' }); await settle();
  assert.equal(h.compose.value, 'Unsaved new note'); assert.equal(h.compose.readOnly, false);
});


test('pending edit blocks duplicate submissions and successful delete removes its row', async () => {
  const h = rendererHarness(); await settle();
  const n = h.nodes(); await n.body.fire('click'); n.field.value = 'Updated';
  let release; h.holdSave(new Promise(resolve => release = resolve));
  await n.field.fire('keydown', { key: 'Enter' });
  await n.field.fire('keydown', { key: 'Enter' });
  assert.equal(h.calls(), 1); assert.equal(n.field.readOnly, true);
  release(); await settle();
  assert.equal(n.field.hidden, true);
  await n.button('noteDelete').fire('click');
  assert.equal(h.list.children.length, 0);
});
