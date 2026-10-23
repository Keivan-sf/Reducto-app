export interface VoiceTrack {
  key: string;
  uri: string;
  senderId: string;
  duration?: number;
}
export interface VoiceStatus {
  playing: boolean;
  currentTime: number;
  duration: number;
  isLoaded: boolean;
  error?: string | null;
  didJustFinish?: boolean;
}
export interface VoiceAudioPlayer {
  currentStatus: VoiceStatus;
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  release(): void;
  addListener(
    event: 'playbackStatusUpdate',
    listener: (status: VoiceStatus) => void,
  ): { remove(): void };
}
export interface VoicePlaybackState extends VoiceStatus {
  track?: VoiceTrack;
}
const EMPTY: VoicePlaybackState = {
  playing: false,
  currentTime: 0,
  duration: 0,
  isLoaded: false,
};

/** Session owns the player and pins its file independently of virtualized bubbles. */
export class VoicePlayback {
  private state = EMPTY;
  private listeners = new Set<() => void>();
  private current?: {
    player: VoiceAudioPlayer;
    unsubscribe: () => void;
    unpin: () => void;
  };
  private revision = 0;
  constructor(
    private create: (uri: string) => VoiceAudioPlayer,
    private prepare: () => Promise<void>,
    private pin: (key: string) => () => void,
  ) {}
  read = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(state: VoicePlaybackState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  select(track: VoiceTrack) {
    if (this.state.track?.key !== track.key || !this.current) {
      this.close();
      const unpin = this.pin(track.key);
      let player: VoiceAudioPlayer | undefined;
      try {
        player = this.create(track.uri);
        this.publish({
          ...EMPTY,
          ...player.currentStatus,
          track,
          duration: player.currentStatus.duration || track.duration || 0,
        });
        const subscription = player.addListener('playbackStatusUpdate', (status) => {
          if (this.current?.player !== player) return;
          this.publish({
            ...this.state,
            ...status,
            duration: status.duration > 0 ? status.duration : (track.duration ?? 0),
            playing: status.didJustFinish ? false : status.playing,
          });
        });
        this.current = { player, unsubscribe: () => subscription.remove(), unpin };
      } catch (error) {
        player?.release();
        unpin();
        this.publish(EMPTY);
        throw error;
      }
    }
  }
  async play(track: VoiceTrack) {
    this.select(track);
    await this.resume();
  }
  async resume() {
    const current = this.current;
    if (!current) return;
    const revision = ++this.revision;
    try {
      await this.prepare();
      if (revision !== this.revision || current !== this.current) return;
      if (
        this.state.didJustFinish ||
        (this.state.duration > 0 && this.state.currentTime >= this.state.duration - 0.05)
      )
        await current.player.seekTo(0);
      if (revision !== this.revision || current !== this.current) return;
      current.player.play();
    } catch {
      if (revision === this.revision && current === this.current)
        this.publish({
          ...this.state,
          playing: false,
          error: 'Could not play this voice message.',
        });
    }
  }
  pause = () => {
    ++this.revision;
    this.current?.player.pause();
    if (this.current) this.publish({ ...this.state, playing: false });
  };
  seek = async (seconds: number) => {
    const current = this.current;
    if (!current) return;
    const position = Math.max(0, Math.min(this.state.duration, seconds));
    await current.player.seekTo(position);
    if (current === this.current)
      this.publish({ ...this.state, currentTime: position, didJustFinish: false });
  };
  close = () => {
    ++this.revision;
    const current = this.current;
    this.current = undefined;
    if (current) {
      current.unsubscribe();
      try {
        current.player.pause();
        current.player.release();
      } finally {
        current.unpin();
      }
    }
    this.publish(EMPTY);
  };
}
