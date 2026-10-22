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
import type {
  Conversation,
  Emoji,
  Member,
  Message,
  ProfileUpdatedEvent,
  SeenState,
} from '../api/types';
import { api, useSession } from './SessionContext';
import { MessageCache } from '../api/message-cache';
import { useProfiles } from './ProfilesContext';
import { ReadState } from '../api/read-state';

interface ChatsState {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  latestMessages: Record<string, Message | null>;
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
  hasNewer: (id: string) => boolean;
  acceptMessage: (message: Message) => void;
  activeId: string | null;
  activate: (id: string | null) => void;
  readVisible: (
    id: string,
    visible: Message[],
    window: Message[],
    hasBefore: boolean,
    hasAfter: boolean,
  ) => void;
  getReadState: (id: string) => SeenState | undefined;
}
const Context = createContext<ChatsState>(null!);
export function ChatsProvider({ children }: PropsWithChildren) {
  const { session } = useSession();
  const { directory } = useProfiles();
  const token = session?.accessToken;
  const userId = session?.user.id;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [latestMessages, setLatestMessages] = useState<Record<string, Message | null>>({});
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState('Connecting');
  const [error, setError] = useState('');
  const activeRef = useRef<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [readState] = useState(() => {
    const owner = api.getSession()!;
    return new ReadState(async (id, messageId, signal) => {
      const current = api.getSession();
      if (!current || current.user.id !== owner.user.id || current.serverUrl !== owner.serverUrl)
        throw new Error('Your session changed.');
      return api.request<SeenState>(`/api/conversations/${encodeURIComponent(id)}/seen`, {
        method: 'PUT',
        body: JSON.stringify({ messageId }),
        signal,
      });
    }, setUnread);
  });
  useEffect(() => () => readState.dispose(), [readState]);
  const [messageCache] = useState(
    () =>
      new MessageCache(
        (path) => api.get(path),
        (id, history) => setMessages((current) => ({ ...current, [id]: history })),
        (history) => {
          for (const message of history) readState.remember(message.conversationId, [message]);
          void directory.getMany(
            history.flatMap((message) => [message.senderId, message.forwardedFrom?.senderId ?? '']),
          );
        },
        (id, message) => setLatestMessages((current) => ({ ...current, [id]: message })),
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
  }, []);
  const acceptMessage = useCallback(
    (message: Message) => {
      readState.created(message);
      messageCache.accept(message);
    },
    [messageCache, readState],
  );
  const readVisible = useCallback(
    (id: string, visible: Message[], window: Message[], hasBefore: boolean, hasAfter: boolean) => {
      if (activeRef.current === id && AppState.currentState === 'active')
        readState.view(id, visible, window, hasBefore, hasAfter);
    },
    [readState],
  );
  const getReadState = useCallback((id: string) => readState.peek(id), [readState]);
  const conversationFlight = useRef<Promise<Conversation[]> | null>(null);
  const fetchConversations = useCallback(() => {
    if (conversationFlight.current) return conversationFlight.current;
    const version = readState.version();
    const task = api
      .get<{ conversations: Conversation[] }>('/api/conversations')
      .then(({ conversations: chats }) => {
        readState.sync(chats, version);
        setConversations(chats);
        return chats;
      })
      .finally(() => {
        conversationFlight.current = null;
      });
    conversationFlight.current = task;
    return task;
  }, [readState]);
  const loadMessages = useCallback(
    async (id: string, older = false, force = false) => {
      if (!readState.peek(id)) await fetchConversations();
      if (older) await messageCache.extend(id, true);
      else if (force && messageCache.isOpen(id)) await messageCache.refresh(id);
      else await messageCache.open(id, readState.peek(id)?.lastSeenMessageId ?? null);
    },
    [messageCache, readState, fetchConversations],
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
          const chats = await fetchConversations();
          if (sequence !== refreshSequence.current) return;
          const allowed = new Set(chats.map((chat) => chat.id));
          knownChats.current = allowed;
          messageCache.prune(allowed);
          setMessages((current) =>
            Object.fromEntries(Object.entries(current).filter(([id]) => allowed.has(id))),
          );
          setLatestMessages((current) =>
            Object.fromEntries(Object.entries(current).filter(([id]) => allowed.has(id))),
          );
          if (activeRef.current && !allowed.has(activeRef.current)) activate(null);
          const [outcomes, previews] = await Promise.all([
            Promise.allSettled(
              chats.map(async (chat) => {
                const people = await api.get<{ members: Member[] }>(
                  `/api/conversations/${chat.id}/members`,
                );
                return { id: chat.id, people };
              }),
            ),
            Promise.allSettled(chats.map((chat) => messageCache.loadLatest(chat.id, true))),
          ]);
          if (sequence !== refreshSequence.current) return;
          let failed = previews.some((outcome) => outcome.status === 'rejected');
          for (const outcome of outcomes) {
            if (outcome.status === 'fulfilled') {
              const { id, people } = outcome.value;
              void directory.getMany(people.members.map((member) => member.userId));
              setMembers((current) => ({ ...current, [id]: people.members }));
            } else failed = true;
          }
          const active = activeRef.current;
          if (active && allowed.has(active) && messageCache.isOpen(active))
            await messageCache.refresh(active);
          lastRefreshAt.current = Date.now();
          setError(failed ? 'Some conversations could not be synced. Refresh to try again.' : '');
        } while (refreshQueued.current);
      })().finally(() => {
        refreshFlight.current = null;
      });
      refreshFlight.current = task;
      return task;
    },
    [activate, directory, messageCache, fetchConversations],
  );
  useEffect(() => {
    if (!token || !userId) return;
    let alive = true;
    let connectedOnce = false;
    let readRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    const syncReads = () => {
      if (alive && AppState.currentState === 'active') void fetchConversations().catch(() => {});
    };
    const readPoll = setInterval(syncReads, 10000);
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
      clearTimeout(readRefreshTimer);
      readRefreshTimer = setTimeout(syncReads, 500);
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
      clearTimeout(readRefreshTimer);
      clearInterval(readPoll);
    };
  }, [token, userId, acceptMessage, refresh, directory, messageCache, fetchConversations]);
  return (
    <Context.Provider
      value={{
        conversations,
        messages,
        latestMessages,
        members,
        unread,
        loading,
        connection,
        error,
        setError,
        refresh,
        loadMessages,
        hasOlder: (id) => messageCache.hasOlder(id),
        hasNewer: (id) => messageCache.hasNewer(id),
        messageCache,
        acceptMessage,
        activeId,
        activate,
        readVisible,
        getReadState,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useChats = () => useContext(Context);
