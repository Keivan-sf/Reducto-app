import { useTheme } from '../../context/ThemeContext';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../context/SessionContext';
import { useChats } from '../../context/ChatsContext';
import type { Conversation } from '../../api/types';
import { Button, Notice, useUIStyles } from '../../components/ui';
import { groupJoinPath, INVITE_TOKEN } from '../../lib/links';

export default function JoinGroupScreen({ token }: { token: string }) {
  const { colors } = useTheme();
  const styles = useUIStyles();
  const { loadConversation } = useChats();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const valid = INVITE_TOKEN.test(token);
  useEffect(() => {
    if (!valid) return;
    let active = true;
    void (async () => {
      const { conversation } = await api.post<{ conversation: Conversation }>(groupJoinPath(token));
      await loadConversation(conversation.id);
      if (active) router.replace(`/chat/${conversation.id}`);
    })().catch((err) => {
      if (active) setError(err.message);
    });
    return () => {
      active = false;
    };
  }, [token, valid, loadConversation, attempt]);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 20 }}>
      <Text style={styles.title}>{valid ? 'Join group' : 'Invalid group invite'}</Text>
      {valid && !error ? (
        <>
          <ActivityIndicator color={colors.blue} />
          <Text style={styles.subtitle}>Joining the conversation…</Text>
        </>
      ) : (
        <>
          <Notice text={error || 'This group invite is invalid.'} />
          {valid && (
            <Button
              title="Try again"
              onPress={() => {
                setError('');
                setAttempt((current) => current + 1);
              }}
            />
          )}
          <Button title="Back to chats" secondary onPress={() => router.replace('/')} />
        </>
      )}
    </View>
  );
}
