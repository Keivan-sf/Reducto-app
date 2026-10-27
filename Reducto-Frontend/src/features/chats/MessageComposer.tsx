import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors, Icon, IconButton } from '../../components/ui';
import type { RecordedVoice } from '../../lib/voice-recording.types';
import { VoiceRecordButton } from './VoiceRecordButton';
import { MediaPicker } from './MediaPicker';

interface Props {
  active?: boolean;
  initialText?: string;
  editing?: boolean;
  busy: boolean;
  hasAttachment: boolean;
  onSend: (text: string) => boolean;
  onSendVoice: (voice: RecordedVoice, signal: AbortSignal) => Promise<void>;
  onAttach: () => void;
  onPickerVisibilityChange?: (open: boolean) => void;
  onSendGif?: (id: string) => boolean;
  onError: (error: string) => void;
  onVoiceActive: (active: boolean) => void;
}

/** Keep keystrokes and the send/mic switch independent of history rendering. */
export function MessageComposer({
  active = true,
  initialText = '',
  editing = false,
  busy,
  hasAttachment,
  onSend,
  onSendVoice,
  onAttach,
  onSendGif,
  onPickerVisibilityChange,
  onError,
  onVoiceActive,
}: Props) {
  const [draft, setDraft] = useState(initialText);
  const text = useRef(initialText);
  const input = useRef<TextInput>(null);
  const [recording, setRecording] = useState(false);
  const { width, height } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && width >= 768;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMounted, setPickerMounted] = useState(false);
  const pickerElement = useRef<View>(null);
  useLayoutEffect(() => {
    if (!desktop) return;
    const element = pickerElement.current as unknown as HTMLElement | null;
    if (!element) return;
    const current = getComputedStyle(element);
    // Opacity/transform run in the browser compositor, independently of the
    // JavaScript work that queues a GIF and renders its message in the chat.
    const animation = element.animate(
      [
        { opacity: current.opacity, transform: current.transform },
        { opacity: pickerOpen ? 1 : 0, transform: `scale(${pickerOpen ? 1 : 0.96})` },
      ],
      {
        duration: pickerOpen ? 160 : 80,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        fill: 'forwards',
      },
    );
    animation.onfinish = () => {
      if (!pickerOpen) setPickerMounted(false);
    };
    return () => {
      animation.onfinish = null;
      // Preserve the current frame when a hover reverses an unfinished exit.
      if (element.isConnected) animation.commitStyles();
      animation.cancel();
    };
  }, [desktop, pickerOpen]);
  const [cursor, setCursor] = useState<{ start: number; end: number }>();
  const selection = useRef({ start: initialText.length, end: initialText.length });
  const holdOpen = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function cancelClose() {
    clearTimeout(closeTimer.current);
  }
  function closePicker() {
    cancelClose();
    setPickerOpen(false);
  }
  function openPicker() {
    if (busy || recording || editing || !active) return;
    cancelClose();
    if (Platform.OS === 'web' && !pickerOpen) {
      const element = input.current as unknown as {
        selectionStart: number;
        selectionEnd: number;
      } | null;
      if (element && typeof element.selectionStart === 'number') {
        selection.current = { start: element.selectionStart, end: element.selectionEnd };
      }
    }
    if (!desktop) Keyboard.dismiss();
    setPickerMounted(desktop);
    setPickerOpen(true);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setPickerOpen(false);
  }
  useEffect(() => {
    onPickerVisibilityChange?.(pickerOpen && active);
    return () => onPickerVisibilityChange?.(false);
  }, [pickerOpen, active, onPickerVisibilityChange]);
  useEffect(() => {
    if (!pickerOpen) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      setPickerOpen(false);
      return true;
    });
    return () => {
      back.remove();
    };
  }, [pickerOpen]);
  function insertEmoji(emoji: string) {
    const { start, end } = selection.current;
    const value = text.current.slice(0, start) + emoji + text.current.slice(end);
    if (value.length > 10000) return;
    text.current = value;
    setDraft(value);
    selection.current = { start: start + emoji.length, end: start + emoji.length };
    setCursor(selection.current);
  }
  const canSend = !!draft.trim() || hasAttachment;
  function submit() {
    const submitted = text.current;
    if (busy || (!submitted.trim() && !hasAttachment)) return;
    input.current?.focus();
    // Consume the draft synchronously so another tap cannot send it twice.
    text.current = '';
    try {
      if (!onSend(submitted)) {
        text.current = submitted;
        return;
      }
      // Android can keep displaying the controlled value until React commits.
      // Clear the native text/selection now, in the same press handler, without
      // blurring the input or waiting for a render/network response.
      input.current?.clear();
      setDraft('');
      selection.current = { start: 0, end: 0 };
      setCursor(undefined);
    } catch (error) {
      text.current = submitted;
      onError(error instanceof Error ? error.message : 'Could not send message.');
    }
  }
  function beforeRecord() {
    // A tap may beat the render that replaces the microphone. Read the latest
    // input event synchronously and send instead of starting a recording.
    if (text.current.trim() || hasAttachment) {
      void submit();
      return false;
    }
    return true;
  }
  return (
    <View
      style={{ position: 'relative', zIndex: pickerOpen || pickerMounted ? 20 : 0 }}
      onPointerEnter={cancelClose}
      onPointerLeave={() => {
        if (desktop && !holdOpen.current) closeTimer.current = setTimeout(closePicker, 220);
      }}
      {...(Platform.OS === 'web'
        ? {
            onKeyDown: (event: { key: string; stopPropagation: () => void }) => {
              if (event.key === 'Escape' && pickerOpen) {
                event.stopPropagation();
                closePicker();
                input.current?.focus();
              }
            },
          }
        : {})}
    >
      <View style={s.composer}>
        <View style={recording && s.hidden}>
          <IconButton
            name="attach-outline"
            label="Attach a file"
            disabled={busy || recording || editing}
            onPress={onAttach}
          />
        </View>
        <TextInput
          ref={input}
          accessibilityLabel={editing ? 'Edit message text' : 'Message'}
          autoFocus={editing}
          editable={!recording && !(editing && busy)}
          multiline
          numberOfLines={Platform.OS === 'web' ? 1 : undefined}
          placeholder="Write a message…"
          placeholderTextColor="#96A3B0"
          value={draft}
          selection={cursor}
          onFocus={closePicker}
          onSelectionChange={({ nativeEvent }) => {
            selection.current = nativeEvent.selection;
          }}
          onChangeText={(value) => {
            setCursor(undefined);
            text.current = value;
            setDraft(value);
          }}
          maxLength={10000}
          style={[s.messageInput, recording && s.hidden]}
          onKeyPress={(event) => {
            if (
              Platform.OS === 'web' &&
              event.nativeEvent.key === 'Enter' &&
              !(event.nativeEvent as unknown as { shiftKey: boolean }).shiftKey
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <View
          style={recording && s.hidden}
          onPointerEnter={(event) => {
            if (desktop && event.nativeEvent.pointerType === 'mouse') openPicker();
          }}
        >
          <IconButton
            name={pickerOpen && !desktop ? 'keypad-outline' : 'happy-outline'}
            label="Open GIF library"
            disabled={busy || recording || editing}
            onPress={() => {
              if (!desktop && pickerOpen) {
                closePicker();
                input.current?.focus();
              } else openPicker();
            }}
          />
        </View>
        {canSend || editing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Save message edit' : 'Send message'}
            disabled={busy || !canSend}
            onPress={() => void submit()}
            style={[s.send, (busy || !canSend) && { opacity: 0.45 }]}
          >
            <Icon name={editing ? 'checkmark' : 'send'} color="white" size={20} />
          </Pressable>
        ) : (
          <VoiceRecordButton
            active={active}
            disabled={busy}
            onBeforeRecord={beforeRecord}
            onSend={onSendVoice}
            onError={onError}
            onActive={(active) => {
              if (active) closePicker();
              setRecording(active);
              onVoiceActive(active);
            }}
          />
        )}
      </View>
      {(pickerOpen || (desktop && pickerMounted)) && active && !editing && onSendGif && (
        <View
          ref={pickerElement}
          testID={desktop ? 'media-picker-popover' : 'media-picker-keyboard'}
          pointerEvents={pickerOpen ? 'auto' : 'none'}
          style={desktop ? s.popover : undefined}
        >
          <MediaPicker
            height={Math.min(desktop ? 420 : 320, height * (desktop ? 0.65 : 0.45))}
            onClose={closePicker}
            onSend={onSendGif}
            onEmoji={insertEmoji}
            onHoldOpen={(hold) => {
              holdOpen.current = hold;
              cancelClose();
            }}
          />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  popover: {
    transformOrigin: 'bottom right',
    opacity: 0,
    transform: [{ scale: 0.92 }],
    position: 'absolute',
    bottom: 56,
    right: 48,
    width: 368,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'white',
    boxShadow: '0 4px 28px #17212B33',
    borderWidth: 1,
    borderColor: colors.border,
  },
  hidden: { display: 'none' },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 6,
    backgroundColor: 'white',
    width: '100%',
    alignSelf: 'center',
  },
  messageInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    maxHeight: 140,
    paddingVertical: 12,
    paddingHorizontal: 6,
    fontSize: 15,
    lineHeight: 20,
    textAlignVertical: 'center',
    ...(Platform.OS === 'web' ? { fieldSizing: 'content', outlineStyle: 'solid' } : {}),
    color: colors.dark,
    borderWidth: 0,
    outlineWidth: 0,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
