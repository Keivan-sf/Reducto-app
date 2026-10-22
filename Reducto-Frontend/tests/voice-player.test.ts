import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { voicePlayback } from '../src/lib/voice-playback';

type Element = { type: unknown; props: Record<string, unknown> };

/** Model Expo's native disposal before the component's own effect cleanup.
 * Unlike the web player, every property access on a released native player throws. */
function nativeVoicePlayer() {
  let released = false;
  let pauses = 0;
  const effects: (() => void | (() => void))[] = [];
  const check = () => assert.equal(released, false, 'Shared object was already released');
  const player = {
    get id() {
      check();
      return 'native-voice-player';
    },
    pause() {
      check();
      pauses++;
    },
    play: check,
    seekTo: async () => check(),
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const module = { exports: {} as typeof import('../src/features/chats/VoiceMessage') };
  const source = readFileSync(
    new URL('../src/features/chats/VoiceMessage.tsx', import.meta.url),
    'utf8',
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react')
        return {
          useEffect: (effect: () => void | (() => void)) => effects.push(effect),
          useRef: (current: unknown) => ({ current }),
          useState: (value: unknown) => [value, () => {}],
        };
      if (name === 'react-native')
        return {
          View: 'View',
          Text: 'Text',
          Pressable: 'Pressable',
          Platform: { OS: 'android' },
          StyleSheet: { create: (styles: unknown) => styles },
          AppState: { addEventListener: () => ({ remove() {} }) },
        };
      if (name === 'expo-audio')
        return {
          useAudioPlayer: () => {
            effects.push(() => () => {
              released = true;
            });
            return player;
          },
          useAudioPlayerStatus: () => ({ duration: 3, currentTime: 0, isLoaded: true }),
        };
      if (name === 'expo-router') return { useIsFocused: () => true };
      if (name.endsWith('/ui')) return { Icon: 'Icon', colors: { blue: '#3390EC' } };
      if (name.endsWith('/VideosContext'))
        return {
          voiceFileKey: () => 'voice',
          useCachedFile: () => ({
            state: { status: 'ready', file: { uri: 'file:///voice.ogg' } },
            download: () => Promise.resolve(),
          }),
        };
      if (name.endsWith('/video-download.types')) return { videoTime: () => '0:03' };
      if (name.endsWith('/voice-playback')) return { voicePlayback };
      if (name === './VoiceSeekBar') return { VoiceSeekBar: 'VoiceSeekBar' };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const element = module.exports.VoiceMessage({
    conversationId: 'chat',
    mediaId: 'voice',
    active: true,
    onOptions() {},
    onError(message) {
      assert.fail(message);
    },
  }) as Element;
  const render = element.type as (props: Record<string, unknown>) => Element;
  render({ ...element.props, autoplay: true });
  const cleanups = effects.map((effect) => effect());
  return {
    pauses: () => pauses,
    unmount: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}

test('native voice cleanup unregisters playback without reading an already released player', () => {
  const native = nativeVoicePlayer();
  voicePlayback.pause();
  assert.equal(native.pauses(), 1, 'autoplay registered the native player');
  assert.doesNotThrow(native.unmount);
});

test('recording after a voice player unmounts cannot pause its released native object', () => {
  const native = nativeVoicePlayer();
  assert.doesNotThrow(native.unmount);
  assert.doesNotThrow(() => voicePlayback.pause());
  assert.equal(native.pauses(), 0);
});
