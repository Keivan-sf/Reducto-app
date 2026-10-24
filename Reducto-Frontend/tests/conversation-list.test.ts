import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationList } from '../src/api/conversation-list';
import type { Conversation } from '../src/api/types';
const chat: Conversation = { id: 'chat', type: 'private', name: null, createdAt: '2026-10-24' };

test('empty private chats survive background recovery, disappear on explicit refresh, and become permanent after a message', () => {
  const list = new ConversationList();
  list.upsert(chat, true);
  assert.deepEqual(list.replace([], list.version(), true), [chat]);
  assert.deepEqual(list.replace([], list.version(), false), []);
  list.upsert(chat, true);
  assert.deepEqual(list.replace([chat], list.version(), false), [chat]);
  assert.deepEqual(list.replace([], list.version(), true), []);
});

test('an in-flight snapshot cannot erase a newly opened chat or undo a deletion or rename', () => {
  const list = new ConversationList();
  const startedAt = list.version();
  list.upsert(chat, true);
  assert.deepEqual(list.replace([], startedAt, false), [chat]);
  const beforeRename = list.version();
  list.upsert({ ...chat, name: 'New name' });
  assert.equal(list.replace([chat], beforeRename, false)[0].name, 'New name');
  const beforeDelete = list.version();
  list.remove(chat.id);
  assert.deepEqual(list.replace([chat], beforeDelete, true), []);
  assert.equal(list.changedSince(chat.id, beforeDelete), true);
});
