import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Image, Text } from 'react-native';
import { useCachedFile, useVideos, gifFileKey } from '../../context/VideosContext';
import { useGifs } from '../../context/GifsContext';
import { colors } from '../../components/ui';
import { GifPlayer } from './GifPlayer';
import { ServerThumbnail } from './ServerThumbnail';
import { MediaPreview } from './MediaPreview';
import { mediaDimensions } from '../../lib/media-preview';

export function GifPreview({ gifId, active = true }: { gifId: string; active?: boolean }) {
  const cache = useGifs();
  const files = useVideos();
  const { state: localState } = useCachedFile(gifFileKey(gifId), active);
  const local = localState.status === 'ready' ? localState.file : undefined;
  useEffect(() => {
    if (local?.exists && !local.exists()) files.forget(gifFileKey(gifId));
  }, [local, files, gifId]);
  const [source, setSource] = useState(() => cache.peek(gifId)?.gif);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      clearTimeout(timer);
      if (AppState.currentState !== 'active') return;
      try {
        const { gif, renewAt } = await cache.get(gifId);
        if (disposed) return;
        setSource(gif);
        setFailed(false);
        clearTimeout(timer);
        timer = setTimeout(() => void load(), Math.max(30000, renewAt - Date.now()));
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
  }, [cache, gifId, active]);

  const metadata = source?.id === gifId ? source : undefined;
  if (local?.mimeType === 'image/gif')
    return (
      <MediaPreview size={mediaDimensions(metadata)} label="Animated GIF">
        {active ? (
          <Image
            accessibilityLabel="Uploaded GIF"
            source={{ uri: local.uri }}
            resizeMode="contain"
            style={{ width: '100%', height: '100%' }}
            onError={() => files.forget(gifFileKey(gifId))}
          />
        ) : (
          <ServerThumbnail uri={metadata?.thumbnailUrl} label="GIF thumbnail" />
        )}
      </MediaPreview>
    );
  return source?.id === gifId ? (
    <GifPlayer
      uri={local?.uri ?? source.playbackUrl}
      active={active}
      size={mediaDimensions(source)}
      thumbnailUrl={source.thumbnailUrl}
      onError={local ? () => files.forget(gifFileKey(gifId)) : undefined}
    />
  ) : (
    <MediaPreview label="GIF preview">
      {failed ? (
        <Text style={{ color: colors.muted }}>GIF unavailable</Text>
      ) : (
        <ActivityIndicator color={colors.blue} />
      )}
    </MediaPreview>
  );
}
