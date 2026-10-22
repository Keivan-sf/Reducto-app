import type { Gif } from './types';

import { signedMediaRenewAt } from '../lib/signed-media';
export interface CachedGif {
  gif: Gif;
  renewAt: number;
}

/** Session-local metadata cache. Signed URLs are renewed before they expire. */
export class GifCache {
  private entries = new Map<string, CachedGif>();
  private pending = new Map<string, Promise<CachedGif>>();
  constructor(
    private readonly fetchGif: (path: string) => Promise<{ gif: Gif }>,
    private readonly now = Date.now,
  ) {}

  remember(gif: Gif): CachedGif {
    const renewAt = signedMediaRenewAt([gif.playbackUrl, gif.thumbnailUrl], this.now());
    const entry = { gif, renewAt };
    this.entries.delete(gif.id);
    this.entries.set(gif.id, entry);
    if (this.entries.size > 2048) this.entries.delete(this.entries.keys().next().value!);
    return entry;
  }

  peek(id: string) {
    return this.entries.get(id);
  }

  async get(id: string, force = false): Promise<CachedGif> {
    const cached = this.entries.get(id);
    if (!force && cached && cached.renewAt > this.now()) {
      this.entries.delete(id);
      this.entries.set(id, cached);
      return cached;
    }
    const pending = this.pending.get(id);
    if (pending) return pending;
    const request = this.fetchGif(`/api/gifs/${encodeURIComponent(id)}`)
      .then(({ gif }) => this.remember(gif))
      .finally(() => this.pending.delete(id));
    this.pending.set(id, request);
    return request;
  }
}
