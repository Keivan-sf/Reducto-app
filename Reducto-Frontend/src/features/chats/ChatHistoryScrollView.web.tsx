import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef } from 'react';
import { ScrollView, View } from 'react-native';

import type { ChatHistoryScrollProps } from './ChatHistoryScrollView.types';

interface ThumbDrag {
  pointerId: number;
  clientY: number;
  grabOffset: number;
  height: number;
}

/** A transparent overlay shared by chat history and the conversation list. Paint once per
 * animation frame so scrolling never waits for a React render. */
export const ChatHistoryScrollView = forwardRef<ScrollView, ChatHistoryScrollProps>(
  function ChatHistoryScrollView(
    { onUserScroll, scrollbarInverted = true, scrollbarLabel = 'Chat scrollbar', ...props },
    ref,
  ) {
    const scrollId = useId();
    const scroll = useRef<ScrollView>(null);
    const thumb = useRef<HTMLDivElement>(null);
    const drag = useRef<ThumbDrag | undefined>(undefined);
    const frame = useRef<number | undefined>(undefined);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const visible = useRef(false);
    const enabled = props.scrollEnabled !== false;
    useImperativeHandle(ref, () => scroll.current!, []);
    const node = () => scroll.current?.getScrollableNode() as HTMLElement | undefined;
    const updateVisibility = useCallback(() => {
      const indicator = thumb.current;
      if (!indicator) return;
      indicator.style.transition = `opacity ${visible.current ? 120 : 180}ms ease-out`;
      indicator.style.opacity = visible.current ? (enabled ? '1' : '0.5') : '0';
      indicator.style.pointerEvents = visible.current && enabled ? 'auto' : 'none';
    }, [enabled]);
    const reveal = useCallback(() => {
      visible.current = true;
      updateVisibility();
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        if (drag.current) return;
        visible.current = false;
        updateVisibility();
      }, 1000);
    }, [updateVisibility]);
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
        const fraction = (top - 2) / travel;
        content.scrollTop = maximum * (scrollbarInverted ? 1 - fraction : fraction);
      } else {
        const fraction = Math.min(maximum, Math.max(0, content.scrollTop)) / maximum;
        top = 2 + travel * (scrollbarInverted ? 1 - fraction : fraction);
      }
      indicator.style.height = `${thumbHeight}px`;
      indicator.style.transform = `translate3d(0, ${top}px, 0)`;
      indicator.setAttribute('aria-valuemax', String(Math.round(maximum)));
      indicator.setAttribute(
        'aria-valuenow',
        String(Math.round(scrollbarInverted ? maximum - content.scrollTop : content.scrollTop)),
      );
    }, [scrollbarInverted]);
    const schedulePaint = useCallback(() => {
      if (frame.current !== undefined) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        paint();
      });
    }, [paint]);
    useEffect(() => {
      const content = node();
      const region = content?.parentElement;
      if (!content || !region) return;
      if (visible.current) reveal();
      // Listen on the whole region, including the overlay thumb. Merely leaving
      // the pointer parked here should not keep the indicator visible.
      const onScroll = () => {
        if (visible.current) reveal();
      };
      const events = ['pointerenter', 'pointermove', 'pointerdown', 'wheel', 'keydown'];
      for (const event of events) region.addEventListener(event, reveal, { passive: true });
      content.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        for (const event of events) region.removeEventListener(event, reveal);
        content.removeEventListener('scroll', onScroll);
        clearTimeout(hideTimer.current);
      };
    }, [reveal]);
    useEffect(() => {
      updateVisibility();
    }, [updateVisibility]);
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
      reveal();
      schedulePaint();
    };
    return (
      <View style={{ flex: 1, minHeight: 0 }}>
        <ScrollView
          {...props}
          nativeID={scrollId}
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
          aria-label={scrollbarLabel}
          aria-controls={scrollId}
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
            opacity: 0,
            pointerEvents: 'none',
            transition: 'opacity 180ms ease-out',
            willChange: 'transform, opacity',
          }}
          onFocus={reveal}
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
            const direction = scrollbarInverted ? -1 : 1;
            const offset =
              event.key === 'ArrowUp'
                ? content.scrollTop - direction * 40
                : event.key === 'ArrowDown'
                  ? content.scrollTop + direction * 40
                  : event.key === 'PageUp'
                    ? content.scrollTop - direction * content.clientHeight
                    : event.key === 'PageDown'
                      ? content.scrollTop + direction * content.clientHeight
                      : event.key === 'Home'
                        ? scrollbarInverted
                          ? maximum
                          : 0
                        : event.key === 'End'
                          ? scrollbarInverted
                            ? 0
                            : maximum
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
