import { createThemedStyles } from '../../context/ThemeContext';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Message } from '../../api/types';
import { useChats } from '../../context/ChatsContext';
import { useProfiles } from '../../context/ProfilesContext';

import { profileName, replySnippet } from '../../lib/messages';

export function ReplyQuote({
  message,
  unavailable = false,
}: {
  message?: Message;
  unavailable?: boolean;
}) {
  const s = useStyles();
  const { profiles } = useProfiles();
  return (
    <View style={s.quote}>
      <Text numberOfLines={1} style={s.name}>
        {message ? profileName(profiles[message.senderId]) : 'Reply'}
      </Text>
      <Text numberOfLines={1} style={s.snippet}>
        {message ? replySnippet(message) : unavailable ? 'Message unavailable' : 'Loading message…'}
      </Text>
    </View>
  );
}

export function ReplyPreview({
  conversationId,
  messageId,
  onJump,
}: {
  conversationId: string;
  messageId: string;
  onJump: (id: string) => void;
}) {
  const { messageCache } = useChats();
  const [target, setTarget] = useState<Message>();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void messageCache
      .message(conversationId, messageId)
      .then((message) => {
        if (alive) {
          setTarget(message);
          setUnavailable(false);
        }
      })
      .catch(() => {
        if (alive) setUnavailable(true);
      });
    return () => {
      alive = false;
    };
  }, [messageCache, conversationId, messageId]);
  const message =
    messageCache.peek(conversationId, messageId) ??
    (target?.id === messageId && target.conversationId === conversationId ? target : undefined);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Jump to replied message ${messageId}`}
      onPress={(event) => {
        event.stopPropagation();
        onJump(messageId);
      }}
      style={{ marginBottom: 7 }}
    >
      <ReplyQuote message={message} unavailable={unavailable} />
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.blue,
    borderRadius: 4,
    backgroundColor: '#3390EC18',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 3,
    minWidth: 100,
    maxWidth: '100%',
  },
  name: { color: colors.replyName, fontSize: 12, fontWeight: '600' },
  snippet: { color: colors.replyText, fontSize: 13 },
}));
