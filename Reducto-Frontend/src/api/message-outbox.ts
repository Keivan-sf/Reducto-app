import type { Attachment, Message } from './types';

export interface OutgoingPayload {
  text?: string;
  attachment?: Attachment;
  replyToMessageId?: string;
}
interface Entry {
  localId: string;
  message: Message;
  payload: OutgoingPayload;
  confirmed: boolean;
  visible: boolean;
  inflight: boolean;
  controller: AbortController;
}

/** Session-owned optimistic sends survive conversation navigation. */
export class MessageOutbox {
  private entries = new Map<string, Entry>();
  private observed = new Set<string>();
  private sequence = 0;
  private timestamp = 0;
  private disposed = false;
  private prefix = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  constructor(
    private readonly userId: string,
    private readonly post: (
      id: string,
      payload: OutgoingPayload,
      signal: AbortSignal,
    ) => Promise<Message>,
    private readonly accept: (message: Message) => void,
    private readonly publish: (messages: Record<string, Message[]>) => void,
  ) {}
  private emit() {
    if (this.disposed) return;
    const result: Record<string, Message[]> = {};
    for (const entry of this.entries.values()) {
      if (!entry.visible) continue;
      (result[entry.message.conversationId] ??= []).push(entry.message);
    }
    this.publish(result);
  }
  enqueue(id: string, payload: OutgoingPayload) {
    if (this.disposed) throw new Error('Your session changed.');
    const localId = `${this.prefix}-${++this.sequence}`;
    this.timestamp = Math.max(Date.now(), this.timestamp + 1);
    const entry: Entry = {
      localId,
      payload: { ...payload },
      message: {
        id: localId,
        localId,
        conversationId: id,
        senderId: this.userId,
        text: payload.text ?? null,
        attachment: payload.attachment ?? null,
        replyToMessageId: payload.replyToMessageId ?? null,
        forwardedFrom: null,
        isEdited: false,
        createdAt: new Date(this.timestamp).toISOString(),
        delivery: 'sending',
      },
      confirmed: false,
      visible: true,
      inflight: false,
      controller: new AbortController(),
    };
    this.entries.set(localId, entry);
    this.emit();
    void this.send(entry);
    return localId;
  }
  private async send(entry: Entry) {
    entry.inflight = true;
    const timeout = setTimeout(() => entry.controller.abort(), 20000);
    try {
      const message = await this.post(
        entry.message.conversationId,
        entry.payload,
        entry.controller.signal,
      );
      if (this.disposed || this.entries.get(entry.localId) !== entry) return;
      entry.confirmed = true;
      entry.message = message;
      this.observed.add(message.id);
      this.accept(message);
    } catch (error) {
      if (this.disposed || this.entries.get(entry.localId) !== entry) return;
      // A realtime creation event is confirmation even if its HTTP response is lost.
      if (!entry.confirmed)
        entry.message = {
          ...entry.message,
          delivery: 'failed',
          sendError: error instanceof Error ? error.message : 'Could not send message.',
        };
    } finally {
      clearTimeout(timeout);
      entry.inflight = false;
      if (!entry.visible && entry.confirmed) this.entries.delete(entry.localId);
      this.emit();
    }
  }
  observe(message: Message) {
    if (this.disposed || message.senderId !== this.userId || this.observed.has(message.id)) return;
    this.observed.add(message.id);
    // The backend has no client nonce. Pair identical echoes in send order;
    // each eventual HTTP response supplies the authoritative server ID.
    const entry = [...this.entries.values()].find(
      (entry) =>
        !entry.confirmed &&
        entry.message.conversationId === message.conversationId &&
        (entry.payload.text ?? null) === message.text &&
        (entry.payload.replyToMessageId ?? null) === (message.replyToMessageId ?? null) &&
        sameAttachment(entry.payload.attachment, message.attachment) &&
        !message.forwardedFrom,
    );
    if (!entry) return;
    entry.confirmed = true;
    entry.message = message;
    this.emit();
  }
  reconcile(histories: Record<string, Message[]>) {
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (
        entry.confirmed &&
        histories[entry.message.conversationId]?.some((message) => message.id === entry.message.id)
      ) {
        if (entry.visible) changed = true;
        entry.visible = false;
        if (!entry.inflight) this.entries.delete(id);
      }
    }
    if (changed) this.emit();
  }
  retry(id: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.inflight || entry.message.delivery !== 'failed' || this.disposed) return;
    entry.controller = new AbortController();
    entry.message = { ...entry.message, delivery: 'sending', sendError: undefined };
    this.emit();
    void this.send(entry);
  }
  discard(id: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.inflight || entry.message.delivery !== 'failed') return;
    this.entries.delete(id);
    this.emit();
  }
  prune(allowed: Set<string>) {
    for (const [id, entry] of this.entries)
      if (!allowed.has(entry.message.conversationId)) {
        this.entries.delete(id);
        entry.controller.abort();
      }
    this.emit();
  }
  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
    this.observed.clear();
  }
}

function sameAttachment(left: Attachment | undefined, right: Attachment | null) {
  if (!left || !right) return !left && !right;
  if (left.type === 'gif') return right.type === 'gif' && left.gifId === right.gifId;
  return right.type !== 'gif' && left.type === right.type && left.mediaId === right.mediaId;
}
