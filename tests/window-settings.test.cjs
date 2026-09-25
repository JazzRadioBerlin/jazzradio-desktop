/* Execute the production store and IPC boundaries against isolated in-memory
 * electron-store files. No real settings, notes, favorites or Electron process.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const mainBounds = { x: 100, y: 140, width: 960, height: 620 };
const settings = {
  mode: 'strip', mainBounds, theme: 'light', language: 'de', notepadEnabled: true,
  notepadSkin: 'ink', alwaysOnTopCompact: true, volume: 0.37,
  futureSetting: { enabled: true, opaqueValue: ['preserve', 42] },
};
const favorite = { id: 'artist-song', artist: 'Artist', title: 'Song', addedAt: '2026-09-20T12:00:00.000Z' };
const note = { id: 'note-1', text: 'Saved note\nSecond line', createdAt: '2026-09-20T12:00:00.000Z',
  anchor: { artist: 'Artist', title: 'Song', at: '2026-09-20T12:00:00.000Z' } };

function harness(saved = settings, { rejectMigration = false } = {}) {
  const disk = { settings: copy(saved), favorites: { items: [copy(favorite)] }, notes: { items: [copy(note)] } };
  const writes = [], opened = [], cache = new Map(), events = new Map(), handlers = new Map();
  const modeCalls = [], messages = [], errors = [];
  let mode = 'main', topmostCalls = 0;
  class Store {
    constructor({ name, defaults }) {
      this.name = name; opened.push(name);
      disk[name] ??= {};
      for (const [key, value] of Object.entries(defaults)) if (!(key in disk[name])) disk[name][key] = copy(value);
    }
    get(key) { return copy(disk[this.name][key]); }
    set(key, value) {
      assert.equal(typeof key, 'string', 'migration/settings writes must be per-key, never wholesale replacement');
      writes.push({ file: this.name, key, value: copy(value) });
      if (rejectMigration && this.name === 'settings' && key === 'mode' && value === 'main') {
        throw new Error('Simulated migration write failure');
      }
      disk[this.name][key] = copy(value);
    }
    clear() { assert.fail('must never clear an existing store'); }
  }
  const electron = {
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    ipcMain: { on: (name, fn) => events.set(name, fn), handle: (name, fn) => handlers.set(name, fn) },
  };
  const win = { isDestroyed: () => false, webContents: { send: (...args) => messages.push(copy(args)) } };
  const windowState = {
    getWindowMode: () => mode,
    setWindowMode: next => { modeCalls.push(next); mode = next; },
    getAttachedWindow: () => win,
    restoreRendererMode() {},
    applyAlwaysOnTopFromSettings: () => topmostCalls++,
  };
  const mocks = {
    'electron-store': { default: Store }, electron,
    './window-state': windowState, './poller': { getLastNowPlaying: () => null },
    './share': { openGoogle() {}, runShare() {} }, './theme': { applyThemeFromSettings() {} },
    './language': { applyLanguageFromSettings() {}, getLocalizedSettings: () => store.getSettings() },
  };
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(js, { module, exports: module.exports, console: { ...console, error: (...args) => errors.push(args) }, require(name) {
      if (name in mocks) return mocks[name];
      return name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name);
    } }, { filename: file });
    return module.exports;
  }
  const store = load('src/main/store.ts');
  return { store, disk, writes, opened, load, events, handlers, modeCalls, messages, errors,
    setMode: value => { mode = value; }, topmostCalls: () => topmostCalls,
    event: { sender: { isDestroyed: () => false, send: (...args) => messages.push(copy(args)) } } };
}

test('legacy strip migration changes exactly its stored mode key and preserves all files and unknown settings', () => {
  const h = harness(); const before = copy(h.disk);
  const result = h.store.getSettings();
  assert.equal(result.mode, 'main');
  assert.deepEqual(h.writes, [{ file: 'settings', key: 'mode', value: 'main' }]);
  assert.deepEqual(h.opened, ['settings'], 'migration must not even open notes or favorites');
  assert.deepEqual(h.disk, { ...before, settings: { ...before.settings, mode: 'main' } });
  assert.deepEqual(copy(h.store.getSettings()), copy(result));
  assert.equal(h.writes.length, 1, 'migration runs once');
  assert.deepEqual(copy(h.store.getFavorites()), [favorite]);
  assert.deepEqual(copy(h.store.getNotes()), [note]);
  assert.deepEqual(h.disk.notes, before.notes); assert.deepEqual(h.disk.favorites, before.favorites);
  assert.equal(h.writes.length, 1, 'reading preserved content never rewrites it');
});

test('failed legacy migration keeps readable preferences available without repeated writes or data loss', () => {
  const h = harness(settings, { rejectMigration: true }); const before = copy(h.disk);
  const { futureSetting: _unknown, ...expected } = settings;
  const result = h.store.getSettings();
  assert.deepEqual(copy(result), { ...expected, mode: 'main' });
  assert.deepEqual(h.writes, [{ file: 'settings', key: 'mode', value: 'main' }]);
  assert.equal(h.errors.length, 1, 'the failed migration is logged once');
  assert.deepEqual(h.opened, ['settings'], 'failed migration does not open user-content stores');
  assert.deepEqual(h.disk, before, 'unwritten mode, unknown keys and all user data remain intact');
  assert.deepEqual(copy(h.store.getSettings()), copy(result));
  assert.deepEqual(copy(h.store.getFavorites()), [favorite]);
  assert.deepEqual(copy(h.store.getNotes()), [note]);
  assert.equal(h.writes.length, 1, 'later reads do not retry the failed migration');
  assert.equal(h.errors.length, 1);
  assert.deepEqual(h.disk, before);
});

for (const mode of ['main', 'mini']) test(`saved ${mode}, chosen old-default geometry and preferences are unchanged`, () => {
  const saved = { ...settings, mode }; const h = harness(saved);
  const result = h.store.getSettings();
  assert.equal(result.mode, mode); assert.deepEqual(copy(result.mainBounds), mainBounds);
  assert.deepEqual(h.disk.settings, saved); assert.deepEqual(h.writes, []);
});

for (const bounds of [null, { x: 'wrong', y: 0, width: 1000, height: 700 }, { x: 1, y: 2, width: 260, height: 324 }]) {
  test(`legacy migration does not rewrite questionable saved bounds (${JSON.stringify(bounds)})`, () => {
    const saved = { ...settings, mainBounds: bounds }; const h = harness(saved);
    assert.equal(h.store.getSettings().mode, 'main');
    assert.deepEqual(h.disk.settings, { ...saved, mode: 'main' });
    assert.deepEqual(h.writes, [{ file: 'settings', key: 'mode', value: 'main' }]);
  });
}

test('unknown stored mode falls back in memory without resetting unrelated persisted data', () => {
  const saved = { ...settings, mode: 'future-mode' }; const h = harness(saved);
  assert.equal(h.store.getSettings().mode, 'main');
  assert.deepEqual(h.disk.settings, saved); assert.deepEqual(h.writes, []);
});

test('only the controller store boundary may write geometry; strip is never a writable runtime mode', () => {
  const h = harness({ ...settings, mode: 'main' }); h.store.getSettings();
  h.store.updateSettings({ mode: 'mini', mainBounds: { ...mainBounds, width: 1100 }, futureSetting: false });
  h.store.updateWindowSettings({ mode: 'strip' });
  assert.deepEqual(h.writes, []); assert.deepEqual(h.disk.settings, { ...settings, mode: 'main' });
  assert.throws(() => h.store.updateWindowSettings({ mode: 'mini', mainBounds: { x: 0, y: 0, width: 260, height: 324 } }));
  assert.deepEqual(h.writes, [], 'invalid geometry cannot partially persist a presentation change');
  h.store.updateWindowSettings({ mode: 'mini', mainBounds });
  assert.equal(h.disk.settings.mode, 'mini'); assert.deepEqual(h.disk.settings.mainBounds, mainBounds);
  assert.deepEqual(h.disk.settings.futureSetting, settings.futureSetting);
  assert.deepEqual(h.disk.favorites.items, [favorite]); assert.deepEqual(h.disk.notes.items, [note]);
});

test('real IPC validates main/mini commands and has no legacy hover channel', () => {
  const h = harness({ ...settings, mode: 'main' }); h.load('src/main/ipc.ts').registerIpc();
  for (const invalid of ['strip', 'fullscreen', null, undefined, {}, 2]) h.events.get('window:set-mode')(h.event, invalid);
  assert.deepEqual(h.modeCalls, []);
  h.events.get('window:set-mode')(h.event, 'mini'); h.events.get('window:set-mode')(h.event, 'main');
  assert.deepEqual(h.modeCalls, ['mini', 'main']);
  assert.ok(![...h.events.keys(), ...h.handlers.keys()].some(channel => /strip|hover/.test(channel)));
});

test('New Note already in main only focuses its existing renderer; mini explicitly returns to main', () => {
  const h = harness({ ...settings, mode: 'main' }); const ipc = h.load('src/main/ipc.ts');
  ipc.focusNotesComposer();
  assert.deepEqual(h.modeCalls, []); assert.deepEqual(h.messages, [['panel:set', 'notizen'], ['notes:focus']]);
  h.setMode('mini'); ipc.focusNotesComposer(); assert.deepEqual(h.modeCalls, ['main']);
});

test('settings IPC only applies native topmost for an actual mini preference change', () => {
  const h = harness({ ...settings, mode: 'main', alwaysOnTopCompact: false }); h.load('src/main/ipc.ts').registerIpc();
  const update = patch => h.events.get('settings:set')(h.event, patch);
  update({ language: 'en' }); update({ theme: 'dark' }); update({ volume: 0.8 });
  update({ alwaysOnTopCompact: true }); assert.equal(h.topmostCalls(), 0, 'main stores the preference only');
  h.setMode('mini'); update({ theme: 'light' }); update({ alwaysOnTopCompact: true });
  assert.equal(h.topmostCalls(), 0, 'unrelated and repeated settings do not touch native topmost');
  update({ alwaysOnTopCompact: false }); assert.equal(h.topmostCalls(), 1);
  assert.deepEqual(h.disk.settings.futureSetting, settings.futureSetting);
});
