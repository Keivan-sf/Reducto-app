import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { VideoCache } from '../api/video-cache';
import { loadVideoFile } from '../lib/video-download';
import { api } from './SessionContext';

const Context = createContext<VideoCache>(null!);
export function VideosProvider({ children }: PropsWithChildren) {
  const [cache] = useState(() => {
    const owner = api.getSession()!;
    const headers = () => {
      const session = api.getSession();
      if (!session || session.user.id !== owner.user.id || session.serverUrl !== owner.serverUrl)
        throw new Error('Your session changed. Open the video again.');
      return { Authorization: `Bearer ${session.accessToken}` };
    };
    return new VideoCache(async (key, signal, progress) => {
      const voice = key.startsWith('voice:');
      const path = voice ? key.slice('voice:'.length) : key;
      const file = await loadVideoFile({
        url: `${owner.serverUrl}${path}`,
        mimeType: voice ? 'audio/ogg' : undefined,
        fileName: voice ? 'voice.ogg' : undefined,
        headers: headers(),
        signal,
        progress,
        refresh: async () => {
          headers();
          await api.refresh();
          return headers();
        },
      });
      try {
        headers();
      } catch (error) {
        file.dispose();
        throw error;
      }
      return file;
    });
  });
  useEffect(() => () => cache.dispose(), [cache]);
  return <Context.Provider value={cache}>{children}</Context.Provider>;
}
export const useVideos = () => useContext(Context);
export const videoKey = (conversationId: string, mediaId: string) =>
  `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(mediaId)}`;
export const voiceFileKey = (conversationId: string, mediaId: string) =>
  `voice:${videoKey(conversationId, mediaId)}`;
export const gifFileKey = (gifId: string) => `/api/gifs/${encodeURIComponent(gifId)}/local`;
export function useVideoFile(conversationId: string, mediaId: string, active = true) {
  return useCachedFile(videoKey(conversationId, mediaId), active);
}
export function useCachedFile(key: string, active = true) {
  const cache = useVideos();
  const subscribe = useCallback(
    (listener: () => void) => (active ? cache.subscribe(key, listener) : () => {}),
    [active, cache, key],
  );
  const snapshot = useCallback(() => cache.read(key), [cache, key]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const download = useCallback(() => cache.get(key), [cache, key]);
  const cancel = useCallback(() => cache.cancel(key), [cache, key]);
  return { state, download, cancel };
}
