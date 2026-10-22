import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
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
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
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
import { VoiceRecordButton } from './VoiceRecordButton';
import type { RecordedVoice } from '../../lib/voice-recording.types';
import { voicePlayback } from '../../lib/voice-playback';
import { VideoCard } from './VideoCard';
import { VideoViewer } from './VideoViewer';
import { useVideos, videoKey, gifFileKey, voiceFileKey } from '../../context/VideosContext';
import { useMediaMetadata } from '../../context/MediaMetadataContext';
import { saveVideoFile } from '../../lib/video-download';
import { MessageMenu, type MessageMenuAction } from './MessageMenu';
import { ChatHistoryScrollView } from './ChatHistoryScrollView';

const renderChatHistoryScroll = (props: ScrollViewProps) => <ChatHistoryScrollView {...props} />;

export default function ChatView({ id }: { id?: string }) {
  const { session } = useSession();
  const { profiles } = useProfiles();
  const {
    conversations,
    messages,
    members,
    loading,
    activate,
    acceptMessage,
    loadMessages,
    hasOlder,
    messageCache,
  } = useChats();
  const chat = conversations.find((entry) => entry.id === id);
  const [jumpWindow, setJumpWindow] = useState<{
    messages: Message[];
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
  } | null>(null);
  const latest = messages[id ?? ''];
  const history = useMemo(
    () =>
      jumpWindow
        ? jumpWindow.messages.map((message) => messageCache.peek(id ?? '', message.id) ?? message)
        : (latest ?? []),
    [jumpWindow, latest, messageCache, id],
  );
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [jumping, setJumping] = useState(false);
  const jumpSequence = useRef(0);
  const scrollTarget = useRef<{ id: string; index: number; attempts: number } | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [draft, setDraft] = useState('');
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
  const mediaMetadata = useMediaMetadata();
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);
  const [visibleMessages, setVisibleMessages] = useState<Set<string>>(new Set());
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
      setVisibleMessages(new Set(viewableItems.map(({ item }) => item.id)));
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
    [setJumpTarget, setHighlighted],
  );
  const list = useRef<FlatList<Message>>(null);
  const onVoiceSeekingChange = useCallback((seeking: boolean) => {
    // Apply immediately to Android's native ScrollView, then keep the rendered
    // prop in sync so any intervening render preserves the lock.
    if (Platform.OS !== 'web') list.current?.setNativeProps({ scrollEnabled: !seeking });
    setSeekingVoice(seeking);
  }, []);
  const wide = useWindowDimensions().width >= 850;
  const peerId = id
    ? members[id]?.find((member) => member.userId !== session!.user.id)?.userId
    : undefined;
  const peer = chat?.type === 'private' && peerId ? profiles[peerId] : undefined;
  const title = chat ? conversationName(chat, peer) : '';
  useEffect(() => {
    activate(id ?? null);
    if (id) void loadMessages(id).catch((err) => setError(err.message));
    return () => activate(null);
  }, [id, activate, loadMessages]);
  const shown = useMemo(
    () =>
      [...history]
        .filter(
          (message) =>
            search === null || (message.text ?? '').toLowerCase().includes(search.toLowerCase()),
        )
        .reverse(),
    [history, search],
  );
  useEffect(() => {
    if (!jumpTarget) return;
    const index = shown.findIndex((message) => message.id === jumpTarget);
    if (index < 0) return;
    scrollTarget.current = { id: jumpTarget, index, attempts: 0 };
    const frame = requestAnimationFrame(() =>
      list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }),
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
  function showLatest() {
    jumpSequence.current++;
    setJumping(false);
    setLoadingHistory(false);
    setJumpWindow(null);
    setJumpTarget(null);
    scrollTarget.current = null;
    clearTimeout(scrollTimer.current);
    clearTimeout(highlightTimer.current);
    setHighlighted(null);
    setSearch(null);
    requestAnimationFrame(() => list.current?.scrollToOffset({ offset: 0, animated: false }));
  }
  async function expandWindow(older: boolean) {
    if (!id || !jumpWindow || loadingHistory) return;
    const sequence = jumpSequence.current;
    const edge = older ? jumpWindow.messages[0] : jumpWindow.messages.at(-1);
    if (!edge) return;
    setLoadingHistory(true);
    try {
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
              hasMoreBefore: older ? page.hasMoreBefore : current.hasMoreBefore,
              hasMoreAfter: older ? current.hasMoreAfter : page.hasMoreAfter,
            }
          : null,
      );
    } catch (err) {
      if (sequence === jumpSequence.current) setError((err as Error).message);
    } finally {
      if (sequence === jumpSequence.current) setLoadingHistory(false);
    }
  }
  async function send(gifId?: string) {
    if (!id || busy || (!draft.trim() && !attachment && !gifId)) return;
    setBusy(true);
    setError('');
    try {
      const { message } = await api.post<{ message: Message }>(
        `/api/conversations/${id}/messages`,
        {
          ...(draft.trim() && !gifId ? { text: draft.trim() } : {}),
          ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
          ...(gifId || attachment
            ? { attachment: gifId ? { type: 'gif', gifId } : attachment }
            : {}),
        },
      );
      acceptMessage(message);
      setReplyTo(null);
      showLatest();
      if (!gifId) {
        setDraft('');
        setAttachment(undefined);
        setAttachmentName('');
      }
      list.current?.scrollToOffset({ offset: 0, animated: true });
    } catch (err) {
      setError((err as Error).message);
      if (gifId) throw err;
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!id || busy) return;
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
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
      const { message } = await api.request<{ message: Message }>(
        `/api/conversations/${id}/messages`,
        {
          method: 'POST',
          signal,
          body: JSON.stringify({
            attachment: { type: 'voice', mediaId: media.id },
            ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
          }),
        },
      );
      acceptMessage(message);
      setReplyTo(null);
      showLatest();
    } finally {
      local?.dispose();
      setBusy(false);
    }
  }
  function openMessageMenu(message: Message, event: GestureResponderEvent) {
    event.stopPropagation();
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
  const messageActions: MessageMenuAction[] = [
    {
      label: 'Reply',
      icon: 'arrow-undo-outline',
      onPress: () => {
        setReplyTo(actionMessage);
        setActionsVisible(false);
      },
    },
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
      {jumpWindow && (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            padding: 8,
            backgroundColor: 'white',
            justifyContent: 'center',
          }}
        >
          <Button title="Back to latest messages" secondary onPress={showLatest} />
          {jumpWindow.hasMoreAfter && (
            <Button
              title="Load newer messages"
              secondary
              busy={loadingHistory}
              onPress={() => void expandWindow(false)}
            />
          )}
        </View>
      )}
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
        onViewableItemsChanged={onViewableItemsChanged}
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
            setError('Could not scroll to the message. Tap the reply to try again.');
          }
        }}
        ListFooterComponent={
          <View style={{ alignItems: 'center', padding: 14, gap: 10 }}>
            {(jumpWindow ? jumpWindow.hasMoreBefore : hasOlder(id)) && (
              <Button
                title="Load earlier messages"
                secondary
                busy={loadingHistory}
                onPress={() => {
                  if (jumpWindow) {
                    void expandWindow(true);
                    return;
                  }
                  setLoadingHistory(true);
                  void loadMessages(id, true)
                    .catch((err) => setError(err.message))
                    .finally(() => setLoadingHistory(false));
                }}
              />
            )}
            {!history.length && (
              <Text style={s.emptyText}>Say hello. This is the start of your conversation.</Text>
            )}
            {search !== null && !shown.length && (
              <Text style={s.emptyText}>No matching messages.</Text>
            )}
          </View>
        }
        renderItem={({ item: message, index }) => {
          const mine = message.senderId === session!.user.id;
          const older = shown[index + 1];
          const dateStart =
            !older ||
            new Date(older.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
          const reactions = EMOJIS.map((emoji) => ({
            emoji,
            count: message.reactions?.filter((reaction) => reaction.emoji === emoji).length ?? 0,
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
                      mediaId={message.attachment.mediaId}
                      active={
                        !voiceActive && !playingVideo && !gifs && visibleMessages.has(message.id)
                      }
                      onOptions={(event) => openMessageMenu(message, event)}
                      onError={setError}
                    />
                  ) : message.attachment?.type === 'video' ? (
                    <VideoCard
                      conversationId={id}
                      mediaId={message.attachment.mediaId}
                      active={!playingVideo && visibleMessages.has(message.id)}
                      onPlay={() =>
                        setPlayingVideo(
                          message.attachment!.type === 'video' ? message.attachment!.mediaId : null,
                        )
                      }
                      onOptions={(event) => openMessageMenu(message, event)}
                      onError={setError}
                    />
                  ) : message.attachment ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${message.attachment.type} attachment`}
                      onPress={(event) => openMessageMenu(message, event)}
                      onLongPress={(event) => openMessageMenu(message, event)}
                      style={s.attachment}
                    >
                      {message.attachment.type === 'image' && (
                        <AttachmentImage conversationId={id} mediaId={message.attachment.mediaId} />
                      )}
                      {message.attachment.type === 'gif' && (
                        <GifPreview
                          gifId={message.attachment.gifId}
                          active={!gifs && !playingVideo && visibleMessages.has(message.id)}
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
                      <Text style={s.time}>{timeLabel(message.createdAt)}</Text>
                      {mine && <Icon name="checkmark" size={15} color="#6D9D62" />}
                      {message.attachment && (
                        <Icon name="ellipsis-horizontal" size={18} color={colors.muted} />
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
      <View style={s.composerWrap}>
        {!!error && (
          <View style={{ paddingHorizontal: 10, paddingBottom: 8 }}>
            <Notice text={error} />
          </View>
        )}
        {replyTo && (
          <View style={s.pending} testID="reply-composer">
            <View style={{ flex: 1 }}>
              <ReplyQuote message={replyTo} />
            </View>
            <IconButton name="close" label="Cancel reply" onPress={() => setReplyTo(null)} />
          </View>
        )}
        {attachment && (
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
        <View style={s.composer}>
          <IconButton
            name="attach-outline"
            label="Attach a file"
            disabled={busy || voiceActive}
            onPress={() => void upload().catch((err) => setError(err.message))}
          />
          <TextInput
            accessibilityLabel="Message"
            editable={!busy && !voiceActive}
            multiline
            placeholder="Write a message…"
            placeholderTextColor="#96A3B0"
            value={draft}
            onChangeText={setDraft}
            maxLength={10000}
            style={s.messageInput}
            onKeyPress={(event) => {
              if (
                Platform.OS === 'web' &&
                event.nativeEvent.key === 'Enter' &&
                !(event.nativeEvent as unknown as { shiftKey: boolean }).shiftKey
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <IconButton
            name="happy-outline"
            label="Open GIF library"
            disabled={busy || voiceActive}
            onPress={() => setGifs(true)}
          />
          {!draft.trim() && !attachment ? (
            <VoiceRecordButton
              disabled={busy}
              onSend={sendVoice}
              onError={setError}
              onActive={(active) => {
                if (active) voicePlayback.pause();
                setVoiceActive(active);
              }}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={busy || (!draft.trim() && !attachment)}
              onPress={() => void send()}
              style={[s.send, (busy || (!draft.trim() && !attachment)) && { opacity: 0.45 }]}
            >
              {busy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Icon name="send" color="white" size={20} />
              )}
            </Pressable>
          )}
        </View>
        <Text style={s.composerHint}>
          {Platform.OS === 'web'
            ? 'Enter to send · Shift + Enter for a new line'
            : 'A little hello goes a long way'}
        </Text>
      </View>
      {playingVideo && (
        <VideoViewer
          conversationId={id}
          mediaId={playingVideo}
          title={title}
          onClose={() => setPlayingVideo(null)}
        />
      )}
      <GroupDialog chat={chat} visible={details} onClose={() => setDetails(false)} />
      <GifDialog visible={gifs} onClose={() => setGifs(false)} onSend={send} />
      <Dialog visible={forward} title="Forward to…" onClose={() => setForward(false)}>
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
        anchor={actionsVisible ? actionAnchor : null}
        actions={messageActions}
        selected={EMOJIS.filter((emoji) =>
          actionMessage?.reactions?.some(
            (reaction) => reaction.userId === session!.user.id && reaction.emoji === emoji,
          ),
        )}
        busy={busy}
        onReact={(emoji) => void react(emoji)}
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
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    padding: 7,
    borderRadius: 17,
    backgroundColor: 'white',
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
  },
  messageInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingVertical: 12,
    paddingHorizontal: 6,
    fontSize: 15,
    color: colors.dark,
    outlineWidth: 0,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerHint: {
    color: '#9AAAB7',
    fontSize: 10,
    textAlign: 'center',
    paddingTop: 9,
    paddingBottom: 2,
  },
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
