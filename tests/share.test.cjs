/* Run: node --test tests/share.test.cjs. Mocked dialog/files; no Electron launch. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = path.resolve(__dirname, '../src/main/share.ts');
function harness(result, writeError) {
  const writes = [], dialogs = [], errors = [];
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mocks = {
    electron: { app: { getPath: () => '/Documents' }, dialog: {
      showSaveDialog: async options => { dialogs.push(options); return result; },
      showErrorBox: (...args) => errors.push(args),
    } },
    'node:fs/promises': { writeFile: async (...args) => {
      if (writeError) throw writeError;
      writes.push(args);
    } },
    'node:path': path,
    '../shared/export': { notesFilename: () => 'Notes.txt', favoritesFilename: () => 'Favorites.txt', berlinClock: () => '22:36', deNumericDate: () => '22.09.2026' },
    '../renderer/strings': { strings: {
      appName: 'JazzRadio', notes: 'Notes', shareFile: 'Save', noteSave: 'Save', textFile: 'Text',
      exportFailed: 'Could not save the file', exportFailedDetail: 'Please choose another location or try again.',
    } },
    './store': { getNotes: () => [
      { text: '  # My words\n*Keep these*  ', createdAt: '2026-09-22T20:36:00Z', anchor: { title: 'Title', artist: 'Artist', at: '2026-09-22T20:36:00Z' } },
      { text: 'Earlier note', createdAt: '2026-09-22T19:00:00Z' },
    ], getFavorites: () => [] },
    './window-state': { getAttachedWindow: () => null },
  };
  vm.runInNewContext(code, { module, exports: module.exports, process, require: name => {
    if (!(name in mocks)) throw Error(`Unexpected dependency: ${name}`);
    return mocks[name];
  } }, { filename: source });
  return { runShare: module.exports.runShare, writes, dialogs, errors };
}
test('exports to the exact approved destination, including names without extensions', async () => {
  for (const kind of ['notes', 'favorites']) {
    for (const chosen of ['/chosen/My radio list', '/chosen/Custom.name']) {
      const h = harness({ canceled: false, filePath: chosen });
      await h.runShare(kind, 'file');
      assert.equal(h.writes.length, 1);
      assert.equal(h.writes[0][0], chosen);
      assert.equal(h.writes[0][2], 'utf8');
      if (kind === 'notes') {
        assert.equal(h.writes[0][1], 'JazzRadio — Notes\n\n  # My words\n*Keep these*  \n\n22:36 · Title — Artist · 22.09.2026\n\nEarlier note\n\n22.09.2026\n');
      }
      assert.equal(h.dialogs[0].defaultPath, path.join('/Documents', kind === 'notes' ? 'Notes.txt' : 'Favorites.txt'));
      assert.equal(h.dialogs[0].filters[0].extensions[0], 'txt');
      assert.deepEqual(h.errors, []);
    }
  }
});
test('canceled or missing save destination never writes a file', async () => {
  for (const result of [{ canceled: true, filePath: '/chosen/ignored' }, { canceled: false }]) {
    const h = harness(result);
    await h.runShare('notes', 'file');
    assert.equal(h.writes.length, 0);
    assert.deepEqual(h.errors, []);
  }
});

test('failed exports report an actionable error without exposing internal details', async () => {
  for (const kind of ['notes', 'favorites']) {
    for (const code of ['ENOSPC', 'EACCES']) {
      const h = harness({ canceled: false, filePath: '/chosen/list.txt' },
        Object.assign(new Error('Internal path and error details'), { code }));
      await h.runShare(kind, 'file');
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.errors, [[
        'Could not save the file', 'Please choose another location or try again.',
      ]]);
    }
  }
});
