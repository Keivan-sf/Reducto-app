import * as SecureStore from 'expo-secure-store';
import type { Session } from '../api/types';
import { normalizeServerUrl, parseStoredSession, SERVER_KEY } from './server';

const KEY = 'reducto.session.v1';
// Web resolves storage.web.ts, which persists sessions across browser restarts.
export const sessionCoordination = undefined;
export const withSessionLock = <T>(action: () => Promise<T>) => action();
export const watchStoredSession = (_onChange: (session: Session | null) => void) => () => {};
export async function readSession(): Promise<Session | null> {
  return parseStoredSession(await SecureStore.getItemAsync(KEY));
}
export async function writeSession(session: Session | null) {
  if (session) await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  else await SecureStore.deleteItemAsync(KEY);
}
export async function readServerUrl() {
  try {
    return normalizeServerUrl((await SecureStore.getItemAsync(SERVER_KEY)) ?? '');
  } catch {
    return '';
  }
}
export async function writeServerUrl(url: string) {
  await SecureStore.setItemAsync(SERVER_KEY, normalizeServerUrl(url));
}
