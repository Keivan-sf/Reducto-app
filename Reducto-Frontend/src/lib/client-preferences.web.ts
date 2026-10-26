export async function readClientPreference(key: string) {
  return localStorage.getItem(key);
}
export async function writeClientPreference(key: string, value: string) {
  localStorage.setItem(key, value);
}
