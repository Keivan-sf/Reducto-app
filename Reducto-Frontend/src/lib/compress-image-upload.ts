import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import type { VideoFile } from '../api/video-cache';
import { retainUpload } from './local-attachments';
import { imageDensity, capJpegDensity } from './image-density';

async function readBytes(uri: string) {
  return Platform.OS === 'web'
    ? new Uint8Array(await (await fetch(uri)).arrayBuffer())
    : new File(uri).bytes();
}

/** Keep the encoded JPEG as the single source for upload, preview, and saving. */
export async function compressImageUpload(source: VideoFile): Promise<VideoFile> {
  const density = imageDensity(await readBytes(source.uri));
  const context = ImageManipulator.manipulate(source.uri);
  try {
    let rendered = await context.renderAsync();
    try {
      const scale = Math.min(1, 1280 / Math.max(rendered.width, rendered.height));
      if (scale < 1) {
        context.resize({
          width: Math.max(1, Math.round(rendered.width * scale)),
          height: Math.max(1, Math.round(rendered.height * scale)),
        });
        const resized = await context.renderAsync();
        rendered.release();
        rendered = resized;
      }
      const image = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.87 });
      let normalizedUri: string | undefined;
      try {
        const base = (source.name ?? 'image').replace(/\.[^.]+$/, '') || 'image';
        const bytes = capJpegDensity(await readBytes(image.uri), density);
        if (Platform.OS === 'web')
          normalizedUri = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        else new File(image.uri).write(bytes);
        const retained = await retainUpload({
          uri: normalizedUri ?? image.uri,
          name: `${base}.jpg`,
          mimeType: 'image/jpeg',
        });
        retained.width = rendered.width;
        retained.height = rendered.height;
        return retained;
      } finally {
        if (normalizedUri) URL.revokeObjectURL(normalizedUri);
        if (Platform.OS === 'web') URL.revokeObjectURL(image.uri);
        else {
          const temporary = new File(image.uri);
          if (temporary.exists) temporary.delete();
        }
      }
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
}
