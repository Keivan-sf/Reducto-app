import { AppViewport } from '../components/AppViewport';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSession } from '../context/SessionContext';
import AuthScreen from '../features/auth/AuthScreen';
import { groupJoinPath, INVITE_TOKEN } from '../lib/links';
export default function LoginRoute() {
  const { session } = useSession();
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const token = typeof invite === 'string' && INVITE_TOKEN.test(invite) ? invite : undefined;
  return session ? (
    <Redirect href={token ? groupJoinPath(token) : '/'} />
  ) : (
    <AppViewport>
      <AuthScreen inviteToken={token} />
    </AppViewport>
  );
}
