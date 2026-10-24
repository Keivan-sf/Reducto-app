import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const radius = 18;
const circumference = 2 * Math.PI * radius;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function DownloadProgressRing({ progress }: { progress: number }) {
  const fraction = Number.isFinite(progress) ? Math.max(0.01, Math.min(1, progress)) : 0.01;
  const percent = Math.floor(fraction * 100);
  const displayedProgress = useSharedValue(0.01);
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: 12000, easing: Easing.linear }), -1);
    return () => cancelAnimation(rotation);
  }, [rotation]);
  const rotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  useEffect(() => {
    displayedProgress.value = withTiming(fraction, {
      duration: 220,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
    return () => cancelAnimation(displayedProgress);
  }, [fraction, displayedProgress]);
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - displayedProgress.value),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel="Voice download progress"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      style={[s.ring, rotationStyle]}
    >
      <Svg width={42} height={42} viewBox="0 0 42 42">
        <AnimatedCircle
          cx={21}
          cy={21}
          r={radius}
          fill="none"
          stroke="white"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeDasharray={[circumference, circumference]}
          animatedProps={animatedProps}
          transform="rotate(-90 21 21)"
        />
      </Svg>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  ring: { position: 'absolute', left: 2, top: 2, width: 42, height: 42 },
});
