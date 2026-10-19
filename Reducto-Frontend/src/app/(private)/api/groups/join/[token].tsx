import { useLocalSearchParams } from 'expo-router';
import JoinGroupScreen from '../../../../../features/chats/JoinGroupScreen';
export default function JoinGroupRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <JoinGroupScreen token={token} />;
}
