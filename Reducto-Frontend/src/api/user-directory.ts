import type { UserProfile } from './types';
import { normalizeUsername } from '../lib/usernames';

// Signed avatars expire after 15 minutes. Renew profiles before that deadline.
export const PROFILE_TTL = 10 * 60 * 1000;
export class UserDirectory {
  private entries = new Map<string, { user: UserProfile; fetchedAt: number }>();
  private pending = new Map<string, Promise<UserProfile>>();
  private knownIds = new Set<string>();
  private revision = 0;
  private invalidatedAt = new Map<string, number>();
  constructor(
    private request: (path: string) => Promise<{ user: UserProfile }>,
    private publish: (user: UserProfile) => void,
    private now = Date.now,
  ) {}

  private load(path: string) {
    const pending = this.pending.get(path);
    if (pending) return pending;
    const startedAtRevision = this.revision;
    const flight = this.request(path)
      .then(({ user }) => {
        if (
          this.pending.get(path) === flight &&
          (this.invalidatedAt.get(user.id) ?? 0) <= startedAtRevision
        ) {
          this.knownIds.add(user.id);
          this.entries.set(user.id, { user, fetchedAt: this.now() });
          this.publish(user);
        }
        return user;
      })
      .finally(() => {
        if (this.pending.get(path) === flight) this.pending.delete(path);
      });
    this.pending.set(path, flight);
    return flight;
  }
  get(id: string) {
    this.knownIds.add(id);
    const entry = this.entries.get(id);
    if (entry && this.now() - entry.fetchedAt < PROFILE_TTL) return Promise.resolve(entry.user);
    return this.load(`/api/users/${encodeURIComponent(id)}`);
  }
  byUsername(value: string) {
    const username = normalizeUsername(value);
    const entry = [...this.entries.values()].find(
      (entry) => entry.user.username?.toLowerCase() === username,
    );
    if (entry && this.now() - entry.fetchedAt < PROFILE_TTL) return Promise.resolve(entry.user);
    return this.load(`/api/users/by-username/${encodeURIComponent(username)}`);
  }
  invalidate(id: string) {
    this.invalidatedAt.set(id, ++this.revision);
    // Preserve the visible profile and retry stale entries if a refresh fails.
    const entry = this.entries.get(id);
    if (entry) this.entries.set(id, { ...entry, fetchedAt: -Infinity });
    this.pending.delete(`/api/users/${encodeURIComponent(id)}`);
  }
  refreshUser(id: string) {
    this.invalidate(id);
    return this.get(id);
  }
  getMany(ids: string[]) {
    return Promise.allSettled([...new Set(ids)].filter(Boolean).map((id) => this.get(id)));
  }
  refreshKnown(force = false) {
    const ids = [...this.knownIds];
    if (force) for (const id of ids) this.invalidate(id);
    return this.getMany(ids);
  }
}
