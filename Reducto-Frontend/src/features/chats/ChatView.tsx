import { useEffect, useRef, useState } from 'react';
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
import { EMOJIS, type Attachment, type Emoji, type Message } from '../../api/types';
import { conversationName, profileName, timeLabel } from '../../lib/messages';
import { useProfiles } from '../../context/ProfilesContext';
import { fileForm } from '../../lib/uploads';
import { downloadAttachment } from '../../lib/download';
import { AttachmentImage } from './AttachmentImage';
import { GroupDialog } from './GroupDialog';
import { GifDialog } from './GifDialog';

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
  } = useChats();
  const chat = conversations.find((entry) => entry.id === id);
  const history = messages[id ?? ''] ?? [];
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(false);
  const [gifs, setGifs] = useState(false);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [forward, setForward] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | undefined>();
  const [attachmentName, setAttachmentName] = useState('');
  const [search, setSearch] = useState<string | null>(null);
  const list = useRef<FlatList<Message>>(null);
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
  async function send(gifId?: string) {
    if (!id || busy || (!draft.trim() && !attachment && !gifId)) return;
    setBusy(true);
    setError('');
    try {
      const { message } = await api.post<{ message: Message }>(
        `/api/conversations/${id}/messages`,
        {
          ...(draft.trim() && !gifId ? { text: draft.trim() } : {}),
          ...(gifId || attachment
            ? { attachment: gifId ? { type: 'gif', gifId } : attachment }
            : {}),
        },
      );
      acceptMessage(message);
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
    try {
      if (file.mimeType === 'image/gif') {
        const body = await fileForm('gif', file);
        const { gif } = await api.request<{ gif: { id: string } }>('/api/gifs', {
          method: 'POST',
          body,
          signal: AbortSignal.timeout(120000),
        });
        setAttachment({ type: 'gif', gifId: gif.id });
      } else {
        const body = await fileForm('file', file);
        const { attachment: media } = await api.request<{
          attachment: { id: string; type: Exclude<Attachment['type'], 'gif'> };
        }>(`/api/conversations/${id}/attachments`, {
          method: 'POST',
          body,
          signal: AbortSignal.timeout(120000),
        });
        setAttachment({ type: media.type, mediaId: media.id });
      }
      setAttachmentName(file.name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function react(emoji: Emoji) {
    if (!actionMessage || !id || busy) return;
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
      await loadMessages(id);
      setActionMessage(null);
    } catch (err) {
      setError((err as Error).message);
      setActionMessage(null);
    } finally {
      setBusy(false);
    }
  }
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
  const shown = [...history]
    .filter(
      (message) =>
        search === null || (message.text ?? '').toLowerCase().includes(search.toLowerCase()),
    )
    .reverse();
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
      <FlatList
        ref={list}
        style={{ flex: 1 }}
        contentContainerStyle={s.history}
        inverted
        data={shown}
        keyExtractor={(message) => message.id}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={
          <View style={{ alignItems: 'center', padding: 14, gap: 10 }}>
            {hasOlder(id) && (
              <Button
                title="Load earlier messages"
                secondary
                busy={loadingHistory}
                onPress={() => {
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
              <View style={[s.messageRow, mine && { justifyContent: 'flex-end' }]}>
                {!mine && chat.type === 'group' && (
                  <View style={{ marginRight: 8, alignSelf: 'flex-end' }}>
                    <Avatar
                      name={profileName(profiles[message.senderId])}
                      uri={profiles[message.senderId]?.avatarUrl ?? undefined}
                      size={32}
                    />
                  </View>
                )}
                <View style={[s.bubble, mine ? s.outgoing : s.incoming]}>
                  {!mine && chat.type === 'group' && (
                    <Text style={s.sender}>{profileName(profiles[message.senderId])}</Text>
                  )}
                  {!!message.forwardedFrom && (
                    <Text style={s.forwarded}>
                      Forwarded from {profileName(profiles[message.forwardedFrom.senderId])}
                    </Text>
                  )}
                  {message.attachment && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${message.attachment.type} attachment`}
                      onPress={() => {
                        if (message.attachment!.type === 'gif') {
                          void Clipboard.setStringAsync(message.attachment!.gifId)
                            .then(() => {
                              setError('');
                              setActionMessage(message);
                              setForward(false);
                            })
                            .catch((err) => setError(err.message));
                        } else
                          void downloadAttachment(id, message.attachment!.mediaId).catch((err) =>
                            setError(err.message),
                          );
                      }}
                      onLongPress={() => {
                        setActionMessage(message);
                        setForward(false);
                      }}
                      style={s.attachment}
                    >
                      {message.attachment.type === 'image' && (
                        <AttachmentImage conversationId={id} mediaId={message.attachment.mediaId} />
                      )}
                      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                        <Icon
                          name={
                            message.attachment.type === 'gif' || message.attachment.type === 'video'
                              ? 'play-circle-outline'
                              : message.attachment.type === 'audio' ||
                                  message.attachment.type === 'music'
                                ? 'musical-notes-outline'
                                : 'document-outline'
                          }
                          color={colors.blue}
                        />
                        <Text style={{ color: '#3974A8', fontSize: 13 }}>
                          {message.attachment.type === 'gif'
                            ? 'GIF · tap for options'
                            : `${message.attachment.type} · tap to download`}
                        </Text>
                      </View>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Message actions"
                    onPress={() => {
                      setActionMessage(message);
                      setForward(false);
                    }}
                    onLongPress={() => {
                      setActionMessage(message);
                      setForward(false);
                    }}
                    style={
                      message.attachment && !message.text
                        ? { minHeight: 44, justifyContent: 'center' }
                        : undefined
                    }
                  >
                    {!!message.text && (
                      <Text selectable style={s.messageText}>
                        {message.text}
                      </Text>
                    )}
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
              </View>
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
            disabled={busy}
            onPress={() => void upload().catch((err) => setError(err.message))}
          />
          <TextInput
            accessibilityLabel="Message"
            editable={!busy}
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
            disabled={busy}
            onPress={() => setGifs(true)}
          />
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
        </View>
        <Text style={s.composerHint}>
          {Platform.OS === 'web'
            ? 'Enter to send · Shift + Enter for a new line'
            : 'A little hello goes a long way'}
        </Text>
      </View>
      <GroupDialog chat={chat} visible={details} onClose={() => setDetails(false)} />
      <GifDialog visible={gifs} onClose={() => setGifs(false)} onSend={send} />
      <Dialog
        visible={!!actionMessage}
        title={forward ? 'Forward to…' : 'Message options'}
        onClose={() => setActionMessage(null)}
      >
        {forward ? (
          conversations.map((destination) => (
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
                    setActionMessage(null);
                    router.push(`/chat/${destination.id}`);
                  })
                  .catch((err) => {
                    setError(err.message);
                    setActionMessage(null);
                  })
                  .finally(() => setBusy(false));
              }}
            />
          ))
        ) : (
          <>
            <Text style={styles.subtitle}>
              React to this message. Tap an existing reaction to remove yours.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {EMOJIS.map((emoji) => (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={`React ${emoji}`}
                  disabled={busy}
                  onPress={() => void react(emoji)}
                  style={{
                    padding: 12,
                    backgroundColor: actionMessage?.reactions?.some(
                      (reaction) =>
                        reaction.userId === session!.user.id && reaction.emoji === emoji,
                    )
                      ? '#D8EBFF'
                      : colors.pale,
                    borderRadius: 12,
                  }}
                >
                  <Text style={{ fontSize: 23 }}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            {!!actionMessage?.text && (
              <Button
                title="Copy text"
                secondary
                onPress={() =>
                  void Clipboard.setStringAsync(actionMessage.text!)
                    .then(() => setActionMessage(null))
                    .catch((err) => setError(err.message))
                }
              />
            )}
            {actionMessage?.attachment?.type === 'gif' && (
              <>
                <Text selectable style={styles.subtitle}>
                  GIF ID: {actionMessage.attachment.gifId}
                </Text>
                <Button
                  title="Save GIF to library"
                  secondary
                  disabled={busy}
                  onPress={() => {
                    const gifId =
                      actionMessage.attachment!.type === 'gif'
                        ? actionMessage.attachment!.gifId
                        : '';
                    setBusy(true);
                    void api
                      .request(`/api/gifs/${gifId}`, { method: 'PUT' })
                      .then(() => setActionMessage(null))
                      .catch((err) => {
                        setError(err.message);
                        setActionMessage(null);
                      })
                      .finally(() => setBusy(false));
                  }}
                />
              </>
            )}
            <Button title="Forward message" secondary onPress={() => setForward(true)} />
          </>
        )}
      </Dialog>
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
  attachment: { gap: 10, marginBottom: 6, padding: 4 },
  image: { width: 230, height: 180, maxWidth: '100%', borderRadius: 10 },
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
