import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/ui';
import { useTheme } from '../../context/ThemeContext';

export function GroupMemberMenu({
  name,
  busy,
  isAdmin,
  onChangeRole,
  onRemove,
}: {
  name: string;
  busy: boolean;
  isAdmin: boolean;
  onChangeRole?: () => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const menuWidth = Math.min(220, width - insets.left - insets.right - 16);
  const menuHeight = (onChangeRole ? 2 : 1) * 48 + 12;
  // Keep the last position while the native modal finishes fading out.
  const close = () => setOpen(false);
  const actions = [
    ...(onChangeRole
      ? [
          {
            label: isAdmin ? 'Make member' : 'Make admin',
            icon: 'shield-outline' as const,
            onPress: onChangeRole,
            danger: false,
          },
        ]
      : []),
    {
      label: 'Remove member',
      icon: 'person-remove-outline' as const,
      onPress: onRemove,
      danger: true,
    },
  ];

  return (
    <>
      <Pressable
        ref={trigger}
        accessibilityRole="button"
        accessibilityLabel={`Options for ${name}`}
        accessibilityState={{ expanded: open, disabled: busy }}
        disabled={busy}
        onPress={() =>
          trigger.current?.measureInWindow((x, y, w, h) => {
            setAnchor({ x: x + w, y: y + h });
            setOpen(true);
          })
        }
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 22,
          backgroundColor: pressed || open ? colors.menuHover : 'transparent',
          opacity: busy ? 0.4 : 1,
        })}
      >
        <Icon name="ellipsis-vertical" size={22} />
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={close}>
        <View style={{ flex: 1 }} pointerEvents={open ? 'auto' : 'none'}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close member options"
            style={StyleSheet.absoluteFill}
            onPress={close}
          />
          <View
            accessibilityRole="menu"
            accessibilityLabel={`Options for ${name}`}
            style={{
              position: 'absolute',
              left: Math.max(
                insets.left + 8,
                Math.min((anchor?.x ?? 0) - menuWidth, width - insets.right - menuWidth - 8),
              ),
              top: Math.max(
                insets.top + 8,
                Math.min(anchor?.y ?? 0, height - insets.bottom - menuHeight - 8),
              ),
              width: menuWidth,
              paddingVertical: 6,
              backgroundColor: colors.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.menuBorder,
              boxShadow: '0 3px 18px #17212B26',
              overflow: 'hidden',
            }}
          >
            {actions.map((action) => (
              <Pressable
                key={action.label}
                accessibilityRole="menuitem"
                disabled={busy || !open}
                onPress={() => {
                  close();
                  action.onPress();
                }}
                style={({ pressed }) => ({
                  minHeight: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 16,
                  backgroundColor: pressed ? colors.menuHover : 'transparent',
                })}
              >
                <Icon
                  name={action.icon}
                  color={action.danger ? colors.danger : colors.muted}
                  size={20}
                />
                <Text style={{ color: action.danger ? colors.danger : colors.dark, fontSize: 14 }}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}
