import { useTheme } from '../../context/ThemeContext';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Text } from 'react-native';

import { MediaPreview } from './MediaPreview';
import { mediaDimensions, type MediaSize } from '../../lib/media-preview';
import { useCachedFile, useVideos, videoKey } from '../../context/VideosContext';
import { useAttachmentMetadata } from '../../context/MediaMetadataContext';
import type { AttachmentMetadata } from '../../api/types';

export function AttachmentImage({
  conversationId,
  mediaId,
  initialMetadata,
}: {
  conversationId: string;
  mediaId: string;
  initialMetadata?: AttachmentMetadata;
}) {
  const { colors } = useTheme();
  const metadata = useAttachmentMetadata(conversationId, mediaId, true, initialMetadata);
  const files = useVideos();
  const key = videoKey(conversationId, mediaId);
  const { state, download } = useCachedFile(key, true, metadata?.contentType ?? 'image/jpeg');
  const cached = state.status === 'ready' ? state.file : undefined;
  const [size, setSize] = useState<MediaSize>();
  useEffect(() => {
    void download().catch(() => {});
  }, [download]);
  useEffect(() => {
    if (!cached) return;
    let disposed = false;
    Image.getSize(
      cached.uri,
      (width, height) => {
        if (!disposed) setSize({ width, height });
      },
      () => {},
    );
    return () => {
      disposed = true;
    };
  }, [cached]);
  return (
    <MediaPreview size={mediaDimensions(metadata) ?? size} label="Image preview">
      {cached ? (
        <Image
          source={{ uri: cached.uri }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          onLoad={({ nativeEvent }) =>
            nativeEvent.source &&
            setSize({
              width: nativeEvent.source.width,
              height: nativeEvent.source.height,
            })
          }
          onError={() => {
            files.forget(key, 'Image unavailable');
          }}
        />
      ) : state.status === 'error' ? (
        <Text style={{ color: colors.muted }}>Image unavailable</Text>
      ) : (
        <ActivityIndicator color={colors.blue} />
      )}
    </MediaPreview>
  );
}
