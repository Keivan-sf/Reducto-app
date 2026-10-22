import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AttachmentCache } from '../src/api/attachment-cache';
import type { AttachmentMetadata } from '../src/api/types';
const attachment: AttachmentMetadata = {
  id: 'media',
  type: 'video',
  width: 640,
  height: 480,
  fileName: 'clip.mp4',
  contentType: 'video/mp4',
  fileSize: 1234,
  thumbnailUrl: 'https://storage.example/thumb.jpg',
};

test('attachment metadata requests are shared, cached, and isolated by conversation', async () => {
  let calls = 0;
  const cache = new AttachmentCache(async (path) => {
    assert.match(path, /^\/api\/conversations\/(chat|other)\/attachments\/media\/metadata$/);
    calls++;
    return { attachment };
  });
  const [a, b] = await Promise.all([cache.get('chat', 'media'), cache.get('chat', 'media')]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  assert.equal(await cache.get('chat', 'media'), a);
  await cache.get('other', 'media');
  assert.equal(calls, 2);
  assert.equal(cache.peek('other', 'media')?.conversationId, 'other');
});

test('upload metadata seeds previews and signed thumbnails renew before expiry', async () => {
  let now = Date.parse('2026-10-19T00:10:00Z');
  let calls = 0;
  const cache = new AttachmentCache(
    async () => {
      calls++;
      return { attachment };
    },
    () => now,
  );
  const entry = cache.remember('chat', {
    ...attachment,
    thumbnailUrl: 'https://storage.example/thumb.jpg?X-Amz-Date=20261019T000000Z&X-Amz-Expires=900',
  });
  assert.equal(entry.renewAt, Date.parse('2026-10-19T00:14:00Z'));
  assert.equal(await cache.get('chat', 'media'), entry);
  assert.equal(calls, 0);
  now = entry.renewAt;
  await cache.get('chat', 'media');
  assert.equal(calls, 1);
});

test('failed metadata requests retry and historical records keep nullable metadata', async () => {
  let calls = 0;
  const cache = new AttachmentCache(async () => {
    if (++calls === 1) throw new Error('offline');
    return { attachment: { ...attachment, width: null, height: null, thumbnailUrl: null } };
  });
  await assert.rejects(cache.get('chat', 'media'), /offline/);
  const entry = await cache.get('chat', 'media');
  assert.equal(entry.attachment.width, null);
  assert.equal(entry.attachment.thumbnailUrl, null);
  assert.equal(calls, 2);
});

test('immutable attachment details without signed thumbnails do not expire on chat reentry', async () => {
  let now = 0;
  let calls = 0;
  const cache = new AttachmentCache(
    async () => {
      calls++;
      return { attachment: { ...attachment, type: 'image', thumbnailUrl: null } };
    },
    () => now,
  );
  const first = await cache.get('chat', 'media');
  now = 24 * 60 * 60 * 1000;
  assert.equal(await cache.get('chat', 'media'), first);
  assert.equal(calls, 1);
  assert.equal(first.renewAt, Infinity);
});
