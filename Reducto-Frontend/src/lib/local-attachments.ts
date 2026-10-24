import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { startActivityAsync } from 'expo-intent-launcher';
import type { VideoFile } from '../api/video-cache';
import type { UploadAsset } from './uploads';

/** Own a copy: evicting our cache must never delete the selected original. */
export async function retainUpload(asset: UploadAsset): Promise<VideoFile> {
  const directory = new Directory(
    Paths.cache,
    'reducto-uploads',
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  directory.create({ intermediates: true, idempotent: true });
  const name = asset.name.replace(/[/\\]/g, '_');
  const destination = new File(
    directory,
    !name || name === '.' || name === '..' ? 'attachment' : name,
  );
  try {
    const source = new File(asset.uri);
    await source.copy(destination);
    return {
      uri: destination.uri,
      bytes: destination.size,
      name: asset.name,
      mimeType: asset.mimeType || source.type || 'application/octet-stream',
      exists: () => destination.exists,
      dispose: () => {
        if (directory.exists) directory.delete();
      },
    };
  } catch (error) {
    if (directory.exists) directory.delete();
    throw error;
  }
}
export async function saveLocalFile(file: VideoFile) {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('Sharing files is unavailable on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: file.mimeType });
}

export async function openLocalFile(file: VideoFile) {
  if (Platform.OS !== 'android') return saveLocalFile(file);
  try {
    await startActivityAsync('android.intent.action.VIEW', {
      data: new File(file.uri).contentUri,
      type: file.mimeType || 'application/octet-stream',
      flags: 1, // Grant the chosen app read access to this cached file.
    });
  } catch {
    // Files without an installed viewer can still be saved or shared.
    await saveLocalFile(file);
  }
}
