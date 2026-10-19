import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createProxy } from '../scripts/proxy.mjs';

test('web proxy handles preflight and forwards authorization and multipart bytes', async () => {
  const backend = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer token');
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          contentType: request.headers['content-type'],
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const proxy = createProxy(new URL(`http://127.0.0.1:${(backend.address() as AddressInfo).port}`));
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    const preflight = await fetch(`${base}/api/settings/avatar`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:8081' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8081');
    const form = new FormData();
    form.append('file', new Blob(['file-content']), 'test.txt');
    const response = await fetch(`${base}/api/upload`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:8081', Authorization: 'Bearer token' },
      body: form,
    });
    const result = await response.json();
    assert.match(result.contentType, /multipart\/form-data; boundary=/);
    assert.match(result.body, /file-content/);
    assert.equal(
      (await fetch(`${base}/api/test`, { headers: { Origin: 'https://unrelated.example' } }))
        .status,
      403,
    );
  } finally {
    proxy.closeAllConnections();
    backend.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => proxy.close(resolve)),
      new Promise((resolve) => backend.close(resolve)),
    ]);
  }
});
