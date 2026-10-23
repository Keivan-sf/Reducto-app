import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const { outputText } = ts.transpileModule(
  readFileSync(new URL('../src/components/AppViewport.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
);

function viewport(platform = 'android', initiallyVisible = false) {
  let visible = initiallyVisible;
  let notifications = 0;
  let unsubscribe: (() => void) | undefined;
  const listeners = new Map<string, () => void>();
  const module = { exports: {} as typeof import('../src/components/AppViewport') };
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  runInNewContext(outputText, {
    exports: module.exports,
    require(name: string) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react')
        return {
          useSyncExternalStore(
            subscribe: (callback: () => void) => () => void,
            snapshot: () => boolean,
          ) {
            unsubscribe ??= subscribe(() => notifications++);
            return snapshot();
          },
        };
      if (name === 'react-native')
        return {
          Platform: { OS: platform },
          KeyboardAvoidingView: 'KeyboardAvoidingView',
          Keyboard: {
            isVisible: () => visible,
            addListener(event: string, listener: () => void) {
              listeners.set(event, listener);
              return { remove: () => listeners.delete(event) };
            },
          },
        };
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const render = () =>
    module.exports.AppViewport({ children: 'screen' }) as unknown as ReturnType<typeof jsx>;
  return {
    render,
    bottomInset: () => render().props.children.props.edges.includes('bottom'),
    keyboard(value: boolean) {
      visible = value;
      listeners.get(value ? 'keyboardDidShow' : 'keyboardDidHide')?.();
    },
    notifications: () => notifications,
    listeners,
    unmount: () => unsubscribe?.(),
  };
}

test('Android removes the navigation-bar inset above the keyboard and restores it on dismissal', () => {
  const app = viewport();
  assert.equal(app.bottomInset(), true);
  app.keyboard(true);
  assert.equal(app.bottomInset(), false);
  assert.deepEqual(Array.from(app.render().props.children.props.edges), ['top', 'left', 'right']);
  app.keyboard(false);
  assert.equal(app.bottomInset(), true);
  assert.equal(app.notifications(), 2);
  app.unmount();
  assert.equal(app.listeners.size, 0);
});

test('Android mounts correctly when the keyboard is already visible', () => {
  const app = viewport('android', true);
  assert.equal(app.bottomInset(), false);
  assert.equal(app.render().props.enabled, true);
  app.unmount();
});

test('iOS and web retain their safe-area insets and existing keyboard handling', () => {
  for (const platform of ['ios', 'web']) {
    const app = viewport(platform, true);
    assert.equal(app.bottomInset(), true);
    assert.equal(app.render().props.enabled, false);
    assert.equal(app.listeners.size, 0);
    app.unmount();
  }
});
