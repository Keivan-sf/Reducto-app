import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HoldRecorder } from '../src/lib/hold-recorder';
import type {
  RecordedVoice,
  RecordingPhase,
  RecordingSession,
} from '../src/lib/voice-recording.types';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function setup(begin?: (signal: AbortSignal) => Promise<RecordingSession>, duration = 1) {
  const states: RecordingPhase[] = [];
  const errors: string[] = [];
  let sends = 0,
    stops = 0,
    cancels = 0,
    disposed = 0;
  const clip: RecordedVoice = {
    asset: { uri: 'file:///voice.m4a', name: 'voice.m4a', mimeType: 'audio/mp4' },
    duration,
    dispose: () => {
      disposed++;
    },
  };
  const session: RecordingSession = {
    stop: async () => {
      stops++;
      return clip;
    },
    cancel: () => {
      cancels++;
    },
  };
  const controller = new HoldRecorder({
    begin: begin ?? (async () => session),
    send: async () => {
      sends++;
    },
    changed: (state) => states.push(state),
    error: (error) => errors.push(error),
  });
  return {
    controller,
    states,
    errors,
    session,
    counts: () => ({ sends, stops, cancels, disposed }),
  };
}
test('holding records; releasing once stops, uploads once, and disposes the recording', async () => {
  const { controller, counts, states } = setup();
  await controller.press();
  assert.deepEqual(states, ['preparing', 'recording']);
  controller.release();
  controller.release();
  await tick();
  assert.deepEqual(counts(), { sends: 1, stops: 1, cancels: 0, disposed: 1 });
  assert.deepEqual(states, ['preparing', 'recording', 'stopping', 'sending', 'idle']);
});
test('locking continues after release and sends only once on explicit send', async () => {
  const { controller, counts, states } = setup();
  await controller.press();
  controller.lock();
  controller.release();
  controller.release();
  await tick();
  assert.equal(states.at(-1), 'locked');
  assert.deepEqual(counts(), { sends: 0, stops: 0, cancels: 0, disposed: 0 });
  controller.send();
  controller.send();
  controller.release();
  await tick();
  assert.deepEqual(counts(), { sends: 1, stops: 1, cancels: 0, disposed: 1 });
  assert.equal(states.at(-1), 'idle');
});
test('cancel and unmount discard locked recordings and allow another hold', async () => {
  for (const unmount of [false, true]) {
    const { controller, counts, states } = setup();
    await controller.press();
    controller.lock();
    if (unmount) controller.dispose();
    else controller.cancel();
    controller.send();
    await tick();
    assert.equal(states.at(-1), 'idle');
    assert.deepEqual(counts(), { sends: 0, stops: 0, cancels: 1, disposed: 0 });
    if (!unmount) {
      await controller.press();
      assert.equal(states.at(-1), 'recording');
      controller.cancel();
    }
  }
});
test('locking before microphone preparation finishes does not keep a released hold alive', async () => {
  const pending = deferred<RecordingSession>();
  const t = setup(() => pending.promise);
  const preparing = t.controller.press();
  t.controller.lock();
  t.controller.release();
  pending.resolve(t.session);
  await preparing;
  assert.equal(t.states.at(-1), 'idle');
  assert.equal(t.counts().sends, 0);
});
test('release during permission/preparation cancels a late recorder without uploading', async () => {
  const started = deferred<RecordingSession>();
  let signal!: AbortSignal;
  const test = setup(async (value) => {
    signal = value;
    return started.promise;
  });
  const preparing = test.controller.press();
  test.controller.release();
  assert.equal(signal.aborted, true);
  assert.equal(test.states.at(-1), 'idle', 'permission cleanup must not lock the composer');
  started.resolve(test.session);
  await preparing;
  assert.equal(test.counts().sends, 0);
  assert.equal(test.counts().cancels, 1);
  assert.equal(test.states.at(-1), 'idle');
});
test('cancelling or unmounting never uploads a held recording', async () => {
  for (const unmount of [false, true]) {
    const test = setup();
    await test.controller.press();
    if (unmount) test.controller.dispose();
    else test.controller.cancel();
    test.controller.release();
    await tick();
    assert.equal(test.counts().sends, 0);
    assert.equal(test.counts().cancels, 1);
  }
});
test('a cancelled stop cannot send its eventual result and always disposes it', async () => {
  const stopped = deferred<RecordedVoice>();
  let disposed = false;
  const test = setup(async () => ({ stop: () => stopped.promise, cancel: () => {} }));
  await test.controller.press();
  test.controller.release();
  test.controller.cancel();
  stopped.resolve({
    asset: { uri: 'blob:recording', name: 'voice.webm' },
    duration: 1,
    dispose: () => {
      disposed = true;
    },
  });
  await tick();
  assert.equal(test.counts().sends, 0);
  assert.equal(disposed, true);
});
test('short taps discard silently while permission failures still show an error', async () => {
  const short = setup(undefined, 0.05);
  await short.controller.press();
  short.controller.release();
  await tick();
  assert.equal(short.counts().sends, 0);
  assert.deepEqual(short.errors, []);
  assert.equal(short.states.at(-1), 'idle');
  const denied = setup(async () => {
    throw new Error('Microphone denied');
  });
  await denied.controller.press();
  assert.deepEqual(denied.errors, ['Microphone denied']);
  assert.equal(denied.states.at(-1), 'idle');
});

test('a cancelled preparation restores the UI immediately and cannot change a newer hold', async () => {
  const pending = deferred<RecordingSession>();
  let starts = 0;
  const test = setup(() => (++starts === 1 ? pending.promise : Promise.resolve(test.session)));
  const first = test.controller.press();
  test.controller.cancel();
  assert.equal(test.states.at(-1), 'idle');
  await test.controller.press();
  assert.equal(test.states.at(-1), 'recording');
  pending.resolve(test.session);
  await first;
  assert.equal(test.states.at(-1), 'recording', 'old cleanup cannot unlock a newer recording');
  test.controller.release();
  await tick();
  assert.equal(test.counts().sends, 1);
});

test('disposing an active recorder clears the parent activity state', async () => {
  const test = setup();
  await test.controller.press();
  test.controller.dispose();
  assert.equal(test.states.at(-1), 'idle');
  assert.equal(test.counts().sends, 0);
});

test('cancellation restores idle even when native recorder cleanup throws', async () => {
  const test = setup(async () => ({
    stop: async () => {
      throw new Error('Not recording');
    },
    cancel: () => {
      throw new Error('Already released');
    },
  }));
  await test.controller.press();
  assert.doesNotThrow(() => test.controller.cancel());
  assert.equal(test.states.at(-1), 'idle');
});
