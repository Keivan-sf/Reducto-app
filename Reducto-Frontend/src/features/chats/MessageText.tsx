import { useTheme } from '../../context/ThemeContext';
import { Link } from 'expo-router';
import * as Linking from 'expo-linking';
import {
  Platform,
  Text,
  type StyleProp,
  type TextStyle,
  type GestureResponderEvent,
} from 'react-native';

import { internalLinkPath, linkifyMentions } from '../../lib/links';

export function MessageText({
  text,
  style,
  onMessagePress,
  onError,
  onOpenUsername,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  onMessagePress: (event: GestureResponderEvent) => void;
  onError: (message: string) => void;
  onOpenUsername: (username: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <Text selectable style={style} onPress={onMessagePress} onLongPress={onMessagePress}>
      {linkifyMentions(text).map((part, index) =>
        part.username ? (
          <Text
            key={index}
            accessibilityRole="link"
            accessibilityLabel={part.text}
            style={{ color: colors.blue }}
            onPress={(event) => {
              event.stopPropagation();
              onOpenUsername(part.username!);
            }}
          >
            {part.text}
          </Text>
        ) : part.href ? (
          <Link
            key={index}
            href={part.internal ? internalLinkPath(part.href) : part.href}
            target={part.internal ? undefined : '_blank'}
            rel={part.internal ? undefined : 'noopener noreferrer'}
            style={{ color: colors.blue, textDecorationLine: 'underline' }}
            onPress={(event) => {
              event.stopPropagation();
              if (!part.internal && Platform.OS !== 'web') {
                event.preventDefault();
                void Linking.openURL(part.href!).catch(() => onError('Could not open this link.'));
              }
            }}
          >
            {part.text}
          </Link>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}
