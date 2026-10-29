import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { mediaDimensions } from '../src/lib/media-preview';

function probe() {
  const events = new Map<string, (event?: unknown) => void>();
  let released = 0;
  let framesReleased = 0;
  const module = { exports: {} as typeof import('../src/lib/upload-dimensions') };
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/lib/upload-dimensions.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  );
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    DOMException,
    require(name: string) {
      if (name === './media-preview') return { mediaDimensions };
      if (name === 'react-native') return { Platform: { OS: 'android' } };
      if (name === 'expo-video')
        return {
          createVideoPlayer: () => ({
            addListener(name: string, listener: (event?: unknown) => void) {
              events.set(name, listener);
              return { remove: () => events.delete(name) };
            },
            replaceAsync: async () => {},
            generateThumbnailsAsync: async () => [
              {
                width: 1080,
                height: 1920,
                release: () => framesReleased++,
              },
            ],
            release: () => released++,
          }),
        };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return {
    read: module.exports.readUploadDimensions,
    events,
    released: () => released,
    framesReleased: () => framesReleased,
  };
}

test('native videos use decoded display dimensions and release probe resources', async () => {
  const t = probe();
  const result = t.read('file:portrait.mp4', 'video', new AbortController().signal);
  // Encoded track dimensions can be landscape for a rotated portrait video.
  t.events.get('sourceLoad')!({ availableVideoTracks: [{ size: { width: 1920, height: 1080 } }] });
  const size = await result;
  assert.equal(size.width, 1080);
  assert.equal(size.height, 1920);
  assert.equal(t.released(), 1);
  assert.equal(t.framesReleased(), 1);
  assert.equal(t.events.size, 0);
});

test('cancelled native dimension reads release the player and reject promptly', async () => {
  const t = probe();
  const controller = new AbortController();
  const result = t.read('file:video.mp4', 'video', controller.signal);
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(t.released(), 1);
  assert.equal(t.events.size, 0);
});

test('unreadable native videos reject and release the player', async () => {
  const t = probe();
  const result = t.read('file:broken.mp4', 'video', new AbortController().signal);
  t.events.get('statusChange')!({ status: 'error', error: { message: 'Invalid video' } });
  await assert.rejects(result, /Invalid video/);
  assert.equal(t.released(), 1);
  assert.equal(t.events.size, 0);
});
