import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Clipboard from 'expo-clipboard';
import {
  Avatar,
  Button,
  colors,
  Dialog,
  Field,
  Icon,
  IconButton,
  Notice,
  styles,
} from '../../components/ui';
import { api, useSession } from '../../context/SessionContext';
import type { User } from '../../api/types';
import { useProfiles } from '../../context/ProfilesContext';
import { objectUrl } from '../../lib/config';
import { fileForm } from '../../lib/uploads';

export default function SettingsScreen() {
  const { session, updateUser, signOut } = useSession();
  const user = session!.user;
  const { profiles } = useProfiles();
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username ?? '');
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [localAvatar, setLocalAvatar] = useState<string>();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  async function save() {
    setError('');
    setSuccess('');
    if (!name.trim()) return setError('Your display name cannot be empty.');
    if (username && !/^[A-Za-z0-9_]{1,32}$/.test(username))
      return setError('Username can contain up to 32 letters, numbers, and underscores.');
    setBusy(true);
    try {
      const { user: updated } = await api.patch<{ user: User }>('/api/settings/profile', {
        name: name.trim(),
        username: username.trim() || null,
      });
      await updateUser({ ...user, ...updated });
      setSuccess('Your profile has been updated.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadAvatar() {
    setError('');
    setSuccess('');
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (picked.canceled) return;
    setAvatarBusy(true);
    try {
      const asset = picked.assets[0];
      // Web pickers don't crop. Crop and normalize on both platforms before upload.
      const side = Math.min(asset.width, asset.height);
      const context = ImageManipulator.manipulate(asset.uri);
      context.crop({
        originX: Math.floor((asset.width - side) / 2),
        originY: Math.floor((asset.height - side) / 2),
        width: side,
        height: side,
      });
      context.resize({ width: 640, height: 640 });
      const rendered = await context.renderAsync();
      const image = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
      const body = await fileForm('avatar', {
        uri: image.uri,
        name: 'avatar.jpg',
        mimeType: 'image/jpeg',
      });
      const { user: updated } = await api.request<{ user: User }>('/api/settings/avatar', {
        method: 'PUT',
        body,
      });
      await updateUser({ ...user, ...updated });
      setLocalAvatar(image.uri);
      setSuccess('Profile photo updated.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAvatarBusy(false);
    }
  }
  return (
    <View style={s.root}>
      <View style={s.header}>
        <IconButton name="arrow-back" label="Back to chats" onPress={() => router.replace('/')} />
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <View style={s.card}>
          <Text style={s.section}>YOUR PROFILE</Text>
          <View style={s.profile}>
            <Avatar
              name={user.name}
              uri={localAvatar ?? profiles[user.id]?.avatarUrl ?? objectUrl(user.avatarKey)}
              size={88}
            />
            <View style={{ gap: 7, flex: 1 }}>
              <Text style={styles.title}>{user.name}</Text>
              <Text style={styles.subtitle}>{user.email}</Text>
            </View>
          </View>
          <Button
            title="Change profile photo"
            secondary
            busy={avatarBusy}
            onPress={() => void uploadAvatar().catch((err) => setError(err.message))}
          />
          <Text style={s.hint}>Choose a photo. We’ll crop it to a square for you.</Text>
          <View style={s.divider} />
          <Field label="Display name" value={name} onChangeText={setName} maxLength={100} />
          <Field
            label="Username"
            placeholder="your_username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            maxLength={32}
          />
          <Text style={s.hint}>A little more you. Choose how you appear in Reducto.</Text>
          <Notice text={error} />
          <Notice text={success} success />
          <Button title="Save changes" busy={busy} onPress={() => void save()} />
        </View>
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="person-circle-outline" color={colors.blue} />
            <Text style={styles.title}>Your account</Text>
          </View>
          <Text selectable style={s.hint}>
            Server: {session!.serverUrl}
          </Text>
          <Text style={s.hint}>
            {user.username
              ? 'Share your username so friends can easily start a chat with you.'
              : 'Add a username above so friends can easily find you, or share your user ID.'}
          </Text>
          {user.username && (
            <View style={s.id}>
              <Text selectable style={{ flex: 1, color: colors.dark, fontSize: 14 }}>
                @{user.username}
              </Text>
              <IconButton
                name="copy-outline"
                label="Copy username"
                onPress={() =>
                  void Clipboard.setStringAsync(`@${user.username}`)
                    .then(() => setSuccess('Username copied.'))
                    .catch((err) => setError(err.message))
                }
              />
            </View>
          )}
          <View style={s.id}>
            <Text selectable style={{ flex: 1, color: colors.muted, fontSize: 12 }}>
              {user.id}
            </Text>
            <IconButton
              name="copy-outline"
              label="Copy user ID"
              onPress={() =>
                void Clipboard.setStringAsync(user.id)
                  .then(() => setSuccess('User ID copied.'))
                  .catch((err) => setError(err.message))
              }
            />
          </View>
          <Button title="Sign out" danger onPress={() => setConfirm(true)} />
        </View>
        <Text style={s.foot}>reducto · v1.0.0</Text>
      </ScrollView>
      <Dialog
        visible={confirm}
        title="Sign out?"
        onClose={() => {
          if (!loggingOut) setConfirm(false);
        }}
      >
        <Text style={styles.subtitle}>
          You can sign back in anytime. Your conversations will be here.
        </Text>
        <Button
          title="Sign out"
          danger
          busy={loggingOut}
          onPress={() => {
            setLoggingOut(true);
            void signOut()
              .then(() => router.replace('/login'))
              .catch((err) => {
                setError(err.message);
                setConfirm(false);
              })
              .finally(() => setLoggingOut(false));
          }}
        />
        <Button title="Stay here" secondary onPress={() => setConfirm(false)} />
      </Dialog>
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.pale },
  header: {
    height: 76,
    paddingHorizontal: 18,
    backgroundColor: 'white',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  content: { padding: 20, alignItems: 'center', gap: 20 },
  card: {
    width: '100%',
    maxWidth: 540,
    padding: 26,
    backgroundColor: 'white',
    borderRadius: 18,
    gap: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  section: { fontSize: 11, color: colors.muted, fontWeight: '600', letterSpacing: 1.5 },
  profile: { flexDirection: 'row', gap: 20, alignItems: 'center', paddingVertical: 8 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  divider: { height: 1, backgroundColor: colors.border },
  id: {
    backgroundColor: colors.pale,
    paddingLeft: 12,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  foot: { color: '#A5B1BE', fontSize: 12, paddingVertical: 12 },
});
