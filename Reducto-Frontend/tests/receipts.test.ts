import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceReceipt, seenByAnotherMember } from '../src/api/receipts';
import type { Message } from '../src/api/types';

const message = (id: string, createdAt: string, conversationId = 'chat'): Message => ({
  id,
  createdAt,
  conversationId,
  senderId: 'alice',
  text: id,
  attachment: null,
  forwardedFrom: null,
  isEdited: false,
});

test('a peer seeing a later message marks earlier outgoing messages seen', () => {
  const first = message('first', '2026-01-01T00:00:00.000Z');
  const second = message('second', '2026-01-01T00:00:01.000Z');
  let positions = advanceReceipt({}, 'chat', 'bob', second);
  assert.equal(seenByAnotherMember(first, 'alice', positions), true);
  assert.equal(seenByAnotherMember(second, 'alice', positions), true);
  positions = advanceReceipt(positions, 'chat', 'bob', first);
  assert.equal(positions.chat.bob.id, second.id);
});

test('own reads, other chats, and pending sends do not produce double ticks', () => {
  const sent = message('sent', '2026-01-01T00:00:01.000Z');
  const older = message('older', '2026-01-01T00:00:00.000Z');
  let positions = advanceReceipt({}, 'chat', 'alice', sent);
  positions = advanceReceipt(positions, 'chat', 'bob', older);
  positions = advanceReceipt(
    positions,
    'other',
    'carol',
    message('other', sent.createdAt, 'other'),
  );
  assert.equal(seenByAnotherMember(sent, 'alice', positions), false);
  positions = advanceReceipt(positions, 'chat', 'carol', sent);
  assert.equal(seenByAnotherMember(sent, 'alice', positions), true);
  assert.equal(seenByAnotherMember({ ...sent, delivery: 'sending' }, 'alice', positions), false);
});
