import { createThemedStyles } from '../../context/ThemeContext';
import { type PropsWithChildren } from 'react';
import { View } from 'react-native';
import { mediaPreviewSize, type MediaSize } from '../../lib/media-preview';

export function MediaPreview({
  children,
  size,
  label,
  fill = false,
}: PropsWithChildren<{ size?: MediaSize; label: string; fill?: boolean }>) {
  const s = useStyles();
  return (
    <View
      accessibilityLabel={label}
      pointerEvents="none"
      style={[
        s.frame,
        fill ? { width: '100%', height: '100%', borderRadius: 0 } : mediaPreviewSize(size),
      ]}
    >
      {children}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  frame: {
    maxWidth: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mediaPlaceholder,
  },
}));
