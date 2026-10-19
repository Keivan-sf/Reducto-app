import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { ApiClient, ApiError } from '../api/client';
import type { Session, User } from '../api/types';
import { normalizeServerUrl } from '../lib/server';
import {
  readSession,
  writeSession,
  sessionCoordination,
  withSessionLock,
  watchStoredSession,
  readServerUrl,
  writeServerUrl,
} from '../lib/storage';

export const api = new ApiClient('', sessionCoordination);
interface SessionState {
  session: Session | null;
  ready: boolean;
  serverUrl: string;
  configureServer: (url: string) => Promise<string>;
  establish: (session: Session | null) => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  signOut: () => Promise<void>;
}
const Context = createContext<SessionState>(null!);
export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  async function establish(next: Session | null) {
    if (next) {
      await writeServerUrl(next.serverUrl);
      setServerUrl(next.serverUrl);
    }
    api.setSession(next);
    setSession(next);
    await writeSession(next);
  }
  useEffect(() => {
    api.onSession = establish;
    let active = true;
    const stopWatching = watchStoredSession((next) => {
      api.setSession(next);
      if (next) setServerUrl(next.serverUrl);
      setSession(next);
    });
    void (async () => {
      try {
        const selected = await readServerUrl();
        const stored = await readSession();
        if (!active) return;
        const restoredUrl = stored?.serverUrl ?? selected;
        api.baseUrl = restoredUrl;
        setServerUrl(restoredUrl);
        api.setSession(stored);
        if (!stored) return;
        setSession(stored);
        try {
          const { user } = await api.get<{ user: User }>('/api/auth/me');
          if (
            active &&
            api.getSession()?.serverUrl === stored.serverUrl &&
            api.getSession()?.user.id === stored.user.id
          )
            await establish({ ...api.getSession()!, user });
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            const latest = await readSession();
            if (
              active &&
              latest?.serverUrl === stored.serverUrl &&
              latest.user.id === stored.user.id &&
              latest.refreshToken === api.getSession()?.refreshToken
            )
              await establish(null);
          }
        }
      } finally {
        if (active) setReady(true);
      }
    })().catch(() => setReady(true));
    return () => {
      active = false;
      stopWatching();
    };
  }, []);
  async function signOut() {
    await withSessionLock(async () => {
      const stored = await readSession();
      const current = api.getSession();
      if (
        stored &&
        current &&
        (stored.serverUrl !== current.serverUrl || stored.user.id !== current.user.id)
      )
        throw new Error('Your session changed. Please try again.');
      const token = stored?.refreshToken ?? current?.refreshToken;
      // Revoke remotely first so a failed request can be retried by the user.
      if (token)
        await api.request(
          '/api/auth/sign-out',
          { method: 'POST', body: JSON.stringify({ refreshToken: token }) },
          false,
        );
      await establish(null);
    });
  }
  return (
    <Context.Provider
      value={{
        session,
        ready,
        serverUrl,
        configureServer: async (input) => {
          if (api.getSession()) throw new Error('Sign out before changing servers.');
          const url = normalizeServerUrl(input);
          await writeServerUrl(url);
          api.baseUrl = url;
          setServerUrl(url);
          return url;
        },
        establish,
        signOut,
        updateUser: async (user) => {
          const current = api.getSession();
          // Profile routes may return extra database fields. Persist public fields only.
          if (current)
            await establish({
              ...current,
              user: {
                id: user.id,
                email: user.email,
                name: user.name,
                username: user.username ?? null,
                avatarKey: user.avatarKey ?? null,
              },
            });
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);
