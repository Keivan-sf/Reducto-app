import type { Message } from './types';
import { comparePosition } from './read-state';

export type ReceiptPositions = Record<string, Record<string, Message>>;

export function advanceReceipt(
  positions: ReceiptPositions,
  conversationId: string,
  userId: string,
  marker: Message,
): ReceiptPositions {
  if (marker.conversationId !== conversationId) return positions;
  const current = positions[conversationId]?.[userId];
  if (current && comparePosition(current, marker) >= 0) return positions;
  return {
    ...positions,
    [conversationId]: { ...positions[conversationId], [userId]: marker },
  };
}

export function seenByAnotherMember(
  message: Message,
  senderId: string,
  positions: ReceiptPositions,
): boolean {
  if (message.delivery) return false;
  return Object.entries(positions[message.conversationId] ?? {}).some(
    ([userId, marker]) => userId !== senderId && comparePosition(marker, message) >= 0,
  );
}
