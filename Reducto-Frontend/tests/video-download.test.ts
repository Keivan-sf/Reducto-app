import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { VideoDownloadRequest } from '../src/lib/video-download.types';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Exercise the production native adapter with real temporary files. The SDK's
 * Android downloader opens FileOutputStream without creating its parent. */
function nativeDownloader(
  beforeWrite: (attempt: number, destination: string) => void = () => {},
  empty = false,
) {
  const root = mkdtempSync(path.join(tmpdir(), 'reducto-video-test-'));
  roots.push(root);
  const cache = path.join(root, 'experience', 'cache');
  const calls: { headers: Record<string, string> }[] = [];
  class Directory {
    path: string;
    constructor(base: string, name: string) {
      this.path = path.join(base, name);
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
    constructor(directory: Directory, name: string) {
      this.path = path.join(directory.path, name);
    }
    get uri() {
      return pathToFileURL(this.path).href;
    }
    get exists() {
      return existsSync(this.path);
    }
    get size() {
      return this.exists ? statSync(this.path).size : 0;
    }
    delete() {
      unlinkSync(this.path);
    }
    static async downloadFileAsync(
      _url: string,
      destination: File,
      options: {
        headers: Record<string, string>;
        onProgress: (data: { bytesWritten: number; totalBytes: number }) => void;
      },
    ) {
      calls.push({ headers: options.headers });
      beforeWrite(calls.length, destination.path);
      writeFileSync(destination.path, empty ? '' : 'video bytes');
      options.onProgress({ bytesWritten: destination.size, totalBytes: destination.size });
      return destination;
    }
  }
  const module = { exports: {} as typeof import('../src/lib/video-download') };
  const source = readFileSync(new URL('../src/lib/video-download.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === 'expo-file-system') return { Directory, File, Paths: { cache } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { load: module.exports.loadVideoFile, calls, cache };
}
const request = (signal = new AbortController().signal): VideoDownloadRequest => ({
  url: 'https://server.example/video',
  headers: { Authorization: 'Bearer old' },
  refresh: async () => ({ Authorization: 'Bearer refreshed' }),
  signal,
  progress: () => {},
});

test('native video downloads create a missing scoped cache directory and verify the saved file', async () => {
  const { load, cache, calls } = nativeDownloader();
  assert.equal(existsSync(cache), false);
  const saved = await load(request());
  assert.equal(calls.length, 1);
  assert.equal(saved.exists?.(), true);
  assert.equal(saved.bytes, 11);
  saved.dispose();
  assert.equal(saved.exists?.(), false);
});

test('native downloads recover once if Android removes the directory during a request', async () => {
  const { load, calls } = nativeDownloader((attempt, destination) => {
    if (attempt === 1) rmSync(path.dirname(destination), { recursive: true });
  });
  const saved = await load(request());
  assert.equal(calls.length, 2);
  assert.equal(saved.exists?.(), true);
});

test('native document downloads preserve their extension, MIME type, and original filename', async () => {
  let savedPath = '';
  const { load } = nativeDownloader((_attempt, destination) => {
    savedPath = destination;
  });
  const saved = await load({
    ...request(),
    fileName: 'Preface.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  assert.equal(saved.name, 'Preface.docx');
  assert.equal(
    saved.mimeType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  assert.equal(path.extname(savedPath), '.docx');
  assert.equal(path.basename(savedPath), 'Preface.docx');
  saved.dispose();
  assert.equal(existsSync(path.dirname(savedPath)), false);
});

test('auth refresh and a missing-directory retry both preserve the refreshed bearer token', async () => {
  const { load, calls } = nativeDownloader((attempt, destination) => {
    if (attempt === 1) throw new Error('UnableToDownloadException: response has status: 401');
    if (attempt === 2) rmSync(path.dirname(destination), { recursive: true });
  });
  const saved = await load(request());
  assert.equal(calls.length, 3);
  assert.equal(calls[0].headers.Authorization, 'Bearer old');
  assert.equal(calls[1].headers.Authorization, 'Bearer refreshed');
  assert.equal(calls[2].headers.Authorization, 'Bearer refreshed');
  assert.equal(saved.exists?.(), true);
});

test('repeated missing paths stop after one retry and preserve the original filesystem error', async () => {
  const { load, calls } = nativeDownloader((_attempt, destination) =>
    rmSync(path.dirname(destination), { recursive: true }),
  );
  await assert.rejects(load(request()), /ENOENT/);
  assert.equal(calls.length, 2);
});

test('permissions errors and cancelled requests are not retried as missing cache directories', async () => {
  const denied = nativeDownloader(() => {
    throw new Error('java.io.FileNotFoundException: EACCES (Permission denied)');
  });
  await assert.rejects(denied.load(request()), /EACCES/);
  assert.equal(denied.calls.length, 1);
  const controller = new AbortController();
  const cancelled = nativeDownloader(() => {
    controller.abort();
    throw new Error('java.io.FileNotFoundException');
  });
  await assert.rejects(cancelled.load(request(controller.signal)), /FileNotFoundException/);
  assert.equal(cancelled.calls.length, 1);
});

test('a successful response with an empty video is never handed to the player', async () => {
  const { load } = nativeDownloader(undefined, true);
  await assert.rejects(load(request()), /missing or empty/);
});

test('native cancellation works with React Native signals that have no throwIfAborted method', async () => {
  const { load, calls } = nativeDownloader();
  const controller = new AbortController();
  Object.defineProperty(controller.signal, 'throwIfAborted', { value: undefined });
  await load(request(controller.signal));
  assert.equal(calls.length, 1);
  controller.abort();
  await assert.rejects(load(request(controller.signal)), { name: 'AbortError' });
  assert.equal(calls.length, 1);
});
