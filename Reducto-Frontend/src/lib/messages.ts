import type { Conversation, Message } from '../api/types';

export function mergeMessages(current: Message[], incoming: Message[]) {
  const merged = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) merged.set(message.id, { ...merged.get(message.id), ...message });
  return [...merged.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}
export function conversationName(chat: Conversation, peerId?: string) {
  return chat.name || (peerId ? `User ${peerId.slice(0, 8)}` : 'Private chat');
}
export function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'R'
  );
}
export function timeLabel(date: string) {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
export function preview(message?: Message) {
  return (
    message?.text ||
    (message?.attachment
      ? `${message.attachment.type.toUpperCase()} attachment`
      : 'Start a conversation')
  );
}
