import test from 'node:test';
import assert from 'node:assert/strict';
import { watchGifPlayback } from '../src/lib/gif-playback';

test('cleanup never calls a player that Expo has already released', () => {
  let released = false;
  let calls = 0;
  let removed = false;
  let queuedUpdate = () => {};
  const control = () => {
    assert.equal(released, false, 'Cannot use shared object that was already released');
    calls++;
  };
  const cleanup = watchGifPlayback(
    { play: control, pause: control },
    () => true,
    (update) => {
      queuedUpdate = update;
      return () => {
        removed = true;
      };
    },
  );
  assert.equal(calls, 1);
  released = true; // Expo's release effect runs before our unmount cleanup.
  assert.doesNotThrow(cleanup);
  assert.equal(removed, true);
  assert.doesNotThrow(queuedUpdate);
  assert.equal(calls, 1);
});

test('backgrounding or loss of visibility pauses; returning to an active screen resumes', () => {
  let active = true;
  let update = () => {};
  const calls: string[] = [];
  const cleanup = watchGifPlayback(
    { play: () => calls.push('play'), pause: () => calls.push('pause') },
    () => active,
    (callback) => {
      update = callback;
      return () => {};
    },
  );
  active = false;
  update();
  active = true;
  update();
  cleanup();
  assert.deepEqual(calls, ['play', 'pause', 'play']);
  const cleanupBlurred = watchGifPlayback(
    { play: () => calls.push('play'), pause: () => calls.push('pause') },
    () => false,
    () => () => {},
  );
  assert.equal(calls.at(-1), 'pause');
  cleanupBlurred();
});
