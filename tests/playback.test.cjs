/* Run: node --test tests/playback.test.cjs. No Electron, stream or user stores. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');

function load(relative, mocks, globals = {}) {
  const file = path.resolve(__dirname, '..', relative);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, console, __dirname: path.dirname(file),
    process: { platform: 'darwin' },
    require(name) {
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    ...globals,
  }, { filename: file });
  return module.exports;
}

function playerHarness() {
  class HTMLElement {
    constructor(tag = 'body', attrs = {}) { this.tag = tag; this.attrs = attrs; }
    closest(selectors) {
      const options = selectors.split(',').map(selector => selector.trim());
      return options.some(selector => selector === this.tag ||
        (selector === '[tabindex]' && 'tabindex' in this.attrs) ||
        (selector === 'a[href]' && this.tag === 'a' && 'href' in this.attrs)) ? this : null;
    }
  }
  const keys = {}, messages = [], clicks = {};
  const audio = {
    volume: 0, addEventListener() {}, play: async () => {},
    pause() {}, removeAttribute() {}, load() {},
  };
  const playButton = new HTMLElement('button');
  playButton.addEventListener = (event, listener) => { clicks[event] = listener; };
  const document = {
    activeElement: new HTMLElement(), body: { classList: { toggle() {} } },
    querySelector: selector => selector === '#stream' ? audio : null,
    querySelectorAll: selector => selector === '.js-play' ? [playButton] : [],
    addEventListener: (event, listener) => { keys[event] = listener; },
  };
  const mod = load('src/renderer/player.ts', {
    '../shared/station': { DEFAULT_VOLUME: .8, STREAM_URL: 'mock://stream' },
    './strings': { strings: {} },
  }, {
    HTMLElement, document,
    window: {
      jazzradio: {
        setStreamState: state => messages.push(state), onPlaybackToggle() {}, onPlaybackReconnect() {},
      },
      addEventListener() {}, clearTimeout() {},
    },
  });
  mod.initPlayer();
  function space(target = new HTMLElement(), extra = {}) {
    document.activeElement = target;
    const event = { code: 'Space', prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    keys.keydown(event);
    return event;
  }
  return { mod, messages, space, HTMLElement, playButton, clicks };
}

test('new renderer publishes stopped playback and Space respects interactive controls', () => {
  const h = playerHarness();
  assert.deepEqual(h.messages, ['stopped']);
  for (const target of [
    h.playButton, new h.HTMLElement('input'), new h.HTMLElement('textarea'),
    new h.HTMLElement('select'), new h.HTMLElement('a', { href: '#' }),
    new h.HTMLElement('div', { tabindex: 0 }),
    Object.assign(new h.HTMLElement('div'), { isContentEditable: true }),
  ]) {
    assert.equal(h.space(target).prevented, false);
    assert.equal(h.mod.isPlaying(), false);
  }
  // The native button activation is free to deliver its one click.
  h.clicks.click();
  assert.equal(h.mod.isPlaying(), true);
  assert.deepEqual(h.messages, ['stopped', 'playing']);
});

test('Space outside controls toggles once; handled, composing and repeated keys are left alone', () => {
  const h = playerHarness();
  for (const extra of [{ defaultPrevented: true }, { isComposing: true }, { repeat: true }, { ctrlKey: true }]) {
    assert.equal(h.space(undefined, extra).prevented, false);
    assert.equal(h.mod.isPlaying(), false);
  }
  assert.equal(h.space().prevented, true);
  assert.equal(h.mod.isPlaying(), true);
  assert.equal(h.space().prevented, true);
  assert.equal(h.mod.isPlaying(), false);
  assert.deepEqual(h.messages, ['stopped', 'playing', 'stopped']);
});

test('macOS close and reopen clears playback state, refreshes Dock and leaves stopped notes unanchored', () => {
  const { Ipc } = load('src/shared/ipc.ts', {});
  const ipcMain = new EventEmitter(), invokes = new Map(), app = new EventEmitter(), windows = [];
  ipcMain.handle = (channel, fn) => invokes.set(channel, fn);
  app.requestSingleInstanceLock = () => true;
  app.setAboutPanelOptions = () => {};
  let attached = null, dockRefreshes = 0, noteAnchor;
  class BrowserWindow extends EventEmitter {
    constructor() {
      super(); windows.push(this); this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
    }
    loadFile() {}
    isDestroyed() { return false; }
    static getAllWindows() { return attached ? [attached] : []; }
  }
  const windowState = {
    getAttachedWindow: () => attached, getWindowMode: () => 'main',
    initialWindowOptions: () => ({}),
    attachWindow(win) { attached = win; win.on('closed', () => { attached = null; }); },
  };
  const poller = {
    getLastNowPlaying: () => ({ track: { artist: 'Artist', title: 'Track' } }),
    stopPoller() {}, onAfterNowPlaying() {},
  };
  const ipc = load('src/main/ipc.ts', {
    electron: { ipcMain }, './language': {}, '../shared/ipc': { Ipc }, '../shared/window': {},
    './poller': poller, './share': {}, './window-state': windowState, './theme': {},
    './store': {
      getNotes: () => [],
      addNote: (text, anchor) => { noteAnchor = anchor; return []; },
    },
  });
  load('src/main/index.ts', {
    './app-identity': {}, './language': { applyLanguageFromSettings() {} },
    electron: { app, BrowserWindow, powerMonitor: new EventEmitter() }, 'node:path': path,
    '../shared/ipc': { Ipc }, '../renderer/strings': { strings: {} }, './ipc': ipc,
    './menu': { setAppMenu() {}, refreshDockMenu: () => { dockRefreshes++; } },
    './poller': poller, './window-state': windowState,
    './theme': { watchTheme() {}, initialBackgroundColor: () => '#000' },
  }, { MAIN_WINDOW_VITE_DEV_SERVER_URL: '', MAIN_WINDOW_VITE_NAME: 'main_window' });
  app.emit('ready');
  ipcMain.emit(Ipc.StreamState, {}, 'playing');
  assert.equal(ipc.getStreamState(), 'playing');
  const beforeClose = dockRefreshes;
  windows[0].emit('closed');
  assert.equal(ipc.getStreamState(), 'stopped');
  assert.equal(dockRefreshes, beforeClose + 1);
  app.emit('activate');
  assert.equal(windows.length, 2);
  invokes.get(Ipc.NotesAdd)({}, 'Written before playback starts again');
  assert.equal(noteAnchor, undefined);
  ipcMain.emit(Ipc.StreamState, {}, 'playing');
  invokes.get(Ipc.NotesAdd)({}, 'Written while playing');
  assert.equal(noteAnchor.title, 'Track');
});
