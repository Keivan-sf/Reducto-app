import { Link } from 'expo-router';
import * as Linking from 'expo-linking';
import { Platform, Text, type StyleProp, type TextStyle } from 'react-native';
import { colors } from '../../components/ui';
import { internalLinkPath, linkify } from '../../lib/links';

export function MessageText({
  text,
  style,
  onMessagePress,
  onError,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  onMessagePress: () => void;
  onError: (message: string) => void;
}) {
  return (
    <Text selectable style={style} onPress={onMessagePress} onLongPress={onMessagePress}>
      {linkify(text).map((part, index) =>
        part.href ? (
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
