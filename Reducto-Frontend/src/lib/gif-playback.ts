/** Observe playback state without taking ownership of Expo's native player lifetime. */
export function watchGifPlayback(
  player: { play(): void; pause(): void },
  shouldPlay: () => boolean,
  subscribe: (update: () => void) => () => void,
) {
  let disposed = false;
  const update = () => {
    if (disposed) return;
    if (shouldPlay()) player.play();
    else player.pause();
  };
  update();
  const unsubscribe = subscribe(update);
  return () => {
    disposed = true;
    unsubscribe();
    // useVideoPlayer releases the player on unmount/source replacement. It may
    // already be released when this cleanup runs, so never call it here.
  };
}
