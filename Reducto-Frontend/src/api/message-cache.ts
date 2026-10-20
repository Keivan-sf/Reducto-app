import type { AroundMessages, Emoji, Message, MessagePage } from './types';
import { mergeMessages } from '../lib/messages';

/** One account/server session's history, reply targets, and jump windows. */
export class MessageCache {
  private histories = new Map<string, Message[]>();
  private entities = new Map<string, Map<string, Message>>();
  private cursors = new Map<string, string | null>();
  private pending = new Map<string, Promise<unknown>>();
  private windows = new Map<string, { chatId: string; page: AroundMessages }>();
  private generations = new Map<string, number>();
  constructor(
    private readonly get: <T>(path: string) => Promise<T>,
    private readonly publish: (id: string, messages: Message[]) => void,
    private readonly rememberPeople: (messages: Message[]) => void = () => {},
  ) {}
  private async request<T>(id: string, key: string, action: () => Promise<T>): Promise<T> {
    if (!this.generations.has(id)) this.generations.set(id, 0);
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;
    const generation = this.generations.get(id);
    const task = action()
      .then((value) => {
        if (this.generations.get(id) !== generation)
          throw new Error('This conversation is no longer available.');
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  private remember(messages: Message[]) {
    for (const message of messages) {
      let entities = this.entities.get(message.conversationId);
      if (!entities) this.entities.set(message.conversationId, (entities = new Map()));
      entities.set(message.id, { ...entities.get(message.id), ...message });
    }
    this.rememberPeople(messages);
  }
  peek(id: string, messageId: string) {
    return this.entities.get(id)?.get(messageId);
  }
  hasOlder(id: string) {
    return !!this.cursors.get(id);
  }
  accept(message: Message) {
    this.remember([message]);
    const history = mergeMessages(this.histories.get(message.conversationId) ?? [], [message]);
    this.histories.set(message.conversationId, history);
    this.publish(message.conversationId, history);
  }
  async page(id: string, older = false, force = false): Promise<void> {
    if (!older && !force && this.cursors.has(id)) return;
    const cursor = older ? this.cursors.get(id) : undefined;
    if (older && !cursor) return;
    const key = JSON.stringify(['page', id, cursor]);
    // Include merging in the shared flight so every caller sees a fully cached page.
    await this.request(id, key, async () => {
      const generation = this.generations.get(id);
      const page = await this.get<MessagePage>(
        `/api/conversations/${id}/messages?limit=50${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`,
      );
      if (this.generations.get(id) !== generation) return;
      const history = this.histories.get(id) ?? [];
      const overlap = page.messages.some((message) =>
        history.some((entry) => entry.id === message.id),
      );
      if (older || !this.cursors.has(id) || (force && !overlap && page.messages.length))
        this.cursors.set(id, page.nextCursor);
      this.remember(page.messages);
      const merged = mergeMessages(history, page.messages);
      this.histories.set(id, merged);
      this.publish(id, merged);
    });
  }
  async message(id: string, messageId: string): Promise<Message> {
    const cached = this.peek(id, messageId);
    if (cached) return cached;
    const result = await this.request(id, JSON.stringify(['message', id, messageId]), () =>
      this.get<{ message: Message }>(
        `/api/conversations/${id}/messages/${encodeURIComponent(messageId)}`,
      ),
    );
    this.remember([result.message]);
    return result.message;
  }
  async around(id: string, messageId: string, before = 50, after = 50): Promise<AroundMessages> {
    const key = JSON.stringify(['around', id, messageId, before, after]);
    const cached = this.windows.get(key);
    if (cached) return cached.page;
    const page = await this.request(id, key, () =>
      this.get<AroundMessages>(
        `/api/conversations/${id}/messages/${encodeURIComponent(messageId)}/around?before=${before}&after=${after}`,
      ),
    );
    this.remember([...page.before, page.message, ...page.after]);
    this.windows.set(key, { chatId: id, page });
    return page;
  }
  reaction(event: {
    conversationId: string;
    messageId: string;
    userId: string;
    emoji: Emoji;
    removed: boolean;
  }) {
    const message = this.peek(event.conversationId, event.messageId);
    if (!message) return;
    const reactions = (message.reactions ?? []).filter(
      (reaction) => !(reaction.userId === event.userId && reaction.emoji === event.emoji),
    );
    if (!event.removed)
      reactions.push({ userId: event.userId, emoji: event.emoji, messageId: event.messageId });
    this.remember([{ ...message, reactions }]);
    const history = (this.histories.get(event.conversationId) ?? []).map((entry) =>
      this.peek(event.conversationId, entry.id)!,
    );
    this.histories.set(event.conversationId, history);
    this.publish(event.conversationId, history);
  }
  prune(allowed: Set<string>) {
    for (const id of this.generations.keys()) {
      if (allowed.has(id)) continue;
      this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
      this.histories.delete(id);
      this.entities.delete(id);
      this.cursors.delete(id);
    }
    for (const [key, window] of this.windows)
      if (!allowed.has(window.chatId)) this.windows.delete(key);
  }
}
