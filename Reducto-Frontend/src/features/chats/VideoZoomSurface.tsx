import { useEffect, useState, type PropsWithChildren } from 'react';
import { Animated, Easing, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { ImageViewerGestures } from './image-viewer-gestures';

/** Own every touch from ACTION_DOWN; the Android player must never intercept a pinch. */
export function VideoZoomSurface({
  children,
  uri,
  active,
  size,
}: PropsWithChildren<{
  uri?: string;
  active: boolean;
  size?: { width: number; height: number };
}>) {
  const [scale] = useState(() => new Animated.Value(1));
  const [x] = useState(() => new Animated.Value(0));
  const [y] = useState(() => new Animated.Value(0));
  const [gestures] = useState(
    () =>
      new ImageViewerGestures((transform, animate) => {
        const values = [
          [scale, transform.scale],
          [x, transform.x],
          [y, transform.y],
        ] as const;
        for (const [value] of values) value.stopAnimation();
        if (animate) {
          Animated.parallel(
            values.map(([value, toValue]) =>
              Animated.timing(value, {
                toValue,
                duration: 220,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
                isInteraction: false,
              }),
            ),
          ).start();
        } else {
          for (const [value, toValue] of values) value.setValue(toValue);
        }
      }),
  );
  useEffect(() => {
    gestures.reset();
  }, [gestures, uri, active]);
  const width = size?.width;
  const height = size?.height;
  useEffect(() => {
    if (width && height) gestures.imageSize(width, height);
  }, [gestures, width, height]);
  const update = (event: GestureResponderEvent) =>
    gestures.update(
      event.nativeEvent.touches.map((touch) => ({ x: touch.locationX, y: touch.locationY })),
    );
  return (
    <View
      testID="video-viewer-surface"
      collapsable={false}
      style={s.surface}
      onLayout={({ nativeEvent }) =>
        gestures.layout(nativeEvent.layout.width, nativeEvent.layout.height)
      }
      onStartShouldSetResponder={() => true}
      onResponderGrant={update}
      onResponderStart={update}
      onResponderMove={update}
      onResponderEnd={update}
      onResponderRelease={() => gestures.finish()}
      onResponderTerminationRequest={() => false}
      onResponderTerminate={() => gestures.finish(true)}
    >
      <Animated.View
        testID="video-viewer-transform"
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { transform: [{ translateX: x }, { translateY: y }, { scale }] },
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  surface: { flex: 1, overflow: 'hidden' },
});
