import type { AroundMessages, Emoji, Message, MessagePage } from './types';
import { mergeMessages } from '../lib/messages';

/** One account/server session's history, reply targets, and jump windows. */
export class MessageCache {
  private bounds = new Map<string, { hasMoreBefore: boolean; hasMoreAfter: boolean }>();
  private histories = new Map<string, Message[]>();
  private latestMessages = new Map<string, Message | null>();
  private entities = new Map<string, Map<string, Message>>();
  private cursors = new Map<string, string | null>();
  private pending = new Map<string, Promise<unknown>>();
  private windows = new Map<string, { chatId: string; page: AroundMessages }>();
  private generations = new Map<string, number>();
  constructor(
    private readonly get: <T>(path: string) => Promise<T>,
    private readonly publish: (id: string, messages: Message[]) => void,
    private readonly rememberPeople: (messages: Message[]) => void = () => {},
    private readonly publishLatest: (id: string, message: Message | null) => void = () => {},
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
    return this.bounds.get(id)?.hasMoreBefore ?? !!this.cursors.get(id);
  }
  hasNewer(id: string) {
    return this.bounds.get(id)?.hasMoreAfter ?? false;
  }
  isOpen(id: string) {
    return this.bounds.has(id);
  }
  history(id: string) {
    return this.histories.get(id) ?? [];
  }
  latest(id: string) {
    return this.latestMessages.get(id);
  }
  private updateLatest(id: string, message: Message | null) {
    const previous = this.latestMessages.get(id);
    // Delayed snapshots/history windows must not replace a newer live preview.
    if (
      previous &&
      (!message ||
        previous.createdAt > message.createdAt ||
        (previous.createdAt === message.createdAt && previous.id > message.id))
    )
      return;
    this.latestMessages.set(id, message);
    this.publishLatest(id, message);
  }
  async loadLatest(id: string, force = false) {
    if (!force && this.latestMessages.has(id)) return;
    await this.request(id, JSON.stringify(['latest', id]), async () => {
      const generation = this.generations.get(id);
      const page = await this.get<MessagePage>(`/api/conversations/${id}/messages?limit=1`);
      if (this.generations.get(id) !== generation) return;
      const message = page.messages[0] ?? null;
      if (message) this.remember([message]);
      this.updateLatest(id, message);
    });
  }
  accept(message: Message) {
    this.remember([message]);
    this.updateLatest(message.conversationId, message);
    // A live message must not create a hole after an older, contiguous window.
    if (this.hasNewer(message.conversationId)) return;
    const history = mergeMessages(this.histories.get(message.conversationId) ?? [], [message]);
    this.histories.set(message.conversationId, history);
    this.publish(message.conversationId, history);
  }
  async open(id: string, lastSeenMessageId: string | null, force = false) {
    if (
      !force &&
      this.isOpen(id) &&
      (lastSeenMessageId
        ? this.history(id).some((message) => message.id === lastSeenMessageId)
        : !this.hasOlder(id))
    )
      return;
    await this.request(id, JSON.stringify(['open', id, lastSeenMessageId]), async () => {
      const generation = this.generations.get(id);
      let anchor = lastSeenMessageId;
      if (!anchor) {
        const { message } = await this.get<{ message: Message | null }>(
          `/api/conversations/${id}/messages/first`,
        );
        if (this.generations.get(id) !== generation) return;
        if (!message) {
          this.histories.set(id, []);
          this.bounds.set(id, { hasMoreBefore: false, hasMoreAfter: false });
          this.publish(id, []);
          return;
        }
        this.remember([message]);
        anchor = message.id;
      }
      const page = await this.around(id, anchor, 50, 50, force);
      if (this.generations.get(id) !== generation) return;
      const history = mergeMessages([], [...page.before, page.message, ...page.after]);
      this.histories.set(id, history);
      if (!page.hasMoreAfter) this.updateLatest(id, history.at(-1) ?? null);
      this.bounds.set(id, { hasMoreBefore: page.hasMoreBefore, hasMoreAfter: page.hasMoreAfter });
      this.publish(id, history);
    });
  }
  async extend(id: string, older: boolean, force = false) {
    if (!this.isOpen(id) || (!force && !(older ? this.hasOlder(id) : this.hasNewer(id)))) return;
    const edge = older ? this.history(id)[0] : this.history(id).at(-1);
    if (!edge) return;
    await this.request(id, JSON.stringify(['extend', id, edge.id, older]), async () => {
      const generation = this.generations.get(id);
      const page = await this.around(id, edge.id, older ? 50 : 0, older ? 0 : 50, force);
      if (this.generations.get(id) !== generation) return;
      // A reply jump or explicit latest jump may have replaced this window.
      if (!this.history(id).some((message) => message.id === edge.id)) return;
      const history = mergeMessages(this.history(id), [
        ...page.before,
        page.message,
        ...page.after,
      ]);
      const previous = this.bounds.get(id)!;
      this.bounds.set(id, {
        hasMoreBefore: older
          ? page.hasMoreBefore && page.before.length > 0
          : previous.hasMoreBefore,
        hasMoreAfter: older ? previous.hasMoreAfter : page.hasMoreAfter && page.after.length > 0,
      });
      this.histories.set(id, history);
      if (!this.hasNewer(id)) this.updateLatest(id, history.at(-1) ?? null);
      this.publish(id, history);
    });
  }
  async refresh(id: string) {
    if (this.isOpen(id) && !this.hasNewer(id)) {
      if (!this.history(id).length) await this.open(id, null, true);
      else await this.extend(id, false, true);
    }
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
      const history = !older && this.hasNewer(id) ? [] : (this.histories.get(id) ?? []);
      const overlap = page.messages.some((message) =>
        history.some((entry) => entry.id === message.id),
      );
      if (older || !this.cursors.has(id) || (force && !overlap && page.messages.length))
        this.cursors.set(id, page.nextCursor);
      this.remember(page.messages);
      if (!older) this.updateLatest(id, page.messages[0] ?? null);
      const merged = mergeMessages(history, page.messages);
      this.bounds.set(id, { hasMoreBefore: !!this.cursors.get(id), hasMoreAfter: false });
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
  async around(
    id: string,
    messageId: string,
    before = 50,
    after = 50,
    force = false,
  ): Promise<AroundMessages> {
    const key = JSON.stringify(['around', id, messageId, before, after]);
    const cached = this.windows.get(key);
    if (cached && !force) return cached.page;
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
      this.latestMessages.delete(id);
      this.entities.delete(id);
      this.cursors.delete(id);
      this.bounds.delete(id);
    }
    for (const [key, window] of this.windows)
      if (!allowed.has(window.chatId)) this.windows.delete(key);
  }
}
