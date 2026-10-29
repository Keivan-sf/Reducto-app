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
  const footer = (
    <View style={s.footer}>
      {!!reactions && <View style={s.reactions}>{reactions}</View>}
      <View style={s.meta}>{meta}</View>
    </View>
  );
  if (!visualMedia)
    return (
      <>
        {header}
        {children}
        {caption}
        {footer}
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
        {!caption && !reactions && meta}
      </View>
      {(!!caption || !!reactions) && (
        <View style={[s.caption, textWidth]}>
          {caption}
          {footer}
        </View>
      )}
    </>
  );
}

const useStyles = createThemedStyles((colors) => ({
  media: { alignSelf: 'flex-start', maxWidth: '100%' },
  header: { paddingHorizontal: 10, paddingTop: 10 },
  caption: { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },
  footer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  reactions: { flex: 1, minWidth: 0 },
  meta: { marginLeft: 'auto', flexShrink: 0 },
}));
