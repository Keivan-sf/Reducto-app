import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, Icon, IconButton } from '../../components/ui';
import type { RecordedVoice } from '../../lib/voice-recording.types';
import { VoiceRecordButton } from './VoiceRecordButton';

interface Props {
  active?: boolean;
  initialText?: string;
  editing?: boolean;
  busy: boolean;
  hasAttachment: boolean;
  onSend: (text: string) => boolean;
  onSendVoice: (voice: RecordedVoice, signal: AbortSignal) => Promise<void>;
  onAttach: () => void;
  onOpenGifs: () => void;
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
  onOpenGifs,
  onError,
  onVoiceActive,
}: Props) {
  const [draft, setDraft] = useState(initialText);
  const text = useRef(initialText);
  const input = useRef<TextInput>(null);
  const [recording, setRecording] = useState(false);
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
    <>
      <View style={s.composer}>
        <IconButton
          name="attach-outline"
          label="Attach a file"
          disabled={busy || recording || editing}
          onPress={onAttach}
        />
        <TextInput
          ref={input}
          accessibilityLabel={editing ? 'Edit message text' : 'Message'}
          autoFocus={editing}
          editable={!recording && !(editing && busy)}
          multiline
          placeholder="Write a message…"
          placeholderTextColor="#96A3B0"
          value={draft}
          onChangeText={(value) => {
            text.current = value;
            setDraft(value);
          }}
          maxLength={10000}
          style={s.messageInput}
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
        <IconButton
          name="happy-outline"
          label="Open GIF library"
          disabled={busy || recording || editing}
          onPress={onOpenGifs}
        />
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
              setRecording(active);
              onVoiceActive(active);
            }}
          />
        )}
      </View>
      <Text style={s.composerHint}>
        {Platform.OS === 'web'
          ? `Enter to ${editing ? 'save' : 'send'} · Shift + Enter for a new line`
          : 'A little hello goes a long way'}
      </Text>
    </>
  );
}

const s = StyleSheet.create({
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    padding: 7,
    borderRadius: 17,
    backgroundColor: 'white',
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
  },
  messageInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingVertical: 12,
    paddingHorizontal: 6,
    fontSize: 15,
    color: colors.dark,
    outlineWidth: 0,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerHint: {
    color: '#9AAAB7',
    fontSize: 10,
    textAlign: 'center',
    paddingTop: 9,
    paddingBottom: 2,
  },
});
