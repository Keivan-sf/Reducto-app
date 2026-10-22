export interface VideoFile {
  uri: string;
  bytes: number;
  name?: string;
  mimeType?: string;
  exists?: () => boolean;
  dispose: () => void;
}
export interface VideoProgress {
  received: number;
  total: number;
}
export type VideoState =
  | { status: 'idle' }
  | { status: 'loading'; progress: VideoProgress }
  | { status: 'ready'; file: VideoFile }
  | { status: 'error'; error: string };
const IDLE: VideoState = { status: 'idle' };
export type VideoLoader = (
  key: string,
  signal: AbortSignal,
  progress: (value: VideoProgress) => void,
) => Promise<VideoFile>;

/** Session-scoped files shared by playback and locally uploaded attachments. */
export class VideoCache {
  private states = new Map<string, VideoState>();
  private listeners = new Map<string, Set<() => void>>();
  private pending = new Map<string, { controller: AbortController; promise: Promise<VideoFile> }>();
  constructor(private readonly load: VideoLoader) {}
  read = (key: string): VideoState => this.states.get(key) ?? IDLE;
  subscribe = (key: string, listener: () => void) => {
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      this.prune();
    };
  };
  private publish(key: string, state: VideoState) {
    this.states.set(key, state);
    this.listeners.get(key)?.forEach((listener) => listener());
  }
  remember(key: string, file: VideoFile) {
    this.pending.get(key)?.controller.abort();
    this.pending.delete(key);
    const previous = this.read(key);
    if (previous.status === 'ready' && previous.file !== file) previous.file.dispose();
    this.publish(key, { status: 'ready', file });
    this.prune(key);
  }
  forget(key: string) {
    this.pending.get(key)?.controller.abort();
    this.pending.delete(key);
    const state = this.read(key);
    if (state.status === 'ready') state.file.dispose();
    this.publish(key, IDLE);
  }
  get(key: string): Promise<VideoFile> {
    const state = this.read(key);
    if (state.status === 'ready') {
      if (!state.file.exists || state.file.exists()) return Promise.resolve(state.file);
      state.file.dispose();
      this.states.delete(key);
      this.pending.delete(key);
    }
    const pending = this.pending.get(key);
    if (pending) return pending.promise;
    const controller = new AbortController();
    this.publish(key, { status: 'loading', progress: { received: 0, total: 0 } });
    const promise = Promise.resolve()
      .then(() =>
        this.load(key, controller.signal, (progress) => {
          if (!controller.signal.aborted) this.publish(key, { status: 'loading', progress });
        }),
      )
      .then((file) => {
        if (controller.signal.aborted) {
          file.dispose();
          throw new Error('Download cancelled');
        }
        this.publish(key, { status: 'ready', file });
        this.prune(key);
        return file;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          this.publish(key, {
            status: 'error',
            error: error instanceof Error ? error.message : 'Video unavailable',
          });
        throw error;
      })
      .finally(() => {
        if (this.pending.get(key)?.controller === controller) this.pending.delete(key);
      });
    this.pending.set(key, { controller, promise });
    return promise;
  }
  cancel(key: string) {
    this.pending.get(key)?.controller.abort();
    this.pending.delete(key);
    this.publish(key, IDLE);
  }
  private prune(keep?: string) {
    let ready = [...this.states].filter(([, state]) => state.status === 'ready');
    let bytes = ready.reduce(
      (total, [, state]) => total + (state.status === 'ready' ? state.file.bytes : 0),
      0,
    );
    for (const [key, state] of ready) {
      if (ready.length <= 12 && bytes <= 128 * 1024 * 1024) break;
      if (key === keep || this.listeners.get(key)?.size || state.status !== 'ready') continue;
      bytes -= state.file.bytes;
      state.file.dispose();
      this.states.delete(key);
      ready = ready.filter(([entry]) => entry !== key);
    }
  }
  dispose() {
    this.pending.forEach(({ controller }) => controller.abort());
    this.pending.clear();
    this.states.forEach((state) => {
      if (state.status === 'ready') state.file.dispose();
    });
    this.states.clear();
    this.listeners.clear();
  }
}
