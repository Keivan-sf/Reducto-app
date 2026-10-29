import { useTheme, createThemedStyles } from '../../context/ThemeContext';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewToken,
  type GestureResponderEvent,
  type ScrollViewProps,
} from 'react-native';
import { router, useIsFocused } from 'expo-router';
import { usePresenceLabel } from './usePresenceLabel';
import { pickUpload } from '../../lib/pick-upload';
import * as Clipboard from 'expo-clipboard';
import { api, useSession } from '../../context/SessionContext';
import { useChats } from '../../context/ChatsContext';
import { Avatar, Button, Dialog, Icon, IconButton, Notice, useUIStyles } from '../../components/ui';
import { EMOJIS, type Emoji, type Message } from '../../api/types';
import { conversationName, profileName, timeLabel, mergeMessages } from '../../lib/messages';
import { useProfiles } from '../../context/ProfilesContext';
import { retainUpload, saveLocalFile } from '../../lib/local-attachments';
import { messageUpload } from '../../lib/message-upload';
import { uploadSizeError } from '../../lib/upload-limits';
import { uploadKind } from '../../lib/upload-kind';
import { UploadMessage } from './UploadMessage';
import { downloadAttachment } from '../../lib/download';
import { canCopyImage, copyImage } from '../../lib/copy-image';
import { AttachmentImage } from './AttachmentImage';
import { GroupDialog } from './GroupDialog';
import { ApiError } from '../../api/client';
import { UserProfileDialog } from './UserProfileDialog';
import { MessageText } from './MessageText';
import { MessageBubbleContent } from './MessageBubbleContent';
import { SwipeToReply } from './SwipeToReply';
import { GifPreview } from './GifPreview';
import { useGifs } from '../../context/GifsContext';
import { gifRecencyStore } from '../../lib/gif-recency-store';
import { ReplyPreview, ReplyQuote } from './ReplyPreview';
import { VoiceMessage } from './VoiceMessage';
import { DocumentMessage } from './DocumentMessage';
import { MessageComposer } from './MessageComposer';
import { MediaSendPreview } from './MediaSendPreview';
import type { UploadAsset } from '../../lib/uploads';
import type { VideoFile } from '../../api/video-cache';
import type { RecordedVoice } from '../../lib/voice-recording.types';
import { useVoicePlayback } from '../../context/VoicePlaybackContext';
import { VoiceMiniPlayer } from './VoiceMiniPlayer';
import { VideoCard } from './VideoCard';
import { useMediaViewers } from './MediaViewers';
import { useVideos, videoKey, voiceFileKey, documentFileKey } from '../../context/VideosContext';
import { useMediaMetadata } from '../../context/MediaMetadataContext';
import { saveVideoFile } from '../../lib/video-download';
import { MessageMenu, type MessageMenuAction } from './MessageMenu';
import { ChatHistoryScrollView } from './ChatHistoryScrollView';
import { comparePosition } from '../../api/read-state';
import { messageGif, messageMedia } from '../../lib/message-attachment';
import { seenByAnotherMember } from '../../api/receipts';
import { captureHistoryAnchor } from '../../lib/history-anchor';
import { ChatTailFollow } from '../../lib/chat-tail-follow';
import { ScrollToLatestButton } from './ScrollToLatestButton';
import { oldestMention } from '../../api/mentions';
import { useMentionVisibility } from './useMentionVisibility';
import { ConversationSearch, SEARCH_DELAY } from '../../api/conversation-search';
import { SearchInput, SearchResults, SearchNavigation } from './ConversationSearch';

const readViewabilityConfig = { minimumViewTime: 350, viewAreaCoveragePercentThreshold: 60 };

export default function ChatView({
  id,
  active,
  onSearchVisibilityChange,
}: {
  id?: string;
  active: boolean;
  onSearchVisibilityChange?: (open: boolean) => void;
}) {
  const { colors } = useTheme();
  const s = useStyles();
  const styles = useUIStyles();
  const { session } = useSession();
  const { profiles, directory } = useProfiles();
  const {
    conversations,
    messages,
    outgoing,
    unread,
    outbox,
    members,
    receiptPositions,
    loading,
    activate,
    acceptMessage,
    loadMessages,
    hasOlder,
    hasNewer,
    messageCache,
    readVisible,
    getReadState,
    markMentionSeen,
  } = useChats();
  const voicePlayback = useVoicePlayback();
  const routeFocused = useIsFocused();
  const focused = active && routeFocused;
  const [mediaDraft, setMediaDraft] = useState<{
    asset: UploadAsset;
    conversationId: string;
    replyToMessageId?: string;
  }>();
  const uploadSequence = useRef(0);
  const uploadScope = useRef<AbortController | null>(null);
  const [draftScope, setDraftScope] = useState({ id, focused });
  if (draftScope.id !== id || draftScope.focused !== focused) {
    setDraftScope({ id, focused });
    setMediaDraft(undefined);
  }
  useEffect(() => {
    const controller = new AbortController();
    uploadScope.current = controller;
    return () => controller.abort();
  }, [id, focused]);
  const chat = conversations.find((entry) => entry.id === id);
  const [jumpWindow, setJumpWindow] = useState<{
    messages: Message[];
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
  } | null>(null);
  const latest = messages[id ?? ''];
  const history = useMemo(() => {
    if (!jumpWindow) return latest ?? [];
    const context = jumpWindow.messages.map(
      (message) => messageCache.peek(id ?? '', message.id) ?? message,
    );
    const edge = context.at(-1);
    // An initial unread window that reaches the live tail stays live as new
    // messages arrive. Do not merge across a gap in an older context window.
    if (!jumpWindow.hasMoreAfter && edge && latest?.some((message) => message.id === edge.id))
      return mergeMessages(
        context,
        latest.filter((message) => comparePosition(message, edge) > 0),
      );
    return context;
  }, [jumpWindow, latest, messageCache, id]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const savingEdit = useRef(false);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [jumping, setJumping] = useState(false);
  const mentionFlight = useRef(false);
  const [mentionBusy, setMentionBusy] = useState(false);
  const jumpSequence = useRef(0);
  const scrollTarget = useRef<{ id: string; index: number; attempts: number } | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [seekingVoice, setSeekingVoice] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const usernameLookup = useRef(0);
  useEffect(
    () => () => {
      usernameLookup.current++;
    },
    [focused, id],
  );
  async function openUsername(username: string) {
    const sequence = ++usernameLookup.current;
    setError('');
    try {
      const profile = await directory.byUsername(username);
      if (sequence === usernameLookup.current) setProfileUserId(profile.id);
    } catch (err) {
      if (sequence !== usernameLookup.current) return;
      setError(
        err instanceof ApiError && err.status === 404
          ? `Username @${username} doesn't exist.`
          : (err as Error).message,
      );
    }
  }

  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [forward, setForward] = useState(false);
  const [actionAnchor, setActionAnchor] = useState<{ x: number; y: number } | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [searchList, setSearchList] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchStore = useMemo(() => new ConversationSearch(api, id ?? ''), [id]);
  const searchState = useSyncExternalStore(searchStore.subscribe, searchStore.snapshot);
  const searchOpen = search !== null;
  const wide = useWindowDimensions().width >= 850;
  const mobileSearchList = !wide && searchOpen && searchList;
  useEffect(() => () => searchStore.reset(), [searchStore]);
  const gifCache = useGifs();
  const videoCache = useVideos();
  const viewers = useMediaViewers();
  const mediaMetadata = useMediaMetadata();
  const [visibleMessages, setVisibleMessages] = useState<Set<string>>(new Set());
  const [gifs, setGifs] = useState(false);
  const [openingHistory, setOpeningHistory] = useState(true);
  const initialReadTarget = useRef<string | null>(null);
  const mentionVisibility = useMentionVisibility({
    enabled:
      !!id &&
      focused &&
      !openingHistory &&
      !jumping &&
      !jumpTarget &&
      !details &&
      !profileUserId &&
      !gifs &&
      !actionsVisible &&
      !mobileSearchList,
    mentions: chat?.unseenMentions,
    markSeen: (messageId) => markMentionSeen(id!, messageId),
    onError: setError,
    viewers,
  });
  useEffect(() => {
    const report = () => {
      if (
        !id ||
        openingHistory ||
        !focused ||
        details ||
        profileUserId ||
        gifs ||
        viewers.isOpen() ||
        actionsVisible ||
        mobileSearchList ||
        AppState.currentState !== 'active'
      )
        return;
      readVisible(
        id,
        history.filter((message) => visibleMessages.has(outbox.messageKey(message))),
        history,
        jumpWindow?.hasMoreBefore ?? hasOlder(id),
        jumpWindow?.hasMoreAfter ?? hasNewer(id),
      );
    };
    report();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') report();
    });
    const stopWatchingViewer = viewers.subscribe(report);
    return () => {
      subscription.remove();
      stopWatchingViewer();
    };
  }, [
    id,
    openingHistory,
    focused,
    details,
    profileUserId,
    gifs,
    viewers,
    actionsVisible,
    mobileSearchList,
    readVisible,
    history,
    visibleMessages,
    outbox,
    jumpWindow,
    hasOlder,
    hasNewer,
  ]);
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
      setVisibleMessages(new Set(viewableItems.map(({ item }) => outbox.messageKey(item))));
      if (
        initialReadTarget.current &&
        viewableItems.some(({ item }) => item.id === initialReadTarget.current)
      ) {
        initialReadTarget.current = null;
        setOpeningHistory(false);
      }
      const target = scrollTarget.current;
      if (target && viewableItems.some(({ item }) => item.id === target.id)) {
        scrollTarget.current = null;
        clearTimeout(scrollTimer.current);
        setJumpTarget(null);
        setHighlighted(target.id);
        clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setHighlighted(null), 2500);
      }
    },
    [setJumpTarget, setHighlighted, setOpeningHistory, outbox],
  );
  const list = useRef<FlatList<Message>>(null);
  const [tailFollow] = useState(() => new ChatTailFollow());
  useEffect(() => {
    if (!focused) tailFollow.stop();
  }, [focused, tailFollow]);
  useLayoutEffect(() => {
    tailFollow.setScroll(() => list.current?.scrollToOffset({ offset: 0, animated: false }));
  }, [tailFollow]);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => tailFollow.layout());
    const hidden = Keyboard.addListener('keyboardDidHide', () => tailFollow.layout());
    return () => {
      shown.remove();
      hidden.remove();
      tailFollow.stop();
    };
  }, [tailFollow]);
  const onVoiceSeekingChange = useCallback(
    (seeking: boolean) => {
      // Apply immediately to Android's native ScrollView, then keep the rendered
      // prop in sync so any intervening render preserves the lock.
      if (Platform.OS !== 'web') list.current?.setNativeProps({ scrollEnabled: !seeking });
      tailFollow.setEnabled(!seeking);
      setSeekingVoice(seeking);
    },
    [tailFollow],
  );
  const cancelPositioning = useCallback(() => {
    tailFollow.stop();
    if (!initialReadTarget.current && !scrollTarget.current) return;
    initialReadTarget.current = null;
    scrollTarget.current = null;
    clearTimeout(scrollTimer.current);
    setJumpTarget(null);
    setOpeningHistory(false);
  }, [setJumpTarget, setOpeningHistory, tailFollow]);
  const renderChatHistoryScroll = useCallback(
    (props: ScrollViewProps) => (
      <ChatHistoryScrollView {...props} onUserScroll={cancelPositioning} />
    ),
    [cancelPositioning],
  );
  useEffect(() => {
    if (active) onSearchVisibilityChange?.(searchOpen);
  }, [active, searchOpen, onSearchVisibilityChange]);
  const searchActions = useRef({ run: () => {} });
  useEffect(() => {
    if (!wide || Platform.OS !== 'web' || !focused || search === null || !search.trim()) return;
    const timer = setTimeout(() => searchActions.current.run(), SEARCH_DELAY);
    return () => clearTimeout(timer);
  }, [search, wide, focused]);
  function changeSearch(value: string | null, cancelJump = true) {
    searchStore.reset();
    if (
      cancelJump &&
      searchOpen &&
      (jumping ||
        (scrollTarget.current && scrollTarget.current.id === searchState.messages[searchIndex]?.id))
    ) {
      jumpSequence.current++;
      setJumping(false);
      cancelPositioning();
    }
    setSearch(value);
    setSearchIndex(0);
    setSearchList(false);
  }
  async function selectSearchResult(message: Message, index: number) {
    setSearchIndex(index);
    setSearchList(false);
    Keyboard.dismiss();
    await jumpToMessage(message.id, true);
  }
  async function runSearch() {
    if (search === null) return;
    const current = searchStore.snapshot();
    if (current.submitted && current.query === search.trim()) return;
    Keyboard.dismiss();
    setSearchIndex(0);
    const results = await searchStore.search(search);
    if (!wide && results?.[0]) await selectSearchResult(results[0], 0);
  }
  searchActions.current.run = () => {
    void runSearch();
  };
  async function olderSearchResult() {
    const next = searchIndex + 1;
    const results =
      next < searchState.messages.length ? searchState.messages : await searchStore.load();
    if (results?.[next]) await selectSearchResult(results[next], next);
  }
  async function retrySearch() {
    const firstPage = !searchState.messages.length;
    const results = await searchStore.load();
    if (!wide && firstPage && results?.[0]) await selectSearchResult(results[0], 0);
  }
  const searchResults = (
    <SearchResults
      state={searchState}
      selectedId={searchState.messages[searchIndex]?.id}
      userId={session!.user.id}
      onSelect={(message, index) => {
        void selectSearchResult(message, index);
      }}
      onMore={() => {
        void searchStore.load();
      }}
    />
  );
  const peerId = id
    ? members[id]?.find((member) => member.userId !== session!.user.id)?.userId
    : undefined;
  const peer = chat?.type === 'private' && peerId ? profiles[peerId] : undefined;
  const peerPresence = usePresenceLabel(peer);
  const title = chat ? conversationName(chat, peer) : '';
  useEffect(() => {
    if (!focused || !id) return;
    activate(id);
    return () => {
      Keyboard.dismiss();
      activate(null);
    };
  }, [id, focused, activate]);
  useEffect(() => {
    let alive = true;
    if (id)
      void (async () => {
        await loadMessages(id);
        if (!alive) return;
        const read = getReadState(id);
        const window = messageCache.history(id);
        const target =
          window.find((message) => message.id === read?.lastSeenMessageId) ??
          (read?.lastSeenMessageId ? window.at(-1) : window[0]);
        if (!target) {
          setOpeningHistory(false);
          return;
        }
        initialReadTarget.current = target.id;
        setJumpTarget(target.id);
      })().catch((err) => {
        if (alive) {
          setOpeningHistory(false);
          setError(err.message);
        }
      });
    return () => {
      alive = false;
    };
  }, [id, loadMessages, getReadState, messageCache]);
  const shown = useMemo(
    () => mergeMessages(history, outgoing[id ?? ''] ?? []).reverse(),
    [history, outgoing, id],
  );
  useLayoutEffect(() => {
    tailFollow.layout();
  }, [shown, tailFollow]);
  useEffect(() => {
    if (!jumpTarget) return;
    const index = shown.findIndex((message) => message.id === jumpTarget);
    if (index < 0) return;
    scrollTarget.current = { id: jumpTarget, index, attempts: 0 };
    const frame = requestAnimationFrame(() =>
      list.current?.scrollToIndex({
        index,
        viewPosition: 0.5,
        animated: initialReadTarget.current !== jumpTarget,
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [jumpTarget, shown]);
  useEffect(
    () => () => {
      jumpSequence.current++;
      clearTimeout(scrollTimer.current);
      clearTimeout(highlightTimer.current);
    },
    [],
  );
  async function jumpToMessage(messageId: string, keepSearch = false) {
    if (!id) return;
    tailFollow.stop();
    initialReadTarget.current = null;
    setOpeningHistory(false);
    const sequence = ++jumpSequence.current;
    setLoadingHistory(false);
    setJumping(true);
    setError('');
    try {
      if (!history.some((message) => message.id === messageId)) {
        const page = await messageCache.around(id, messageId);
        if (sequence !== jumpSequence.current) return;
        setJumpWindow({
          messages: mergeMessages([], [...page.before, page.message, ...page.after]),
          hasMoreBefore: page.hasMoreBefore,
          hasMoreAfter: page.hasMoreAfter,
        });
      }
      if (sequence !== jumpSequence.current) return;
      if (!keepSearch && !wide) changeSearch(null, false);
      setJumpTarget(messageId);
      setHighlighted(messageId);
      clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => {
        setHighlighted(null);
        setJumpTarget(null);
        scrollTarget.current = null;
      }, 3000);
      return true;
    } catch (err) {
      if (sequence === jumpSequence.current) setError((err as Error).message);
    } finally {
      if (sequence === jumpSequence.current) setJumping(false);
    }
  }
  async function jumpToMention() {
    if (!id || mentionFlight.current) return;
    mentionFlight.current = true;
    setMentionBusy(true);
    setError('');
    const sequence = jumpSequence.current;
    try {
      const messageId = await oldestMention(chat?.unseenMentions ?? [], (messageId) =>
        messageCache.message(id, messageId),
      );
      if (sequence !== jumpSequence.current) {
        mentionFlight.current = false;
        setMentionBusy(false);
        return;
      }
      if (messageId) {
        mentionVisibility.retry(messageId);
        await jumpToMessage(messageId);
      }
    } catch (err) {
      setError((err as Error).message);
    }
    mentionFlight.current = false;
    setMentionBusy(false);
  }
  function scrollLoadedLatest() {
    if (jumpWindow || search !== null || jumpTarget || (id && messageCache.hasNewer(id)))
      return false;
    // Native scrolling can start on touch-down without rendering the chat or
    // replacing the history window. Keep the full jump path for unloaded tails.
    tailFollow.start();
    return true;
  }
  async function showLatest() {
    if (scrollLoadedLatest()) return;
    setAwayFromBottom(false);
    tailFollow.start();
    initialReadTarget.current = null;
    setOpeningHistory(false);
    const sequence = ++jumpSequence.current;
    setJumping(true);
    setLoadingHistory(false);
    setJumpWindow(null);
    setJumpTarget(null);
    scrollTarget.current = null;
    clearTimeout(scrollTimer.current);
    clearTimeout(highlightTimer.current);
    setHighlighted(null);
    if (!wide) changeSearch(null, false);
    try {
      if (id && messageCache.hasNewer(id)) await messageCache.page(id, false, true);
      if (sequence === jumpSequence.current) tailFollow.layout();
    } catch (err) {
      if (sequence === jumpSequence.current) setError((err as Error).message);
    } finally {
      if (sequence === jumpSequence.current) setJumping(false);
    }
  }
  const edgeRequests = useRef(new Set<string>());
  const edgeFailures = useRef(new Map<string, number>());
  const expandWindow = useCallback(
    async (older: boolean) => {
      if (!id || openingHistory || jumping || jumpTarget || !focused) return;
      const more = jumpWindow
        ? older
          ? jumpWindow.hasMoreBefore
          : jumpWindow.hasMoreAfter
        : older
          ? messageCache.hasOlder(id)
          : messageCache.hasNewer(id);
      const edge = older ? history[0] : history.at(-1);
      if (!more || !edge) return;
      const key = `${id}:${jumpWindow ? 'jump' : 'history'}:${edge.id}:${older}`;
      if (edgeRequests.current.has(key) || Date.now() - (edgeFailures.current.get(key) ?? 0) < 3000)
        return;
      edgeRequests.current.add(key);
      const restoreAnchor = captureHistoryAnchor(list.current, older);
      const sequence = jumpSequence.current;
      setLoadingHistory(true);
      try {
        if (jumpWindow) {
          const page = await messageCache.around(id, edge.id, older ? 50 : 0, older ? 0 : 50);
          if (sequence !== jumpSequence.current) return;
          setJumpWindow((current) =>
            current
              ? {
                  messages: mergeMessages(current.messages, [
                    ...page.before,
                    page.message,
                    ...page.after,
                  ]),
                  hasMoreBefore: older
                    ? page.hasMoreBefore && page.before.length > 0
                    : current.hasMoreBefore,
                  hasMoreAfter: older
                    ? current.hasMoreAfter
                    : page.hasMoreAfter && page.after.length > 0,
                }
              : null,
          );
        } else await messageCache.extend(id, older);
        if (sequence === jumpSequence.current)
          requestAnimationFrame(() => {
            if (sequence === jumpSequence.current) restoreAnchor();
          });
      } catch (err) {
        edgeFailures.current.set(key, Date.now());
        if (sequence === jumpSequence.current) setError((err as Error).message);
      } finally {
        edgeRequests.current.delete(key);
        if (sequence === jumpSequence.current) setLoadingHistory(edgeRequests.current.size > 0);
      }
    },
    [
      id,
      openingHistory,
      jumping,
      jumpTarget,
      focused,
      jumpWindow,
      history,
      messageCache,
      setLoadingHistory,
      setJumpWindow,
      setError,
    ],
  );
  const historyMetrics = useRef({ offset: 0, height: 0, viewport: 0 });
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const loadVisibleEdges = useCallback(() => {
    const { offset, height, viewport } = historyMetrics.current;
    if (!height || !viewport) return;
    const threshold = viewport * 0.5;
    if (offset <= threshold) void expandWindow(false);
    if (height - viewport - offset <= threshold) void expandWindow(true);
  }, [expandWindow]);
  // Edge callbacks can fire while initial positioning is locked and will not
  // fire again at the same offset. Recheck after positioning or data changes.
  useEffect(() => {
    loadVisibleEdges();
  }, [loadVisibleEdges]);
  async function saveEdit(text: string) {
    if (!id || !editing || busy || savingEdit.current || !text.trim()) return;
    savingEdit.current = true;
    setBusy(true);
    setError('');
    try {
      const { message } = await api.request<{ message: Message }>(
        `/api/conversations/${id}/messages/${editing.id}`,
        { method: 'PATCH', body: JSON.stringify({ text: text.trim() }) },
      );
      messageCache.edit({
        conversationId: id,
        messageId: message.id,
        text: message.text!,
        isEdited: message.isEdited,
      });
      setEditing(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      savingEdit.current = false;
      setBusy(false);
    }
  }
  function send(gifId?: string, text = ''): boolean {
    if (!id || busy || (!text.trim() && !gifId)) return false;
    setError('');
    outbox.enqueue(id, {
      ...(text.trim() && !gifId ? { text: text.trim() } : {}),
      ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
      ...(gifId ? { attachment: { type: 'gif', gifId } as const } : {}),
    });
    setReplyTo(null);
    void showLatest();
    return true;
  }
  async function upload() {
    if (!id || busy) return;
    // Capture the destination and reply before opening the asynchronous picker.
    const conversationId = id;
    const replyToMessageId = replyTo?.id;
    const sequence = ++uploadSequence.current;
    const scope = uploadScope.current;
    const desktop = Platform.OS === 'web' && window.innerWidth >= 768;
    const picked = await pickUpload();
    if (picked.canceled || scope?.signal.aborted || sequence !== uploadSequence.current) return;
    const file = picked.assets[0];
    const sizeError = uploadSizeError(file.size);
    if (sizeError) return setError(sizeError);
    if (
      desktop ||
      (/^(image|video)\//i.test(file.mimeType ?? '') &&
        uploadKind(file.mimeType, file.name) !== 'document')
    ) {
      Keyboard.dismiss();
      voicePlayback.pause();
      setMediaDraft({ asset: file, conversationId, replyToMessageId });
      return;
    }
    outbox.enqueue(
      conversationId,
      { ...(replyToMessageId ? { replyToMessageId } : {}) },
      messageUpload(conversationId, file, {
        api,
        media: mediaMetadata,
        gifs: gifCache,
        files: videoCache,
        onGifAdded: (gifId) => {
          void gifRecencyStore(session!.user.id).record(gifId);
        },
      }),
    );
    setReplyTo(null);
    void showLatest();
  }
  function sendMedia(file: VideoFile, caption: string, asDocument: boolean) {
    if (!mediaDraft || busy || !focused || mediaDraft.conversationId !== id) return false;
    const { asset, conversationId, replyToMessageId } = mediaDraft;
    setError('');
    outbox.enqueue(
      conversationId,
      {
        ...(caption ? { text: caption } : {}),
        ...(replyToMessageId ? { replyToMessageId } : {}),
      },
      messageUpload(
        conversationId,
        asset,
        {
          api,
          media: mediaMetadata,
          gifs: gifCache,
          files: videoCache,
          onGifAdded: (gifId) => {
            void gifRecencyStore(session!.user.id).record(gifId);
          },
        },
        undefined,
        { asDocument, file },
      ),
    );
    setMediaDraft(undefined);
    setReplyTo(null);
    void showLatest();
    return true;
  }
  async function sendVoice(voice: RecordedVoice, signal: AbortSignal) {
    if (!id || signal.aborted) return;
    const conversationId = id;
    const replyToMessageId = replyTo?.id;
    // The recorder disposes its source as soon as we return; give the job its own copy.
    const local = await retainUpload(voice.asset);
    if (signal.aborted) {
      local.dispose();
      return;
    }
    outbox.enqueue(
      conversationId,
      { ...(replyToMessageId ? { replyToMessageId } : {}) },
      messageUpload(
        conversationId,
        voice.asset,
        { api, media: mediaMetadata, gifs: gifCache, files: videoCache },
        { file: local, duration: voice.duration },
      ),
    );
    setReplyTo(null);
    void showLatest();
  }
  function openMessageMenu(message: Message, event: GestureResponderEvent) {
    event.stopPropagation();
    if (message.delivery === 'sending') return;
    setError('');
    setActionMessage(message);
    setActionAnchor({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
    setActionsVisible(true);
    setForward(false);
  }
  async function react(message: Message, emoji: Emoji) {
    if (!id || busy || message.delivery) return;
    const remove = message.reactions?.some(
      (reaction) => reaction.emoji === emoji && reaction.userId === session!.user.id,
    );
    setBusy(true);
    try {
      await api.request(`/api/conversations/${id}/messages/${message.id}/reactions`, {
        method: remove ? 'DELETE' : 'PUT',
        body: JSON.stringify({ emoji }),
      });
      messageCache.reaction({
        conversationId: id,
        messageId: message.id,
        userId: session!.user.id,
        emoji,
        removed: !!remove,
      });
      setActionsVisible(false);
    } catch (err) {
      setError((err as Error).message);
      setActionsVisible(false);
    } finally {
      setBusy(false);
    }
  }
  const messageActions: MessageMenuAction[] =
    actionMessage?.delivery === 'failed'
      ? [
          {
            label: 'Retry sending',
            icon: 'refresh-outline',
            onPress: () => {
              if (actionMessage.localId) outbox.retry(actionMessage.localId);
              setActionsVisible(false);
            },
          },
          {
            label: 'Discard message',
            icon: 'trash-outline',
            onPress: () => {
              if (actionMessage.localId) outbox.discard(actionMessage.localId);
              setActionsVisible(false);
            },
          },
        ]
      : [
          {
            label: 'Reply',
            icon: 'arrow-undo-outline',
            onPress: () => {
              setEditing(null);
              setReplyTo(actionMessage);
              setActionsVisible(false);
            },
          },
          ...(actionMessage &&
          actionMessage.senderId === session?.user.id &&
          !actionMessage.delivery &&
          !voiceActive
            ? [
                {
                  label: 'Edit',
                  icon: 'create-outline' as const,
                  onPress: () => {
                    setEditing(
                      messageCache.peek(actionMessage.conversationId, actionMessage.id) ??
                        actionMessage,
                    );
                    setActionsVisible(false);
                    setError('');
                  },
                },
              ]
            : []),
          ...(actionMessage?.text
            ? [
                {
                  label: 'Copy Text',
                  icon: 'copy-outline' as const,
                  onPress: () => {
                    const text = actionMessage.text!;
                    setActionsVisible(false);
                    void Clipboard.setStringAsync(text).catch((err) => setError(err.message));
                  },
                },
              ]
            : []),
          ...(actionMessage?.attachment?.type === 'image' && canCopyImage()
            ? [
                {
                  label: 'Copy Image',
                  icon: 'copy-outline' as const,
                  onPress: () => {
                    const { conversationId, attachment } = actionMessage;
                    if (attachment?.type !== 'image') return;
                    setActionsVisible(false);
                    void copyImage(() =>
                      videoCache.get(videoKey(conversationId, attachment.mediaId)),
                    ).catch((err) => setError(err.message));
                  },
                },
              ]
            : []),
          ...(actionMessage?.attachment && actionMessage.attachment.type !== 'gif'
            ? [
                {
                  label: 'Save attachment',
                  icon: 'download-outline' as const,
                  onPress: () => {
                    const attachment = actionMessage.attachment!;
                    setActionsVisible(false);
                    if (
                      id &&
                      (attachment.type === 'voice' ||
                        attachment.type === 'document' ||
                        attachment.type === 'music' ||
                        attachment.type === 'audio')
                    )
                      void videoCache
                        .get(
                          attachment.type === 'voice'
                            ? voiceFileKey(id, attachment.mediaId)
                            : documentFileKey(id, attachment.mediaId),
                        )
                        .then(saveLocalFile)
                        .catch((err) => setError(err.message));
                    else if (id && attachment.type === 'video')
                      void videoCache
                        .get(videoKey(id, attachment.mediaId))
                        .then(saveVideoFile)
                        .catch((err) => setError(err.message));
                    else if (id && attachment.type !== 'gif') {
                      const cached = videoCache.read(videoKey(id, attachment.mediaId));
                      const save =
                        cached.status === 'ready' && (!cached.file.exists || cached.file.exists())
                          ? saveLocalFile(cached.file)
                          : downloadAttachment(id, attachment.mediaId);
                      void save.catch((err) => setError(err.message));
                    }
                  },
                },
              ]
            : []),
          ...(actionMessage?.attachment?.type === 'gif'
            ? [
                {
                  label: 'Save GIF',
                  icon: 'bookmark-outline' as const,
                  onPress: () => {
                    const attachment = actionMessage.attachment!;
                    if (attachment.type !== 'gif') return;
                    setActionsVisible(false);
                    setBusy(true);
                    void api
                      .request(`/api/gifs/${attachment.gifId}`, { method: 'PUT' })
                      .then(() => gifRecencyStore(session!.user.id).record(attachment.gifId))
                      .catch((err) => setError(err.message))
                      .finally(() => setBusy(false));
                  },
                },
              ]
            : []),
          {
            label: 'Forward',
            icon: 'arrow-redo-outline',
            onPress: () => {
              setActionsVisible(false);
              setForward(true);
            },
          },
        ];
  if (!id)
    return (
      <View style={s.welcome}>
        <View style={s.welcomeIcon}>
          <Icon name="paper-plane-outline" size={58} color={colors.blue} />
        </View>
        <Text style={s.welcomeTitle}>Good to have you here.</Text>
        <View style={s.welcomePill}>
          <Icon name="chatbubbles-outline" size={16} color={colors.welcomeAccent} />
          <Text style={{ fontSize: 12, color: colors.welcomeAccent }}>Reducto</Text>
        </View>
      </View>
    );
  if (!chat)
    return (
      <View style={s.welcome}>
        {loading ? (
          <ActivityIndicator color={colors.blue} />
        ) : (
          <>
            <Text style={styles.title}>This chat is unavailable</Text>
            <Text style={styles.subtitle}>Refresh your chats or check your group membership.</Text>
            <Button title="Back to chats" onPress={() => router.replace('/')} />
          </>
        )}
      </View>
    );
  return (
    <KeyboardAvoidingView
      style={[s.root, { flexDirection: 'row' }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.header}>
          {!wide && (
            <IconButton
              name="arrow-back"
              label="Back to chats"
              onPress={() => router.replace('/')}
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View conversation details"
            disabled={chat.type === 'private' && !peerId}
            onPress={() => {
              if (chat.type === 'private') {
                if (peerId) setProfileUserId(peerId);
              } else setDetails(true);
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
          >
            <Avatar name={title} uri={peer?.avatarUrl ?? undefined} size={40} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={s.headerTitle}>
                {title}
              </Text>
              <Text
                style={[
                  s.headerSubtitle,
                  chat.type === 'private' && { color: peer?.online ? colors.blue : colors.muted },
                ]}
              >
                {chat.type === 'group' ? `${members[id]?.length ?? 0} members` : peerPresence}
              </Text>
            </View>
          </Pressable>
          <IconButton
            name="search-outline"
            label="Search messages"
            onPress={() => changeSearch(search === null ? '' : null)}
          />
          <IconButton
            name="ellipsis-vertical"
            label="Conversation details"
            disabled={chat.type === 'private' && !peerId}
            onPress={() => {
              if (chat.type === 'private') {
                if (peerId) setProfileUserId(peerId);
              } else setDetails(true);
            }}
          />
        </View>
        {active && <VoiceMiniPlayer />}
        {!wide && searchOpen && <Notice text={error} onDismiss={() => setError('')} />}
        {!wide && searchOpen && (
          <SearchInput
            value={search}
            onChange={changeSearch}
            onSubmit={() => {
              void runSearch();
            }}
            onClose={() => changeSearch(null)}
          />
        )}
        {jumping && (
          <ActivityIndicator
            accessibilityLabel="Loading replied message"
            color={colors.blue}
            style={{ padding: 8 }}
          />
        )}
        <View style={{ flex: 1, minHeight: 0 }}>
          <View
            ref={(view) => mentionVisibility.setViewport(view)}
            collapsable={false}
            testID="positioned-chat-history"
            style={[s.historyViewport, { opacity: openingHistory || mobileSearchList ? 0 : 1 }]}
            pointerEvents={openingHistory || mobileSearchList ? 'none' : 'auto'}
            accessibilityElementsHidden={openingHistory || mobileSearchList}
            importantForAccessibility={
              openingHistory || mobileSearchList ? 'no-hide-descendants' : 'auto'
            }
          >
            <FlatList
              ref={list}
              renderScrollComponent={renderChatHistoryScroll}
              testID="chat-history"
              scrollEnabled={!seekingVoice}
              style={{ flex: 1 }}
              contentContainerStyle={s.history}
              inverted
              data={shown}
              keyExtractor={(message) => outbox.messageKey(message)}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={cancelPositioning}
              onLayout={() => {
                tailFollow.layout();
                mentionVisibility.schedule();
              }}
              scrollEventThrottle={16}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={readViewabilityConfig}
              maintainVisibleContentPosition={{
                minIndexForVisible: 0,
                // Inverted history has its live bottom at offset zero. Let Android
                // check the offset before anchoring the old bubble after insertion.
                ...(Platform.OS === 'android' &&
                focused &&
                !openingHistory &&
                !jumpTarget &&
                !seekingVoice &&
                search === null &&
                !(jumpWindow?.hasMoreAfter ?? hasNewer(id ?? ''))
                  ? { autoscrollToTopThreshold: 1 }
                  : {}),
              }}
              onEndReached={() => void expandWindow(true)}
              onEndReachedThreshold={0.5}
              onStartReached={() => void expandWindow(false)}
              onStartReachedThreshold={0.5}
              onScroll={({ nativeEvent }) => {
                mentionVisibility.schedule();
                const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
                historyMetrics.current = {
                  offset: contentOffset.y,
                  height: contentSize.height,
                  viewport: layoutMeasurement.height,
                };
                // Hide as soon as the user reaches the bottom area, without
                // waiting for the last pixels of Android's momentum to settle.
                // A wider reveal threshold also avoids flicker near the bottom.
                setAwayFromBottom((away) => contentOffset.y > (away ? 24 : 72));
                loadVisibleEdges();
              }}
              onContentSizeChange={(_width, height) => {
                mentionVisibility.schedule();
                historyMetrics.current.height = height;
                tailFollow.layout();
                loadVisibleEdges();
              }}
              onScrollToIndexFailed={({ index, averageItemLength }) => {
                const target = scrollTarget.current;
                if (!target || target.index !== index) return;
                list.current?.scrollToOffset({
                  offset: averageItemLength * index,
                  animated: false,
                });
                clearTimeout(scrollTimer.current);
                if (++target.attempts <= 12)
                  scrollTimer.current = setTimeout(() => {
                    if (scrollTarget.current === target)
                      list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
                  }, 150);
                else {
                  scrollTarget.current = null;
                  setJumpTarget(null);
                  initialReadTarget.current = null;
                  setOpeningHistory(false);
                  setError('Could not scroll to the message. Tap the reply to try again.');
                }
              }}
              ListFooterComponent={
                <View style={{ alignItems: 'center', padding: 14, gap: 10 }}>
                  {loadingHistory && (
                    <ActivityIndicator
                      accessibilityLabel="Loading more messages"
                      color={colors.blue}
                    />
                  )}
                  {!history.length && (
                    <Text style={s.emptyText}>
                      Say hello. This is the start of your conversation.
                    </Text>
                  )}
                </View>
              }
              renderItem={({ item: message, index }) => {
                const mine = message.senderId === session!.user.id;
                const mediaMetadata = messageMedia(message);
                const gifMetadata = messageGif(message);
                const visualMedia = ['image', 'gif', 'video'].includes(
                  message.upload?.type ?? message.attachment?.type ?? '',
                );
                const hasMediaHeader =
                  (!mine && chat.type === 'group') ||
                  !!message.forwardedFrom ||
                  !!message.replyToMessageId;
                const older = shown[index + 1];
                const dateStart =
                  !older ||
                  new Date(older.createdAt).toDateString() !==
                    new Date(message.createdAt).toDateString();
                const reactions = EMOJIS.map((emoji) => ({
                  emoji,
                  selected: message.reactions?.some(
                    (reaction) => reaction.emoji === emoji && reaction.userId === session!.user.id,
                  ),
                  count:
                    message.reactions?.filter((reaction) => reaction.emoji === emoji).length ?? 0,
                })).filter((entry) => entry.count);
                const overlayMeta = visualMedia && !message.text && !reactions.length;
                const messageMeta = (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Message actions"
                    testID={`message-meta-${message.id}`}
                    onPress={(event) => openMessageMenu(message, event)}
                    onLongPress={(event) => openMessageMenu(message, event)}
                    style={overlayMeta && s.mediaMeta}
                  >
                    <View style={[s.meta, overlayMeta && { marginTop: 0 }]}>
                      <Text style={[s.time, overlayMeta && s.mediaTime]}>
                        {message.isEdited ? 'edited ' : ''}
                        {timeLabel(message.createdAt)}
                      </Text>
                      {mine && (
                        <View
                          testID={`message-status-${message.id}`}
                          accessible
                          accessibilityLabel={
                            message.delivery === 'sending'
                              ? 'Sending message'
                              : message.delivery === 'failed'
                                ? 'Message failed to send'
                                : seenByAnotherMember(message, session!.user.id, receiptPositions)
                                  ? 'Message seen'
                                  : 'Message sent'
                          }
                        >
                          {message.delivery === 'failed' ? (
                            <Text style={{ color: '#E53935', fontWeight: '800', fontSize: 15 }}>
                              !
                            </Text>
                          ) : (
                            <Icon
                              name={
                                message.delivery === 'sending'
                                  ? 'time-outline'
                                  : seenByAnotherMember(message, session!.user.id, receiptPositions)
                                    ? 'checkmark-done'
                                    : 'checkmark'
                              }
                              size={15}
                              color={
                                overlayMeta
                                  ? 'white'
                                  : message.delivery === 'sending'
                                    ? colors.muted
                                    : colors.outgoingMeta
                              }
                            />
                          )}
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
                return (
                  <View>
                    {dateStart && (
                      <View style={s.date}>
                        <Text style={s.dateText}>
                          {new Date(message.createdAt).toLocaleDateString([], {
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </Text>
                      </View>
                    )}
                    <SwipeToReply
                      messageId={message.id}
                      disabled={!!message.delivery || voiceActive || !focused}
                      onReply={() => {
                        setEditing(null);
                        setReplyTo(message);
                        setActionsVisible(false);
                      }}
                    >
                      <Pressable
                        accessible={false}
                        ref={(view) => mentionVisibility.register(message.id, view)}
                        testID={`message-row-${message.id}`}
                        onPress={(event) => openMessageMenu(message, event)}
                        onLongPress={(event) => openMessageMenu(message, event)}
                        {...(Platform.OS === 'web'
                          ? {
                              onContextMenu: (event: GestureResponderEvent) => {
                                event.preventDefault();
                                openMessageMenu(message, event);
                              },
                            }
                          : {})}
                        style={[s.messageRow, mine && { justifyContent: 'flex-end' }]}
                      >
                        {!mine && chat.type === 'group' && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`View ${profileName(profiles[message.senderId])} profile`}
                            onPress={(event) => {
                              event.stopPropagation();
                              setProfileUserId(message.senderId);
                            }}
                            style={{
                              marginRight: 8,
                              alignSelf: 'flex-end',
                              minWidth: 44,
                              minHeight: 44,
                              justifyContent: 'flex-end',
                              alignItems: 'center',
                            }}
                          >
                            <Avatar
                              name={profileName(profiles[message.senderId])}
                              uri={profiles[message.senderId]?.avatarUrl ?? undefined}
                              online={profiles[message.senderId]?.online}
                              size={32}
                            />
                          </Pressable>
                        )}
                        <View
                          testID={`message-${message.id}`}
                          style={[
                            s.bubble,
                            mine ? s.outgoing : s.incoming,
                            visualMedia && s.mediaBubble,
                            (highlighted === message.id ||
                              (!wide &&
                                searchOpen &&
                                searchState.messages[searchIndex]?.id === message.id)) && {
                              backgroundColor: colors.highlight,
                            },
                          ]}
                        >
                          <MessageBubbleContent
                            visualMedia={visualMedia}
                            meta={messageMeta}
                            header={
                              hasMediaHeader && (
                                <>
                                  {!mine && chat.type === 'group' && (
                                    <Text style={s.sender}>
                                      {profileName(profiles[message.senderId])}
                                    </Text>
                                  )}
                                  {!!message.forwardedFrom && (
                                    <Text style={s.forwarded}>
                                      Forwarded from{' '}
                                      {profileName(profiles[message.forwardedFrom.senderId])}
                                    </Text>
                                  )}
                                  {!!message.replyToMessageId && (
                                    <ReplyPreview
                                      conversationId={id}
                                      messageId={message.replyToMessageId}
                                      onJump={(target) => void jumpToMessage(target)}
                                    />
                                  )}
                                </>
                              )
                            }
                            caption={
                              !!message.text && (
                                <MessageText
                                  text={message.text}
                                  style={s.messageText}
                                  onError={setError}
                                  onOpenUsername={(username) => void openUsername(username)}
                                  onMessagePress={(event) => openMessageMenu(message, event)}
                                />
                              )
                            }
                            reactions={
                              !!reactions.length && (
                                <View style={s.reactions}>
                                  {reactions.map((reaction) => (
                                    <Pressable
                                      key={reaction.emoji}
                                      accessibilityRole="button"
                                      accessibilityLabel={`${reaction.selected ? 'Remove' : 'Add'} ${reaction.emoji} reaction`}
                                      aria-selected={!!reaction.selected}
                                      accessibilityState={{
                                        selected: !!reaction.selected,
                                        disabled: busy,
                                      }}
                                      disabled={busy}
                                      onPress={(event) => {
                                        event.stopPropagation();
                                        void react(message, reaction.emoji);
                                      }}
                                      style={[s.reaction, reaction.selected && s.reactionSelected]}
                                    >
                                      <Text style={s.reactionText}>
                                        {reaction.emoji} {reaction.count}
                                      </Text>
                                    </Pressable>
                                  ))}
                                </View>
                              )
                            }
                          >
                            {message.upload ? (
                              <UploadMessage
                                upload={message.upload}
                                outbox={outbox}
                                localId={message.localId!}
                                failed={message.delivery === 'failed'}
                                onCancel={() => outbox.cancel(message.localId!)}
                                onRetry={() => outbox.retry(message.localId!)}
                              />
                            ) : message.attachment?.type === 'voice' ||
                              message.attachment?.type === 'music' ||
                              message.attachment?.type === 'audio' ? (
                              <VoiceMessage
                                kind={message.attachment.type}
                                onSeekingChange={onVoiceSeekingChange}
                                conversationId={id}
                                senderId={message.senderId}
                                mediaId={message.attachment.mediaId}
                                metadata={mediaMetadata}
                                active={
                                  focused &&
                                  !mobileSearchList &&
                                  !voiceActive &&
                                  !gifs &&
                                  visibleMessages.has(outbox.messageKey(message))
                                }
                                onOptions={(event) => openMessageMenu(message, event)}
                                onError={setError}
                              />
                            ) : message.attachment?.type === 'document' ? (
                              <DocumentMessage
                                conversationId={id}
                                mediaId={message.attachment.mediaId}
                                initialMetadata={mediaMetadata}
                                active={
                                  focused &&
                                  !mobileSearchList &&
                                  visibleMessages.has(outbox.messageKey(message))
                                }
                                onOptions={(event) => openMessageMenu(message, event)}
                                onError={setError}
                              />
                            ) : message.attachment?.type === 'video' ? (
                              <VideoCard
                                conversationId={id}
                                mediaId={message.attachment.mediaId}
                                initialMetadata={mediaMetadata}
                                active={
                                  focused &&
                                  !mobileSearchList &&
                                  visibleMessages.has(outbox.messageKey(message))
                                }
                                onPlay={() => {
                                  if (message.attachment?.type !== 'video') return;
                                  voicePlayback.pause();
                                  viewers.openVideo({
                                    conversationId: id,
                                    mediaId: message.attachment.mediaId,
                                    title,
                                  });
                                }}
                                onOptions={(event) => openMessageMenu(message, event)}
                                onError={setError}
                              />
                            ) : message.attachment ? (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Open ${message.attachment.type} attachment`}
                                onPress={(event) => {
                                  if (message.attachment?.type === 'image') {
                                    event.stopPropagation();
                                    viewers.openImage({
                                      conversationId: id,
                                      mediaId: message.attachment.mediaId,
                                      title: profileName(profiles[message.senderId]),
                                      createdAt: message.createdAt,
                                      caption: message.text,
                                      onForward: () => {
                                        setActionMessage(message);
                                        setForward(true);
                                      },
                                    });
                                  } else if (message.attachment?.type === 'gif') {
                                    event.stopPropagation();
                                    viewers.openGif({
                                      gifId: message.attachment.gifId,
                                      title: profileName(profiles[message.senderId]),
                                      createdAt: message.createdAt,
                                      caption: message.text,
                                      onForward: () => {
                                        setActionMessage(message);
                                        setForward(true);
                                      },
                                    });
                                  } else openMessageMenu(message, event);
                                }}
                                onLongPress={(event) => openMessageMenu(message, event)}
                                style={s.attachment}
                              >
                                {message.attachment.type === 'image' && (
                                  <AttachmentImage
                                    conversationId={id}
                                    mediaId={message.attachment.mediaId}
                                    initialMetadata={mediaMetadata}
                                  />
                                )}
                                {message.attachment.type === 'gif' && (
                                  <GifPreview
                                    gifId={message.attachment.gifId}
                                    initialMetadata={gifMetadata}
                                    active={
                                      focused &&
                                      !mobileSearchList &&
                                      !gifs &&
                                      visibleMessages.has(outbox.messageKey(message))
                                    }
                                  />
                                )}
                              </Pressable>
                            ) : null}
                          </MessageBubbleContent>
                        </View>
                      </Pressable>
                    </SwipeToReply>
                  </View>
                );
              }}
            />
          </View>
          {mobileSearchList && <View style={StyleSheet.absoluteFill}>{searchResults}</View>}
          {openingHistory && !mobileSearchList && (
            <View
              style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
            >
              <ActivityIndicator
                testID="chat-history-loading"
                accessibilityLabel="Loading conversation"
                color={colors.blue}
              />
            </View>
          )}
          <ScrollToLatestButton
            mention
            raised
            visible={
              !openingHistory &&
              !mobileSearchList &&
              (wide || !searchOpen) &&
              !!chat?.unseenMentions?.length
            }
            unreadCount={chat?.unseenMentions?.length ?? 0}
            disabled={jumping || seekingVoice || mentionBusy}
            onPress={() => void jumpToMention()}
          />
          <ScrollToLatestButton
            visible={
              !openingHistory &&
              (wide || !searchOpen) &&
              (awayFromBottom || (jumpWindow?.hasMoreAfter ?? hasNewer(id ?? '')))
            }
            unreadCount={unread[id ?? ''] ?? 0}
            disabled={jumping || seekingVoice || mentionBusy}
            onPressIn={scrollLoadedLatest}
            onPress={() => void showLatest()}
          />
        </View>
        {!wide && searchOpen && (
          <SearchNavigation
            state={searchState}
            index={searchIndex}
            list={searchList}
            busy={jumping}
            onList={() => {
              if (searchList && searchState.messages[searchIndex])
                void selectSearchResult(searchState.messages[searchIndex], searchIndex);
              else setSearchList(true);
            }}
            onOlder={() => {
              void olderSearchResult();
            }}
            onNewer={() => {
              if (searchState.messages[searchIndex - 1])
                void selectSearchResult(searchState.messages[searchIndex - 1], searchIndex - 1);
            }}
            onRetry={() => {
              void retrySearch();
            }}
          />
        )}
        <View style={[s.composerWrap, !wide && searchOpen && { display: 'none' }]}>
          <Notice text={error} onDismiss={() => setError('')} />
          {editing && (
            <View style={s.pending} testID="edit-composer">
              <Icon name="create-outline" color={colors.blue} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.blue, fontWeight: '600' }}>Edit message</Text>
                <Text numberOfLines={1} style={{ color: colors.dark }}>
                  {editing.text || 'Attachment caption'}
                </Text>
              </View>
              <IconButton
                name="close"
                label="Cancel edit"
                disabled={busy}
                onPress={() => setEditing(null)}
              />
            </View>
          )}
          {!editing && replyTo && (
            <View style={s.pending} testID="reply-composer">
              <View style={{ flex: 1 }}>
                <ReplyQuote
                  message={messageCache.peek(replyTo.conversationId, replyTo.id) ?? replyTo}
                />
              </View>
              <IconButton name="close" label="Cancel reply" onPress={() => setReplyTo(null)} />
            </View>
          )}
          {editing && (
            <MessageComposer
              key={editing.id}
              initialText={editing.text ?? ''}
              editing
              active={focused && (wide || !searchOpen)}
              busy={busy}
              hasAttachment={false}
              onSend={(text) => {
                void saveEdit(text);
                return false;
              }}
              onSendVoice={sendVoice}
              onAttach={() => {}}
              onError={setError}
              onVoiceActive={() => {}}
            />
          )}
          <View style={editing ? { display: 'none' } : undefined}>
            <MessageComposer
              active={focused && !editing && (wide || !searchOpen)}
              busy={busy}
              hasAttachment={false}
              onSend={(text) => send(undefined, text)}
              onSendVoice={sendVoice}
              onAttach={() => void upload().catch((err) => setError(err.message))}
              onPasteImage={(file) => {
                if (!id || busy || !focused) return;
                const sizeError = uploadSizeError(file.size);
                if (sizeError) return setError(sizeError);
                ++uploadSequence.current;
                setError('');
                setMediaDraft({
                  // The preview owns the blob URL created from this file.
                  asset: { uri: '', name: file.name || 'image.png', mimeType: file.type, file },
                  conversationId: id,
                  replyToMessageId: replyTo?.id,
                });
              }}
              onPickerVisibilityChange={setGifs}
              onSendGif={(gifId) => send(gifId)}
              onError={setError}
              onVoiceActive={(active) => {
                if (active) voicePlayback.pause();
                setVoiceActive(active);
              }}
            />
          </View>
        </View>
        {focused && mediaDraft && mediaDraft.conversationId === id && (
          <MediaSendPreview
            asset={mediaDraft.asset}
            onClose={() => setMediaDraft(undefined)}
            onSend={sendMedia}
          />
        )}
        <GroupDialog
          chat={chat}
          visible={focused && details}
          onClose={() => setDetails(false)}
          onViewUser={(userId) => {
            setDetails(false);
            setProfileUserId(userId);
          }}
        />
        {focused && profileUserId && (
          <UserProfileDialog
            key={profileUserId}
            userId={profileUserId}
            onClose={() => setProfileUserId(null)}
          />
        )}
        <Dialog visible={focused && forward} title="Forward to…" onClose={() => setForward(false)}>
          {conversations.map((destination) => (
            <Button
              key={destination.id}
              title={conversationName(
                destination,
                profiles[
                  members[destination.id]?.find((member) => member.userId !== session!.user.id)
                    ?.userId ?? ''
                ],
              )}
              secondary
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void api
                  .post<{ message: Message }>(`/api/conversations/${destination.id}/forward`, {
                    messageId: actionMessage!.id,
                  })
                  .then(({ message }) => {
                    acceptMessage(message);
                    setForward(false);
                    router.push(`/chat/${destination.id}`);
                  })
                  .catch((err) => {
                    setError(err.message);
                    setForward(false);
                  })
                  .finally(() => setBusy(false));
              }}
            />
          ))}
        </Dialog>
        <MessageMenu
          anchor={focused && actionsVisible ? actionAnchor : null}
          actions={messageActions}
          selected={EMOJIS.filter((emoji) =>
            actionMessage?.reactions?.some(
              (reaction) => reaction.userId === session!.user.id && reaction.emoji === emoji,
            ),
          )}
          busy={busy}
          onReact={(emoji) => {
            if (actionsVisible && actionMessage) void react(actionMessage, emoji);
          }}
          onClose={() => setActionsVisible(false)}
        />
      </View>
      {wide && searchOpen && (
        <View
          testID="desktop-message-search"
          style={{
            width: 360,
            borderLeftWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <View style={s.header}>
            <IconButton
              name="arrow-back"
              label="Close message search"
              onPress={() => changeSearch(null)}
            />
            <Text style={s.headerTitle}>Message Search</Text>
          </View>
          <SearchInput
            value={search}
            onChange={changeSearch}
            onSubmit={() => {
              void runSearch();
            }}
            onClose={() => changeSearch(null)}
          />
          {searchResults}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
const useStyles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.chatBackground },
  welcome: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.welcomeBackground,
    gap: 20,
    padding: 30,
  },
  welcomeIcon: {
    width: 136,
    height: 136,
    borderRadius: 45,
    backgroundColor: colors.welcomeIcon,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
    marginBottom: 4,
  },
  welcomeTitle: {
    color: colors.welcomeTitle,
    fontSize: 26,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  welcomeText: { color: colors.welcomeText, textAlign: 'center', lineHeight: 25, fontSize: 14 },
  welcomePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.welcomePill,
    marginTop: 12,
  },
  header: {
    height: 64,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 4,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  headerTitle: { color: colors.dark, fontSize: 16, fontWeight: '600' },
  headerSubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  // Inverted rows create transformed layers; clip them below the header border.
  historyViewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  history: { paddingHorizontal: 20, paddingVertical: 14 },
  messageRow: { flexDirection: 'row', marginBottom: 9 },
  bubble: {
    maxWidth: '85%',
    minWidth: 90,
    padding: 12,
    borderRadius: 15,
    boxShadow: '0 1px 2px #17212B0A',
  },
  // Match the preview's 10-point corners plus its 2-point inset on every side.
  mediaBubble: {
    padding: 2,
    borderRadius: 12,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  mediaMeta: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: '#00000066',
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  mediaTime: { color: 'white', fontSize: 11 },
  outgoing: { backgroundColor: colors.green, borderBottomRightRadius: 4 },
  incoming: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  messageText: { color: colors.messageText, fontSize: 15, lineHeight: 22 },
  sender: { color: colors.blue, fontSize: 12, fontWeight: '600', marginBottom: 7 },
  forwarded: {
    color: colors.forwarded,
    borderLeftWidth: 2,
    borderColor: colors.forwardBorder,
    paddingLeft: 8,
    fontSize: 12,
    marginBottom: 8,
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  time: { fontSize: 10, color: colors.time },
  date: { alignItems: 'center', marginVertical: 16 },
  dateText: {
    color: colors.dateText,
    backgroundColor: colors.dateBackground,
    fontSize: 11,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  emptyText: { color: colors.dateText, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  attachment: { gap: 10 },
  reactions: { flexDirection: 'row', gap: 5, flexWrap: 'wrap', paddingTop: 5 },
  reaction: {
    paddingVertical: 4,
    paddingHorizontal: 7,
    backgroundColor: '#3390EC12',
    borderRadius: 12,
  },
  reactionSelected: { backgroundColor: '#3390EC40' },
  reactionText: { color: colors.messageText, fontSize: 12 },
  composerWrap: { backgroundColor: colors.surface },
  pending: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingLeft: 14,
    backgroundColor: colors.pending,
    borderRadius: 12,
    marginBottom: 8,
  },
}));
