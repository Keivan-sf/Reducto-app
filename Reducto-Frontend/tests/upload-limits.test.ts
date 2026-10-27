import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_UPLOAD_SIZE_BYTES, uploadSizeError } from '../src/lib/upload-limits';

test('uploads above the former 50 MB limit and through exactly 2 GB are allowed', () => {
  assert.equal(MAX_UPLOAD_SIZE_BYTES, 2_147_483_648);
  for (const size of [50 * 1024 * 1024 + 1, 1024 * 1024 * 1024, 2_147_483_648]) {
    assert.equal(uploadSizeError(size), undefined);
    assert.equal(uploadSizeError(size, 'GIF or video'), undefined);
  }
});

test('oversized uploads show the new limit for attachments and GIFs', () => {
  assert.equal(uploadSizeError(2_147_483_649), 'Choose a file no larger than 2 GB.');
  assert.equal(
    uploadSizeError(2_147_483_649, 'GIF or video'),
    'Choose a GIF or video no larger than 2 GB.',
  );
});

test('unknown picker sizes defer validation until the retained file size is known', () => {
  assert.equal(uploadSizeError(undefined), undefined);
});
