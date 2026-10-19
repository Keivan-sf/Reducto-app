import type { Gif } from './types';

const MAX_AGE = 10 * 60 * 1000;
const RENEW_EARLY = 60 * 1000;
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
    let renewAt = this.now() + MAX_AGE;
    try {
      const params = new URL(gif.playbackUrl).searchParams;
      const date = params.get('X-Amz-Date');
      const seconds = Number(params.get('X-Amz-Expires'));
      if (date && /^\d{8}T\d{6}Z$/.test(date) && seconds > 0) {
        const start = Date.parse(
          `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`,
        );
        renewAt = Math.min(renewAt, start + seconds * 1000 - RENEW_EARLY);
      }
    } catch {
      /* Non-S3 URLs use the conservative default lifetime. */
    }
    const entry = { gif, renewAt };
    this.entries.delete(gif.id);
    this.entries.set(gif.id, entry);
    if (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value!);
    return entry;
  }

  async get(id: string): Promise<CachedGif> {
    const cached = this.entries.get(id);
    if (cached && cached.renewAt > this.now()) return cached;
    const pending = this.pending.get(id);
    if (pending) return pending;
    const request = this.fetchGif(`/api/gifs/${encodeURIComponent(id)}`)
      .then(({ gif }) => this.remember(gif))
      .finally(() => this.pending.delete(id));
    this.pending.set(id, request);
    return request;
  }
}
