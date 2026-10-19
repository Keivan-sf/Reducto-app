import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors } from '../../components/ui';
import type { MediaSize } from '../../lib/media-preview';
import { MediaPreview } from './MediaPreview';

/** Size the browser's replaced video element explicitly; intrinsic sizing can overflow. */
export function GifPlayer({ uri, active = true }: { uri: string; active?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [metadata, setMetadata] = useState<{ uri: string; size: MediaSize }>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useFocusEffect(
    useCallback(() => {
      const update = () => {
        const element = video.current;
        if (!element || element.getAttribute('src') !== uri) return;
        if (active && AppState.currentState === 'active') {
          void element.play().catch(() => {
            /* Playback errors are reported by onError. */
          });
        } else element.pause();
      };
      update();
      const subscription = AppState.addEventListener('change', update);
      return () => {
        subscription.remove();
        video.current?.pause();
      };
    }, [active, uri]),
  );

  return (
    <MediaPreview size={metadata?.uri === uri ? metadata.size : undefined} label="Animated GIF">
      <video
        ref={video}
        src={uri}
        muted
        loop
        playsInline
        controls={false}
        disablePictureInPicture
        disableRemotePlayback
        preload="metadata"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
        }}
        onLoadStart={() => setStatus('loading')}
        onLoadedMetadata={({ currentTarget }) =>
          setMetadata({
            uri,
            size: { width: currentTarget.videoWidth, height: currentTarget.videoHeight },
          })
        }
        onLoadedData={() => setStatus('ready')}
        onError={() => setStatus('error')}
      />
      {status === 'loading' && <ActivityIndicator color={colors.blue} />}
      {status === 'error' && <Text style={{ color: colors.muted }}>GIF unavailable</Text>}
    </MediaPreview>
  );
}
