import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, View } from 'react-native';
import { colors, Icon } from '../../components/ui';

const threshold = 64;
const horizontal = (dx: number, dy: number) => dx < -10 && -dx > Math.abs(dy) * 1.5;
// Follow the finger up to the threshold, then add resistance to long pulls.
const displacement = (dx: number) => {
  const distance = Math.max(0, -dx);
  return -Math.min(
    104,
    distance <= threshold ? distance : threshold + (distance - threshold) * 0.22,
  );
};

export function SwipeToReply({
  children,
  disabled,
  onReply,
  messageId,
}: PropsWithChildren<{ disabled: boolean; onReply: () => void; messageId: string }>) {
  const surface = useRef<View>(null);
  const [offset] = useState(() => new Animated.Value(0));
  const latest = useRef({ disabled, onReply });
  useEffect(() => {
    latest.current = { disabled, onReply };
  }, [disabled, onReply]);
  const [motion] = useState(() => ({
    move(dx: number) {
      offset.stopAnimation();
      offset.setValue(displacement(dx));
    },
    finish(dx: number, cancelled = false) {
      Animated.spring(offset, {
        toValue: 0,
        stiffness: 260,
        damping: 25,
        mass: 0.8,
        useNativeDriver: true,
        isInteraction: false,
      }).start();
      if (!cancelled && dx <= -threshold && !latest.current.disabled) latest.current.onReply();
    },
  }));
  const gestureState = useRef({ cancelled: false });
  // PanResponder stores these callbacks; it only reads refs when touch events arrive.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        !latest.current.disabled &&
        gesture.numberActiveTouches === 1 &&
        horizontal(gesture.dx, gesture.dy),
      onPanResponderGrant: (_, gesture) => {
        gestureState.current.cancelled = false;
        motion.move(gesture.dx);
      },
      onPanResponderMove: (_, gesture) => {
        if (gesture.numberActiveTouches !== 1) {
          gestureState.current.cancelled = true;
          motion.finish(0, true);
        } else if (!gestureState.current.cancelled) motion.move(gesture.dx);
      },
      onPanResponderRelease: (_, gesture) =>
        motion.finish(gesture.dx, gestureState.current.cancelled),
      onPanResponderTerminate: () => motion.finish(0, true),
      onPanResponderTerminationRequest: () => true,
    }),
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const element = surface.current as unknown as HTMLElement;
    if (!element) return;
    let touch: { id: number; x: number; y: number; dx: number; dragging: boolean } | null = null;
    let suppressClickUntil = 0;
    const finish = (cancelled: boolean) => {
      if (touch?.dragging) {
        suppressClickUntil = Date.now() + 400;
        motion.finish(touch.dx, cancelled);
      }
      touch = null;
    };
    const down = (event: PointerEvent) => {
      if (touch) {
        finish(true);
        return;
      }
      if (event.pointerType !== 'touch' || !event.isPrimary || latest.current.disabled) return;
      if ((event.target as Element).closest('input, textarea, video, audio, [role="slider"]'))
        return;
      touch = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dragging: false };
    };
    const move = (event: PointerEvent) => {
      if (!touch || event.pointerId !== touch.id) return;
      const dx = event.clientX - touch.x;
      const dy = event.clientY - touch.y;
      if (!touch.dragging) {
        if (Math.abs(dy) > 10 && !horizontal(dx, dy)) {
          touch = null;
          return;
        }
        if (!horizontal(dx, dy)) return;
        touch.dragging = true;
        element.setPointerCapture(event.pointerId);
      }
      touch.dx = dx;
      event.preventDefault();
      motion.move(dx);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === touch?.id) finish(false);
    };
    const cancel = () => finish(true);
    const lostCapture = (event: PointerEvent) => {
      if (event.target === element) finish(true);
    };
    const click = (event: MouseEvent) => {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move, { passive: false });
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel);
    element.addEventListener('lostpointercapture', lostCapture);
    element.addEventListener('click', click, true);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
      element.removeEventListener('lostpointercapture', lostCapture);
      element.removeEventListener('click', click, true);
      offset.stopAnimation();
    };
  }, [motion, offset]);

  return (
    <View
      ref={surface}
      testID={`swipe-reply-${messageId}`}
      style={Platform.OS === 'web' ? webStyle : undefined}
      {...(Platform.OS === 'web' ? {} : responder.panHandlers)}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          s.indicator,
          {
            opacity: offset.interpolate({
              inputRange: [-threshold, -12, 0],
              outputRange: [1, 0, 0],
              extrapolate: 'clamp',
            }),
            transform: [
              {
                scale: offset.interpolate({
                  inputRange: [-threshold, 0],
                  outputRange: [1, 0.5],
                  extrapolate: 'clamp',
                }),
              },
            ],
          },
        ]}
      >
        <Icon name="arrow-undo" size={20} color="white" />
      </Animated.View>
      <Animated.View
        testID={`swipe-reply-motion-${messageId}`}
        style={{ transform: [{ translateX: offset }] }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const webStyle = { position: 'relative', touchAction: 'pan-y' } as const;
const s = StyleSheet.create({
  indicator: {
    position: 'absolute',
    right: 12,
    top: '50%',
    marginTop: -22,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
