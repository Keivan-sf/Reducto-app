import type { ApiClient } from './client';
import type { Message, MessagePage } from './types';

export const SEARCH_DELAY = 450;

export interface SearchState extends MessagePage {
  query: string;
  submitted: boolean;
  loading: boolean;
  error: string;
}

const empty = (): SearchState => ({
  query: '',
  messages: [],
  nextCursor: null,
  submitted: false,
  loading: false,
  error: '',
});

/** Independent from chat history: search pages must never replace the live cache. */
export class ConversationSearch {
  private state = empty();
  private listeners = new Set<() => void>();
  private sequence = 0;
  private request?: AbortController;
  constructor(
    private api: Pick<ApiClient, 'get'>,
    private conversationId: string,
  ) {}

  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: SearchState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  reset() {
    this.sequence++;
    this.request?.abort();
    this.update(empty());
  }
  async search(query: string): Promise<Message[] | undefined> {
    this.reset();
    query = query.trim();
    if (!query) return;
    this.update({ ...empty(), query, submitted: true });
    return this.load();
  }
  async load(): Promise<Message[] | undefined> {
    const state = this.state;
    if (state.loading || !state.query || (state.messages.length && !state.nextCursor)) return;
    const sequence = ++this.sequence;
    const request = new AbortController();
    this.request = request;
    this.update({ ...state, loading: true, error: '' });
    const params = new URLSearchParams({ q: state.query, limit: '50' });
    if (state.nextCursor) params.set('before', state.nextCursor);
    try {
      const page = await this.api.get<MessagePage>(
        `/api/conversations/${encodeURIComponent(this.conversationId)}/messages/search?${params}`,
        request.signal,
      );
      if (sequence !== this.sequence) return;
      const messages = [
        ...new Map([...state.messages, ...page.messages].map((m) => [m.id, m])).values(),
      ];
      this.update({ ...state, messages, nextCursor: page.nextCursor, loading: false, error: '' });
      return messages;
    } catch (error) {
      if (sequence === this.sequence)
        this.update({ ...state, loading: false, error: (error as Error).message });
    }
  }
}

export function searchSnippet(message: Message) {
  const metadata = message.attachmentMetadata;
  const details =
    metadata && 'fileName' in metadata
      ? [metadata.title, metadata.artist, metadata.fileName].filter(Boolean).join(' · ')
      : '';
  return (
    [message.text, details].filter(Boolean).join(' · ') || message.attachment?.type || 'Message'
  );
}
