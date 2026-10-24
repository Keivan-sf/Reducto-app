import type { VisualMediaMetadata } from '../api/types';

export function mediaDimensions(media?: VisualMediaMetadata): MediaSize | undefined {
  return media &&
    typeof media.width === 'number' &&
    typeof media.height === 'number' &&
    Number.isFinite(media.width) &&
    Number.isFinite(media.height) &&
    media.width > 0 &&
    media.height > 0
    ? { width: media.width, height: media.height }
    : undefined;
}

export interface MediaSize {
  width: number;
  height: number;
}

/** Bound extreme shapes; cover-fit previews fill the frame and crop excess edges. */
export function mediaPreviewSize(size?: MediaSize) {
  const valid =
    size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0;
  const ratio = valid ? Math.min(4, Math.max(0.35, size.width / size.height)) : 1;
  const width = Math.min(290, 400 * ratio);
  return { width, aspectRatio: ratio };
}
