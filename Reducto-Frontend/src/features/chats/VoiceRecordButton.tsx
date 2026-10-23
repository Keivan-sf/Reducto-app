import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useIsFocused } from 'expo-router';
import { Icon, colors } from '../../components/ui';
import { HoldRecorder } from '../../lib/hold-recorder';
import { beginVoiceRecording } from '../../lib/voice-recording';
import { videoTime } from '../../lib/video-download.types';
import type { RecordedVoice, RecordingPhase } from '../../lib/voice-recording.types';

export function VoiceRecordButton({
  active = true,
  disabled,
  onSend,
  onError,
  onActive,
  onBeforeRecord,
}: {
  active?: boolean;
  disabled: boolean;
  onBeforeRecord?: () => boolean;
  onSend: (voice: RecordedVoice, signal: AbortSignal) => Promise<void>;
  onError: (error: string) => void;
  onActive: (active: boolean) => void;
}) {
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const routeFocused = useIsFocused();
  const focused = active && routeFocused;
  const callbacks = {
    begin: beginVoiceRecording,
    send: onSend,
    changed: (value: RecordingPhase) => {
      setPhase(value);
      onActive(value !== 'idle');
    },
    error: onError,
  };
  const [controller] = useState(() => new HoldRecorder(callbacks));
  useEffect(() => {
    controller.update(callbacks);
  });
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') controller.cancel();
    });
    return () => {
      subscription.remove();
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    if (!focused) controller.cancel();
  }, [focused, controller]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(timer);
  }, [phase]);
  const working = phase === 'stopping' || phase === 'sending';
  return (
    <View style={{ alignItems: 'center' }}>
      {phase !== 'idle' && (
        <View style={s.status} accessibilityLiveRegion="polite">
          <Text style={s.statusText}>
            {phase === 'recording'
              ? `Recording ${videoTime(elapsed)} · release to send`
              : phase === 'preparing'
                ? 'Preparing microphone…'
                : 'Sending voice message…'}
          </Text>
          {(phase === 'recording' || phase === 'preparing') && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel voice recording"
              onPress={() => controller.cancel()}
            >
              <Icon name="close" color="white" size={20} />
            </Pressable>
          )}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hold to record voice message"
        accessibilityHint="Keep holding while speaking. Release to send."
        disabled={disabled || working}
        onPressIn={() => {
          onBeforeRecord?.();
        }}
        delayLongPress={150}
        onLongPress={() => {
          if (phase === 'idle' && onBeforeRecord?.() !== false) {
            setElapsed(0);
            onError('');
            void controller.press();
          }
        }}
        onPressOut={(event) => {
          const native = event.nativeEvent as unknown as { buttons?: number; touches?: unknown[] };
          if (native.buttons || native.touches?.length) return;
          controller.release();
        }}
        onTouchEnd={(event) => {
          if (!event.nativeEvent.touches.length) controller.release();
        }}
        onTouchCancel={() => controller.cancel()}
        {...(Platform.OS === 'web'
          ? {
              onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
              onPointerDown: (event: unknown) => {
                const pointer = event as { currentTarget: HTMLElement; pointerId: number };
                pointer.currentTarget.setPointerCapture(pointer.pointerId);
              },
              onPointerUp: () => controller.release(),
            }
          : {})}
        style={[
          s.mic,
          phase === 'recording' && { backgroundColor: '#E95B65' },
          disabled && { opacity: 0.5 },
        ]}
      >
        {working || phase === 'preparing' ? (
          <ActivityIndicator color="white" />
        ) : (
          <Icon name="mic" color="white" size={23} />
        )}
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  mic: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
  status: {
    position: 'absolute',
    bottom: 56,
    right: 0,
    width: 270,
    backgroundColor: '#D94D59',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: { color: 'white', fontSize: 12, flex: 1 },
});
