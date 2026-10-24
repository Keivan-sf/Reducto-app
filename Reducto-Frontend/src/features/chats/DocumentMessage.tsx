import { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import type { AttachmentMetadata } from '../../api/types';
import { colors } from '../../components/ui';
import { useAttachmentMetadata } from '../../context/MediaMetadataContext';
import { documentFileKey, useCachedFile } from '../../context/VideosContext';
import { openLocalFile } from '../../lib/local-attachments';
import { videoBytes } from '../../lib/video-download.types';
import { AttachmentControlIcon } from './AttachmentControlIcon';
import { DownloadProgressRing } from './DownloadProgressRing';

export function DocumentMessage({
  conversationId,
  mediaId,
  initialMetadata,
  active,
  onOptions,
  onError,
}: {
  conversationId: string;
  mediaId: string;
  initialMetadata?: AttachmentMetadata;
  active: boolean;
  onOptions: (event: GestureResponderEvent) => void;
  onError: (message: string) => void;
}) {
  const metadata = useAttachmentMetadata(conversationId, mediaId, active, initialMetadata);
  const { state, download, cancel } = useCachedFile(
    documentFileKey(conversationId, mediaId),
    active,
  );
  const [previousStatus, setPreviousStatus] = useState(state.status);
  const [completing, setCompleting] = useState(false);
  if (previousStatus !== state.status) {
    setPreviousStatus(state.status);
    setCompleting(previousStatus === 'loading' && state.status === 'ready');
  }
  useEffect(() => {
    if (!completing) return;
    const timer = setTimeout(() => setCompleting(false), 520);
    return () => clearTimeout(timer);
  }, [completing]);
  const loading = state.status === 'loading';
  const ready = state.status === 'ready' && !completing;
  const total = loading ? state.progress.total || metadata?.fileSize || 0 : 0;
  const progress = completing
    ? 1
    : loading && total
      ? Math.min(1, state.progress.received / total)
      : 0;
  const name =
    metadata?.fileName ?? (state.status === 'ready' ? state.file.name : undefined) ?? 'Document';
  const size = metadata?.fileSize ?? (state.status === 'ready' ? state.file.bytes : undefined);
  return (
    <View style={s.row} testID={`document-message-${mediaId}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          completing
            ? 'Document download complete'
            : loading
              ? 'Cancel document download'
              : ready
                ? `${Platform.OS === 'web' ? 'Save' : 'Open'} document`
                : 'Download document'
        }
        disabled={completing}
        onLongPress={onOptions}
        onPress={(event) => {
          event.stopPropagation();
          if (loading) cancel();
          else
            void (
              ready
                ? download().then((file) =>
                    openLocalFile({
                      ...file,
                      name: metadata?.fileName ?? file.name,
                      mimeType: metadata?.contentType ?? file.mimeType,
                    }),
                  )
                : download()
            ).catch((error) => {
              if (error.name !== 'AbortError') onError(error.message);
            });
        }}
        style={s.button}
      >
        {(loading || completing) && <DownloadProgressRing progress={progress} />}
        <AttachmentControlIcon
          name={loading || completing ? 'close' : ready ? 'document' : 'arrow-down'}
        />
      </Pressable>
      <View style={s.details}>
        <Text numberOfLines={1} style={s.name}>
          {name}
        </Text>
        <Text style={s.size}>
          {state.status === 'error'
            ? 'Tap to retry'
            : loading
              ? `${videoBytes(state.progress.received)}${total ? ` / ${videoBytes(total)}` : ''}`
              : size !== undefined
                ? videoBytes(size)
                : 'Document'}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    width: 280,
    maxWidth: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  button: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.blue,
    justifyContent: 'center',
    alignItems: 'center',
  },
  details: { flex: 1, minWidth: 0, gap: 5 },
  name: { fontSize: 14, fontWeight: '500', color: colors.dark },
  size: { fontSize: 12, lineHeight: 14, color: '#6C93AF' },
});
