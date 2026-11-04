import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { compressAssets, createProductionServer } from '../scripts/production.mjs';

let directory, server, port;
const bundle = '/_expo/static/js/web/index-0123456789abcdef0123456789abcdef.js';
const source = 'console.log("production");\n'.repeat(200);

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'reducto-production-'));
  const root = join(directory, 'web');
  await mkdir(join(root, '_expo/static/js/web'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<html>Reducto</html>');
  await writeFile(join(root, bundle), source);
  await writeFile(join(directory, 'secret'), 'outside export');
  await symlink(join(directory, 'secret'), join(root, 'leak.txt'));
  await writeFile(join(root, '.env'), 'private');
  await compressAssets(root);
  server = await createProductionServer(root);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise((done) => server.close(done));
  if (directory) await rm(directory, { recursive: true, force: true });
});

function get(path, headers = {}, method = 'GET') {
  return new Promise((done, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
      );
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the SPA and direct navigation, but never HTML for missing assets', async () => {
  assert.equal((await get('/')).body.toString(), '<html>Reducto</html>');
  const route = await get('/api/groups/join/invite-token', { accept: 'text/html' });
  assert.equal(route.status, 200);
  assert.equal(route.headers['cache-control'], 'no-cache');
  assert.equal((await get('/missing.js', { accept: 'text/html' })).status, 404);
  assert.equal((await get('/_expo/missing', { accept: 'text/html' })).status, 404);
});

test('serves precompressed assets, honors q=0, and caches hashed assets', async () => {
  for (const [accept, expected, decompress] of [
    ['gzip, br', 'br', brotliDecompressSync],
    ['br;q=0, gzip;q=1', 'gzip', gunzipSync],
    ['br;q=0, gzip;q=0', undefined, (data) => data],
  ]) {
    const result = await get(bundle, { 'accept-encoding': accept });
    assert.equal(result.status, 200);
    assert.equal(result.headers['content-encoding'], expected);
    assert.equal(result.headers.vary, 'Accept-Encoding');
    assert.equal(result.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.match(result.headers['cache-control'], /immutable/);
    assert.equal(decompress(result.body).toString(), source);
  }
});

test('supports HEAD, conditional requests, and rejects writes', async () => {
  const result = await get(bundle);
  assert.equal((await get(bundle, { 'if-none-match': result.headers.etag })).status, 304);
  const head = await get(bundle, {}, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers['content-length']), Buffer.byteLength(source));
  assert.equal((await get('/', {}, 'POST')).status, 405);
});

test('rejects traversal, hidden files, symlink escapes, and malformed paths', async () => {
  for (const path of ['/../secret', '/%2e%2e/secret', '/.env', '/leak.txt', `${bundle}.br`]) {
    assert.equal((await get(path)).status, 404, path);
  }
  assert.equal((await get('/%ZZ')).status, 400);
});
