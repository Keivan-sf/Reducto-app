/** Keep the newest bubble above the composer across asynchronous native layout
 * and anchor restoration. Manual history scrolling always takes precedence. */
export class ChatTailFollow {
  private following = false;
  private enabled = true;
  private pending: number | undefined;
  private version = 0;
  constructor(
    private scroll: () => void = () => {},
    private readonly frame: (action: () => void) => number = (action) =>
      requestAnimationFrame(action),
    private readonly cancelFrame: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {}
  setScroll(scroll: () => void) {
    this.scroll = scroll;
  }
  start() {
    this.following = true;
    // Respond to the tap immediately, before React renders or a frame is queued.
    // The later passes only correct native anchoring and new content layout.
    if (this.enabled) this.scroll();
    this.layout();
  }
  stop() {
    this.following = false;
    this.cancel();
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.cancel();
    if (enabled) this.layout();
  }
  private cancel() {
    this.version++;
    if (this.pending !== undefined) this.cancelFrame(this.pending);
    this.pending = undefined;
  }
  layout() {
    this.cancel();
    if (!this.following || !this.enabled) return;
    const version = this.version;
    let passes = 0;
    const settle = () => {
      this.pending = undefined;
      if (!this.following || !this.enabled || this.version !== version) return;
      this.scroll();
      // Android can restore maintainVisibleContentPosition after the first
      // command. Repeat on the following frame once native layout has settled.
      if (++passes < 2) this.pending = this.frame(settle);
    };
    this.pending = this.frame(settle);
  }
}
