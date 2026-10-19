import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Text } from 'react-native';
import { useGifs } from '../../context/GifsContext';
import { colors } from '../../components/ui';
import { GifPlayer } from './GifPlayer';
import { MediaPreview } from './MediaPreview';

export function GifPreview({ gifId, active = true }: { gifId: string; active?: boolean }) {
  const cache = useGifs();
  const [source, setSource] = useState<{ id: string; uri: string }>();
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
        setSource({ id: gifId, uri: gif.playbackUrl });
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

  return source?.id === gifId ? (
    <GifPlayer uri={source.uri} active={active} />
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
