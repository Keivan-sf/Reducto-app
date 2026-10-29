import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { VideoFile } from '../src/api/video-cache';
import { capJpegDensity, imageDensity } from '../src/lib/image-density';

function compressor(platform: 'android' | 'web', fail = false, width = 320, height = 240) {
  const calls: unknown[] = [];
  const encoded: VideoFile = {
    uri: 'cache:encoded-jpeg',
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    bytes: 87,
    dispose() {},
  };
  const module = { exports: {} as typeof import('../src/lib/compress-image-upload') };
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/lib/compress-image-upload.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  );
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    URL: {
      revokeObjectURL: (uri: string) => calls.push(['revoke', uri]),
      createObjectURL: () => 'temp:normalized',
    },
    Blob,
    fetch: async () => ({
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    }),
    require(name: string) {
      if (name === './image-density') return { capJpegDensity, imageDensity };
      if (name === 'react-native') return { Platform: { OS: platform } };
      if (name === 'expo-file-system')
        return {
          File: class {
            exists = true;
            constructor(public uri: string) {}
            async bytes() {
              return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
            }
            write(bytes: Uint8Array) {
              assert.deepEqual(imageDensity(bytes), { x: 96, y: 96 });
            }
            delete() {
              calls.push(['delete', this.uri]);
            }
          },
        };
      if (name === 'expo-image-manipulator')
        return {
          SaveFormat: { JPEG: 'jpeg' },
          ImageManipulator: {
            manipulate: (uri: string) => {
              calls.push(['source', uri]);
              return {
                resize: (size: { width: number; height: number }) => {
                  calls.push(['resize', size]);
                  width = size.width;
                  height = size.height;
                },
                release: () => calls.push('release context'),
                renderAsync: async () => ({
                  width,
                  height,
                  release: () => calls.push('release image'),
                  saveAsync: async (options: unknown) => {
                    calls.push(['encode', options]);
                    return { uri: 'temp:jpeg' };
                  },
                }),
              };
            },
          },
        };
      if (name === './local-attachments')
        return {
          retainUpload: async (asset: unknown) => {
            calls.push(['retain', asset]);
            if (fail) throw new Error('Cache copy failed');
            return encoded;
          },
        };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { compress: module.exports.compressImageUpload, calls, encoded };
}

for (const platform of ['android', 'web'] as const) {
  for (const [width, height, expected] of [
    [4000, 2000, { width: 1280, height: 640 }],
    [2000, 4000, { width: 640, height: 1280 }],
    [2560, 2560, { width: 1280, height: 1280 }],
    [1280, 720, undefined],
    [64, 32, undefined],
  ] as const) {
    test(`${platform} ${width}×${height} images fit within 1280 pixels without upscaling`, async () => {
      const { compress, calls } = compressor(platform, false, width, height);
      const output = await compress({ uri: 'owned:source', bytes: 100, dispose() {} });
      assert.equal(output.width, expected?.width ?? width);
      assert.equal(output.height, expected?.height ?? height);
      const resize = calls.find((call) => Array.isArray(call) && call[0] === 'resize');
      assert.deepEqual(
        JSON.parse(JSON.stringify(resize ?? null)),
        expected ? ['resize', expected] : null,
      );
    });
  }
  test(`${platform} image uploads retain JPEG bytes at 87% quality and clean up temporary resources`, async () => {
    const { compress, calls, encoded } = compressor(platform);
    const output = await compress({
      uri: 'owned:source-png',
      name: 'photo.PNG',
      bytes: 100,
      dispose() {
        throw new Error('The caller owns the source');
      },
    });
    assert.equal(output, encoded);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
      ['source', 'owned:source-png'],
      ['encode', { format: 'jpeg', compress: 0.87 }],
      [
        'retain',
        {
          uri: platform === 'web' ? 'temp:normalized' : 'temp:jpeg',
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
        },
      ],
      ...(platform === 'web' ? [['revoke', 'temp:normalized']] : []),
      [platform === 'web' ? 'revoke' : 'delete', 'temp:jpeg'],
      'release image',
      'release context',
    ]);
  });
  test(`${platform} failed compression cache copies release the generated JPEG and image resources`, async () => {
    const { compress, calls } = compressor(platform, true);
    await assert.rejects(
      compress({ uri: 'owned:source', bytes: 100, dispose() {} }),
      /Cache copy failed/,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(-3))), [
      [platform === 'web' ? 'revoke' : 'delete', 'temp:jpeg'],
      'release image',
      'release context',
    ]);
  });
}
