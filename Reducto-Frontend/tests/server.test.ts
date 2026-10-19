import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerUrl, parseStoredSession } from '../src/lib/server';

test('server URLs normalize HTTP(S) origins including local ports and IPv6', () => {
  assert.equal(normalizeServerUrl(' https://CHAT.example.com/ '), 'https://chat.example.com');
  assert.equal(normalizeServerUrl('http://192.168.1.5:3000'), 'http://192.168.1.5:3000');
  assert.equal(normalizeServerUrl('http://[::1]:3000/'), 'http://[::1]:3000');
});

test('invalid server URLs and embedded credentials are rejected before sign-in', () => {
  for (const value of [
    '',
    'chat.example.com',
    'javascript:alert(1)',
    'ftp://chat.example.com',
    'https://name:password@chat.example.com',
    'https://chat.example.com/api',
    'https://chat.example.com?target=other',
    'https://chat.example.com/#fragment',
  ]) {
    assert.throws(() => normalizeServerUrl(value));
  }
});

test('stored tokens are restored only when bound to a valid known server', () => {
  const session = { user: { id: 'user' }, accessToken: 'access', refreshToken: 'refresh' };
  assert.equal(parseStoredSession(JSON.stringify(session)), null);
  assert.equal(parseStoredSession(JSON.stringify({ ...session, serverUrl: 'file:///tmp' })), null);
  assert.equal(parseStoredSession('broken'), null);
  assert.equal(
    parseStoredSession(JSON.stringify({ ...session, serverUrl: 'https://chat.example.com/' }))
      ?.serverUrl,
    'https://chat.example.com',
  );
});
