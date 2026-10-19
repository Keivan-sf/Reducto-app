import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { Session } from '../api/types';

const KEY = 'reducto.session.v1';
// Web resolves storage.web.ts, which persists sessions across browser restarts.
export const sessionCoordination = undefined;
export const withSessionLock = <T>(action: () => Promise<T>) => action();
export const watchStoredSession = (_onChange: (session: Session | null) => void) => () => {};
export async function readSession(): Promise<Session | null> {
  const raw =
    Platform.OS === 'web' ? sessionStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.user?.id && parsed.accessToken && parsed.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}
export async function writeSession(session: Session | null) {
  if (Platform.OS === 'web') {
    if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
    else sessionStorage.removeItem(KEY);
  } else if (session) await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  else await SecureStore.deleteItemAsync(KEY);
}
