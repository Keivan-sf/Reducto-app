import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { VideoPlaybackProps } from './VideoPlayback.types';
const allowPlayback = () => true;
export function VideoPlayback({
  uri,
  active = true,
  pauseRef,
  canPlay = allowPlayback,
  loop = false,
  muted = false,
  nativeControls = true,
  onSize,
  onError,
}: VideoPlaybackProps) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!active || !canPlay()) video.current?.pause();
    else void video.current?.play().catch(() => {});
  }, [active, uri, canPlay]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (failed) onError?.();
  }, [failed, onError]);
  useEffect(() => {
    if (!loop) return;
    const update = () => {
      if (document.hidden || !active || !canPlay()) video.current?.pause();
      else void video.current?.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [loop, active, canPlay]);
  useEffect(() => {
    if (!pauseRef) return;
    const pause = () => video.current?.pause();
    pauseRef.current = pause;
    return () => {
      if (pauseRef.current === pause) pauseRef.current = null;
    };
  }, [pauseRef]);
  return (
    <View style={{ flex: 1 }}>
      <video
        aria-label={loop ? 'Full screen GIF' : 'Video player'}
        ref={video}
        src={uri}
        autoPlay={active && canPlay()}
        controls={nativeControls}
        loop={loop}
        muted={muted}
        playsInline
        preload="auto"
        onPlay={({ currentTarget }) => {
          if (!canPlay()) currentTarget.pause();
        }}
        onLoadStart={() => setFailed(false)}
        onLoadedMetadata={({ currentTarget }) => {
          onSize?.({ width: currentTarget.videoWidth, height: currentTarget.videoHeight });
        }}
        onError={() => setFailed(true)}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          backgroundColor: 'black',
        }}
      />
      {failed && (
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
