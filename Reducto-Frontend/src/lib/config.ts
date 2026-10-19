export const MEDIA_URL = process.env.EXPO_PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, '');
export function objectUrl(key: string | null) {
  return key && MEDIA_URL
    ? `${MEDIA_URL}/${key.split('/').map(encodeURIComponent).join('/')}`
    : undefined;
}
