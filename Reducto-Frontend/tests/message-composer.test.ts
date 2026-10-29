import { themeContextMock } from './fixtures/theme-context';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

interface Node {
  type: unknown;
  props: Record<string, any>;
}
/** The native input is independent of React's render queue: assert its value
 * changes inside the press handler, before running another component render. */
function composer(accepted = true, platform = 'android', width = 400) {
  let effects: (() => unknown)[] = [];
  let cleanups: (() => void)[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const states: unknown[] = [];
  const refs: { current: any }[] = [];
  let stateIndex = 0,
    refIndex = 0;
  const native = {
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
    value: '',
    focused: false,
    clears: 0,
    focus() {
      this.focused = true;
    },
    clear() {
      this.value = '';
      this.clears++;
    },
  };
  const sends: string[] = [];
  const errors: string[] = [];
  const module = { exports: {} as typeof import('../src/features/chats/MessageComposer') };
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/features/chats/MessageComposer.tsx', import.meta.url), 'utf8'),
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
    clearTimeout,
    setTimeout,
    exports: module.exports,
    require: (name: string) => {
      if (name.endsWith('/ThemeContext')) return themeContextMock;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react')
        return {
          useEffect: (effect: () => unknown) => effects.push(effect),
          useLayoutEffect: () => {},
          useState: (initial: unknown) => {
            const index = stateIndex++;
            if (!(index in states)) states[index] = initial;
            return [
              states[index],
              (value: unknown) => {
                states[index] = value;
              },
            ];
          },
          useRef: (initial: unknown) => {
            const index = refIndex++;
            return refs[index] ?? (refs[index] = { current: initial });
          },
        };
      if (name === 'react-native')
        return {
          Platform: { OS: platform },
          useWindowDimensions: () => ({ width, height: 800 }),
          Keyboard: { dismiss: () => {} },
          BackHandler: { addEventListener: () => ({ remove() {} }) },
          Pressable: 'Pressable',
          TextInput: 'TextInput',
          View: 'View',
          Text: 'Text',
          StyleSheet: { create: (styles: unknown) => styles },
        };
      if (name.endsWith('components/ui'))
        return { Icon: 'Icon', IconButton: 'IconButton', colors: {} };
      if (name === './MediaPicker') return { MediaPicker: 'MediaPicker' };
      if (name === './VoiceRecordButton') return { VoiceRecordButton: 'VoiceRecordButton' };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const props = {
    active: true,
    editing: false,
    busy: false,
    hasAttachment: false,
    onSend: (text: string) => {
      sends.push(text);
      return accepted;
    },
    onSendVoice: async () => {},
    onAttach: () => {},
    onPasteImage: (file: File) => pasted.push(file),
    onSendGif: () => true,
    onError: (error: string) => errors.push(error),
    onVoiceActive: () => {},
  };
  const pasted: File[] = [];
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
    cleanups.forEach((cleanup) => cleanup());
    effects = [];
    stateIndex = refIndex = 0;
    tree = module.exports.MessageComposer(props) as unknown as Node;
    find((node) => node.type === 'TextInput')!.props.ref.current = native;
    cleanups = effects
      .map((effect) => effect())
      .filter((value) => typeof value === 'function') as (() => void)[];
  };
  render();
  const type = (value: string) => {
    native.value = value;
    find((node) => node.type === 'TextInput')!.props.onChangeText(value);
  };
  return {
    native,
    sends,
    errors,
    pasted,
    paste: (files: File[]) => {
      let prevented = false;
      listeners.get('paste')?.({
        clipboardData: { files },
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    },
    props,
    render,
    type,
    emoji: (emoji: string) => {
      find((node) => node.props?.label === 'Open GIF library')!.props.onPress();
      render();
      find((node) => node.type === 'MediaPicker')!.props.onEmoji(emoji);
    },
    input: () => find((node) => node.type === 'TextInput')!,
    record: () => find((node) => node.type === 'VoiceRecordButton')!.props.onActive(true),
    send: () => find((node) => node.props?.accessibilityLabel === 'Send message')!.props.onPress(),
  };
}

test('Android clears native text in the send handler before React renders and keeps focus', () => {
  const t = composer();
  t.type('Send this now');
  t.render();
  t.send();
  assert.equal(t.input().props.value, 'Send this now', 'React has not committed a new render yet');
  assert.equal(t.native.value, '', 'the displayed native text must already be empty');
  assert.equal(t.native.focused, true);
  t.send();
  assert.deepEqual(t.sends, ['Send this now'], 'a second tap cannot resend the consumed draft');
  t.type('Next draft');
  t.render();
  assert.equal(t.input().props.value, 'Next draft');
  assert.equal(t.native.value, 'Next draft');
});

test('rejected or throwing queue operations preserve the native draft for another send', () => {
  for (const throws of [false, true]) {
    const t = composer(false);
    t.type('Keep this');
    t.render();
    if (throws)
      t.props.onSend = () => {
        throw new Error('Session changed');
      };
    t.send();
    assert.equal(t.native.value, 'Keep this');
    assert.equal(t.native.clears, 0);
    t.render();
    assert.equal(t.input().props.value, 'Keep this');
    t.props.onSend = (text: string) => {
      t.sends.push(text);
      return true;
    };
    t.render();
    t.send();
    assert.equal(t.sends.at(-1), 'Keep this');
    assert.equal(t.native.value, '');
  }
});

test('emoji replaces the selected text and sends with the rest of the draft', () => {
  const t = composer();
  t.type('Hello world!');
  t.render();
  t.input().props.onSelectionChange({ nativeEvent: { selection: { start: 6, end: 11 } } });
  t.emoji('😀');
  t.render();
  assert.equal(t.input().props.value, 'Hello 😀!');
  t.send();
  assert.deepEqual(t.sends, ['Hello 😀!']);
});

test('desktop image paste opens the image flow and preserves the composer draft', () => {
  const t = composer(true, 'web', 1200);
  const file = new File(['image bytes'], 'screenshot.png', { type: 'image/png' });
  t.type('Keep this draft');
  t.render();
  assert.equal(t.paste([file]), true);
  assert.deepEqual(t.pasted, [file]);
  assert.deepEqual(t.sends, []);
  t.render();
  assert.equal(t.input().props.value, 'Keep this draft');
  assert.equal(t.paste([]), false, 'ordinary text pastes keep browser behavior');
  assert.equal(t.paste([new File(['text'], 'notes.txt', { type: 'text/plain' })]), false);
});

test('image paste is disabled on mobile, inactive, busy, editing, and recording composers', () => {
  const file = new File(['image bytes'], 'screenshot.png', { type: 'image/png' });
  for (const [platform, width] of [
    ['android', 1200],
    ['web', 400],
  ] as const) {
    const t = composer(true, platform, width);
    assert.equal(t.paste([file]), false);
    assert.deepEqual(t.pasted, []);
  }
  for (const flags of [{ active: false }, { busy: true }, { editing: true }]) {
    const t = composer(true, 'web', 1200);
    Object.assign(t.props, flags);
    t.render();
    assert.equal(t.paste([file]), false);
    assert.deepEqual(t.pasted, []);
  }
  const t = composer(true, 'web', 1200);
  t.record();
  t.render();
  assert.equal(t.paste([file]), false);
  assert.deepEqual(t.pasted, []);
});
