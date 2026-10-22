import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { ScrollView, View } from 'react-native';

import type { ChatHistoryScrollProps } from './ChatHistoryScrollView.types';

interface ThumbDrag {
  pointerId: number;
  clientY: number;
  grabOffset: number;
  height: number;
}

/** A transparent overlay for inverted chat history. Paint directly once per
 * animation frame so scrolling never waits for a React render. */
export const ChatHistoryScrollView = forwardRef<ScrollView, ChatHistoryScrollProps>(
  function ChatHistoryScrollView({ onUserScroll, ...props }, ref) {
    const scroll = useRef<ScrollView>(null);
    const thumb = useRef<HTMLDivElement>(null);
    const drag = useRef<ThumbDrag | undefined>(undefined);
    const frame = useRef<number | undefined>(undefined);
    const enabled = props.scrollEnabled !== false;
    useImperativeHandle(ref, () => scroll.current!, []);
    const node = () => scroll.current?.getScrollableNode() as HTMLElement | undefined;
    const paint = useCallback(() => {
      const content = node();
      const indicator = thumb.current;
      if (!content || !indicator) return;
      const height = content.clientHeight;
      const maximum = Math.max(0, content.scrollHeight - height);
      indicator.style.display = maximum > 0 ? 'block' : 'none';
      if (!maximum) return;
      const thumbHeight =
        drag.current?.height ??
        Math.min(height, Math.max(32, (height * height) / content.scrollHeight));
      const travel = Math.max(0, height - thumbHeight - 4);
      let top: number;
      if (drag.current && travel) {
        top = Math.min(
          travel + 2,
          Math.max(
            2,
            drag.current.clientY - content.getBoundingClientRect().top - drag.current.grabOffset,
          ),
        );
        // Virtualization can change the total height during a drag. Keep the
        // thumb under the pointer and map that position to the current range.
        content.scrollTop = maximum * (1 - (top - 2) / travel);
      } else top = 2 + travel * (1 - Math.min(maximum, Math.max(0, content.scrollTop)) / maximum);
      indicator.style.height = `${thumbHeight}px`;
      indicator.style.transform = `translate3d(0, ${top}px, 0)`;
      indicator.setAttribute('aria-valuemax', String(Math.round(maximum)));
      indicator.setAttribute('aria-valuenow', String(Math.round(maximum - content.scrollTop)));
    }, []);
    const schedulePaint = useCallback(() => {
      if (frame.current !== undefined) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        paint();
      });
    }, [paint]);
    useEffect(() => {
      const content = node();
      if (!content || !onUserScroll) return;
      // Web ScrollView does not emit onScrollBeginDrag for wheel/keyboard
      // scrolling. User input must cancel pending automatic positioning too.
      const interact = () => onUserScroll();
      for (const event of ['wheel', 'pointerdown', 'keydown'])
        content.addEventListener(event, interact, { passive: true });
      return () => {
        for (const event of ['wheel', 'pointerdown', 'keydown'])
          content.removeEventListener(event, interact);
      };
    }, [onUserScroll]);
    useEffect(() => {
      const content = node();
      content?.addEventListener('scroll', schedulePaint, { passive: true });
      schedulePaint();
      return () => {
        content?.removeEventListener('scroll', schedulePaint);
        if (frame.current !== undefined) cancelAnimationFrame(frame.current);
        frame.current = undefined;
        drag.current = undefined;
      };
    }, [schedulePaint]);
    useEffect(() => {
      if (!enabled) {
        const gesture = drag.current;
        drag.current = undefined;
        if (gesture && thumb.current?.hasPointerCapture(gesture.pointerId))
          thumb.current.releasePointerCapture(gesture.pointerId);
      }
      schedulePaint();
    }, [enabled, schedulePaint]);
    const finishDrag = () => {
      drag.current = undefined;
      schedulePaint();
    };
    return (
      <View style={{ flex: 1, minHeight: 0 }}>
        <ScrollView
          {...props}
          nativeID="chat-history-scroll"
          ref={scroll}
          showsVerticalScrollIndicator={false}
          onLayout={(event) => {
            schedulePaint();
            props.onLayout?.(event);
          }}
          onContentSizeChange={(width, height) => {
            schedulePaint();
            props.onContentSizeChange?.(width, height);
          }}
        />
        <div
          ref={thumb}
          role="scrollbar"
          aria-label="Chat scrollbar"
          aria-controls="chat-history-scroll"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-disabled={!enabled}
          tabIndex={enabled ? 0 : -1}
          style={{
            position: 'absolute',
            right: 2,
            top: 0,
            width: 6,
            borderRadius: 3,
            background: 'rgba(92, 119, 139, 0.45)',
            touchAction: 'none',
            userSelect: 'none',
            cursor: enabled ? 'pointer' : 'default',
            opacity: enabled ? 1 : 0.5,
            willChange: 'transform',
          }}
          onPointerDown={(event) => {
            if (!enabled || event.button !== 0 || drag.current) return;
            event.preventDefault();
            onUserScroll?.();
            event.currentTarget.setPointerCapture(event.pointerId);
            const bounds = event.currentTarget.getBoundingClientRect();
            drag.current = {
              pointerId: event.pointerId,
              clientY: event.clientY,
              grabOffset: event.clientY - bounds.top,
              height: bounds.height,
            };
          }}
          onPointerMove={(event) => {
            if (!enabled || drag.current?.pointerId !== event.pointerId) return;
            drag.current.clientY = event.clientY;
            schedulePaint();
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return;
            drag.current.clientY = event.clientY;
            paint();
            finishDrag();
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
          onKeyDown={(event) => {
            const content = node();
            if (!enabled || !content) return;
            const maximum = Math.max(0, content.scrollHeight - content.clientHeight);
            const offset =
              event.key === 'ArrowUp'
                ? content.scrollTop + 40
                : event.key === 'ArrowDown'
                  ? content.scrollTop - 40
                  : event.key === 'PageUp'
                    ? content.scrollTop + content.clientHeight
                    : event.key === 'PageDown'
                      ? content.scrollTop - content.clientHeight
                      : event.key === 'Home'
                        ? maximum
                        : event.key === 'End'
                          ? 0
                          : undefined;
            if (offset === undefined) return;
            onUserScroll?.();
            event.preventDefault();
            content.scrollTop = Math.min(maximum, Math.max(0, offset));
          }}
        />
      </View>
    );
  },
);
