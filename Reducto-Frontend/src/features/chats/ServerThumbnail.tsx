import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Image, StyleSheet } from 'react-native';
import { useThumbnails } from '../../context/VideosContext';

export function ServerThumbnail({
  uri,
  cacheKey,
  label,
}: {
  uri?: string | null;
  cacheKey: string;
  label: string;
}) {
  const cache = useThumbnails();
  const subscribe = useCallback(
    (listener: () => void) => cache.subscribe(cacheKey, listener),
    [cache, cacheKey],
  );
  const snapshot = useCallback(() => cache.read(cacheKey), [cache, cacheKey]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [failed, setFailed] = useState<string>();
  const [imageFailed, setImageFailed] = useState<string>();
  useEffect(() => {
    if (!uri || failed === uri) return;
    let mounted = true;
    void cache.get(cacheKey, uri).catch(() => {
      if (mounted) setFailed(uri);
    });
    return () => {
      mounted = false;
    };
  }, [cache, cacheKey, uri, failed]);
  const source =
    state.status === 'ready'
      ? state.file.uri
      : failed === uri && imageFailed !== uri
        ? uri
        : undefined;
  if (!source) return null;
  return (
    <Image
      accessibilityLabel={label}
      source={{ uri: source }}
      resizeMode="contain"
      style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
      onError={() => {
        if (state.status === 'ready') {
          setFailed(uri ?? '');
          cache.forget(cacheKey);
        } else if (uri) setImageFailed(uri);
      }}
    />
  );
}
