import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/** Hide a mounted screen without removing its layout or native scroll position. */
export function RetainedLayer({
  active,
  style,
  testID,
  children,
}: PropsWithChildren<{ active: boolean; style?: StyleProp<ViewStyle>; testID?: string }>) {
  return (
    <View
      collapsable={false}
      testID={testID}
      pointerEvents={active ? 'auto' : 'none'}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      aria-hidden={!active}
      {...(Platform.OS === 'web' ? { inert: !active ? true : undefined } : {})}
      style={[StyleSheet.absoluteFill, { opacity: active ? 1 : 0, zIndex: active ? 1 : 0 }, style]}
    >
      {children}
    </View>
  );
}
