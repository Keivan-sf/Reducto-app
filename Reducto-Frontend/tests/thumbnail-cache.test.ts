import assert from 'node:assert/strict';
import test from 'node:test';
import { ThumbnailCache } from '../src/api/thumbnail-cache';
import type { VideoFile } from '../src/api/video-cache';

const file = (): VideoFile => ({ uri: 'file:///thumbnail.jpg', bytes: 100, dispose: () => {} });

test('a thumbnail is downloaded once per media identity across signed URL changes', async () => {
  const urls: string[] = [];
  const cache = new ThumbnailCache(async (url) => {
    urls.push(url);
    return file();
  });
  const first = await cache.get('video:chat:media', 'https://example.test/thumb.jpg?token=one');
  const second = await cache.get('video:chat:media', 'https://example.test/thumb.jpg?token=two');
  assert.equal(first, second);
  assert.deepEqual(urls, ['https://example.test/thumb.jpg?token=one']);
  cache.dispose();
});

test('a pending thumbnail retries when a renewed URL arrives', async () => {
  let fail!: () => void;
  const urls: string[] = [];
  const cache = new ThumbnailCache(async (url) => {
    urls.push(url);
    if (url.endsWith('old'))
      await new Promise<void>((_resolve, reject) => {
        fail = () => reject(new Error('expired'));
      });
    return file();
  });
  const first = cache.get('gif:media', 'https://example.test/old');
  await Promise.resolve();
  const second = cache.get('gif:media', 'https://example.test/new');
  fail();
  assert.equal(await first, await second);
  assert.deepEqual(urls, ['https://example.test/old', 'https://example.test/new']);
  cache.dispose();
});
