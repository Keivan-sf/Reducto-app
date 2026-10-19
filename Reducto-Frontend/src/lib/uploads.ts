import { Platform } from 'react-native';

export async function fileForm(
  field: string,
  file: { uri: string; name: string; mimeType?: string; file?: File },
) {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = file.file ?? (await (await fetch(file.uri)).blob());
    form.append(field, blob, file.name);
  } else {
    form.append(field, {
      uri: file.uri,
      name: file.name,
      type: file.mimeType ?? 'application/octet-stream',
    } as unknown as Blob);
  }
  return form;
}
