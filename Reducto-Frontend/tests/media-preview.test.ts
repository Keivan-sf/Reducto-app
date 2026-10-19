import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaPreviewSize } from '../src/lib/media-preview';

test('normal media retains its aspect ratio and small GIFs stay compact', () => {
  for (const size of [
    { width: 160, height: 120 },
    { width: 1080, height: 1920 },
    { width: 500, height: 500 },
  ]) {
    const preview = mediaPreviewSize(size);
    if (size.width / size.height >= 0.6)
      assert.equal(preview.aspectRatio, size.width / size.height);
    assert.ok(preview.width <= Math.max(100, size.width));
    assert.ok(preview.width <= 260);
    assert.ok(preview.width / preview.aspectRatio <= 280);
  }
});

test('extreme media dimensions cannot produce oversized or unusably thin preview frames', () => {
  for (const size of [
    { width: 1000000, height: 1 },
    { width: 1, height: 1000000 },
  ]) {
    const preview = mediaPreviewSize(size);
    assert.ok(preview.aspectRatio >= 0.6 && preview.aspectRatio <= 2.5);
    assert.ok(preview.width <= 260);
    assert.ok(preview.width / preview.aspectRatio <= 280);
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
    assert.ok(Number.isFinite(preview.width) && preview.width > 0 && preview.width <= 260);
    assert.ok(Number.isFinite(preview.aspectRatio) && preview.aspectRatio > 0);
  }
});
