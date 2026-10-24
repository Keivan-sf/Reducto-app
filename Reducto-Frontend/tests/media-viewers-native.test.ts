import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ImageViewerGestures } from '../src/features/chats/image-viewer-gestures';

type Node = { type: unknown; props: Record<string, any> };
function mount(file: string, imports: Record<string, unknown>) {
  const slots: any[] = [];
  let index = 0;
  let effects: (() => void)[] = [];
  const react = {
    useRef: (current: unknown) => (slots[index++] ??= { current }),
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[slot],
        (value: unknown) => {
          slots[slot] = value;
        },
      ];
    },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const slot = index++;
      const previous = slots[slot];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[slot] = { deps, cleanup: effect() };
        });
      }
    },
    useMemo(fn: () => unknown) {
      return fn();
    },
    useCallback(fn: unknown) {
      return fn;
    },
    createContext: () => ({ Provider: 'Provider' }),
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const module = { exports: {} as Record<string, (props: any) => Node> };
  const { outputText } = ts.transpileModule(
    readFileSync(new URL(`../src/features/chats/${file}.tsx`, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require(name: string) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name in imports) return imports[name];
      if (name === './VideoZoomSurface') return { VideoZoomSurface: 'VideoZoomSurface' };
      if (name === './VideoPlaybackControls')
        return { VideoPlaybackControls: 'VideoPlaybackControls' };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return {
    render(props: unknown) {
      index = 0;
      const tree = module.exports[file](props);
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      return tree;
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
}
function find(tree: Node, type: string): Node {
  if (tree.type === type) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    if (!child || typeof child !== 'object') continue;
    const found = find(child, type);
    if (found) return found;
  }
  return undefined!;
}
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

test('Android viewer stays mounted while hidden; only the open viewer handles hardware Back', () => {
  let handler: (() => boolean) | undefined;
  let closes = 0;
  const t = mount('ViewerLayer', {
    'react-native': {
      Platform: { OS: 'android' },
      Animated: { View: 'Animated.View' },
      StyleSheet: { absoluteFill: {} },
      BackHandler: {
        addEventListener: (_event: string, fn: () => boolean) => {
          handler = fn;
          return {
            remove() {
              handler = undefined;
            },
          };
        },
      },
    },
    'expo-status-bar': { StatusBar: 'StatusBar' },
  });
  const props = {
    children: 'native viewer',
    opacity: {},
    onClose() {
      closes++;
    },
  };
  const hidden = t.render({ ...props, visible: false });
  assert.equal(hidden.props.pointerEvents, 'none');
  assert.equal(hidden.props.children[1], props.children);
  assert.equal(handler, undefined);
  const shown = t.render({ ...props, visible: true });
  assert.equal(shown.type, hidden.type);
  assert.equal(shown.props.children[1], props.children);
  assert.equal((handler as (() => boolean) | undefined)?.(), true);
  assert.equal(closes, 1);
  t.render({ ...props, visible: false });
  assert.equal(handler, undefined);
  t.unmount();
});

test('Native playback reuses the player and retains its source through closing and reopening', async () => {
  const sources: unknown[] = [];
  const plays: unknown[] = [];
  let source: unknown;
  const player = {
    status: 'idle',
    pause() {},
    play() {
      plays.push(source);
    },
    replay() {
      plays.push(source);
    },
    async replaceAsync(next: unknown) {
      sources.push(next);
      source = next;
    },
  };
  const hookSources: unknown[] = [];
  const t = mount('VideoPlayback', {
    'react-native': {
      ActivityIndicator: 'ActivityIndicator',
      View: 'View',
      Text: 'Text',
      StyleSheet: {},
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    },
    expo: { useEvent: () => ({ status: player.status }) },
    'expo-video': {
      useVideoPlayer: (initial: unknown) => {
        hookSources.push(initial);
        return player;
      },
      VideoView: 'VideoView',
    },
  });
  const hidden = t.render({ active: false });
  await tick();
  const first = t.render({ active: true, uri: 'file:///one.mp4' });
  await tick();
  const second = t.render({ active: true, uri: 'file:///two.mp4' });
  await tick();
  assert.equal(find(hidden, 'VideoView').props.player, find(first, 'VideoView').props.player);
  assert.equal(find(first, 'VideoView').props.player, find(second, 'VideoView').props.player);
  assert.ok(
    hookSources.every((initial) => initial === null),
    'source changes never recreate the player',
  );
  assert.equal(plays.length, 2);
  assert.equal((plays.at(-1) as any).uri, 'file:///two.mp4');
  const countBeforeClose = sources.length;
  t.render({ active: false, uri: 'file:///two.mp4' });
  await tick();
  assert.equal(sources.length, countBeforeClose, 'closing never replaces or unloads the source');
  assert.equal(plays.length, 2, 'closing never restarts playback');
  t.render({ active: true, uri: 'file:///two.mp4' });
  await tick();
  assert.equal(
    sources.length,
    countBeforeClose,
    'reopening the same file needs no native preparation',
  );
  assert.equal(plays.length, 3);
  t.unmount();
});

test('Closing during video preparation prevents late autoplay while retaining the source', async () => {
  let complete: (() => void) | undefined;
  let plays = 0;
  const sources: unknown[] = [];
  let allowed = true;
  const canPlay = () => allowed;
  const pauseRef: { current: (() => void) | null } = { current: null };
  const player = {
    status: 'idle',
    pause() {},
    play() {
      plays++;
    },
    replaceAsync(source: unknown) {
      sources.push(source);
      return source
        ? new Promise<void>((resolve) => {
            complete = resolve;
          })
        : Promise.resolve();
    },
  };
  const t = mount('VideoPlayback', {
    'react-native': {
      View: 'View',
      StyleSheet: {},
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    },
    expo: { useEvent: () => ({ status: 'idle' }) },
    'expo-video': { useVideoPlayer: () => player, VideoView: 'VideoView' },
  });
  t.render({ active: true, uri: 'file:///slow.mp4', canPlay, pauseRef });
  await tick();
  assert.ok(complete);
  allowed = false;
  pauseRef.current!();
  // The fade starts without rerendering VideoPlayback or changing active/source props.
  complete();
  await tick();
  assert.equal(plays, 0);
  assert.equal(sources.length, 1, 'closing does not touch the native source');
  assert.equal((sources.at(-1) as any).uri, 'file:///slow.mp4');
  t.unmount();
  assert.equal(pauseRef.current, null);
});

test('Native GIF playback stays muted and looping, reports dimensions, and pauses before dismissal', async () => {
  let plays = 0;
  let pauses = 0;
  const sources: unknown[] = [];
  const sizes: unknown[] = [];
  const pauseRef: { current: (() => void) | null } = { current: null };
  const size = { width: 360, height: 640 };
  const player = {
    status: 'readyToPlay',
    loop: false,
    muted: false,
    videoTrack: { size },
    pause() {
      pauses++;
    },
    play() {
      plays++;
    },
    replay() {
      plays++;
    },
    async replaceAsync(source: unknown) {
      sources.push(source);
    },
  };
  let initialized = false;
  let appState: ((state: string) => void) | undefined;
  const t = mount('VideoPlayback', {
    'react-native': {
      ActivityIndicator: 'ActivityIndicator',
      View: 'View',
      Text: 'Text',
      StyleSheet: {},
      AppState: {
        currentState: 'active',
        addEventListener: (_event: string, listener: (state: string) => void) => {
          appState = listener;
          return { remove() {} };
        },
      },
    },
    expo: {
      useEvent: (_player: unknown, event: string, initial: unknown) =>
        event === 'sourceLoad' ? { availableVideoTracks: [{ size }] } : initial,
    },
    'expo-video': {
      useVideoPlayer: (_source: unknown, setup: (value: typeof player) => void) => {
        if (!initialized) {
          initialized = true;
          setup(player);
        }
        return player;
      },
      VideoView: 'VideoView',
    },
  });
  const props = {
    uri: 'file:///gif.mp4',
    loop: true,
    muted: true,
    nativeControls: false,
    pauseRef,
    onSize: (size: unknown) => sizes.push(size),
  };
  const shown = t.render({ ...props, active: true });
  await tick();
  assert.equal(player.loop, true);
  assert.equal(player.muted, true);
  assert.equal(find(shown, 'VideoView').props.nativeControls, false);
  assert.equal(find(shown, 'VideoView').props.surfaceType, 'textureView');
  assert.equal(find(shown, 'VideoView').props.playsInline, true);
  assert.equal(sizes[0], size);
  assert.equal(plays, 1);
  appState!('background');
  appState!('active');
  assert.equal(plays, 2, 'foregrounding resumes a visible GIF');
  const beforeClose = pauses;
  pauseRef.current!();
  assert.equal(pauses, beforeClose + 1);
  t.render({ ...props, active: false });
  await tick();
  appState!('active');
  assert.equal(plays, 2, 'foregrounding never resumes a hidden viewer');
  t.render({ ...props, active: true });
  await tick();
  assert.equal(sources.length, 1, 'reopening retains the loaded source');
  assert.equal(plays, 3);
  t.unmount();
  assert.equal(pauseRef.current, null);
});

test('Android video zoom owns the entire touch stream, including adding and lifting a second finger', () => {
  class Value {
    constructor(public value: number) {}
    setValue(value: number) {
      this.value = value;
    }
    stopAnimation() {}
  }
  const t = mount('VideoZoomSurface', {
    './image-viewer-gestures': { ImageViewerGestures },
    'react-native': {
      View: 'View',
      StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles },
      Easing: { cubic: (v: number) => v, out: (fn: unknown) => fn },
      Animated: {
        View: 'Animated.View',
        Value,
        timing: (value: Value, { toValue }: { toValue: number }) => ({
          start: () => value.setValue(toValue),
        }),
        parallel: (animations: { start: () => void }[]) => ({
          start: () => animations.forEach((a) => a.start()),
        }),
      },
    },
  });
  const tree = t.render({
    uri: 'file:///video.mp4',
    active: true,
    size: { width: 400, height: 600 },
    children: 'video',
  });
  const surface = tree.props;
  const transform = find(tree, 'Animated.View').props;
  assert.equal(transform.pointerEvents, 'none', 'the native player never consumes a touch start');
  assert.equal(surface.collapsable, false);
  assert.equal(surface.onStartShouldSetResponder(), true);
  assert.equal(surface.onResponderTerminationRequest(), false);
  surface.onLayout({ nativeEvent: { layout: { width: 400, height: 600 } } });
  const event = (...points: number[][]) => ({
    nativeEvent: { touches: points.map(([locationX, locationY]) => ({ locationX, locationY })) },
  });
  const scale = transform.style[1].transform[2].scale as Value;
  const y = transform.style[1].transform[1].translateY as Value;
  surface.onResponderGrant(event([150, 300]));
  surface.onResponderStart(event([150, 300], [250, 300]));
  surface.onResponderMove(event([100, 300], [300, 300]));
  assert.equal(scale.value, 2);
  surface.onResponderEnd(event([100, 300]));
  surface.onResponderMove(event([100, 400]));
  assert.equal(scale.value, 2);
  assert.equal(y.value, 100, 'one remaining finger pans without jumping or dismissing');
  surface.onResponderEnd(event());
  surface.onResponderRelease();
  surface.onResponderGrant(event([100, 300], [300, 300]));
  surface.onResponderMove(event([150, 300], [250, 300]));
  surface.onResponderTerminate();
  assert.equal(scale.value, 1);
  t.render({ uri: 'file:///another.mp4', active: true });
  assert.equal(scale.value, 1, 'switching videos resets the zoom');
});

test('Zoomable native video disables player touch controls and keeps playback controls outside the zoom surface', async () => {
  const player = {
    status: 'readyToPlay',
    playing: false,
    duration: 60,
    currentTime: 10,
    muted: false,
    timeUpdateEventInterval: 0,
    pause() {
      this.playing = false;
    },
    play() {
      this.playing = true;
    },
    replay() {
      this.currentTime = 0;
      this.playing = true;
    },
    async replaceAsync() {},
  };
  const t = mount('VideoPlayback', {
    'react-native': {
      View: 'View',
      Text: 'Text',
      ActivityIndicator: 'ActivityIndicator',
      StyleSheet: {},
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    },
    expo: { useEvent: (_player: unknown, _event: string, initial: unknown) => initial },
    'expo-video': { useVideoPlayer: () => player, VideoView: 'VideoView' },
  });
  let allowed = true;
  const tree = t.render({
    uri: 'file:///video.mp4',
    zoomable: true,
    active: true,
    canPlay: () => allowed,
  });
  await tick();
  assert.equal(find(tree, 'VideoView').props.nativeControls, false);
  assert.ok(find(tree, 'VideoZoomSurface'));
  assert.equal(find(find(tree, 'VideoZoomSurface'), 'VideoPlaybackControls'), undefined);
  assert.equal(player.timeUpdateEventInterval, 0.25);
  const controls = find(tree, 'VideoPlaybackControls').props;
  controls.onTogglePlay();
  assert.equal(player.playing, false);
  controls.onTogglePlay();
  assert.equal(player.playing, true);
  controls.onSeek(35);
  assert.equal(player.currentTime, 35);
  controls.onToggleMute();
  assert.equal(player.muted, true);
  controls.onTogglePlay();
  allowed = false;
  controls.onTogglePlay();
  assert.equal(player.playing, false, 'closing cannot restart playback');
  t.render({ uri: 'file:///video.mp4', zoomable: true, active: false });
  assert.equal(player.timeUpdateEventInterval, 0);
  t.unmount();
});
