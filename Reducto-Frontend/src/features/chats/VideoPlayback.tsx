import { useEffect } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

export function VideoPlayback({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri, contentType: 'progressive' }, (video) => {
    video.play();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    let disposed = false;
    const subscription = AppState.addEventListener('change', (state) => {
      if (!disposed && state !== 'active') player.pause();
    });
    // useVideoPlayer releases the native object; never call it from cleanup.
    return () => {
      disposed = true;
      subscription.remove();
    };
  }, [player]);
  return (
    <View style={{ flex: 1 }}>
      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        style={StyleSheet.absoluteFill}
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
      />
      {status === 'loading' && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { justifyContent: 'center' }]}>
          <ActivityIndicator color="white" />
        </View>
      )}
      {status === 'error' && (
        <Text
          accessibilityRole="alert"
          style={{ color: 'white', textAlign: 'center', padding: 24 }}
        >
          This video could not be played.
        </Text>
      )}
    </View>
  );
}
