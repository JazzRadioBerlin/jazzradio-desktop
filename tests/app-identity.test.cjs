/* Startup contract: a display rename must not change storage/keychain identity. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function start(language) {
  const cache = new Map(), handlers = new Map(), observed = {};
  let name = require('../package.json').productName;
  const app = {
    setName(value) { name = value; },
    on(event, callback) { handlers.set(event, callback); },
    requestSingleInstanceLock() { observed.lockIdentity = name; return true; },
    setAboutPanelOptions(options) { observed.about = options; },
  };
  class BrowserWindow {
    constructor(options) { observed.window = options; }
    webContents = { on() {}, setWindowOpenHandler() {} };
    on() {}
    loadFile() {}
  }
  const mocks = {
    electron: { app, BrowserWindow, powerMonitor: { on() {} }, Menu: {
      buildFromTemplate: template => template,
      setApplicationMenu: template => { observed.menu = template; },
    } },
    './language': {
      applyLanguageFromSettings() { load('src/renderer/strings.ts').setLanguage(language); },
      onLanguageChanged() {},
    },
    './ipc': {
      registerIpc() { observed.ipcIdentity = name; },
      getStreamState: () => 'stopped', onStreamStateChanged() {},
    },
    './poller': { onAfterNowPlaying() {} },
    './theme': { watchTheme() {}, initialBackgroundColor: () => '#000000' },
    './window-state': { initialWindowOptions: () => ({}), attachWindow() {}, canEnterMini: () => true },
    './share': {},
  };
  function load(relative) {
    const file = path.resolve(__dirname, '..', relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, console, __dirname: path.dirname(file),
      process: { platform: 'darwin' }, MAIN_WINDOW_VITE_DEV_SERVER_URL: '', MAIN_WINDOW_VITE_NAME: 'main_window',
      require(specifier) {
        // A module may open a store as soon as it loads, before ready or IPC.
        if (specifier === './language') observed.firstApplicationModuleIdentity = name;
        if (specifier in mocks) return mocks[specifier];
        return specifier.startsWith('.')
          ? load(path.resolve(path.dirname(file), `${specifier}.ts`)) : require(specifier);
      },
    }, { filename: file });
    return module.exports;
  }
  load('src/main/index.ts');
  handlers.get('ready')();
  return { ...observed, name, strings: load('src/renderer/strings.ts').strings };
}

test('renamed app retains the shipped internal identity before modules, IPC and the instance lock', () => {
  const result = start('en');
  assert.equal(require('../package.json').productName, 'JazzRadio');
  assert.equal(result.firstApplicationModuleIdentity, 'JazzRadio Berlin');
  assert.equal(result.ipcIdentity, 'JazzRadio Berlin');
  assert.equal(result.lockIdentity, 'JazzRadio Berlin');
  assert.equal(result.name, 'JazzRadio Berlin');
});

test('window, native menu and About use the new app name in both languages', () => {
  for (const language of ['de', 'en']) {
    const result = start(language);
    assert.equal(result.window.title, 'JazzRadio');
    assert.equal(result.about.applicationName, 'JazzRadio');
    assert.equal(result.menu[0].label, 'JazzRadio');
    assert.equal(result.strings.stationName, 'JazzRadio Berlin');
    for (const role of ['about', 'hide', 'quit']) {
      const label = result.menu[0].submenu.find(item => item.role === role).label;
      assert.ok(label.includes('JazzRadio'));
      assert.ok(!label.includes('Berlin'));
    }
  }
});
