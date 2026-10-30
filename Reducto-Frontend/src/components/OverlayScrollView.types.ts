import type { ScrollViewProps, StyleProp, ViewStyle } from 'react-native';

export interface OverlayScrollViewProps extends ScrollViewProps {
  /** Outer overlay layout on web; native uses the ScrollView layout directly. */
  containerStyle?: StyleProp<ViewStyle>;
  onUserScroll?: () => void;
  scrollbarInverted?: boolean;
  scrollbarLabel?: string;
}
