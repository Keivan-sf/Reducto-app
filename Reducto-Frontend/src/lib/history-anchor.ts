/** Native FlatList preserves this position with maintainVisibleContentPosition. */
export function captureHistoryAnchor(_list: unknown, _older: boolean): () => void {
  return () => {};
}
