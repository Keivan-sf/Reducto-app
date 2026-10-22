import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Icon } from '../../components/ui';
import { useAttachmentMetadata } from '../../context/MediaMetadataContext';
import { useVideoFile } from '../../context/VideosContext';
import { mediaDimensions, mediaPreviewSize } from '../../lib/media-preview';
import { videoBytes } from '../../lib/video-download.types';
import { saveVideoFile } from '../../lib/video-download';
import { ServerThumbnail } from './ServerThumbnail';

export function VideoCard({
  conversationId,
  mediaId,
  active,
  onPlay,
  onOptions,
  onError,
}: {
  conversationId: string;
  mediaId: string;
  active: boolean;
  onPlay: () => void;
  onOptions: (event: GestureResponderEvent) => void;
  onError: (message: string) => void;
}) {
  const { state, download, cancel } = useVideoFile(conversationId, mediaId, active);
  const metadata = useAttachmentMetadata(conversationId, mediaId, active);
  const progress = state.status === 'loading' ? state.progress : undefined;
  const percent = progress?.total
    ? Math.min(100, Math.floor((progress.received * 100) / progress.total))
    : undefined;
  const sizeText = progress
    ? `${videoBytes(progress.received)}${progress.total ? ` / ${videoBytes(progress.total)}` : ''}`
    : state.status === 'ready'
      ? videoBytes(state.file.bytes)
      : state.status === 'error'
        ? 'Retry download'
        : metadata?.fileSize
          ? videoBytes(metadata.fileSize)
          : 'Download';
  return (
    <View
      testID={`video-card-${mediaId}`}
      style={[s.card, mediaPreviewSize(mediaDimensions(metadata))]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Play video"
        onPress={(event) => {
          event.stopPropagation();
          onPlay();
        }}
        onLongPress={onOptions}
        style={StyleSheet.absoluteFill}
      >
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
        >
          <ServerThumbnail uri={metadata?.thumbnailUrl} label="Video thumbnail" />
          <View style={s.play}>
            <Icon name="play" size={30} color="white" />
          </View>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          progress
            ? 'Cancel video download'
            : state.status === 'ready'
              ? 'Save video'
              : 'Download video'
        }
        onPress={(event) => {
          event.stopPropagation();
          if (progress) cancel();
          else
            void download()
              .then((file) => {
                if (state.status === 'ready') return saveVideoFile(file);
              })
              .catch((err) => onError(err.message));
        }}
        style={s.download}
      >
        {progress ? (
          <View>
            <ActivityIndicator color="white" size="small" />
            <View
              style={{
                position: 'absolute',
                inset: 0,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="stop" size={9} color="white" />
            </View>
          </View>
        ) : (
          <Icon
            name={state.status === 'ready' ? 'checkmark-circle-outline' : 'arrow-down'}
            size={21}
            color="white"
          />
        )}
        <View style={{ gap: 2 }}>
          <Text style={s.info}>
            Video
            {percent !== undefined ? ` · ${percent}%` : ''}
          </Text>
          <Text style={s.size}>{sizeText}</Text>
          {progress?.total ? (
            <View style={s.track}>
              <View style={[s.progress, { width: `${percent ?? 0}%` }]} />
            </View>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Video message options"
        onPress={onOptions}
        style={s.options}
      >
        <Icon name="ellipsis-vertical" color="white" size={23} />
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  card: { maxWidth: '100%', backgroundColor: '#17212B', borderRadius: 10, overflow: 'hidden' },
  play: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#00000080',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
  },
  download: {
    position: 'absolute',
    top: 7,
    left: 7,
    maxWidth: '78%',
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    backgroundColor: '#00000080',
    borderRadius: 13,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  info: { fontSize: 12, color: 'white', fontWeight: '500' },
  size: { color: '#FFFFFFDD', fontSize: 10 },
  options: {
    position: 'absolute',
    right: 4,
    top: 6,
    padding: 4,
    backgroundColor: '#00000030',
    borderRadius: 12,
  },
  track: { height: 2, backgroundColor: '#FFFFFF44', borderRadius: 1 },
  progress: { height: 2, backgroundColor: 'white' },
});
