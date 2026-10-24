import { useEffect, type RefObject } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, IconButton } from '../../components/ui';
import { useVideoFile } from '../../context/VideosContext';
import { videoBytes } from '../../lib/video-download.types';
import { VideoPlayback } from './VideoPlayback';

export function VideoViewer({
  visible = true,
  pauseRef,
  canPlay,
  onCancelDownload,
  conversationId,
  mediaId,
  title,
  onClose,
}: {
  visible?: boolean;
  canPlay?: () => boolean;
  onCancelDownload?: (cancel: () => void) => void;
  pauseRef?: RefObject<(() => void) | null>;
  conversationId: string;
  mediaId: string;
  title: string;
  onClose: () => void;
}) {
  const { state, download, cancel } = useVideoFile(conversationId, mediaId, visible);
  useEffect(() => {
    if (visible) void download().catch(() => {});
  }, [download, visible]);
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [onClose, visible]);
  return (
    <SafeAreaView style={s.screen} testID="video-viewer">
      <View style={s.header}>
        <IconButton
          name="arrow-back"
          label="Back to conversation"
          color="white"
          onPress={onClose}
        />
        <Text numberOfLines={1} style={s.title}>
          {title}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <VideoPlayback
          zoomable
          uri={state.status === 'ready' ? state.file.uri : undefined}
          pauseRef={pauseRef}
          canPlay={canPlay}
          active={visible && state.status === 'ready'}
        />
        {state.status !== 'ready' && (
          <View style={s.loading}>
            {state.status === 'loading' || state.status === 'idle' ? (
              <>
                {visible && <ActivityIndicator color="white" />}
                <Text style={s.message}>Downloading video</Text>
                <Text style={s.message}>
                  {videoBytes(state.status === 'loading' ? state.progress.received : 0)}
                  {state.status === 'loading' && state.progress.total
                    ? ` / ${videoBytes(state.progress.total)} · ${Math.floor((state.progress.received * 100) / state.progress.total)}%`
                    : ''}
                </Text>
                <Button
                  title="Cancel download"
                  secondary
                  onPress={() => {
                    if (onCancelDownload) onCancelDownload(cancel);
                    else {
                      cancel();
                      onClose();
                    }
                  }}
                />
              </>
            ) : (
              <>
                <Text accessibilityRole="alert" style={s.message}>
                  {state.status === 'error' ? state.error : 'Video download cancelled'}
                </Text>
                <Button
                  title="Retry video"
                  secondary
                  onPress={() => void download().catch(() => {})}
                />
              </>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'black' },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 8,
  },
  title: { color: 'white', fontSize: 16, flex: 1, fontWeight: '600' },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  message: { color: 'white', fontSize: 14, textAlign: 'center' },
});
