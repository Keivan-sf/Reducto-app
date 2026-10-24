import type { ComponentProps } from 'react';
import { videoKey } from '../../context/VideosContext';
import { ZoomableMediaViewer } from './ZoomableMediaViewer';

type ImageViewerProps = Omit<
  ComponentProps<typeof ZoomableMediaViewer>,
  'kind' | 'fileKey' | 'pauseRef' | 'canPlay'
> & {
  conversationId: string;
  mediaId: string;
};

export function ImageViewer({ conversationId, mediaId, ...props }: ImageViewerProps) {
  return (
    <ZoomableMediaViewer {...props} kind="image" fileKey={videoKey(conversationId, mediaId)} />
  );
}
