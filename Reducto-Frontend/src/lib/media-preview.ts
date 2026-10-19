export interface MediaSize {
  width: number;
  height: number;
}

/** Bound extreme shapes; contain-fit media adds padding instead of cropping. */
export function mediaPreviewSize(size?: MediaSize) {
  const valid =
    size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0;
  const ratio = valid ? Math.min(2.5, Math.max(0.6, size.width / size.height)) : 4 / 3;
  const width = Math.min(260, 280 * ratio, valid ? Math.max(100, size.width) : 200);
  return { width, aspectRatio: ratio };
}
