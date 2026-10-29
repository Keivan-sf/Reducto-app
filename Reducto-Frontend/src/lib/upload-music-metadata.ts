import { File, FileMode } from 'expo-file-system';
import type { VideoFile } from '../api/video-cache';
import { readMusicMetadata } from './music-metadata';

export async function readUploadMusicMetadata(file: VideoFile, signal: AbortSignal) {
  const handle = new File(file.uri).open(FileMode.ReadOnly);
  try {
    return await readMusicMetadata(
      {
        size: file.bytes,
        type: file.mimeType ?? '',
        async read(start, end) {
          handle.offset = start;
          const bytes = handle.readBytes(end - start);
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
        },
      },
      signal,
    );
  } finally {
    handle.close();
  }
}
