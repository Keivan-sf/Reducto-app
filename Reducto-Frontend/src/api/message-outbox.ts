import type { Attachment, Message, PendingUpload } from './types';

export interface OutgoingPayload {
  text?: string;
  attachment?: Attachment;
  replyToMessageId?: string;
}
export interface UploadJob {
  initial: PendingUpload;
  prepare: (
    signal: AbortSignal,
    progress: (update: Partial<PendingUpload>) => void,
  ) => Promise<Attachment>;
  dispose: () => void;
}
interface Entry {
  upload?: UploadJob;
  progress?: PendingUpload;
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
  private uploadListeners = new Map<string, Set<() => void>>();
  private entries = new Map<string, Entry>();
  private observed = new Set<string>();
  private confirmedKeys = new Map<string, string>();
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
  /** Keep mounted media alive when a temporary message receives its server ID. */
  messageKey(message: Message) {
    return this.confirmedKeys.get(message.id) ?? message.localId ?? message.id;
  }
  /** Progress has its own subscription so bytes sent never rerender chat history. */
  getUpload(id: string) {
    return this.entries.get(id)?.progress;
  }
  subscribeUpload(id: string, listener: () => void) {
    const listeners = this.uploadListeners.get(id) ?? new Set();
    listeners.add(listener);
    this.uploadListeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.uploadListeners.delete(id);
    };
  }
  private emit() {
    if (this.disposed) return;
    const result: Record<string, Message[]> = {};
    for (const entry of this.entries.values()) {
      if (!entry.visible) continue;
      (result[entry.message.conversationId] ??= []).push(entry.message);
    }
    this.publish(result);
  }
  enqueue(id: string, payload: OutgoingPayload, upload?: UploadJob) {
    if (this.disposed) throw new Error('Your session changed.');
    const localId = `${this.prefix}-${++this.sequence}`;
    this.timestamp = Math.max(Date.now(), this.timestamp + 1);
    const entry: Entry = {
      localId,
      upload,
      progress: upload?.initial,
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
        upload: upload?.initial,
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
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (entry.upload && !entry.payload.attachment) {
        const attachment = await entry.upload.prepare(entry.controller.signal, (update) => {
          if (
            this.disposed ||
            this.entries.get(entry.localId) !== entry ||
            entry.controller.signal.aborted
          )
            return;
          entry.progress = { ...entry.progress!, ...update };
          for (const listener of this.uploadListeners.get(entry.localId) ?? []) listener();
        });
        if (
          this.disposed ||
          this.entries.get(entry.localId) !== entry ||
          entry.controller.signal.aborted
        )
          return;
        entry.payload = { ...entry.payload, attachment };
        entry.message = { ...entry.message, attachment };
      }
      timeout = setTimeout(() => entry.controller.abort(), 20000);
      const message = await this.post(
        entry.message.conversationId,
        entry.payload,
        entry.controller.signal,
      );
      if (this.disposed || this.entries.get(entry.localId) !== entry) return;
      entry.confirmed = true;
      this.confirmedKeys.set(message.id, entry.localId);
      entry.message = message;
      entry.upload?.dispose();
      entry.upload = undefined;
      entry.progress = undefined;
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
        (!entry.upload || !!entry.payload.attachment) &&
        entry.message.conversationId === message.conversationId &&
        (entry.payload.text ?? null) === message.text &&
        (entry.payload.replyToMessageId ?? null) === (message.replyToMessageId ?? null) &&
        sameAttachment(entry.payload.attachment, message.attachment) &&
        !message.forwardedFrom,
    );
    if (!entry) return;
    entry.confirmed = true;
    this.confirmedKeys.set(message.id, entry.localId);
    entry.message = message;
    entry.upload?.dispose();
    entry.upload = undefined;
    entry.progress = undefined;
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
    entry.upload?.dispose();
    this.emit();
  }
  cancel(id: string) {
    const entry = this.entries.get(id);
    if (!entry?.upload || entry.confirmed) return;
    this.entries.delete(id);
    entry.controller.abort();
    entry.upload.dispose();
    this.emit();
  }
  prune(allowed: Set<string>) {
    for (const [id, entry] of this.entries)
      if (!allowed.has(entry.message.conversationId)) {
        this.entries.delete(id);
        entry.controller.abort();
        entry.upload?.dispose();
      }
    this.emit();
  }
  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.controller.abort();
      entry.upload?.dispose();
    }
    this.entries.clear();
    this.uploadListeners.clear();
    this.observed.clear();
    this.confirmedKeys.clear();
  }
}

function sameAttachment(left: Attachment | undefined, right: Attachment | null) {
  if (!left || !right) return !left && !right;
  if (left.type === 'gif') return right.type === 'gif' && left.gifId === right.gifId;
  return right.type !== 'gif' && left.type === right.type && left.mediaId === right.mediaId;
}
