/* Deterministic locale/settings coverage, without Electron or user stores. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function harness() {
  const cache = new Map(), disk = {};
  let preferred = ['de-CH'], fallback = 'en-US';
  class Store {
    constructor({ defaults }) { for (const [k,v] of Object.entries(defaults)) if (!(k in disk)) disk[k] = v; }
    get(key) { return disk[key]; }
    set(key, value) { disk[key] = value; }
  }
  function load(relative) {
    const file = path.resolve(__dirname, '..', relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(js, { module, exports: module.exports, console, require(name) {
      if (name === 'electron-store') return { default: Store };
      if (name === 'electron') return { app: { getPreferredSystemLanguages: () => preferred, getLocale: () => fallback } };
      return name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name);
    } });
    return module.exports;
  }
  return { load, disk, system: (p, f) => { preferred = p; fallback = f; } };
}
test('system language follows primary OS preference, with explicit overrides and fallback', () => {
  const h = harness(), strings = h.load('src/renderer/strings.ts');
  for (const locale of ['de', 'de-DE', 'de-CH', 'DE_at']) assert.equal(strings.resolveLanguage('system', locale), 'de');
  for (const locale of ['en-GB', 'pl-PL', 'fr-DE', '']) assert.equal(strings.resolveLanguage('system', locale), 'en');
  assert.equal(strings.resolveLanguage('en', 'de-DE'), 'en');
  assert.equal(strings.resolveLanguage('de', 'en-US'), 'de');
  const language = h.load('src/main/language.ts');
  let changes = 0; language.onLanguageChanged(() => changes++);
  language.applyLanguageFromSettings(); assert.equal(language.getLocalizedSettings().resolvedLanguage, 'de');
  h.system(['fr-FR', 'de-DE'], 'de-DE'); language.applyLanguageFromSettings();
  assert.equal(language.getLocalizedSettings().resolvedLanguage, 'en');
  h.system([], 'de-DE'); language.applyLanguageFromSettings(); assert.equal(changes, 3);
});
test('language settings persist only supported preferences and never renderer-supplied resolved language', () => {
  const h = harness(), store = h.load('src/main/store.ts');
  assert.equal(store.getSettings().language, 'system');
  store.updateSettings({ language: 'de', resolvedLanguage: 'en' });
  assert.equal(store.getSettings().language, 'de'); assert.equal(h.disk.resolvedLanguage, undefined);
  store.updateSettings({ language: 'fr' }); assert.equal(h.disk.language, 'de');
  store.updateSettings({ language: 'en' }); assert.equal(h.disk.language, 'en');
  store.updateSettings({ language: 'system' }); assert.equal(h.disk.language, 'system');
});
test('live dictionary and export dates/filenames change locale without changing Berlin day boundaries', () => {
  const h = harness(), locale = h.load('src/renderer/strings.ts'), format = h.load('src/shared/export.ts');
  const ref = locale.strings, date = new Date('2026-09-19T23:30:00Z');
  locale.setLanguage('de');
  assert.equal(ref.notes, 'Notizen'); assert.equal(format.deNumericDate(date), '20.09.2026');
  assert.equal(format.notesFilename(date), 'JazzRadio-Notizen-2026-09-20.txt');
  const keys = Object.keys(ref);
  locale.setLanguage('en');
  assert.equal(ref.notes, 'Notes'); assert.equal(format.deNumericDate(date), '20/09/2026');
  assert.equal(format.notesFilename(date), 'JazzRadio-Notes-2026-09-20.txt');
  assert.equal(format.berlinClock(date.toISOString()), '01:30');
  assert.deepEqual(Object.keys(ref), keys);
  for (const value of Object.values(ref)) assert.equal(typeof value, 'string');
});
