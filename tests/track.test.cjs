/* Run: node --test tests/track.test.cjs. No Electron or network access. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL,
    require: name => load(path.resolve(path.dirname(file), name + '.ts')),
  }, { filename: file });
  return module.exports;
}
const { toTrack } = load(path.resolve(__dirname, '../src/shared/track.ts'));

test('repairs the live Seth MacFarlane title and preserves feed artwork/time', () => {
  const input = {
    title: 'Seth MacFarlane - Let\u0092s Face The Music And Dance',
    artwork_url: 'https://is1-ssl.mzstatic.com/image/thumb/example/100x100bb.jpg',
    start_time: '2026-09-20T10:00:00Z',
  };
  const track = toTrack(input);
  assert.equal(track.artist, 'Seth MacFarlane');
  assert.equal(track.title, 'Let’s Face The Music And Dance');
  assert.equal(track.artworkUrl, input.artwork_url);
  assert.equal(track.startTime, input.start_time);
  assert.equal(input.title, 'Seth MacFarlane - Let\u0092s Face The Music And Dance');
});

test('repairs only the known punctuation in both artist and title before first ASCII delimiter', () => {
  const track = toTrack({ title: '\u0091Artist\u0092\u0096Band - \u0093Title\u0094\u0085\u0097Encore - Live' });
  assert.equal(track.artist, '‘Artist’–Band');
  assert.equal(track.title, '“Title”…—Encore - Live');
  assert.equal(track.artworkUrl, null);
  assert.equal(track.startTime, null);
});

test('preserves valid Unicode, ordinary apostrophes and unrecognized controls', () => {
  const artist = "Björk O'Connor – 東京 🎷";
  const title = '‘L’été’ “Łódź” — Привет … e\u0301 \u0081\u0095';
  const track = toTrack({ title: `${artist} - ${title}` });
  assert.equal(track.artist, artist);
  assert.equal(track.title, title);
});

test('non-ASCII dashes do not become split delimiters; absent titles remain absent', () => {
  const track = toTrack({ title: '  Artist \u0096 Let\u0092s Play  ' });
  assert.equal(track.artist, 'JazzRadio Berlin');
  assert.equal(track.title, 'Artist – Let’s Play');
  assert.equal(toTrack({}), null);
  assert.equal(toTrack({ title: '  ' }), null);
});
