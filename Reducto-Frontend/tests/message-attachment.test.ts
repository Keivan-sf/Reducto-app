import assert from 'node:assert/strict';
import test from 'node:test';
import { messageGif, messageMedia } from '../src/lib/message-attachment';
import type { Message } from '../src/api/types';

const message: Message = {
  id: 'message',
  conversationId: 'conversation',
  senderId: 'sender',
  text: null,
  attachment: { type: 'video', mediaId: 'video' },
  attachmentMetadata: {
    id: 'video',
    type: 'video',
    fileName: 'clip.mp4',
    contentType: 'video/mp4',
    fileSize: 100,
    width: 640,
    height: 360,
    durationSeconds: 12,
  },
  forwardedFrom: null,
  createdAt: '2026-10-18T12:00:00Z',
};

test('uses only metadata belonging to the displayed attachment', () => {
  assert.equal(messageMedia(message)?.width, 640);
  assert.equal(
    messageMedia({ ...message, attachment: { type: 'image', mediaId: 'video' } }),
    undefined,
  );
  assert.equal(
    messageMedia({ ...message, attachment: { type: 'video', mediaId: 'other' } }),
    undefined,
  );
  assert.equal(messageGif(message), undefined);
  const gif: Message = {
    ...message,
    attachment: { type: 'gif', gifId: 'gif' },
    attachmentMetadata: {
      id: 'gif',
      objectKey: 'gifs/clip.mp4',
      fileSize: 100,
      createdAt: message.createdAt,
      playbackUrl: 'https://example.test/clip.mp4',
      width: 80,
      height: 200,
    },
  };
  assert.equal(messageGif(gif)?.height, 200);
});
