import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaDimensions, mediaPreviewSize } from '../src/lib/media-preview';

test('normal media retains its aspect ratio within the preview bounds', () => {
  for (const size of [
    { width: 160, height: 120 },
    { width: 1080, height: 1920 },
    { width: 1080, height: 2400 },
    { width: 1440, height: 3200 },
    { width: 3440, height: 1440 },
    { width: 3840, height: 1080 },
    { width: 500, height: 500 },
  ]) {
    const preview = mediaPreviewSize(size);
    assert.equal(preview.aspectRatio, size.width / size.height);
    assert.ok(preview.width <= 290);
    assert.ok(preview.width / preview.aspectRatio <= 400);
  }
});

test('preview size depends only on aspect ratio regardless of source resolution', () => {
  for (const size of [
    { width: 4, height: 3 },
    { width: 9, height: 20 },
    { width: 1, height: 1 },
    { width: 10, height: 1 },
    { width: 1, height: 10 },
  ]) {
    const preview = mediaPreviewSize(size);
    for (const scale of [10, 100, 1000])
      assert.deepEqual(
        mediaPreviewSize({ width: size.width * scale, height: size.height * scale }),
        preview,
      );
    assert.equal(preview.width, Math.min(290, 400 * preview.aspectRatio));
  }
});

test('extreme media dimensions cannot produce oversized or unusably thin preview frames', () => {
  for (const size of [
    { width: 1000000, height: 1 },
    { width: 1, height: 1000000 },
  ]) {
    const preview = mediaPreviewSize(size);
    assert.ok(preview.aspectRatio >= 0.35 && preview.aspectRatio <= 4);
    assert.ok(preview.width <= 290);
    assert.ok(preview.width / preview.aspectRatio <= 400);
  }
});

test('missing or invalid metadata uses a finite bounded placeholder', () => {
  for (const size of [
    undefined,
    { width: 0, height: 0 },
    { width: Infinity, height: 4 },
    { width: -1, height: 4 },
    { width: 4, height: NaN },
  ]) {
    const preview = mediaPreviewSize(size);
    assert.ok(Number.isFinite(preview.width) && preview.width > 0 && preview.width <= 290);
    assert.equal(preview.aspectRatio, 1);
    assert.equal(preview.width, 290);
  }
});

test('server metadata yields usable dimensions only for positive finite pairs', () => {
  assert.deepEqual(mediaDimensions({ width: 640, height: 480 }), { width: 640, height: 480 });
  for (const media of [
    undefined,
    {},
    { width: null, height: null },
    { width: 640, height: null },
    { width: -1, height: 4 },
    { width: Infinity, height: 4 },
  ])
    assert.equal(mediaDimensions(media), undefined);
});
