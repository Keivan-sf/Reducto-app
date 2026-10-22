/** Only one voice message plays at a time; cleanup never invokes released players. */
class VoicePlayback {
  private active?: { id: string | number; pause: () => void };
  claim(id: string | number, pause: () => void) {
    if (this.active?.id !== id) this.active?.pause();
    this.active = { id, pause };
  }
  release(id: string | number) {
    if (this.active?.id === id) this.active = undefined;
  }
  pause() {
    const active = this.active;
    this.active = undefined;
    active?.pause();
  }
}
export const voicePlayback = new VoicePlayback();
