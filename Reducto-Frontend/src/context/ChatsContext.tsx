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
import type { Conversation, Emoji, Member, Message, ProfileUpdatedEvent } from '../api/types';
import { api, useSession } from './SessionContext';
import { MessageCache } from '../api/message-cache';
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
  refresh: (queue?: boolean) => Promise<void>;
  loadMessages: (id: string, older?: boolean, force?: boolean) => Promise<void>;
  messageCache: MessageCache;
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
  const [messageCache] = useState(
    () =>
      new MessageCache(
        (path) => api.get(path),
        (id, history) => setMessages((current) => ({ ...current, [id]: history })),
        (history) => {
          void directory.getMany(
            history.flatMap((message) => [message.senderId, message.forwardedFrom?.senderId ?? '']),
          );
        },
      ),
  );
  const lastRefreshAt = useRef(0);
  const refreshSequence = useRef(0);
  const refreshFlight = useRef<Promise<void> | null>(null);
  const refreshQueued = useRef(false);
  const knownChats = useRef(new Set<string>());
  const activate = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveId(id);
    if (id) setUnread((current) => ({ ...current, [id]: 0 }));
  }, []);
  const acceptMessage = useCallback(
    (message: Message) => messageCache.accept(message),
    [messageCache],
  );
  const loadMessages = useCallback(
    (id: string, older = false, force = false) => messageCache.page(id, older, force),
    [messageCache],
  );
  const refresh = useCallback(
    (queue = false) => {
      if (refreshFlight.current) {
        if (queue) refreshQueued.current = true;
        return refreshFlight.current;
      }
      const task = (async () => {
        do {
          refreshQueued.current = false;
          const sequence = ++refreshSequence.current;
          const { conversations: chats } = await api.get<{ conversations: Conversation[] }>(
            '/api/conversations',
          );
          if (sequence !== refreshSequence.current) return;
          setConversations(chats);
          const allowed = new Set(chats.map((chat) => chat.id));
          knownChats.current = allowed;
          messageCache.prune(allowed);
          setMessages((current) =>
            Object.fromEntries(Object.entries(current).filter(([id]) => allowed.has(id))),
          );
          if (activeRef.current && !allowed.has(activeRef.current)) activate(null);
          const outcomes = await Promise.allSettled(
            chats.map(async (chat) => {
              const [, people] = await Promise.all([
                loadMessages(chat.id, false, true),
                api.get<{ members: Member[] }>(`/api/conversations/${chat.id}/members`),
              ]);
              return { id: chat.id, people };
            }),
          );
          if (sequence !== refreshSequence.current) return;
          let failed = false;
          for (const outcome of outcomes) {
            if (outcome.status === 'fulfilled') {
              const { id, people } = outcome.value;
              void directory.getMany(people.members.map((member) => member.userId));
              setMembers((current) => ({ ...current, [id]: people.members }));
            } else failed = true;
          }
          lastRefreshAt.current = Date.now();
          setError(failed ? 'Some conversations could not be synced. Refresh to try again.' : '');
        } while (refreshQueued.current);
      })().finally(() => {
        refreshFlight.current = null;
      });
      refreshFlight.current = task;
      return task;
    },
    [activate, directory, messageCache, loadMessages],
  );
  useEffect(() => {
    if (!token || !userId) return;
    let alive = true;
    let connectedOnce = false;
    const report = (err: Error) => {
      if (alive) setError(err.message);
    };
    const sync = (queue = false) => {
      void refresh(queue)
        .catch(report)
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    // Keep realtime delivery on the selected server alongside cached HTTP history.
    const socket = io(api.baseUrl, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => {
      setConnection('Connected');
      void directory.refreshKnown(true);
      if (connectedOnce || Date.now() - lastRefreshAt.current > 5000) sync(connectedOnce);
      connectedOnce = true;
    });
    socket.on('user.profile_updated', (event: ProfileUpdatedEvent) => {
      void directory.refreshUser(event.userId).catch(report);
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
        messageCache.reaction(event);
      },
    );
    for (const event of [
      'conversation.updated',
      'conversation.deleted',
      'group.member_joined',
      'group.member_left',
      'group.role_changed',
    ])
      socket.on(event, () => sync(true));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync(true);
    });
    sync();
    return () => {
      alive = false;
      socket.disconnect();
      subscription.remove();
    };
  }, [token, userId, acceptMessage, refresh, directory, messageCache]);
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
        hasOlder: (id) => messageCache.hasOlder(id),
        messageCache,
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
