import { createGifRecencyStore } from './gif-recency';
import { readClientPreference, writeClientPreference } from './client-preferences';

const stores = new Map<string, ReturnType<typeof createGifRecencyStore>>();
export function gifRecencyStore(userId: string) {
  const key = `reducto.gif-recency.v1.${encodeURIComponent(userId)}`;
  let store = stores.get(key);
  if (!store) {
    store = createGifRecencyStore({
      read: () => readClientPreference(key),
      write: (value) => writeClientPreference(key, value),
    });
    stores.set(key, store);
  }
  return store;
}
