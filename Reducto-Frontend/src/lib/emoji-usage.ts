import { defaultEmoji, emojiByValue } from './emoji-picker';

export type EmojiUsage = Record<string, { count: number; lastUsed: number }>;
export const emojiUsageKey = (userId: string) =>
  `reducto.emoji-usage.v1.${encodeURIComponent(userId)}`;

export function parseEmojiUsage(value: string | null): EmojiUsage {
  const usage: EmojiUsage = {};
  try {
    const parsed: unknown = JSON.parse(value ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return usage;
    for (const [emoji, entry] of Object.entries(parsed)) {
      if (!emojiByValue.has(emoji) || !entry || typeof entry !== 'object') continue;
      const { count, lastUsed } = entry as Record<string, unknown>;
      if (
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count <= 0 ||
        typeof lastUsed !== 'number' ||
        !Number.isFinite(lastUsed) ||
        lastUsed < 0
      )
        continue;
      usage[emoji] = { count, lastUsed };
    }
  } catch {
    /* Treat missing or damaged local preferences as an empty history. */
  }
  return usage;
}

export function mostUsedEmojis(usage: EmojiUsage) {
  const totals: EmojiUsage = {};
  for (const [emoji, stats] of Object.entries(usage)) {
    const base = defaultEmoji(emoji);
    if (!base) continue;
    const previous = totals[base.emoji];
    totals[base.emoji] = {
      count: (previous?.count ?? 0) + stats.count,
      lastUsed: Math.max(previous?.lastUsed ?? 0, stats.lastUsed),
    };
  }
  return Object.entries(totals)
    .sort(([a, x], [b, y]) => y.count - x.count || y.lastUsed - x.lastUsed || a.localeCompare(b))
    .slice(0, 40)
    .flatMap(([emoji]) => {
      const entry = emojiByValue.get(emoji);
      return entry ? [entry] : [];
    });
}

/** Load once per user; serialize writes so quick selections cannot overwrite newer counts. */
export function createEmojiUsageStore(
  storage: {
    read: () => Promise<string | null>;
    write: (value: string) => Promise<void>;
  },
  now = Date.now,
) {
  let usage: EmojiUsage = {};
  let loaded: Promise<void> | undefined;
  let pendingWrite = Promise.resolve();
  const listeners = new Set<() => void>();
  const load = () =>
    (loaded ??= storage
      .read()
      .catch(() => null)
      .then((value) => {
        usage = parseEmojiUsage(value);
        listeners.forEach((listener) => listener());
      }));
  return {
    load,
    snapshot: () => usage,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async record(emoji: string) {
      if (!emojiByValue.has(emoji)) return;
      await load();
      usage = {
        ...usage,
        [emoji]: {
          count: Math.min(Number.MAX_SAFE_INTEGER, (usage[emoji]?.count ?? 0) + 1),
          lastUsed: now(),
        },
      };
      listeners.forEach((listener) => listener());
      const serialized = JSON.stringify(usage);
      pendingWrite = pendingWrite.catch(() => {}).then(() => storage.write(serialized));
      // Keep this session's counts if device storage is temporarily unavailable.
      await pendingWrite.catch(() => {});
    },
  };
}
