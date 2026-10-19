import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeMessages } from '../src/lib/messages';
import type { Message } from '../src/api/types';
function message(id: string, createdAt: string): Message {
  return {
    id,
    createdAt,
    conversationId: 'chat',
    senderId: 'user',
    text: id,
    attachment: null,
    forwardedFrom: null,
  };
}

test('history, realtime delivery, and HTTP send responses merge without duplicates', () => {
  const oldest = message('a', '2026-01-01T00:00:00Z');
  const newest = message('b', '2026-01-02T00:00:00Z');
  const updated = {
    ...newest,
    reactions: [{ messageId: 'b', userId: 'other', emoji: '👍' as const }],
  };
  const result = mergeMessages([newest], [updated, oldest, updated]);
  assert.deepEqual(
    result.map((entry) => entry.id),
    ['a', 'b'],
  );
  assert.equal(result[1].reactions?.length, 1);
  assert.equal(mergeMessages(result, [{ ...newest }])[1].reactions?.length, 1);
});
