import { useState, type ComponentProps, type PropsWithChildren } from 'react';
import { NoticeProvider } from './Notice';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { initials } from '../lib/messages';
export { Notice } from './Notice';

export const colors = {
  blue: '#3390EC',
  dark: '#17212B',
  muted: '#7A8A99',
  border: '#E9EDF2',
  pale: '#F4F7FA',
  green: '#DFF3D3',
  danger: '#CF4545',
};
export function Icon({
  name,
  size = 22,
  color = colors.muted,
}: {
  name: ComponentProps<typeof Ionicons>['name'];
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}
export function IconButton({
  name,
  label,
  onPress,
  color,
  disabled,
}: {
  name: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, { opacity: disabled ? 0.4 : pressed ? 0.55 : 1 }]}
    >
      <Icon name={name} color={color} />
    </Pressable>
  );
}
export function Avatar({
  name,
  uri,
  size = 48,
  online = false,
  badgeBorderColor = 'white',
}: {
  name: string;
  uri?: string;
  size?: number;
  online?: boolean;
  badgeBorderColor?: string;
}) {
  const [failedUri, setFailedUri] = useState<string>();
  const palette = ['#62A6E9', '#9A83DA', '#E4A55C', '#65B7A3', '#DC8096'];
  const tint = palette[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % palette.length];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {uri && uri !== failedUri ? (
        <Image
          accessibilityLabel={`${name} profile photo`}
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailedUri(uri)}
        />
      ) : (
        <Text style={{ color: 'white', fontSize: size * 0.34, fontWeight: '600' }}>
          {initials(name)}
        </Text>
      )}
      {online && (
        <View
          accessibilityLabel={`${name} online`}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: Math.max(10, size * 0.23),
            height: Math.max(10, size * 0.23),
            borderRadius: size,
            backgroundColor: colors.blue,
            borderWidth: 2,
            borderColor: badgeBorderColor,
          }}
        />
      )}
    </View>
  );
}
export function Button({
  title,
  onPress,
  busy,
  secondary,
  danger,
  disabled,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        danger && { backgroundColor: '#FCEDED' },
        (pressed || busy || disabled) && { opacity: 0.6 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? colors.blue : 'white'} />
      ) : (
        <Text
          style={{
            fontSize: 15,
            fontWeight: '600',
            color: danger ? colors.danger : secondary ? colors.blue : 'white',
          }}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}
export function Field({ label, ...props }: ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={{ gap: 7 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#9AA6B2"
        {...props}
        style={[styles.input, props.style]}
      />
    </View>
  );
}
export function Dialog({
  visible,
  title,
  onClose,
  children,
}: PropsWithChildren<{ visible: boolean; title: string; onClose: () => void }>) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      {/* Modals have their own window, outside the root keyboard-avoiding view. */}
      <KeyboardAvoidingView
        style={styles.overlay}
        enabled={Platform.OS !== 'web'}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.dialog}>
          <NoticeProvider>
            <View style={styles.dialogHeader}>
              <Text style={styles.title}>{title}</Text>
              <IconButton name="close" label="Close dialog" onPress={onClose} />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: 18, padding: 24, paddingTop: 8 }}
            >
              {children}
            </ScrollView>
          </NoticeProvider>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '600', color: colors.dark },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  iconButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 22,
  },
  button: {
    backgroundColor: colors.blue,
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondary: { backgroundColor: '#EDF5FE' },
  label: { fontSize: 13, fontWeight: '500', color: '#596A7B' },
  input: {
    borderWidth: 1,
    borderColor: '#DDE4EB',
    backgroundColor: 'white',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: colors.dark,
    minHeight: 48,
  },
  overlay: {
    flex: 1,
    backgroundColor: '#17212B66',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  dialog: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '88%',
    backgroundColor: 'white',
    borderRadius: 20,
    overflow: 'hidden',
  },
  dialogHeader: {
    padding: 16,
    paddingLeft: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
