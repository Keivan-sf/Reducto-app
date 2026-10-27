import { createThemedStyles } from '../../context/ThemeContext';
import { useEffect, useState, type ComponentProps } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EMOJIS, type Emoji } from '../../api/types';
import { Icon } from '../../components/ui';

export type MessageMenuAction = {
  label: string;
  icon: ComponentProps<typeof Icon>['name'];
  onPress: () => void;
};

export function MessageMenu({
  anchor,
  actions,
  selected,
  busy,
  onReact,
  onClose,
}: {
  anchor: { x: number; y: number } | null;
  actions: MessageMenuAction[];
  selected: Emoji[];
  busy: boolean;
  onReact: (emoji: Emoji) => void;
  onClose: () => void;
}) {
  const s = useStyles();
  const [progress] = useState(() => new Animated.Value(0));
  // Retain the entire menu until the closing animation finishes.
  const [content, setContent] = useState({ anchor, actions, selected });
  if (anchor && anchor !== content.anchor) {
    setContent({ anchor, actions, selected });
  }
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: anchor ? 1 : 0,
      duration: anchor ? 180 : 140,
      easing: anchor ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !anchor) setContent((current) => ({ ...current, anchor: null }));
    });
    return () => animation.stop();
  }, [anchor, progress]);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const menuWidth = Math.min(220, width - insets.left - insets.right - 16);
  const maxHeight = height - insets.top - insets.bottom - 16;
  const menuHeight = Math.min(content.actions.length * 40 + 14 + 48, maxHeight);
  const left = Math.max(
    insets.left + 8,
    Math.min(content.anchor?.x ?? 0, width - insets.right - menuWidth - 8),
  );
  const top = Math.max(
    insets.top + 8,
    Math.min(content.anchor?.y ?? 0, height - insets.bottom - menuHeight - 8),
  );
  return (
    <Modal transparent visible={!!content.anchor} animationType="none" onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close message options"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <Animated.View
          accessibilityRole="menu"
          accessibilityLabel="Message options"
          testID="message-options"
          pointerEvents={anchor ? 'auto' : 'none'}
          style={[
            s.menu,
            {
              left,
              top,
              width: menuWidth,
              maxHeight,
              opacity: progress,
              transform: [{ scale: progress }],
              transformOrigin: [
                Math.max(0, Math.min(menuWidth, (content.anchor?.x ?? left) - left)),
                Math.max(0, Math.min(menuHeight, (content.anchor?.y ?? top) - top)),
                0,
              ],
            },
          ]}
        >
          <ScrollView
            style={s.actions}
            contentContainerStyle={{ paddingVertical: 6 }}
            bounces={false}
          >
            {content.actions.map((action) => (
              <Pressable
                key={action.label}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                disabled={busy || !anchor}
                onPress={action.onPress}
                style={({ pressed }) => [s.action, pressed && s.hover, busy && { opacity: 0.5 }]}
              >
                <Icon name={action.icon} color="#60758A" size={20} />
                <Text style={s.label}>{action.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View accessibilityLabel="Message reactions" style={s.reactions}>
            {EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={`React ${emoji}`}
                accessibilityState={{ selected: content.selected.includes(emoji), disabled: busy }}
                disabled={busy || !anchor}
                onPress={() => onReact(emoji)}
                style={({ pressed }) => [
                  s.emoji,
                  (content.selected.includes(emoji) || pressed) && s.hover,
                ]}
              >
                <Text style={{ fontSize: 19 }}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
const useStyles = createThemedStyles((colors) => ({
  overlay: { flex: 1 },
  menu: { position: 'absolute', gap: 6 },
  actions: {
    flexShrink: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    boxShadow: '0 3px 18px #17212B26',
    borderWidth: 1,
    borderColor: colors.menuBorder,
  },
  action: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },
  label: { fontSize: 14, color: colors.dark },
  hover: { backgroundColor: colors.menuHover },
  reactions: {
    flexDirection: 'row',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 4,
    minHeight: 42,
    boxShadow: '0 3px 18px #17212B26',
    borderWidth: 1,
    borderColor: colors.menuBorder,
  },
  emoji: { flex: 1, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
}));
