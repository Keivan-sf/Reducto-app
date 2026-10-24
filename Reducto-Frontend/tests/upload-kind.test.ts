import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadKind } from '../src/lib/upload-kind';

test('TypeScript filenames override misleading media MIME types from file pickers', () => {
  for (const name of ['example.ts', 'Component.tsx', 'types.d.ts', 'SOURCE.TS']) {
    for (const type of [
      'video/mp2t',
      'video/vnd.dlna.mpeg-tts',
      'image/jpeg',
      'audio/mpeg',
      'image/gif',
      'text/typescript',
      undefined,
    ]) {
      assert.equal(uploadKind(type, name), 'document');
    }
  }
  assert.equal(uploadKind('video/mp2t', 'recording.m2ts'), 'media');
});

test('arbitrary and missing MIME types upload as documents', () => {
  for (const type of [
    undefined,
    '',
    'application/octet-stream',
    'application/pdf',
    'text/plain',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]) {
    assert.equal(uploadKind(type), 'document');
  }
});

test('pictures, video and audio keep media processing and GIFs keep their conversion flow', () => {
  for (const type of [
    'image/jpeg',
    'video/mp4',
    'audio/mpeg',
    'audio/ogg;codecs=opus',
    ' IMAGE/PNG ',
  ]) {
    assert.equal(uploadKind(type), 'media');
  }
  assert.equal(uploadKind('image/gif'), 'gif');
});
