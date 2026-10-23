import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
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
import { useCachedFile, useVideos, videoKey } from '../../context/VideosContext';

export function ImageViewer({
  visible = true,
  conversationId,
  mediaId,
  title,
  createdAt,
  caption,
  onClose,
  onForward,
}: {
  visible?: boolean;
  conversationId: string;
  mediaId: string;
  title: string;
  createdAt: string;
  caption?: string | null;
  onClose: () => void;
  onForward: () => void;
}) {
  const files = useVideos();
  const key = videoKey(conversationId, mediaId);
  const { state, download } = useCachedFile(key, visible, 'image/jpeg');
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
        message: error instanceof Error ? error.message : 'Could not save this image.',
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
  const imageFailed = failure.key === key && failure.visible === visible && failure.failed;
  const [offset] = useState(() => new Animated.Value(0));
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  useEffect(() => {
    if (visible) void download().catch(() => {});
  }, [download, visible]);
  useEffect(() => {
    offset.stopAnimation();
    offset.setValue(0);
    drag.current = null;
  }, [key, visible, offset]);
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
  function start(x: number, y: number) {
    offset.stopAnimation();
    drag.current = { x, y, dx: 0, dy: 0 };
  }
  function move(x: number, y: number) {
    const current = drag.current;
    if (!current) return;
    current.dx = x - current.x;
    current.dy = y - current.y;
    offset.setValue(Math.abs(current.dy) > Math.abs(current.dx) ? current.dy : 0);
  }
  function finish(cancelled = false) {
    const current = drag.current;
    drag.current = null;
    if (
      !cancelled &&
      current &&
      Math.abs(current.dy) >= 90 &&
      Math.abs(current.dy) > Math.abs(current.dx)
    ) {
      onClose();
    } else {
      Animated.spring(offset, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 15,
      }).start();
    }
  }
  return (
    <SafeAreaView style={s.screen} testID="image-viewer">
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
        <IconButton name="arrow-redo" label="Forward image" color="white" onPress={onForward} />
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
        testID="image-viewer-surface"
        style={[s.surface, Platform.OS === 'web' && webGestureStyle]}
        {...(Platform.OS === 'web'
          ? {
              onPointerDown: (raw: unknown) => {
                const event = raw as {
                  isPrimary: boolean;
                  button: number;
                  pageX: number;
                  pageY: number;
                  pointerId: number;
                  currentTarget: HTMLElement;
                  target: HTMLElement;
                };
                // Let Retry and other controls receive their own pointer-up.
                if (event.target.closest('button, [role="button"]')) return;
                if (!event.isPrimary || event.button !== 0) {
                  finish(true);
                  return;
                }
                event.currentTarget.setPointerCapture(event.pointerId);
                start(event.pageX, event.pageY);
              },
              onPointerMove: (raw: unknown) => {
                const event = raw as { pageX: number; pageY: number; isPrimary: boolean };
                if (event.isPrimary) move(event.pageX, event.pageY);
              },
              onPointerUp: () => finish(),
              onPointerCancel: () => finish(true),
              onLostPointerCapture: () => {
                if (drag.current) finish(true);
              },
            }
          : {
              onStartShouldSetResponder: () => true,
              onResponderGrant: (event: GestureResponderEvent) => {
                start(event.nativeEvent.pageX, event.nativeEvent.pageY);
                return true;
              },
              onResponderMove: (event: GestureResponderEvent) => {
                const touches = event.nativeEvent.touches;
                if (touches.length !== 1) {
                  finish(true);
                  return;
                }
                move(touches[0].pageX, touches[0].pageY);
              },
              onResponderRelease: () => finish(),
              onResponderTerminationRequest: () => false,
              onResponderTerminate: () => finish(true),
            })}
      >
        {state.status === 'ready' && !imageFailed ? (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { transform: [{ translateY: offset }] }]}
          >
            <Image
              accessibilityLabel="Full screen image"
              source={{ uri: state.file.uri }}
              resizeMode="contain"
              style={StyleSheet.absoluteFill}
              onError={() => setFailure({ key, visible, failed: true })}
            />
          </Animated.View>
        ) : (
          <View style={s.loading}>
            {state.status === 'loading' || state.status === 'idle' ? (
              visible && <ActivityIndicator color="white" />
            ) : (
              <>
                <Text accessibilityRole="alert" style={s.message}>
                  {state.status === 'error' ? state.error : 'Image unavailable'}
                </Text>
                <Button
                  title="Retry image"
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
