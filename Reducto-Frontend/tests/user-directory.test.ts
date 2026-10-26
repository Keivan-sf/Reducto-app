import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROFILE_TTL, UserDirectory } from '../src/api/user-directory';
import type { UserProfile } from '../src/api/types';

const user: UserProfile = {
  id: 'friend',
  name: 'Alice Example',
  username: 'alice',
  avatarUrl: 'https://storage/avatar?signature=one',
};

test('one profile request serves simultaneous chat list, header and member lookups', async () => {
  let calls = 0;
  const published: UserProfile[] = [];
  const directory = new UserDirectory(
    async (path) => {
      assert.equal(path, '/api/users/friend');
      calls++;
      return { user };
    },
    (profile) => published.push(profile),
  );
  await Promise.all([
    directory.get('friend'),
    directory.get('friend'),
    directory.getMany(['friend', 'friend']),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(published, [user]);
});

test('signed avatars renew before expiry, including after an app resumes', async () => {
  let now = 0;
  let calls = 0;
  const directory = new UserDirectory(
    async () => ({ user: { ...user, avatarUrl: `https://storage/avatar?signature=${++calls}` } }),
    () => {},
    () => now,
  );
  const first = await directory.get(user.id);
  now = PROFILE_TTL - 1;
  await directory.refreshKnown();
  assert.equal(calls, 1);
  now += 1;
  await directory.refreshKnown();
  assert.notEqual((await directory.get(user.id)).avatarUrl, first.avatarUrl);
  assert.equal(calls, 2);
});

test('username lookup normalizes @ and case and populates the user ID cache', async () => {
  const paths: string[] = [];
  const directory = new UserDirectory(
    async (path) => {
      paths.push(path);
      return { user };
    },
    () => {},
  );
  await directory.byUsername(' @ALICE ');
  assert.equal((await directory.get(user.id)).name, 'Alice Example');
  await directory.byUsername('Alice');
  assert.deepEqual(paths, ['/api/users/by-username/alice']);
});

test('profile updates invalidate cached names and avatars', async () => {
  let current = user;
  const directory = new UserDirectory(
    async () => ({ user: current }),
    () => {},
  );
  await directory.get(user.id);
  current = { ...user, name: 'Alice Updated', avatarUrl: null };
  directory.invalidate(user.id);
  assert.deepEqual(await directory.get(user.id), current);
});

test('a failed renewal keeps the previous profile and can be retried', async () => {
  let now = 0;
  let failing = false;
  const published: UserProfile[] = [];
  const directory = new UserDirectory(
    async () => {
      if (failing) throw new Error('offline');
      return { user };
    },
    (profile) => published.push(profile),
    () => now,
  );
  await directory.get(user.id);
  now = PROFILE_TTL;
  failing = true;
  const result = await directory.refreshKnown();
  assert.equal(result[0].status, 'rejected');
  assert.deepEqual(published, [user]);
  failing = false;
  await directory.refreshKnown();
  assert.equal(published.length, 2);
});

test('an old request cannot overwrite a profile edited while it was loading', async () => {
  let complete!: (result: { user: UserProfile }) => void;
  let calls = 0;
  const updated = { ...user, name: 'Updated profile' };
  const published: UserProfile[] = [];
  const directory = new UserDirectory(
    () =>
      ++calls === 1
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve({ user: updated }),
    (profile) => published.push(profile),
  );
  const old = directory.get(user.id);
  directory.invalidate(user.id);
  await directory.get(user.id);
  complete({ user });
  await old;
  assert.deepEqual(published, [updated]);
  assert.deepEqual(await directory.get(user.id), updated);
});

test('a profile notification bypasses the TTL and replaces all changed details', async () => {
  let current = user;
  const published: UserProfile[] = [];
  const directory = new UserDirectory(
    async () => ({ user: current }),
    (profile) => published.push(profile),
  );
  await directory.get(user.id);
  current = {
    ...user,
    name: 'Alice Updated',
    username: 'alice_updated',
    avatarUrl: 'https://storage/new-avatar',
  };
  assert.deepEqual(await directory.refreshUser(user.id), current);
  current = { ...current, username: null, avatarUrl: null };
  await directory.refreshUser(user.id);
  assert.deepEqual(published.at(-1), current);
});

test('a username lookup started before a notification cannot restore stale details', async () => {
  let complete!: (result: { user: UserProfile }) => void;
  const updated = { ...user, username: 'renamed' };
  const published: UserProfile[] = [];
  const directory = new UserDirectory(
    (path) =>
      path.includes('/by-username/')
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve({ user: updated }),
    (profile) => published.push(profile),
  );
  const stale = directory.byUsername(user.username!);
  await directory.refreshUser(user.id);
  complete({ user });
  await stale;
  assert.deepEqual(published, [updated]);
  assert.deepEqual(await directory.get(user.id), updated);
});

test('rapid notifications cannot publish responses in the wrong order', async () => {
  const complete: ((result: { user: UserProfile }) => void)[] = [];
  const published: UserProfile[] = [];
  const directory = new UserDirectory(
    () => new Promise((resolve) => complete.push(resolve)),
    (profile) => published.push(profile),
  );
  const first = directory.refreshUser(user.id);
  const second = directory.refreshUser(user.id);
  const latest = { ...user, name: 'Latest name', avatarUrl: 'https://storage/latest' };
  complete[1]({ user: latest });
  await second;
  complete[0]({ user });
  await first;
  assert.deepEqual(published, [latest]);
});

test('reconnection refreshes fresh cached profiles and retries failed notification requests', async () => {
  let current = user;
  let failing = false;
  let calls = 0;
  const published: UserProfile[] = [];
  const directory = new UserDirectory(
    async () => {
      calls++;
      if (failing) throw new Error('offline');
      return { user: current };
    },
    (profile) => published.push(profile),
  );
  await directory.get(user.id);
  current = { ...user, name: 'Changed while offline' };
  await directory.refreshKnown(true);
  assert.equal(calls, 2);
  assert.deepEqual(published.at(-1), current);
  failing = true;
  await assert.rejects(directory.refreshUser(user.id), /offline/);
  failing = false;
  current = { ...current, avatarUrl: 'https://storage/new' };
  await directory.refreshKnown();
  assert.deepEqual(published.at(-1), current);
});

test('socket presence updates cached profiles immediately without another request', async () => {
  let calls = 0;
  const published: UserProfile[] = [];
  const directory = new UserDirectory(
    async () => {
      calls++;
      return { user: { ...user, online: false, last_seen: null } };
    },
    (profile) => published.push(profile),
  );
  await directory.get(user.id);
  directory.updatePresence({ userId: user.id, online: true, last_seen: '2026-10-26T12:00:00Z' });
  assert.equal(published.at(-1)?.online, true);
  assert.equal((await directory.get(user.id)).online, true);
  directory.updatePresence({ userId: user.id, online: false, last_seen: '2026-10-26T12:01:00Z' });
  assert.equal(published.at(-1)?.online, false);
  assert.equal(published.at(-1)?.last_seen, '2026-10-26T12:01:00Z');
  assert.equal(calls, 1);
});

test('a presence transition wins over an older HTTP response, then reconnect can resync it', async () => {
  let complete!: (result: { user: UserProfile }) => void;
  let current = { ...user, online: false, last_seen: '2026-10-26T12:00:00Z' };
  let calls = 0;
  const published: UserProfile[] = [];
  const directory = new UserDirectory(
    () =>
      ++calls === 1
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve({ user: current }),
    (profile) => published.push(profile),
  );
  const loading = directory.byUsername('grace');
  directory.updatePresence({ userId: user.id, online: true, last_seen: '2026-10-26T12:01:00Z' });
  complete({ user: current });
  await loading;
  assert.equal(published.at(-1)?.online, true);
  assert.equal((await directory.get(user.id)).online, true);
  current = { ...current, last_seen: '2026-10-26T12:02:00Z' };
  await directory.refreshKnown(true);
  assert.equal(published.at(-1)?.online, false);
  assert.equal(published.at(-1)?.last_seen, current.last_seen);
});
