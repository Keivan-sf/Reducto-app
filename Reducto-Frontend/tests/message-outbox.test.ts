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
    isEdited: false,
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

test('uploads reserve bubbles immediately and let text and other conversations send independently', async () => {
  const t = setup();
  const jobs: {
    signal: AbortSignal;
    progress: (update: { sent: number }) => void;
    resolve: (attachment: { type: 'video'; mediaId: string }) => void;
  }[] = [];
  let disposed = 0;
  const upload = () => ({
    initial: { type: 'video' as const, name: 'clip.mp4', total: 100, sent: 0 },
    prepare: (signal: AbortSignal, progress: (update: { sent: number }) => void) =>
      new Promise<{ type: 'video'; mediaId: string }>((resolve) =>
        jobs.push({ signal, progress, resolve }),
      ),
    dispose: () => {
      disposed++;
    },
  });
  const first = t.box.enqueue('chat', { replyToMessageId: 'reply' }, upload());
  const second = t.box.enqueue('other', {}, upload());
  assert.equal(t.snapshot()[0].localId, first);
  assert.equal(t.snapshot()[0].upload?.sent, 0);
  assert.equal(t.requests.length, 0, 'attachment messages wait for their own upload only');
  jobs[0].progress({ sent: 40 });
  assert.equal(t.box.getUpload(first)?.sent, 40);
  t.box.enqueue('chat', { text: 'While uploading' });
  assert.equal(t.requests.length, 1);
  jobs[1].resolve({ type: 'video', mediaId: 'second-file' });
  await tick();
  assert.equal(t.requests.length, 2);
  assert.deepEqual(t.requests[1].payload.attachment, { type: 'video', mediaId: 'second-file' });
  t.box.cancel(first);
  assert.equal(jobs[0].signal.aborted, true);
  assert.equal(
    t.snapshot().some((message) => message.localId === first),
    false,
  );
  jobs[0].resolve({ type: 'video', mediaId: 'cancelled-file' });
  await tick();
  assert.equal(t.requests.length, 2, 'a cancelled upload must never send a message');
  t.box.cancel(second);
  assert.equal(t.requests[1].signal.aborted, true);
  assert.equal(disposed, 2);
  t.requests[0].resolve(t.confirmed(0));
  t.requests[1].reject(new Error('Cancelled'));
  await tick();
  t.box.dispose();
});

test('failed uploads retry in the same bubble and message retries reuse completed uploads', async () => {
  const t = setup();
  let attempts = 0;
  let disposed = 0;
  const id = t.box.enqueue(
    'chat',
    { text: 'Caption', replyToMessageId: 'reply' },
    {
      initial: { type: 'image', name: 'photo.jpg', total: 42, sent: 0 },
      prepare: async (_signal, progress) => {
        attempts++;
        if (attempts === 1) throw new Error('Upload offline');
        progress({ sent: 42 });
        return { type: 'image', mediaId: 'uploaded' };
      },
      dispose: () => {
        disposed++;
      },
    },
  );
  await tick();
  assert.equal(t.snapshot()[0].delivery, 'failed');
  assert.equal(t.requests.length, 0);
  t.box.retry(id);
  await tick();
  assert.equal(t.snapshot()[0].id, id);
  assert.equal(t.box.getUpload(id)?.sent, 42);
  assert.deepEqual(t.requests[0].payload, {
    text: 'Caption',
    replyToMessageId: 'reply',
    attachment: { type: 'image', mediaId: 'uploaded' },
  });
  t.requests[0].reject(new Error('Send offline'));
  await tick();
  t.box.retry(id);
  await tick();
  assert.equal(attempts, 2, 'a message failure must not upload the file again');
  t.requests[1].resolve(t.confirmed(1));
  await tick();
  assert.equal(t.snapshot()[0].upload, undefined);
  assert.equal(disposed, 1);
  t.box.dispose();
});

test('session disposal aborts and cleans unfinished uploads without accepting late progress', async () => {
  const t = setup();
  let signal: AbortSignal | undefined;
  let progress: ((update: { sent: number }) => void) | undefined;
  let complete: ((attachment: { type: 'document'; mediaId: string }) => void) | undefined;
  let disposed = false;
  t.box.enqueue(
    'chat',
    {},
    {
      initial: { type: 'document', name: 'report.pdf', total: 100, sent: 0 },
      prepare: async (s, p) => {
        signal = s;
        progress = p;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
      dispose: () => {
        disposed = true;
      },
    },
  );
  t.box.dispose();
  assert.equal(signal?.aborted, true);
  assert.equal(disposed, true);
  progress!({ sent: 90 });
  complete!({ type: 'document', mediaId: 'late' });
  await tick();
  assert.equal(t.requests.length, 0);
  assert.equal(t.accepted.length, 0);
});

test('frequent upload progress updates notify only that bubble, without publishing chat state', async () => {
  let publications = 0;
  let changes = 0;
  let otherChanges = 0;
  let update: ((progress: { sent: number }) => void) | undefined;
  let finish: ((attachment: { type: 'video'; mediaId: string }) => void) | undefined;
  const box = new MessageOutbox(
    'me',
    async () => {
      throw new Error('Cancelled');
    },
    () => {},
    () => {
      publications++;
    },
  );
  const id = box.enqueue(
    'chat',
    {},
    {
      initial: { type: 'video', name: 'large.mp4', sent: 0, total: 50_000_000 },
      prepare: async (_signal, progress) => {
        update = progress;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      dispose: () => {},
    },
  );
  const unsubscribe = box.subscribeUpload(id, () => {
    changes++;
  });
  const unsubscribeOther = box.subscribeUpload('another-upload', () => {
    otherChanges++;
  });
  const initial = box.getUpload(id);
  for (let sent = 1; sent <= 1000; sent++) update!({ sent });
  assert.equal(publications, 1, 'only adding the message should update shared chat context');
  assert.equal(changes, 1000);
  assert.equal(otherChanges, 0);
  assert.equal(initial?.sent, 0, 'external-store snapshots must be immutable');
  assert.equal(box.getUpload(id)?.sent, 1000);
  unsubscribe();
  update!({ sent: 2000 });
  assert.equal(changes, 1000, 'offscreen bubbles can unsubscribe from progress');
  unsubscribeOther();
  box.cancel(id);
  update!({ sent: 3000 });
  assert.equal(box.getUpload(id), undefined);
  finish!({ type: 'video', mediaId: 'cancelled' });
  await tick();
  box.dispose();
});
