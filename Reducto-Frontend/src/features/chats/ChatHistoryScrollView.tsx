import { forwardRef } from 'react';
import { ScrollView } from 'react-native';
import type { ChatHistoryScrollProps } from './ChatHistoryScrollView.types';

// Native scroll indicators already overlay their content without reserving width.
export const ChatHistoryScrollView = forwardRef<ScrollView, ChatHistoryScrollProps>(
  function ChatHistoryScrollView(
    { onUserScroll, scrollbarInverted: _inverted, scrollbarLabel: _label, ...props },
    ref,
  ) {
    return (
      <ScrollView
        {...props}
        ref={ref}
        onScrollBeginDrag={(event) => {
          onUserScroll?.();
          props.onScrollBeginDrag?.(event);
        }}
      />
    );
  },
);
