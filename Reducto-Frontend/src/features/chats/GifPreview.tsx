import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Image, Text } from 'react-native';
import { useCachedFile, useVideos, gifFileKey } from '../../context/VideosContext';
import { useGifs } from '../../context/GifsContext';
import { colors } from '../../components/ui';
import { GifPlayer } from './GifPlayer';
import { ServerThumbnail } from './ServerThumbnail';
import { MediaPreview } from './MediaPreview';
import { mediaDimensions } from '../../lib/media-preview';
import type { Gif } from '../../api/types';

export function GifPreview({
  gifId,
  active = true,
  initialMetadata,
}: {
  gifId: string;
  active?: boolean;
  initialMetadata?: Gif;
}) {
  const cache = useGifs();
  const files = useVideos();
  const { state: localState, download } = useCachedFile(gifFileKey(gifId), active);
  const local = localState.status === 'ready' ? localState.file : undefined;
  useEffect(() => {
    if (local?.exists && !local.exists()) files.forget(gifFileKey(gifId));
  }, [local, files, gifId]);
  const [source, setSource] = useState(() => initialMetadata ?? cache.peek(gifId)?.gif);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (initialMetadata?.id === gifId && !cache.peek(gifId)) cache.remember(initialMetadata);
  }, [cache, gifId, initialMetadata]);
  useEffect(() => {
    if (active) void download().catch(() => {});
  }, [active, download]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      clearTimeout(timer);
      if (AppState.currentState !== 'active') return;
      try {
        const { gif, renewAt } = (local && cache.peek(gifId)) || (await cache.get(gifId));
        if (disposed) return;
        setSource(gif);
        setFailed(false);
        clearTimeout(timer);
        if (!local) timer = setTimeout(() => void load(), Math.max(30000, renewAt - Date.now()));
      } catch {
        if (disposed) return;
        setFailed(true);
        clearTimeout(timer);
        timer = setTimeout(() => void load(), 30000);
      }
    };
    void load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [cache, gifId, active, local]);

  const metadata =
    source?.id === gifId ? source : initialMetadata?.id === gifId ? initialMetadata : undefined;
  if (local?.mimeType === 'image/gif')
    return (
      <MediaPreview size={mediaDimensions(metadata)} label="Animated GIF">
        {active ? (
          <Image
            accessibilityLabel="Uploaded GIF"
            source={{ uri: local.uri }}
            resizeMode="contain"
            style={{ width: '100%', height: '100%' }}
            onError={() => files.forget(gifFileKey(gifId), 'GIF unavailable')}
          />
        ) : (
          <ServerThumbnail
            uri={metadata?.thumbnailUrl}
            cacheKey={`gif:${gifId}`}
            label="GIF thumbnail"
          />
        )}
      </MediaPreview>
    );
  return local ? (
    <GifPlayer
      uri={local.uri}
      active={active}
      size={mediaDimensions(metadata)}
      thumbnailUrl={metadata?.thumbnailUrl}
      thumbnailCacheKey={`gif:${gifId}`}
      cached
      onError={() => files.forget(gifFileKey(gifId), 'GIF unavailable')}
    />
  ) : (
    <MediaPreview size={mediaDimensions(metadata)} label="GIF preview">
      <ServerThumbnail
        uri={metadata?.thumbnailUrl}
        cacheKey={`gif:${gifId}`}
        label="GIF thumbnail"
      />
      {failed || localState.status === 'error' ? (
        <Text style={{ color: colors.muted }}>GIF unavailable</Text>
      ) : (
        <ActivityIndicator color={colors.blue} />
      )}
    </MediaPreview>
  );
}
