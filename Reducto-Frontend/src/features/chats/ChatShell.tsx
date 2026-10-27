import { useTheme } from '../../context/ThemeContext';
import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import ChatList from './ChatList';
import ChatView from './ChatView';
import { RetainedLayer } from '../../components/RetainedLayer';
import { useChats } from '../../context/ChatsContext';

export default function ChatShell({ id, active }: { id?: string; active: boolean }) {
  const { colors } = useTheme();
  const wide = useWindowDimensions().width >= 850;
  const { conversations } = useChats();
  const [searchConversation, setSearchConversation] = useState<string | null>(null);
  const sidebarVisible = wide && searchConversation !== id;
  const [visited, setVisited] = useState<string[]>([]);
  if (id && !visited.includes(id)) setVisited([...visited, id]);
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.surface }}>
      <RetainedLayer
        active={active && (sidebarVisible || !id)}
        style={
          wide
            ? {
                width: 360,
                right: undefined,
                borderRightWidth: 1,
                borderRightColor: colors.border,
              }
            : undefined
        }
      >
        <ChatList showVoicePlayer={!id} />
      </RetainedLayer>
      <View style={{ flex: 1, marginLeft: sidebarVisible ? 360 : 0 }}>
        <RetainedLayer active={active && wide && !id}>
          <ChatView active={false} />
        </RetainedLayer>
        {visited
          .filter((chatId) => chatId === id || conversations.some((chat) => chat.id === chatId))
          .map((chatId) => (
            <RetainedLayer
              key={chatId}
              testID={`conversation-${chatId}`}
              active={active && id === chatId}
            >
              <ChatView
                id={chatId}
                active={active && id === chatId}
                onSearchVisibilityChange={(open) =>
                  setSearchConversation((current) =>
                    open ? chatId : current === chatId ? null : current,
                  )
                }
              />
            </RetainedLayer>
          ))}
      </View>
    </View>
  );
}
