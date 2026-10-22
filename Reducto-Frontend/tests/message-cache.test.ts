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

test('opening uses one 50-before/50-after seen window and cached edges extend contiguously in either direction', async () => {
  const all = Array.from({ length: 301 }, (_, index) => ({
    ...message(String(index)),
    createdAt: new Date(Date.UTC(2026, 9, 22, 0, 0, index)).toISOString(),
  }));
  const paths: string[] = [];
  const { cache, published } = create(async (path) => {
    paths.push(path);
    assert.match(path, /\/around\?/);
    const url = new URL(path, 'http://server');
    const index = all.findIndex((message) => message.id === url.pathname.split('/').at(-2));
    const before = Number(url.searchParams.get('before'));
    const after = Number(url.searchParams.get('after'));
    return {
      message: all[index],
      before: all.slice(Math.max(0, index - before), index),
      after: all.slice(index + 1, index + after + 1),
      hasMoreBefore: index > before,
      hasMoreAfter: all.length - index - 1 > after,
    };
  });
  await Promise.all([cache.open('chat', '100'), cache.open('chat', '100')]);
  assert.equal(paths.length, 1);
  assert.match(paths[0], /100\/around\?before=50&after=50$/);
  assert.equal(published.chat[0].id, '50');
  assert.equal(published.chat.at(-1)!.id, '150');
  assert.equal(cache.hasOlder('chat'), true);
  assert.equal(cache.hasNewer('chat'), true);
  cache.accept(all[300]);
  assert.equal(
    published.chat.at(-1)!.id,
    '150',
    'live delivery cannot insert a gap into the reading window',
  );
  await Promise.all([cache.extend('chat', false), cache.extend('chat', false)]);
  assert.equal(paths.length, 2);
  assert.equal(published.chat.at(-1)!.id, '200');
  await cache.extend('chat', true);
  assert.equal(published.chat[0].id, '0');
  assert.equal(cache.hasOlder('chat'), false);
  await cache.open('chat', '125');
  assert.equal(paths.length, 3, 'reopening a loaded read position reuses the grown window');
  await cache.extend('chat', false);
  await cache.extend('chat', false);
  assert.equal(cache.hasNewer('chat'), false);
  assert.equal(published.chat.length, 301);
  assert.equal(new Set(published.chat.map(({ id }) => id)).size, 301);
});

test('unseen chats resolve the first message once and load a cached window at the beginning', async () => {
  const first = message('first');
  const next = message('second');
  const paths: string[] = [];
  const { cache, published } = create(async (path) => {
    paths.push(path);
    if (path.endsWith('/messages/first')) return { message: first };
    assert.match(path, /first\/around\?before=50&after=50$/);
    return {
      message: first,
      before: [],
      after: [next],
      hasMoreBefore: false,
      hasMoreAfter: true,
    };
  });
  await Promise.all([cache.open('chat', null), cache.open('chat', null)]);
  assert.equal(paths.length, 2);
  assert.deepEqual(
    published.chat.map(({ id }) => id),
    ['first', 'second'],
  );
  assert.equal(cache.hasOlder('chat'), false);
  assert.equal(cache.hasNewer('chat'), true);
  assert.deepEqual(cache.peek('chat', 'first'), first);
  await cache.open('chat', null);
  assert.equal(paths.length, 2, 'reopening an unseen chat reuses the first window');
});

test('empty first-message responses are cached without around or latest-page requests', async () => {
  const paths: string[] = [];
  const { cache, published } = create(async (path) => {
    paths.push(path);
    assert.ok(path.endsWith('/messages/first'));
    return { message: null };
  });
  await Promise.all([cache.open('chat', null), cache.open('chat', null)]);
  await cache.open('chat', null);
  assert.equal(paths.length, 1);
  assert.deepEqual(published.chat, []);
  assert.equal(cache.hasOlder('chat'), false);
  assert.equal(cache.hasNewer('chat'), false);
});

test('refreshing an opened empty chat starts at the first message received while offline', async () => {
  let firstCalls = 0;
  const first = message('new');
  const { cache, published } = create(async (path) => {
    if (path.endsWith('/messages/first')) return { message: ++firstCalls === 1 ? null : first };
    assert.match(path, /new\/around\?before=50&after=50$/);
    return { message: first, before: [], after: [], hasMoreBefore: false, hasMoreAfter: false };
  });
  await cache.open('chat', null);
  await cache.refresh('chat');
  assert.equal(published.chat[0].id, 'new');
  assert.equal(firstCalls, 2);
});

test('a failed first lookup retries and removed conversations cannot restore the first window', async () => {
  let calls = 0;
  let resolve!: (value: { message: Message | null }) => void;
  const { cache, published } = create(async () => {
    if (++calls === 1) throw new Error('Offline');
    return new Promise<{ message: Message | null }>((done) => {
      resolve = done;
    });
  });
  await assert.rejects(cache.open('chat', null), /Offline/);
  const pending = cache.open('chat', null);
  cache.prune(new Set());
  resolve({ message: message('first') });
  await assert.rejects(pending, /no longer available/);
  assert.equal(calls, 2);
  assert.equal(published.chat, undefined);
  assert.equal(cache.isOpen('chat'), false);
});

test('latest previews load one message independently of the anchored history and reuse the cache', async () => {
  const paths: string[] = [];
  const latest = { ...message('latest'), createdAt: '2026-10-22T12:00:00Z' };
  const { cache, published } = create(async (path) => {
    paths.push(path);
    if (path.endsWith('?limit=1')) return { messages: [latest], nextCursor: 'older' };
    return {
      message: message('seen'),
      before: [],
      after: [],
      hasMoreBefore: true,
      hasMoreAfter: true,
    };
  });
  await Promise.all([cache.loadLatest('chat'), cache.loadLatest('chat')]);
  assert.equal(paths.length, 1);
  assert.equal(cache.latest('chat')?.id, 'latest');
  assert.equal(cache.isOpen('chat'), false);
  assert.equal(Object.hasOwn(published, 'chat'), false);
  await cache.open('chat', 'seen');
  assert.equal(published.chat.at(-1)?.id, 'seen');
  assert.equal(cache.latest('chat')?.id, 'latest');
  await cache.loadLatest('chat');
  assert.equal(paths.length, 2);
  const live = { ...latest, id: 'live', createdAt: '2026-10-22T13:00:00Z' };
  cache.accept(live);
  assert.equal(cache.latest('chat')?.id, 'live');
  assert.equal(published.chat.at(-1)?.id, 'seen', 'a live preview cannot create a history gap');
  await cache.loadLatest('chat', true);
  assert.equal(cache.latest('chat')?.id, 'live', 'older refreshes cannot roll back live previews');
  cache.prune(new Set());
  assert.equal(cache.latest('chat'), undefined);
});

test('empty previews are cached, and pending preview snapshots cannot erase live messages', async () => {
  let calls = 0;
  let resolve!: (page: MessagePage) => void;
  const { cache, published } = create(async () => {
    if (++calls === 1) return { messages: [], nextCursor: null };
    return new Promise<MessagePage>((done) => {
      resolve = done;
    });
  });
  await cache.loadLatest('chat');
  await cache.loadLatest('chat');
  assert.equal(calls, 1);
  assert.equal(cache.latest('chat'), null);
  assert.equal(Object.hasOwn(published, 'chat'), false);
  const pending = cache.loadLatest('chat', true);
  cache.accept(message('live'));
  resolve({ messages: [], nextCursor: null });
  await pending;
  assert.equal(cache.latest('chat')?.id, 'live');
});
