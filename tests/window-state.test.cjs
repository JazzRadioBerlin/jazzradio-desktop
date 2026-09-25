/* Behavior contract for one main/mini window. No Electron process or user files.
 * The fake exposes public native state and delayed notifications; it does not
 * simulate AppKit animation timing or claim native gesture coverage.
 * Run: node --test tests/window-state.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const ordinary = { x: 100, y: 100, width: 1200, height: 800 };
const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
const secondary = { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1080 } };

function harness({ saved = {}, displays = [primary], actualStore = false } = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), writes = [], messages = [];
  const disk = { failWrites: false };
  const settings = { mode: 'main', alwaysOnTopCompact: false, ...copy(saved) };
  const miniMenu = { enabled: true };
  let currentDisplays = copy(displays);
  const schedule = (callback, delay = 0) => {
    const id = ++nextTimer;
    timers.set(id, { callback, at: now + delay });
    return id;
  };
  function tick(ms = 1000) {
    const end = now + ms;
    for (let count = 0; count < 10000; count++) {
      const pending = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!pending) { now = end; return; }
      timers.delete(pending[0]); now = pending[1].at; pending[1].callback();
    }
    throw new Error('Unbounded timer work');
  }
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const display = d => ({ ...copy(d), bounds: copy(d.bounds || d.workArea), scaleFactor: d.scaleFactor || 1 });
  const screen = Object.assign(new EventEmitter(), {
    getDisplayMatching: rect => display([...currentDisplays].sort((a, b) => overlap(rect, b.workArea) - overlap(rect, a.workArea))[0]),
    getPrimaryDisplay: () => display(currentDisplays[0]),
    getAllDisplays: () => currentDisplays.map(display),
  });
  const electron = { screen, Menu: { getApplicationMenu: () => ({ getMenuItemById: id => id === 'window-mini' ? miniMenu : undefined }) } };
  let store = {
    getSettings: () => copy(settings),
    updateSettings: patch => {
      if (disk.failWrites) throw new Error('Injected settings write failure');
      writes.push(copy(patch)); Object.assign(settings, copy(patch)); return copy(settings);
    },
  };
  store.updateWindowSettings = store.updateSettings;
  class SettingsFile {
    constructor({ name, defaults }) {
      assert.equal(name, 'settings', 'controller must not open notes or favorites');
      for (const [key, value] of Object.entries(defaults)) if (!(key in settings)) settings[key] = copy(value);
    }
    get(key) { return copy(settings[key]); }
    set(key, value) {
      if (disk.failWrites) throw new Error('Injected settings write failure');
      writes.push({ [key]: copy(value) }); settings[key] = copy(value);
    }
  }
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(output, {
      module, exports: module.exports, console: { ...console, warn() {}, error() {} }, process: { platform: 'darwin' },
      setTimeout: schedule, clearTimeout: id => timers.delete(id),
      setImmediate: callback => schedule(callback), clearImmediate: id => timers.delete(id),
      require: name => name === 'electron' ? electron : name === 'electron-store' ? { default: SettingsFile } : name === './store' ? store
        : name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name),
    }, { filename: file });
    return module.exports;
  }
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.bounds = { x: options.x ?? 50, y: options.y ?? 50, width: options.width, height: options.height };
      this.normalBounds = copy(this.bounds);
      this.minimum = [options.minWidth ?? 0, options.minHeight ?? 0];
      this.maximum = [options.maxWidth ?? 0, options.maxHeight ?? 0];
      this.nativeMaximum = this.maximum.map(n => n || Infinity);
      this.resizable = options.resizable ?? true;
      this.alwaysOnTop = options.alwaysOnTop ?? false;
      this.nativeState = 'normal'; this.destroyed = false; this.calls = []; this.pendingEvents = [];
      this.failures = 0;
      this.webContents = { send: (channel, payload) => messages.push({ channel, payload, bounds: copy(this.bounds) }) };
    }
    getContentBounds() { return copy(this.bounds); }
    getBounds() { return copy(this.bounds); }
    getNormalBounds() { return copy(this.isNormal() ? this.bounds : this.normalBounds); }
    getMinimumSize() { return [...this.minimum]; }
    getMaximumSize() { return [...this.maximum]; }
    isDestroyed() { return this.destroyed; }
    isNormal() { return !this.isFullScreen() && !this.isMaximized() && !this.isMinimized(); }
    isFullScreen() { return this.nativeState === 'fullscreen'; }
    isMaximized() { return this.nativeState === 'zoomed'; }
    isMinimized() { return this.nativeState === 'minimized'; }
    isAlwaysOnTop() { return this.alwaysOnTop; }
    // Electron/macOS reports nonresizable in fullscreen and its transition.
    isResizable() { return this.resizable && this.nativeState !== 'fullscreen' && this.nativeState !== 'fullscreen-transition'; }
    record(method, ...args) { this.calls.push({ method, args: copy(args) }); }
    setResizable(value) { this.record('setResizable', value); this.resizable = value; }
    setAlwaysOnTop(value) { this.record('setAlwaysOnTop', value); this.alwaysOnTop = value; }
    setWindowButtonVisibility(...args) { this.record('setWindowButtonVisibility', ...args); }
    setWindowButtonPosition(...args) { this.record('setWindowButtonPosition', ...args); }
    setMinimumSize(w, h) { this.record('setMinimumSize', w, h); this.minimum = [w, h]; }
    // Clearing Electron's cached maximum is not evidence that AppKit's native
    // maximum was cleared. Never installing a compact maximum avoids this trap.
    setMaximumSize(w, h) {
      this.record('setMaximumSize', w, h); this.maximum = [w, h];
      if (w > 0 && h > 0) this.nativeMaximum = [w, h];
    }
    setContentBounds(bounds, animate) {
      this.record('setContentBounds', bounds, animate);
      if (this.failures-- > 0) throw new Error('Injected native geometry failure');
      if (this.ignoreNext) { this.ignoreNext = false; return; }
      if (this.isFullScreen()) return;
      this.bounds = {
        ...copy(bounds),
        width: Math.min(Math.max(bounds.width, this.minimum[0]), this.maximum[0] || Infinity),
        height: Math.min(Math.max(bounds.height, this.minimum[1]), this.maximum[1] || Infinity),
      };
      if (this.isNormal()) this.normalBounds = copy(this.bounds);
      // Nonanimated programmatic setters need not emit `resized`; ordinary
      // resize/move callbacks can arrive after the application call returns.
      this.pendingEvents.push('resize', 'move');
      if (this.onGeometry) { const callback = this.onGeometry; this.onGeometry = null; callback(); }
    }
    deliverProgrammaticEvents(reverse = false) {
      const pending = this.pendingEvents.splice(0);
      for (const event of reverse ? pending.reverse() : pending) this.emit(event);
    }
    nativeGeometry(bounds, event = 'move') {
      this.bounds = copy(bounds);
      if (this.isNormal()) this.normalBounds = copy(bounds);
      this.emit(event);
    }
    manualResizeStep(width, height) {
      if (!this.isResizable()) return;
      this.emit('will-resize', {}, { ...this.bounds, width, height });
      this.nativeGeometry({
        ...this.bounds,
        width: Math.min(Math.max(width, this.minimum[0]), this.nativeMaximum[0]),
        height: Math.min(Math.max(height, this.minimum[1]), this.nativeMaximum[1]),
      }, 'resize');
    }
    close() { this.emit('close'); this.destroyed = true; this.emit('closed'); }
  }
  if (actualStore) store = load(path.join(root, 'src/main/store.ts'));
  const api = load(path.join(root, 'src/main/window-state.ts'));
  function create() { const win = new FakeWindow(api.initialWindowOptions()); api.attachWindow(win); return win; }
  return { api, create, tick, settings, writes, messages, timers, disk, screen, miniMenu,
    replaceDisplays: next => { currentDisplays = copy(next); } };
}

const size = win => [win.bounds.width, win.bounds.height];
const onlyOrdinaryWrites = (h, expected) => {
  for (const patch of h.writes) if (patch.mainBounds) assert.deepEqual(patch.mainBounds, expected);
};
const noNativeWrites = win => assert.deepEqual(win.calls, [], 'native observation/publication must not mutate geometry, constraints, chrome or topmost');
function availability(h, expected) {
  assert.equal(h.api.canEnterMini(), expected);
  assert.equal(h.miniMenu.enabled, expected);
  const messages = h.messages.filter(m => m.channel === 'window:mini-availability-changed');
  assert.equal(messages.at(-1)?.payload, expected);
}

for (const bounds of [ordinary, { x: 120, y: 140, width: 960, height: 620 }]) {
  test(`saved ${bounds.width} by ${bounds.height} is restored exactly and survives recreation`, () => {
    const h = harness({ saved: { mainBounds: bounds } }); const win = h.create();
    assert.deepEqual(win.bounds, bounds); assert.deepEqual(win.minimum, [760, 520]);
    assert.equal(win.resizable, true); noNativeWrites(win);
    win.close(); assert.deepEqual(harness({ saved: h.settings }).create().bounds, bounds);
  });
}

test('first launch uses the default and well-formed compact saved bounds become usable main bounds; observations never repair', () => {
  for (const mainBounds of [undefined, { x: 700, y: 240, width: 260, height: 324 }]) {
    const h = harness({ saved: { mainBounds } }); const win = h.create();
    if (!mainBounds) assert.deepEqual(size(win), [1152, 744]);
    else assert.deepEqual(win.bounds, { x: mainBounds.x, y: mainBounds.y, width: 760, height: 520 });
    win.nativeGeometry({ x: 50, y: 50, width: 260, height: 324 }, 'resize');
    h.tick(); h.api.restoreRendererMode();
    assert.deepEqual(size(win), [260, 324], 'ordinary callbacks must not initiate repair even for invalid input');
    noNativeWrites(win);
    assert.ok(!h.writes.some(patch => patch.mainBounds?.width === 260));
  }
});

test('small work area has one consistent fitting minimum and a valid main/mini roundtrip', () => {
  const h = harness({ displays: [{ id: 1, workArea: { x: 0, y: 0, width: 640, height: 480 } }] });
  const win = h.create();
  assert.deepEqual(size(win), [640, 480]); assert.deepEqual(win.minimum, [640, 480]);
  h.api.setWindowMode('mini'); h.api.setWindowMode('main');
  assert.deepEqual(size(win), [640, 480]); assert.deepEqual(win.minimum, [640, 480]);
});

test('return from mini after a small display grows applies current main minimum once', () => {
  const small = { id: 1, workArea: { x: 0, y: 0, width: 640, height: 480 } };
  const h = harness({ displays: [small], actualStore: true }); const win = h.create();
  const originalKeys = Object.keys(h.settings).sort();
  assert.deepEqual(size(win), [640, 480]);
  h.api.setWindowMode('mini'); win.deliverProgrammaticEvents(); win.calls.length = 0;
  h.replaceDisplays([primary]); h.screen.emit('display-metrics-changed', {}, primary, ['workArea', 'bounds']);
  h.tick(); noNativeWrites(win);
  h.api.setWindowMode('main');
  assert.equal(h.api.getWindowMode(), 'main'); assert.deepEqual(size(win), [760, 520]);
  assert.deepEqual(win.minimum, [760, 520]); assert.equal(win.resizable, true);
  assert.equal(win.calls.filter(c => c.method === 'setContentBounds').length, 1, 'return must succeed without rollback');
  const calls = copy(win.calls); win.deliverProgrammaticEvents(true); h.tick(); h.api.setWindowMode('main');
  assert.deepEqual(win.calls, calls); assert.deepEqual(h.settings.mainBounds, win.bounds);
  assert.deepEqual(Object.keys(h.settings).sort(), originalKeys, 'display context must not introduce persisted settings');
});

test('a main window originating on a small display remains movable and can enter mini after the display grows', () => {
  const small = { id: 1, workArea: { x: 0, y: 0, width: 640, height: 480 } };
  const h = harness({ displays: [small], actualStore: true }); const win = h.create();
  h.replaceDisplays([primary]); h.screen.emit('display-metrics-changed', {}, primary, ['workArea', 'bounds']);
  const moved = { ...win.bounds, x: 100, y: 120 };
  win.nativeGeometry(moved); h.tick(); h.api.restoreRendererMode();
  noNativeWrites(win); assert.deepEqual(win.bounds, moved); availability(h, true);
  assert.deepEqual(h.settings.mainBounds, moved, 'ordinary position remains saveable after the display change');
  h.api.setWindowMode('mini'); assert.equal(h.api.getWindowMode(), 'mini');
  assert.deepEqual(win.bounds, { x: moved.x + moved.width - 260, y: moved.y, width: 260, height: 324 });
  h.api.setWindowMode('main');
  assert.equal(h.api.getWindowMode(), 'main');
  assert.deepEqual(win.bounds, { x: moved.x, y: moved.y, width: 760, height: 520 });
});

test('ordinary movement from a small monitor to a larger monitor retains chosen size and saves its new position', () => {
  const small = { id: 1, workArea: { x: 0, y: 0, width: 640, height: 480 } };
  const large = { id: 2, workArea: { x: 640, y: 0, width: 1920, height: 1080 } };
  const h = harness({ displays: [small, large], actualStore: true }); const win = h.create();
  const moved = { x: 900, y: 100, width: 640, height: 480 };
  win.nativeGeometry(moved); h.tick();
  noNativeWrites(win); assert.deepEqual(win.bounds, moved); availability(h, true);
  assert.deepEqual(h.settings.mainBounds, moved);
  h.api.setWindowMode('mini'); h.api.setWindowMode('main');
  assert.equal(h.api.getWindowMode(), 'main');
  assert.deepEqual(win.bounds, { x: moved.x, y: moved.y, width: 760, height: 520 });
});

test('saved small-display geometry retains its moved position on larger-display recreation', () => {
  const small = { id: 1, workArea: { x: 0, y: 0, width: 640, height: 480 } };
  const h = harness({ displays: [small], actualStore: true }); const win = h.create();
  h.replaceDisplays([primary]); h.screen.emit('display-metrics-changed', {}, primary, ['workArea', 'bounds']);
  const moved = { x: 100, y: 120, width: 640, height: 480 };
  win.nativeGeometry(moved); h.tick(); win.close();
  assert.deepEqual(h.settings.mainBounds, moved);
  const reopened = harness({ saved: h.settings, actualStore: true }); const next = reopened.create();
  const restored = { x: moved.x, y: moved.y, width: 760, height: 520 };
  assert.deepEqual(next.bounds, restored); assert.deepEqual(reopened.settings.mainBounds, restored);
  assert.deepEqual(next.minimum, [760, 520]); noNativeWrites(next);
});

test('native move and completed manual resize persist ordinary bounds without native writes', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  const moved = { ...ordinary, x: -100, y: 60 };
  win.nativeGeometry(moved); h.tick(); assert.deepEqual(h.settings.mainBounds, moved);
  win.manualResizeStep(1400, 900); h.tick(10000);
  assert.equal(h.api.getWindowMode(), 'main'); noNativeWrites(win);
  win.emit('resized'); h.tick();
  assert.deepEqual(h.settings.mainBounds, win.bounds); noNativeWrites(win); availability(h, true);
});

test('held resize blocks mini indefinitely and rejected requests never become queued work', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  win.manualResizeStep(1300, 850); availability(h, false);
  h.api.setWindowMode('mini'); h.tick(10000); h.api.restoreRendererMode();
  assert.equal(h.api.getWindowMode(), 'main'); assert.deepEqual(h.settings.mainBounds, ordinary);
  noNativeWrites(win); availability(h, false);
  win.emit('resized'); h.tick(10000);
  assert.equal(h.api.getWindowMode(), 'main'); noNativeWrites(win); availability(h, true);
  assert.deepEqual(h.settings.mainBounds, win.bounds);
});

for (const mode of ['main', 'mini']) test(`${mode} same-mode and renderer sync only publish state`, () => {
  const h = harness({ saved: { mode, mainBounds: ordinary } }); const win = h.create();
  win.nativeGeometry({ ...win.bounds, x: -100, y: 60 }); h.tick();
  const chosen = copy(win.bounds); win.calls.length = 0;
  for (let i = 0; i < 3; i++) { h.api.setWindowMode(mode); h.api.restoreRendererMode(); }
  h.tick(); noNativeWrites(win); assert.deepEqual(win.bounds, chosen);
  assert.equal(h.messages.filter(m => m.channel === 'window:mode-changed').at(-1)?.payload, mode);
});

for (const [state, enter, leave] of [
  ['fullscreen', 'enter-full-screen', 'leave-full-screen'],
  ['zoomed', 'maximize', 'unmaximize'],
  ['minimized', 'minimize', 'restore'],
]) test(`${state} lifecycle neither repairs nor replaces ordinary geometry; mini request is rejected`, () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create(); h.writes.length = 0;
  win.nativeState = state;
  win.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
  for (const event of ['resize', enter, 'move', 'resized']) win.emit(event);
  h.tick(); h.api.restoreRendererMode(); h.api.setWindowMode('main'); h.api.setWindowMode('mini');
  availability(h, false); noNativeWrites(win); assert.equal(h.api.getWindowMode(), 'main');
  assert.deepEqual(h.settings.mainBounds, ordinary); onlyOrdinaryWrites(h, ordinary);
  win.nativeState = 'normal'; win.bounds = copy(ordinary);
  for (const event of ['resize', leave, 'move', 'resized']) win.emit(event);
  h.tick(); availability(h, true); noNativeWrites(win); assert.equal(h.api.getWindowMode(), 'main');
  h.api.setWindowMode('mini'); h.api.setWindowMode('main');
  assert.deepEqual(win.bounds, ordinary, 'in-memory snapshot also stays ordinary');
});

test('fullscreen transition resizability and unclassified size changes are conservative command-time guards', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  win.nativeState = 'fullscreen-transition';
  h.api.setWindowMode('mini'); h.api.restoreRendererMode(); h.tick();
  assert.equal(h.api.getWindowMode(), 'main'); availability(h, false); noNativeWrites(win);
  win.nativeState = 'normal';
  win.bounds = { x: 0, y: 0, width: 1800, height: 1000 };
  win.normalBounds = copy(win.bounds); // getNormalBounds is current bounds while isNormal is true
  win.emit('resize'); h.api.setWindowMode('mini'); h.tick();
  assert.equal(h.api.getWindowMode(), 'main'); assert.deepEqual(h.settings.mainBounds, ordinary); noNativeWrites(win);
  win.bounds = copy(ordinary); win.normalBounds = copy(ordinary); win.emit('resized'); h.tick();
  assert.equal(h.api.getWindowMode(), 'main'); availability(h, true);
});

test('resized before maximize cannot persist a transient zoom rectangle while native flags still report ordinary', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create(); h.writes.length = 0;
  const zoom = { x: 0, y: 0, width: 1920, height: 1080 };
  win.nativeGeometry(zoom, 'resize'); win.emit('resized');
  assert.equal(win.isNormal(), true);
  assert.deepEqual(win.getNormalBounds(), zoom, 'getNormalBounds cannot independently identify zoom before flags change');
  h.api.setWindowMode('mini'); h.api.restoreRendererMode();
  assert.equal(h.api.getWindowMode(), 'main'); availability(h, false); noNativeWrites(win);
  assert.deepEqual(h.settings.mainBounds, ordinary);
  // AppKit dispatches its paired native lifecycle notification before the
  // JavaScript event loop resumes; the model does not invent a zoom-start API.
  win.nativeState = 'zoomed'; win.normalBounds = copy(ordinary); win.emit('maximize');
  h.tick(10000); assert.deepEqual(h.settings.mainBounds, ordinary); onlyOrdinaryWrites(h, ordinary);
  win.nativeState = 'normal'; win.bounds = copy(ordinary); win.emit('unmaximize'); h.tick();
  noNativeWrites(win); availability(h, true);
  h.api.setWindowMode('mini'); h.api.setWindowMode('main'); assert.deepEqual(win.bounds, ordinary);
});

test('an unclassified ordinary resize finishing at resized does not leave Mini permanently disabled', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  const changed = { ...ordinary, width: 1300, height: 850 };
  win.nativeGeometry(changed, 'resize'); h.api.setWindowMode('mini');
  assert.equal(h.api.getWindowMode(), 'main'); availability(h, false);
  win.emit('resized'); h.tick();
  availability(h, true); assert.deepEqual(h.settings.mainBounds, changed); noNativeWrites(win);
  assert.equal(h.api.getWindowMode(), 'main', 'rejected request was not queued');
});

test('a new held resize cancels pending unclassified native completion', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  win.nativeGeometry({ ...ordinary, width: 1300, height: 850 }, 'resize'); win.emit('resized');
  win.manualResizeStep(1400, 900); h.tick(10000); h.api.setWindowMode('mini');
  availability(h, false); assert.equal(h.api.getWindowMode(), 'main'); noNativeWrites(win);
  assert.deepEqual(h.settings.mainBounds, ordinary);
  win.emit('resized'); h.tick(); availability(h, true); assert.deepEqual(h.settings.mainBounds, win.bounds);
});

test('mini minimize/restore preserves presentation and ordinary-main memory', () => {
  const h = harness({ saved: { mode: 'mini', mainBounds: ordinary } }); const win = h.create();
  const mini = copy(win.bounds);
  win.nativeState = 'minimized'; win.emit('minimize'); h.api.restoreRendererMode();
  win.nativeState = 'normal'; win.emit('restore'); h.tick();
  assert.equal(h.api.getWindowMode(), 'mini'); assert.deepEqual(win.bounds, mini); noNativeWrites(win);
  assert.deepEqual(h.settings.mainBounds, ordinary); h.api.setWindowMode('main'); assert.deepEqual(win.bounds, ordinary);
});

test('rapid roundtrips tolerate delayed and reversed programmatic notifications without native rewrites', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  for (let i = 0; i < 8; i++) {
    h.api.setWindowMode('mini');
    assert.deepEqual(win.bounds, { x: ordinary.x + ordinary.width - 260, y: ordinary.y, width: 260, height: 324 });
    assert.deepEqual(win.minimum, [260, 324]); assert.equal(win.resizable, false);
    assert.deepEqual(win.maximum, [0, 0]);
    h.api.setWindowMode('main'); assert.deepEqual(win.bounds, ordinary);
    const calls = copy(win.calls);
    win.pendingEvents.push('resized'); // completion can also arrive late on some native paths
    win.deliverProgrammaticEvents(i % 2 === 0); h.tick();
    assert.deepEqual(win.calls, calls, 'late programmatic notifications do not start new operations');
  }
  assert.ok(win.calls.filter(c => c.method === 'setContentBounds').every(c => c.args[1] === false));
  assert.ok(!win.calls.some(c => c.method === 'setMaximumSize' && c.args[0] > 0));
  assert.deepEqual(h.settings.mainBounds, ordinary); onlyOrdinaryWrites(h, ordinary);
});

test('late programmatic notifications cannot release a subsequently held native resize', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  h.api.setWindowMode('mini'); h.api.setWindowMode('main'); win.calls.length = 0;
  win.manualResizeStep(1300, 850); win.deliverProgrammaticEvents(true);
  h.tick(10000); h.api.setWindowMode('mini');
  noNativeWrites(win); assert.equal(h.api.getWindowMode(), 'main'); availability(h, false);
  win.emit('resized'); h.tick(); availability(h, true);
});

test('outward held resize keeps growing after mini roundtrip with no stale native maximum', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  h.api.setWindowMode('mini'); win.manualResizeStep(1500, 900); assert.deepEqual(size(win), [260, 324]);
  h.api.setWindowMode('main'); win.deliverProgrammaticEvents(); win.calls.length = 0;
  for (const [width, height] of [[1220, 820], [1280, 860], [1400, 920]]) {
    win.manualResizeStep(width, height); h.tick(4000);
    assert.deepEqual(size(win), [width, height]); noNativeWrites(win);
  }
  win.emit('resized'); h.tick(); assert.deepEqual(h.settings.mainBounds, win.bounds);
});

for (const failure of ['throw', 'ignore']) test(`failed explicit mini operation (${failure}) is bounded and never publishes success`, () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  h.messages.length = 0; h.writes.length = 0;
  if (failure === 'throw') win.failures = 1; else win.ignoreNext = true;
  assert.doesNotThrow(() => h.api.setWindowMode('mini'));
  assert.equal(h.api.getWindowMode(), 'main'); assert.equal(h.settings.mode, 'main');
  assert.ok(!h.messages.some(m => m.channel === 'window:mode-changed' && m.payload === 'mini'));
  assert.ok(!h.writes.some(patch => patch.mode === 'mini'));
  assert.ok(win.calls.filter(c => c.method === 'setContentBounds').length <= 2, 'at most request and one rollback');
  const calls = copy(win.calls); win.deliverProgrammaticEvents(true); h.tick(10000); h.api.restoreRendererMode();
  assert.deepEqual(win.calls, calls, 'notifications must not retry a failed request');
  assert.deepEqual(win.bounds, ordinary);
});

test('reentrant mode request is rejected instead of being applied later', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  win.onGeometry = () => h.api.setWindowMode('main');
  h.api.setWindowMode('mini'); win.deliverProgrammaticEvents(true); h.tick(10000);
  assert.equal(h.api.getWindowMode(), 'mini'); assert.deepEqual(size(win), [260, 324]);
  assert.equal(win.calls.filter(c => c.method === 'setContentBounds').length, 1);
});

test('disk failure does not lose latest safe ordinary rectangle in memory', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  const chosen = { x: 90, y: 100, width: 1350, height: 850 };
  h.disk.failWrites = true;
  win.manualResizeStep(chosen.width, chosen.height); win.nativeGeometry(chosen); win.emit('resized');
  assert.doesNotThrow(() => h.tick());
  assert.doesNotThrow(() => h.api.setWindowMode('mini')); assert.equal(h.api.getWindowMode(), 'mini');
  assert.deepEqual(h.settings.mainBounds, ordinary);
  h.disk.failWrites = false; h.api.setWindowMode('main'); h.tick();
  assert.deepEqual(win.bounds, chosen); assert.deepEqual(h.settings.mainBounds, chosen);
});

test('immediate close flushes safe ordinary geometry and cancels pending disk work', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  const chosen = { ...ordinary, x: 140, y: 180 };
  win.nativeGeometry(chosen); win.close();
  assert.deepEqual(h.settings.mainBounds, chosen); assert.equal(h.timers.size, 0); noNativeWrites(win);
  assert.deepEqual(harness({ saved: h.settings }).create().bounds, chosen);
});

for (const unsafe of ['dragging', 'fullscreen', 'zoomed', 'minimized', 'invalid', 'uncertain']) {
  test(`close does not persist ${unsafe} current geometry`, () => {
    const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
    if (unsafe === 'dragging') win.emit('will-resize');
    if (['fullscreen', 'zoomed', 'minimized'].includes(unsafe)) win.nativeState = unsafe;
    win.bounds = unsafe === 'invalid' ? { x: 100, y: 100, width: 260, height: 324 }
      : { x: 0, y: 0, width: 1800, height: 1000 };
    if (unsafe !== 'uncertain' && win.isNormal()) win.normalBounds = copy(win.bounds);
    win.emit('resize'); win.close();
    assert.deepEqual(h.settings.mainBounds, ordinary); assert.equal(h.timers.size, 0); noNativeWrites(win);
  });
}

test('closed window callbacks cannot affect its replacement', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const old = h.create();
  old.manualResizeStep(1300, 850); h.api.setWindowMode('mini'); old.close();
  const win = h.create(); old.emit('resized'); h.tick(10000);
  assert.equal(h.api.getWindowMode(), 'main'); assert.deepEqual(win.bounds, ordinary); noNativeWrites(win);
});

test('accessible multi-display placement is preserved at startup, sync, same-mode and unrelated display changes', () => {
  const spanning = { x: 600, y: 100, width: 2400, height: 800 };
  const h = harness({ saved: { mainBounds: spanning }, displays: [primary, secondary] }); const win = h.create();
  assert.deepEqual(win.bounds, spanning);
  h.api.setWindowMode('main'); h.api.restoreRendererMode();
  h.screen.emit('display-metrics-changed', {}, secondary, ['scaleFactor']);
  h.screen.emit('display-removed', {}, { id: 3, workArea: { x: -1920, y: 0, width: 1920, height: 1080 } });
  h.tick(); noNativeWrites(win); assert.deepEqual(win.bounds, spanning);
  h.api.setWindowMode('mini'); h.api.setWindowMode('main'); assert.deepEqual(win.bounds, spanning);
});

for (const mode of ['main', 'mini']) test(`${mode} display loss recovers only inaccessible placement`, () => {
  const removedBounds = { x: 2200, y: 100, width: 1200, height: 800 };
  const h = harness({ saved: { mode, mainBounds: removedBounds }, displays: [primary, secondary] }); const win = h.create();
  assert.ok(win.bounds.x >= 1920);
  h.replaceDisplays([primary]); h.screen.emit('display-removed', {}, secondary); h.tick();
  assert.equal(h.api.getWindowMode(), mode);
  assert.ok(win.bounds.x >= 0 && win.bounds.x + win.bounds.width <= 1920);
  assert.ok(win.bounds.y >= 0 && win.bounds.y + win.bounds.height <= 1080);
  assert.deepEqual(size(win), mode === 'main' ? [1200, 800] : [260, 324]);
  assert.ok(win.calls.some(c => c.method === 'setContentBounds'));
  const calls = copy(win.calls); h.screen.emit('display-metrics-changed', {}, primary, ['scaleFactor']); h.tick();
  assert.deepEqual(win.calls, calls, 'already usable placement is not clamped again');
});

test('startup recovers wholly inaccessible saved geometry', () => {
  const h = harness({ saved: { mainBounds: { x: 7000, y: 5000, width: 1200, height: 800 } } }); const win = h.create();
  assert.ok(win.bounds.x >= 0 && win.bounds.x + win.bounds.width <= 1920);
  assert.ok(win.bounds.y >= 0 && win.bounds.y + win.bounds.height <= 1080);
  assert.deepEqual(size(win), [1200, 800]); noNativeWrites(win);
});

for (const [state, enter, leave] of [
  ['fullscreen', 'enter-full-screen', 'leave-full-screen'],
  ['zoomed', 'maximize', 'unmaximize'],
  ['minimized', 'minimize', 'restore'],
]) test(`display loss during ${state} recovers an inaccessible ordinary return only once`, () => {
  const removedBounds = { x: 2200, y: 100, width: 1200, height: 800 };
  const h = harness({ saved: { mainBounds: removedBounds }, displays: [primary, secondary] }); const win = h.create();
  win.nativeState = state; win.bounds = { x: 1920, y: 0, width: 1920, height: 1080 }; win.emit(enter);
  h.replaceDisplays([primary]); h.screen.emit('display-removed', {}, secondary); h.tick();
  noNativeWrites(win); assert.deepEqual(h.settings.mainBounds, removedBounds);
  win.nativeState = 'normal'; win.bounds = copy(removedBounds); win.normalBounds = copy(removedBounds);
  win.emit(leave); h.tick();
  assert.ok(win.bounds.x >= 0 && win.bounds.x + win.bounds.width <= 1920);
  assert.deepEqual(size(win), [1200, 800]); assert.equal(h.api.getWindowMode(), 'main');
  const calls = copy(win.calls);
  win.deliverProgrammaticEvents(true); win.emit(leave); h.tick(10000);
  assert.deepEqual(win.calls, calls, 'authorized deferred recovery must not become a repair loop');
});

test('deferred display recovery leaves a usable ordinary return untouched', () => {
  const h = harness({ saved: { mainBounds: ordinary }, displays: [primary, secondary] }); const win = h.create();
  win.nativeState = 'minimized'; win.emit('minimize');
  h.replaceDisplays([primary]); h.screen.emit('display-removed', {}, secondary);
  win.nativeState = 'normal'; win.emit('restore'); h.tick();
  noNativeWrites(win); assert.deepEqual(win.bounds, ordinary);
});

test('display recovery waits for held resize completion and does not queue a rejected mini request', () => {
  const removedBounds = { x: 2200, y: 100, width: 1200, height: 800 };
  const h = harness({ saved: { mainBounds: removedBounds }, displays: [primary, secondary] }); const win = h.create();
  win.manualResizeStep(1300, 850); h.api.setWindowMode('mini');
  h.replaceDisplays([primary]); h.screen.emit('display-removed', {}, secondary); h.tick(10000);
  noNativeWrites(win); availability(h, false);
  win.emit('resized'); h.tick();
  assert.equal(h.api.getWindowMode(), 'main'); assert.deepEqual(size(win), [1300, 850]);
  assert.ok(win.bounds.x >= 0 && win.bounds.x + win.bounds.width <= 1920);
  availability(h, true);
});

test('runtime legacy strip requests cannot change mode or native geometry', () => {
  const h = harness({ saved: { mainBounds: ordinary } }); const win = h.create();
  h.api.setWindowMode('strip'); h.tick();
  assert.equal(h.api.getWindowMode(), 'main'); noNativeWrites(win);
  assert.ok(!h.messages.some(m => m.payload === 'strip')); assert.ok(!h.writes.some(patch => patch.mode === 'strip'));
});
