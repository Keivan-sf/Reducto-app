import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ApiClient, ApiError } from '../src/api/client';
import type { Session } from '../src/api/types';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const session: Session = {
  accessToken: 'expired',
  refreshToken: 'refresh-1',
  user: { id: 'user-1', name: 'Ada', email: 'ada@example.com', username: null, avatarKey: null },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('parallel unauthorized requests share one rotating refresh and retry with the new token', async () => {
  const client = new ApiClient('http://test');
  client.setSession(session);
  let refreshes = 0;
  let persisted = 0;
  client.onSession = async (next) => {
    assert.equal(next?.refreshToken, 'refresh-2');
    persisted++;
  };
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/refresh')) {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(JSON.parse(options!.body as string).refreshToken, 'refresh-1');
      return json({ accessToken: 'valid', refreshToken: 'refresh-2' });
    }
    return new Headers(options!.headers).get('Authorization') === 'Bearer valid'
      ? json({ ok: true })
      : json({ error: 'Expired' }, 401);
  };
  const results = await Promise.all([client.get('/one'), client.get('/two')]);
  assert.deepEqual(results, [{ ok: true }, { ok: true }]);
  assert.equal(refreshes, 1);
  assert.equal(persisted, 1);
});

test('invalid refresh clears the session while network failure preserves it', async () => {
  const client = new ApiClient('http://test');
  client.setSession(session);
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  await assert.rejects(client.refresh(), (err: ApiError) => err.status === 0);
  assert.equal(client.getSession(), session);
  globalThis.fetch = async () => json({ error: 'Invalid refresh token' }, 401);
  await assert.rejects(client.refresh(), /Invalid refresh token/);
  assert.equal(client.getSession(), null);
});

test('logout during token refresh cannot restore the session', async () => {
  const client = new ApiClient('http://test');
  client.setSession(session);
  let complete!: (response: Response) => void;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const refreshing = client.refresh();
  client.setSession(null);
  complete(json({ accessToken: 'new', refreshToken: 'new' }));
  await refreshing;
  assert.equal(client.getSession(), null);
});

test('multipart uploads keep the browser-generated boundary and 204 returns void', async () => {
  const client = new ApiClient('http://test');
  client.setSession(session);
  const body = new FormData();
  body.append('file', new Blob(['hello']), 'hello.txt');
  globalThis.fetch = async (_url, options) => {
    assert.equal(new Headers(options!.headers).has('Content-Type'), false);
    assert.equal(new Headers(options!.headers).get('Authorization'), 'Bearer expired');
    assert.equal(options!.body, body);
    return new Response(null, { status: 204 });
  };
  assert.equal(await client.request('/upload', { method: 'POST', body }), undefined);
});

test('validation errors expose the backend error and do not refresh', async () => {
  const client = new ApiClient('http://test');
  client.setSession(session);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return json({ error: 'Username is already registered' }, 409);
  };
  await assert.rejects(
    client.patch('/profile', { username: 'ada' }),
    (err: ApiError) => err.status === 409 && err.message === 'Username is already registered',
  );
  assert.equal(calls, 1);
});
