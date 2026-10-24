import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  TextInput,
  useWindowDimensions,
  View,
  type ViewToken,
  type GestureResponderEvent,
  type ScrollViewProps,
} from 'react-native';
import { router, useIsFocused } from 'expo-router';
import { pickUpload } from '../../lib/pick-upload';
import * as Clipboard from 'expo-clipboard';
import { api, useSession } from '../../context/SessionContext';
import { useChats } from '../../context/ChatsContext';
import {
  Avatar,
  Button,
  colors,
  Dialog,
  Icon,
  IconButton,
  Notice,
  styles,
} from '../../components/ui';
import {
  EMOJIS,
  type Attachment,
  type AttachmentMetadata,
  type Emoji,
  type Gif,
  type Message,
} from '../../api/types';
import { conversationName, profileName, timeLabel, mergeMessages } from '../../lib/messages';
import { useProfiles } from '../../context/ProfilesContext';
import { retainUpload, saveLocalFile } from '../../lib/local-attachments';
import type { VideoFile } from '../../api/video-cache';
import { fileForm } from '../../lib/uploads';
import { downloadAttachment } from '../../lib/download';
import { AttachmentImage } from './AttachmentImage';
import { GroupDialog } from './GroupDialog';
import { GifDialog } from './GifDialog';
import { MessageText } from './MessageText';
import { GifPreview } from './GifPreview';
import { useGifs } from '../../context/GifsContext';
import { ReplyPreview, ReplyQuote } from './ReplyPreview';
import { VoiceMessage } from './VoiceMessage';
import { MessageComposer } from './MessageComposer';
import type { RecordedVoice } from '../../lib/voice-recording.types';
import { useVoicePlayback } from '../../context/VoicePlaybackContext';
import { VoiceMiniPlayer } from './VoiceMiniPlayer';
import { VideoCard } from './VideoCard';
import { useMediaViewers } from './MediaViewers';
import { useVideos, videoKey, gifFileKey, voiceFileKey } from '../../context/VideosContext';
import { useMediaMetadata } from '../../context/MediaMetadataContext';
import { saveVideoFile } from '../../lib/video-download';
import { videoTime } from '../../lib/video-download.types';
import { MessageMenu, type MessageMenuAction } from './MessageMenu';
import { ChatHistoryScrollView } from './ChatHistoryScrollView';
import { comparePosition } from '../../api/read-state';
import { messageGif, messageMedia } from '../../lib/message-attachment';
import { seenByAnotherMember } from '../../api/receipts';
import { captureHistoryAnchor } from '../../lib/history-anchor';
import { ChatTailFollow } from '../../lib/chat-tail-follow';
import { ScrollToLatestButton } from './ScrollToLatestButton';

const readViewabilityConfig = { minimumViewTime: 350, viewAreaCoveragePercentThreshold: 60 };

export default function ChatView({ id, active }: { id?: string; active: boolean }) {
  const { session } = useSession();
  const { profiles } = useProfiles();
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
  } = useChats();
  const voicePlayback = useVoicePlayback();
  const routeFocused = useIsFocused();
  const focused = active && routeFocused;
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
  const [gifs, setGifs] = useState(false);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [forward, setForward] = useState(false);
  const [actionAnchor, setActionAnchor] = useState<{ x: number; y: number } | null>(null);
  const [attachment, setAttachment] = useState<Attachment | undefined>();
  const [attachmentName, setAttachmentName] = useState('');
  const [search, setSearch] = useState<string | null>(null);
  const gifCache = useGifs();
  const videoCache = useVideos();
  const viewers = useMediaViewers();
  const mediaMetadata = useMediaMetadata();
  const [visibleMessages, setVisibleMessages] = useState<Set<string>>(new Set());
  const [openingHistory, setOpeningHistory] = useState(true);
  const initialReadTarget = useRef<string | null>(null);
  useEffect(() => {
    const report = () => {
      if (
        !id ||
        openingHistory ||
        !focused ||
        details ||
        gifs ||
        viewers.isOpen() ||
        actionsVisible
      )
        return;
      readVisible(
        id,
        history.filter((message) => visibleMessages.has(message.id)),
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
    gifs,
    viewers,
    actionsVisible,
    readVisible,
    history,
    visibleMessages,
    jumpWindow,
    hasOlder,
    hasNewer,
  ]);
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
      setVisibleMessages(new Set(viewableItems.map(({ item }) => item.id)));
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
    [setJumpTarget, setHighlighted, setOpeningHistory],
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
  const wide = useWindowDimensions().width >= 850;
  const peerId = id
    ? members[id]?.find((member) => member.userId !== session!.user.id)?.userId
    : undefined;
  const peer = chat?.type === 'private' && peerId ? profiles[peerId] : undefined;
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
    () =>
      mergeMessages(history, outgoing[id ?? ''] ?? [])
        .filter(
          (message) =>
            search === null || (message.text ?? '').toLowerCase().includes(search.toLowerCase()),
        )
        .reverse(),
    [history, search, outgoing, id],
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
  async function jumpToMessage(messageId: string) {
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
      setSearch(null);
      setJumpTarget(messageId);
      setHighlighted(messageId);
      clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => {
        setHighlighted(null);
        setJumpTarget(null);
        scrollTarget.current = null;
      }, 3000);
    } catch (err) {
      if (sequence === jumpSequence.current) setError((err as Error).message);
    } finally {
      if (sequence === jumpSequence.current) setJumping(false);
    }
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
    setSearch(null);
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
      if (!id || openingHistory || jumping || jumpTarget || !focused || search !== null) return;
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
      search,
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
    if (!id || busy || (!text.trim() && !attachment && !gifId)) return false;
    setError('');
    outbox.enqueue(id, {
      ...(text.trim() && !gifId ? { text: text.trim() } : {}),
      ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
      ...(gifId || attachment ? { attachment: gifId ? { type: 'gif', gifId } : attachment } : {}),
    });
    setReplyTo(null);
    if (!gifId) {
      setAttachment(undefined);
      setAttachmentName('');
    }
    void showLatest();
    return true;
  }
  async function upload() {
    if (!id || busy) return;
    const picked = await pickUpload();
    if (picked.canceled) return;
    const file = picked.assets[0];
    if ((file.size ?? 0) > 50 * 1024 * 1024) return setError('Choose a file smaller than 50 MB.');
    setBusy(true);
    setError('');
    let local: VideoFile | undefined;
    try {
      local = await retainUpload(file);
      if (file.mimeType === 'image/gif') {
        const body = await fileForm('gif', { ...file, uri: local.uri });
        const { gif } = await api.request<{ gif: Gif }>('/api/gifs', {
          method: 'POST',
          body,
          signal: AbortSignal.timeout(120000),
        });
        gifCache.remember(gif);
        videoCache.remember(gifFileKey(gif.id), local);
        local = undefined;
        setAttachment({ type: 'gif', gifId: gif.id });
      } else {
        const body = await fileForm('file', { ...file, uri: local.uri });
        const { attachment: media } = await api.request<{
          attachment: AttachmentMetadata;
        }>(`/api/conversations/${id}/attachments`, {
          method: 'POST',
          body,
          signal: AbortSignal.timeout(120000),
        });
        mediaMetadata.remember(id, media);
        videoCache.remember(videoKey(id, media.id), local);
        local = undefined;
        setAttachment({ type: media.type, mediaId: media.id });
      }
      setAttachmentName(file.name);
    } catch (err) {
      local?.dispose();
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendVoice(voice: RecordedVoice, signal: AbortSignal) {
    if (!id) return;
    setBusy(true);
    setError('');
    let local: VideoFile | undefined;
    try {
      local = await retainUpload(voice.asset);
      if (local.bytes > 50 * 1024 * 1024)
        throw new Error('Voice messages must be smaller than 50 MB.');
      const body = await fileForm('file', { ...voice.asset, uri: local.uri });
      body.append('kind', 'voice');
      const { attachment: media } = await api.request<{ attachment: AttachmentMetadata }>(
        `/api/conversations/${id}/attachments`,
        { method: 'POST', body, signal },
      );
      mediaMetadata.remember(id, media);
      videoCache.remember(voiceFileKey(id, media.id), { ...local, duration: voice.duration });
      local = undefined;
      outbox.enqueue(id, {
        attachment: { type: 'voice', mediaId: media.id },
        ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
      });
      setReplyTo(null);
      void showLatest();
    } finally {
      local?.dispose();
      setBusy(false);
    }
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
  async function react(emoji: Emoji) {
    if (!actionsVisible || !actionMessage || !id || busy) return;
    const message = actionMessage;
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
                  label: 'Copy',
                  icon: 'copy-outline' as const,
                  onPress: () => {
                    const text = actionMessage.text!;
                    setActionsVisible(false);
                    void Clipboard.setStringAsync(text).catch((err) => setError(err.message));
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
                    if (id && attachment.type === 'voice')
                      void videoCache
                        .get(voiceFileKey(id, attachment.mediaId))
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
        <Text style={s.welcomeText}>
          Choose a conversation and make someone’s day.{'\n'}Your next great conversation is a hello
          away.
        </Text>
        <View style={s.welcomePill}>
          <Icon name="chatbubbles-outline" size={16} color="#6B8BA9" />
          <Text style={{ fontSize: 12, color: '#6B8BA9' }}>A space for your people</Text>
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
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        {!wide && (
          <IconButton name="arrow-back" label="Back to chats" onPress={() => router.replace('/')} />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View conversation details"
          onPress={() => setDetails(true)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}
        >
          <Avatar name={title} uri={peer?.avatarUrl ?? undefined} size={44} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={s.headerTitle}>
              {title}
            </Text>
            <Text style={s.headerSubtitle}>
              {chat.type === 'group'
                ? `${members[id]?.length ?? 0} members`
                : peer?.username
                  ? `@${peer.username}`
                  : 'Private conversation'}
            </Text>
          </View>
        </Pressable>
        <IconButton
          name="search-outline"
          label="Search messages"
          onPress={() => setSearch(search === null ? '' : null)}
        />
        <IconButton
          name="ellipsis-vertical"
          label="Conversation details"
          onPress={() => setDetails(true)}
        />
      </View>
      {active && <VoiceMiniPlayer />}
      {search !== null && (
        <View style={s.search}>
          <TextInput
            accessibilityLabel="Search messages"
            autoFocus
            placeholder="Search in this conversation"
            value={search}
            onChangeText={setSearch}
            style={{ flex: 1, padding: 12, fontSize: 15, color: colors.dark }}
          />
          <IconButton name="close" label="Close search" onPress={() => setSearch(null)} />
        </View>
      )}
      {jumping && (
        <ActivityIndicator
          accessibilityLabel="Loading replied message"
          color={colors.blue}
          style={{ padding: 8 }}
        />
      )}
      <View style={{ flex: 1 }}>
        <View
          testID="positioned-chat-history"
          style={{ flex: 1, opacity: openingHistory ? 0 : 1 }}
          pointerEvents={openingHistory ? 'none' : 'auto'}
          accessibilityElementsHidden={openingHistory}
          importantForAccessibility={openingHistory ? 'no-hide-descendants' : 'auto'}
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
            keyExtractor={(message) => message.id}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={cancelPositioning}
            onLayout={() => tailFollow.layout()}
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
              historyMetrics.current.height = height;
              tailFollow.layout();
              loadVisibleEdges();
            }}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              const target = scrollTarget.current;
              if (!target || target.index !== index) return;
              list.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
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
                {search !== null && !shown.length && (
                  <Text style={s.emptyText}>No matching messages.</Text>
                )}
              </View>
            }
            renderItem={({ item: message, index }) => {
              const mine = message.senderId === session!.user.id;
              const mediaMetadata = messageMedia(message);
              const gifMetadata = messageGif(message);
              const older = shown[index + 1];
              const dateStart =
                !older ||
                new Date(older.createdAt).toDateString() !==
                  new Date(message.createdAt).toDateString();
              const reactions = EMOJIS.map((emoji) => ({
                emoji,
                count:
                  message.reactions?.filter((reaction) => reaction.emoji === emoji).length ?? 0,
              })).filter((entry) => entry.count);
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
                  <Pressable
                    accessible={false}
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
                      <View style={{ marginRight: 8, alignSelf: 'flex-end' }}>
                        <Avatar
                          name={profileName(profiles[message.senderId])}
                          uri={profiles[message.senderId]?.avatarUrl ?? undefined}
                          size={32}
                        />
                      </View>
                    )}
                    <View
                      testID={`message-${message.id}`}
                      style={[
                        s.bubble,
                        mine ? s.outgoing : s.incoming,
                        highlighted === message.id && { backgroundColor: '#FFF0B3' },
                      ]}
                    >
                      {!mine && chat.type === 'group' && (
                        <Text style={s.sender}>{profileName(profiles[message.senderId])}</Text>
                      )}
                      {!!message.forwardedFrom && (
                        <Text style={s.forwarded}>
                          Forwarded from {profileName(profiles[message.forwardedFrom.senderId])}
                        </Text>
                      )}
                      {!!message.replyToMessageId && (
                        <ReplyPreview
                          conversationId={id}
                          messageId={message.replyToMessageId}
                          onJump={(target) => void jumpToMessage(target)}
                        />
                      )}
                      {message.attachment?.type === 'voice' ? (
                        <VoiceMessage
                          onSeekingChange={onVoiceSeekingChange}
                          conversationId={id}
                          senderId={message.senderId}
                          mediaId={message.attachment.mediaId}
                          metadata={mediaMetadata}
                          active={
                            focused && !voiceActive && !gifs && visibleMessages.has(message.id)
                          }
                          onOptions={(event) => openMessageMenu(message, event)}
                          onError={setError}
                        />
                      ) : message.attachment?.type === 'video' ? (
                        <VideoCard
                          conversationId={id}
                          mediaId={message.attachment.mediaId}
                          initialMetadata={mediaMetadata}
                          active={focused && visibleMessages.has(message.id)}
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
                              active={focused && !gifs && visibleMessages.has(message.id)}
                            />
                          )}
                          {!['image', 'gif'].includes(message.attachment.type) && (
                            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                              <Icon
                                name={
                                  ['audio', 'music'].includes(message.attachment.type)
                                    ? 'musical-notes-outline'
                                    : 'document-outline'
                                }
                                color={colors.blue}
                              />
                              <Text style={{ color: '#3974A8', fontSize: 13 }}>
                                {message.attachment.type}
                                {message.attachment.type === 'music' &&
                                mediaMetadata?.durationSeconds
                                  ? ` · ${videoTime(mediaMetadata.durationSeconds)}`
                                  : ''}
                              </Text>
                            </View>
                          )}
                        </Pressable>
                      ) : null}
                      {!!message.text && (
                        <MessageText
                          text={message.text}
                          style={s.messageText}
                          onError={setError}
                          onMessagePress={(event) => openMessageMenu(message, event)}
                        />
                      )}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Message actions"
                        onPress={(event) => openMessageMenu(message, event)}
                        onLongPress={(event) => openMessageMenu(message, event)}
                      >
                        <View style={s.meta}>
                          <Text style={s.time}>
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
                                    : seenByAnotherMember(
                                          message,
                                          session!.user.id,
                                          receiptPositions,
                                        )
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
                                      : seenByAnotherMember(
                                            message,
                                            session!.user.id,
                                            receiptPositions,
                                          )
                                        ? 'checkmark-done'
                                        : 'checkmark'
                                  }
                                  size={15}
                                  color={message.delivery === 'sending' ? colors.muted : '#6D9D62'}
                                />
                              )}
                            </View>
                          )}
                        </View>
                        {!!reactions.length && (
                          <View style={s.reactions}>
                            {reactions.map((reaction) => (
                              <Text key={reaction.emoji} style={s.reaction}>
                                {reaction.emoji} {reaction.count}
                              </Text>
                            ))}
                          </View>
                        )}
                      </Pressable>
                    </View>
                  </Pressable>
                </View>
              );
            }}
          />
        </View>
        {openingHistory && (
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
          visible={
            !openingHistory &&
            search === null &&
            (awayFromBottom || (jumpWindow?.hasMoreAfter ?? hasNewer(id ?? '')))
          }
          unreadCount={unread[id ?? ''] ?? 0}
          disabled={jumping || seekingVoice}
          onPressIn={scrollLoadedLatest}
          onPress={() => void showLatest()}
        />
      </View>
      <View style={s.composerWrap}>
        {!!error && (
          <View style={{ paddingHorizontal: 10, paddingBottom: 8 }}>
            <Notice text={error} />
          </View>
        )}
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
        {!editing && attachment && (
          <View style={s.pending}>
            <Icon name="attach-outline" color={colors.blue} />
            <Text numberOfLines={1} style={{ flex: 1, color: colors.dark }}>
              {attachmentName}
            </Text>
            <IconButton
              name="close"
              label="Remove attachment"
              onPress={() => {
                setAttachment(undefined);
                setAttachmentName('');
              }}
            />
          </View>
        )}
        {editing && (
          <MessageComposer
            key={editing.id}
            initialText={editing.text ?? ''}
            editing
            active={focused}
            busy={busy}
            hasAttachment={false}
            onSend={(text) => {
              void saveEdit(text);
              return false;
            }}
            onSendVoice={sendVoice}
            onAttach={() => {}}
            onOpenGifs={() => {}}
            onError={setError}
            onVoiceActive={() => {}}
          />
        )}
        <View style={editing ? { display: 'none' } : undefined}>
          <MessageComposer
            active={focused}
            busy={busy}
            hasAttachment={!!attachment}
            onSend={(text) => send(undefined, text)}
            onSendVoice={sendVoice}
            onAttach={() => void upload().catch((err) => setError(err.message))}
            onOpenGifs={() => setGifs(true)}
            onError={setError}
            onVoiceActive={(active) => {
              if (active) voicePlayback.pause();
              setVoiceActive(active);
            }}
          />
        </View>
      </View>
      <GroupDialog chat={chat} visible={focused && details} onClose={() => setDetails(false)} />
      <GifDialog
        visible={focused && gifs}
        onClose={() => setGifs(false)}
        onSend={async (gifId) => {
          await send(gifId);
        }}
      />
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
          if (!actionMessage?.delivery) void react(emoji);
        }}
        onClose={() => setActionsVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E8EFF3' },
  welcome: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EDF3F7',
    gap: 20,
    padding: 30,
  },
  welcomeIcon: {
    width: 136,
    height: 136,
    borderRadius: 45,
    backgroundColor: '#DDECF8',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
    marginBottom: 4,
  },
  welcomeTitle: { color: '#3C566E', fontSize: 26, fontWeight: '600', letterSpacing: -0.5 },
  welcomeText: { color: '#8599AB', textAlign: 'center', lineHeight: 25, fontSize: 14 },
  welcomePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#DFEAF2',
    marginTop: 12,
  },
  header: {
    height: 78,
    backgroundColor: 'white',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 4,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  headerTitle: { color: colors.dark, fontSize: 16, fontWeight: '600' },
  headerSubtitle: { color: colors.muted, fontSize: 12, marginTop: 4 },
  search: {
    backgroundColor: 'white',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  history: { paddingHorizontal: 20, paddingVertical: 14 },
  messageRow: { flexDirection: 'row', marginBottom: 9 },
  bubble: {
    maxWidth: '85%',
    minWidth: 90,
    padding: 12,
    borderRadius: 15,
    boxShadow: '0 1px 2px #17212B0A',
  },
  outgoing: { backgroundColor: colors.green, borderBottomRightRadius: 4 },
  incoming: { backgroundColor: 'white', borderBottomLeftRadius: 4 },
  messageText: { color: '#243444', fontSize: 15, lineHeight: 22 },
  sender: { color: colors.blue, fontSize: 12, fontWeight: '600', marginBottom: 7 },
  forwarded: {
    color: '#68A35C',
    borderLeftWidth: 2,
    borderColor: '#8BBC80',
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
  time: { fontSize: 10, color: '#8C9B91' },
  date: { alignItems: 'center', marginVertical: 16 },
  dateText: {
    color: '#7F96A7',
    backgroundColor: '#DCE6EC',
    fontSize: 11,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  emptyText: { color: '#7F96A7', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  attachment: { gap: 10 },
  reactions: { flexDirection: 'row', gap: 5, flexWrap: 'wrap', paddingTop: 5 },
  reaction: {
    paddingVertical: 4,
    paddingHorizontal: 7,
    backgroundColor: '#3390EC12',
    borderRadius: 12,
    fontSize: 12,
  },
  composerWrap: { padding: 14, paddingBottom: 8, backgroundColor: '#E8EFF3' },
  pending: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingLeft: 14,
    backgroundColor: '#F4F9FD',
    borderRadius: 12,
    marginBottom: 8,
  },
});
