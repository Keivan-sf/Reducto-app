import type { RefObject } from 'react';

export type VideoPlaybackProps = {
  uri?: string;
  active?: boolean;
  pauseRef?: RefObject<(() => void) | null>;
  canPlay?: () => boolean;
  loop?: boolean;
  muted?: boolean;
  nativeControls?: boolean;
  onSize?: (size: { width: number; height: number }) => void;
  onError?: () => void;
};
