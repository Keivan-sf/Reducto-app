import { useEffect } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Button, IconButton } from '../../components/ui';
import { useVideoFile } from '../../context/VideosContext';
import { videoBytes } from '../../lib/video-download.types';
import { VideoPlayback } from './VideoPlayback';

export function VideoViewer({
  conversationId,
  mediaId,
  title,
  onClose,
}: {
  conversationId: string;
  mediaId: string;
  title: string;
  onClose: () => void;
}) {
  const { state, download, cancel } = useVideoFile(conversationId, mediaId);
  useEffect(() => {
    void download().catch(() => {});
  }, [download]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [onClose]);
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={s.screen} testID="video-viewer">
        <StatusBar style="light" />
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
        {state.status === 'ready' ? (
          <VideoPlayback uri={state.file.uri} />
        ) : (
          <View style={s.loading}>
            {state.status === 'loading' ? (
              <>
                <ActivityIndicator color="white" />
                <Text style={s.message}>Downloading video</Text>
                <Text style={s.message}>
                  {videoBytes(state.progress.received)}
                  {state.progress.total
                    ? ` / ${videoBytes(state.progress.total)} · ${Math.floor((state.progress.received * 100) / state.progress.total)}%`
                    : ''}
                </Text>
                <Button
                  title="Cancel download"
                  secondary
                  onPress={() => {
                    cancel();
                    onClose();
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
      </SafeAreaView>
    </Modal>
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
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  message: { color: 'white', fontSize: 14, textAlign: 'center' },
});
