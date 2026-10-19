import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import { GifCache } from '../api/gif-cache';
import type { Gif } from '../api/types';
import { api } from './SessionContext';

const Context = createContext<GifCache>(null!);
export function GifsProvider({ children }: PropsWithChildren) {
  const [cache] = useState(() => new GifCache((path) => api.get<{ gif: Gif }>(path)));
  return <Context.Provider value={cache}>{children}</Context.Provider>;
}
export const useGifs = () => useContext(Context);
