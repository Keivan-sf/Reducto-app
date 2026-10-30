import { useTheme } from '../../context/ThemeContext';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { api, useSession } from '../../context/SessionContext';
import { useChats } from '../../context/ChatsContext';
import { Avatar, Button, Dialog, Field, Notice, useUIStyles } from '../../components/ui';
import type { Conversation } from '../../api/types';
import { useProfiles } from '../../context/ProfilesContext';
import { conversationName, profileName } from '../../lib/messages';
import { groupInviteToken, groupInviteUri } from '../../lib/links';
import { isValidUsername, normalizeUsername } from '../../lib/usernames';
import { GroupMemberMenu } from './GroupMemberMenu';

export function GroupDialog({
  chat,
  visible,
  onClose,
  onViewUser,
}: {
  chat: Conversation;
  visible: boolean;
  onClose: () => void;
  onViewUser: (userId: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useUIStyles();
  const { session } = useSession();
  const { members, loadConversation, removeConversation } = useChats();
  const { profiles } = useProfiles();
  const people = members[chat.id] ?? [];
  const peerId = people.find((member) => member.userId !== session!.user.id)?.userId;
  const peer = chat.type === 'private' && peerId ? profiles[peerId] : undefined;
  const title = conversationName(chat, peer);
  const role = people.find((member) => member.userId === session!.user.id)?.role;
  const manager = role === 'owner' || role === 'admin';
  const [editedName, setName] = useState<string | null>(null);
  const name = editedName ?? chat.name ?? '';
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function run(action: () => Promise<unknown>, message: string, sync = true) {
    if (busy) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await action();
      if (sync) await loadConversation(chat.id);
      setSuccess(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      visible={visible}
      title={chat.type === 'group' ? 'Group details' : 'Chat details'}
      onClose={onClose}
    >
      <View style={{ alignItems: 'center', gap: 14 }}>
        <Avatar
          name={title}
          uri={peer?.avatarUrl ?? undefined}
          size={72}
          online={chat.type === 'private' && peer?.online}
        />
        <Text style={styles.title}>{title}</Text>
        {peer?.username && <Text style={styles.subtitle}>@{peer.username}</Text>}
        <Text style={styles.subtitle}>{people.length} members</Text>
      </View>
      <Notice text={error} onDismiss={() => setError('')} />
      <Notice text={success} success onDismiss={() => setSuccess('')} />
      {chat.type === 'group' && manager && (
        <>
          <Field label="Group name" value={name} onChangeText={setName} maxLength={100} />
          <Button
            title="Save group name"
            secondary
            disabled={busy || !name.trim()}
            onPress={() =>
              void run(
                () => api.patch(`/api/groups/${chat.id}`, { name: name.trim() }),
                'Group renamed.',
              )
            }
          />
          <Button
            title="Copy invite link"
            secondary
            disabled={busy}
            onPress={() =>
              void run(
                async () => {
                  const { inviteLink } = await api.get<{ inviteLink: string }>(
                    `/api/groups/${chat.id}/invite`,
                  );
                  const token = groupInviteToken(inviteLink);
                  if (!token) throw new Error('The server returned an invalid invite link.');
                  await Clipboard.setStringAsync(groupInviteUri(token));
                },
                'Invite link copied. Share it with your friends.',
                false,
              )
            }
          />
          <Field
            label="Add member by username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="@username"
          />
          <Button
            title="Add member"
            secondary
            disabled={busy || !normalizeUsername(username)}
            onPress={() =>
              void run(async () => {
                const normalizedUsername = normalizeUsername(username);
                if (!isValidUsername(normalizedUsername))
                  throw new Error('Enter a username with 1–32 letters, numbers, or underscores.');
                await api.post(`/api/groups/${chat.id}/members`, { username: normalizedUsername });
                setUsername('');
              }, 'Member added.')
            }
          />
        </>
      )}
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>MEMBERS</Text>
      {people.map((member) => (
        <View
          key={member.userId}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            borderBottomWidth: 1,
            borderColor: colors.border,
            paddingBottom: 14,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${member.userId === session!.user.id ? session!.user.name : profileName(profiles[member.userId])} profile`}
            onPress={() => onViewUser(member.userId)}
            style={{ flex: 1, minWidth: 0, gap: 8, minHeight: 44 }}
          >
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Avatar
                name={
                  member.userId === session!.user.id
                    ? session!.user.name
                    : profileName(profiles[member.userId])
                }
                uri={profiles[member.userId]?.avatarUrl ?? undefined}
                online={profiles[member.userId]?.online}
                size={36}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.dark, fontSize: 14 }}>
                  {member.userId === session!.user.id
                    ? `${session!.user.name} (you)`
                    : profileName(profiles[member.userId])}
                </Text>
                {profiles[member.userId]?.username && (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    @{profiles[member.userId].username}
                  </Text>
                )}
                <Text style={{ color: colors.muted, fontSize: 12 }}>{member.role}</Text>
              </View>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{member.userId}</Text>
          </Pressable>
          {chat.type === 'group' &&
            manager &&
            member.role !== 'owner' &&
            member.userId !== session!.user.id && (
              <GroupMemberMenu
                name={profileName(profiles[member.userId])}
                busy={busy}
                isAdmin={member.role === 'admin'}
                onChangeRole={
                  role === 'owner'
                    ? () =>
                        void run(
                          () =>
                            api.patch(`/api/groups/${chat.id}/members/${member.userId}`, {
                              role: member.role === 'admin' ? 'member' : 'admin',
                            }),
                          'Member role updated.',
                        )
                    : undefined
                }
                onRemove={() =>
                  void run(
                    () =>
                      api.request(`/api/groups/${chat.id}/members/${member.userId}`, {
                        method: 'DELETE',
                      }),
                    'Member removed.',
                  )
                }
              />
            )}
        </View>
      ))}
      {chat.type === 'group' &&
        (!confirm ? (
          <Button
            title={role === 'owner' ? 'Delete group' : 'Leave group'}
            danger
            disabled={busy}
            onPress={() => setConfirm(true)}
          />
        ) : (
          <>
            <Text style={styles.subtitle}>
              {role === 'owner'
                ? 'Delete this group and its message history for everyone? This cannot be undone.'
                : 'Leave this group? You’ll need an invite to come back.'}
            </Text>
            <Button
              title={role === 'owner' ? 'Yes, delete group' : 'Yes, leave group'}
              danger
              busy={busy}
              onPress={() =>
                void run(
                  async () => {
                    if (role === 'owner')
                      await api.request(`/api/groups/${chat.id}`, { method: 'DELETE' });
                    else await api.post(`/api/groups/${chat.id}/leave`);
                    removeConversation(chat.id);
                    onClose();
                    router.replace('/');
                  },
                  '',
                  false,
                )
              }
            />
            <Button title="Cancel" secondary onPress={() => setConfirm(false)} />
          </>
        ))}
    </Dialog>
  );
}
