import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationSearch, searchSnippet } from '../src/api/conversation-search';
import type { Message, MessagePage } from '../src/api/types';

const message = (id: string) => ({ id, text: `Message ${id}` }) as Message;

test('search uses the conversation endpoint, encodes literal queries, and pages with the same scope', async () => {
  const calls: URL[] = [];
  const search = new ConversationSearch(
    {
      get: async <T>(path: string) => {
        calls.push(new URL(path, 'http://localhost'));
        return (
          calls.length === 1
            ? { messages: [message('new')], nextCursor: 'new' }
            : { messages: [message('new'), message('old')], nextCursor: null }
        ) as T;
      },
    },
    'conversation',
  );
  await search.search('  سلام & https://example.com?q=1  ');
  const first = calls[0];
  assert.equal(first.pathname, '/api/conversations/conversation/messages/search');
  assert.equal(first.searchParams.get('q'), 'سلام & https://example.com?q=1');
  assert.equal(first.searchParams.get('limit'), '50');
  assert.equal(first.searchParams.get('before'), null);
  await search.load();
  assert.equal(calls[1].searchParams.get('before'), 'new');
  assert.equal(calls[1].searchParams.get('q'), first.searchParams.get('q'));
  assert.deepEqual(
    search.snapshot().messages.map((m) => m.id),
    ['new', 'old'],
  );
  await search.load();
  assert.equal(calls.length, 2);
});

test('editing, closing, or a newer query invalidates stale responses even if transport ignores abort', async () => {
  const requests: { signal?: AbortSignal; resolve: (page: MessagePage) => void }[] = [];
  const search = new ConversationSearch(
    {
      get: <T>(_: string, signal?: AbortSignal) =>
        new Promise<T>((resolve) => {
          requests.push({ signal, resolve: (page) => resolve(page as T) });
        }),
    },
    'conversation',
  );
  const old = search.search('old');
  const current = search.search('current');
  assert.equal(requests[0].signal?.aborted, true);
  requests[1].resolve({ messages: [message('current')], nextCursor: null });
  await current;
  requests[0].resolve({ messages: [message('old')], nextCursor: null });
  assert.equal(await old, undefined);
  assert.equal(search.snapshot().messages[0].id, 'current');
  const closing = search.search('closing');
  search.reset();
  requests[2].resolve({ messages: [message('closing')], nextCursor: null });
  assert.equal(await closing, undefined);
  assert.equal(search.snapshot().submitted, false);
  assert.deepEqual(search.snapshot().messages, []);
});

test('empty input makes no request and failures retain the cursor for a retry', async () => {
  let calls = 0;
  const search = new ConversationSearch(
    {
      get: async <T>() => {
        calls++;
        if (calls === 1) return { messages: [message('new')], nextCursor: 'cursor' } as T;
        if (calls === 2) throw new Error('Offline');
        return { messages: [message('old')], nextCursor: null } as T;
      },
    },
    'conversation',
  );
  await search.search('   ');
  assert.equal(calls, 0);
  await search.search('hello');
  await search.load();
  assert.equal(search.snapshot().error, 'Offline');
  assert.equal(search.snapshot().nextCursor, 'cursor');
  assert.equal(search.snapshot().messages.length, 1);
  await search.load();
  assert.equal(search.snapshot().error, '');
  assert.equal(search.snapshot().messages.length, 2);
});

test('snippets include searchable attachment details alongside captions', () => {
  assert.equal(
    searchSnippet({
      ...message('music'),
      text: 'Listen',
      attachmentMetadata: {
        title: 'Song title',
        artist: 'Artist',
        fileName: 'track.mp3',
      },
    } as Message),
    'Listen · Song title · Artist · track.mp3',
  );
});
