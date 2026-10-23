import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { AttachmentCache } from '../api/attachment-cache';
import { api } from './SessionContext';
import type { AttachmentMetadata } from '../api/types';

const Context = createContext<AttachmentCache>(null!);
export function MediaMetadataProvider({ children }: PropsWithChildren) {
  const [cache] = useState(() => new AttachmentCache((path) => api.get(path)));
  return <Context.Provider value={cache}>{children}</Context.Provider>;
}
export const useMediaMetadata = () => useContext(Context);
export function useAttachmentMetadata(
  conversationId: string,
  mediaId: string,
  active = true,
  initial?: AttachmentMetadata,
) {
  const cache = useMediaMetadata();
  const [entry, setEntry] = useState(() => cache.peek(conversationId, mediaId));
  useEffect(() => {
    if (!active) return;
    if (initial?.id === mediaId && !cache.peek(conversationId, mediaId))
      cache.remember(conversationId, initial);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      clearTimeout(timer);
      if (AppState.currentState !== 'active') return;
      try {
        const result = await cache.get(conversationId, mediaId);
        if (disposed) return;
        setEntry(result);
        if (Number.isFinite(result.renewAt))
          timer = setTimeout(() => void load(), Math.max(30000, result.renewAt - Date.now()));
      } catch {
        if (!disposed) timer = setTimeout(() => void load(), 30000);
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
  }, [cache, conversationId, mediaId, active, initial]);
  return entry?.conversationId === conversationId && entry.attachment.id === mediaId
    ? entry.attachment
    : (cache.peek(conversationId, mediaId)?.attachment ??
        (initial?.id === mediaId ? initial : undefined));
}
