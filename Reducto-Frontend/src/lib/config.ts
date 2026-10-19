import Constants from 'expo-constants';
import { Platform } from 'react-native';

const developmentHost = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';
// The local proxy supplies CORS for the reference backend on web.
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'web'
    ? `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3001`
    : `http://${developmentHost}:3000`)
).replace(/\/$/, '');
export const MEDIA_URL = process.env.EXPO_PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, '');
export function objectUrl(key: string | null) {
  return key && MEDIA_URL
    ? `${MEDIA_URL}/${key.split('/').map(encodeURIComponent).join('/')}`
    : undefined;
}
