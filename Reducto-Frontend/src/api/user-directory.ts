import type { UserProfile } from './types';
import { normalizeUsername } from '../lib/usernames';

// Signed avatars expire after 15 minutes. Renew profiles before that deadline.
export const PROFILE_TTL = 10 * 60 * 1000;
export class UserDirectory {
  private entries = new Map<string, { user: UserProfile; fetchedAt: number }>();
  private pending = new Map<string, Promise<UserProfile>>();
  constructor(
    private request: (path: string) => Promise<{ user: UserProfile }>,
    private publish: (user: UserProfile) => void,
    private now = Date.now,
  ) {}

  private load(path: string) {
    const pending = this.pending.get(path);
    if (pending) return pending;
    const flight = this.request(path)
      .then(({ user }) => {
        if (this.pending.get(path) === flight) {
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
    this.entries.delete(id);
    this.pending.delete(`/api/users/${encodeURIComponent(id)}`);
  }
  getMany(ids: string[]) {
    return Promise.allSettled([...new Set(ids)].filter(Boolean).map((id) => this.get(id)));
  }
  refreshKnown() {
    return this.getMany([...this.entries.keys()]);
  }
}
