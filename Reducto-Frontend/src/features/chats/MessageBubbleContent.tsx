import { createThemedStyles } from '../../context/ThemeContext';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

export function MessageBubbleContent({
  visualMedia,
  header,
  children,
  caption,
  meta,
  reactions,
}: {
  visualMedia: boolean;
  header: ReactNode;
  children: ReactNode;
  caption: ReactNode;
  meta: ReactNode;
  reactions: ReactNode;
}) {
  const s = useStyles();
  const [mediaWidth, setMediaWidth] = useState(0);
  if (!visualMedia)
    return (
      <>
        {header}
        {children}
        {caption}
        {meta}
        {reactions}
      </>
    );

  // Numeric widths keep text from contributing to the bubble's intrinsic width.
  // Percentage minWidth resolves against the available chat width in Android's Yoga layout.
  const textWidth = { width: mediaWidth };
  return (
    <>
      {!!header && <View style={[s.header, textWidth]}>{header}</View>}
      <View style={s.media} onLayout={({ nativeEvent }) => setMediaWidth(nativeEvent.layout.width)}>
        {children}
        {meta}
      </View>
      {!!caption && <View style={[s.caption, textWidth]}>{caption}</View>}
      {!!reactions && <View style={[s.reactions, textWidth]}>{reactions}</View>}
    </>
  );
}

const useStyles = createThemedStyles((colors) => ({
  media: { alignSelf: 'flex-start', maxWidth: '100%' },
  header: { paddingHorizontal: 10, paddingTop: 10 },
  caption: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },
  reactions: { paddingHorizontal: 8, paddingBottom: 6 },
}));
