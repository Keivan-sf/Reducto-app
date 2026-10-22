import { Directory, File, Paths } from 'expo-file-system';
import type { VideoFile } from '../api/video-cache';
import type { VideoDownloadRequest } from './video-download.types';

export async function loadVideoFile(request: VideoDownloadRequest): Promise<VideoFile> {
  const directory = new Directory(Paths.cache, 'reducto-videos');
  const destination = new File(
    directory,
    `reducto-media-${Date.now()}-${Math.random().toString(36).slice(2)}${request.mimeType === 'audio/ogg' ? '.ogg' : '.mp4'}`,
  );
  const dispose = () => {
    if (destination.exists) destination.delete();
  };
  const get = (headers: Record<string, string>) => {
    if (request.signal.aborted) {
      const error = new Error('Download cancelled');
      error.name = 'AbortError';
      throw error;
    }
    // File references do not create directories. Expo Go's scoped cache can be
    // absent on first use, and Android may also remove cache directories later.
    directory.create({ intermediates: true, idempotent: true });
    return File.downloadFileAsync(request.url, destination, {
      headers,
      signal: request.signal,
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) =>
        request.progress({ received: bytesWritten, total: Math.max(0, totalBytes) }),
    });
  };
  try {
    let headers = request.headers;
    let refreshed = false;
    let retriedMissingPath = false;
    for (;;) {
      try {
        const file = await get(headers);
        if (!file.exists || file.size <= 0)
          throw new Error('The downloaded video file is missing or empty. Tap to retry.');
        return {
          uri: file.uri,
          bytes: file.size,
          mimeType: request.mimeType,
          name: request.fileName,
          exists: () => file.exists && file.size > 0,
          dispose,
        };
      } catch (error) {
        if (request.signal.aborted) throw error;
        const message = String(error);
        if (!refreshed && /\b401\b/.test(message)) {
          refreshed = true;
          headers = await request.refresh();
        } else if (
          !retriedMissingPath &&
          /ENOENT|No such file or directory|FileNotFoundException/i.test(message) &&
          !/EACCES|Permission denied/i.test(message)
        ) {
          // The directory can disappear while waiting for the HTTP response.
          retriedMissingPath = true;
        } else throw error;
      }
    }
  } catch (error) {
    dispose();
    throw error;
  }
}

export async function saveVideoFile(file: VideoFile) {
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('Sharing files is unavailable on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: file.mimeType ?? 'video/mp4' });
}
