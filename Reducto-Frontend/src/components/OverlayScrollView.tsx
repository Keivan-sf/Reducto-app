import { forwardRef } from 'react';
import { ScrollView } from 'react-native';
import type { OverlayScrollViewProps } from './OverlayScrollView.types';

// Native scroll indicators already overlay their content without reserving width.
export const OverlayScrollView = forwardRef<ScrollView, OverlayScrollViewProps>(
  function OverlayScrollView(
    {
      onUserScroll,
      scrollbarInverted: _inverted,
      scrollbarLabel: _label,
      containerStyle: _containerStyle,
      ...props
    },
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
