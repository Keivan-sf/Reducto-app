import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ImageViewerGestures } from '../src/features/chats/image-viewer-gestures';

type Node = { type: unknown; props: Record<string, any> };
const { outputText } = ts.transpileModule(
  readFileSync(new URL('../src/features/chats/ImageViewer.tsx', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
);
function viewer() {
  let closes = 0,
    forwards = 0,
    saves = 0;
  const offsets: number[] = [];
  const values: Value[] = [];
  class Value {
    value: number;
    constructor(value: number) {
      this.value = value;
      values.push(this);
    }
    stopAnimation() {}
    setValue(value: number) {
      this.value = value;
      if (this === values[0]) offsets.push(value);
    }
  }
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const module = { exports: {} as typeof import('../src/features/chats/ImageViewer') };
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === './image-viewer-gestures') return { ImageViewerGestures };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react')
        return {
          useState: (initial: unknown) => [
            typeof initial === 'function' ? initial() : initial,
            () => {},
          ],
          useRef: (current: unknown) => ({ current }),
          useEffect() {},
        };
      if (name === 'react-native')
        return {
          Modal: 'Modal',
          View: 'View',
          Text: 'Text',
          Image: 'Image',
          Pressable: 'Pressable',
          ActivityIndicator: 'ActivityIndicator',
          Platform: { OS: 'android' },
          StyleSheet: { create: (s: unknown) => s },
          Animated: {
            View: 'Animated.View',
            Value,
            spring: (offset: Value) => ({ start: () => offset.setValue(0) }),
          },
        };
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
      if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
      if (name.endsWith('/ui')) return { Button: 'Button', IconButton: 'IconButton', Icon: 'Icon' };
      if (name.endsWith('/local-attachments'))
        return {
          saveLocalFile: async () => {
            saves++;
          },
        };
      if (name.endsWith('/VideosContext'))
        return {
          useVideos: () => ({}),
          videoKey: () => 'image-key',
          useCachedFile: () => ({
            state: { status: 'ready', file: { uri: 'file:///image.png' } },
            download: async () => ({ uri: 'file:///image.png' }),
          }),
        };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const tree = module.exports.ImageViewer({
    conversationId: 'chat',
    mediaId: 'photo',
    title: 'Alice',
    createdAt: '2026-10-23T12:00:00Z',
    onClose: () => {
      closes++;
    },
    onForward: () => {
      forwards++;
    },
  }) as unknown as Node;
  function find(predicate: (node: Node) => boolean, node: Node = tree): Node | undefined {
    if (predicate(node)) return node;
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) {
      if (!child || typeof child !== 'object') continue;
      const found = find(predicate, child);
      if (found) return found;
    }
  }
  const surface = find((node) => node.props.testID === 'image-viewer-surface')!.props;
  const event = (x = 100, y = 300, fingers = 1) => ({
    nativeEvent: {
      pageX: x,
      pageY: y,
      touches: Array.from({ length: fingers }, () => ({ pageX: x, pageY: y })),
    },
  });
  return {
    tree,
    find,
    surface,
    event,
    offsets,
    values,
    counts: () => ({ closes, forwards, saves }),
  };
}

test('Android image swipes in either vertical direction dismiss exactly once', () => {
  for (const y of [180, 420]) {
    const t = viewer();
    assert.equal(t.surface.onStartShouldSetResponder(), true);
    assert.equal(t.surface.onResponderGrant(t.event()), true);
    assert.equal(t.surface.onResponderTerminationRequest(), false);
    t.surface.onResponderMove(t.event(110, y));
    assert.equal(t.offsets.at(-1), y - 300);
    t.surface.onResponderRelease();
    t.surface.onResponderRelease();
    assert.equal(t.counts().closes, 1);
  }
});

test('Android taps, small drags, horizontal drags, cancellation and multi-touch keep the viewer open', () => {
  for (const mode of ['tap', 'small', 'horizontal', 'cancel', 'multitouch']) {
    const t = viewer();
    t.surface.onResponderGrant(t.event());
    if (mode === 'small') t.surface.onResponderMove(t.event(100, 340));
    if (mode === 'horizontal') t.surface.onResponderMove(t.event(300, 410));
    if (mode === 'cancel' || mode === 'multitouch') {
      t.surface.onResponderMove(t.event(100, 420));
      if (mode === 'cancel') t.surface.onResponderTerminate();
      else t.surface.onResponderMove(t.event(100, 420, 2));
    }
    t.surface.onResponderRelease();
    assert.equal(t.counts().closes, 0, mode);
    assert.equal(t.offsets.at(-1), 0, 'image springs back to center');
  }
});

test('Android header Back, Forward and Save use their intended actions', async () => {
  const t = viewer();
  t.find((node) => node.props.label === 'Back to conversation')!.props.onPress();
  t.find((node) => node.props.label === 'Forward image')!.props.onPress();
  const save = t.find((node) => node.props.label === 'Save attachment')!;
  assert.equal(save.props.name, 'download-outline');
  save.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(t.counts(), { closes: 1, forwards: 1, saves: 1 });
});

test('Android double tap toggles zoom and vertical panning cannot dismiss until zoomed out', () => {
  const t = viewer();
  t.surface.onLayout({ nativeEvent: { layout: { width: 400, height: 600 } } });
  const tap = () => {
    t.surface.onResponderGrant(t.event(200, 300));
    t.surface.onResponderRelease();
  };
  tap();
  tap();
  assert.equal(t.values[1].value, 2.5);
  t.surface.onResponderGrant(t.event(200, 300));
  t.surface.onResponderMove(t.event(240, 440));
  t.surface.onResponderRelease();
  assert.equal(t.values[2].value, 40);
  assert.equal(t.values[3].value, 140);
  assert.equal(t.counts().closes, 0);
  tap();
  tap();
  assert.equal(t.values[1].value, 1);
  assert.equal(t.values[2].value, 0);
  assert.equal(t.values[3].value, 0);
  t.surface.onResponderGrant(t.event(200, 300));
  t.surface.onResponderMove(t.event(200, 440));
  t.surface.onResponderRelease();
  assert.equal(t.counts().closes, 1);
});

test('Android pinch, then lifting one finger, remains a pan gesture even after zooming out', () => {
  const t = viewer();
  t.surface.onLayout({ nativeEvent: { layout: { width: 400, height: 600 } } });
  const pinch = (span: number) => ({
    nativeEvent: {
      touches: [
        { locationX: 200 - span / 2, locationY: 300 },
        { locationX: 200 + span / 2, locationY: 300 },
      ],
    },
  });
  t.surface.onResponderGrant(t.event(150, 300));
  t.surface.onResponderStart(pinch(100));
  t.surface.onResponderMove(pinch(200));
  assert.equal(t.values[1].value, 2);
  t.surface.onResponderMove(pinch(50));
  assert.equal(t.values[1].value, 1);
  t.surface.onResponderEnd(t.event(200, 300));
  t.surface.onResponderMove(t.event(200, 460));
  t.surface.onResponderRelease();
  assert.equal(t.counts().closes, 0);
});
