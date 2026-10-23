import { useEffect, useRef, useState, type RefObject } from 'react';
import { Text, View } from 'react-native';
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
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!active || !canPlay()) video.current?.pause();
    else void video.current?.play().catch(() => {});
  }, [active, uri, canPlay]);
  const [failed, setFailed] = useState(false);
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
        aria-label="Video player"
        ref={video}
        src={uri}
        autoPlay={active}
        controls
        playsInline
        preload="auto"
        onPlay={({ currentTarget }) => {
          if (!canPlay()) currentTarget.pause();
        }}
        onLoadStart={() => setFailed(false)}
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
