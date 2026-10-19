import { type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { mediaPreviewSize, type MediaSize } from '../../lib/media-preview';

export function MediaPreview({
  children,
  size,
  label,
}: PropsWithChildren<{ size?: MediaSize; label: string }>) {
  return (
    <View accessibilityLabel={label} pointerEvents="none" style={[s.frame, mediaPreviewSize(size)]}>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  frame: {
    maxWidth: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E4EBF1',
  },
});
