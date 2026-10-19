export interface User {
  id: string;
  email: string;
  name: string;
  username: string | null;
  avatarKey: string | null;
}
export interface Tokens {
  accessToken: string;
  refreshToken: string;
}
export interface Session extends Tokens {
  user: User;
}
export interface Conversation {
  id: string;
  type: 'private' | 'group';
  name: string | null;
  createdAt: string;
  inviteLink?: string;
}
export interface Member {
  userId: string;
  conversationId: string;
  role: 'owner' | 'admin' | 'member';
}
export const EMOJIS = ['👍', '👎', '❤️', '😂', '😮', '😢', '🔥', '🎉'] as const;
export type Emoji = (typeof EMOJIS)[number];
export type Attachment =
  | { type: 'gif'; gifId: string }
  | { type: 'image' | 'video' | 'audio' | 'music' | 'document'; mediaId: string };
export interface Reaction {
  userId: string;
  emoji: Emoji;
  messageId: string;
}
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string | null;
  attachment: Attachment | null;
  forwardedFrom: { senderId: string; messageId: string; conversationId: string } | null;
  createdAt: string;
  reactions?: Reaction[];
}
export interface MessagePage {
  messages: Message[];
  nextCursor: string | null;
}
export interface Gif {
  id: string;
  objectKey: string;
  fileSize: number;
  createdAt: string;
}
