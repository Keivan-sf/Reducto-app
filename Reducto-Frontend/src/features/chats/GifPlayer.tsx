import { useCallback } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text } from 'react-native';
import { useEvent } from 'expo';
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../../components/ui';
import { MediaPreview } from './MediaPreview';

/** The backend converts GIFs to silent MP4s. Keep their playback inline and automatic. */
export function GifPlayer({ uri, active = true }: { uri: string; active?: boolean }) {
  const player = useVideoPlayer({ uri, contentType: 'progressive' }, (video) => {
    video.muted = true;
    video.loop = true;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const loaded = useEvent(player, 'sourceLoad');
  const { videoTrack } = useEvent(player, 'videoTrackChange', { videoTrack: player.videoTrack });
  const size =
    videoTrack?.size ??
    loaded?.availableVideoTracks[0]?.size ??
    player.availableVideoTracks[0]?.size;

  useFocusEffect(
    useCallback(() => {
      const update = () => {
        if (active && AppState.currentState === 'active') player.play();
        else player.pause();
      };
      update();
      const subscription = AppState.addEventListener('change', update);
      return () => {
        subscription.remove();
        player.pause();
      };
    }, [player, active]),
  );

  return (
    <MediaPreview size={size} label="Animated GIF">
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
        nativeControls={false}
        playsInline
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
        contentFit="contain"
        surfaceType="textureView"
      />
      {(status === 'loading' || status === 'idle') && <ActivityIndicator color={colors.blue} />}
      {status === 'error' && <Text style={s.error}>GIF unavailable</Text>}
    </MediaPreview>
  );
}

const s = StyleSheet.create({
  error: { color: colors.muted, backgroundColor: '#E4EBF1', padding: 8 },
});
