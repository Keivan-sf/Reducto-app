import type { Mention, Message } from './types';
import { comparePosition } from './read-state';

/** Mention IDs are random UUIDs; resolve message positions before choosing the oldest. */
export async function oldestMention(
  mentions: Mention[],
  resolve: (messageId: string) => Promise<Message>,
) {
  const unseen = [
    ...new Map(
      mentions.filter((mention) => !mention.seen).map((mention) => [mention.messageId, mention]),
    ).values(),
  ];
  let oldest: Message | undefined;
  // Bound requests for chats with many mentions. The message cache reuses these lookups.
  for (let index = 0; index < unseen.length; index += 8) {
    const messages = await Promise.all(
      unseen.slice(index, index + 8).map((mention) => resolve(mention.messageId)),
    );
    for (const message of messages)
      if (!oldest || comparePosition(message, oldest) < 0) oldest = message;
  }
  return oldest?.id;
}
