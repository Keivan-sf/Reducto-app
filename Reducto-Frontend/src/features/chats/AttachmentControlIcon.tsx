import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from '../../components/ui';

const controlIcons = ['arrow-down', 'close', 'play', 'pause', 'document'] as const;
export function AttachmentControlIcon({ name }: { name: (typeof controlIcons)[number] }) {
  return (
    <View pointerEvents="none" style={{ width: 24, height: 24 }}>
      {controlIcons.map((icon) => (
        <ControlIconLayer key={icon} name={icon} visible={name === icon} />
      ))}
    </View>
  );
}
function ControlIconLayer({
  name,
  visible,
}: {
  name: (typeof controlIcons)[number];
  visible: boolean;
}) {
  const opacity = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: 140,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
  }, [visible, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      testID={`voice-icon-${name}`}
      style={[
        StyleSheet.absoluteFill,
        name === 'play' && { transform: [{ translateX: 1 }] },
        style,
      ]}
    >
      <Icon name={name} color="white" size={24} />
    </Animated.View>
  );
}
