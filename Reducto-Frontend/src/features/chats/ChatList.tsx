import { useTheme, createThemedStyles } from '../../context/ThemeContext';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
} from 'react-native';
import { router } from 'expo-router';
import { Avatar, Icon, IconButton, Notice, useUIStyles } from '../../components/ui';
import { useSession } from '../../context/SessionContext';
import { useChats } from '../../context/ChatsContext';
import { conversationName, preview, timeLabel } from '../../lib/messages';
import { NewChatDialog } from './NewChatDialog';
import { VoiceMiniPlayer } from './VoiceMiniPlayer';
import { useProfiles } from '../../context/ProfilesContext';
import { MentionIcon } from '../../components/MentionIcon';
import { ChatHistoryScrollView } from './ChatHistoryScrollView';

function renderChatListScroll(props: ScrollViewProps) {
  return (
    <ChatHistoryScrollView
      {...props}
      scrollbarInverted={false}
      scrollbarLabel="Conversation list scrollbar"
    />
  );
}

export default function ChatList({
  showVoicePlayer = true,
  activeChatId,
}: {
  showVoicePlayer?: boolean;
  activeChatId?: string;
}) {
  const { colors } = useTheme();
  const s = useStyles();
  const styles = useUIStyles();
  const { session } = useSession();
  const { profiles, directory } = useProfiles();
  const {
    conversations,
    latestMessages,
    outgoing,
    members,
    unread,
    loading,
    connection,
    error,
    setError,
    refresh,
  } = useChats();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All chats');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selection, setSelection] = useState({ routeId: activeChatId, id: activeChatId });
  const navigationFrame = useRef<number | null>(null);
  // Follow back/deep-link navigation while allowing immediate feedback on list clicks.
  if (selection.routeId !== activeChatId) {
    setSelection({ routeId: activeChatId, id: activeChatId });
  }
  useEffect(
    () => () => {
      if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current);
    },
    [activeChatId],
  );
  function openChat(id: string) {
    setSelection({ routeId: activeChatId, id });
    if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current);
    // Let the selected row paint before mounting and loading the conversation.
    navigationFrame.current = requestAnimationFrame(() => {
      navigationFrame.current = requestAnimationFrame(() => {
        navigationFrame.current = null;
        router.push(`/chat/${id}`);
      });
    });
  }
  function peer(chat: (typeof conversations)[number]) {
    const id = members[chat.id]?.find((member) => member.userId !== session!.user.id)?.userId;
    return chat.type === 'private' && id ? profiles[id] : undefined;
  }
  function title(chat: (typeof conversations)[number]) {
    return conversationName(chat, peer(chat));
  }
  function lastMessage(id: string) {
    const local = outgoing[id]?.at(-1);
    const server = latestMessages[id];
    if (!local) return server;
    if (!server) return local;
    return local.createdAt > server.createdAt ? local : server;
  }
  const chats = conversations
    .filter(
      (chat) =>
        `${title(chat)} @${peer(chat)?.username ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter !== 'Groups' || chat.type === 'group') &&
        (filter !== 'Unread' || unread[chat.id] > 0),
    )
    .sort((a, b) =>
      (lastMessage(b.id)?.createdAt ?? b.createdAt).localeCompare(
        lastMessage(a.id)?.createdAt ?? a.createdAt,
      ),
    );
  async function reload() {
    setRefreshing(true);
    try {
      await refresh();
      await directory.refreshKnown(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <View style={s.root}>
      <View style={s.header}>
        <View style={s.brand}>
          <Icon name="paper-plane" color={colors.blue} size={25} />
          <Text style={s.brandText}>Reducto</Text>
        </View>
        <IconButton
          name="settings-outline"
          label="Settings"
          onPress={() => router.push('/settings')}
        />
      </View>
      <View style={s.search}>
        <Icon name="search-outline" size={19} />
        <TextInput
          accessibilityLabel="Search conversations"
          placeholder="Search conversations"
          value={query}
          onChangeText={setQuery}
          placeholderTextColor="#95A2AF"
          style={s.searchInput}
        />
      </View>
      <View style={s.tabs}>
        {['All chats', 'Unread', 'Groups'].map((tab) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === filter }}
            key={tab}
            onPress={() => setFilter(tab)}
            style={[s.tab, filter === tab && s.activeTab]}
          >
            <Text
              style={{
                color: tab === filter ? colors.blue : colors.muted,
                fontSize: 13,
                fontWeight: '600',
              }}
            >
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>
      {showVoicePlayer && <VoiceMiniPlayer />}
      <Notice text={error} onDismiss={() => setError('')} />
      <FlatList
        testID="conversation-list"
        renderScrollComponent={renderChatListScroll}
        data={chats}
        keyExtractor={(chat) => chat.id}
        refreshing={refreshing}
        onRefresh={() => void reload()}
        contentContainerStyle={{ flexGrow: 1 }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 60 }} color={colors.blue} />
          ) : (
            <View style={s.empty}>
              <Icon name="chatbubbles-outline" color="#B6C9DC" size={48} />
              <Text style={[styles.title, { fontSize: 17 }]}>
                {query
                  ? 'No conversations found'
                  : filter !== 'All chats'
                    ? `No ${filter.toLowerCase()} yet`
                    : 'Your next hello starts here'}
              </Text>
              <Text style={[styles.subtitle, { textAlign: 'center' }]}>
                {query
                  ? 'Try a different search.'
                  : 'Start a private chat or make a group for your people.'}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => setCreating(true)}>
                <Text style={{ color: colors.blue, fontWeight: '600', padding: 12 }}>
                  Start a conversation
                </Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item: chat }) => {
          const last = lastMessage(chat.id);
          const selected = selection.id === chat.id;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${title(chat)}`}
              accessibilityState={{ selected }}
              aria-selected={selected}
              onPress={() => openChat(chat.id)}
              style={[s.row, selected && s.selected]}
            >
              <Avatar
                name={title(chat)}
                uri={peer(chat)?.avatarUrl ?? undefined}
                size={52}
                online={peer(chat)?.online}
                badgeBorderColor={colors.surface}
              />
              <View style={{ flex: 1, gap: 7 }}>
                <View style={s.rowLine}>
                  <Text numberOfLines={1} style={s.chatName}>
                    {title(chat)}
                  </Text>
                  <Text style={s.time}>{last ? timeLabel(last.createdAt) : ''}</Text>
                </View>
                <View style={s.rowLine}>
                  <Text testID={`preview-${chat.id}`} numberOfLines={1} style={s.preview}>
                    {last?.senderId === session!.user.id ? 'You: ' : ''}
                    {last ? preview(last) : last === null ? preview() : ''}
                  </Text>
                  {!!chat.unseenMentions?.length && (
                    <View
                      testID={`mentions-${chat.id}`}
                      accessibilityLabel={`${chat.unseenMentions.length} unseen mentions`}
                      style={s.mention}
                    >
                      <MentionIcon />
                    </View>
                  )}
                  {!!unread[chat.id] && (
                    <View
                      testID={`unread-${chat.id}`}
                      accessibilityLabel={`${unread[chat.id]} unread messages`}
                      style={[s.badge, selected && { backgroundColor: colors.surface }]}
                    >
                      <Text
                        style={{
                          color: selected ? colors.blue : 'white',
                          fontSize: 11,
                          fontWeight: '600',
                        }}
                      >
                        {unread[chat.id]}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      <View style={s.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${connection}. Refresh conversations`}
          accessibilityState={{ busy: refreshing, disabled: refreshing }}
          disabled={refreshing}
          onPress={() => void reload()}
          style={s.connectionStatus}
        >
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: connection === 'Connected' ? '#5CBC80' : '#D7AC62',
            }}
          />
          <Text style={{ color: colors.muted, fontSize: 11 }}>{connection}</Text>
          {refreshing ? (
            <ActivityIndicator size={14} color={colors.muted} />
          ) : (
            <Icon name="refresh-outline" size={14} color={colors.muted} />
          )}
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New conversation"
        onPress={() => setCreating(true)}
        style={s.compose}
      >
        <Icon name="create-outline" color="white" />
      </Pressable>
      <NewChatDialog visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}
const useStyles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    height: 78,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandText: { fontSize: 25, fontWeight: '700', color: colors.dark, letterSpacing: -1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.pale,
    borderRadius: 12,
    paddingHorizontal: 13,
    marginHorizontal: 20,
    height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.dark, height: '100%', outlineWidth: 0 },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 24,
    borderBottomWidth: 1,
    borderColor: colors.border,
    marginTop: 12,
  },
  tab: { paddingVertical: 15, borderBottomWidth: 3, borderColor: 'transparent' },
  activeTab: { borderColor: colors.blue },
  row: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    alignItems: 'center',
    minHeight: 80,
  },
  selected: { backgroundColor: colors.selectedChat },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  chatName: { flex: 1, color: colors.dark, fontSize: 15, fontWeight: '600' },
  time: { color: colors.timestamp, fontSize: 11 },
  preview: { color: colors.muted, fontSize: 13, flex: 1 },
  mention: {
    width: 21,
    height: 21,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    backgroundColor: colors.blue,
    borderRadius: 12,
    minWidth: 21,
    height: 21,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 15 },
  footer: {
    height: 56,
    borderTopWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  connectionStatus: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  compose: {
    position: 'absolute',
    right: 20,
    bottom: 34,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
}));
