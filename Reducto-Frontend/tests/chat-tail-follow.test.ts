import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatTailFollow } from '../src/lib/chat-tail-follow';

function setup() {
  let offset = 200;
  let sequence = 0;
  const frames = new Map<number, () => void>();
  const follow = new ChatTailFollow(
    () => {
      offset = 0;
    },
    (callback) => {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    },
    (id) => {
      frames.delete(id);
    },
  );
  const frame = () => {
    const batch = [...frames.values()];
    frames.clear();
    batch.forEach((callback) => callback());
  };
  return {
    follow,
    frame,
    frames,
    offset: () => offset,
    move: (next: number) => {
      offset = next;
    },
  };
}

test('sending corrects a native anchor restoration after insertion and a later keyboard resize', () => {
  const t = setup();
  t.follow.start();
  t.frame();
  assert.equal(t.offset(), 0);
  t.move(88); // Native maintainVisibleContentPosition restores the previous bubble.
  t.frame();
  assert.equal(t.offset(), 0, 'the new bubble must remain above the composer');
  t.move(220); // Keyboard/composer height changes after the send frame.
  t.follow.layout();
  t.frame();
  assert.equal(t.offset(), 0);
  t.frame();
  assert.equal(t.frames.size, 0, 'settling stops rather than continuously forcing scroll');
});

test('manual scrolling cancels pending corrections and viewport changes preserve older reading positions', () => {
  const t = setup();
  t.follow.start();
  t.frame();
  t.follow.stop();
  t.move(400);
  t.frame();
  t.follow.layout();
  t.frame();
  assert.equal(t.offset(), 400);
  assert.equal(t.frames.size, 0);
});

test('initial last-seen positioning is preserved until a send or explicit return to latest', () => {
  const t = setup();
  t.follow.layout();
  t.frame();
  assert.equal(t.offset(), 200);
  t.follow.start();
  t.follow.layout();
  t.follow.layout();
  assert.equal(t.frames.size, 1, 'layout bursts share one pending correction');
  t.frame();
  t.frame();
  assert.equal(t.offset(), 0);
});

test('voice seeking pauses corrections and resumes only if the chat was following latest', () => {
  const t = setup();
  t.follow.start();
  t.follow.setEnabled(false);
  t.frame();
  assert.equal(t.offset(), 200);
  t.follow.setEnabled(true);
  t.frame();
  assert.equal(t.offset(), 0);
  t.follow.stop();
  t.move(500);
  t.follow.setEnabled(false);
  t.follow.setEnabled(true);
  t.frame();
  assert.equal(t.offset(), 500);
});
