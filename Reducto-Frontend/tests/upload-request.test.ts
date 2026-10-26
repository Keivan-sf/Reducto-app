import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadRequest } from '../src/api/upload-request';
import { ApiClient } from '../src/api/client';
import type { Session } from '../src/api/types';

class UploadXHR {
  static instances: UploadXHR[] = [];
  headers = new Map<string, string>();
  upload = {
    onprogress: (_event: { loaded: number; total: number; lengthComputable: boolean }) => {},
  };
  onload = () => {};
  onerror = () => {};
  onabort = () => {};
  responseText = '';
  status = 201;
  aborted = false;
  body?: FormData;
  constructor() {
    UploadXHR.instances.push(this);
  }
  open(method: string, url: string) {
    assert.equal(method, 'POST');
    assert.ok(url.startsWith('http://server/'));
  }
  setRequestHeader(key: string, value: string) {
    this.headers.set(key, value);
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload();
  }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function install(t: { after: (fn: () => void) => void }) {
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = UploadXHR as unknown as typeof XMLHttpRequest;
  UploadXHR.instances = [];
  t.after(() => {
    globalThis.XMLHttpRequest = original;
  });
}

test('upload transport reports actual sent bytes, preserves auth and removes abort listener on completion', async (t) => {
  install(t);
  const controller = new AbortController();
  const values: number[][] = [];
  const body = new FormData();
  body.append('file', new Blob(['hello']), 'hello.txt');
  const result = uploadRequest(
    'http://server/upload',
    { body, headers: { Authorization: 'Bearer token' }, signal: controller.signal },
    (sent, total) => values.push([sent, total]),
  );
  const xhr = UploadXHR.instances[0];
  assert.equal(xhr.body, body);
  assert.equal(xhr.headers.get('authorization'), 'Bearer token');
  xhr.upload.onprogress({ loaded: 2, total: 5, lengthComputable: true });
  xhr.upload.onprogress({ loaded: 4, total: 0, lengthComputable: false });
  assert.deepEqual(values, [
    [2, 5],
    [4, 0],
  ]);
  xhr.respond(201, { attachment: { id: 'file' } });
  assert.deepEqual(await (await result).json(), { attachment: { id: 'file' } });
  controller.abort();
  assert.equal(xhr.aborted, false);
});

test('cancelling an upload aborts its network request and rejects with AbortError', async (t) => {
  install(t);
  const controller = new AbortController();
  const result = uploadRequest(
    'http://server/upload',
    { body: new FormData(), signal: controller.signal },
    () => {},
  );
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(UploadXHR.instances[0].aborted, true);
});

test('authenticated progress uploads retry with refreshed credentials and the same multipart body', async (t) => {
  install(t);
  const api = new ApiClient('http://server');
  api.setSession({
    serverUrl: 'http://server',
    user: { id: 'me' },
    accessToken: 'old',
    refreshToken: 'refresh',
  } as Session);
  api.refresh = async () => {
    api.setSession({ ...api.getSession()!, accessToken: 'new' });
  };
  const body = new FormData();
  body.append('kind', 'music');
  const progress: number[] = [];
  const result = api.request('/upload', { method: 'POST', body }, true, true, (sent) =>
    progress.push(sent),
  );
  UploadXHR.instances[0].respond(401, { error: 'Expired' });
  await tick();
  const retry = UploadXHR.instances[1];
  assert.equal(retry.headers.get('authorization'), 'Bearer new');
  assert.equal(retry.body, body);
  retry.upload.onprogress({ loaded: 3, total: 5, lengthComputable: true });
  retry.respond(201, { attachment: { id: 'music' } });
  assert.deepEqual(await result, { attachment: { id: 'music' } });
  assert.deepEqual(progress, [3]);
});
