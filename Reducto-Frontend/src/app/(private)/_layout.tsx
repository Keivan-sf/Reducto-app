import { Redirect, Slot } from 'expo-router';
import { useSession } from '../../context/SessionContext';
import { ChatsProvider } from '../../context/ChatsContext';
import { ProfilesProvider } from '../../context/ProfilesContext';
export default function PrivateLayout() {
  const { session } = useSession();
  return session ? (
    <ProfilesProvider key={session.user.id}>
      <ChatsProvider>
        <Slot />
      </ChatsProvider>
    </ProfilesProvider>
  ) : (
    <Redirect href="/login" />
  );
}
