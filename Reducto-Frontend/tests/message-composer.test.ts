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
function composer(accepted = true) {
  const states: unknown[] = [];
  const refs: { current: any }[] = [];
  let stateIndex = 0,
    refIndex = 0;
  const native = {
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
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react')
        return {
          useEffect: () => {},
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
          Platform: { OS: 'android' },
          useWindowDimensions: () => ({ width: 400, height: 800 }),
          Keyboard: { dismiss: () => {} },
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
    busy: false,
    hasAttachment: false,
    onSend: (text: string) => {
      sends.push(text);
      return accepted;
    },
    onSendVoice: async () => {},
    onAttach: () => {},
    onSendGif: () => true,
    onError: (error: string) => errors.push(error),
    onVoiceActive: () => {},
  };
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
    stateIndex = refIndex = 0;
    tree = module.exports.MessageComposer(props) as unknown as Node;
    find((node) => node.type === 'TextInput')!.props.ref.current = native;
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
    props,
    render,
    type,
    emoji: (emoji: string) => {
      find((node) => node.props?.label === 'Open GIF library')!.props.onPress();
      render();
      find((node) => node.type === 'MediaPicker')!.props.onEmoji(emoji);
    },
    input: () => find((node) => node.type === 'TextInput')!,
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
