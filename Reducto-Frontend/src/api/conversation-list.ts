import type { Conversation } from './types';

/** Session-only list additions survive background recovery, but not an explicit refresh. */
export class ConversationList {
  private chats = new Map<string, Conversation>();
  private revisions = new Map<string, number>();
  private revision = 0;
  private temporary = new Set<string>();
  version() {
    return this.revision;
  }
  values() {
    return [...this.chats.values()];
  }
  has(id: string) {
    return this.chats.has(id);
  }
  changedSince(id: string, version: number) {
    return (this.revisions.get(id) ?? 0) > version;
  }
  upsert(chat: Conversation, temporary = false) {
    if (temporary) this.temporary.add(chat.id);
    this.chats.set(chat.id, { ...this.chats.get(chat.id), ...chat });
    this.revisions.set(chat.id, ++this.revision);
  }
  remove(id: string) {
    this.chats.delete(id);
    this.temporary.delete(id);
    this.revisions.set(id, ++this.revision);
  }
  replace(chats: Conversation[], startedAt: number, preserveLocal: boolean) {
    const next = new Map(chats.map((chat) => [chat.id, chat]));
    for (const chat of chats) this.temporary.delete(chat.id);
    for (const [id, revision] of this.revisions) {
      if (revision > startedAt || (preserveLocal && this.temporary.has(id) && !next.has(id))) {
        const local = this.chats.get(id);
        if (local) next.set(id, local);
        else next.delete(id);
      }
    }
    this.chats = next;
    for (const id of this.temporary) if (!next.has(id)) this.temporary.delete(id);
    return this.values();
  }
}
