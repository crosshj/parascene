import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('Chrome carries the visible grouped image into the drag payload', { skip: !existsSync(chrome) }, async () => {
 const bundle = await rollup({ input: 'test/fixtures/grouped-card-browser-entry.js', plugins: [nodeResolve(), {
  name: 'ignore-style-and-fragment',
  resolveId(source, importer) { if (/\.(css|html)$/.test(source) && importer) return path.resolve(path.dirname(importer), source); },
  load(id) { if (id.endsWith('.css')) return 'export default "";'; if (id.endsWith('.html')) return 'export default "";'; },
 }] });
 const generated = await bundle.generate({ format: 'iife', name: 'GroupedCardTest' });
 await bundle.close();
 const app = express();
 app.get('/', (_req, res) => res.type('html').send('<!doctype html><html><body><script src="/bundle.js"></script></body></html>'));
 app.get('/bundle.js', (_req, res) => res.type('js').send(generated.output[0].code));
 const server = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
 const profile = await mkdtemp(path.join(tmpdir(), 'grouped-card-chrome-'));
 try {
  const { stdout } = await promisify(execFile)(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
   `--user-data-dir=${profile}`, '--virtual-time-budget=4000', '--dump-dom', `http://127.0.0.1:${server.address().port}/`], { timeout: 20000, maxBuffer: 5_000_000 });
  const match = stdout.match(/data-result="([^"]+)"/);
  assert.ok(match, stdout.slice(0, 1000));
  const result = JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  assert.equal(result.mounted, true);
  assert.equal(result.selectedId, '92');
  assert.equal(result.activeIndex, 1);
  assert.equal(result.payload.creationId, 92);
  assert.equal(result.payload.groupId, 50);
  assert.match(result.payload.imageUrl, /blue\.png/);
 } finally {
  await new Promise(done => server.close(done));
  await rm(profile, { recursive: true, force: true });
 }
});
