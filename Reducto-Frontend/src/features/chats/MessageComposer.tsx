import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, Icon, IconButton } from '../../components/ui';
import type { RecordedVoice } from '../../lib/voice-recording.types';
import { VoiceRecordButton } from './VoiceRecordButton';

interface Props {
  busy: boolean;
  hasAttachment: boolean;
  onSend: (text: string) => Promise<boolean>;
  onSendVoice: (voice: RecordedVoice, signal: AbortSignal) => Promise<void>;
  onAttach: () => void;
  onOpenGifs: () => void;
  onError: (error: string) => void;
  onVoiceActive: (active: boolean) => void;
}

/** Keep keystrokes and the send/mic switch independent of history rendering. */
export function MessageComposer({
  busy,
  hasAttachment,
  onSend,
  onSendVoice,
  onAttach,
  onOpenGifs,
  onError,
  onVoiceActive,
}: Props) {
  const [draft, setDraft] = useState('');
  const text = useRef('');
  const input = useRef<TextInput>(null);
  const sending = useRef(false);
  const [recording, setRecording] = useState(false);
  const canSend = !!draft.trim() || hasAttachment;
  async function submit() {
    const submitted = text.current;
    if (busy || sending.current || (!submitted.trim() && !hasAttachment)) return;
    sending.current = true;
    input.current?.focus();
    try {
      if (await onSend(submitted)) {
        // Keep edits made while the request was pending.
        if (text.current === submitted) {
          text.current = '';
          setDraft('');
        }
      }
    } finally {
      sending.current = false;
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
          disabled={busy || recording}
          onPress={onAttach}
        />
        <TextInput
          ref={input}
          accessibilityLabel="Message"
          editable={!recording}
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
          disabled={busy || recording}
          onPress={onOpenGifs}
        />
        {canSend ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={busy}
            onPress={() => void submit()}
            style={[s.send, busy && { opacity: 0.45 }]}
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Icon name="send" color="white" size={20} />
            )}
          </Pressable>
        ) : (
          <VoiceRecordButton
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
          ? 'Enter to send · Shift + Enter for a new line'
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
