import type { VideoFile } from '../api/video-cache';
import type { VideoDownloadRequest } from './video-download.types';

export async function loadVideoFile(request: VideoDownloadRequest): Promise<VideoFile> {
  const get = (headers: Record<string, string>) =>
    new Promise<{ status: number; blob: Blob }>((resolve, reject) => {
      if (request.signal.aborted) return reject(new Error('Download cancelled'));
      const xhr = new XMLHttpRequest();
      xhr.open('GET', request.url);
      xhr.responseType = 'blob';
      Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      const abort = () => xhr.abort();
      request.signal.addEventListener('abort', abort, { once: true });
      xhr.onloadend = () => request.signal.removeEventListener('abort', abort);
      xhr.onprogress = (event) =>
        request.progress({
          received: event.loaded,
          total: event.lengthComputable ? event.total : 0,
        });
      xhr.onload = () => resolve({ status: xhr.status, blob: xhr.response });
      xhr.onerror = () =>
        reject(new Error('Could not download this video. Check your connection.'));
      xhr.onabort = () => reject(new Error('Download cancelled'));
      xhr.timeout = 120000;
      xhr.ontimeout = () => reject(new Error('Video download timed out. Tap to retry.'));
      xhr.send();
    });
  let response = await get(request.headers);
  if (response.status === 401) response = await get(await request.refresh());
  if (response.status !== 200)
    throw new Error(`Could not download media (HTTP ${response.status}).`);
  if (request.signal.aborted) throw new Error('Download cancelled');
  // The attachment endpoint deliberately returns application/octet-stream.
  const uri = URL.createObjectURL(
    new Blob([response.blob], { type: request.mimeType ?? 'video/mp4' }),
  );
  return {
    uri,
    bytes: response.blob.size,
    mimeType: request.mimeType,
    name: request.fileName,
    dispose: () => URL.revokeObjectURL(uri),
  };
}

export async function saveVideoFile(file: VideoFile) {
  const anchor = document.createElement('a');
  anchor.href = file.uri;
  anchor.download = file.name ?? 'video.mp4';
  anchor.click();
}
