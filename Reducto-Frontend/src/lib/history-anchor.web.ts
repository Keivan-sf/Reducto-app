interface HistoryList {
  getScrollableNode(): HTMLElement | null;
}

/** Preserve the visible row when a newer batch is prepended to an inverted list.
 * Use the height delta until virtualization mounts the saved row, then correct
 * its exact pixel position. Stop immediately if the user starts another gesture. */
export function captureHistoryAnchor(list: HistoryList | null, older: boolean): () => void {
  const node = list?.getScrollableNode();
  if (!node || older) return () => {};
  const viewport = node.getBoundingClientRect();
  const element = [...node.querySelectorAll<HTMLElement>('[data-testid^="message-"]')].find(
    (element) => {
      const box = element.getBoundingClientRect();
      return box.top >= viewport.top && box.bottom <= viewport.bottom;
    },
  );
  const name = element?.getAttribute('data-testid');
  const top = element?.getBoundingClientRect().top;
  const height = node.scrollHeight;
  const offset = node.scrollTop;
  return () => {
    let frame = 0;
    let attempts = 0;
    let stopped = false;
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      for (const event of ['wheel', 'touchstart', 'pointerdown'])
        node.removeEventListener(event, stop);
    };
    for (const event of ['wheel', 'touchstart', 'pointerdown'])
      node.addEventListener(event, stop, { passive: true });
    node.scrollTop = offset + node.scrollHeight - height;
    const restore = () => {
      if (stopped || !node.isConnected) {
        stop();
        return;
      }
      const current =
        name &&
        [...node.querySelectorAll<HTMLElement>('[data-testid^="message-"]')].find(
          (element) => element.getAttribute('data-testid') === name,
        );
      if (current && top !== undefined) node.scrollTop -= current.getBoundingClientRect().top - top;
      else node.scrollTop = offset + node.scrollHeight - height;
      if (++attempts < 8) frame = requestAnimationFrame(restore);
      else stop();
    };
    frame = requestAnimationFrame(restore);
  };
}
