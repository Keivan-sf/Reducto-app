import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import type { Conversation, Emoji, Member, Message, MessagePage } from '../api/types';
import { api, useSession } from './SessionContext';
import { mergeMessages } from '../lib/messages';
import { useProfiles } from './ProfilesContext';

interface ChatsState {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  members: Record<string, Member[]>;
  unread: Record<string, number>;
  loading: boolean;
  connection: string;
  error: string;
  setError: (error: string) => void;
  refresh: () => Promise<void>;
  loadMessages: (id: string, older?: boolean) => Promise<void>;
  hasOlder: (id: string) => boolean;
  acceptMessage: (message: Message) => void;
  activeId: string | null;
  activate: (id: string | null) => void;
}
const Context = createContext<ChatsState>(null!);
export function ChatsProvider({ children }: PropsWithChildren) {
  const { session } = useSession();
  const { directory } = useProfiles();
  const token = session?.accessToken;
  const userId = session?.user.id;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState('Connecting');
  const [error, setError] = useState('');
  const activeRef = useRef<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const cursors = useRef<Record<string, string | null>>({});
  const refreshSequence = useRef(0);
  const knownChats = useRef(new Set<string>());
  const activate = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveId(id);
    if (id) setUnread((current) => ({ ...current, [id]: 0 }));
  }, []);
  const acceptMessage = useCallback(
    (message: Message) => {
      void directory.getMany([message.senderId, message.forwardedFrom?.senderId ?? '']);
      setMessages((current) => ({
        ...current,
        [message.conversationId]: mergeMessages(current[message.conversationId] ?? [], [message]),
      }));
    },
    [directory],
  );
  const loadMessages = useCallback(
    async (id: string, older = false) => {
      const cursor = older ? cursors.current[id] : undefined;
      if (older && !cursor) return;
      const page = await api.get<MessagePage>(
        `/api/conversations/${id}/messages?limit=50${cursor ? `&before=${cursor}` : ''}`,
      );
      void directory.getMany(
        page.messages.flatMap((message) => [
          message.senderId,
          message.forwardedFrom?.senderId ?? '',
        ]),
      );
      // Refreshing the newest page must not overwrite the older-history cursor.
      if (older || !(id in cursors.current)) cursors.current[id] = page.nextCursor;
      setMessages((current) => ({
        ...current,
        [id]: mergeMessages(current[id] ?? [], page.messages),
      }));
    },
    [directory],
  );
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const { conversations: chats } = await api.get<{ conversations: Conversation[] }>(
      '/api/conversations',
    );
    if (sequence !== refreshSequence.current) return;
    setConversations(chats);
    const allowed = new Set(chats.map((chat) => chat.id));
    knownChats.current = allowed;
    setMessages((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => allowed.has(id))),
    );
    if (activeRef.current && !allowed.has(activeRef.current)) activate(null);
    const outcomes = await Promise.allSettled(
      chats.map(async (chat) => {
        const [page, people] = await Promise.all([
          api.get<MessagePage>(`/api/conversations/${chat.id}/messages?limit=50`),
          api.get<{ members: Member[] }>(`/api/conversations/${chat.id}/members`),
        ]);
        return { id: chat.id, page, people };
      }),
    );
    if (sequence !== refreshSequence.current) return;
    let failed = false;
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') {
        const { id, page, people } = outcome.value;
        void directory.getMany([
          ...people.members.map((member) => member.userId),
          ...page.messages.flatMap((message) => [
            message.senderId,
            message.forwardedFrom?.senderId ?? '',
          ]),
        ]);
        // Reconnects can reveal an offline gap; pagination starts at the new page.
        cursors.current[id] = page.nextCursor;
        setMessages((current) => ({
          ...current,
          [id]: mergeMessages(current[id] ?? [], page.messages),
        }));
        setMembers((current) => ({ ...current, [id]: people.members }));
      } else failed = true;
    }
    setError(failed ? 'Some conversations could not be synced. Refresh to try again.' : '');
  }, [activate, directory]);
  useEffect(() => {
    if (!token || !userId) return;
    let alive = true;
    const report = (err: Error) => {
      if (alive) setError(err.message);
    };
    const sync = () => {
      void refresh()
        .catch(report)
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    // WebSocket transport avoids the reference server's missing polling CORS headers.
    const socket = io(api.baseUrl, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => {
      setConnection('Connected');
      sync();
    });
    socket.on('disconnect', (reason) => {
      setConnection('Reconnecting');
      if (reason === 'io server disconnect')
        void api
          .refresh()
          .then(() => {
            if (alive) {
              socket.auth = { token: api.getSession()?.accessToken };
              socket.connect();
            }
          })
          .catch(report);
    });
    socket.on('connect_error', (err: Error) => {
      setConnection('Offline');
      if (err.message === 'Unauthorized')
        void api
          .refresh()
          .then(() => {
            if (alive) {
              socket.auth = { token: api.getSession()?.accessToken };
              socket.connect();
            }
          })
          .catch(report);
    });
    socket.on('message.created', ({ message }: { message: Message }) => {
      acceptMessage(message);
      if (message.senderId !== userId && activeRef.current !== message.conversationId) {
        setUnread((current) => ({
          ...current,
          [message.conversationId]: (current[message.conversationId] ?? 0) + 1,
        }));
      }
      if (!knownChats.current.has(message.conversationId)) sync();
    });
    socket.on(
      'message.reaction_changed',
      (event: {
        conversationId: string;
        messageId: string;
        userId: string;
        emoji: Emoji;
        removed: boolean;
      }) => {
        setMessages((current) => ({
          ...current,
          [event.conversationId]: (current[event.conversationId] ?? []).map((message) => {
            if (message.id !== event.messageId) return message;
            const reactions = (message.reactions ?? []).filter(
              (reaction) => !(reaction.userId === event.userId && reaction.emoji === event.emoji),
            );
            if (!event.removed)
              reactions.push({
                userId: event.userId,
                emoji: event.emoji,
                messageId: event.messageId,
              });
            return { ...message, reactions };
          }),
        }));
      },
    );
    for (const event of [
      'conversation.updated',
      'conversation.deleted',
      'group.member_joined',
      'group.member_left',
      'group.role_changed',
    ])
      socket.on(event, sync);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    sync();
    return () => {
      alive = false;
      socket.disconnect();
      subscription.remove();
    };
  }, [token, userId, acceptMessage, refresh]);
  return (
    <Context.Provider
      value={{
        conversations,
        messages,
        members,
        unread,
        loading,
        connection,
        error,
        setError,
        refresh,
        loadMessages,
        hasOlder: (id) => !!cursors.current[id],
        acceptMessage,
        activeId,
        activate,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useChats = () => useContext(Context);
