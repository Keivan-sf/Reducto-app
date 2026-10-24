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
  MessageUpdatedEvent,
  ProfileUpdatedEvent,
  SeenState,
} from '../api/types';
import { api, useSession } from './SessionContext';
import { ConversationList } from '../api/conversation-list';
import { MessageCache } from '../api/message-cache';
import { useProfiles } from './ProfilesContext';
import { ReadState } from '../api/read-state';
import { MessageOutbox } from '../api/message-outbox';
import { advanceReceipt, type ReceiptPositions } from '../api/receipts';

interface ChatsState {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  outgoing: Record<string, Message[]>;
  outbox: MessageOutbox;
  latestMessages: Record<string, Message | null>;
  members: Record<string, Member[]>;
  receiptPositions: ReceiptPositions;
  unread: Record<string, number>;
  loading: boolean;
  connection: string;
  error: string;
  setError: (error: string) => void;
  refresh: (queue?: boolean) => Promise<void>;
  removeConversation: (id: string) => void;
  loadConversation: (id: string, temporary?: boolean) => Promise<void>;
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
  const [outgoing, setOutgoing] = useState<Record<string, Message[]>>({});
  const [latestMessages, setLatestMessages] = useState<Record<string, Message | null>>({});
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [receiptPositions, setReceiptPositions] = useState<ReceiptPositions>({});
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
  const [conversationList] = useState(() => new ConversationList());
  const lastRefreshAt = useRef(0);
  const memberIds = useRef(new Map<string, Set<string>>());
  const resolveReceipt = useCallback(
    async (id: string, memberId: string, messageId: string) => {
      const marker =
        messageCache.peek(id, messageId) ??
        (
          await api.get<{ message: Message }>(
            `/api/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`,
          )
        ).message;
      if (marker?.id === messageId)
        setReceiptPositions((current) =>
          memberIds.current.get(id)?.has(memberId) === false
            ? current
            : advanceReceipt(current, id, memberId, marker),
        );
    },
    [messageCache],
  );
  const refreshSequence = useRef(0);
  const refreshFlight = useRef<Promise<void> | null>(null);
  const refreshQueued = useRef(false);
  const activate = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveId(id);
  }, []);
  const acceptMessage = useCallback(
    (message: Message) => {
      readState.created(message);
      if (message.senderId === userId) readState.sent(message);
      messageCache.accept(message);
    },
    [messageCache, readState, userId],
  );
  const [outbox] = useState(() => {
    const owner = api.getSession()!;
    return new MessageOutbox(
      owner.user.id,
      async (id, payload, signal) => {
        const current = api.getSession();
        if (!current || current.user.id !== owner.user.id || current.serverUrl !== owner.serverUrl)
          throw new Error('Your session changed.');
        const { message } = await api.request<{ message: Message }>(
          `/api/conversations/${id}/messages`,
          {
            method: 'POST',
            body: JSON.stringify(payload),
            signal,
          },
        );
        return message;
      },
      acceptMessage,
      setOutgoing,
    );
  });
  useEffect(() => () => outbox.dispose(), [outbox]);
  useEffect(() => outbox.reconcile(messages), [outbox, messages]);
  const readVisible = useCallback(
    (id: string, visible: Message[], window: Message[], hasBefore: boolean, hasAfter: boolean) => {
      if (activeRef.current === id && AppState.currentState === 'active')
        readState.view(id, visible, window, hasBefore, hasAfter);
    },
    [readState],
  );
  const getReadState = useCallback((id: string) => readState.peek(id), [readState]);
  const loadMembers = useCallback(
    async (id: string) => {
      const version = readState.version();
      const { members: people } = await api.get<{ members: Member[] }>(
        `/api/conversations/${encodeURIComponent(id)}/members`,
      );
      const chat = conversationList.values().find((chat) => chat.id === id);
      if (!chat) return;
      const self = people.find((member) => member.userId === userId);
      if (self?.lastSeenMessageId !== undefined)
        readState.sync(
          [{ ...chat, lastSeenMessageId: self.lastSeenMessageId, unreadCount: undefined }],
          version,
          false,
        );
      memberIds.current.set(id, new Set(people.map((member) => member.userId)));
      setMembers((current) => ({ ...current, [id]: people }));
      void directory.getMany(people.map((member) => member.userId));
      setReceiptPositions((current) => ({
        ...current,
        [id]: Object.fromEntries(
          Object.entries(current[id] ?? {}).filter(([memberId]) =>
            people.some((member) => member.userId === memberId),
          ),
        ),
      }));
      for (const member of people)
        if (member.userId !== userId && member.lastSeenMessageId)
          void resolveReceipt(id, member.userId, member.lastSeenMessageId).catch(() => {});
    },
    [conversationList, directory, readState, resolveReceipt, userId],
  );
  const detailFlights = useRef(new Map<string, Promise<void>>());
  const loadConversation = useCallback(
    (id: string, temporary = false) => {
      const existing = detailFlights.current.get(id);
      if (existing) return existing;
      const version = readState.version();
      const listVersion = conversationList.version();
      const task = api
        .get<{ conversation: Conversation }>(`/api/conversations/${encodeURIComponent(id)}`)
        .then(async ({ conversation }) => {
          if (conversationList.changedSince(id, listVersion) && !conversationList.has(id)) return;
          if (!conversationList.changedSince(id, listVersion))
            conversationList.upsert(conversation, temporary);
          readState.sync([conversation], version, false);
          setConversations(conversationList.values());
          // Previews and unrelated histories must never delay opening a chat.
          void messageCache.loadLatest(id).catch((err: Error) => setError(err.message));
          await loadMembers(id);
        })
        .finally(() => {
          detailFlights.current.delete(id);
        });
      detailFlights.current.set(id, task);
      return task;
    },
    [conversationList, loadMembers, messageCache, readState],
  );
  const conversationFlight = useRef<Promise<Conversation[]> | null>(null);
  const fetchConversations = useCallback(
    (preserveLocal = true) => {
      if (conversationFlight.current) return conversationFlight.current;
      const version = readState.version();
      const listVersion = conversationList.version();
      const task = api
        .get<{ conversations: Conversation[] }>('/api/conversations')
        .then(({ conversations: chats }) => {
          const merged = conversationList.replace(chats, listVersion, preserveLocal);
          readState.sync(merged, version);
          setConversations(merged);
          return merged;
        })
        .finally(() => {
          conversationFlight.current = null;
        });
      conversationFlight.current = task;
      return task;
    },
    [readState, conversationList],
  );
  const loadMessages = useCallback(
    async (id: string, older = false, force = false) => {
      if (!conversationList.has(id)) await loadConversation(id);
      if (older) await messageCache.extend(id, true);
      else if (force && messageCache.isOpen(id)) await messageCache.refresh(id);
      else await messageCache.open(id, readState.peek(id)?.lastSeenMessageId ?? null);
    },
    [messageCache, readState, conversationList, loadConversation],
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
          const chats = await fetchConversations(queue);
          if (sequence !== refreshSequence.current) return;
          const allowed = new Set(chats.map((chat) => chat.id));
          for (const id of memberIds.current.keys())
            if (!allowed.has(id)) memberIds.current.set(id, new Set());
          messageCache.prune(allowed);
          outbox.prune(allowed);
          setMessages((current) =>
            Object.fromEntries(Object.entries(current).filter(([id]) => allowed.has(id))),
          );
          setLatestMessages((current) =>
            Object.fromEntries(Object.entries(current).filter(([id]) => allowed.has(id))),
          );
          setReceiptPositions((current) =>
            Object.fromEntries(Object.entries(current).filter(([id]) => allowed.has(id))),
          );
          if (activeRef.current && !allowed.has(activeRef.current)) activate(null);
          const outcomes = await Promise.allSettled(
            chats.flatMap((chat) => [loadMembers(chat.id), messageCache.loadLatest(chat.id, true)]),
          );
          if (sequence !== refreshSequence.current) return;
          let failed = outcomes.some((outcome) => outcome.status === 'rejected');
          // Retained chats also need to recover events missed while disconnected.
          const histories = await Promise.allSettled(
            chats
              .filter((chat) => messageCache.isOpen(chat.id))
              .map((chat) => messageCache.refresh(chat.id)),
          );
          if (histories.some((outcome) => outcome.status === 'rejected')) failed = true;
          lastRefreshAt.current = Date.now();
          setError(failed ? 'Some conversations could not be synced. Refresh to try again.' : '');
        } while (refreshQueued.current);
      })().finally(() => {
        refreshFlight.current = null;
      });
      refreshFlight.current = task;
      return task;
    },
    [activate, loadMembers, messageCache, fetchConversations, outbox],
  );
  const removeConversation = useCallback(
    (id: string) => {
      conversationList.remove(id);
      readState.remove(id);
      setMessages((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setLatestMessages((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setMembers((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setReceiptPositions((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setConversations(conversationList.values());
      const allowed = new Set(conversationList.values().map((chat) => chat.id));
      messageCache.prune(allowed);
      outbox.prune(allowed);
      memberIds.current.set(id, new Set());
      if (activeRef.current === id) activate(null);
    },
    [activate, conversationList, messageCache, outbox, readState],
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
      outbox.observe(message);
      acceptMessage(message);
      if (!conversationList.has(message.conversationId))
        void loadConversation(message.conversationId).catch(report);
    });
    socket.on('message.updated', (event: MessageUpdatedEvent) => {
      messageCache.edit(event);
    });
    socket.on(
      'conversation.seen',
      (event: { conversationId: string; userId: string; lastSeenMessageId: string }) => {
        if (event.userId !== userId)
          void resolveReceipt(event.conversationId, event.userId, event.lastSeenMessageId).catch(
            () => {},
          );
      },
    );
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
    socket.on(
      'conversation.updated',
      ({ conversationId, name }: { conversationId: string; name: string }) => {
        const chat = conversationList.values().find((chat) => chat.id === conversationId);
        if (chat) {
          conversationList.upsert({ ...chat, name });
          setConversations(conversationList.values());
        }
      },
    );
    socket.on('conversation.deleted', ({ conversationId }: { conversationId: string }) =>
      removeConversation(conversationId),
    );
    for (const event of ['group.member_joined', 'group.member_left', 'group.role_changed'])
      socket.on(
        event,
        ({ conversationId, userId: memberId }: { conversationId: string; userId: string }) => {
          if (event === 'group.member_left' && memberId === userId)
            removeConversation(conversationId);
          else void loadConversation(conversationId).catch(report);
        },
      );
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync(true);
    });
    sync();
    return () => {
      alive = false;
      socket.disconnect();
      subscription.remove();
    };
  }, [
    token,
    userId,
    acceptMessage,
    refresh,
    directory,
    messageCache,
    conversationList,
    readState,
    loadConversation,
    removeConversation,
    activate,
    outbox,
    resolveReceipt,
  ]);
  return (
    <Context.Provider
      value={{
        conversations,
        messages,
        outgoing,
        outbox,
        latestMessages,
        members,
        receiptPositions,
        unread,
        loading,
        connection,
        error,
        setError,
        refresh,
        removeConversation,
        loadConversation,
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
