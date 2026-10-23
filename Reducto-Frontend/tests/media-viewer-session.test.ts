import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaViewerSession } from '../src/lib/media-viewer-session';

test('closing starts the fade without publishing React updates or running callbacks; content survives dismissal', () => {
  const calls: string[] = [];
  const session = new MediaViewerSession<string>(() => calls.push('dismissed'));
  let finishFade: (() => void) | undefined;
  session.attachDismiss((done) => {
    calls.push('animate');
    finishFade = done;
  });
  session.subscribe(() => calls.push('render'));
  session.open('image');
  const shown = session.read();
  calls.length = 0;
  session.close(() => calls.push('options'));
  assert.deepEqual(calls, ['animate']);
  assert.equal(session.read(), shown, 'no React snapshot update while fading');
  assert.equal(session.isOpen(), true, 'read receipts stay blocked until dismissal');
  assert.equal(session.canPlay(), false, 'a loading video cannot autoplay during the fade');
  session.close();
  assert.deepEqual(calls, ['animate'], 'repeated close requests do not restart the fade');
  finishFade!();
  assert.deepEqual(calls, ['animate', 'render', 'dismissed', 'options']);
  assert.equal(session.read().content, 'image');
  assert.equal(session.isOpen(), false);
});

test('opening during fade-out cancels stale dismissal and its deferred actions', () => {
  let finishFade = () => {};
  const dismissed: string[] = [];
  const session = new MediaViewerSession<string>((content) => dismissed.push(content));
  session.attachDismiss((done) => {
    finishFade = done;
  });
  session.open('old image');
  session.close(() => assert.fail('stale message options must not open'));
  session.open('new video');
  finishFade();
  assert.equal(session.isOpen(), true);
  assert.equal(session.canPlay(), true);
  assert.equal(session.read().content, 'new video');
  assert.deepEqual(dismissed, []);
  session.close();
  finishFade();
  assert.deepEqual(dismissed, ['new video']);
});

test('unsubscribed observers and detached animation hosts are never called', () => {
  const session = new MediaViewerSession<string>(() => {});
  const unsubscribe = session.subscribe(() => assert.fail('unsubscribed'));
  unsubscribe();
  const detach = session.attachDismiss(() => assert.fail('detached'));
  detach();
  session.open('photo');
  session.close();
  assert.equal(session.isOpen(), false);
});
