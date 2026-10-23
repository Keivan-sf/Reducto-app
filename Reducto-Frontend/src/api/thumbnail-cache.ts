import { VideoCache, type VideoFile } from './video-cache';

/** Session-scoped thumbnail files keyed by media identity, not expiring signed URLs. */
export class ThumbnailCache {
  private urls = new Map<string, string>();
  private files: VideoCache;

  constructor(private readonly load: (url: string, signal: AbortSignal) => Promise<VideoFile>) {
    this.files = new VideoCache(
      async (key, signal) => {
        const url = this.urls.get(key)!;
        try {
          return await this.load(url, signal);
        } catch (error) {
          const newer = this.urls.get(key);
          if (!signal.aborted && newer && newer !== url) return this.load(newer, signal);
          throw error;
        }
      },
      { files: 256, bytes: 64 * 1024 * 1024 },
    );
  }

  read = (key: string) => this.files.read(key);
  subscribe = (key: string, listener: () => void) => this.files.subscribe(key, listener);

  get(key: string, url: string) {
    this.urls.delete(key);
    this.urls.set(key, url);
    if (this.urls.size > 2048) this.urls.delete(this.urls.keys().next().value!);
    return this.files.get(key, 'image/jpeg');
  }

  forget(key: string) {
    this.files.forget(key, 'Thumbnail unavailable');
  }

  dispose() {
    this.files.dispose();
    this.urls.clear();
  }
}
