import assert from 'node:assert/strict';
import test from 'node:test';
import { bindChatFileDrop } from '../src/lib/chat-file-drop';

function setup() {
  const window = new EventTarget();
  const element = Object.assign(new EventTarget(), { ownerDocument: { defaultView: window } });
  let hover: string | null = null;
  const files: File[] = [];
  const dispose = bindChatFileDrop(
    element as unknown as HTMLElement,
    (type) => {
      hover = type;
    },
    (file) => files.push(file),
  );
  function drag(name: string, files: File[] = [], types = ['Files'], type = 'audio/flac') {
    const event = new Event(name, { cancelable: true });
    const dataTransfer = { files, types, items: [{ type }], dropEffect: 'none' };
    Object.assign(event, { dataTransfer });
    element.dispatchEvent(event);
    return { prevented: event.defaultPrevented, dropEffect: dataTransfer.dropEffect };
  }
  return { window, drag, files, dispose, hover: () => hover };
}

test('file drag accepts a copy and keeps the overlay while moving across chat children', () => {
  const t = setup();
  assert.deepEqual(t.drag('dragenter'), { prevented: true, dropEffect: 'copy' });
  assert.equal(t.hover(), 'audio/flac');
  t.drag('dragenter'); // Enter a child before leaving its sibling.
  t.drag('dragleave');
  assert.equal(t.hover(), 'audio/flac');
  assert.equal(t.drag('dragover').prevented, true, 'dragover must allow the browser drop');
  t.drag('dragleave');
  assert.equal(t.hover(), null);
  assert.deepEqual(t.files, [], 'hovering never sends or selects a file');
  t.dispose();
});

test('dropping several files selects only the first for preview and clears the overlay', () => {
  const t = setup();
  const first = new File(['music'], 'song.flac', { type: 'audio/flac' });
  const second = new File(['document'], 'notes.txt', { type: 'text/plain' });
  t.drag('dragenter');
  assert.equal(t.drag('drop', [first, second]).prevented, true);
  assert.deepEqual(t.files, [first]);
  assert.equal(t.hover(), null);
  t.dispose();
});

test('text drags keep browser behavior and empty drops do not open a preview', () => {
  const t = setup();
  for (const name of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    assert.equal(t.drag(name, [], ['text/plain']).prevented, false);
    assert.equal(t.hover(), null);
  }
  t.drag('dragenter', [], ['Files'], '');
  assert.equal(t.hover(), '', 'unknown file types still show the generic overlay');
  t.drag('drop');
  assert.equal(t.hover(), null);
  assert.deepEqual(t.files, []);
  t.dispose();
});

test('cancel, external drop, focus loss, and cleanup clear the overlay', () => {
  for (const name of ['dragend', 'drop', 'blur']) {
    const t = setup();
    t.drag('dragenter');
    t.window.dispatchEvent(new Event(name));
    assert.equal(t.hover(), null);
    t.dispose();
  }
  const t = setup();
  t.drag('dragenter');
  t.dispose();
  assert.equal(t.hover(), null);
  assert.equal(t.drag('dragenter').prevented, false, 'cleanup removes chat listeners');
  t.drag('drop', [new File(['bytes'], 'file.bin')]);
  assert.deepEqual(t.files, [], 'a previous chat cannot receive a drop after cleanup');
});
