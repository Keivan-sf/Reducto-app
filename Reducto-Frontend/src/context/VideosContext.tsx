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
import { ThumbnailCache } from '../api/thumbnail-cache';
import { loadVideoFile } from '../lib/video-download';
import { api } from './SessionContext';
import { useGifs } from './GifsContext';
import { useMediaMetadata } from './MediaMetadataContext';

const Context = createContext<VideoCache>(null!);
const ThumbnailContext = createContext<ThumbnailCache>(null!);
export function VideosProvider({ children }: PropsWithChildren) {
  const gifs = useGifs();
  const mediaMetadata = useMediaMetadata();
  const [cache] = useState(() => {
    const owner = api.getSession()!;
    const headers = () => {
      const session = api.getSession();
      if (!session || session.user.id !== owner.user.id || session.serverUrl !== owner.serverUrl)
        throw new Error('Your session changed. Open the video again.');
      return { Authorization: `Bearer ${session.accessToken}` };
    };
    return new VideoCache(async (key, signal, progress, mimeType) => {
      const gif = /^\/api\/gifs\/([^/]+)\/local$/.exec(key);
      if (gif) {
        // Download signed object-storage URLs without sending our bearer token.
        for (let attempt = 0; ; attempt++) {
          const { gif: metadata } = await gifs.get(decodeURIComponent(gif[1]), attempt > 0);
          try {
            const file = await loadVideoFile({
              url: metadata.playbackUrl,
              mimeType: 'video/mp4',
              headers: {},
              refresh: async () => {
                throw new Error('GIF link expired (401)');
              },
              signal,
              progress,
            });
            try {
              headers();
            } catch (error) {
              file.dispose();
              throw error;
            }
            return file;
          } catch (error) {
            if (attempt || signal.aborted || !/\b(401|403)\b/.test(String(error))) throw error;
          }
        }
      }
      const voice = key.startsWith('voice:');
      const document = /^document:(\/api\/conversations\/([^/]+)\/attachments\/([^/]+))$/.exec(key);
      const metadata = document
        ? (
            await mediaMetadata.get(
              decodeURIComponent(document[2]),
              decodeURIComponent(document[3]),
            )
          ).attachment
        : undefined;
      const path = document ? document[1] : voice ? key.slice('voice:'.length) : key;
      const file = await loadVideoFile({
        url: `${owner.serverUrl}${path}`,
        mimeType: metadata?.contentType ?? (voice ? 'audio/ogg' : mimeType),
        fileName: metadata?.fileName ?? (voice ? 'voice.ogg' : undefined),
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
  const [thumbnails] = useState(
    () =>
      new ThumbnailCache((url, signal) =>
        loadVideoFile({
          url,
          mimeType: 'image/jpeg',
          headers: {},
          signal,
          progress: () => {},
          refresh: async () => ({}),
        }),
      ),
  );
  useEffect(() => () => cache.dispose(), [cache]);
  useEffect(() => () => thumbnails.dispose(), [thumbnails]);
  return (
    <Context.Provider value={cache}>
      <ThumbnailContext.Provider value={thumbnails}>{children}</ThumbnailContext.Provider>
    </Context.Provider>
  );
}
export const useVideos = () => useContext(Context);
export const useThumbnails = () => useContext(ThumbnailContext);
export const videoKey = (conversationId: string, mediaId: string) =>
  `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(mediaId)}`;
export const voiceFileKey = (conversationId: string, mediaId: string) =>
  `voice:${videoKey(conversationId, mediaId)}`;
export const documentFileKey = (conversationId: string, mediaId: string) =>
  `document:${videoKey(conversationId, mediaId)}`;
export const gifFileKey = (gifId: string) => `/api/gifs/${encodeURIComponent(gifId)}/local`;
export function useVideoFile(conversationId: string, mediaId: string, active = true) {
  return useCachedFile(videoKey(conversationId, mediaId), active);
}
export function useCachedFile(key: string, active = true, mimeType?: string) {
  const cache = useVideos();
  const subscribe = useCallback(
    (listener: () => void) => (active ? cache.subscribe(key, listener) : () => {}),
    [active, cache, key],
  );
  const snapshot = useCallback(() => cache.read(key), [cache, key]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const download = useCallback(() => cache.get(key, mimeType), [cache, key, mimeType]);
  const cancel = useCallback(() => cache.cancel(key), [cache, key]);
  return { state, download, cancel };
}
