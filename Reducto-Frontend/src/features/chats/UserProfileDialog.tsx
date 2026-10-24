import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Conversation } from '../../api/types';
import { Avatar, Button, colors, Dialog, Notice, styles } from '../../components/ui';
import { useChats } from '../../context/ChatsContext';
import { useProfiles } from '../../context/ProfilesContext';
import { api, useSession } from '../../context/SessionContext';
import { profileName } from '../../lib/messages';

export function UserProfileDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { session } = useSession();
  const { profiles, directory } = useProfiles();
  const { loadConversation } = useChats();
  const profile = profiles[userId];
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void directory.get(userId).catch((err: Error) => {
      if (mounted.current) setError(err.message);
    });
    return () => {
      mounted.current = false;
    };
  }, [directory, userId]);
  async function openConversation() {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setError('');
    try {
      // User IDs also work for members without a username or after a rename.
      const { conversation } = await api.post<{ conversation: Conversation }>(
        '/api/conversations/private',
        { userId },
      );
      if (!mounted.current) return;
      await loadConversation(conversation.id, true);
      if (!mounted.current) return;
      onClose();
      router.push(`/chat/${conversation.id}`);
    } catch (err) {
      if (mounted.current) setError((err as Error).message);
    } finally {
      opening.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Dialog visible title="User details" onClose={onClose}>
      <View style={{ alignItems: 'center', gap: 14 }}>
        <Avatar name={profileName(profile)} uri={profile?.avatarUrl ?? undefined} size={88} />
        <Text style={styles.title}>{profileName(profile)}</Text>
        {profile?.username && (
          <Text selectable style={styles.subtitle}>
            @{profile.username}
          </Text>
        )}
      </View>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>USER ID</Text>
        <Text selectable style={styles.subtitle}>
          {userId}
        </Text>
      </View>
      <Notice text={error} onDismiss={() => setError('')} />
      {userId !== session?.user.id && (
        <Button title="Open conversation" busy={busy} onPress={() => void openConversation()} />
      )}
    </Dialog>
  );
}
