import { Redirect } from 'expo-router';
import { useSession } from '../context/SessionContext';
import AuthScreen from '../features/auth/AuthScreen';
export default function LoginRoute() {
  const { session } = useSession();
  return session ? <Redirect href="/" /> : <AuthScreen />;
}
