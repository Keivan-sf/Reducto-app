import assert from 'node:assert/strict';
import test from 'node:test';
import catalogue from '../src/data/emojis.json';
import {
  defaultEmoji,
  emojiByValue,
  emojiGroups,
  emojiVariants,
  searchEmojis,
} from '../src/lib/emoji-picker';
import {
  createEmojiUsageStore,
  emojiUsageKey,
  mostUsedEmojis,
  parseEmojiUsage,
  type EmojiUsage,
} from '../src/lib/emoji-usage';

test('catalogue includes the complete Unicode 17 set, all flags and multi-codepoint variants', () => {
  assert.equal(emojiByValue.size, 3953);
  const visible = emojiGroups.flatMap((group) => group.emojis);
  assert.equal(new Set(visible.map((entry) => entry.emoji)).size, visible.length);
  assert.ok(visible.length > 1900);
  assert.ok(visible.every((entry) => !/[\u{1F3FB}-\u{1F3FF}]/u.test(entry.emoji)));
  assert.equal(
    catalogue.reduce((count, group) => count + group.emojis.length, 0),
    3953,
  );
  const flags = emojiGroups.find((group) => group.name === 'Flags')!;
  assert.equal(flags.emojis.length, 270);
  for (const emoji of ['🇦🇫', '🇦🇽', '🇧🇹', '🇨🇼', '🇮🇷', '🇲🇭', '🇿🇼', '🏳️‍⚧️', '👩🏿‍🚀', '🧑🏼‍🦽', '🫪'])
    assert.ok(emojiByValue.has(emoji), emoji);
  assert.ok(
    searchEmojis('flag zimbabwe')
      .flatMap((group) => group.emojis)
      .some((entry) => entry.emoji === '🇿🇼'),
  );
  assert.ok(
    searchEmojis('astronaut dark skin')
      .flatMap((group) => group.emojis)
      .some((entry) => entry.emoji === '👩‍🚀'),
  );
});

test('top 40 ranks by actual frequency, then recency, without dropping lower-ranked history', () => {
  const emojis = [...emojiByValue.keys()].slice(0, 45);
  const usage: EmojiUsage = Object.fromEntries(
    emojis.map((emoji, index) => [emoji, { count: index + 1, lastUsed: index }]),
  );
  const top = mostUsedEmojis(usage);
  assert.equal(top.length, 40);
  assert.equal(top[0].emoji, emojis[44]);
  assert.equal(top[39].emoji, emojis[5]);
  usage[emojis[0]] = { count: 45, lastUsed: 1000 };
  assert.equal(mostUsedEmojis(usage)[0].emoji, emojis[0]);
  assert.equal(Object.keys(usage).length, 45);
  assert.deepEqual(mostUsedEmojis({}), []);
});

test('local counts survive reopening, rapid selections, and selections before loading finishes', async () => {
  let persisted: string | null = JSON.stringify({ '😀': { count: 8, lastUsed: 1 } });
  let resolveRead!: (value: string | null) => void;
  let readCount = 0;
  const store = createEmojiUsageStore(
    {
      read: () => {
        readCount++;
        return new Promise((resolve) => {
          resolveRead = resolve;
        });
      },
      write: async (value) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        persisted = value;
      },
    },
    () => 100,
  );
  const records = [store.record('😀'), store.record('🚀'), store.record('😀')];
  resolveRead(persisted);
  await Promise.all(records);
  assert.equal(readCount, 1);
  assert.equal(store.snapshot()['😀'].count, 10);
  assert.equal(store.snapshot()['🚀'].count, 1);
  assert.equal(parseEmojiUsage(persisted)['😀'].count, 10);
  const reopened = createEmojiUsageStore({ read: async () => persisted, write: async () => {} });
  await reopened.load();
  assert.deepEqual(reopened.snapshot(), store.snapshot());
  assert.notEqual(emojiUsageKey('user-a'), emojiUsageKey('user-b'));
});

test('damaged storage and write failures do not interrupt selection or corrupt valid counts', async () => {
  assert.deepEqual(parseEmojiUsage('{broken'), {});
  assert.deepEqual(parseEmojiUsage('null'), {});
  assert.deepEqual(
    parseEmojiUsage(
      JSON.stringify({
        '😀': { count: -1, lastUsed: 0 },
        '🚀': { count: 2, lastUsed: 10 },
        invalid: { count: 8, lastUsed: 1 },
      }),
    ),
    { '🚀': { count: 2, lastUsed: 10 } },
  );
  const store = createEmojiUsageStore({
    read: async () => {
      throw Error('unavailable');
    },
    write: async () => {
      throw Error('full');
    },
  });
  await store.record('😀');
  await store.record('😀');
  assert.equal(store.snapshot()['😀'].count, 2);
  await store.record('invalid');
  assert.equal(Object.keys(store.snapshot()).length, 1);
});

test('every toned sequence belongs to a default emoji and is reachable from its tone menu', () => {
  for (const entry of emojiByValue.values()) {
    if (!/[\u{1F3FB}-\u{1F3FF}]/u.test(entry.emoji) || [...entry.emoji].length === 1) continue;
    const base = defaultEmoji(entry.emoji);
    assert.ok(base, entry.name);
    assert.ok(
      emojiVariants(base.emoji).some((variant) => variant.emoji === entry.emoji),
      entry.name,
    );
  }
  assert.deepEqual(
    emojiVariants('👍').map((entry) => entry.emoji),
    ['👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿'],
  );
  assert.equal(defaultEmoji('☝🏿')?.emoji, '☝️');
  assert.equal(emojiVariants('😀').length, 0);
});

test('frequently used combines tone counts under one yellow default entry', () => {
  const result = mostUsedEmojis({
    '👍🏻': { count: 3, lastUsed: 1 },
    '👍🏾': { count: 4, lastUsed: 3 },
    '😀': { count: 6, lastUsed: 4 },
  });
  assert.deepEqual(
    result.map((entry) => entry.emoji),
    ['👍', '😀'],
  );
});
