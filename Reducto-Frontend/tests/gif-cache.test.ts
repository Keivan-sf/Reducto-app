import test from 'node:test';
import assert from 'node:assert/strict';
import { GifCache } from '../src/api/gif-cache';
import type { Gif } from '../src/api/types';

const gif: Gif = {
  id: 'gif-id',
  objectKey: 'gifs/test.mp4',
  fileSize: 100,
  createdAt: '2026-10-19T00:00:00Z',
  playbackUrl: 'https://storage.example/test.mp4',
};

test('GIF lookups share a request and reuse a cached URL until renewal', async () => {
  let now = 0;
  let calls = 0;
  const cache = new GifCache(
    async (path) => {
      assert.equal(path, '/api/gifs/gif-id');
      calls++;
      return { gif: { ...gif, playbackUrl: `${gif.playbackUrl}?version=${calls}` } };
    },
    () => now,
  );
  const [a, b] = await Promise.all([cache.get(gif.id), cache.get(gif.id)]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  now = 9 * 60 * 1000;
  assert.equal(await cache.get(gif.id), a);
  now = 10 * 60 * 1000;
  assert.notEqual((await cache.get(gif.id)).gif.playbackUrl, a.gif.playbackUrl);
  assert.equal(calls, 2);
});

test('library and upload responses seed the cache; old presigned URLs renew early', async () => {
  const now = Date.parse('2026-10-19T00:10:00Z');
  let calls = 0;
  const cache = new GifCache(
    async () => {
      calls++;
      return { gif };
    },
    () => now,
  );
  const entry = cache.remember({
    ...gif,
    playbackUrl: 'https://storage.example/test.mp4?X-Amz-Date=20261019T000000Z&X-Amz-Expires=900',
  });
  assert.equal(entry.renewAt, Date.parse('2026-10-19T00:14:00Z'));
  assert.equal(await cache.get(gif.id), entry);
  assert.equal(calls, 0);
  cache.remember({
    ...gif,
    playbackUrl: 'https://storage.example/test.mp4?X-Amz-Date=20261018T000000Z&X-Amz-Expires=900',
  });
  await cache.get(gif.id);
  assert.equal(calls, 1);
});

test('failed GIF lookups can retry and session caches stay independent', async () => {
  let calls = 0;
  const cache = new GifCache(async () => {
    if (++calls === 1) throw new Error('Unavailable');
    return { gif };
  });
  await assert.rejects(cache.get(gif.id));
  assert.equal((await cache.get(gif.id)).gif, gif);
  const otherSession = new GifCache(async () => {
    throw new Error('Unauthorized');
  });
  await assert.rejects(otherSession.get(gif.id), /Unauthorized/);
});
