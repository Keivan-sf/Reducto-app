import { useEffect, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

const allowPlayback = () => true;
export function VideoPlayback({
  uri,
  active = true,
  pauseRef,
  canPlay = allowPlayback,
}: {
  uri?: string;
  active?: boolean;
  pauseRef?: RefObject<(() => void) | null>;
  canPlay?: () => boolean;
}) {
  const player = useVideoPlayer(null);
  const pending = useRef(Promise.resolve());
  const playing = useRef(false);
  const loadedUri = useRef<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadedUri.current = undefined;
    player.pause();
    pending.current = pending.current
      .catch(() => {})
      .then(async () => {
        if (cancelled) return;
        setFailed(false);
        await player.replaceAsync(uri ? { uri, contentType: 'progressive' } : null);
        if (cancelled) return;
        loadedUri.current = uri;
        if (playing.current && canPlay() && uri && AppState.currentState === 'active')
          player.play();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [player, uri, canPlay]);
  useEffect(() => {
    playing.current = active;
    if (!active || !canPlay()) player.pause();
    else if (uri && loadedUri.current === uri && AppState.currentState === 'active') {
      player.replay();
    }
    return () => {
      playing.current = false;
    };
  }, [active, player, uri, canPlay]);
  useEffect(() => {
    if (!pauseRef) return;
    const pause = () => {
      playing.current = false;
      player.pause();
    };
    pauseRef.current = pause;
    return () => {
      if (pauseRef.current === pause) pauseRef.current = null;
    };
  }, [player, pauseRef]);
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
        surfaceType="textureView"
        nativeControls
        contentFit="contain"
        style={StyleSheet.absoluteFill}
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
      />
      {active && status === 'loading' && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { justifyContent: 'center' }]}>
          <ActivityIndicator color="white" />
        </View>
      )}
      {active && (failed || status === 'error') && (
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
