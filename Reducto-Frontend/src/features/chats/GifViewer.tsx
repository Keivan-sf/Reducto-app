import type { ComponentProps } from 'react';
import { gifFileKey } from '../../context/VideosContext';
import { ZoomableMediaViewer } from './ZoomableMediaViewer';

type GifViewerProps = Omit<ComponentProps<typeof ZoomableMediaViewer>, 'kind' | 'fileKey'> & {
  gifId: string;
};

export function GifViewer({ gifId, ...props }: GifViewerProps) {
  return <ZoomableMediaViewer {...props} kind="gif" fileKey={gifFileKey(gifId)} />;
}
