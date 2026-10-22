import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageOutbox, type OutgoingPayload } from '../src/api/message-outbox';
import type { Message } from '../src/api/types';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function setup() {
  let outgoing: Record<string, Message[]> = {};
  const accepted: Message[] = [];
  const requests: {
    payload: OutgoingPayload;
    signal: AbortSignal;
    resolve: (message: Message) => void;
    reject: (error: Error) => void;
  }[] = [];
  const box = new MessageOutbox(
    'me',
    async (_id, payload, signal) =>
      new Promise<Message>((resolve, reject) => {
        requests.push({ payload, signal, resolve, reject });
      }),
    (message) => accepted.push(message),
    (messages) => {
      outgoing = messages;
    },
  );
  const confirmed = (index: number, id = `server-${index}`): Message => ({
    id,
    conversationId: 'chat',
    senderId: 'me',
    text: requests[index].payload.text ?? null,
    attachment: requests[index].payload.attachment ?? null,
    replyToMessageId: requests[index].payload.replyToMessageId ?? null,
    forwardedFrom: null,
    createdAt: `2026-10-22T12:00:${String(index).padStart(2, '0')}Z`,
  });
  return { box, requests, accepted, confirmed, snapshot: () => outgoing.chat ?? [] };
}

test('optimistic sends publish immediately and run concurrently, replacing the correct bubble on out-of-order responses', async () => {
  const t = setup();
  for (const text of ['One', 'Two', 'Three']) t.box.enqueue('chat', { text });
  assert.equal(t.requests.length, 3, 'new sends never wait for earlier HTTP responses');
  assert.deepEqual(
    t.snapshot().map((message) => message.delivery),
    ['sending', 'sending', 'sending'],
  );
  assert.deepEqual(
    t.accepted,
    [],
    'temporary IDs must never enter the read-state/history pipeline',
  );
  assert.equal(new Set(t.snapshot().map((message) => message.id)).size, 3);
  t.requests[2].resolve(t.confirmed(2));
  t.requests[0].resolve(t.confirmed(0));
  await tick();
  assert.deepEqual(
    t.snapshot().map((message) => message.id),
    ['server-0', t.snapshot()[1].localId, 'server-2'],
  );
  assert.equal(t.snapshot()[1].delivery, 'sending');
  t.requests[1].resolve(t.confirmed(1));
  await tick();
  t.box.reconcile({ chat: t.accepted });
  assert.deepEqual(t.snapshot(), []);
  assert.equal(t.accepted.length, 3);
  t.box.dispose();
});

test('failure retains text, reply and attachment; retry replaces the same local bubble and discard removes failures', async () => {
  const t = setup();
  const payload: OutgoingPayload = {
    text: 'A reply',
    replyToMessageId: 'original',
    attachment: { type: 'gif', gifId: 'gif' },
  };
  const id = t.box.enqueue('chat', payload);
  t.requests[0].reject(new Error('Offline'));
  await tick();
  assert.equal(t.snapshot()[0].id, id);
  assert.equal(t.snapshot()[0].delivery, 'failed');
  assert.equal(t.snapshot()[0].sendError, 'Offline');
  assert.equal(t.snapshot()[0].replyToMessageId, 'original');
  t.box.retry(id);
  t.box.retry(id);
  assert.equal(t.requests.length, 2, 'retry cannot launch two requests for the same bubble');
  assert.deepEqual(t.requests[1].payload, payload);
  assert.equal(t.snapshot()[0].delivery, 'sending');
  t.requests[1].resolve(t.confirmed(1));
  await tick();
  assert.equal(t.snapshot()[0].id, 'server-1');
  assert.equal(t.snapshot()[0].delivery, undefined);
  const failed = t.box.enqueue('chat', { text: 'Discard me' });
  t.requests[2].reject(new Error('Offline'));
  await tick();
  t.box.discard(failed);
  assert.equal(t.snapshot().length, 1);
  t.box.dispose();
});

test('realtime echoes reconcile identical sends once, and an HTTP error cannot undo a confirmed delivery', async () => {
  const t = setup();
  t.box.enqueue('chat', { text: 'Same' });
  t.box.enqueue('chat', { text: 'Same' });
  const first = t.confirmed(0);
  t.box.observe(first);
  t.box.observe(first);
  assert.equal(t.snapshot().filter((message) => message.delivery === 'sending').length, 1);
  t.box.reconcile({ chat: [first] });
  assert.equal(t.snapshot().length, 1);
  t.requests[0].reject(new Error('Response lost'));
  await tick();
  assert.equal(t.snapshot().length, 1);
  t.requests[1].resolve(t.confirmed(1));
  await tick();
  t.box.observe(t.confirmed(1));
  assert.equal(t.snapshot()[0].delivery, undefined);
  t.box.dispose();
});

test('an echo after an HTTP response cannot confirm a second identical pending send', async () => {
  const t = setup();
  t.box.enqueue('chat', { text: 'Same' });
  t.box.enqueue('chat', { text: 'Same' });
  t.requests[0].resolve(t.confirmed(0));
  await tick();
  t.box.reconcile({ chat: t.accepted });
  t.box.observe(t.confirmed(0));
  assert.equal(t.snapshot().length, 1);
  assert.equal(t.snapshot()[0].delivery, 'sending');
  t.box.dispose();
  t.requests[1].reject(new Error('Cancelled'));
  await tick();
});

test('confirmed overlays remain visible across unloaded history gaps until their server messages are loaded', async () => {
  const t = setup();
  t.box.enqueue('chat', { text: 'Latest' });
  t.requests[0].resolve(t.confirmed(0));
  await tick();
  t.box.reconcile({ chat: [] });
  assert.equal(t.snapshot()[0].id, 'server-0');
  t.box.reconcile({ chat: [t.confirmed(0)] });
  assert.deepEqual(t.snapshot(), []);
  t.box.dispose();
});

test('removed conversations and disposed sessions abort sends and ignore late results', async () => {
  for (const dispose of [false, true]) {
    const t = setup();
    t.box.enqueue('chat', { text: 'Pending' });
    if (dispose) t.box.dispose();
    else t.box.prune(new Set());
    assert.equal(t.requests[0].signal.aborted, true);
    t.requests[0].resolve(t.confirmed(0));
    await tick();
    assert.deepEqual(t.accepted, []);
    t.box.dispose();
  }
});
