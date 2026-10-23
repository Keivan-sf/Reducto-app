import type { AttachmentMetadata, Gif, Message } from '../api/types';

export function messageMedia(message: Message): AttachmentMetadata | undefined {
  const { attachment, attachmentMetadata: metadata } = message;
  return attachment &&
    attachment.type !== 'gif' &&
    metadata &&
    'type' in metadata &&
    metadata.id === attachment.mediaId &&
    metadata.type === attachment.type
    ? metadata
    : undefined;
}

export function messageGif(message: Message): Gif | undefined {
  const { attachment, attachmentMetadata: metadata } = message;
  return attachment?.type === 'gif' &&
    metadata &&
    'playbackUrl' in metadata &&
    metadata.id === attachment.gifId
    ? metadata
    : undefined;
}
