export interface UserPresence {
  online?: boolean;
  last_seen?: string | null;
}
export interface PresenceEvent extends UserPresence {
  userId: string;
  online: boolean;
  last_seen: string | null;
}
export interface UserProfile extends UserPresence {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
}
export interface ProfileUpdatedEvent {
  userId: string;
  changedFields: ('name' | 'username' | 'avatar')[];
}
export interface User extends UserPresence {
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
  serverUrl: string;
  user: User;
}
export interface Conversation {
  id: string;
  type: 'private' | 'group';
  name: string | null;
  createdAt: string;
  inviteLink?: string;
  lastSeenMessageId?: string | null;
  unreadCount?: number;
  unseenMentions?: Mention[];
}
export interface Mention {
  userId: string;
  conversationId: string;
  messageId: string;
  seen: boolean;
}
export interface SeenState {
  lastSeenMessageId: string | null;
  unreadCount: number;
}
export interface Member extends UserPresence {
  userId: string;
  conversationId: string;
  role: 'owner' | 'admin' | 'member';
  lastSeenMessageId?: string | null;
}
export const EMOJIS = ['👍', '👎', '❤️', '😂', '😮', '😢', '🔥', '🎉'] as const;
export type Emoji = (typeof EMOJIS)[number];
export type Attachment =
  | { type: 'gif'; gifId: string }
  | { type: 'image' | 'video' | 'audio' | 'music' | 'voice' | 'document'; mediaId: string };
export interface Reaction {
  userId: string;
  emoji: Emoji;
  messageId: string;
}
export interface PendingUpload {
  type: Attachment['type'];
  name: string;
  uri?: string;
  total: number;
  sent: number;
  duration?: number;
}
export interface Message {
  /** Persisted by the server after a message text edit. */
  isEdited: boolean;
  /** Local outbox state; never sent to the backend or used as a read watermark. */
  delivery?: 'sending' | 'failed';
  upload?: PendingUpload;
  localId?: string;
  sendError?: string;
  replyToMessageId?: string | null;
  id: string;
  conversationId: string;
  senderId: string;
  text: string | null;
  attachment: Attachment | null;
  attachmentMetadata?: AttachmentMetadata | Gif | null;
  forwardedFrom: { senderId: string; messageId: string; conversationId: string } | null;
  createdAt: string;
  reactions?: Reaction[];
}
export interface MessageUpdatedEvent {
  isEdited: boolean;
  conversationId: string;
  messageId: string;
  text: string;
}
export interface MessagePage {
  messages: Message[];
  nextCursor: string | null;
}
export interface AroundMessages {
  message: Message;
  before: Message[];
  after: Message[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}
export interface VisualMediaMetadata {
  width?: number | null;
  height?: number | null;
  thumbnailKey?: string | null;
  thumbnailUrl?: string | null;
}
export interface AttachmentMetadata extends VisualMediaMetadata {
  id: string;
  type: 'image' | 'video' | 'audio' | 'music' | 'voice' | 'document';
  fileName: string;
  contentType: string;
  fileSize: number;
  durationSeconds?: number | null;
  title?: string | null;
  artist?: string | null;
  coverKey?: string | null;
  coverUrl?: string | null;
}
export interface Gif extends VisualMediaMetadata {
  playbackUrl: string;
  id: string;
  objectKey: string;
  fileSize: number;
  createdAt: string;
}
