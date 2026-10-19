import { useLocalSearchParams } from 'expo-router';
import ChatShell from '../../../features/chats/ChatShell';
export default function ConversationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatShell id={id} />;
}
