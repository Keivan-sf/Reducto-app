import type { AttachmentMetadata } from './types';
import { signedMediaRenewAt } from '../lib/signed-media';
export interface CachedAttachment {
  conversationId: string;
  attachment: AttachmentMetadata;
  renewAt: number;
}

/** Metadata is scoped to a signed-in user's conversation access. */
export class AttachmentCache {
  private entries = new Map<string, CachedAttachment>();
  private pending = new Map<string, Promise<CachedAttachment>>();
  constructor(
    private readonly fetchMetadata: (path: string) => Promise<{ attachment: AttachmentMetadata }>,
    private readonly now = Date.now,
  ) {}
  private key(conversationId: string, mediaId: string) {
    return `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(mediaId)}/metadata`;
  }
  peek(conversationId: string, mediaId: string) {
    return this.entries.get(this.key(conversationId, mediaId));
  }
  remember(conversationId: string, attachment: AttachmentMetadata) {
    const key = this.key(conversationId, attachment.id);
    const entry = {
      conversationId,
      attachment,
      renewAt: attachment.thumbnailUrl
        ? signedMediaRenewAt([attachment.thumbnailUrl], this.now())
        : Infinity,
    };
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > 2048) this.entries.delete(this.entries.keys().next().value!);
    return entry;
  }
  async get(conversationId: string, mediaId: string) {
    const key = this.key(conversationId, mediaId);
    const cached = this.entries.get(key);
    if (cached && cached.renewAt > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = this.fetchMetadata(key)
      .then(({ attachment }) => this.remember(conversationId, attachment))
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}
