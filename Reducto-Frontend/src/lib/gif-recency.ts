/** A saved GIF's creation date can predate its addition to the current library. */
export function createGifRecencyStore(storage: {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
}) {
  let order: string[] = [];
  let libraryIds: string[] | null = null;
  let loaded: Promise<void> | undefined;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  const ids = (value: unknown): string[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      : [];
  const load = () =>
    (loaded ??= storage
      .read()
      .catch(() => null)
      .then((value) => {
        try {
          const parsed: unknown = JSON.parse(value ?? '{}');
          if (Array.isArray(parsed)) order = ids(parsed);
          else if (parsed && typeof parsed === 'object') {
            const state = parsed as { order?: unknown; libraryIds?: unknown };
            order = ids(state.order);
            if (Array.isArray(state.libraryIds)) libraryIds = ids(state.libraryIds);
          }
        } catch {
          /* An unreadable preference starts with the server's library order. */
        }
        listeners.forEach((listener) => listener());
      }));
  function publish(next: string[], nextLibrary = libraryIds) {
    const sameOrder =
      next.length === order.length && next.every((id, index) => id === order[index]);
    const sameLibrary =
      nextLibrary === libraryIds ||
      (nextLibrary !== null &&
        libraryIds !== null &&
        nextLibrary.length === libraryIds.length &&
        nextLibrary.every((id, index) => id === libraryIds![index]));
    if (sameOrder && sameLibrary) return Promise.resolve();
    order = next;
    libraryIds = nextLibrary;
    listeners.forEach((listener) => listener());
    const serialized = JSON.stringify({ order, libraryIds });
    writes = writes.catch(() => {}).then(() => storage.write(serialized));
    return writes.catch(() => {});
  }
  return {
    load,
    snapshot: () => order,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async record(id: string) {
      await load();
      await publish(
        [id, ...order.filter((other) => other !== id)],
        libraryIds === null ? null : [...new Set([...libraryIds, id])],
      );
    },
    async syncLibrary(ids: string[]) {
      await load();
      const library = new Set(ids);
      const known = new Set([...(libraryIds ?? []), ...order]);
      const survivors = order.filter((id) => library.has(id));
      const additions = [...new Set(ids.filter((id) => !known.has(id)))];
      // First fetch establishes the baseline after explicitly recorded actions.
      // Later fetches discover new additions at the front and remove deletions.
      await publish(
        libraryIds === null ? [...survivors, ...additions] : [...additions, ...survivors],
        [...library],
      );
    },
  };
}

export function sortGifsByRecency<T extends { id: string }>(gifs: T[], order: string[]) {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...gifs].sort(
    (a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity),
  );
}
