import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Platform, Text, View } from 'react-native';
import { Icon } from '../../components/ui';
import { createThemedStyles, useTheme } from '../../context/ThemeContext';
import { bindChatFileDrop } from '../../lib/chat-file-drop';

export function ChatFileDropArea({
  enabled,
  onFile,
  children,
}: PropsWithChildren<{ enabled: boolean; onFile: (file: File) => void }>) {
  const s = useStyles();
  const { colors } = useTheme();
  const web = Platform.OS === 'web';
  const root = useRef<View>(null);
  const [hoverType, setHoverType] = useState<string | null>(null);
  useEffect(() => {
    if (!web || !enabled || !root.current) return;
    return bindChatFileDrop(root.current as unknown as HTMLElement, setHoverType, onFile);
  }, [web, enabled, onFile]);
  return (
    <View ref={root} style={s.root}>
      {children}
      {web && enabled && hoverType !== null && (
        <View pointerEvents="none" style={s.overlay} testID="chat-file-drop-overlay">
          <View style={s.box}>
            <Icon
              name={
                hoverType.startsWith('audio/')
                  ? 'musical-notes'
                  : hoverType.startsWith('image/')
                    ? 'image-outline'
                    : hoverType.startsWith('video/')
                      ? 'videocam-outline'
                      : 'document-outline'
              }
              size={48}
              color={colors.blue}
            />
            <Text style={s.title}>Drop files here</Text>
            <Text style={s.subtitle}>to send them</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: { flex: 1, minWidth: 0, position: 'relative' },
  overlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 100,
    padding: 16,
    backgroundColor: colors.surface,
    opacity: 0.96,
  },
  box: {
    flex: 1,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.blue,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: '600', color: colors.blue },
  subtitle: { fontSize: 16, color: colors.blue },
}));
