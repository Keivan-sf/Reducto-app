import assert from 'node:assert/strict';
import test from 'node:test';
import { loadVideoFile } from '../src/lib/video-download.web';

class DownloadXHR {
  static current: DownloadXHR;
  timeout = 0; // XMLHttpRequest's default means no time limit.
  responseType = '';
  status = 200;
  response = new Blob(['downloaded bytes']);
  aborted = false;
  onload = () => {};
  onloadend = () => {};
  onabort = () => {};
  onprogress = (_event: { loaded: number; total: number; lengthComputable: boolean }) => {};
  constructor() {
    DownloadXHR.current = this;
  }
  open() {}
  setRequestHeader() {}
  send() {}
  abort() {
    this.aborted = true;
    this.onabort();
    this.onloadend();
  }
}

function download(t: { after: (fn: () => void) => void }) {
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = DownloadXHR as unknown as typeof XMLHttpRequest;
  t.after(() => {
    globalThis.XMLHttpRequest = original;
  });
  const controller = new AbortController();
  const progress: { received: number; total: number }[] = [];
  const result = loadVideoFile({
    url: 'http://server/file',
    headers: {},
    signal: controller.signal,
    refresh: async () => ({}),
    progress: (value) => progress.push(value),
  });
  return { result, controller, progress, xhr: DownloadXHR.current };
}

test('web downloads have no time limit and still report progress and finish', async (t) => {
  const { result, controller, progress, xhr } = download(t);
  assert.equal(xhr.timeout, 0);
  xhr.onprogress({ loaded: 5, total: xhr.response.size, lengthComputable: true });
  assert.deepEqual(progress, [{ received: 5, total: xhr.response.size }]);
  xhr.onload();
  xhr.onloadend();
  const file = await result;
  assert.equal(file.bytes, xhr.response.size);
  file.dispose();
  controller.abort();
  assert.equal(xhr.aborted, false, 'completed downloads remove their cancellation listener');
});

test('web downloads can still be cancelled explicitly', async (t) => {
  const { result, controller, xhr } = download(t);
  controller.abort();
  await assert.rejects(result, /Download cancelled/);
  assert.equal(xhr.aborted, true);
});
