import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState, type View } from 'react-native';
import type { Mention } from '../../api/types';
import { mentionIsVisible, type ScreenBounds } from '../../lib/mention-visibility';

const measure = (view: View) =>
  new Promise<ScreenBounds>((resolve) => {
    view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });

/** Cached FlatList viewability is insufficient after scrolling or replacing history. */
export function useMentionVisibility({
  enabled,
  mentions,
  markSeen,
  onError,
  viewers,
}: {
  enabled: boolean;
  mentions: Mention[] | undefined;
  markSeen: (messageId: string) => Promise<void>;
  onError: (error: string) => void;
  viewers: { isOpen: () => boolean; subscribe: (listener: () => void) => () => void };
}) {
  const viewport = useRef<View>(null);
  const rows = useRef(new Map<string, View>());
  const attempted = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const check = useRef<(version: number) => Promise<void>>(async () => {});
  const cancel = useCallback(() => {
    generation.current++;
    clearTimeout(timer.current);
  }, []);
  const schedule = useCallback(() => {
    const version = ++generation.current;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void check.current(version);
    }, 350);
  }, []);
  useLayoutEffect(() => {
    check.current = async (version) => {
      if (!enabled || AppState.currentState !== 'active' || viewers.isOpen() || !viewport.current)
        return;
      const frame = await measure(viewport.current);
      for (const { messageId, seen } of mentions ?? []) {
        const row = rows.current.get(messageId);
        if (!row || seen) continue;
        const bounds = await measure(row);
        if (version !== generation.current) return;
        if (!mentionIsVisible(bounds, frame)) {
          attempted.current.delete(messageId);
          continue;
        }
        if (attempted.current.has(messageId) || inFlight.current.has(messageId)) continue;
        attempted.current.add(messageId);
        inFlight.current.add(messageId);
        void markSeen(messageId)
          .catch((error: Error) => onError(error.message))
          .finally(() => inFlight.current.delete(messageId));
      }
    };
    schedule();
  });
  useEffect(() => {
    const subscription = AppState.addEventListener('change', schedule);
    const unsubscribe = viewers.subscribe(schedule);
    return () => {
      subscription.remove();
      unsubscribe();
      cancel();
    };
  }, [schedule, viewers, cancel]);
  return {
    setViewport: (view: View | null) => {
      viewport.current = view;
    },
    register: (id: string, view: View | null) => {
      if (view) rows.current.set(id, view);
      else rows.current.delete(id);
    },
    schedule,
    retry: (id: string) => {
      attempted.current.delete(id);
      schedule();
    },
  };
}
