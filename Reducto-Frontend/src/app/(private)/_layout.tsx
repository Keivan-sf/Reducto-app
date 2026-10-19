import { Redirect, Slot } from 'expo-router';
import { useSession } from '../../context/SessionContext';
import { ChatsProvider } from '../../context/ChatsContext';
export default function PrivateLayout() {
  const { session } = useSession();
  return session ? (
    <ChatsProvider key={session.user.id}>
      <Slot />
    </ChatsProvider>
  ) : (
    <Redirect href="/login" />
  );
}
