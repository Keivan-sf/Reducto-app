import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { ApiClient, ApiError } from '../api/client';
import type { Session, User } from '../api/types';
import { API_URL } from '../lib/config';
import {
  readSession,
  writeSession,
  sessionCoordination,
  withSessionLock,
  watchStoredSession,
} from '../lib/storage';

export const api = new ApiClient(API_URL, sessionCoordination);
interface SessionState {
  session: Session | null;
  ready: boolean;
  establish: (session: Session | null) => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  signOut: () => Promise<void>;
}
const Context = createContext<SessionState>(null!);
export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  async function establish(next: Session | null) {
    api.setSession(next);
    setSession(next);
    await writeSession(next);
  }
  useEffect(() => {
    api.onSession = establish;
    let active = true;
    const stopWatching = watchStoredSession((next) => {
      api.setSession(next);
      setSession(next);
    });
    void (async () => {
      try {
        const stored = await readSession();
        if (!active || !stored) return;
        api.setSession(stored);
        setSession(stored);
        try {
          const { user } = await api.get<{ user: User }>('/api/auth/me');
          if (active && api.getSession()?.user.id === stored.user.id)
            await establish({ ...api.getSession()!, user });
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) await establish(null);
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
      const token = (await readSession())?.refreshToken ?? api.getSession()?.refreshToken;
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
