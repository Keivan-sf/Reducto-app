import { useTheme, createThemedStyles } from '../../context/ThemeContext';
import { useLayoutEffect, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { Icon } from '../../components/ui';
import { MentionIcon } from '../../components/MentionIcon';

export function ScrollToLatestButton({
  visible,
  unreadCount,
  disabled,
  onPressIn,
  onPress,
  mention = false,
  raised = false,
}: {
  visible: boolean;
  unreadCount: number;
  disabled: boolean;
  onPressIn?: () => void;
  onPress: () => void;
  mention?: boolean;
  raised?: boolean;
}) {
  const { colors } = useTheme();
  const s = useStyles();
  const [opacity] = useState(() => new Animated.Value(0));
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  useLayoutEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 140,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => animation.stop();
  }, [opacity, visible]);

  if (!mounted) return null;
  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[s.position, raised && { bottom: 74 }, { opacity }]}
    >
      <Pressable
        testID={mention ? 'jump-to-mention' : 'scroll-to-latest'}
        accessibilityRole="button"
        accessibilityLabel={mention ? 'Jump to oldest unseen mention' : 'Back to latest messages'}
        accessibilityHint={
          unreadCount > 0
            ? `${unreadCount} ${mention ? 'unseen mentions' : 'unread messages'}`
            : undefined
        }
        disabled={disabled || !visible}
        hitSlop={2}
        onPressIn={onPressIn}
        onPress={onPress}
        style={({ pressed }) => [s.button, (pressed || disabled) && { opacity: 0.7 }]}
      >
        {mention ? (
          <MentionIcon size={16} />
        ) : (
          <Icon name="chevron-down" size={19} color={colors.muted} />
        )}
        {unreadCount > 0 && (
          <View style={s.badge}>
            <Text
              testID={mention ? 'unseen-mentions-count' : 'scroll-to-latest-unread'}
              style={s.count}
            >
              {unreadCount}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  position: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
  button: {
    width: 42,
    height: 42,
    borderRadius: 26,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 6px #17212B26',
  },
  badge: {
    position: 'absolute',
    top: -8,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { color: 'white', fontSize: 10, fontWeight: '500' },
}));
