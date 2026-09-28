import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mediaDir = mkdtempSync(path.join(tmpdir(), 'wideo-media-'));
process.env.MEDIA_DIR = mediaDir;
// Testy nie mogą przypadkiem użyć prawdziwych kluczy z .env.
for (const k of ['ANTHROPIC_API_KEY', 'REPLICATE_API_TOKEN', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY']) process.env[k] = '';

const { createServer, safeJoin } = await import('../server/index.js');
const { findUrl } = await import('../server/providers/replicate.js');
const { extensionFor } = await import('../server/jobs.js');
const { PLAN_SCHEMA } = await import('../server/providers/director.js');

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(mediaDir, { recursive: true, force: true });
});

test('safeJoin nie pozwala wyjść poza katalog', () => {
  const root = path.resolve('/srv/app/public');
  assert.equal(safeJoin(root, '/js/app.js'), path.join(root, 'js/app.js'));
  assert.equal(safeJoin(root, '/../../etc/passwd'), path.join(root, 'etc/passwd'));
  assert.equal(safeJoin(root, '/..%2f..%2fetc/passwd'), path.join(root, 'etc/passwd'));
  assert.equal(safeJoin(root, '/%E0%A4%A'), null);
  assert.equal(safeJoin(root, '/a%00b'), null);
});

test('findUrl wyciąga link z różnych formatów wyjścia Replicate', () => {
  assert.equal(findUrl('https://x/y.mp4'), 'https://x/y.mp4');
  assert.equal(findUrl(['https://a/1.png', 'https://a/2.png']), 'https://a/1.png');
  assert.equal(findUrl({ video: 'https://v/1.mp4', meta: 3 }), 'https://v/1.mp4');
  assert.equal(findUrl({ nested: { deep: ['nope', 'https://d/2.wav'] } }), 'https://d/2.wav');
  assert.equal(findUrl(null), null);
  assert.equal(findUrl('not a url'), null);
});

test('extensionFor rozpoznaje typy plików', () => {
  assert.equal(extensionFor('video/mp4'), '.mp4');
  assert.equal(extensionFor('application/octet-stream', 'https://x/file.webm?sig=1'), '.webm');
  assert.equal(extensionFor('', 'https://x/a.JPEG'), '.jpg');
  assert.equal(extensionFor('', '', '.bin'), '.bin');
});

test('schemat scenopisu ma wymagane pola i zakaz dodatkowych', () => {
  const item = PLAN_SCHEMA.properties.scenes.items;
  assert.equal(PLAN_SCHEMA.additionalProperties, false);
  assert.equal(item.additionalProperties, false);
  assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort());
  assert.ok(item.properties.camera.enum.includes('drone-flyover'));
  assert.ok(item.properties.proceduralPreset.enum.includes('ocean'));
});

test('GET /api/status bez kluczy – dostawcy AI niedostępni', async () => {
  const res = await fetch(`${base}/api/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.providers.replicate.available, false);
  assert.equal(body.providers.director.available, false);
  assert.ok(body.providers.replicate.videoModels.length >= 3);
});

test('serwuje studio i blokuje nieznane ścieżki', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /WIdeo Studio/);
  const js = await fetch(`${base}/js/core/timeline.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${base}/nie-ma-mnie.js`)).status, 404);
  assert.equal((await fetch(`${base}/api/nieznany`)).status, 404);
  assert.equal((await fetch(`${base}/media/..%2f..%2fpackage.json`)).status, 404);
});

test('upload + pobieranie z zakresem bajtów (Range) dla przewijania wideo', async () => {
  const data = Buffer.from('0123456789abcdef');
  const up = await fetch(`${base}/api/upload`, { method: 'POST', body: data, headers: { 'X-Filename': encodeURIComponent('mój klip.mp4') } });
  assert.equal(up.status, 200);
  const saved = await up.json();
  assert.equal(saved.kind, 'video');
  assert.match(saved.url, /^\/media\/upload_.*\.mp4$/);
  const full = await fetch(`${base}${saved.url}`);
  assert.equal(await full.text(), '0123456789abcdef');
  const part = await fetch(`${base}${saved.url}`, { headers: { Range: 'bytes=4-7' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 4-7/16');
  assert.equal(await part.text(), '4567');
  const suffix = await fetch(`${base}${saved.url}`, { headers: { Range: 'bytes=-3' } });
  assert.equal(await suffix.text(), 'def');
  const bad = await fetch(`${base}${saved.url}`, { headers: { Range: 'bytes=99-' } });
  assert.equal(bad.status, 416);
});

test('upload odrzuca niedozwolone rozszerzenia', async () => {
  const res = await fetch(`${base}/api/upload`, { method: 'POST', body: 'x', headers: { 'X-Filename': 'skrypt.html' } });
  assert.equal(res.status, 415);
});

test('generowanie bez kluczy kończy się czytelnym błędem zadania', async () => {
  const res = await fetch(`${base}/api/generate/video`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'test' }) });
  const job = await res.json();
  assert.equal(job.status, 'running');
  let state = job;
  for (let i = 0; i < 20 && state.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 25));
    state = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
  }
  assert.equal(state.status, 'error');
  assert.match(state.error, /REPLICATE_API_TOKEN/);
  const dir = await (await fetch(`${base}/api/director`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: 'x' }) })).json();
  for (let i = 0; i < 20 && dir.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 25));
    Object.assign(dir, await (await fetch(`${base}/api/jobs/${dir.id}`)).json());
  }
  assert.match(dir.error, /ANTHROPIC_API_KEY/);
});

test('nieprawidłowy JSON -> 400', async () => {
  const res = await fetch(`${base}/api/generate/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{zły' });
  assert.equal(res.status, 400);
});
