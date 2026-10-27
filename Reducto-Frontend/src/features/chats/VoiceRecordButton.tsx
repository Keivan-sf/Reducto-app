import { useTheme, createThemedStyles } from '../../context/ThemeContext';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useIsFocused } from 'expo-router';
import { Icon } from '../../components/ui';
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
  const { colors } = useTheme();
  const s = useStyles();
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const gesture = useRef({ x: 0, y: 0, send: false, identifier: '' });
  const nativeHeld = useRef(false);
  const nativeHoldTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    const cancel = () => {
      clearTimeout(nativeHoldTimer.current);
      nativeHeld.current = false;
      controller.cancel();
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') cancel();
    });
    return () => {
      subscription.remove();
      clearTimeout(nativeHoldTimer.current);
      nativeHeld.current = false;
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    if (!focused) {
      clearTimeout(nativeHoldTimer.current);
      nativeHeld.current = false;
      controller.cancel();
    }
  }, [focused, controller]);
  const recording = phase === 'recording' || phase === 'locked';
  const locked = phase === 'locked';
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(timer);
  }, [recording]);
  const working = phase === 'stopping' || phase === 'sending';
  function start(x: number, y: number, identifier = '') {
    gesture.current = { x, y, send: locked, identifier };
  }
  function move(x: number, y: number) {
    const dx = x - gesture.current.x;
    const dy = y - gesture.current.y;
    if (dy <= -60 && -dy > Math.abs(dx)) controller.lock();
  }
  function beginHold() {
    if (onBeforeRecord?.() === false) return;
    setElapsed(0);
    onError('');
    void controller.press();
  }
  function finishNativeHold() {
    if (!nativeHeld.current) return;
    nativeHeld.current = false;
    clearTimeout(nativeHoldTimer.current);
    // Send is determined at touch-down, never by the icon shown at release.
    if (gesture.current.send) controller.send();
    else controller.release();
  }
  const RecordControl = Platform.OS === 'web' ? Pressable : View;
  return (
    <View style={[s.row, phase !== 'idle' && s.activeRow]}>
      {phase !== 'idle' && (
        <View style={s.status}>
          <View style={s.timer}>
            <View style={s.dot} />
            <Text style={s.statusText} accessibilityLabel={`Recording ${videoTime(elapsed)}`}>
              {videoTime(elapsed)}
            </Text>
          </View>
          {locked ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel voice recording"
              onPress={() => controller.cancel()}
              style={s.cancel}
            >
              <Text style={s.cancelText}>Cancel</Text>
            </Pressable>
          ) : (
            <Text style={s.hint} accessibilityLiveRegion="polite">
              {phase === 'recording'
                ? `Recording ${videoTime(elapsed)} · release to send`
                : phase === 'preparing'
                  ? 'Preparing microphone…'
                  : 'Sending voice message…'}
            </Text>
          )}
        </View>
      )}
      {phase === 'recording' && (
        <View style={s.lockHint} pointerEvents="none">
          <Icon name="lock-closed" color={colors.muted} size={17} />
          <Icon name="chevron-up" color={colors.blue} size={20} />
          <Text style={s.lockText}>Slide up to lock</Text>
        </View>
      )}
      <RecordControl
        accessibilityRole="button"
        accessibilityLabel={locked ? 'Send voice message' : 'Hold to record voice message'}
        accessibilityHint={
          locked ? 'Tap to send your recording.' : 'Release to send. Slide up to lock recording.'
        }
        accessibilityState={{ disabled: disabled || working }}
        {...(Platform.OS === 'web'
          ? {
              disabled: disabled || working,
              onPressIn: () => {
                if (!locked) onBeforeRecord?.();
              },
              onPress: () => {
                if (gesture.current.send) controller.send();
              },
              delayLongPress: 150,
              onLongPress: () => {
                if (phase === 'idle') beginHold();
              },
              onPressOut: (event: GestureResponderEvent) => {
                const native = event.nativeEvent as unknown as {
                  buttons?: number;
                  touches?: unknown[];
                };
                if (!native.buttons && !native.touches?.length) controller.release();
              },
              onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
              onPointerDown: (event: unknown) => {
                const pointer = event as {
                  currentTarget: HTMLElement;
                  pointerId: number;
                  pageX: number;
                  pageY: number;
                };
                start(pointer.pageX, pointer.pageY);
                pointer.currentTarget.setPointerCapture(pointer.pointerId);
              },
              onPointerMove: (event: unknown) => {
                const pointer = event as { pageX: number; pageY: number; buttons: number };
                if (pointer.buttons) move(pointer.pageX, pointer.pageY);
              },
              onPointerUp: () => controller.release(),
              onPointerCancel: () => controller.cancel(),
            }
          : {
              // A stable View owns the entire native gesture. Pressable's press
              // rectangle and touch-count heuristics cannot end or swallow it.
              onStartShouldSetResponder: () => focused && !disabled && !working,
              onResponderGrant: (event: GestureResponderEvent) => {
                const touch = event.nativeEvent;
                start(touch.pageX, touch.pageY, touch.identifier);
                nativeHeld.current = true;
                if (!locked) {
                  if (onBeforeRecord?.() === false) {
                    nativeHeld.current = false;
                    return true;
                  }
                  nativeHoldTimer.current = setTimeout(() => {
                    if (nativeHeld.current) beginHold();
                  }, 150);
                }
                // Prevent Android's native scroll views from stealing the hold.
                return true;
              },
              onResponderMove: (event: GestureResponderEvent) => {
                if (!nativeHeld.current || gesture.current.send) return;
                const touch = event.nativeEvent.touches.find(
                  (touch) => touch.identifier === gesture.current.identifier,
                );
                if (touch) move(touch.pageX, touch.pageY);
              },
              onResponderEnd: (event: GestureResponderEvent) => {
                if (
                  event.nativeEvent.changedTouches.some(
                    (touch) => touch.identifier === gesture.current.identifier,
                  )
                )
                  finishNativeHold();
              },
              // Responder release is definitive even if Android still includes
              // the lifted finger in the event's touches array.
              onResponderRelease: finishNativeHold,
              onResponderTerminationRequest: () => false,
              onResponderTerminate: () => {
                clearTimeout(nativeHoldTimer.current);
                nativeHeld.current = false;
                controller.cancel();
              },
              onAccessibilityTap: () => {
                if (locked) controller.send();
              },
            })}
        style={[
          s.mic,
          phase === 'recording' && { backgroundColor: '#E95B65' },
          Platform.OS === 'web' && webGestureStyle,
          disabled && { opacity: 0.5 },
        ]}
      >
        {working || phase === 'preparing' ? (
          <ActivityIndicator color="white" />
        ) : (
          <Icon name={locked ? 'send' : 'mic'} color="white" size={23} />
        )}
      </RecordControl>
    </View>
  );
}
const webGestureStyle = { touchAction: 'none', userSelect: 'none', cursor: 'pointer' } as const;
const useStyles = createThemedStyles((colors) => ({
  mic: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  activeRow: { flex: 1, minHeight: 44 },
  status: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  statusText: { color: colors.dark, fontSize: 14, fontVariant: ['tabular-nums'] },
  hint: { flex: 1, color: colors.muted, fontSize: 12 },
  cancel: { flex: 1, alignItems: 'center', padding: 12 },
  cancelText: { color: colors.blue, fontSize: 15, fontWeight: '500' },
  lockHint: {
    position: 'absolute',
    bottom: 56,
    right: 0,
    width: 60,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 24,
    backgroundColor: colors.pale,
    alignItems: 'center',
    gap: 8,
  },
  lockText: { color: colors.muted, fontSize: 10, textAlign: 'center' },
}));
