import { File, Paths } from 'expo-file-system';

export async function readEmojiUsage(key: string) {
  const file = new File(Paths.document, `${key}.json`);
  return file.exists ? file.text() : null;
}
export async function writeEmojiUsage(key: string, value: string) {
  const file = new File(Paths.document, `${key}.json`);
  if (!file.exists) file.create();
  file.write(value);
}
