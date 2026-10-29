import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readMusicMetadata, type MusicSource } from '../src/lib/music-metadata';

function source(bytes: Uint8Array, type: string): MusicSource {
  const blob = new Blob([Uint8Array.from(bytes)], { type });
  return { size: blob.size, type, read: (start, end) => blob.slice(start, end).arrayBuffer() };
}

for (const [extension, mime] of [
  ['mp3', 'audio/mpeg'],
  ['m4a', 'audio/mp4'],
  ['flac', 'audio/flac'],
]) {
  test(`reads local ${extension} tags and duration before upload`, async () => {
    const bytes = await readFile(new URL(`./fixtures/music/tagged.${extension}`, import.meta.url));
    const metadata = await readMusicMetadata(source(bytes, mime), new AbortController().signal);
    assert.equal(metadata.title, 'آهنگ Test');
    assert.equal(metadata.artist, 'Test Artist');
    assert.ok(metadata.duration! >= 0.24 && metadata.duration! < 0.4);
  });
}

test('reads embedded cover artwork without a server upload', async () => {
  const original = await readFile(new URL('./fixtures/music/tagged.mp3', import.meta.url));
  const tagSize = original.subarray(6, 10).reduce((size, byte) => (size << 7) | byte, 0);
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=',
    'base64',
  );
  const picture = Buffer.concat([Buffer.from('\0image/png\0\x03\0', 'binary'), image]);
  const frame = Buffer.alloc(10);
  frame.write('APIC');
  frame.writeUInt32BE(picture.length, 4);
  const tags = Buffer.concat([frame, picture, original.subarray(10, 10 + tagSize)]);
  const header = Buffer.from(original.subarray(0, 10));
  for (let i = 0; i < 4; i++) header[9 - i] = (tags.length >>> (i * 7)) & 127;
  const bytes = Buffer.concat([header, tags, original.subarray(10 + tagSize)]);
  const metadata = await readMusicMetadata(
    source(bytes, 'audio/mpeg'),
    new AbortController().signal,
  );
  assert.equal(metadata.title, 'آهنگ Test');
  assert.equal(metadata.coverUrl, `data:image/png;base64,${image.toString('base64')}`);
});

test('missing and malformed tags fall back without blocking the upload', async () => {
  const metadata = await readMusicMetadata(
    source(new Uint8Array(100), 'audio/mpeg'),
    new AbortController().signal,
  );
  assert.equal(metadata.title, undefined);
  assert.equal(metadata.artist, undefined);
  assert.equal(metadata.coverUrl, undefined);
});

test('cancellation stops further local reads', async () => {
  const controller = new AbortController();
  const bytes = await readFile(new URL('./fixtures/music/tagged.mp3', import.meta.url));
  const file = source(bytes, 'audio/mpeg');
  let reads = 0;
  const result = readMusicMetadata(
    {
      ...file,
      async read(start, end) {
        reads++;
        controller.abort();
        return file.read(start, end);
      },
    },
    controller.signal,
  );
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(reads, 1);
});

test('already cancelled metadata reads never access the file', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readMusicMetadata(
      {
        size: 100,
        type: 'audio/mpeg',
        read() {
          throw new Error('Unexpected read');
        },
      },
      controller.signal,
    ),
    { name: 'AbortError' },
  );
});
