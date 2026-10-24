import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors } from '../../components/ui';
import type { MediaSize } from '../../lib/media-preview';
import { MediaPreview } from './MediaPreview';
import type { GifPlayerProps } from './GifPlayer';
import { useMediaViewers } from './MediaViewers';
import { ServerThumbnail } from './ServerThumbnail';

/** Size the browser's replaced video element explicitly; intrinsic sizing can overflow. */
export function GifPlayer({
  uri,
  active = true,
  size,
  thumbnailUrl,
  thumbnailCacheKey,
  onError,
  cached = false,
}: GifPlayerProps) {
  const viewers = useMediaViewers();
  const [readyUri, setReadyUri] = useState<string>();
  const video = useRef<HTMLVideoElement>(null);
  const [metadata, setMetadata] = useState<{ uri: string; size: MediaSize }>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useFocusEffect(
    useCallback(() => {
      const update = () => {
        const element = video.current;
        if (!element || element.getAttribute('src') !== uri) return;
        if (active && !viewers.isOpen() && AppState.currentState === 'active') {
          void element.play().catch(() => {
            /* Playback errors are reported by onError. */
          });
        } else element.pause();
      };
      update();
      const subscription = AppState.addEventListener('change', update);
      const stopWatchingViewer = viewers.subscribe(update);
      return () => {
        stopWatchingViewer();
        subscription.remove();
        video.current?.pause();
      };
    }, [active, uri, viewers]),
  );

  return (
    <MediaPreview
      size={size ?? (metadata?.uri === uri ? metadata.size : undefined)}
      label="Animated GIF"
    >
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
          objectFit: 'cover',
          pointerEvents: 'none',
        }}
        onLoadStart={() => setStatus('loading')}
        onLoadedMetadata={({ currentTarget }) =>
          setMetadata({
            uri,
            size: { width: currentTarget.videoWidth, height: currentTarget.videoHeight },
          })
        }
        onLoadedData={() => {
          setReadyUri(uri);
          setStatus('ready');
        }}
        onError={() => {
          setStatus('error');
          onError?.();
        }}
      />
      {(!active || readyUri !== uri) && (
        <ServerThumbnail uri={thumbnailUrl} cacheKey={thumbnailCacheKey} label="GIF thumbnail" />
      )}
      {!cached && status === 'loading' && <ActivityIndicator color={colors.blue} />}
      {status === 'error' && <Text style={{ color: colors.muted }}>GIF unavailable</Text>}
    </MediaPreview>
  );
}
