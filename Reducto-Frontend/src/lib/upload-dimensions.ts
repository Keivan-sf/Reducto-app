import { Image, Platform } from 'react-native';
import { createVideoPlayer } from 'expo-video';
import { mediaDimensions, type MediaSize } from './media-preview';

/** Probe owned local files before publishing a visual upload in chat history. */
export function readUploadDimensions(
  uri: string,
  type: 'image' | 'video',
  signal: AbortSignal,
): Promise<MediaSize> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let release = () => {};
    const finish = (size?: MediaSize, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      release();
      const dimensions = mediaDimensions(size);
      if (dimensions) resolve(dimensions);
      else reject(error ?? new Error('Could not read media dimensions.'));
    };
    const abort = () => finish(undefined, new DOMException('Upload cancelled.', 'AbortError'));
    const timeout = setTimeout(() => finish(), 15000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return abort();
    try {
      if (type === 'image') {
        Image.getSize(
          uri,
          (width, height) => finish({ width, height }),
          (error) => finish(undefined, error),
        );
      } else if (Platform.OS === 'web') {
        const video = document.createElement('video');
        release = () => {
          video.onloadedmetadata = null;
          video.onerror = null;
          video.removeAttribute('src');
          video.load();
        };
        video.preload = 'metadata';
        video.onloadedmetadata = () =>
          finish({ width: video.videoWidth, height: video.videoHeight });
        video.onerror = () => finish();
        video.src = uri;
      } else {
        const player = createVideoPlayer(null);
        const loaded = player.addListener('sourceLoad', () => {
          // Track sizes on Android describe encoded pixels, before rotation.
          // The decoded frame supplies the displayed dimensions, as on the server.
          void player.generateThumbnailsAsync([0]).then(
            (frames) => {
              const frame = frames[0];
              const size = frame ? { width: frame.width, height: frame.height } : undefined;
              for (const thumbnail of frames) thumbnail.release();
              finish(size);
            },
            (error) => finish(undefined, error),
          );
        });
        const failed = player.addListener('statusChange', ({ status, error }) => {
          if (status === 'error')
            finish(undefined, new Error(error?.message ?? 'Could not read video dimensions.'));
        });
        release = () => {
          loaded.remove();
          failed.remove();
          player.release();
        };
        void player
          .replaceAsync({ uri, contentType: 'progressive' })
          .catch((error) => finish(undefined, error));
      }
    } catch (error) {
      finish(undefined, error);
    }
  });
}
