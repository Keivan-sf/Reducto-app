import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VideoCache, type VideoFile, type VideoProgress } from '../src/api/video-cache';
import { videoBytes, videoTime } from '../src/lib/video-download.types';

const file = (dispose = () => {}): VideoFile => ({
  uri: 'file:///video.mp4',
  bytes: 1024,
  dispose,
});
test('video cards and the player share a single transfer, progress, and cached result', async () => {
  let requests = 0;
  let report!: (value: VideoProgress) => void;
  let complete!: (file: VideoFile) => void;
  const cache = new VideoCache(async (_key, _signal, progress) => {
    requests++;
    report = progress;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  let notifications = 0;
  const unsubscribe = cache.subscribe('video', () => notifications++);
  const first = cache.get('video');
  const second = cache.get('video');
  assert.equal(first, second);
  await Promise.resolve();
  report({ received: 512, total: 1024 });
  assert.deepEqual(cache.read('video'), {
    status: 'loading',
    progress: { received: 512, total: 1024 },
  });
  const result = file();
  complete(result);
  assert.equal(await first, result);
  assert.equal(await cache.get('video'), result);
  assert.equal(requests, 1);
  assert.ok(notifications >= 3);
  unsubscribe();
  cache.dispose();
});

test('cancelled transfers cannot replace a retry or leak completed files', async () => {
  const completions: ((file: VideoFile) => void)[] = [];
  let disposed = 0;
  const cache = new VideoCache(async () => new Promise((resolve) => completions.push(resolve)));
  const old = cache.get('video');
  const rejected = assert.rejects(old, /cancelled/);
  await Promise.resolve();
  cache.cancel('video');
  assert.deepEqual(cache.read('video'), { status: 'idle' });
  const retry = cache.get('video');
  await Promise.resolve();
  completions[0](file(() => disposed++));
  await rejected;
  assert.equal(disposed, 1);
  assert.equal(cache.read('video').status, 'loading');
  completions[1](file());
  await retry;
  assert.equal(cache.read('video').status, 'ready');
  cache.dispose();
});

test('failed downloads can retry and disposing a session frees files and cancels requests', async () => {
  let attempts = 0;
  let disposed = 0;
  let aborted = false;
  const cache = new VideoCache(async (key, signal) => {
    if (key === 'pending')
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        }),
      );
    if (++attempts === 1) throw new Error('offline');
    return file(() => disposed++);
  });
  await assert.rejects(cache.get('video'), /offline/);
  assert.equal(cache.read('video').status, 'error');
  await cache.get('video');
  const pending = cache.get('pending');
  const rejected = assert.rejects(pending, /aborted/);
  await Promise.resolve();
  cache.dispose();
  await rejected;
  assert.equal(disposed, 1);
  assert.equal(aborted, true);
  assert.equal(cache.read('video').status, 'idle');
});

test('unused cached videos are evicted while subscribed videos stay available', async () => {
  let disposed = 0;
  const cache = new VideoCache(async () => file(() => disposed++));
  const unsubscribe = cache.subscribe('first', () => {});
  await cache.get('first');
  for (let index = 0; index < 15; index++) await cache.get(String(index));
  assert.equal(cache.read('first').status, 'ready');
  assert.equal(cache.read('0').status, 'idle');
  assert.equal(disposed, 4);
  unsubscribe();
  cache.dispose();
});

test('video durations and byte progress labels handle unknown lengths', () => {
  assert.equal(videoTime(80), '1:20');
  assert.equal(videoTime(NaN), '0:00');
  assert.equal(videoBytes(0), '0 B');
  assert.equal(videoBytes(1024), '1.0 KB');
  assert.equal(videoBytes(3.1 * 1024 * 1024), '3.1 MB');
});

test('the cache also bounds unused video bytes and keeps the file just returned', async () => {
  const disposed: string[] = [];
  const cache = new VideoCache(async (key) => ({
    uri: key,
    bytes: 80 * 1024 * 1024,
    dispose: () => disposed.push(key),
  }));
  await cache.get('first');
  await cache.get('second');
  assert.deepEqual(disposed, ['first']);
  assert.equal(cache.read('second').status, 'ready');
  cache.dispose();
});

test('files removed by the operating system are downloaded again instead of reusing stale cache entries', async () => {
  let exists = true;
  let calls = 0;
  let disposed = 0;
  const cache = new VideoCache(async () => {
    calls++;
    return { ...file(() => disposed++), exists: () => exists };
  });
  await cache.get('video');
  assert.equal(calls, 1);
  exists = false;
  const retry = cache.get('video');
  assert.equal(cache.read('video').status, 'loading');
  exists = true;
  await retry;
  assert.equal(calls, 2);
  assert.equal(disposed, 1);
  assert.equal(cache.read('video').status, 'ready');
  cache.dispose();
});

test('uploaded file bytes seed the cache and are reused without a download', async () => {
  let requests = 0;
  let disposed = 0;
  const cache = new VideoCache(async () => {
    requests++;
    return file();
  });
  const uploaded = { ...file(() => disposed++), name: 'original.pdf', mimeType: 'application/pdf' };
  cache.remember('uploaded', uploaded);
  assert.equal(cache.read('uploaded').status, 'ready');
  assert.equal(await cache.get('uploaded'), uploaded);
  assert.equal(requests, 0);
  cache.dispose();
  assert.equal(disposed, 1);
});

test('an uploaded original supersedes an in-flight download and releases its result', async () => {
  let complete!: (value: VideoFile) => void;
  let disposed = 0;
  const cache = new VideoCache(
    async () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = cache.get('uploaded');
  const rejected = assert.rejects(pending, /cancelled/);
  await Promise.resolve();
  const original = file();
  cache.remember('uploaded', original);
  complete(file(() => disposed++));
  await rejected;
  assert.equal(disposed, 1);
  assert.equal(await cache.get('uploaded'), original);
  cache.forget('uploaded');
  assert.equal(cache.read('uploaded').status, 'idle');
});
