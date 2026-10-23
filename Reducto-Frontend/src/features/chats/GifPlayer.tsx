import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text } from 'react-native';
import { useEvent } from 'expo';
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../../components/ui';
import { MediaPreview } from './MediaPreview';
import type { MediaSize } from '../../lib/media-preview';
import { ServerThumbnail } from './ServerThumbnail';
import { watchGifPlayback } from '../../lib/gif-playback';

export interface GifPlayerProps {
  uri: string;
  active?: boolean;
  size?: MediaSize;
  thumbnailUrl?: string | null;
  thumbnailCacheKey: string;
  onError?: () => void;
  cached?: boolean;
}

/** The backend converts GIFs to silent MP4s. Keep their playback inline and automatic. */
export function GifPlayer({
  uri,
  active = true,
  size: metadataSize,
  thumbnailUrl,
  thumbnailCacheKey,
  onError,
  cached = false,
}: GifPlayerProps) {
  const [frameUri, setFrameUri] = useState<string>();
  const focused = useIsFocused();
  const player = useVideoPlayer({ uri, contentType: 'progressive' }, (video) => {
    video.muted = true;
    video.loop = true;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const loaded = useEvent(player, 'sourceLoad');
  useEffect(() => {
    if (status === 'error') onError?.();
  }, [status, onError]);
  const { videoTrack } = useEvent(player, 'videoTrackChange', { videoTrack: player.videoTrack });
  const size =
    videoTrack?.size ??
    loaded?.availableVideoTracks[0]?.size ??
    player.availableVideoTracks[0]?.size;

  useEffect(
    () =>
      watchGifPlayback(
        player,
        () => focused && active && AppState.currentState === 'active',
        (update) => {
          const subscription = AppState.addEventListener('change', update);
          return () => subscription.remove();
        },
      ),
    [player, active, focused],
  );

  return (
    <MediaPreview size={metadataSize ?? size} label="Animated GIF">
      <VideoView
        player={player}
        onFirstFrameRender={() => setFrameUri(uri)}
        style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
        nativeControls={false}
        playsInline
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
        contentFit="contain"
        surfaceType="textureView"
      />
      {(!active || frameUri !== uri) && (
        <ServerThumbnail uri={thumbnailUrl} cacheKey={thumbnailCacheKey} label="GIF thumbnail" />
      )}
      {!cached && (status === 'loading' || status === 'idle') && (
        <ActivityIndicator color={colors.blue} />
      )}
      {status === 'error' && <Text style={s.error}>GIF unavailable</Text>}
    </MediaPreview>
  );
}

const s = StyleSheet.create({
  error: { color: colors.muted, backgroundColor: '#E4EBF1', padding: 8 },
});
