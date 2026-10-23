import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const { outputText } = ts.transpileModule(
  readFileSync(new URL('../src/lib/pick-upload.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
);
for (const platform of ['android', 'ios', 'web']) {
  test(`${platform} picks attachments and GIFs with compatible cache handling and preserves cancellation`, async () => {
    let cancelled = false;
    const calls: { type: string | string[]; copyToCacheDirectory: boolean }[] = [];
    const asset = { uri: 'content://picker/photo', name: 'photo.jpg', mimeType: 'image/jpeg' };
    const module = { exports: {} as typeof import('../src/lib/pick-upload') };
    runInNewContext(outputText, {
      module,
      exports: module.exports,
      require: (name: string) => {
        if (name === 'react-native') return { Platform: { OS: platform } };
        if (name === 'expo-document-picker')
          return {
            getDocumentAsync: async (options: (typeof calls)[number]) => {
              calls.push(options);
              return cancelled
                ? { canceled: true, assets: null }
                : { canceled: false, assets: [asset] };
            },
          };
        throw new Error(`Unexpected import ${name}`);
      },
    });
    const picked = await module.exports.pickUpload();
    assert.equal(picked.assets?.[0], asset, 'preserves the selected URI and metadata');
    await module.exports.pickUpload(['image/gif', 'video/*']);
    assert.equal(calls[0].type, '*/*');
    assert.deepEqual(calls[1].type, ['image/gif', 'video/*']);
    for (const call of calls) {
      assert.equal(
        call.copyToCacheDirectory,
        platform !== 'android',
        'Android must use the original URI grant instead of the inaccessible picker cache',
      );
    }
    cancelled = true;
    const result = await module.exports.pickUpload();
    assert.equal(result.canceled, true);
    assert.equal(result.assets, null);
  });
}
