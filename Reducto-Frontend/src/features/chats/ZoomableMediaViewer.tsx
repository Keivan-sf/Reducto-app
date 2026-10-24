import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, IconButton } from '../../components/ui';
import { saveLocalFile } from '../../lib/local-attachments';
import { useCachedFile, useVideos } from '../../context/VideosContext';
import { ImageViewerGestures, type ImagePoint } from './image-viewer-gestures';
import { VideoPlayback } from './VideoPlayback';

export function ZoomableMediaViewer({
  visible = true,
  kind,
  fileKey: key,
  pauseRef,
  canPlay,
  title,
  createdAt,
  caption,
  onClose,
  onForward,
}: {
  visible?: boolean;
  kind: 'image' | 'gif';
  fileKey: string;
  pauseRef?: RefObject<(() => void) | null>;
  canPlay?: () => boolean;
  title: string;
  createdAt: string;
  caption?: string | null;
  onClose: () => void;
  onForward: () => void;
}) {
  const files = useVideos();
  const label = kind === 'gif' ? 'GIF' : 'image';
  const { state, download } = useCachedFile(
    key,
    visible,
    kind === 'gif' ? 'video/mp4' : 'image/jpeg',
  );
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ key: string; message: string } | null>(null);
  async function save() {
    if (savingRef.current || state.status !== 'ready') return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await saveLocalFile(await download());
    } catch (error) {
      setSaveError({
        key,
        message: error instanceof Error ? error.message : `Could not save this ${label}.`,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  const [failure, setFailure] = useState({ key, visible, failed: false });
  if (failure.key !== key || failure.visible !== visible) {
    setFailure({ key, visible, failed: false });
  }
  const mediaFailed = failure.key === key && failure.visible === visible && failure.failed;
  const [offset] = useState(() => new Animated.Value(0));
  const [zoom] = useState(() => new Animated.Value(1));
  const [panX] = useState(() => new Animated.Value(0));
  const [panY] = useState(() => new Animated.Value(0));
  const [gestures] = useState(
    () =>
      new ImageViewerGestures((transform, animate) => {
        offset.stopAnimation();
        offset.setValue(transform.dismiss);
        const values = [
          [zoom, transform.scale],
          [panX, transform.x],
          [panY, transform.y],
        ] as const;
        if (animate) {
          // Animate scale and focal-point translation together so the image stays anchored.
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
  const pointers = useRef(new Map<number, ImagePoint>());
  useEffect(() => {
    if (visible) void download().catch(() => {});
  }, [download, visible]);
  useEffect(() => {
    gestures.reset();
    pointers.current.clear();
  }, [key, visible, gestures]);
  const imageUri =
    state.status === 'ready' && (kind === 'image' || state.file.mimeType === 'image/gif')
      ? state.file.uri
      : undefined;
  const onMediaSize = useCallback(
    (size: { width: number; height: number }) => {
      gestures.imageSize(size.width, size.height);
    },
    [gestures],
  );
  const onMediaError = useCallback(
    () => setFailure({ key, visible, failed: true }),
    [key, visible],
  );
  useEffect(() => {
    if (!imageUri) return;
    let disposed = false;
    Image.getSize(
      imageUri,
      (width, height) => {
        if (!disposed) gestures.imageSize(width, height);
      },
      () => {},
    );
    return () => {
      disposed = true;
    };
  }, [imageUri, gestures]);
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [onClose, visible]);
  function nativePoints(event: GestureResponderEvent) {
    return event.nativeEvent.touches.map((touch) => ({
      x: touch.locationX ?? touch.pageX,
      y: touch.locationY ?? touch.pageY,
    }));
  }
  function finish(cancelled = false) {
    const dismiss = gestures.transform.dismiss;
    if (gestures.finish(cancelled)) onClose();
    else if (dismiss) {
      offset.setValue(dismiss);
      Animated.spring(offset, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 15,
      }).start();
    }
  }
  return (
    <SafeAreaView style={s.screen} testID={`${kind}-viewer`}>
      <View style={s.header}>
        <IconButton
          name="arrow-back"
          label="Back to conversation"
          color="white"
          onPress={onClose}
        />
        <View style={s.heading}>
          <Text numberOfLines={1} style={s.title}>
            {title}
          </Text>
          <Text style={s.date}>
            {new Date(createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </Text>
        </View>
        <IconButton
          name="arrow-redo"
          label={`Forward ${label}`}
          color="white"
          onPress={onForward}
        />
        <IconButton
          name="download-outline"
          label="Save attachment"
          color="white"
          disabled={saving || state.status !== 'ready'}
          onPress={() => void save()}
        />
      </View>
      {saveError?.key === key && (
        <Text accessibilityRole="alert" style={s.message}>
          {saveError.message}
        </Text>
      )}
      <View
        testID={`${kind}-viewer-surface`}
        style={[s.surface, Platform.OS === 'web' && webGestureStyle]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          gestures.layout(width, height);
          pointers.current.clear();
        }}
        {...(Platform.OS === 'web'
          ? {
              onPointerDown: (raw: unknown) => {
                const event = raw as ViewerPointerEvent;
                // Let Retry and other controls receive their own pointer-up.
                if (event.target.closest('button, [role="button"]')) return;
                if (event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                pointers.current.set(event.pointerId, pointerPoint(event));
                gestures.update([...pointers.current.values()]);
              },
              onPointerMove: (raw: unknown) => {
                const event = raw as ViewerPointerEvent;
                if (!pointers.current.has(event.pointerId)) return;
                pointers.current.set(event.pointerId, pointerPoint(event));
                gestures.update([...pointers.current.values()]);
              },
              onPointerUp: (raw: unknown) => {
                const event = raw as ViewerPointerEvent;
                if (!pointers.current.has(event.pointerId)) return;
                pointers.current.set(event.pointerId, pointerPoint(event));
                gestures.update([...pointers.current.values()]);
                pointers.current.delete(event.pointerId);
                if (pointers.current.size) gestures.update([...pointers.current.values()]);
                else finish();
              },
              onPointerCancel: () => {
                pointers.current.clear();
                finish(true);
              },
              onLostPointerCapture: (raw: unknown) => {
                const event = raw as ViewerPointerEvent;
                if (pointers.current.has(event.pointerId)) {
                  pointers.current.clear();
                  finish(true);
                }
              },
            }
          : {
              onStartShouldSetResponder: () => true,
              onResponderGrant: (event: GestureResponderEvent) => {
                gestures.update(nativePoints(event));
                return true;
              },
              onResponderStart: (event: GestureResponderEvent) =>
                gestures.update(nativePoints(event)),
              onResponderMove: (event: GestureResponderEvent) =>
                gestures.update(nativePoints(event)),
              onResponderEnd: (event: GestureResponderEvent) => {
                const points = nativePoints(event);
                if (points.length) gestures.update(points);
              },
              onResponderRelease: () => finish(),
              onResponderTerminationRequest: () => false,
              onResponderTerminate: () => finish(true),
            })}
      >
        {state.status === 'ready' && !mediaFailed ? (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { transform: [{ translateY: offset }] }]}
          >
            <Animated.View
              testID={`${kind}-viewer-transform`}
              style={[
                StyleSheet.absoluteFill,
                {
                  transform: [{ translateX: panX }, { translateY: panY }, { scale: zoom }],
                },
              ]}
            >
              {kind === 'gif' && state.file.mimeType !== 'image/gif' ? (
                <VideoPlayback
                  uri={state.file.uri}
                  active={visible}
                  pauseRef={pauseRef}
                  canPlay={canPlay}
                  loop
                  muted
                  nativeControls={false}
                  onSize={onMediaSize}
                  onError={onMediaError}
                />
              ) : (
                <Image
                  accessibilityLabel={`Full screen ${label}`}
                  source={{ uri: state.file.uri }}
                  resizeMode="contain"
                  style={StyleSheet.absoluteFill}
                  onError={onMediaError}
                />
              )}
            </Animated.View>
          </Animated.View>
        ) : (
          <View style={s.loading}>
            {state.status === 'loading' || state.status === 'idle' ? (
              visible && <ActivityIndicator color="white" />
            ) : (
              <>
                <Text accessibilityRole="alert" style={s.message}>
                  {state.status === 'error'
                    ? state.error
                    : `${kind === 'gif' ? 'GIF' : 'Image'} unavailable`}
                </Text>
                <Button
                  title={`Retry ${label}`}
                  secondary
                  onPress={() => {
                    setFailure({ key, visible, failed: false });
                    files.forget(key);
                    void download().catch(() => {});
                  }}
                />
              </>
            )}
          </View>
        )}
      </View>
      {!!caption && <Text style={s.caption}>{caption}</Text>}
    </SafeAreaView>
  );
}
type ViewerPointerEvent = {
  button: number;
  clientX: number;
  clientY: number;
  pointerId: number;
  currentTarget: HTMLElement;
  target: HTMLElement;
};
function pointerPoint(event: ViewerPointerEvent): ImagePoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}
const webGestureStyle = { touchAction: 'none', userSelect: 'none', cursor: 'auto' } as const;
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'black' },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  heading: { flex: 1, gap: 3 },
  title: { color: 'white', fontSize: 17, fontWeight: '600' },
  date: { color: '#C5CED6', fontSize: 12 },
  surface: { flex: 1, overflow: 'hidden' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  message: { color: 'white', textAlign: 'center' },
  caption: { color: 'white', padding: 16, textAlign: 'center', fontSize: 15 },
});
