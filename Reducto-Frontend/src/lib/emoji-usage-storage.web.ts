export async function readEmojiUsage(key: string) {
  return localStorage.getItem(key);
}
export async function writeEmojiUsage(key: string, value: string) {
  localStorage.setItem(key, value);
}
