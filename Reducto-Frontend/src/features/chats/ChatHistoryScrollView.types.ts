import type { ScrollViewProps } from 'react-native';

export interface ChatHistoryScrollProps extends ScrollViewProps {
  onUserScroll?: () => void;
}
