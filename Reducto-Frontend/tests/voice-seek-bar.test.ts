import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function nativeSeekBar(deferredMeasurement = false, seekResult?: () => Promise<void>) {
  const seeks: number[] = [];
  const previews: unknown[] = [];
  const locks: boolean[] = [];
  const cleanups: (void | (() => void))[] = [];
  let measure!: () => void;
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let initialRender = true;
  let dirty = false;
  const module = { exports: {} as typeof import('../src/features/chats/VoiceSeekBar') };
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/features/chats/VoiceSeekBar.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react')
        return {
          useRef: (current: unknown) => {
            const index = refIndex++;
            return refs[index] ?? (refs[index] = { current });
          },
          useState: (initial: unknown) => {
            const index = stateIndex++;
            if (index >= states.length) states.push(initial);
            return [
              states[index],
              (update: unknown) => {
                const next = typeof update === 'function' ? update(states[index]) : update;
                if (!Object.is(next, states[index])) dirty = true;
                states[index] = next;
                previews.push(
                  next && typeof next === 'object' && 'seconds' in next ? next.seconds : next,
                );
              },
            ];
          },
          useEffect: (effect: () => void | (() => void)) => {
            if (initialRender) cleanups.push(effect());
          },
        };
      if (name === 'react-native')
        return {
          View: 'View',
          Platform: { OS: 'android' },
          StyleSheet: { create: (value: unknown) => value },
        };
      if (name.endsWith('/ui')) return { colors: { blue: '#3390EC' } };
      if (name.endsWith('/video-download.types')) return { videoTime: String };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  let props!: Record<string, unknown> & { ref: { current: unknown } };
  const render = (value = 2) => {
    let attempts = 0;
    do {
      stateIndex = 0;
      refIndex = 0;
      dirty = false;
      const element = module.exports.VoiceSeekBar({
        value,
        duration: 10,
        onSeek: (seconds) => {
          seeks.push(seconds);
          return seekResult?.();
        },
        onDraggingChange: (dragging) => locks.push(dragging),
      });
      props = element.props;
      initialRender = false;
      assert.ok(attempts++ < 10, 'render-phase state updates must settle');
    } while (dirty);
    return Number(props['aria-valuenow']);
  };
  const invoke = (name: string, ...args: unknown[]) =>
    (props[name] as (...args: unknown[]) => unknown)(...args);
  render();
  props.ref.current = {
    measureInWindow: (callback: (left: number, top: number, width: number) => void) => {
      measure = () => callback(100, 100, 200);
      if (!deferredMeasurement) measure();
    },
  };
  const event = (pageX: number) => ({ nativeEvent: { pageX }, stopPropagation() {} });
  return {
    seeks,
    previews,
    shown: render,
    locks,
    start: (x: number) => invoke('onResponderGrant', event(x)),
    move: (x: number) => invoke('onResponderMove', event(x)),
    release: (x: number) => invoke('onResponderRelease', event(x)),
    cancel: () => invoke('onResponderTerminate'),
    measure: () => measure(),
    unmount: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}

test('native dragging previews outside the track and commits only once on release', () => {
  const slider = nativeSeekBar();
  slider.start(140);
  slider.move(900);
  assert.equal(slider.previews.at(-1), 10);
  slider.move(-40);
  assert.equal(slider.previews.at(-1), 0);
  assert.deepEqual(slider.seeks, []);
  slider.release(260);
  slider.release(300);
  assert.deepEqual(slider.seeks, [8]);
  assert.deepEqual(slider.locks, [true, false]);
});

test('release beyond either edge clamps the native seek position', () => {
  for (const [x, target] of [
    [-200, 0],
    [900, 10],
  ]) {
    const slider = nativeSeekBar();
    slider.start(140);
    slider.release(x);
    assert.deepEqual(slider.seeks, [target]);
  }
});

test('a quick release waits for native layout measurement; cancelled and unmounted drags never seek', () => {
  const quick = nativeSeekBar(true);
  quick.start(140);
  quick.release(260);
  assert.deepEqual(quick.locks, [true, false], 'scrolling unlocks without waiting for measurement');
  assert.deepEqual(quick.seeks, []);
  quick.measure();
  assert.deepEqual(quick.seeks, [8]);
  for (const action of ['cancel', 'unmount'] as const) {
    const slider = nativeSeekBar(true);
    slider.start(140);
    slider.release(260);
    slider[action]();
    slider.measure();
    assert.deepEqual(slider.seeks, []);
    assert.deepEqual(slider.locks, [true, false]);
  }
});

test('Android seek responder blocks native scroll interception and always restores scrolling', () => {
  for (const action of ['release', 'cancel', 'unmount'] as const) {
    const slider = nativeSeekBar();
    assert.equal(slider.start(140), true, 'grant must block the Android native ScrollView');
    assert.deepEqual(slider.locks, [true]);
    slider.move(240);
    assert.deepEqual(slider.locks, [true]);
    if (action === 'release') slider.release(240);
    else slider[action]();
    assert.deepEqual(slider.locks, [true, false]);
    slider.cancel();
    assert.deepEqual(
      slider.locks,
      [true, false],
      'duplicate cancellation cannot leave the list locked',
    );
  }
});

test('released seek position survives old status updates and a resolved seek until playback acknowledges it', async () => {
  let resolve!: () => void;
  const slider = nativeSeekBar(
    false,
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  slider.start(140);
  slider.move(260);
  slider.release(260);
  assert.equal(slider.shown(2), 8);
  slider.cancel(); // Browser lost-pointer-capture arrives after pointer-up.
  assert.equal(slider.shown(2.1), 8);
  resolve();
  await Promise.resolve();
  assert.equal(slider.shown(2.2), 8, 'promise completion is not a playback status acknowledgement');
  assert.equal(slider.shown(8), 8);
  assert.equal(slider.shown(8.5), 8, 'aria value rounds down but follows playback again');
  assert.equal(slider.shown(9), 9);
});

test('failed seeks restore actual playback and stale failures do not override a newer seek', async () => {
  const failures: ((error: Error) => void)[] = [];
  const slider = nativeSeekBar(
    false,
    () =>
      new Promise<void>((_resolve, reject) => {
        failures.push(reject);
      }),
  );
  slider.start(140);
  slider.release(260);
  slider.start(180);
  slider.release(220);
  assert.equal(slider.shown(2), 6);
  failures[0](new Error('old seek failed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(slider.shown(2), 6);
  failures[1](new Error('new seek failed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(slider.shown(2), 2);
});
