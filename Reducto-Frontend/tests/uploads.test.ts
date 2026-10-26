import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { installFormDataPatch } from '../node_modules/expo/src/winter/FormData';

// Run the production helper with a native file-system double. React Native's
// native modules cannot be loaded by Node; the multipart encoder below is real.
function uploadHelper(
  platform: 'android' | 'web',
  bytes = new Uint8Array([255, 216, 0, 255, 217]),
) {
  const opened: string[] = [];
  let reads = 0;
  class NativeFile {
    type = 'image/jpeg';
    constructor(uri: string) {
      opened.push(uri);
    }
    async bytes() {
      reads++;
      return bytes;
    }
  }
  class NativeFormData {
    _parts = [];
  }
  class NativeBlob {
    constructor() {
      throw new Error("Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported");
    }
  }
  const NativeForm = installFormDataPatch(NativeFormData as unknown as typeof FormData);
  const module = { exports: {} as typeof import('../src/lib/uploads') };
  const source = readFileSync(new URL('../src/lib/uploads.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === 'react-native') return { Platform: { OS: platform } };
      if (name === 'expo-file-system') return { File: NativeFile };
      throw new Error(`Unexpected import ${name}`);
    },
    Blob: platform === 'web' ? Blob : NativeBlob,
    FormData: platform === 'web' ? FormData : NativeForm,
    fetch,
  });
  return { fileForm: module.exports.fileForm, opened, bytes, reads: () => reads };
}

test('native avatar uploads encode binary bytes, filename and MIME with Expo SDK 57 fetch', async () => {
  const { convertFormDataAsync } =
    await import('../node_modules/expo/src/winter/fetch/convertFormData');
  const { fileForm, opened, bytes, reads } = uploadHelper('android');
  const body = await fileForm('avatar', {
    uri: 'file:///cache/edited-123.jpg',
    name: 'avatar.jpg',
    mimeType: 'image/jpeg',
  });
  assert.equal(reads(), 0, 'file bytes are read lazily by the native fetch encoder');
  const encoded = await convertFormDataAsync(body, 'avatar-boundary');
  assert.equal(reads(), 1);
  assert.deepEqual(
    Buffer.from(encoded.body),
    Buffer.concat([
      Buffer.from(
        '--avatar-boundary\r\n' +
          'content-disposition: form-data; name="avatar"; filename="avatar.jpg"\r\n' +
          'content-type: image/jpeg\r\n\r\n',
      ),
      bytes,
      Buffer.from('\r\n--avatar-boundary--\r\n'),
    ]),
  );
  assert.deepEqual(opened, ['file:///cache/edited-123.jpg']);
  // A token-refresh retry must be able to serialize the body again.
  assert.deepEqual((await convertFormDataAsync(body, 'avatar-boundary')).body, encoded.body);
  assert.equal(reads(), 2);
});

test('native uploads preserve picker MIME types and filenames for attachments and GIFs', async () => {
  const { fileForm } = uploadHelper('android');
  for (const [field, name, mimeType] of [
    ['file', 'report.pdf', 'application/pdf'],
    ['gif', 'animation.mp4', 'video/mp4'],
  ]) {
    const form = await fileForm(field, { uri: 'content://picker/cached-file', name, mimeType });
    const file = form.get(field) as File;
    assert.equal(file.name, name);
    assert.equal(file.type, mimeType);
  }
});

test('web uploads keep using the selected browser file', async () => {
  const { fileForm, opened } = uploadHelper('web');
  const file = new File(['browser-image'], 'picked.png', { type: 'image/png' });
  const form = await fileForm('avatar', { uri: 'blob:browser-image', name: 'avatar.png', file });
  const uploaded = form.get('avatar') as File;
  assert.equal(uploaded.name, 'avatar.png');
  assert.equal(uploaded.type, 'image/png');
  assert.equal(await uploaded.text(), 'browser-image');
  assert.deepEqual(opened, []);
});

test('native progress uploads supply URI parts to React Native XHR without reading binary bytes', async () => {
  const { fileForm, reads, opened } = uploadHelper('android');
  const form = await fileForm(
    'file',
    {
      uri: 'file:///cache/clip.mp4',
      name: 'clip.mp4',
      mimeType: 'video/mp4',
    },
    'xhr',
  );
  const part = form.get('file') as unknown as { uri: string; name: string; type: string };
  assert.equal(part.uri, 'file:///cache/clip.mp4');
  assert.equal(part.name, 'clip.mp4');
  assert.equal(part.type, 'video/mp4');
  assert.equal(reads(), 0);
  assert.deepEqual(opened, []);
});
