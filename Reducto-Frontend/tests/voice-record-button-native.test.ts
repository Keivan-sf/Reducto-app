import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { HoldRecorder } from '../src/lib/hold-recorder';
import type { RecordingSession } from '../src/lib/voice-recording.types';

type Node = { type: unknown; props: Record<string, any> };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Run Android responder handlers with the real recording controller and
 * deterministic timers, including delayed microphone permission. */
function nativeRecorder(delayed = false) {
  const states: unknown[] = [];
  const refs: { current: any }[] = [];
  const effects: { deps?: unknown[]; cleanup?: () => void }[] = [];
  let stateIndex = 0,
    refIndex = 0,
    effectIndex = 0,
    timerId = 0;
  const timers = new Map<number, () => void>();
  let appState!: (state: string) => void;
  let starts = 0,
    stops = 0,
    sends = 0,
    cancels = 0;
  let ready!: (session: RecordingSession) => void;
  const pending = new Promise<RecordingSession>((resolve) => {
    ready = resolve;
  });
  const session: RecordingSession = {
    stop: async () => {
      stops++;
      return { asset: { uri: 'file:///voice.m4a', name: 'voice.m4a' }, duration: 1, dispose() {} };
    },
    cancel: () => {
      cancels++;
    },
  };
  const props = {
    disabled: false,
    active: true,
    onBeforeRecord: () => true,
    onSend: async () => {
      sends++;
    },
    onError: (_message: string) => {},
    onActive: (_active: boolean) => {},
  };
  const module = { exports: {} as typeof import('../src/features/chats/VoiceRecordButton') };
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/features/chats/VoiceRecordButton.tsx', import.meta.url), 'utf8'),
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
    setTimeout: (callback: () => void) => {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => 0,
    clearInterval() {},
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react')
        return {
          useState: (initial: unknown) => {
            const index = stateIndex++;
            if (!(index in states))
              states[index] = typeof initial === 'function' ? initial() : initial;
            return [
              states[index],
              (value: unknown) => {
                states[index] = value;
              },
            ];
          },
          useRef: (current: unknown) => {
            const index = refIndex++;
            return refs[index] ?? (refs[index] = { current });
          },
          useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
            const index = effectIndex++;
            const old = effects[index];
            if (
              old &&
              deps &&
              old.deps?.length === deps.length &&
              deps.every((value, i) => Object.is(value, old.deps![i]))
            )
              return;
            old?.cleanup?.();
            effects[index] = { deps, cleanup: effect() || undefined };
          },
        };
      if (name === 'react-native')
        return {
          View: 'View',
          Pressable: 'Pressable',
          Text: 'Text',
          ActivityIndicator: 'ActivityIndicator',
          Platform: { OS: 'android' },
          StyleSheet: { create: (value: unknown) => value },
          AppState: {
            addEventListener: (_name: string, callback: typeof appState) => {
              appState = callback;
              return { remove() {} };
            },
          },
        };
      if (name === 'expo-router') return { useIsFocused: () => true };
      if (name.endsWith('/ui')) return { Icon: 'Icon', colors: {} };
      if (name.endsWith('/hold-recorder')) return { HoldRecorder };
      if (name.endsWith('/voice-recording'))
        return {
          beginVoiceRecording: async () => {
            starts++;
            return delayed ? pending : session;
          },
        };
      if (name.endsWith('/video-download.types')) return { videoTime: String };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  let tree: Node;
  const find = (predicate: (node: Node) => boolean, node = tree): Node | undefined => {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) {
      if (!child || typeof child !== 'object') continue;
      const found = find(predicate, child);
      if (found) return found;
    }
  };
  const render = () => {
    stateIndex = refIndex = effectIndex = 0;
    tree = module.exports.VoiceRecordButton(props) as unknown as Node;
  };
  render();
  const control = () =>
    find((node) =>
      ['Hold to record voice message', 'Send voice message'].includes(
        node.props?.accessibilityLabel,
      ),
    )!;
  const invoke = (name: string, event?: unknown) => control().props[name](event);
  const event = (y = 500, identifier = 7, x = 300) => {
    const touch = { pageX: x, pageY: y, identifier: String(identifier) };
    return { nativeEvent: { ...touch, touches: [touch], changedTouches: [touch] } };
  };
  return {
    props,
    control,
    invoke,
    event,
    render,
    counts: () => ({ starts, stops, sends, cancels }),
    hold: async () => {
      const pendingTimers = [...timers.values()];
      timers.clear();
      pendingTimers.forEach((callback) => callback());
      await tick();
      render();
    },
    ready: async () => {
      ready(session);
      await tick();
      render();
    },
    appState: (state: string) => appState(state),
    unmount: () => effects.forEach((effect) => effect.cleanup?.()),
    cancel: () =>
      find((node) => node.props?.accessibilityLabel === 'Cancel voice recording')!.props.onPress(),
  };
}

test('Android responder sends on release even with a nonempty touches array', async () => {
  const t = nativeRecorder();
  assert.equal(t.control().type, 'View', 'bypasses Pressable hit rectangles');
  assert.equal(t.invoke('onStartShouldSetResponder'), true);
  assert.equal(t.invoke('onResponderGrant', t.event()), true, 'blocks native interception');
  assert.equal(t.invoke('onResponderTerminationRequest'), false);
  await t.hold();
  t.invoke('onResponderMove', t.event(480, 7, 100));
  t.invoke('onResponderRelease', t.event(480, 7, 100));
  t.invoke('onResponderRelease', t.event());
  await tick();
  assert.deepEqual(t.counts(), { starts: 1, stops: 1, sends: 1, cancels: 0 });
  t.unmount();
});

test('Android swipe outside the button locks until a new Send tap', async () => {
  const t = nativeRecorder();
  t.invoke('onResponderGrant', t.event());
  await t.hold();
  t.invoke('onResponderMove', t.event(410));
  t.render();
  assert.equal(t.control().props.accessibilityLabel, 'Send voice message');
  t.invoke('onResponderMove', t.event(500));
  t.invoke('onResponderEnd', t.event());
  t.invoke('onResponderRelease', t.event());
  await tick();
  t.render();
  assert.deepEqual(t.counts(), { starts: 1, stops: 0, sends: 0, cancels: 0 });
  t.invoke('onResponderGrant', t.event());
  t.invoke('onResponderRelease', t.event());
  await tick();
  assert.deepEqual(t.counts(), { starts: 1, stops: 1, sends: 1, cancels: 0 });
  t.unmount();
});

test('Android tracks the original finger even if another finger moves or remains pressed', async () => {
  const t = nativeRecorder();
  t.invoke('onResponderGrant', t.event());
  await t.hold();
  t.invoke('onResponderMove', t.event(400, 8));
  t.invoke('onResponderEnd', t.event(400, 8));
  assert.equal(t.counts().stops, 0);
  t.invoke('onResponderEnd', t.event());
  await tick();
  assert.equal(t.counts().sends, 1);
  t.unmount();
});

test('Android quick taps and release during permission cannot start a late recording', async () => {
  const quick = nativeRecorder();
  quick.invoke('onResponderGrant', quick.event());
  quick.invoke('onResponderRelease', quick.event());
  await quick.hold();
  assert.equal(quick.counts().starts, 0);
  quick.unmount();
  const delayed = nativeRecorder(true);
  delayed.invoke('onResponderGrant', delayed.event());
  await delayed.hold();
  delayed.invoke('onResponderRelease', delayed.event());
  await delayed.ready();
  assert.deepEqual(delayed.counts(), { starts: 1, stops: 0, sends: 0, cancels: 1 });
  delayed.unmount();
});

test('Android interruptions and Cancel clear pending holds and discard active recordings', async () => {
  for (const beforeStart of [true, false]) {
    for (const action of ['terminate', 'background', 'navigate', 'unmount', 'cancel'] as const) {
      if (beforeStart && action === 'cancel') continue;
      const t = nativeRecorder();
      t.invoke('onResponderGrant', t.event());
      if (!beforeStart) {
        await t.hold();
        t.invoke('onResponderMove', t.event(400));
        t.render();
      }
      if (action === 'terminate') t.invoke('onResponderTerminate');
      if (action === 'background') t.appState('background');
      if (action === 'navigate') {
        t.props.active = false;
        t.render();
      }
      if (action === 'unmount') t.unmount();
      if (action === 'cancel') t.cancel();
      await t.hold();
      assert.equal(t.counts().starts, beforeStart ? 0 : 1);
      assert.equal(t.counts().sends, 0);
      assert.equal(t.counts().cancels, beforeStart ? 0 : 1);
      if (action !== 'unmount') t.unmount();
    }
  }
});
