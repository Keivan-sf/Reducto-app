import { useLayoutEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, Icon } from '../../components/ui';

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
      style={[s.position, raised && { bottom: 90 }, { opacity }]}
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
        onPressIn={onPressIn}
        onPress={onPress}
        style={({ pressed }) => [s.button, (pressed || disabled) && { opacity: 0.7 }]}
      >
        {mention ? (
          <Text style={{ fontSize: 22, color: colors.blue }}>@</Text>
        ) : (
          <Icon name="chevron-down" size={27} color={colors.muted} />
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

const s = StyleSheet.create({
  position: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
  button: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 6px #17212B26',
  },
  badge: {
    position: 'absolute',
    top: -12,
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 13,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { color: 'white', fontSize: 14, fontWeight: '500' },
});
