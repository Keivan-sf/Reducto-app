import type { RecordedVoice, RecordingPhase, RecordingSession } from './voice-recording.types';
interface Callbacks {
  begin: (signal: AbortSignal) => Promise<RecordingSession>;
  send: (voice: RecordedVoice, signal: AbortSignal) => Promise<void>;
  changed: (phase: RecordingPhase) => void;
  error: (message: string) => void;
}
/** Own a held or locked recording through preparation and asynchronous upload. */
export class HoldRecorder {
  private phase: RecordingPhase = 'idle';
  private current?: { controller: AbortController; session?: RecordingSession };
  private mounted = true;
  constructor(private callbacks: Callbacks) {}
  update(callbacks: Callbacks) {
    this.callbacks = callbacks;
    this.mounted = true;
  }
  private change(phase: RecordingPhase) {
    this.phase = phase;
    if (this.mounted) this.callbacks.changed(phase);
  }
  async press() {
    if (this.phase !== 'idle' || !this.mounted) return;
    const current = { controller: new AbortController() } as NonNullable<HoldRecorder['current']>;
    this.current = current;
    this.change('preparing');
    try {
      const session = await this.callbacks.begin(current.controller.signal);
      if (current.controller.signal.aborted || this.current !== current || !this.mounted) {
        session.cancel();
        if (this.current === current) {
          this.current = undefined;
          this.change('idle');
        }
        return;
      }
      current.session = session;
      this.change('recording');
    } catch (error) {
      if (!current.controller.signal.aborted && this.mounted)
        this.callbacks.error(error instanceof Error ? error.message : 'Could not start recording.');
      if (this.current === current) {
        this.current = undefined;
        this.change('idle');
      }
    }
  }
  release() {
    if (this.phase === 'locked') return;
    this.send();
  }
  lock() {
    if (this.phase === 'recording') this.change('locked');
  }
  send() {
    const current = this.current;
    if (!current) return;
    if (this.phase === 'preparing') {
      this.cancel();
      return;
    }
    if ((this.phase !== 'recording' && this.phase !== 'locked') || !current.session) return;
    this.change('stopping');
    void this.finish(current);
  }
  private async finish(current: NonNullable<HoldRecorder['current']>) {
    let voice: RecordedVoice | undefined;
    try {
      voice = await current.session!.stop();
      if (current.controller.signal.aborted || !this.mounted) return;
      if (voice.duration < 0.25) return;
      this.change('sending');
      await this.callbacks.send(voice, current.controller.signal);
    } catch (error) {
      if (!current.controller.signal.aborted && this.mounted)
        this.callbacks.error(
          error instanceof Error ? error.message : 'Could not send voice message.',
        );
    } finally {
      voice?.dispose();
      if (this.current === current) {
        this.current = undefined;
        this.change('idle');
      }
    }
  }
  cancel() {
    const current = this.current;
    if (!current) return;
    // Release the UI immediately, even if permission/preparation or stop is
    // still pending. Late results belong to this aborted hold and are discarded.
    this.current = undefined;
    current.controller.abort();
    try {
      current.session?.cancel();
    } catch (error) {
      if (this.mounted)
        this.callbacks.error(
          error instanceof Error ? error.message : 'Could not cancel recording.',
        );
    } finally {
      this.change('idle');
    }
  }
  dispose() {
    // Notify the parent before suppressing callbacks so a disappearing mic
    // button can never leave its composer locked in recording mode.
    this.cancel();
    this.mounted = false;
  }
}
