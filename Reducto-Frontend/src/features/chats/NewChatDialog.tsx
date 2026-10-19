import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '../../context/SessionContext';
import { useChats } from '../../context/ChatsContext';
import { Button, colors, Dialog, Field, Notice, styles } from '../../components/ui';
import type { Conversation } from '../../api/types';

export function NewChatDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { refresh } = useChats();
  const [mode, setMode] = useState<'private' | 'group' | 'join'>('private');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    if (!value.trim()) return setError('Please fill in the field above.');
    setError('');
    setBusy(true);
    try {
      let path: string;
      let body: object | undefined;
      if (mode === 'private') {
        path = '/api/conversations/private';
        body = { userId: value.trim() };
      } else if (mode === 'group') {
        path = '/api/groups';
        body = { name: value.trim() };
      } else {
        const token = value.trim().replace(/\/$/, '').split('/').pop()!;
        if (!/^[a-f0-9]{64}$/.test(token))
          throw new Error('Enter a valid group invite link or token.');
        path = `/api/groups/join/${token}`;
      }
      const { conversation } = await api.post<{ conversation: Conversation }>(path, body);
      await refresh();
      onClose();
      setValue('');
      router.push(`/chat/${conversation.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog visible={visible} title="Start a conversation" onClose={onClose}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {(['private', 'group', 'join'] as const).map((type) => (
          <Pressable
            key={type}
            accessibilityRole="tab"
            accessibilityState={{ selected: type === mode }}
            onPress={() => {
              setMode(type);
              setValue('');
              setError('');
            }}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 10,
              backgroundColor: mode === type ? '#EAF4FF' : colors.pale,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: mode === type ? colors.blue : colors.muted,
              }}
            >
              {type === 'private' ? 'Private chat' : type === 'group' ? 'New group' : 'Join group'}
            </Text>
          </Pressable>
        ))}
      </View>
      <Field
        label={
          mode === 'private'
            ? 'Recipient’s user ID'
            : mode === 'group'
              ? 'Group name'
              : 'Invite link or token'
        }
        placeholder={
          mode === 'private'
            ? 'Paste their user ID'
            : mode === 'group'
              ? 'Give your group a name'
              : 'Paste a group invite'
        }
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        maxLength={mode === 'group' ? 100 : 500}
        onSubmitEditing={() => void create()}
      />
      <Text style={styles.subtitle}>
        {mode === 'private'
          ? 'Ask your friend to copy their user ID from Settings and share it with you.'
          : mode === 'group'
            ? 'Make a space for your people. Invite members after creating your group.'
            : 'Have an invite? Join the group and catch up on the conversation.'}
      </Text>
      <Notice text={error} />
      <Button
        title={mode === 'private' ? 'Open chat' : mode === 'group' ? 'Create group' : 'Join group'}
        busy={busy}
        onPress={() => void create()}
      />
    </Dialog>
  );
}
