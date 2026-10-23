import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/** Load the native adapter against a recorder double that rejects all calls
 * after release, so asynchronous permission/stop races are exercised in Node. */
function nativeRecorder({
  allowed = true,
  granted = allowed,
  prepare = Promise.resolve(),
  permission = Promise.resolve(),
}: {
  allowed?: boolean;
  granted?: boolean;
  prepare?: Promise<void>;
  permission?: Promise<void>;
} = {}) {
  let permissionRequests = 0;
  const calls: string[] = [];
  let options: Record<string, unknown> = {};
  let exists = true;
  let released = false;
  const check = () => assert.equal(released, false, 'Shared object was already released');
  class Recorder {
    constructor(value: Record<string, unknown>) {
      options = value;
      calls.push('create');
    }
    async prepareToRecordAsync() {
      check();
      await prepare;
      calls.push('prepare');
    }
    record() {
      check();
      calls.push('record');
    }
    getStatus() {
      check();
      return { durationMillis: 1500 };
    }
    get uri() {
      check();
      return 'file:///voice.m4a';
    }
    async stop() {
      check();
      calls.push('stop');
    }
    release() {
      check();
      released = true;
      calls.push('release');
    }
  }
  class File {
    get exists() {
      return exists;
    }
    delete() {
      exists = false;
      calls.push('delete');
    }
  }
  const module = { exports: {} as typeof import('../src/lib/voice-recording') };
  const source = readFileSync(new URL('../src/lib/voice-recording.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === 'expo-audio')
        return {
          AudioModule: { AudioRecorder: Recorder },
          getRecordingPermissionsAsync: async () => {
            await permission;
            return { granted };
          },
          requestRecordingPermissionsAsync: async () => {
            permissionRequests++;
            assert.equal(
              granted,
              false,
              'Never re-request granted permission: Android may background',
            );
            return { granted: allowed };
          },
          setAudioModeAsync: async (mode: { allowsRecording: boolean }) => {
            calls.push(mode.allowsRecording ? 'microphone' : 'speaker');
          },
          RecordingPresets: {
            HIGH_QUALITY: {
              extension: '.m4a',
              sampleRate: 44100,
              android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
            },
          },
        };
      if (name === 'react-native') return { Platform: { OS: 'android' } };
      if (name === 'expo-file-system') return { File };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return {
    begin: module.exports.beginVoiceRecording,
    calls,
    options: () => options,
    permissionRequests: () => permissionRequests,
  };
}

test('native recording prepares mono AAC and releases the recorder after obtaining a usable clip', async () => {
  const native = nativeRecorder();
  const recording = await native.begin(new AbortController().signal);
  assert.equal(native.options().numberOfChannels, 1);
  assert.equal(native.options().audioEncoder, 'aac');
  const clip = await recording.stop();
  assert.equal(clip.duration, 1.5);
  assert.equal(clip.asset.mimeType, 'audio/mp4');
  assert.equal(clip.asset.uri, 'file:///voice.m4a');
  assert.equal(native.calls.filter((call) => call === 'release').length, 1);
  clip.dispose();
  assert.equal(native.calls.at(-1), 'delete');
});

test('permission denial or releasing during preparation never starts the native recorder', async () => {
  const denied = nativeRecorder({ allowed: false });
  await assert.rejects(denied.begin(new AbortController().signal), /Allow microphone/);
  assert.deepEqual(denied.calls, []);
  let prepared!: () => void;
  const delayed = nativeRecorder({
    prepare: new Promise<void>((resolve) => {
      prepared = resolve;
    }),
  });
  const controller = new AbortController();
  const starting = delayed.begin(controller.signal);
  while (!delayed.calls.includes('create')) await Promise.resolve();
  controller.abort();
  prepared();
  await assert.rejects(starting, /cancelled/);
  assert.equal(delayed.calls.includes('record'), false);
  assert.equal(delayed.calls.filter((call) => call === 'release').length, 1);
});

test('cancelling a held native recording releases it and removes the discarded file', async () => {
  const native = nativeRecorder();
  const recording = await native.begin(new AbortController().signal);
  recording.cancel();
  assert.equal(native.calls.filter((call) => call === 'release').length, 1);
  assert.equal(native.calls.at(-1), 'delete');
});

test('existing microphone permission starts recording without reopening Android permission activity', async () => {
  const native = nativeRecorder();
  const recording = await native.begin(new AbortController().signal);
  assert.equal(native.permissionRequests(), 0);
  assert.ok(native.calls.includes('record'));
  recording.cancel();
});

test('missing microphone permission is requested before preparing the recorder', async () => {
  const native = nativeRecorder({ granted: false });
  const recording = await native.begin(new AbortController().signal);
  assert.equal(native.permissionRequests(), 1);
  assert.ok(native.calls.includes('record'));
  recording.cancel();
});

test('release during permission lookup never opens a permission prompt or recorder', async () => {
  let resolve!: () => void;
  const native = nativeRecorder({
    granted: false,
    permission: new Promise<void>((ready) => {
      resolve = ready;
    }),
  });
  const controller = new AbortController();
  const starting = native.begin(controller.signal);
  controller.abort();
  resolve();
  await assert.rejects(starting, /cancelled/);
  assert.equal(native.permissionRequests(), 0);
  assert.deepEqual(native.calls, []);
});
