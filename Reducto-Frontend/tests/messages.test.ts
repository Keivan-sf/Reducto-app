import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversationName, mergeMessages, replySnippet } from '../src/lib/messages';
import type { Conversation, Message } from '../src/api/types';

test('Saved Messages has a fixed title without needing another member profile', () => {
  const saved: Conversation = {
    id: 'saved',
    type: 'saved',
    name: null,
    createdAt: '2026-10-29T00:00:00Z',
  };
  assert.equal(conversationName(saved), 'Saved Messages');
  assert.equal(
    conversationName(saved, { id: 'self', name: 'Ada', username: 'ada', avatarUrl: null }),
    'Saved Messages',
  );
  assert.equal(conversationName({ ...saved, type: 'group', name: 'Friends' }), 'Friends');
  assert.equal(conversationName({ ...saved, type: 'private' }), 'Private chat');
});
function message(id: string, createdAt: string): Message {
  return {
    id,
    createdAt,
    conversationId: 'chat',
    senderId: 'user',
    text: id,
    attachment: null,
    forwardedFrom: null,
    isEdited: false,
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

test('reply snippets stay short, normalize whitespace, and label all attachment types', () => {
  const original = message('a', '2026-10-20T00:00:00Z');
  assert.equal(replySnippet({ ...original, text: 'Hello\n world' }), 'Hello world');
  assert.equal(replySnippet({ ...original, text: '😀'.repeat(21) }), `${'😀'.repeat(20)}…`);
  for (const type of ['image', 'video', 'gif', 'music', 'audio', 'document'] as const) {
    const attachment = type === 'gif' ? { type, gifId: 'gif' } : { type, mediaId: 'media' };
    assert.equal(replySnippet({ ...original, text: 'A caption', attachment }), type);
  }
});
