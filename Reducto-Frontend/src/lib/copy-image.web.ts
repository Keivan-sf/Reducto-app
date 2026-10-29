import type { VideoFile } from '../api/video-cache';

export function canCopyImage() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const mobile =
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return (
    !mobile &&
    window.matchMedia('(any-pointer: fine)').matches &&
    typeof navigator.clipboard?.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  );
}

async function imagePng(load: () => Promise<VideoFile>): Promise<Blob> {
  const file = await load();
  const blob = file.blob ?? (await (await fetch(file.uri)).blob());
  if (blob.type === 'image/png') return blob;

  // PNG is the image format supported across browser clipboard implementations.
  const uri = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = uri;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare this image for copying.');
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png);
        else reject(new Error('Could not prepare this image for copying.'));
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(uri);
  }
}

export async function copyImage(load: () => Promise<VideoFile>): Promise<void> {
  if (!canCopyImage()) throw new Error('Image copying is unavailable in this browser.');
  // Start the clipboard write during the click, before loading/converting the image.
  // Safari requires user activation even when the image is still being fetched.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': imagePng(load) })]);
}
