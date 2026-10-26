import type { VideoFile } from '../api/video-cache';
import type { UploadAsset } from './uploads';

export async function retainUpload(asset: UploadAsset): Promise<VideoFile> {
  const blob = asset.file ?? (await (await fetch(asset.uri)).blob());
  const uri = URL.createObjectURL(blob);
  let exists = true;
  return {
    uri,
    blob,
    bytes: blob.size,
    name: asset.name,
    mimeType: asset.mimeType || blob.type,
    exists: () => exists,
    dispose: () => {
      exists = false;
      URL.revokeObjectURL(uri);
    },
  };
}
export async function saveLocalFile(file: VideoFile) {
  const anchor = document.createElement('a');
  anchor.href = file.uri;
  anchor.download = file.name ?? 'attachment';
  anchor.click();
}
export const openLocalFile = saveLocalFile;
