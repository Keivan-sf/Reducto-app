import type { VideoFile } from '../api/video-cache';
import { readMusicMetadata } from './music-metadata';

export async function readUploadMusicMetadata(file: VideoFile, signal: AbortSignal) {
  const blob = file.blob ?? (await (await fetch(file.uri, { signal })).blob());
  return readMusicMetadata(
    {
      size: blob.size,
      type: file.mimeType || blob.type,
      read: (start, end) => blob.slice(start, end).arrayBuffer(),
    },
    signal,
  );
}
