import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from './ui';

export function SavedMessagesAvatar({ size = 52 }: { size?: number }) {
  return (
    <LinearGradient
      testID="saved-messages-avatar"
      colors={['#66B7FA', '#368BD7']}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="bookmark-outline" color="white" size={size * 0.6} />
    </LinearGradient>
  );
}
