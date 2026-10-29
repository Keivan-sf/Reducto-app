import assert from 'node:assert/strict';
import test from 'node:test';
import { canCopyImage, copyImage } from '../src/lib/copy-image.web';
import { canCopyImage as canCopyNative } from '../src/lib/copy-image';
import type { VideoFile } from '../src/api/video-cache';

test('image clipboard is desktop only and writes image bytes during the click', async (t) => {
  const keys = ['navigator', 'window', 'ClipboardItem'] as const;
  const originals = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  t.after(() => {
    keys.forEach((key, index) => {
      const descriptor = originals[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  });
  let written: Record<string, Promise<Blob>> | undefined;
  const browser = {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    platform: 'Linux x86_64',
    maxTouchPoints: 0,
    clipboard: {
      write: async (items: { data: Record<string, Promise<Blob>> }[]) => {
        written = items[0].data;
        await written['image/png'];
      },
    },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: browser });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { matchMedia: () => ({ matches: true }) },
  });
  Object.defineProperty(globalThis, 'ClipboardItem', {
    configurable: true,
    value: class {
      constructor(public data: Record<string, Promise<Blob>>) {}
    },
  });
  assert.equal(canCopyImage(), true);
  assert.equal(canCopyNative(), false);
  for (const userAgent of ['Android', 'iPhone', 'iPad', 'Mobile']) {
    browser.userAgent = userAgent;
    assert.equal(canCopyImage(), false, userAgent);
  }
  browser.userAgent = 'Mozilla/5.0 (Macintosh)';
  browser.platform = 'MacIntel';
  browser.maxTouchPoints = 5;
  assert.equal(canCopyImage(), false, 'iPad using a desktop user agent');
  browser.maxTouchPoints = 0;
  assert.equal(canCopyImage(), true);

  const blob = new Blob(['image bytes'], { type: 'image/png' });
  let finish!: (file: VideoFile) => void;
  const file = new Promise<VideoFile>((resolve) => {
    finish = resolve;
  });
  const copying = copyImage(() => file);
  assert.ok(written, 'clipboard write starts before the image finishes loading');
  finish({ uri: 'blob:cached', blob, bytes: blob.size, dispose() {} });
  await copying;
  assert.equal(await written['image/png'], blob, 'copies the image bytes, not its URL');
});
