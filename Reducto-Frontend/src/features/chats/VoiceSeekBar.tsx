import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { Platform, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { colors } from '../../components/ui';
import { videoTime } from '../../lib/video-download.types';

interface Drag {
  x: number;
  left?: number;
  width: number;
  released?: boolean;
  pointerId?: number;
}
interface SeekPreview {
  seconds: number;
  committed: boolean;
}

/** Keep the gesture until release, including outside the track or message bubble. */
export function VoiceSeekBar({
  value,
  duration,
  enabled = true,
  onSeek,
  onDraggingChange,
}: {
  value: number;
  duration: number;
  enabled?: boolean;
  onSeek: (seconds: number) => void | Promise<void>;
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const view = useRef<View>(null);
  const drag = useRef<Drag | undefined>(undefined);
  const dragging = useRef(false);
  const draggingChanged = useRef(onDraggingChange);
  useEffect(() => {
    draggingChanged.current = onDraggingChange;
  }, [onDraggingChange]);
  const setDragging = (value: boolean) => {
    if (dragging.current === value) return;
    dragging.current = value;
    draggingChanged.current?.(value);
  };
  const [preview, setPreview] = useState<SeekPreview>();
  const available = enabled && Number.isFinite(duration) && duration > 0;
  const [previousAvailable, setPreviousAvailable] = useState(available);
  if (previousAvailable !== available) {
    setPreviousAvailable(available);
    setPreview(undefined);
  }
  // seekTo resolves before the next native status tick on Android. Keep the
  // released position until that tick acknowledges it, rather than showing the
  // old playback time in the gap between the gesture and the status update.
  if (preview?.committed && Math.abs(value - preview.seconds) <= 0.15) setPreview(undefined);
  const clamp = (seconds: number) => Math.max(0, Math.min(duration, seconds));
  const seconds = (gesture: Drag) =>
    clamp(((gesture.x - gesture.left!) / gesture.width) * duration);
  const cancel = () => {
    if (!drag.current) return; // Lost pointer capture after release is not a cancellation.
    drag.current = undefined;
    setDragging(false);
    setPreview(undefined);
  };
  useEffect(() => {
    if (!available) {
      drag.current = undefined;
      if (dragging.current) {
        dragging.current = false;
        draggingChanged.current?.(false);
      }
    }
    return () => {
      drag.current = undefined;
      if (dragging.current) {
        dragging.current = false;
        draggingChanged.current?.(false);
      }
    };
  }, [available]);
  const commit = (position: number) => {
    const pending: SeekPreview = { seconds: position, committed: true };
    setPreview(pending);
    try {
      void Promise.resolve(onSeek(position)).catch(() => {
        setPreview((current) => (current === pending ? undefined : current));
      });
    } catch {
      setPreview((current) => (current === pending ? undefined : current));
    }
  };
  const update = (x: number, released = false) => {
    const gesture = drag.current;
    if (!gesture || !Number.isFinite(x)) return;
    gesture.x = x;
    gesture.released = released;
    if (released) setDragging(false);
    if (gesture.left === undefined) return; // Native layout measurement is asynchronous.
    const position = seconds(gesture);
    if (released) {
      drag.current = undefined;
      commit(position);
    } else setPreview({ seconds: position, committed: false });
  };
  const startNative = (event: GestureResponderEvent) => {
    event.stopPropagation();
    if (!available) return false;
    const gesture: Drag = { x: event.nativeEvent.pageX, width: 1 };
    drag.current = gesture;
    setDragging(true);
    view.current?.measureInWindow((left, _top, width) => {
      if (drag.current !== gesture || !width) return;
      gesture.left = left;
      gesture.width = width;
      update(gesture.x, gesture.released);
    });
    // React Native uses the grant return value to block Android's native parent
    // ScrollView from intercepting this touch (onResponderTerminationRequest alone
    // only prevents other JS responders from taking it).
    return true;
  };
  const shown = preview?.seconds ?? (Number.isFinite(value) ? value : 0);
  const fraction = available ? clamp(shown) / duration : 0;
  return (
    <View
      ref={view}
      accessibilityRole="adjustable"
      accessibilityLabel="Voice message progress"
      accessibilityState={{ disabled: !available }}
      accessibilityValue={{
        min: 0,
        max: Math.ceil(duration),
        now: Math.floor(shown),
        text: `${videoTime(shown)} of ${videoTime(duration)}`,
      }}
      aria-valuemin={0}
      aria-valuemax={Math.ceil(duration)}
      aria-valuenow={Math.floor(shown)}
      aria-valuetext={`${videoTime(shown)} of ${videoTime(duration)}`}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (available) commit(clamp(shown + (nativeEvent.actionName === 'increment' ? 5 : -5)));
      }}
      focusable={available}
      {...(Platform.OS === 'web'
        ? {
            onPointerDown: (raw: unknown) => {
              const event = raw as PointerEvent<HTMLDivElement>;
              if (!available || event.button !== 0 || drag.current) return;
              event.preventDefault();
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              if (!bounds.width) return;
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                x: event.clientX,
                left: bounds.left,
                width: bounds.width,
                pointerId: event.pointerId,
              };
              setDragging(true);
              update(event.clientX);
            },
            onPointerMove: (raw: unknown) => {
              const event = raw as PointerEvent<HTMLDivElement>;
              if (drag.current?.pointerId === event.pointerId) update(event.clientX);
            },
            onPointerUp: (raw: unknown) => {
              const event = raw as PointerEvent<HTMLDivElement>;
              if (drag.current?.pointerId !== event.pointerId) return;
              event.stopPropagation();
              update(event.clientX, true);
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            },
            onPointerCancel: cancel,
            onLostPointerCapture: cancel,
            onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
            onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
              if (!available) return;
              const target =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? duration
                    : event.key === 'ArrowLeft'
                      ? shown - 5
                      : event.key === 'ArrowRight'
                        ? shown + 5
                        : undefined;
              if (target === undefined) return;
              event.preventDefault();
              event.stopPropagation();
              commit(clamp(target));
            },
          }
        : {
            onStartShouldSetResponder: () => available,
            onMoveShouldSetResponder: () => available,
            onResponderGrant: startNative,
            onResponderMove: (event: GestureResponderEvent) => update(event.nativeEvent.pageX),
            onResponderRelease: (event: GestureResponderEvent) =>
              update(event.nativeEvent.pageX, true),
            onResponderTerminationRequest: () => false,
            onResponderTerminate: cancel,
          })}
      style={[s.seek, Platform.OS === 'web' && webDragStyle]}
    >
      <View pointerEvents="none" style={s.track}>
        <View style={[s.fill, { width: `${fraction * 100}%` }]} />
        <View style={[s.dot, { left: `${fraction * 100}%` }]} />
      </View>
    </View>
  );
}
const webDragStyle = { touchAction: 'none', userSelect: 'none', cursor: 'pointer' } as const;
const s = StyleSheet.create({
  seek: { height: 32, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, backgroundColor: '#3390EC38' },
  fill: { height: 3, backgroundColor: colors.blue, borderRadius: 2 },
  dot: {
    position: 'absolute',
    top: -3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.blue,
    marginLeft: -4,
  },
});
