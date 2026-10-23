/** Own viewer transitions without publishing close-time changes to the chat tree. */
export class MediaViewerSession<T> {
  private snapshot: { content: T | null; visible: boolean } = { content: null, visible: false };
  private listeners = new Set<() => void>();
  private dismiss?: (complete: () => void) => void;
  private revision = 0;
  private closing = false;

  constructor(private readonly onDismiss: (content: T) => void) {}

  read = () => this.snapshot;
  isOpen = () => this.snapshot.visible;
  canPlay = () => this.snapshot.visible && !this.closing;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.listeners.forEach((listener) => listener());
  }

  attachDismiss = (dismiss: (complete: () => void) => void) => {
    this.dismiss = dismiss;
    return () => {
      if (this.dismiss === dismiss) this.dismiss = undefined;
    };
  };

  open = (content: T) => {
    this.revision++;
    this.closing = false;
    this.snapshot = { content, visible: true };
    this.publish();
  };

  close = (after?: () => void) => {
    if (!this.snapshot.visible || this.closing) return;
    this.closing = true;
    const revision = ++this.revision;
    const content = this.snapshot.content!;
    const complete = () => {
      if (revision !== this.revision || !this.closing) return;
      this.closing = false;
      // Retain the content: closing doesn't detach the image or unload/recreate the player.
      this.snapshot = { content, visible: false };
      this.publish();
      this.onDismiss(content);
      after?.();
    };
    // The native opacity animation starts before React updates, chat callbacks or file cleanup.
    if (this.dismiss) this.dismiss(complete);
    else complete();
  };
}
