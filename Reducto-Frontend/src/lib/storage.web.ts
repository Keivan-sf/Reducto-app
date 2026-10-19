import type { Session } from '../api/types';
import { normalizeServerUrl, parseStoredSession, SERVER_KEY } from './server';

const KEY = 'reducto.session.v1';

export async function readSession(): Promise<Session | null> {
  const stored = localStorage.getItem(KEY);
  if (stored !== null) return parseStoredSession(stored);
  // Keep users already signed in with the previous tab-scoped storage.
  const legacy = parseStoredSession(sessionStorage.getItem(KEY));
  if (legacy) await writeSession(legacy);
  return legacy;
}

export async function writeSession(session: Session | null) {
  if (session) localStorage.setItem(KEY, JSON.stringify(session));
  else localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
}
export async function readServerUrl() {
  try {
    return normalizeServerUrl(localStorage.getItem(SERVER_KEY) ?? '');
  } catch {
    return '';
  }
}
export async function writeServerUrl(url: string) {
  localStorage.setItem(SERVER_KEY, normalizeServerUrl(url));
}

export function withSessionLock<T>(action: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request('reducto.session', action) : action();
}

export const sessionCoordination = { readSession, withRefreshLock: withSessionLock };

export function watchStoredSession(onChange: (session: Session | null) => void) {
  const listener = (event: StorageEvent) => {
    if (event.storageArea === localStorage && (event.key === KEY || event.key === null)) {
      // Clear the old tab copy so signing out elsewhere cannot resurrect it.
      sessionStorage.removeItem(KEY);
      onChange(event.key === null ? null : parseStoredSession(event.newValue));
    }
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
