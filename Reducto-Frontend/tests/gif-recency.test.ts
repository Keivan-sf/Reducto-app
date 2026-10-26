import assert from 'node:assert/strict';
import test from 'node:test';
import { createGifRecencyStore, sortGifsByRecency } from '../src/lib/gif-recency';

function fixture(initial: string | null = null) {
  let value = initial;
  const storage = {
    read: async () => value,
    write: async (next: string) => {
      value = next;
    },
  };
  return { storage, store: createGifRecencyStore(storage) };
}

test('newest additions establish the baseline; each use/add moves just that GIF to the front', async () => {
  const { store } = fixture();
  await store.syncLibrary(['new', 'middle', 'old']);
  assert.deepEqual(store.snapshot(), ['new', 'middle', 'old']);
  await store.record('old');
  assert.deepEqual(store.snapshot(), ['old', 'new', 'middle']);
  await store.record('middle');
  assert.deepEqual(store.snapshot(), ['middle', 'old', 'new']);
  await store.syncLibrary(['added', 'new', 'middle', 'old']);
  assert.deepEqual(store.snapshot(), ['added', 'middle', 'old', 'new']);
  await store.syncLibrary(['added', 'new', 'middle', 'old']);
  assert.deepEqual(store.snapshot(), ['added', 'middle', 'old', 'new']);
  const source = [{ id: 'old' }, { id: 'new' }, { id: 'added' }, { id: 'middle' }];
  assert.deepEqual(
    sortGifsByRecency(source, store.snapshot()).map((gif) => gif.id),
    store.snapshot(),
  );
  assert.equal(source[0].id, 'old', 'API metadata is not mutated');
});

test('a saved or uploaded GIF keeps its place even before the first library fetch', async () => {
  const { store } = fixture();
  await store.record('shared');
  await store.syncLibrary(['new', 'old', 'shared']);
  assert.deepEqual(store.snapshot(), ['shared', 'new', 'old']);
  await store.record('upload');
  await store.record('old');
  await store.syncLibrary(['upload', 'new', 'old', 'shared']);
  assert.deepEqual(store.snapshot(), ['old', 'upload', 'shared', 'new']);
});

test('ordering survives restart, removes deleted entries and promotes re-added GIFs', async () => {
  const { store, storage } = fixture();
  await store.syncLibrary(['new', 'old']);
  await store.record('old');
  const reopened = createGifRecencyStore(storage);
  await reopened.syncLibrary(['new', 'old']);
  assert.deepEqual(reopened.snapshot(), ['old', 'new']);
  await reopened.syncLibrary(['new']);
  assert.deepEqual(reopened.snapshot(), ['new']);
  await reopened.syncLibrary(['old', 'new']);
  assert.deepEqual(reopened.snapshot(), ['old', 'new']);
});

test('rapid uses preserve their order and unavailable storage does not prevent sending', async () => {
  const { store, storage } = fixture('{broken');
  await store.syncLibrary(['a', 'b', 'c']);
  await Promise.all([store.record('a'), store.record('c'), store.record('b')]);
  assert.deepEqual(store.snapshot(), ['b', 'c', 'a']);
  const reopened = createGifRecencyStore(storage);
  await reopened.load();
  assert.deepEqual(reopened.snapshot(), ['b', 'c', 'a']);
  const unavailable = createGifRecencyStore({
    read: async () => {
      throw Error('blocked');
    },
    write: async () => {
      throw Error('full');
    },
  });
  await unavailable.record('gif');
  assert.deepEqual(unavailable.snapshot(), ['gif']);
});
