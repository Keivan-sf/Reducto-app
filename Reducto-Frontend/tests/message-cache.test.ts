import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageCache } from '../src/api/message-cache';
import type { Message, MessagePage, AroundMessages } from '../src/api/types';

const message = (id: string): Message => ({
  id,
  conversationId: 'chat',
  senderId: 'friend',
  text: id,
  attachment: null,
  forwardedFrom: null,
  createdAt: `2026-10-20T00:00:0${id.length}Z`,
});
function create(fetch: (path: string) => Promise<unknown>) {
  const published: Record<string, Message[]> = {};
  const cache = new MessageCache(
    <T>(path: string) => fetch(path) as Promise<T>,
    (id, messages) => {
      published[id] = messages;
    },
  );
  return { cache, published };
}

test('opening chats reuses complete cached history, including empty chats and concurrent loads', async () => {
  let calls = 0;
  const { cache, published } = create(async () => {
    calls++;
    return { messages: [message('a')], nextCursor: null };
  });
  await Promise.all([cache.page('chat'), cache.page('chat')]);
  await cache.page('chat');
  assert.equal(calls, 1);
  assert.equal(published.chat.length, 1);
  assert.equal((await cache.message('chat', 'a')).id, 'a');
  assert.equal(calls, 1);
  let emptyCalls = 0;
  const empty = create(async () => {
    emptyCalls++;
    return { messages: [], nextCursor: null };
  }).cache;
  await empty.page('empty');
  await empty.page('empty');
  assert.equal(emptyCalls, 1);
});

test('reconnect refresh merges realtime messages and preserves an overlapping older cursor', async () => {
  const paths: string[] = [];
  const { cache, published } = create(async (path) => {
    paths.push(path);
    return path.includes('before=')
      ? { messages: [message('old')], nextCursor: 'older' }
      : { messages: [message('a')], nextCursor: 'a' };
  });
  await cache.page('chat');
  await cache.page('chat', true);
  cache.accept(message('live'));
  await cache.page('chat', false, true);
  await cache.page('chat', true);
  assert.match(paths.at(-1)!, /before=older/);
  assert.equal(new Set(published.chat.map((entry) => entry.id)).size, published.chat.length);
  assert.ok(published.chat.some((entry) => entry.id === 'live'));
});

test('reply target and around requests share their cache without inserting gaps into latest history', async () => {
  let singles = 0;
  let windows = 0;
  const target = message('old');
  const { cache, published } = create(async (path) => {
    if (path.includes('/around')) {
      windows++;
      return {
        message: target,
        before: [message('older')],
        after: [],
        hasMoreBefore: true,
        hasMoreAfter: true,
      } satisfies AroundMessages;
    }
    if (path.endsWith('/old')) {
      singles++;
      return { message: target };
    }
    return { messages: [message('latest')], nextCursor: 'latest' } satisfies MessagePage;
  });
  await cache.page('chat');
  await Promise.all([cache.message('chat', 'old'), cache.message('chat', 'old')]);
  await cache.message('chat', 'old');
  await Promise.all([cache.around('chat', 'old'), cache.around('chat', 'old')]);
  await cache.around('chat', 'old');
  assert.equal(singles, 1);
  assert.equal(windows, 1);
  assert.deepEqual(
    published.chat.map((entry) => entry.id),
    ['latest'],
  );
  assert.equal((await cache.message('chat', 'older')).id, 'older');
  cache.reaction({
    conversationId: 'chat',
    messageId: 'old',
    userId: 'user',
    emoji: '👍',
    removed: false,
  });
  assert.equal(cache.peek('chat', 'old')?.reactions?.length, 1);
  assert.deepEqual(
    published.chat.map((entry) => entry.id),
    ['latest'],
  );
});

test('removed chats reject pending responses and never restore inaccessible cached messages', async () => {
  let complete!: (page: MessagePage) => void;
  const { cache, published } = create(
    () =>
      new Promise<MessagePage>((resolve) => {
        complete = resolve;
      }),
  );
  const pending = cache.page('chat');
  cache.prune(new Set());
  complete({ messages: [message('a')], nextCursor: null });
  await assert.rejects(pending, /no longer available/);
  assert.equal(published.chat, undefined);
  assert.equal(cache.peek('chat', 'a'), undefined);
});

test('failed history loads are retryable and account caches remain independent', async () => {
  let calls = 0;
  const { cache } = create(async () => {
    if (++calls === 1) throw new Error('Offline');
    return { messages: [message('a')], nextCursor: null };
  });
  await assert.rejects(cache.page('chat'));
  await cache.page('chat');
  assert.equal(calls, 2);
  const other = create(async () => {
    throw new Error('Unauthorized');
  }).cache;
  await assert.rejects(other.message('chat', 'a'), /Unauthorized/);
});
