import type { ApiClient } from '../api/client';
import type { AttachmentCache } from '../api/attachment-cache';
import type { GifCache } from '../api/gif-cache';
import type { VideoCache, VideoFile } from '../api/video-cache';
import type { UploadJob } from '../api/message-outbox';
import type { AttachmentMetadata, Gif, PendingUpload } from '../api/types';
import { documentFileKey, gifFileKey, videoKey, voiceFileKey } from '../context/VideosContext';
import { compressImageUpload } from './compress-image-upload';
import { retainUpload } from './local-attachments';
import { uploadKind } from './upload-kind';
import { fileForm, type UploadAsset } from './uploads';

/** The outbox owns this job and its file independently of any mounted chat. */
export function messageUpload(
  conversationId: string,
  asset: UploadAsset & { size?: number },
  caches: {
    api: ApiClient;
    media: AttachmentCache;
    gifs: GifCache;
    files: VideoCache;
    onGifAdded?: (id: string) => void;
  },
  voice?: { file: VideoFile; duration: number },
): UploadJob {
  const kind = voice ? 'voice' : uploadKind(asset.mimeType, asset.name);
  const mime = asset.mimeType?.toLowerCase() ?? '';
  const type: PendingUpload['type'] = voice
    ? 'voice'
    : kind === 'gif'
      ? 'gif'
      : kind === 'document'
        ? 'document'
        : mime.startsWith('image/')
          ? 'image'
          : mime.startsWith('video/')
            ? 'video'
            : 'music';
  let local = voice?.file;
  let disposed = false;
  let compressed = false;
  const owner = caches.api.getSession();
  const check = (signal: AbortSignal) => {
    const current = caches.api.getSession();
    if (disposed || signal.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
    if (!owner || current?.user.id !== owner.user.id || current.serverUrl !== owner.serverUrl)
      throw new Error('Your session changed.');
  };
  return {
    initial: {
      type,
      name: asset.name,
      // Wait for the owned preview URI so the browser loads the video only once.
      uri: local?.uri,
      total: local?.bytes ?? asset.size ?? 0,
      sent: 0,
      duration: voice?.duration,
    },
    async prepare(signal, progress) {
      try {
        check(signal);
        if (!local) local = await retainUpload(asset);
        check(signal);
        if (local.bytes > 50 * 1024 * 1024) throw new Error('Choose a file smaller than 50 MB.');
        if (type === 'image' && !compressed) {
          const source = local;
          const result = await compressImageUpload(source);
          source.dispose();
          local = result;
          compressed = true;
          check(signal);
        }
        progress({ uri: local.uri, total: local.bytes, sent: 0, name: local.name ?? asset.name });
        const size = local.bytes;
        const body = await fileForm(
          type === 'gif' ? 'gif' : 'file',
          {
            uri: local.uri,
            file: local.blob,
            name: local.name ?? asset.name,
            mimeType: local.mimeType,
          },
          'xhr',
        );
        check(signal);
        if (type === 'voice' || type === 'music' || type === 'document') body.append('kind', type);
        const result = await caches.api.request<{ attachment: AttachmentMetadata; gif: Gif }>(
          type === 'gif' ? '/api/gifs' : `/api/conversations/${conversationId}/attachments`,
          { method: 'POST', body, signal },
          true,
          true,
          (sent, total) =>
            progress({ sent: Math.min(size, total ? Math.round((size * sent) / total) : sent) }),
        );
        check(signal);
        progress({ sent: size });
        if (type === 'gif') {
          caches.onGifAdded?.(result.gif.id);
          caches.gifs.remember(result.gif);
          caches.files.remember(gifFileKey(result.gif.id), local);
          local = undefined;
          return { type: 'gif', gifId: result.gif.id };
        }
        const media = result.attachment;
        caches.media.remember(conversationId, media);
        // Voice is converted by the server; retain the original recording for local playback.
        const key =
          media.type === 'voice'
            ? voiceFileKey(conversationId, media.id)
            : ['music', 'audio', 'document'].includes(media.type)
              ? documentFileKey(conversationId, media.id)
              : videoKey(conversationId, media.id);
        caches.files.remember(key, { ...local, ...(voice ? { duration: voice.duration } : {}) });
        local = undefined;
        return { type: media.type, mediaId: media.id };
      } catch (error) {
        if (disposed) {
          local?.dispose();
          local = undefined;
        }
        throw error;
      }
    },
    dispose() {
      disposed = true;
      local?.dispose();
      local = undefined;
    },
  };
}
