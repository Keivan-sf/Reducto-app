export function normalizeUsername(value: string) {
  return value.trim().replace(/^@/, '').toLowerCase();
}

export function isValidUsername(value: string) {
  return /^[a-z0-9_]{1,32}$/.test(value);
}
