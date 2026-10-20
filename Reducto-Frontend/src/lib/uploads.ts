import { File as NativeFile } from 'expo-file-system';
import { Platform } from 'react-native';

type UploadAsset = { uri: string; name: string; mimeType?: string; file?: File };

export async function fileForm(field: string, file: UploadAsset) {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = file.file ?? (await (await fetch(file.uri)).blob());
    form.append(field, blob, file.name);
  } else {
    const source = new NativeFile(file.uri);
    // Expo fetch accepts file parts with bytes(). Keep the picker metadata and
    // let the encoder read the file, without constructing a React Native Blob
    // (which cannot accept ArrayBuffers). FormData's types only declare Blob.
    const part = {
      name: file.name,
      type: file.mimeType || source.type || 'application/octet-stream',
      bytes: () => source.bytes(),
    };
    form.append(field, part as unknown as Blob);
  }
  return form;
}
