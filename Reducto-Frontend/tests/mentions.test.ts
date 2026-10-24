import assert from 'node:assert/strict';
import test from 'node:test';
import { oldestMention } from '../src/api/mentions';
import type { Mention, Message } from '../src/api/types';

test('mentions use message chronology, deduplicate IDs, and skip seen entries', async () => {
  const mentions: Mention[] = ['a-new', 'z-old', 'z-old', 'seen'].map((messageId) => ({
    userId: 'user',
    conversationId: 'chat',
    messageId,
    seen: messageId === 'seen',
  }));
  const calls: string[] = [];
  assert.equal(
    await oldestMention(mentions, async (id) => {
      calls.push(id);
      return { id, createdAt: id === 'z-old' ? '2026-10-01' : '2026-10-02' } as Message;
    }),
    'z-old',
  );
  assert.deepEqual(calls, ['a-new', 'z-old']);
  assert.equal(
    await oldestMention([], async () => {
      throw new Error('unexpected lookup');
    }),
    undefined,
  );
});

test('mention chronology breaks timestamp ties by message ID and retains lookup failures', async () => {
  const mentions = ['b', 'a'].map((messageId) => ({
    userId: 'user',
    conversationId: 'chat',
    messageId,
    seen: false,
  }));
  assert.equal(
    await oldestMention(mentions, async (id) => ({ id, createdAt: '2026-10-01' }) as Message),
    'a',
  );
  await assert.rejects(
    oldestMention(mentions, async () => {
      throw new Error('offline');
    }),
    /offline/,
  );
  assert.equal(mentions.length, 2);
});
