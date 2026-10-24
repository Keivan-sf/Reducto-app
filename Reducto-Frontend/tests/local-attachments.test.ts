import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { retainUpload as retainWebUpload } from '../src/lib/local-attachments.web';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

for (const scheme of ['file', 'content']) {
  test(`native ${scheme} uploads retain an owned copy without deleting the original`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'reducto-upload-copy-'));
    roots.push(root);
    const original = path.join(root, 'original.pdf');
    writeFileSync(original, 'original document bytes');
    const viewed: { action: string; options: { data: string; type: string; flags: number } }[] = [];
    class Directory {
      path: string;
      constructor(...parts: string[]) {
        this.path = path.join(...parts);
      }
      create() {
        mkdirSync(this.path, { recursive: true });
      }
      get exists() {
        return existsSync(this.path);
      }
      delete() {
        rmSync(this.path, { recursive: true });
      }
    }
    class File {
      path: string;
      type = 'application/pdf';
      constructor(base: string | Directory, name?: string) {
        this.path =
          base instanceof Directory
            ? path.join(base.path, name!)
            : base === 'content://picker/selected-photo'
              ? original
              : fileURLToPath(base);
      }
      get uri() {
        return pathToFileURL(this.path).href;
      }
      get contentUri() {
        return `content://reducto/${path.basename(this.path)}`;
      }
      get exists() {
        return existsSync(this.path);
      }
      get size() {
        return this.exists ? statSync(this.path).size : 0;
      }
      async copy(destination: File) {
        await Promise.resolve();
        copyFileSync(this.path, destination.path);
      }
    }
    const module = { exports: {} as typeof import('../src/lib/local-attachments') };
    const source = readFileSync(
      new URL('../src/lib/local-attachments.ts', import.meta.url),
      'utf8',
    );
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, {
      module,
      exports: module.exports,
      require: (name: string) => {
        if (name === 'expo-file-system')
          return { Directory, File, Paths: { cache: path.join(root, 'cache') } };
        if (name === 'expo-sharing') return {};
        if (name === 'react-native') return { Platform: { OS: 'android' } };
        if (name === 'expo-intent-launcher')
          return {
            startActivityAsync: async (
              action: string,
              options: { data: string; type: string; flags: number },
            ) => {
              viewed.push({ action, options });
            },
          };
        throw new Error(`Unexpected import ${name}`);
      },
    });
    const local = await module.exports.retainUpload({
      uri: scheme === 'content' ? 'content://picker/selected-photo' : pathToFileURL(original).href,
      name: 'report.pdf',
      mimeType: 'application/pdf',
    });
    assert.equal(local.name, 'report.pdf');
    assert.equal(local.mimeType, 'application/pdf');
    assert.equal(path.basename(fileURLToPath(local.uri)), 'report.pdf');
    assert.equal(local.bytes, statSync(original).size);
    assert.equal(readFileSync(fileURLToPath(local.uri), 'utf8'), 'original document bytes');
    await module.exports.openLocalFile(local);
    assert.equal(viewed.length, 1);
    assert.equal(viewed[0].action, 'android.intent.action.VIEW');
    assert.equal(viewed[0].options.data, 'content://reducto/report.pdf');
    assert.equal(viewed[0].options.type, 'application/pdf');
    assert.equal(viewed[0].options.flags, 1, 'the viewer gets read access to the file');
    local.dispose();
    assert.equal(local.exists?.(), false);
    assert.equal(readFileSync(original, 'utf8'), 'original document bytes');
  });
}

test('web uploads keep the selected file bytes in an owned blob URL', async () => {
  const file = new File(['image bytes'], 'photo.png', { type: 'image/png' });
  const local = await retainWebUpload({ uri: 'blob:picker', name: file.name, file });
  assert.equal(local.name, file.name);
  assert.equal(local.mimeType, 'image/png');
  assert.equal(await (await fetch(local.uri)).text(), 'image bytes');
  assert.equal(local.exists?.(), true);
  local.dispose();
  assert.equal(local.exists?.(), false);
  await assert.rejects(fetch(local.uri));
});
