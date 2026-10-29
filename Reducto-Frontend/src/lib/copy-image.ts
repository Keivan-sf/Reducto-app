import type { VideoFile } from '../api/video-cache';

export function canCopyImage() {
  return false;
}

export async function copyImage(_load: () => Promise<VideoFile>): Promise<void> {
  throw new Error('Copy Image is available on desktop browsers only.');
}
