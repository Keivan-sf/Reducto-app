import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ApiClient, ApiError } from '../src/api/client';
import type { Session } from '../src/api/types';
import { normalizeServerUrl } from '../src/lib/server';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const session: Session = {
  serverUrl: 'https://old.example',
  accessToken: 'access',
  refreshToken: 'refresh',
  user: { id: 'ada', name: 'Ada', email: 'ada@example.com', username: null, avatarKey: null },
};
const { outputText } = ts.transpileModule(
  readFileSync(new URL('../src/context/SessionContext.tsx', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
);

// Run the provider with in-memory storage and hooks so network races can be held open.
function provider() {
  let stored: Session | null = session;
  let serverUrl = session.serverUrl;
  const states: unknown[] = [];
  let index = 0;
  let mounted = false;
  const effects: (() => unknown)[] = [];
  const module = { exports: {} as typeof import('../src/context/SessionContext') };
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === 'react')
        return {
          createContext: () => ({ Provider: 'provider' }),
          useState: (initial: unknown) => {
            const slot = index++;
            if (!mounted) states[slot] = initial;
            return [states[slot], (value: unknown) => (states[slot] = value)];
          },
          useEffect: (effect: () => unknown) => {
            if (!mounted) effects.push(effect);
          },
        };
      if (name === 'react/jsx-runtime') return { jsx: (_: unknown, props: unknown) => props };
      if (name === '../api/client') return { ApiClient, ApiError };
      if (name === '../lib/server') return { normalizeServerUrl };
      if (name === '../lib/storage')
        return {
          readSession: async () => stored,
          writeSession: async (next: Session | null) => {
            stored = next;
          },
          readServerUrl: async () => serverUrl,
          writeServerUrl: async (url: string) => {
            serverUrl = url;
          },
          watchStoredSession: () => () => {},
        };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => {
    index = 0;
    const result = module.exports.SessionProvider({}) as unknown as {
      value: ReturnType<typeof module.exports.useSession>;
    };
    mounted = true;
    return result.value;
  };
  render();
  for (const effect of effects) effect();
  return { render, api: module.exports.api, stored: () => stored };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('saved sessions open the UI before profile validation finishes and allow offline server changes', async () => {
  let complete!: (response: Response) => void;
  const requests: string[] = [];
  globalThis.fetch = (url) => {
    requests.push(String(url));
    return new Promise((resolve) => {
      complete = resolve;
    });
  };
  const app = provider();
  await settle();
  assert.equal(app.render().ready, true);
  assert.equal(app.render().session, session);
  assert.deepEqual(requests, ['https://old.example/api/auth/me']);

  await app.render().signOut();
  assert.equal(app.stored(), null);
  assert.equal(app.api.getSession(), null);
  assert.equal(app.render().session, null);
  await app.render().configureServer('https://new.example');
  assert.equal(app.api.baseUrl, 'https://new.example');
  assert.equal(requests.length, 1, 'local sign-out never calls the missing backend route');

  complete(new Response(JSON.stringify({ user: session.user })));
  await settle();
  assert.equal(app.stored(), null, 'late validation must not restore the old session');
  assert.equal(app.api.baseUrl, 'https://new.example');
});

test('failed background validation preserves the saved session when the server is offline', async () => {
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  const app = provider();
  await settle();
  assert.equal(app.render().ready, true);
  assert.equal(app.render().session, session);
  assert.equal(app.stored(), session);
});

test('sign-out and server changes do not wait for an in-flight token refresh', async () => {
  let complete!: (response: Response) => void;
  let started!: () => void;
  const refreshing = new Promise<void>((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/refresh')) {
      started();
      return new Promise((resolve) => {
        complete = resolve;
      });
    }
    return new Response(JSON.stringify({ error: 'Expired' }), { status: 401 });
  };
  const app = provider();
  await refreshing;
  assert.equal(app.render().ready, true);
  await app.render().signOut();
  await app.render().configureServer('https://new.example');
  complete(new Response(JSON.stringify({ accessToken: 'renewed', refreshToken: 'rotated' })));
  await settle();
  assert.equal(app.api.getSession(), null);
  assert.equal(app.stored(), null);
  assert.equal(app.api.baseUrl, 'https://new.example');
});

test('rejected credentials still clear the session during background validation', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
  const app = provider();
  await settle();
  assert.equal(app.render().ready, true);
  assert.equal(app.render().session, null);
  assert.equal(app.stored(), null);
});
