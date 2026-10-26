import { useEffect, useSyncExternalStore } from 'react';
import { useSession } from '../../context/SessionContext';
import { createEmojiUsageStore, emojiUsageKey } from '../../lib/emoji-usage';
import { readEmojiUsage, writeEmojiUsage } from '../../lib/emoji-usage-storage';

const stores = new Map<string, ReturnType<typeof createEmojiUsageStore>>();
export function useEmojiUsage() {
  const { session } = useSession();
  const key = emojiUsageKey(session!.user.id);
  let store = stores.get(key);
  if (!store) {
    store = createEmojiUsageStore({
      read: () => readEmojiUsage(key),
      write: (value) => writeEmojiUsage(key, value),
    });
    stores.set(key, store);
  }
  const usage = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => {
    void store.load();
  }, [store]);
  return { usage, record: store.record };
}
