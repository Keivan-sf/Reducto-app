import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReadState } from '../src/api/read-state';
import type { Conversation, Message, SeenState } from '../src/api/types';

const chat: Conversation = {
  id: 'chat',
  type: 'group',
  name: 'Group',
  createdAt: '2026-10-22T00:00:00Z',
  lastSeenMessageId: 'm0',
  unreadCount: 10,
};
const messages: Message[] = Array.from({ length: 11 }, (_, index) => ({
  id: `m${index}`,
  conversationId: chat.id,
  senderId: 'peer',
  text: `${index}`,
  attachment: null,
  forwardedFrom: null,
  createdAt: `2026-10-22T00:00:${String(index).padStart(2, '0')}Z`,
}));
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test('server counts initialize independently of history; reading five messages immediately removes five', async () => {
  let counts: Record<string, number> = {};
  const calls: string[] = [];
  const state = new ReadState(
    async (_id, messageId) => {
      calls.push(messageId);
      return { lastSeenMessageId: messageId, unreadCount: 5 };
    },
    (value) => {
      counts = value;
    },
    0,
  );
  state.sync([chat], state.version());
  assert.equal(counts.chat, 10);
  state.view(chat.id, [messages[5]], messages.slice(0, 6), false, true);
  assert.equal(counts.chat, 5);
  state.view(chat.id, [messages[3]], messages, false, false);
  assert.equal(counts.chat, 5, 'scrolling backward never moves the watermark');
  await tick();
  assert.deepEqual(calls, ['m5']);
  assert.equal(counts.chat, 5);
  state.dispose();
});

test('serialized writes coalesce forward reads and stale list/PUT responses cannot restore old counts', async () => {
  const completions: ((value: SeenState) => void)[] = [];
  const calls: string[] = [];
  let count = 0;
  const state = new ReadState(
    async (_id, messageId) => {
      calls.push(messageId);
      return new Promise((resolve) => completions.push(resolve));
    },
    (value) => {
      count = value.chat;
    },
    0,
  );
  state.sync([chat], state.version());
  const stale = state.version();
  state.view(chat.id, [messages[5]], messages, false, false);
  await tick();
  state.view(chat.id, [messages[7]], messages, false, false);
  assert.equal(count, 3);
  state.sync([chat], stale);
  assert.equal(count, 3);
  completions[0]({ lastSeenMessageId: 'm5', unreadCount: 5 });
  await tick();
  assert.equal(count, 3);
  assert.deepEqual(calls, ['m5', 'm7']);
  completions[1]({ lastSeenMessageId: 'm7', unreadCount: 3 });
  await tick();
  state.sync([chat], stale);
  assert.equal(count, 3);
  state.sync([{ ...chat, lastSeenMessageId: 'm10', unreadCount: 0 }], state.version());
  assert.equal(count, 0, 'a fresh API snapshot recovers another client’s reads');
  state.dispose();
});

test('tail windows and null watermarks count the inclusive prefix; duplicate and own messages are handled', () => {
  let count = 0;
  const state = new ReadState(
    async () => ({ lastSeenMessageId: 'm5', unreadCount: 5 }),
    (value) => {
      count = value.chat;
    },
  );
  state.sync([{ ...chat, lastSeenMessageId: null, unreadCount: 11 }], state.version());
  state.view(chat.id, [messages[4]], messages.slice(0, 5), false, true);
  assert.equal(count, 6);
  state.view(chat.id, [messages[7]], messages.slice(5), true, false);
  assert.equal(count, 3, 'an exact tail count works even when the watermark is outside it');
  const own = { ...messages[10], id: 'own', senderId: 'me', createdAt: '2026-10-22T00:01:00Z' };
  state.created(own);
  state.created(own);
  assert.equal(count, 4);
  state.created({ ...messages[2], id: 'old-event' });
  assert.equal(count, 4);
  state.dispose();
});

test('unknown gaps keep the API baseline until the seen endpoint returns an authoritative count', async () => {
  let count = 0;
  const state = new ReadState(
    async () => ({ lastSeenMessageId: 'm8', unreadCount: 2 }),
    (value) => {
      count = value.chat;
    },
    0,
  );
  state.sync([chat], state.version());
  state.view(chat.id, [messages[8]], messages.slice(7, 9), true, true);
  assert.equal(count, 10);
  await tick();
  assert.equal(count, 2);
  state.dispose();
});

test('failed writes retry without losing the optimistic read position; removed chats cancel pending writes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let count = 0;
  const state = new ReadState(
    async () => {
      if (++calls === 1) throw new Error('offline');
      return { lastSeenMessageId: 'm5', unreadCount: 5 };
    },
    (value) => {
      count = value.chat;
    },
  );
  state.sync([chat], state.version());
  state.view(chat.id, [messages[5]], messages, false, false);
  t.mock.timers.tick(200);
  await Promise.resolve();
  assert.equal(count, 5);
  t.mock.timers.tick(5000);
  await Promise.resolve();
  assert.equal(calls, 2);
  state.view(chat.id, [messages[8]], messages, false, false);
  state.sync([], state.version());
  t.mock.timers.tick(10000);
  assert.equal(calls, 2);
  assert.equal(state.peek(chat.id), undefined);
  state.dispose();
});
