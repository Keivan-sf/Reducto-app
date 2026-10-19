import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { UserDirectory } from '../api/user-directory';
import type { UserProfile } from '../api/types';
import { api, useSession } from './SessionContext';

const Context = createContext<{ profiles: Record<string, UserProfile>; directory: UserDirectory }>(
  null!,
);
export function ProfilesProvider({ children }: PropsWithChildren) {
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [directory] = useState(
    () =>
      new UserDirectory(
        (path) => api.get<{ user: UserProfile }>(path),
        (user) => setProfiles((current) => ({ ...current, [user.id]: user })),
      ),
  );
  const { session } = useSession();
  const ownId = session?.user.id;
  const ownName = session?.user.name;
  const ownUsername = session?.user.username;
  const ownAvatar = session?.user.avatarKey;
  useEffect(() => {
    if (!ownId) return;
    // Refresh the signed image URL after profile edits as well as initial sign-in.
    void directory.refreshUser(ownId).catch(() => {});
  }, [directory, ownId, ownName, ownUsername, ownAvatar]);
  useEffect(() => {
    const renew = () => {
      void directory.refreshKnown();
    };
    const timer = setInterval(renew, 60000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void directory.refreshKnown(true);
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [directory]);
  return <Context.Provider value={{ profiles, directory }}>{children}</Context.Provider>;
}
export const useProfiles = () => useContext(Context);
