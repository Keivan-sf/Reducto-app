import type { Session } from '../api/types';

const KEY = 'reducto.session.v1';
function parse(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value?.user?.id === 'string' &&
      typeof value.accessToken === 'string' &&
      !!value.accessToken &&
      typeof value.refreshToken === 'string' &&
      !!value.refreshToken
      ? value
      : null;
  } catch {
    return null;
  }
}

export async function readSession(): Promise<Session | null> {
  const stored = localStorage.getItem(KEY);
  if (stored !== null) return parse(stored);
  // Keep users already signed in with the previous tab-scoped storage.
  const legacy = parse(sessionStorage.getItem(KEY));
  if (legacy) await writeSession(legacy);
  return legacy;
}

export async function writeSession(session: Session | null) {
  if (session) localStorage.setItem(KEY, JSON.stringify(session));
  else localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
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
      onChange(event.key === null ? null : parse(event.newValue));
    }
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
