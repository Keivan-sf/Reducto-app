import type { Conversation, Message, SeenState } from './types';

export const comparePosition = (a: Message, b: Message) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

interface Entry extends SeenState {
  revision: number;
  known: Map<string, Message>;
  submitted?: Message;
  queued?: Message;
  sending?: Message;
  timer?: ReturnType<typeof setTimeout>;
  controller?: AbortController;
}

/** Account-scoped read watermarks. Viewing or sending messages advances them.
 * Local counts are optimistic; serialized PUTs and list snapshots reconcile them. */
export class ReadState {
  private entries = new Map<string, Entry>();
  private revision = 0;
  private disposed = false;
  constructor(
    private readonly put: (
      id: string,
      messageId: string,
      signal: AbortSignal,
    ) => Promise<SeenState>,
    private readonly publish: (counts: Record<string, number>) => void,
    private readonly delay = 200,
  ) {}
  version() {
    return this.revision;
  }
  peek(id: string): SeenState | undefined {
    const entry = this.entries.get(id);
    return entry && { lastSeenMessageId: entry.lastSeenMessageId, unreadCount: entry.unreadCount };
  }
  private emit() {
    if (!this.disposed)
      this.publish(
        Object.fromEntries([...this.entries].map(([id, entry]) => [id, entry.unreadCount])),
      );
  }
  sync(chats: Conversation[], startedAt: number, prune = true) {
    if (this.disposed) return;
    const allowed = new Set(chats.map(({ id }) => id));
    for (const [id, entry] of this.entries) {
      if (!prune || allowed.has(id)) continue;
      clearTimeout(entry.timer);
      entry.controller?.abort();
      this.entries.delete(id);
    }
    for (const chat of chats) {
      const previous = this.entries.get(chat.id);
      // A list request started before a local read/message cannot undo that work.
      if (previous && (previous.revision > startedAt || previous.sending || previous.queued))
        continue;
      this.entries.set(chat.id, {
        ...previous,
        lastSeenMessageId:
          chat.lastSeenMessageId !== undefined
            ? chat.lastSeenMessageId
            : (previous?.lastSeenMessageId ?? null),
        unreadCount: Math.max(0, chat.unreadCount ?? previous?.unreadCount ?? 0),
        known: previous?.known ?? new Map(),
        revision: this.revision,
      });
    }
    this.emit();
  }
  remember(id: string, messages: Message[]) {
    const entry = this.entries.get(id);
    if (entry) for (const message of messages) entry.known.set(message.id, message);
  }
  created(message: Message) {
    if (this.disposed) return;
    let entry = this.entries.get(message.conversationId);
    if (!entry) {
      entry = {
        lastSeenMessageId: null,
        unreadCount: 0,
        known: new Map(),
        revision: this.revision,
      };
      this.entries.set(message.conversationId, entry);
    }
    if (entry.known.has(message.id)) return;
    entry.known.set(message.id, message);
    const seen = entry.lastSeenMessageId && entry.known.get(entry.lastSeenMessageId);
    if (message.id === entry.lastSeenMessageId || (seen && comparePosition(message, seen) <= 0))
      return;
    entry.unreadCount++;
    entry.revision = ++this.revision;
    this.emit();
  }
  sent(message: Message) {
    if (this.disposed) return;
    const id = message.conversationId;
    let entry = this.entries.get(id);
    if (!entry) {
      entry = {
        lastSeenMessageId: null,
        unreadCount: 0,
        known: new Map(),
        revision: this.revision,
      };
      this.entries.set(id, entry);
    }
    entry.known.set(message.id, message);
    // Sending acknowledges everything through this message, even across an
    // unloaded history gap. Preserve any later messages already received.
    const remaining = [...entry.known.values()].filter(
      (known) => comparePosition(known, message) >= 0,
    );
    this.view(id, [message], remaining, true, false);
  }
  view(
    id: string,
    visible: Message[],
    window: Message[],
    hasMoreBefore: boolean,
    hasMoreAfter: boolean,
  ) {
    const entry = this.entries.get(id);
    if (!entry || this.disposed || !visible.length) return;
    this.remember(id, window);
    const target = [...visible]
      .filter((message) => message.conversationId === id)
      .sort(comparePosition)
      .at(-1);
    if (!target || target.id === entry.lastSeenMessageId) return;
    const previous = entry.lastSeenMessageId && entry.known.get(entry.lastSeenMessageId);
    if (
      (previous && comparePosition(target, previous) <= 0) ||
      (entry.submitted && comparePosition(target, entry.submitted) <= 0)
    )
      return;
    const ordered = [...window].sort(comparePosition);
    const index = ordered.findIndex((message) => message.id === target.id);
    const seenIndex = ordered.findIndex((message) => message.id === entry.lastSeenMessageId);
    if (index >= 0) {
      if (!hasMoreAfter) {
        // The contiguous tail gives the exact number remaining even if the
        // original watermark is outside the loaded history.
        entry.unreadCount = Math.min(entry.unreadCount, ordered.length - index - 1);
      } else if (seenIndex >= 0) {
        entry.unreadCount = Math.max(0, entry.unreadCount - (index - seenIndex));
      } else if (entry.lastSeenMessageId === null && !hasMoreBefore) {
        entry.unreadCount = Math.max(0, entry.unreadCount - index - 1);
      }
    }
    entry.lastSeenMessageId = target.id;
    entry.submitted = target;
    entry.queued = target;
    entry.revision = ++this.revision;
    this.emit();
    this.schedule(id, entry);
  }
  private schedule(id: string, entry: Entry, delay = this.delay) {
    if (entry.sending || entry.timer || this.disposed) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.flush(id, entry);
    }, delay);
  }
  private async flush(id: string, entry: Entry) {
    const target = entry.queued;
    if (!target || this.disposed || this.entries.get(id) !== entry) return;
    entry.queued = undefined;
    entry.sending = target;
    entry.controller = new AbortController();
    const version = entry.revision;
    try {
      const result = await this.put(id, target.id, entry.controller.signal);
      if (this.disposed || this.entries.get(id) !== entry) return;
      if (
        !Number.isInteger(result.unreadCount) ||
        result.unreadCount < 0 ||
        !('lastSeenMessageId' in result)
      )
        throw new Error('Invalid read position response');
      if (!entry.queued && entry.revision === version) {
        entry.lastSeenMessageId = result.lastSeenMessageId;
        entry.unreadCount = result.unreadCount;
        entry.revision = ++this.revision;
        this.emit();
      }
    } catch {
      if (!this.disposed && this.entries.get(id) === entry && !entry.queued) entry.queued = target;
    } finally {
      entry.sending = undefined;
      entry.controller = undefined;
      if (entry.queued && !this.disposed && this.entries.get(id) === entry)
        this.schedule(id, entry, entry.queued === target ? 5000 : this.delay);
    }
  }
  remove(id: string) {
    const entry = this.entries.get(id);
    clearTimeout(entry?.timer);
    entry?.controller?.abort();
    this.entries.delete(id);
    this.emit();
  }
  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
      entry.controller?.abort();
    }
    this.entries.clear();
  }
}
