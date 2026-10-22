import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import path from 'node:path';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const inviteToken = '32d48175eefe9c95142073e7c2ac93aadf87e126616733142362774c8c8ab40a';
const inviteUri = `reducto:///api/groups/join/${inviteToken}`;

test('GIF previews autoplay muted, loop, and never expose video controls', async ({ page }) => {
  const mediaBase = 'https://media.example';
  let lookups = 0;
  const gifId = '55555555-5555-4555-8555-555555555555';
  await mockApi(page, [{ ...first, attachment: { type: 'gif', gifId } }]);
  await page.route(`**/api/gifs/${gifId}`, (route) => {
    lookups++;
    expect(route.request().headers().authorization).toBe('Bearer access-token');
    return route.fulfill({
      json: {
        gif: {
          id: gifId,
          objectKey: 'gifs/test.mp4',
          fileSize: 9000,
          createdAt: first.createdAt,
          playbackUrl: `${mediaBase}/gifs/test.mp4`,
        },
      },
    });
  });
  await page.route(`${mediaBase}/gifs/test.mp4`, (route) =>
    route.fulfill({
      path: path.join(__dirname, '../fixtures/loop.mp4'),
      contentType: 'video/mp4',
    }),
  );
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const video = page.locator('video');
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => ({
        playing: !element.paused,
        muted: element.muted,
        loop: element.loop,
        controls: element.controls,
        inline: element.playsInline,
        decoded: element.videoWidth > 0,
      })),
    )
    .toEqual({
      playing: true,
      muted: true,
      loop: true,
      controls: false,
      inline: true,
      decoded: true,
    });
  await video.evaluate((element: HTMLVideoElement & { wraps?: number }) => {
    element.wraps = 0;
    let previous = element.currentTime;
    element.addEventListener('timeupdate', () => {
      if (element.currentTime < previous) element.wraps!++;
      previous = element.currentTime;
    });
  });
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement & { wraps?: number }) => element.wraps), {
      timeout: 10000,
    })
    .toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Open gif attachment' }).click();
  await expect(page.getByRole('button', { name: 'Save GIF' })).toBeVisible();
  expect(lookups).toBe(1);
});

test('sending a library GIF reuses its signed playback link without a details lookup', async ({
  page,
}) => {
  const gifId = '55555555-5555-4555-8555-555555555555';
  const playbackUrl = 'https://media.example/library.mp4';
  let lookups = 0;
  await mockApi(page);
  await page.route('**/api/gifs', (route) =>
    route.fulfill({
      json: {
        gifs: [
          {
            id: gifId,
            objectKey: 'gifs/library.mp4',
            playbackUrl,
            fileSize: 9000,
            createdAt: first.createdAt,
          },
        ],
      },
    }),
  );
  await page.route(`**/api/gifs/${gifId}`, (route) => {
    lookups++;
    return route.fulfill({ status: 500, json: { error: 'Library metadata should be cached' } });
  });
  await page.route(playbackUrl, (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({
      path: path.join(__dirname, '../fixtures/loop.mp4'),
      contentType: 'video/mp4',
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await page.getByRole('button', { name: 'Open GIF library' }).click();
  await expect(page.locator('video')).toBeVisible();
  const sent = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/messages'),
  );
  await page.getByRole('button', { name: 'Send GIF', exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({
    attachment: { type: 'gif', gifId },
    replyToMessageId: first.id,
  });
  await expect(page.getByRole('button', { name: 'Open gif attachment' })).toBeVisible();
  const sentVideo = page.getByRole('button', { name: 'Open gif attachment' }).locator('video');
  await expect(sentVideo).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() =>
      sentVideo.evaluate((video: HTMLVideoElement) => !video.paused && video.videoWidth > 0),
    )
    .toBe(true);
  expect(lookups).toBe(0);
});

test('downloaded GIF previews keep local bytes after their signed links expire', async ({
  page,
}) => {
  await page.clock.install();
  const gifId = '55555555-5555-4555-8555-555555555555';
  let lookups = 0;
  await mockApi(page, [{ ...first, attachment: { type: 'gif', gifId } }]);
  await page.route(`**/api/gifs/${gifId}`, (route) =>
    route.fulfill({
      json: {
        gif: {
          id: gifId,
          objectKey: 'gifs/test.mp4',
          fileSize: 9000,
          createdAt: first.createdAt,
          playbackUrl: `https://media.example/test.mp4?v=${++lookups}`,
        },
      },
    }),
  );
  await page.route('https://media.example/test.mp4*', (route) =>
    route.fulfill({
      path: path.join(__dirname, '../fixtures/loop.mp4'),
      contentType: 'video/mp4',
    }),
  );
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
  const local = await page.locator('video').getAttribute('src');
  await page.clock.fastForward(10 * 60 * 1000 + 1000);
  await expect(page.locator('video')).toHaveAttribute('src', local!);
  expect(lookups).toBe(1);
});

test('an expired GIF download renews its signed URL once without sending the bearer token to storage', async ({
  page,
}) => {
  let details = 0;
  let downloads = 0;
  await mockApi(page, [{ ...first, attachment: { type: 'gif', gifId: 'expired-gif' } }]);
  await page.route('**/api/gifs/expired-gif', (route) =>
    route.fulfill({
      json: {
        gif: {
          id: 'expired-gif',
          playbackUrl: `https://media.example/expired.mp4?v=${++details}`,
        },
      },
    }),
  );
  await page.route('https://media.example/expired.mp4*', (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    downloads++;
    return downloads === 1
      ? route.fulfill({ status: 403 })
      : route.fulfill({
          path: path.join(__dirname, '../fixtures/loop.mp4'),
          contentType: 'video/mp4',
        });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() =>
      page
        .locator('video')
        .evaluate((video: HTMLVideoElement) => !video.paused && video.videoWidth > 0),
    )
    .toBe(true);
  expect(details).toBe(2);
  expect(downloads).toBe(2);
});

for (const portrait of [false, true]) {
  test(`GIF previews fit their frame and preserve ${portrait ? 'portrait' : 'landscape'} proportions`, async ({
    page,
  }) => {
    const gifId = '55555555-5555-4555-8555-555555555555';
    await mockApi(page, [{ ...first, attachment: { type: 'gif', gifId } }]);
    await page.route(`**/api/gifs/${gifId}`, (route) =>
      route.fulfill({
        json: {
          gif: {
            id: gifId,
            playbackUrl: 'https://media.example/shape.mp4',
          },
        },
      }),
    );
    await page.route('https://media.example/shape.mp4', (route) =>
      route.fulfill({
        path: path.join(__dirname, `../fixtures/${portrait ? 'portrait' : 'loop'}.mp4`),
        contentType: 'video/mp4',
      }),
    );
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    const video = page.locator('video');
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => {
          const rect = element.getBoundingClientRect();
          const frame = element.parentElement!.getBoundingClientRect();
          return (
            element.videoWidth > 0 &&
            Math.abs(rect.width / rect.height - element.videoWidth / element.videoHeight) < 0.02 &&
            Math.abs(rect.width - frame.width) < 1 &&
            Math.abs(rect.height - frame.height) < 1 &&
            frame.width <= 260 &&
            frame.height <= 280 &&
            frame.left >= 0 &&
            frame.right <= window.innerWidth
          );
        }),
      )
      .toBe(true);
    await expect(video).toHaveCSS('object-fit', 'contain');
  });
}

for (const panorama of [false, true]) {
  test(`image previews adapt to ${panorama ? 'extreme panorama' : 'portrait'} dimensions without cropping`, async ({
    page,
  }) => {
    await mockApi(page, [{ ...first, attachment: { type: 'image', mediaId: 'photo' } }]);
    await page.route('**/api/conversations/*/attachments/photo', (route) =>
      route.fulfill({
        path: path.join(__dirname, `../fixtures/${panorama ? 'panorama' : 'portrait'}.png`),
        contentType: 'image/png',
      }),
    );
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    const frame = page.getByLabel('Image preview', { exact: true });
    await expect
      .poll(async () => {
        const box = await frame.boundingBox();
        return box ? box.width / box.height : 0;
      })
      .toBeCloseTo(panorama ? 2.5 : 0.6, 1);
    await expect
      .poll(() =>
        frame.evaluate((element) => {
          const box = element.getBoundingClientRect();
          // React Native Web renders an Image as a background sized to contain.
          const image = element.querySelector('[style*="background-image"]');
          return (
            box.width <= 260 &&
            box.height <= 280 &&
            box.left >= 0 &&
            box.right <= window.innerWidth &&
            !!image &&
            getComputedStyle(image).backgroundSize === 'contain'
          );
        }),
      )
      .toBe(true);
  });
}

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  username: 'ada',
  avatarKey: null,
};
const chat = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Weekend plans',
  type: 'group',
  createdAt: '2026-10-18T12:00:00Z',
};
const first = {
  id: '33333333-3333-4333-8333-333333333333',
  conversationId: chat.id,
  senderId: 'friend',
  text: 'Hello from the group!',
  attachment: null,
  forwardedFrom: null,
  createdAt: '2026-10-18T12:01:00Z',
  reactions: [],
};
const friend = {
  id: 'friend',
  name: 'Grace Hopper',
  username: 'grace',
  avatarUrl: 'https://avatars.example/grace.png',
};
async function mockApi(
  page: Page,
  initialMessages: object[] = [first],
  selectedServer: string | null = 'http://localhost:3001',
) {
  if (selectedServer)
    await page.addInitScript((serverUrl) => {
      if (!localStorage.getItem('reducto.server.v1'))
        localStorage.setItem('reducto.server.v1', serverUrl);
    }, selectedServer);
  const messages = [...initialMessages];
  await page.route('https://avatars.example/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1cAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.route(`${selectedServer ?? 'http://localhost:3001'}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path.endsWith('/sign-in') || path.endsWith('/sign-up')) {
      if (request.postDataJSON().password === 'wrongpassword')
        return route.fulfill({ status: 401, json: { error: 'Invalid credentials' } });
      body = { user, accessToken: 'access-token', refreshToken: 'refresh-token' };
    } else if (path.startsWith('/api/users/by-username/')) body = { user: friend };
    else if (path.startsWith('/api/users/'))
      body = {
        user: path.endsWith(user.id)
          ? { id: user.id, name: user.name, username: user.username, avatarUrl: null }
          : friend,
      };
    else if (path.endsWith('/me')) body = { user };
    else if (path === '/api/conversations') body = { conversations: [chat] };
    else if (path.endsWith('/members'))
      body = {
        members: [
          { userId: user.id, conversationId: chat.id, role: 'owner' },
          { userId: 'friend', conversationId: chat.id, role: 'member' },
        ],
      };
    else if (path.endsWith('/seen') && request.method() === 'PUT')
      body = { lastSeenMessageId: request.postDataJSON().messageId, unreadCount: 0 };
    else if (path.endsWith('/messages') && request.method() === 'POST') {
      const message = {
        ...first,
        ...request.postDataJSON(),
        id: '44444444-4444-4444-8444-444444444444',
        senderId: user.id,
        createdAt: '2026-10-18T12:02:00Z',
      };
      messages.unshift(message);
      body = { message };
    } else if (path.endsWith('/messages/first')) {
      const ordered = [...messages].sort((a, b) => {
        const left = a as typeof first;
        const right = b as typeof first;
        return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
      });
      body = { message: ordered[0] ?? null };
    } else if (/\/messages\/[^/]+\/around$/.test(path)) {
      const id = decodeURIComponent(path.split('/').at(-2)!);
      const ordered = [...messages].sort((a, b) =>
        (a as typeof first).createdAt.localeCompare((b as typeof first).createdAt),
      );
      const index = ordered.findIndex((message) => (message as typeof first).id === id);
      const params = new URL(request.url()).searchParams;
      const before = Number(params.get('before') ?? 50);
      const after = Number(params.get('after') ?? 50);
      body = {
        message: ordered[index],
        before: ordered.slice(Math.max(0, index - before), index),
        after: ordered.slice(index + 1, index + 1 + after),
        hasMoreBefore: index > before,
        hasMoreAfter: ordered.length - index - 1 > after,
      };
    } else if (path.endsWith('/messages')) {
      const limit = Number(new URL(request.url()).searchParams.get('limit') ?? 50);
      const ordered = [...messages].sort((a, b) => {
        const left = a as typeof first;
        const right = b as typeof first;
        return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
      });
      body = { messages: ordered.slice(0, limit), nextCursor: null };
    } else if (path.endsWith('/profile')) body = { user: { ...user, ...request.postDataJSON() } };
    else if (path.endsWith('/sign-out')) return route.fulfill({ status: 204 });
    else if (path.endsWith('/invite')) body = { inviteLink: `/api/groups/join/${inviteToken}` };
    else if (path.startsWith('/api/groups/join/')) body = { conversation: chat };
    return route.fulfill({ json: body });
  });
}
async function signIn(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill('ada@example.com');
  await page.getByPlaceholder('Enter your password').fill('goodpassword');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Weekend plans' })).toBeVisible();
}

test('login requires a server URL and remembers the chosen server for HTTP and realtime', async ({
  page,
}) => {
  const server = 'http://localhost:4321';
  await mockApi(page, [first], server);
  await page.addInitScript(() => localStorage.removeItem('reducto.server.v1'));
  const realtime = await mockRealtime(page);
  await page.goto('/login');
  await expect(page.getByRole('textbox', { name: 'Server URL', exact: true })).toHaveValue('');
  await page.getByPlaceholder('you@example.com').fill('ada@example.com');
  await page.getByPlaceholder('Enter your password').fill('goodpassword');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByText(
      'Enter the server address, including http:// or https://, without /api or another path.',
    ),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Server URL', exact: true }).fill(` ${server}/ `);
  const signedIn = page.waitForRequest(`${server}/api/auth/sign-in`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await signedIn;
  await expect(page.getByRole('button', { name: 'Open Weekend plans' })).toBeVisible();
  await expect.poll(realtime.url).toContain('localhost:4321/socket.io/');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('reducto.session.v1')!).serverUrl),
  ).toBe(server);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open Weekend plans' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: 'Server URL', exact: true })).toHaveValue(server);
});

test('sessions without a known server ask for login instead of sending saved credentials', async ({
  page,
}) => {
  await mockApi(page, [first], null);
  let requests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests++;
  });
  await page.addInitScript(
    ({ user }) => {
      localStorage.setItem(
        'reducto.session.v1',
        JSON.stringify({ user, accessToken: 'old', refreshToken: 'old-refresh' }),
      );
    },
    { user },
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Server URL', exact: true })).toHaveValue('');
  expect(requests).toBe(0);
});

test('web sessions survive closing the tab and restore expired access tokens on restart', async ({
  page,
  context,
  browser,
}) => {
  await mockApi(page);
  await signIn(page);
  const key = 'reducto.session.v1';
  await expect.poll(() => page.evaluate((key) => !!localStorage.getItem(key), key)).toBe(true);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
  await page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key)!);
    stored.accessToken = 'expired';
    localStorage.setItem(key, JSON.stringify(stored));
  }, key);
  const saved = await context.storageState();
  await page.close();
  const restarted = await browser.newContext({ storageState: saved });
  try {
    const reopened = await restarted.newPage();
    await mockApi(reopened);
    await mockRealtime(reopened, 'renewed');
    let refreshes = 0;
    await reopened.route('**/api/auth/me', (route) =>
      route.fulfill(
        route.request().headers().authorization === 'Bearer renewed'
          ? { json: { user } }
          : { status: 401, json: { error: 'Access token expired' } },
      ),
    );
    await reopened.route('**/api/auth/refresh', (route) => {
      refreshes++;
      expect(route.request().postDataJSON()).toEqual({ refreshToken: 'refresh-token' });
      return route.fulfill({ json: { accessToken: 'renewed', refreshToken: 'rotated' } });
    });
    await reopened.goto('http://localhost:8081/');
    await expect(reopened.getByRole('button', { name: 'Open Weekend plans' })).toBeVisible();
    expect(refreshes).toBe(1);
    expect(
      await reopened.evaluate((key) => JSON.parse(localStorage.getItem(key)!).refreshToken, key),
    ).toBe('rotated');
    await reopened.getByRole('button', { name: 'Settings', exact: true }).click();
    await reopened.getByRole('button', { name: 'Sign out', exact: true }).click();
    await reopened.getByRole('button', { name: 'Sign out', exact: true }).last().click();
    await expect(reopened.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect(await reopened.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
    await reopened.reload();
    await expect(reopened.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  } finally {
    await restarted.close();
  }
});

test('existing tab sessions migrate to persistent storage and logout reaches other tabs', async ({
  page,
  context,
}) => {
  const key = 'reducto.session.v1';
  await page.addInitScript(
    ({ key, user }) => {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          user,
          serverUrl: 'http://localhost:3001',
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        }),
      );
    },
    { key, user },
  );
  await mockApi(page);
  await mockRealtime(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open Weekend plans' })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
  const second = await context.newPage();
  await mockApi(second);
  await mockRealtime(second);
  await second.goto('/');
  await expect(second.getByRole('button', { name: 'Open Weekend plans' })).toBeVisible();
  await second.evaluate((key) => localStorage.removeItem(key), key);
  await page.bringToFront();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

async function mockRealtime(page: Page, accessToken = 'access-token') {
  let socket: WebSocketRoute | undefined;
  let connections = 0;
  await page.routeWebSocket(/\/socket\.io\//, (route) => {
    socket = route;
    connections++;
    // Engine.IO open packet, then Socket.IO authenticated namespace handshake.
    route.send(
      `0${JSON.stringify({ sid: `engine-${connections}`, upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1000000 })}`,
    );
    route.onMessage((message) => {
      const packet = message.toString();
      if (packet.startsWith('40')) {
        expect(JSON.parse(packet.slice(2)).token).toBe(accessToken);
        route.send(`40${JSON.stringify({ sid: `socket-${connections}` })}`);
      }
    });
  });
  return {
    emit: (event: string, payload: unknown) => {
      if (!socket) throw new Error('Socket has not connected');
      socket.send(`42${JSON.stringify([event, payload])}`);
    },
    disconnect: () => socket!.close(),
    connections: () => connections,
    url: () => socket?.url(),
  };
}

test('sign in, send a message, edit profile, and sign out', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockApi(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByText('Hello from the group!', { exact: true }).last()).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('See you this weekend');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('See you this weekend', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  await page.screenshot({ path: testInfo.outputPath('chat.png'), fullPage: true });
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('Ada Byron');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Your profile has been updated.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
  await expect(page.getByText('Welcome to Reducto')).toBeVisible();
  expect(errors).toEqual([]);
});

test('sending keeps the composer focused and preserves edits made during the request', async ({
  page,
}) => {
  await mockApi(page);
  let finishSend!: () => Promise<void>;
  const sent: string[] = [];
  await page.route('**/api/conversations/*/messages', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    sent.push(body.text);
    if (sent.length > 1) return route.fallback();
    finishSend = () =>
      route.fulfill({
        json: {
          message: {
            ...first,
            id: 'keyboard-message',
            senderId: user.id,
            text: body.text,
            createdAt: '2026-10-18T12:02:00Z',
          },
        },
      });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('First message');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => sent).toEqual(['First message']);
  await expect(composer).toBeFocused();
  await expect(composer).toBeEditable();
  await composer.fill('Next message');
  await finishSend();
  await expect(page.getByTestId('message-keyboard-message')).toBeVisible();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('Next message');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => sent).toEqual(['First message', 'Next message']);
  await expect(composer).toHaveValue('');
  await expect(composer).toBeFocused();
});

test('authentication failures and sign-up fields are usable', async ({ page }, testInfo) => {
  await mockApi(page);
  await page.goto('/login');
  await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true });
  await page.getByPlaceholder('you@example.com').fill('ada@example.com');
  await page.getByPlaceholder('Enter your password').fill('wrongpassword');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Invalid credentials')).toBeVisible();
  await page.getByRole('tab', { name: 'Create account', exact: true }).click();
  await page.getByPlaceholder('How should we call you?').fill('Ada');
  await page
    .getByRole('textbox', { name: 'Username (optional)', exact: true })
    .fill('invalid name');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(
    page.getByText('Username must contain 1–32 letters, numbers, or underscores.'),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Username (optional)', exact: true }).fill(' @Ada_123 ');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByPlaceholder('At least 8 characters')).toHaveJSProperty('type', 'text');
  await page.getByPlaceholder('At least 8 characters').fill('goodpassword');
  const signup = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/auth/sign-up',
  );
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  expect((await signup).postDataJSON()).toEqual({
    email: 'ada@example.com',
    password: 'goodpassword',
    name: 'Ada',
    username: 'ada_123',
  });
  await expect(page.getByRole('button', { name: 'Open Weekend plans' })).toBeVisible();
});

test('start a chat by username, show lookup errors, and retain user ID fallback', async ({
  page,
}, testInfo) => {
  await mockApi(page);
  const recipients: object[] = [];
  await page.route('**:3001/api/conversations/private', async (route) => {
    const recipient = route.request().postDataJSON();
    recipients.push(recipient);
    if (recipient.username === 'missing')
      return route.fulfill({ status: 404, json: { error: 'User not found' } });
    return route.fulfill({ json: { conversation: chat } });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  const recipient = page.getByRole('textbox', { name: 'Recipient’s username', exact: true });
  await recipient.fill('invalid name');
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(
    page.getByText('Enter a username with 1–32 letters, numbers, or underscores.'),
  ).toBeVisible();
  expect(recipients).toEqual([]);
  await recipient.fill('@missing');
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(page.getByText('User not found', { exact: true })).toBeVisible();
  await recipient.fill(' @ALICE_123 ');
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  expect(recipients).toEqual([{ username: 'missing' }, { username: 'alice_123' }]);

  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Use user ID instead', exact: true }).click();
  await page.getByRole('textbox', { name: 'Recipient’s user ID', exact: true }).fill(user.id);
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  expect(recipients.at(-1)).toEqual({ userId: user.id });
});

test('sign-up allows leaving the optional username blank', async ({ page }) => {
  await mockApi(page);
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Create account', exact: true }).click();
  await page.getByPlaceholder('How should we call you?').fill('Ada');
  await page.getByPlaceholder('you@example.com').fill('ada@example.com');
  await page.getByPlaceholder('At least 8 characters').fill('goodpassword');
  const signup = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/auth/sign-up',
  );
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  expect((await signup).postDataJSON()).not.toHaveProperty('username');
  await expect(page.getByRole('button', { name: 'Open Weekend plans' })).toBeVisible();
});

test('reply composer sends reply IDs, renders a compact preview, and supports cancelling', async ({
  page,
}, testInfo) => {
  await mockApi(page);
  await mockRealtime(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(
    page.getByTestId('reply-composer').getByText('Grace Hopper', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('message-options')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Here is my reply');
  const sending = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/messages'),
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  expect((await sending).postDataJSON()).toEqual({
    text: 'Here is my reply',
    replyToMessageId: first.id,
  });
  await expect(page.getByTestId('reply-composer')).toHaveCount(0);
  const reply = page.getByRole('button', {
    name: `Jump to replied message ${first.id}`,
    exact: true,
  });
  await expect(reply.getByText('Hello from the group…', { exact: true })).toBeVisible();
  await expect(page.locator('button button')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('replies.png'), fullPage: true });
  await reply.click();
  await expect(page.getByTestId(`message-${first.id}`)).toHaveCSS(
    'background-color',
    'rgb(255, 240, 179)',
  );
  await page.getByRole('button', { name: 'Message actions', exact: true }).last().click();
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel reply', exact: true }).click();
  await expect(page.getByTestId('reply-composer')).toHaveCount(0);
});

test('failed replies preserve the draft and target until cancelled or sent', async ({ page }) => {
  await mockApi(page);
  await mockRealtime(page);
  let attempts = 0;
  await page.route('**/api/conversations/*/messages', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    attempts++;
    if (attempts === 1)
      return route.fulfill({ status: 400, json: { error: 'Reply target is unavailable' } });
    expect(route.request().postDataJSON()).toEqual({ text: 'Keep this draft' });
    return route.fulfill({
      json: { message: { ...first, id: 'retry', senderId: user.id, text: 'Keep this draft' } },
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.getByTestId('message-options')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this draft');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Reply target is unavailable', { exact: true })).toBeVisible();
  await expect(page.getByTestId('reply-composer')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Keep this draft',
  );
  await page.getByRole('button', { name: 'Cancel reply', exact: true }).click();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('message-retry')).toBeVisible();
});

test('reply previews load old targets once and jump through cached around windows', async ({
  page,
}) => {
  const target = {
    ...first,
    id: 'old-target',
    text: 'An earlier question about the weekend',
    createdAt: '2026-10-17T10:00:00Z',
  };
  const before = Array.from({ length: 50 }, (_, index) => ({
    ...first,
    id: `older-${index}`,
    text: `Older context ${index} ${'long line '.repeat(index % 5)}`,
    createdAt: new Date(Date.parse(target.createdAt) - (50 - index) * 60000).toISOString(),
  }));
  const after = Array.from({ length: 50 }, (_, index) => ({
    ...first,
    id: `newer-${index}`,
    text: `Newer context ${index}`,
    createdAt: new Date(Date.parse(target.createdAt) + (index + 1) * 60000).toISOString(),
  }));
  await mockApi(page, [
    { ...first, id: 'reply-1', text: 'First answer', replyToMessageId: target.id },
    { ...first, id: 'reply-2', text: 'Second answer', replyToMessageId: target.id },
  ]);
  await mockRealtime(page);
  let details = 0;
  let around = 0;
  await page.route(`**/messages/${target.id}`, (route) => {
    details++;
    return route.fulfill({ json: { message: target } });
  });
  await page.route('**/messages/*/around?*', (route) => {
    const url = new URL(route.request().url());
    if (![target.id, before[0].id, after.at(-1)!.id].includes(url.pathname.split('/').at(-2)!))
      return route.fallback();
    around++;
    if (url.searchParams.get('before') === '0')
      return route.fulfill({
        json: {
          message: after.at(-1),
          before: [],
          after: [
            {
              ...first,
              id: 'new-edge',
              text: 'More recent context',
              createdAt: '2026-10-17T12:00:00Z',
            },
          ],
          hasMoreBefore: true,
          hasMoreAfter: false,
        },
      });
    if (url.searchParams.get('after') === '0')
      return route.fulfill({
        json: {
          message: before[0],
          before: [
            {
              ...first,
              id: 'old-edge',
              text: 'Even older context',
              createdAt: '2026-10-17T08:00:00Z',
            },
          ],
          after: [],
          hasMoreBefore: false,
          hasMoreAfter: true,
        },
      });
    expect(url.searchParams.get('before')).toBe('50');
    expect(url.searchParams.get('after')).toBe('50');
    return route.fulfill({
      json: { message: target, before, after, hasMoreBefore: true, hasMoreAfter: true },
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const previews = page.getByRole('button', {
    name: `Jump to replied message ${target.id}`,
    exact: true,
  });
  await expect(previews.first().getByText('An earlier question …', { exact: true })).toBeVisible();
  expect(details).toBe(1);
  await previews.first().click();
  const original = page.getByTestId(`message-${target.id}`);
  await expect(original).toBeInViewport({ ratio: 0.7 });
  await expect(original).toHaveCSS('background-color', 'rgb(255, 240, 179)');
  await page.waitForTimeout(450);
  const list = page.getByTestId('chat-history');
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect.poll(() => around).toBe(2);
  await page.waitForTimeout(200);
  await list.dispatchEvent('wheel', { deltaY: 500, bubbles: true });
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => around).toBe(3);
  await expect(page.getByRole('button', { name: /Load (earlier|newer) messages/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to latest messages', exact: true }).click();
  await expect(previews.first()).toBeVisible();
  await previews.first().click();
  await expect(original).toBeInViewport({ ratio: 0.7 });
  expect(around).toBe(3);
  expect(details).toBe(1);
});

test('GIF reply previews show the attachment type and missing replies leave chat usable', async ({
  page,
}) => {
  const gif = {
    ...first,
    id: 'gif-original',
    text: null,
    attachment: { type: 'gif', gifId: 'gif-id' },
  };
  await mockApi(page, [
    gif,
    { ...first, id: 'gif-answer', text: 'Nice animation', replyToMessageId: gif.id },
    { ...first, id: 'missing-answer', text: 'What happened?', replyToMessageId: 'missing-target' },
  ]);
  await mockRealtime(page);
  await page.route(/\/messages\/missing-target(?:\/around)?(?:\?|$)/, (route) =>
    route.fulfill({ status: 404, json: { error: 'Message not found' } }),
  );
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(
    page
      .getByRole('button', { name: `Jump to replied message ${gif.id}` })
      .getByText('gif', { exact: true }),
  ).toBeVisible();
  const missing = page.getByRole('button', { name: 'Jump to replied message missing-target' });
  await expect(missing.getByText('Message unavailable', { exact: true })).toBeVisible();
  await missing.click();
  await expect(page.getByText('Message not found', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable();
});

test('reopening a cached conversation does not request its history again', async ({
  page,
}, testInfo) => {
  await mockApi(page);
  await mockRealtime(page);
  let pages = 0;
  await page.route(
    /\/api\/conversations\/[^/]+\/messages(?:\/first|\/[^/]+\/around)?(?:\?|$)/,
    (route) => {
      if (new URL(route.request().url()).searchParams.get('limit') === '1') return route.fallback();
      pages++;
      return route.fallback();
    },
  );
  await signIn(page);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByTestId(`message-${first.id}`)).toBeVisible();
  const initial = pages;
  for (let index = 0; index < 3; index++) {
    if (testInfo.project.name === 'mobile')
      await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    await expect(page.getByTestId(`message-${first.id}`)).toBeVisible();
  }
  expect(initial).toBe(2);
  expect(pages).toBe(initial);
});

test('conversation previews show the actual latest message independently of unread history windows', async ({
  page,
}, testInfo) => {
  const history = Array.from({ length: 201 }, (_, index) => ({
    ...first,
    id: `preview-history-${index}`,
    text: `Conversation message ${index}`,
    createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
  }));
  await mockApi(page, history);
  const realtime = await mockRealtime(page);
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({
      json: {
        conversations: [{ ...chat, lastSeenMessageId: history[20].id, unreadCount: 180 }],
      },
    }),
  );
  const limits: number[] = [];
  await page.route(/\/api\/conversations\/[^/]+\/messages\?/, (route) => {
    const limit = Number(new URL(route.request().url()).searchParams.get('limit'));
    limits.push(limit);
    return route.fallback();
  });
  await signIn(page);
  const preview = page.getByTestId(`preview-${chat.id}`);
  await expect(preview).toHaveText('Conversation message 200');
  expect(limits).toEqual([1]);
  await expect(page.getByTestId(`unread-${chat.id}`)).toHaveText('180');
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByTestId(`message-${history[20].id}`)).toBeInViewport();
  const live = {
    ...history[200],
    id: 'latest-voice',
    text: null,
    attachment: { type: 'voice', mediaId: 'latest-voice' },
    createdAt: '2026-10-18T13:00:00Z',
  };
  await realtime.emit('message.created', { message: live });
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await expect(preview).toHaveText('Voice message');
  await expect(page.getByText('Open conversation', { exact: true })).toHaveCount(0);
  // Refresh may return an older snapshot; it must not roll back the live preview.
  await page.getByRole('button', { name: 'Refresh conversations', exact: true }).click();
  await expect(preview).toHaveText('Voice message');
  expect(limits.every((limit) => limit === 1)).toBe(true);
});

test('API unread counts decrease as visible messages are read, persist seen positions, and sync another client without notifications', async ({
  page,
}, testInfo) => {
  await page.clock.install();
  const history = Array.from({ length: 11 }, (_, index) => ({
    ...first,
    id: `unread-${index}`,
    text: `Unread message ${index}\n${'Long message line\n'.repeat(12)}`,
    createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
  }));
  await mockApi(page, history);
  let serverState = { lastSeenMessageId: history[0].id, unreadCount: 10 };
  let listCalls = 0;
  const seen: string[] = [];
  let releaseSeen!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseSeen = resolve;
  });
  await page.route('**:3001/api/conversations', (route) => {
    listCalls++;
    return route.fulfill({ json: { conversations: [{ ...chat, ...serverState }] } });
  });
  await page.route('**/api/conversations/*/seen', async (route) => {
    expect(route.request().method()).toBe('PUT');
    expect(route.request().headers().authorization).toBe('Bearer access-token');
    const id = route.request().postDataJSON().messageId;
    seen.push(id);
    const index = history.findIndex((message) => message.id === id);
    await gate;
    if (index > history.findIndex((message) => message.id === serverState.lastSeenMessageId))
      serverState = { lastSeenMessageId: id, unreadCount: 10 - index };
    return route.fulfill({ json: serverState });
  });
  try {
    await signIn(page);
    const badge = page.getByTestId(`unread-${chat.id}`);
    await expect(badge).toHaveText('10');
    expect(seen).toEqual([]); // Fetching list/history is not seeing messages.
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    await expect(page.getByTestId(`message-${history[0].id}`)).toBeInViewport();
    await page.waitForTimeout(450);
    await page.getByTestId('chat-history').evaluate((element) => {
      element.scrollTop = Math.max(0, element.scrollTop - 300);
    });
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    const index = history.findIndex((message) => message.id === seen.at(-1));
    expect(index).toBeGreaterThan(0);
    expect(index).toBeLessThan(10); // Opening starts by the saved watermark.
    if (testInfo.project.name === 'mobile')
      await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
    await expect(badge).toHaveText(String(10 - index)); // Before PUT completes.
    releaseSeen();
    await expect.poll(() => serverState.unreadCount).toBe(10 - index);
    const before = listCalls;
    serverState = { lastSeenMessageId: history[9].id, unreadCount: 1 };
    await page.clock.fastForward(10000);
    await expect.poll(() => listCalls).toBeGreaterThan(before);
    await expect(badge).toHaveText('1');
  } finally {
    releaseSeen();
  }
});

test('sending marks the returned message seen before latest history loads', async ({
  page,
}, testInfo) => {
  const history = Array.from({ length: 101 }, (_, index) => ({
    ...first,
    id: `before-send-${index}`,
    text: `Earlier unread ${index}`,
    createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
  }));
  const sent = {
    ...first,
    id: 'sent-and-seen',
    senderId: user.id,
    text: 'My new message',
    createdAt: '2026-10-18T13:00:00Z',
  };
  await mockApi(page, history);
  let serverState = { lastSeenMessageId: history[0].id, unreadCount: 100 };
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({ json: { conversations: [{ ...chat, ...serverState }] } }),
  );
  await page.route('**/api/conversations/*/messages', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    expect(route.request().postDataJSON().text).toBe(sent.text);
    return route.fulfill({ json: { message: sent } });
  });
  let releaseTail: (() => Promise<void>) | undefined;
  await page.route(/\/api\/conversations\/[^/]+\/messages\?limit=50$/, (route) => {
    releaseTail = () =>
      route.fulfill({
        json: { messages: [sent, ...history.slice(-49).reverse()], nextCursor: history[52].id },
      });
  });
  let releaseSeen!: () => void;
  const seenGate = new Promise<void>((resolve) => {
    releaseSeen = resolve;
  });
  const seen: string[] = [];
  await page.route('**/api/conversations/*/seen', async (route) => {
    const id = route.request().postDataJSON().messageId;
    seen.push(id);
    if (id === sent.id) {
      expect(route.request().method()).toBe('PUT');
      expect(route.request().headers().authorization).toBe('Bearer access-token');
      serverState = { lastSeenMessageId: sent.id, unreadCount: 0 };
      await seenGate;
    }
    return route.fulfill({ json: serverState });
  });
  try {
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    await expect(page.getByTestId(`message-${history[0].id}`)).toBeInViewport();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill(sent.text);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => !!releaseTail).toBe(true);
    await expect.poll(() => seen).toContain(sent.id);
    // The sent message cannot be visible yet: the latest history is still pending.
    await expect(page.getByTestId(`message-${sent.id}`)).toHaveCount(0);
    if (testInfo.project.name === 'mobile')
      await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
    await expect(page.getByTestId(`unread-${chat.id}`)).toHaveCount(0);
    expect(serverState.lastSeenMessageId).toBe(sent.id);
  } finally {
    releaseSeen();
    await releaseTail?.();
  }
});

test('unread opening resolves an older seen position through the around API without clearing the whole badge', async ({
  page,
}, testInfo) => {
  const history = Array.from({ length: 31 }, (_, index) => ({
    ...first,
    id: `old-seen-${index}`,
    text: `Message ${index}\n${'Text line\n'.repeat(12)}`,
    createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
  }));
  await mockApi(page, history.slice(26));
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({
      json: { conversations: [{ ...chat, lastSeenMessageId: history[0].id, unreadCount: 30 }] },
    }),
  );
  let aroundCalls = 0;
  let seenIndex = 0;
  await page.route(`**/api/conversations/*/messages/${history[0].id}/around*`, (route) => {
    aroundCalls++;
    return route.fulfill({
      json: {
        message: history[0],
        before: [],
        after: history.slice(1, 9),
        hasMoreBefore: false,
        hasMoreAfter: true,
      },
    });
  });
  await page.route('**/api/conversations/*/seen', (route) => {
    seenIndex = history.findIndex(
      (message) => message.id === route.request().postDataJSON().messageId,
    );
    return route.fulfill({
      json: { lastSeenMessageId: history[seenIndex].id, unreadCount: 30 - seenIndex },
    });
  });
  await signIn(page);
  await expect(page.getByTestId(`unread-${chat.id}`)).toHaveText('30');
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByTestId(`message-${history[0].id}`)).toBeInViewport();
  await page.waitForTimeout(450);
  await page.getByTestId('chat-history').evaluate((element) => {
    element.scrollTop = Math.max(0, element.scrollTop - 300);
  });
  await expect.poll(() => seenIndex).toBeGreaterThan(0);
  expect(seenIndex).toBeLessThan(9);
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await expect(page.getByTestId(`unread-${chat.id}`)).toHaveText(String(30 - seenIndex));
  expect(aroundCalls).toBe(1);
});

test('history opens around last seen without startup tail requests and scrolling loads both edges automatically', async ({
  page,
}) => {
  const history = Array.from({ length: 401 }, (_, index) => ({
    ...first,
    id: `batch-${index}`,
    text: `History message ${index}\nSecond line`,
    createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
  }));
  await mockApi(page, []);
  let latestRequests = 0;
  const batches: { id: string; before: number; after: number }[] = [];
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({
      json: {
        conversations: [
          { ...chat, lastSeenMessageId: 'batch-100', unreadCount: 300 },
          {
            ...chat,
            id: 'unopened-chat',
            name: 'Unopened chat',
            lastSeenMessageId: 'other-seen',
            unreadCount: 50,
          },
        ],
      },
    }),
  );
  await page.route(/\/api\/conversations\/[^/]+\/messages\?/, (route) => {
    if (new URL(route.request().url()).searchParams.get('limit') === '1') return route.fallback();
    latestRequests++;
    return route.fulfill({
      status: 500,
      json: { error: 'No latest-page startup requests expected' },
    });
  });
  await page.route('**/api/conversations/*/messages/*/around?*', (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').at(-2)!;
    const index = history.findIndex((message) => message.id === id);
    const before = Number(url.searchParams.get('before'));
    const after = Number(url.searchParams.get('after'));
    batches.push({ id, before, after });
    return route.fulfill({
      json: {
        message: history[index],
        before: history.slice(Math.max(0, index - before), index),
        after: history.slice(index + 1, index + after + 1),
        hasMoreBefore: index > before,
        hasMoreAfter: history.length - index - 1 > after,
      },
    });
  });
  await signIn(page);
  expect(batches).toEqual([]);
  expect(latestRequests).toBe(0);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByTestId('message-batch-100')).toBeInViewport();
  expect(batches[0]).toEqual({ id: 'batch-100', before: 50, after: 50 });
  const list = page.getByTestId('chat-history');
  await page.waitForTimeout(500);
  for (const edge of [150, 200, 250, 300, 350]) {
    await list.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect
      .poll(() =>
        batches.some(
          (batch) => batch.id === `batch-${edge}` && batch.before === 0 && batch.after === 50,
        ),
      )
      .toBe(true);
    await page.waitForTimeout(200);
  }
  // Returning to the older edge loads another batch without a button.
  await list.dispatchEvent('wheel', { deltaY: 500, bubbles: true });
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() =>
      batches.some((batch) => batch.id === 'batch-50' && batch.before === 50 && batch.after === 0),
    )
    .toBe(true);
  expect(latestRequests).toBe(0);
  await expect(page.getByRole('button', { name: /Load (earlier|newer) messages/ })).toHaveCount(0);
});

test('a chat without a last-seen message opens at its first message and pages forward', async ({
  page,
}) => {
  const history = Array.from({ length: 201 }, (_, index) => ({
    ...first,
    id: `unseen-${index}`,
    text: `Unread from the beginning ${index}\nSecond line`,
    createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
  }));
  await mockApi(page, history);
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({
      json: {
        conversations: [{ ...chat, lastSeenMessageId: null, unreadCount: history.length }],
      },
    }),
  );
  let firstCalls = 0;
  let latestCalls = 0;
  const batches: { id: string; before: number; after: number }[] = [];
  await page.route('**/api/conversations/*/messages/first', (route) => {
    firstCalls++;
    return route.fulfill({ json: { message: history[0] } });
  });
  await page.route(/\/api\/conversations\/[^/]+\/messages\?/, (route) => {
    if (new URL(route.request().url()).searchParams.get('limit') === '1') return route.fallback();
    latestCalls++;
    return route.fulfill({
      status: 500,
      json: { error: 'Unseen history must start at the beginning' },
    });
  });
  await page.route('**/api/conversations/*/messages/*/around?*', (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').at(-2)!;
    batches.push({
      id,
      before: Number(url.searchParams.get('before')),
      after: Number(url.searchParams.get('after')),
    });
    return route.fallback();
  });
  await signIn(page);
  expect(firstCalls).toBe(0);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByTestId('message-unseen-0')).toBeInViewport();
  expect(batches[0]).toEqual({ id: 'unseen-0', before: 50, after: 50 });
  const list = page.getByTestId('chat-history');
  for (const edge of [50, 100, 150]) {
    await list.dispatchEvent('wheel', { deltaY: 500, bubbles: true });
    await list.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect
      .poll(() =>
        batches.some(
          (batch) => batch.id === `unseen-${edge}` && batch.before === 0 && batch.after === 50,
        ),
      )
      .toBe(true);
    await page.waitForTimeout(200);
  }
  if (await page.getByRole('button', { name: 'Back to chats', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  expect(firstCalls).toBe(1);
  expect(latestCalls).toBe(0);
});

for (const anchored of [true, false]) {
  test(`scrolling immediately to older history loads consecutive batches (${anchored ? 'last seen' : 'last seen at tail'})`, async ({
    page,
  }) => {
    const history = Array.from({ length: 301 }, (_, index) => ({
      ...first,
      id: `older-${index}`,
      text: `Older message ${index}\nSecond line`,
      createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
    }));
    await mockApi(page, history);
    await page.route('**:3001/api/conversations', (route) =>
      route.fulfill({
        json: {
          conversations: [
            {
              ...chat,
              lastSeenMessageId: anchored ? 'older-250' : 'older-300',
              unreadCount: anchored ? 50 : 0,
            },
          ],
        },
      }),
    );
    await page.route(/\/api\/conversations\/[^/]+\/messages\?/, (route) =>
      route.fulfill({
        json: {
          messages: history.slice(-50).reverse(),
          nextCursor: 'older-251',
        },
      }),
    );
    const batches: string[] = [];
    await page.route('**/api/conversations/*/messages/*/around?*', (route) => {
      const url = new URL(route.request().url());
      const id = url.pathname.split('/').at(-2)!;
      const index = history.findIndex((message) => message.id === id);
      const before = Number(url.searchParams.get('before'));
      const after = Number(url.searchParams.get('after'));
      if (!after) batches.push(id);
      return route.fulfill({
        json: {
          message: history[index],
          before: history.slice(Math.max(0, index - before), index),
          after: history.slice(index + 1, index + after + 1),
          hasMoreBefore: index > before,
          hasMoreAfter: history.length - index - 1 > after,
        },
      });
    });
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    await expect(page.getByTestId(`message-older-${anchored ? 250 : 300}`)).toBeInViewport();
    const list = page.getByTestId('chat-history');
    for (const edge of anchored ? [200, 150, 100, 50] : [250, 200, 150, 100, 50]) {
      await list.dispatchEvent('wheel', { deltaY: -500, bubbles: true });
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect.poll(() => batches).toContain(`older-${edge}`);
      await page.waitForTimeout(200);
    }
  });
}

test('chat scrollbar overlays history without a gutter and supports dragging', async ({ page }) => {
  await mockApi(
    page,
    Array.from({ length: 60 }, (_, index) => ({
      ...first,
      id: `scroll-message-${index}`,
      text: `Message ${index}`,
      createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
    })),
  );
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const history = page.getByTestId('chat-history');
  const thumb = page.getByRole('scrollbar', { name: 'Chat scrollbar' });
  await expect(thumb).toBeVisible();
  await expect
    .poll(() =>
      history.evaluate((element: HTMLElement) => element.offsetWidth - element.clientWidth),
    )
    .toBe(0);
  const before = await history.evaluate((element) => element.scrollTop);
  const bounds = (await thumb.boundingBox())!;
  const historyBounds = (await history.boundingBox())!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(historyBounds.x + historyBounds.width);
  expect(bounds.width).toBe(6);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  for (const distance of [20, 40, 60, 80, 100]) {
    await page.mouse.move(bounds.x - 40, bounds.y + bounds.height / 2 - distance);
    await expect
      .poll(async () => {
        const current = (await thumb.boundingBox())!;
        return Math.abs(current.y - (bounds.y - distance));
      })
      .toBeLessThan(1.5);
    expect((await thumb.boundingBox())!.height).toBeCloseTo(bounds.height, 1);
  }
  await page.mouse.up();
  await expect
    .poll(() => history.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(before + 10);
  await thumb.press('End');
  await expect.poll(() => history.evaluate((element) => element.scrollTop)).toBe(0);
});

test('chat scrollbar remains visible but disabled during voice seeking', async ({ page }) => {
  const messages = Array.from({ length: 40 }, (_, index) => ({
    ...first,
    id: `older-scroll-${index}`,
    text: `Older message ${index}`,
    createdAt: new Date(Date.parse(first.createdAt) - (index + 1) * 1000).toISOString(),
  }));
  await mockApi(page, [
    ...messages,
    { ...first, text: null, attachment: { type: 'voice', mediaId: 'scroll-voice' } },
  ]);
  await page.route('**/api/conversations/*/attachments/scroll-voice', (route) =>
    route.fulfill({
      path: path.join(__dirname, '../fixtures/voice.ogg'),
      contentType: 'audio/ogg',
    }),
  );
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const thumb = page.getByRole('scrollbar', { name: 'Chat scrollbar' });
  const progress = page.getByRole('slider', { name: 'Voice message progress' });
  await expect(thumb).toBeVisible();
  await expect(progress).toBeVisible();
  const bounds = (await progress.boundingBox())!;
  const history = page.getByTestId('chat-history');
  const before = await history.evaluate((element) => element.scrollTop);
  await page.mouse.move(bounds.x + 20, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y - 70);
  await expect(thumb).toBeVisible();
  await expect(thumb).toHaveAttribute('aria-disabled', 'true');
  await expect(thumb).toHaveCSS('opacity', '0.5');
  await thumb.dispatchEvent('keydown', { key: 'ArrowUp', bubbles: true });
  expect(await history.evaluate((element) => element.scrollTop)).toBe(before);
  await page.mouse.up();
  await expect(thumb).toBeVisible();
  await expect(thumb).toHaveAttribute('aria-disabled', 'false');
  await expect(thumb).toHaveCSS('opacity', '1');
});

for (const kind of ['gif', 'voice', 'image', 'video'] as const) {
  test(`cached ${kind} media and metadata survive repeated chat remounts`, async ({
    page,
  }, testInfo) => {
    const mediaId = 'remount-media';
    let details = 0;
    let downloads = 0;
    await mockApi(page, [
      {
        ...first,
        text: null,
        attachment: kind === 'gif' ? { type: 'gif', gifId: mediaId } : { type: kind, mediaId },
      },
    ]);
    const mediaUrl =
      kind === 'gif'
        ? 'https://media.example/remount.mp4'
        : `**/api/conversations/*/attachments/${mediaId}`;
    await page.route(mediaUrl, (route) => {
      downloads++;
      return route.fulfill({
        path: path.join(
          __dirname,
          `../fixtures/${
            kind === 'image' ? 'portrait.png' : kind === 'voice' ? 'voice.ogg' : 'loop.mp4'
          }`,
        ),
        contentType: kind === 'image' ? 'image/png' : kind === 'voice' ? 'audio/ogg' : 'video/mp4',
      });
    });
    await page.route(
      kind === 'gif'
        ? `**/api/gifs/${mediaId}`
        : `**/api/conversations/*/attachments/${mediaId}/metadata`,
      (route) => {
        details++;
        const metadata = {
          id: mediaId,
          type: kind,
          width: 120,
          height: 200,
          contentType: kind === 'image' ? 'image/png' : 'video/mp4',
          fileSize: 9000,
          thumbnailUrl: null,
          playbackUrl: mediaUrl,
        };
        return route.fulfill({
          json: kind === 'gif' ? { gif: metadata } : { attachment: metadata },
        });
      },
    );
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    if (kind === 'video')
      await page.getByRole('button', { name: 'Download video', exact: true }).click();
    const ready = async () => {
      if (kind === 'gif') await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
      else if (kind === 'voice') await expect(page.getByTestId('voice-player')).toBeVisible();
      else if (kind === 'video')
        await expect(page.getByRole('button', { name: 'Save video', exact: true })).toBeVisible();
      else
        await expect(
          page.getByLabel('Image preview', { exact: true }).locator('img'),
        ).toHaveAttribute('src', /^blob:/);
    };
    await ready();
    for (let index = 0; index < 3; index++) {
      if (testInfo.project.name === 'mobile')
        await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
      await page.getByRole('button', { name: 'Open Weekend plans' }).click();
      await ready();
      await expect(page.getByRole('progressbar')).toHaveCount(0);
    }
    expect(downloads).toBe(1);
    expect(details).toBe(kind === 'voice' ? 0 : 1);
  });
}

for (const gif of [false, true]) {
  test(`${gif ? 'GIF' : 'text'} message options dismiss as one complete menu`, async ({ page }) => {
    await mockApi(page, [
      {
        ...first,
        text: gif ? null : 'Copy this message',
        attachment: gif ? { type: 'gif', gifId: 'test-gif' } : null,
      },
    ]);
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    const open = () =>
      gif
        ? page.getByRole('button', { name: 'Open gif attachment' }).click()
        : page.getByRole('button', { name: 'Message actions', exact: true }).click();
    const label = gif ? 'Save GIF' : 'Copy';
    await open();
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    const partialFrames = await page.evaluate(async (label) => {
      let partial = 0;
      const start = performance.now();
      const check = () => {
        const title = !!document.querySelector('[data-testid="message-options"]');
        const action = Array.from(document.querySelectorAll('button, [role="button"]')).some(
          (element) => element.getAttribute('aria-label') === label,
        );
        if (title !== action) partial++;
      };
      const observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      document.querySelector<HTMLElement>('[aria-label="Close message options"]')!.click();
      await new Promise<void>((resolve) => {
        const frame = () => {
          check();
          if (performance.now() - start > 500) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      observer.disconnect();
      return partial;
    }, label);
    expect(partialFrames).toBe(0);
    await expect(page.getByTestId('message-options')).toHaveCount(0);
    await open();
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  });
}

test('attachment downloads and message actions use separate buttons', async ({ page }) => {
  const nestingErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /nested|descendant|contain|hydration/i.test(message.text()))
      nestingErrors.push(message.text());
  });
  await mockApi(page, [
    { ...first, text: 'Read the notes', attachment: { type: 'document', mediaId: 'notes-file' } },
  ]);
  await page.route('**:3001/api/conversations/*/attachments/notes-file', (route) =>
    route.fulfill({
      body: 'Meeting notes',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="notes.txt"',
        'Access-Control-Expose-Headers': 'Content-Disposition',
      },
    }),
  );
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByRole('button', { name: 'Open document attachment' })).toBeVisible();
  await expect(page.locator('button button')).toHaveCount(0);
  expect(nestingErrors).toEqual([]);

  await page.getByRole('button', { name: 'Open document attachment' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save attachment', exact: true }).click();
  expect((await downloading).suggestedFilename()).toBe('notes.txt');
  await expect(page.getByTestId('message-options')).toHaveCount(0);
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await expect(page.getByTestId('message-options')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Forward', exact: true })).toBeVisible();
  const reaction = page.waitForRequest((request) => request.url().endsWith('/reactions'));
  await page.getByRole('button', { name: 'React 👍', exact: true }).click();
  const request = await reaction;
  expect(request.method()).toBe('PUT');
  expect(request.postDataJSON()).toEqual({ emoji: '👍' });
  await expect(page.getByTestId('message-options')).toHaveCount(0);
  expect(nestingErrors).toEqual([]);
});

test('private chats and group members display fetched names, usernames and signed avatars', async ({
  page,
}, testInfo) => {
  await mockApi(page);
  const privateChat = {
    ...chat,
    id: '55555555-5555-4555-8555-555555555555',
    type: 'private',
    name: null,
  };
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({ json: { conversations: [chat, privateChat] } }),
  );
  await signIn(page);
  const row = page.getByRole('button', { name: 'Open Grace Hopper', exact: true });
  await expect(row).toBeVisible();
  await expect(row.getByText('@grace', { exact: true })).toBeVisible();
  await expect(row.getByRole('img', { name: 'Grace Hopper profile photo' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search conversations' }).fill('@GRACE');
  await expect(row).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Weekend plans' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search conversations' }).fill('');
  await row.click();
  const header = page.getByRole('button', { name: 'View conversation details' });
  await expect(header.getByText('Grace Hopper', { exact: true })).toBeVisible();
  await expect(header.getByText('@grace', { exact: true })).toBeVisible();
  await expect(header.getByRole('img', { name: 'Grace Hopper profile photo' })).toBeVisible();
  await header.click();
  await expect(page.getByText('MEMBERS', { exact: true })).toBeVisible();
  await expect(page.getByText('Grace Hopper', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('@grace', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats' }).click();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByText('Grace Hopper', { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Grace Hopper profile photo' }).last()).toBeVisible();
  await expect(page.getByText('User friend')).toHaveCount(0);
});

test('missing profiles and avatars keep conversations usable', async ({ page }) => {
  await mockApi(page);
  const privateChat = { ...chat, type: 'private', name: null };
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({ json: { conversations: [privateChat] } }),
  );
  await page.route('**:3001/api/users/friend', (route) =>
    route.fulfill({ status: 404, json: { error: 'User not found' } }),
  );
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill('ada@example.com');
  await page.getByPlaceholder('Enter your password').fill('goodpassword');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Open Private chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await expect(page.getByText('Hello from the group!', { exact: true }).last()).toBeVisible();
});

test('unavailable avatar images fall back to the profile initials', async ({ page }) => {
  await mockApi(page);
  await page.route('https://avatars.example/**', (route) => route.fulfill({ status: 404 }));
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({
      json: { conversations: [chat, { ...chat, id: 'private', type: 'private', name: null }] },
    }),
  );
  await signIn(page);
  const row = page.getByRole('button', { name: 'Open Grace Hopper', exact: true });
  await expect(row.getByText('GH', { exact: true })).toBeVisible();
  await expect(row.getByRole('img')).toHaveCount(0);
  await expect(row.getByText('@grace', { exact: true })).toBeVisible();
});

test('chat URLs are blue links and Reducto invites join internally with authorization', async ({
  page,
}) => {
  await mockApi(page, [
    {
      ...first,
      text: `Read https://example.org/docs. Visit www.example.com, join ${inviteUri}! Unsupported: reducto:///unknown`,
    },
  ]);
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const external = page.getByRole('link', { name: 'https://example.org/docs', exact: true });
  await expect(external).toHaveAttribute('href', 'https://example.org/docs');
  await expect(external).toHaveAttribute('target', '_blank');
  await expect(external).toHaveCSS('color', 'rgb(51, 144, 236)');
  await expect(page.getByRole('link', { name: 'www.example.com', exact: true })).toHaveAttribute(
    'href',
    'https://www.example.com',
  );
  await expect(page.locator('button a, button button')).toHaveCount(0);
  await page.route('https://example.org/docs', (route) =>
    route.fulfill({ body: 'External documentation' }),
  );
  const opening = page.waitForEvent('popup');
  await external.click();
  const popup = await opening;
  await expect(popup).toHaveURL('https://example.org/docs');
  await popup.close();
  await expect(page.getByTestId('message-options')).toHaveCount(0);

  await page.getByRole('link', { name: 'reducto:///unknown', exact: true }).click();
  await expect(page.getByText('Unsupported Reducto link', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const joining = page.waitForRequest(
    (request) => new URL(request.url()).pathname === `/api/groups/join/${inviteToken}`,
  );
  await page.getByRole('link', { name: inviteUri, exact: true }).click();
  const request = await joining;
  expect(request.method()).toBe('POST');
  expect(request.headers().authorization).toBe('Bearer access-token');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/chat/${chat.id}$`));
});

test('a group invite survives sign-in and displays join errors with retry', async ({ page }) => {
  await mockApi(page);
  let joins = 0;
  await page.route(`**:3001/api/groups/join/${inviteToken}`, (route) => {
    expect(route.request().headers().authorization).toBe('Bearer access-token');
    joins++;
    return joins === 1
      ? route.fulfill({ status: 404, json: { error: 'Invalid group invite' } })
      : route.fulfill({ json: { conversation: chat } });
  });
  await page.goto(`/api/groups/join/${inviteToken}`);
  await expect(page.getByText('Welcome to Reducto')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/login\\?invite=${inviteToken}$`));
  expect(joins).toBe(0);
  await page.getByPlaceholder('you@example.com').fill('ada@example.com');
  await page.getByPlaceholder('Enter your password').fill('goodpassword');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Invalid group invite', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  expect(joins).toBe(2);
});

test('copied group invitations use the Reducto URI', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copiedInvite: string }).copiedInvite = text;
        },
      },
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await page.getByRole('button', { name: 'Conversation details', exact: true }).click();
  await page.getByRole('button', { name: 'Copy invite link', exact: true }).click();
  await expect(page.getByText('Invite link copied. Share it with your friends.')).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { copiedInvite: string }).copiedInvite),
  ).toBe(inviteUri);
});

test('profile notifications update names, usernames and avatars everywhere without reloading', async ({
  page,
}, testInfo) => {
  await mockApi(page, [
    {
      ...first,
      forwardedFrom: { senderId: friend.id, messageId: first.id, conversationId: chat.id },
    },
  ]);
  const realtime = await mockRealtime(page);
  let current: { id: string; name: string; username: string | null; avatarUrl: string | null } = {
    ...friend,
  };
  let profileReads = 0;
  await page.route('**:3001/api/users/friend', (route) => {
    profileReads++;
    expect(route.request().headers().authorization).toBe('Bearer access-token');
    return route.fulfill({ json: { user: current } });
  });
  const privateChat = {
    ...chat,
    id: '55555555-5555-4555-8555-555555555555',
    type: 'private',
    name: null,
  };
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({ json: { conversations: [chat, privateChat] } }),
  );
  await signIn(page);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Grace Hopper', exact: true }).click();
  const header = page.getByRole('button', { name: 'View conversation details' });
  await expect(header.getByText('Grace Hopper', { exact: true })).toBeVisible();
  const readsBefore = profileReads;
  current = {
    ...current,
    name: 'Grace Murray Hopper',
    username: 'amazing_grace',
    avatarUrl: 'https://avatars.example/new-grace.png',
  };
  realtime.emit('user.profile_updated', {
    userId: friend.id,
    changedFields: ['name', 'username', 'avatar'],
  });
  await expect(header.getByText('Grace Murray Hopper', { exact: true })).toBeVisible();
  await expect(header.getByText('@amazing_grace', { exact: true })).toBeVisible();
  await expect(header.getByRole('img')).toHaveAttribute('src', current.avatarUrl!);
  expect(profileReads).toBeGreaterThan(readsBefore);
  if (testInfo.project.name === 'desktop')
    await expect(
      page.getByRole('button', { name: 'Open Grace Murray Hopper', exact: true }),
    ).toBeVisible();

  await header.click();
  current = { ...current, username: null, avatarUrl: null };
  realtime.emit('user.profile_updated', {
    userId: friend.id,
    changedFields: ['username', 'avatar'],
  });
  await expect(page.getByText('@amazing_grace', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Grace Murray Hopper profile photo' })).toHaveCount(0);
  await expect(page.getByText('Grace Murray Hopper', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats' }).click();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  current = {
    ...current,
    name: 'Grace Live',
    username: 'live_grace',
    avatarUrl: 'https://avatars.example/live-grace.png',
  };
  realtime.emit('user.profile_updated', {
    userId: friend.id,
    changedFields: ['name', 'username', 'avatar'],
  });
  await expect(page.getByText('Grace Live', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Forwarded from Grace Live', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Grace Live profile photo' }).last()).toHaveAttribute(
    'src',
    current.avatarUrl!,
  );
  await page.getByRole('button', { name: 'Conversation details', exact: true }).click();
  await expect(page.getByText('@live_grace', { exact: true }).last()).toBeVisible();
});

test('reconnecting refreshes profile changes missed while offline', async ({ page }) => {
  await mockApi(page);
  const realtime = await mockRealtime(page);
  let current = { ...friend };
  await page.route('**:3001/api/users/friend', (route) =>
    route.fulfill({ json: { user: current } }),
  );
  await signIn(page);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByText('Grace Hopper', { exact: true }).last()).toBeVisible();
  current = {
    ...current,
    name: 'Updated while offline',
    username: 'back_online',
    avatarUrl: 'https://avatars.example/reconnected.png',
  };
  await realtime.disconnect();
  await expect.poll(realtime.connections).toBeGreaterThan(1);
  await expect(page.getByText('Updated while offline', { exact: true }).last()).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Updated while offline profile photo' }).last(),
  ).toHaveAttribute('src', current.avatarUrl);
});

test('message menus anchor to row whitespace, fit the screen, and close with Escape', async ({
  page,
}, testInfo) => {
  const nestingErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /nested|descendant|contain|hydration/i.test(message.text()))
      nestingErrors.push(message.text());
  });
  await mockApi(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const row = page.getByTestId(`message-row-${first.id}`);
  const bubble = page.getByTestId(`message-${first.id}`);
  await expect(row).toBeVisible();
  const rowBox = (await row.boundingBox())!;
  const bubbleBox = (await bubble.boundingBox())!;
  const click = { x: rowBox.width - 4, y: rowBox.height / 2 };
  expect(rowBox.x + click.x).toBeGreaterThan(bubbleBox.x + bubbleBox.width);
  await row.click({ position: click });
  const menu = page.getByTestId('message-options');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Save attachment' })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: /React / })).toHaveCount(8);
  await expect(menu).toHaveCSS('opacity', '1');
  await expect(menu).toHaveCSS('width', '220px');
  const box = (await menu.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.y).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7);
  await page.screenshot({ path: testInfo.outputPath('message-menu.png') });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  if (testInfo.project.name === 'desktop') {
    await row.click({ button: 'right', position: { x: 90, y: click.y } });
    await expect(menu).toBeVisible();
    const rightClickBox = (await menu.boundingBox())!;
    expect(Math.abs(rightClickBox.x - rowBox.x - 90)).toBeLessThan(2);
    await page
      .getByRole('button', { name: 'Close message options' })
      .click({ position: { x: 2, y: 2 } });
    await expect(menu).toHaveCount(0);
  }
  expect(nestingErrors).toEqual([]);
});

test('message menu scales and fades on opening, closing, and reopening', async ({ page }) => {
  await mockApi(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  for (let attempt = 0; attempt < 2; attempt++) {
    const opening = await page.evaluate(async () => {
      document.querySelector<HTMLElement>('[aria-label="Message actions"]')!.click();
      const frames: { opacity: number; scale: number }[] = [];
      const start = performance.now();
      while (performance.now() - start < 700) {
        await new Promise(requestAnimationFrame);
        const element = document.querySelector<HTMLElement>('[data-testid="message-options"]');
        if (!element) continue;
        const style = getComputedStyle(element);
        frames.push({ opacity: Number(style.opacity), scale: new DOMMatrix(style.transform).a });
        if (Number(style.opacity) === 1) break;
      }
      return frames;
    });
    expect(opening.some((frame) => frame.opacity > 0 && frame.opacity < 1)).toBeTruthy();
    expect(opening.at(-1)).toEqual({ opacity: 1, scale: 1 });
    expect(opening.every((frame) => Math.abs(frame.opacity - frame.scale) < 0.01)).toBeTruthy();
    const closing = await page.evaluate(async () => {
      document.querySelector<HTMLElement>('[aria-label="Close message options"]')!.click();
      const frames: { opacity: number; scale: number; buttons: number }[] = [];
      const start = performance.now();
      while (performance.now() - start < 700) {
        await new Promise(requestAnimationFrame);
        const element = document.querySelector<HTMLElement>('[data-testid="message-options"]');
        if (!element) break;
        const style = getComputedStyle(element);
        frames.push({
          opacity: Number(style.opacity),
          scale: new DOMMatrix(style.transform).a,
          buttons: element.querySelectorAll('[role="button"],button').length,
        });
      }
      return frames;
    });
    expect(closing.some((frame) => frame.opacity > 0 && frame.opacity < 1)).toBeTruthy();
    expect(closing.every((frame) => Math.abs(frame.opacity - frame.scale) < 0.01)).toBeTruthy();
    expect(new Set(closing.map((frame) => frame.buttons)).size).toBe(1);
    await expect(page.getByTestId('message-options')).toHaveCount(0);
  }
});

test('video cards use server thumbnails without downloading and open the full-page player on demand', async ({
  page,
}, testInfo) => {
  let downloads = 0;
  const mediaId = 'test-video';
  await mockApi(page, [{ ...first, text: null, attachment: { type: 'video', mediaId } }]);
  await page.route(`**/api/conversations/*/attachments/${mediaId}`, (route) => {
    downloads++;
    expect(route.request().headers().authorization).toBe('Bearer access-token');
    return route.fulfill({
      path: path.join(__dirname, '../fixtures/portrait.mp4'),
      contentType: 'application/octet-stream',
    });
  });
  await page.route(`**/api/conversations/*/attachments/${mediaId}/metadata`, (route) =>
    route.fulfill({
      json: {
        attachment: {
          id: mediaId,
          type: 'video',
          width: 360,
          height: 640,
          fileSize: 9000,
          thumbnailUrl: 'https://media.example/video-thumbnail.jpg',
        },
      },
    }),
  );
  await page.route('https://media.example/video-thumbnail.jpg', (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({
      path: path.join(__dirname, '../fixtures/portrait.png'),
      contentType: 'image/jpeg',
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const card = page.getByTestId(`video-card-${mediaId}`);
  await expect(card.getByRole('img', { name: 'Video thumbnail' })).toBeVisible();
  await expect(card.locator('video')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Download video', exact: true })).toBeVisible();
  expect(downloads).toBe(0);
  await expect(card.getByRole('button', { name: 'Video message options' })).toBeVisible();
  await expect(page.locator('button button')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('video-card.png') });
  await card.getByRole('button', { name: 'Play video', exact: true }).click();
  const viewer = page.getByTestId('video-viewer');
  await expect(viewer).toBeVisible();
  const player = viewer.locator('video');
  await expect
    .poll(() =>
      player.evaluate((video: HTMLVideoElement) => ({
        playing: !video.paused,
        controls: video.controls,
        decoded: video.videoWidth > 0,
      })),
    )
    .toEqual({ playing: true, controls: true, decoded: true });
  const bounds = (await viewer.boundingBox())!;
  expect(bounds.width).toBe(page.viewportSize()!.width);
  expect(bounds.height).toBe(page.viewportSize()!.height);
  await player.evaluate((video: HTMLVideoElement) => {
    video.pause();
    video.currentTime = 0.1;
  });
  await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.paused)).toBeTruthy();
  await expect
    .poll(() =>
      viewer.evaluate((element) => {
        let opacity = 1;
        for (let current: Element | null = element; current; current = current.parentElement)
          opacity *= Number(getComputedStyle(current).opacity);
        return opacity;
      }),
    )
    .toBe(1);
  await page.screenshot({ path: testInfo.outputPath('video-player.png') });
  await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
  await expect(viewer).toHaveCount(0);
  await card.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(viewer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  expect(downloads).toBe(1);
  const saved = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Save video', exact: true }).click();
  expect((await saved).suggestedFilename()).toBe('video.mp4');
  expect(downloads).toBe(1);
});

test('video downloads display real streamed progress, refresh authentication, cancel and retry', async ({
  page,
}, testInfo) => {
  const bytes = readFileSync(path.join(__dirname, '../fixtures/portrait.mp4'));
  let requests = 0;
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    if (!request.url?.includes('/attachments/slow-video')) {
      response.writeHead(404).end();
      return;
    }
    requests++;
    if (requests === 1) {
      response.writeHead(401).end();
      return;
    }
    if (request.headers.authorization !== 'Bearer renewed-token') {
      response.writeHead(403).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': bytes.length,
    });
    let offset = 0;
    const chunk = Math.ceil(bytes.length / 16);
    const timer = setInterval(() => {
      const end = Math.min(bytes.length, offset + chunk);
      response.write(bytes.subarray(offset, end));
      offset = end;
      if (offset === bytes.length) {
        clearInterval(timer);
        response.end();
      }
    }, 80);
    response.on('close', () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await mockApi(
      page,
      [{ ...first, text: null, attachment: { type: 'video', mediaId: 'slow-video' } }],
      origin,
    );
    await page.route(`${origin}/api/conversations/*/attachments/slow-video`, (route) =>
      route.continue(),
    );
    await page.route(`${origin}/api/auth/refresh`, (route) =>
      route.fulfill({ json: { accessToken: 'renewed-token', refreshToken: 'renewed-refresh' } }),
    );
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    const card = page.getByTestId('video-card-slow-video');
    await card.getByRole('button', { name: 'Download video', exact: true }).click();
    await expect(card.getByText(/ · [1-9][0-9]?%/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('video-download-progress.png') });
    await card.getByRole('button', { name: 'Cancel video download', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Download video', exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Download video', exact: true }).click();
    await expect(card.getByText(/ · [1-9][0-9]?%/)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Save video', exact: true })).toBeVisible();
    await expect(card.locator('video')).toHaveCount(0);
    expect(requests).toBe(3);
    await card.getByRole('button', { name: 'Play video', exact: true }).click();
    await expect(page.getByTestId('video-viewer').locator('video')).toBeVisible();
    await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
    expect(requests).toBe(3);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

for (const kind of ['image', 'video', 'gif'] as const) {
  test(`${kind} previews reserve server dimensions before media loads and use server thumbnails`, async ({
    page,
  }) => {
    let releaseMetadata!: () => void;
    let releaseMedia!: () => void;
    const metadataGate = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });
    const mediaGate = new Promise<void>((resolve) => {
      releaseMedia = resolve;
    });
    const mediaId = 'sized-media';
    let originalDownloads = 0;
    const attachment = kind === 'gif' ? { type: kind, gifId: mediaId } : { type: kind, mediaId };
    await mockApi(page, [{ ...first, text: null, attachment }]);
    const thumbnailUrl = 'https://media.example/server-thumbnail.jpg';
    await page.route('https://media.example/server-thumbnail.jpg', async (route) => {
      expect(route.request().headers().authorization).toBeUndefined();
      await mediaGate;
      await route.fulfill({
        path: path.join(__dirname, '../fixtures/portrait.png'),
        contentType: 'image/jpeg',
      });
    });
    await page.route('https://media.example/sized.mp4', async (route) => {
      await mediaGate;
      await route.fulfill({
        path: path.join(__dirname, '../fixtures/portrait.mp4'),
        contentType: 'video/mp4',
      });
    });
    await page.route(`**/api/conversations/*/attachments/${mediaId}`, async (route) => {
      originalDownloads++;
      await mediaGate;
      await route.fulfill({
        path: path.join(__dirname, '../fixtures/portrait.png'),
        contentType: 'image/png',
      });
    });
    const metadataPath =
      kind === 'gif'
        ? `**/api/gifs/${mediaId}`
        : `**/api/conversations/*/attachments/${mediaId}/metadata`;
    await page.route(metadataPath, async (route) => {
      expect(route.request().headers().authorization).toBe('Bearer access-token');
      await metadataGate;
      const media = {
        id: mediaId,
        type: kind,
        width: 360,
        height: 640,
        fileSize: 9000,
        thumbnailUrl,
        playbackUrl: 'https://media.example/sized.mp4',
      };
      await route.fulfill({ json: kind === 'gif' ? { gif: media } : { attachment: media } });
    });
    try {
      await signIn(page);
      await page.getByRole('button', { name: 'Open Weekend plans' }).click();
      const frame =
        kind === 'video'
          ? page.getByTestId(`video-card-${mediaId}`)
          : kind === 'image'
            ? page.getByLabel('Image preview', { exact: true })
            : page.locator('[aria-label="GIF preview"], [aria-label="Animated GIF"]');
      await expect
        .poll(async () => {
          const box = await frame.boundingBox();
          return box ? box.width / box.height : 0;
        })
        .toBeCloseTo(1, 2);
      releaseMetadata();
      await expect
        .poll(async () => {
          const box = await frame.boundingBox();
          return box ? box.width / box.height : 0;
        })
        .toBeCloseTo(0.6, 2);
      if (kind !== 'image') {
        await expect(
          page.getByRole('img', {
            name: kind === 'gif' ? 'GIF thumbnail' : 'Video thumbnail',
            exact: true,
          }),
        ).toHaveAttribute('src', thumbnailUrl);
      }
      if (kind === 'video') {
        expect(originalDownloads).toBe(0);
        await expect(frame.locator('video')).toHaveCount(0);
      }
      releaseMedia();
      if (kind === 'gif') {
        await expect
          .poll(() =>
            frame
              .locator('video')
              .evaluate((video: HTMLVideoElement) => video.readyState >= 2 && !video.paused),
          )
          .toBe(true);
        await expect(page.getByRole('img', { name: 'GIF thumbnail', exact: true })).toHaveCount(0);
      }
      await expect
        .poll(async () => {
          const box = await frame.boundingBox();
          return box ? box.width / box.height : 0;
        })
        .toBeCloseTo(0.6, 2);
    } finally {
      releaseMetadata();
      releaseMedia();
    }
  });
}

test('video thumbnail URLs renew from cached metadata without downloading the video', async ({
  page,
}) => {
  await page.clock.install();
  let lookups = 0;
  let downloads = 0;
  const mediaId = 'renewing-video';
  await mockApi(page, [{ ...first, text: null, attachment: { type: 'video', mediaId } }]);
  await page.route(`**/api/conversations/*/attachments/${mediaId}/metadata`, (route) =>
    route.fulfill({
      json: {
        attachment: {
          id: mediaId,
          type: 'video',
          width: 640,
          height: 360,
          fileSize: 1024,
          thumbnailUrl: `https://media.example/renewing-thumb.jpg?v=${++lookups}`,
        },
      },
    }),
  );
  await page.route('https://media.example/renewing-thumb.jpg*', (route) =>
    route.fulfill({
      path: path.join(__dirname, '../fixtures/portrait.png'),
      contentType: 'image/jpeg',
    }),
  );
  await page.route(`**/api/conversations/*/attachments/${mediaId}`, (route) => {
    downloads++;
    return route.fulfill({ status: 500 });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const thumbnail = page.getByRole('img', { name: 'Video thumbnail', exact: true });
  await expect(thumbnail).toHaveAttribute('src', 'https://media.example/renewing-thumb.jpg?v=1');
  await page.clock.fastForward(10 * 60 * 1000 + 1000);
  await expect(thumbnail).toHaveAttribute('src', 'https://media.example/renewing-thumb.jpg?v=2');
  expect(lookups).toBe(2);
  expect(downloads).toBe(0);
});

test('historical video metadata without dimensions or thumbnails keeps a square usable preview', async ({
  page,
}) => {
  let downloads = 0;
  const mediaId = 'old-video';
  await mockApi(page, [{ ...first, text: null, attachment: { type: 'video', mediaId } }]);
  await page.route(`**/api/conversations/*/attachments/${mediaId}/metadata`, (route) =>
    route.fulfill({
      json: {
        attachment: { id: mediaId, type: 'video', width: null, height: null, thumbnailUrl: null },
      },
    }),
  );
  await page.route(`**/api/conversations/*/attachments/${mediaId}`, (route) => {
    downloads++;
    return route.fulfill({ path: path.join(__dirname, '../fixtures/portrait.mp4') });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const card = page.getByTestId(`video-card-${mediaId}`);
  await expect(card.getByRole('button', { name: 'Play video', exact: true })).toBeVisible();
  const box = (await card.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(1, 2);
  await expect(card.getByRole('img', { name: 'Video thumbnail', exact: true })).toHaveCount(0);
  await expect(card.locator('video')).toHaveCount(0);
  expect(downloads).toBe(0);
});

for (const kind of ['image', 'video', 'document', 'audio'] as const) {
  test(`uploaded ${kind} attachments reuse local bytes for previews, playback, saving, and reopening`, async ({
    page,
  }, testInfo) => {
    await mockApi(page, []);
    let downloads = 0;
    const id = `uploaded-${kind}`;
    const name =
      kind === 'image'
        ? 'uploaded.png'
        : kind === 'video'
          ? 'uploaded.mp4'
          : kind === 'audio'
            ? 'sound.mp3'
            : 'notes.txt';
    const mimeType =
      kind === 'image'
        ? 'image/png'
        : kind === 'video'
          ? 'video/mp4'
          : kind === 'audio'
            ? 'audio/mpeg'
            : 'text/plain';
    const buffer =
      kind === 'image'
        ? readFileSync(path.join(__dirname, '../fixtures/portrait.png'))
        : kind === 'video'
          ? readFileSync(path.join(__dirname, '../fixtures/portrait.mp4'))
          : Buffer.from('original uploaded bytes');
    await page.route('**/api/conversations/*/attachments', (route) => {
      expect(route.request().method()).toBe('POST');
      return route.fulfill({
        status: 201,
        json: {
          attachment: {
            id,
            type: kind,
            fileName: name,
            contentType: mimeType,
            fileSize: buffer.length,
            width: 360,
            height: 640,
            thumbnailUrl: kind === 'video' ? 'https://media.example/uploaded-thumb.jpg' : null,
          },
        },
      });
    });
    await page.route(`**/api/conversations/*/attachments/${id}*`, (route) => {
      downloads++;
      return route.fulfill({ status: 500 });
    });
    await page.route('https://media.example/uploaded-thumb.jpg', (route) =>
      route.fulfill({
        path: path.join(__dirname, '../fixtures/portrait.png'),
        contentType: 'image/jpeg',
      }),
    );
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach a file', exact: true }).click();
    await (await picker).setFiles({ name, mimeType, buffer });
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const message = page.getByTestId('message-44444444-4444-4444-8444-444444444444');
    await expect(message).toBeVisible();
    if (kind === 'image') {
      await expect(message.locator('img')).toHaveAttribute('src', /^blob:/);
      await expect
        .poll(() =>
          message.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth > 0),
        )
        .toBeTruthy();
    }
    if (kind === 'video') {
      await expect(message.getByRole('button', { name: 'Save video', exact: true })).toBeVisible();
      await message.getByRole('button', { name: 'Play video', exact: true }).click();
      await expect
        .poll(() =>
          page
            .getByTestId('video-viewer')
            .locator('video')
            .evaluate((video: HTMLVideoElement) => video.readyState >= 2),
        )
        .toBeTruthy();
      await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
    }
    await message.getByRole('button', { name: 'Message actions', exact: true }).click();
    const saved = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save attachment', exact: true }).click();
    expect((await saved).suggestedFilename()).toBe(name);
    await expect(page.getByTestId('message-options')).toHaveCount(0);
    if (testInfo.project.name === 'mobile')
      await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    await expect(message).toBeVisible();
    if (kind === 'video')
      await expect(message.getByRole('button', { name: 'Save video', exact: true })).toBeVisible();
    if (kind === 'image') await expect(message.locator('img')).toHaveAttribute('src', /^blob:/);
    expect(downloads).toBe(0);
  });
}

test('uploaded GIFs preview from local bytes instead of fetching the converted server video', async ({
  page,
}) => {
  await mockApi(page, []);
  let mediaDownloads = 0;
  const gifId = 'local-uploaded-gif';
  await page.route('**/api/gifs', (route) =>
    route.fulfill({
      status: 201,
      json: {
        gif: {
          id: gifId,
          width: 10,
          height: 10,
          objectKey: 'gifs/converted.mp4',
          fileSize: 100,
          playbackUrl: 'https://media.example/converted.mp4',
        },
      },
    }),
  );
  await page.route('https://media.example/converted.mp4', (route) => {
    mediaDownloads++;
    return route.fulfill({ status: 500 });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach a file', exact: true }).click();
  await (
    await picker
  ).setFiles({
    name: 'animated.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
  });
  await expect(page.getByText('animated.gif', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const image = page.getByRole('img', { name: 'Uploaded GIF', exact: true });
  await expect(image).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth > 0))
    .toBeTruthy();
  expect(mediaDownloads).toBe(0);
});

test('GIF library uploads reuse the original local video for preview and sending', async ({
  page,
}) => {
  await mockApi(page, []);
  let uploaded = false;
  let downloads = 0;
  const gif = {
    id: 'library-local-video',
    width: 160,
    height: 120,
    fileSize: 4000,
    objectKey: 'gifs/library-upload.mp4',
    playbackUrl: 'https://media.example/library-upload.mp4',
  };
  await page.route('**/api/gifs', (route) => {
    if (route.request().method() === 'POST') {
      uploaded = true;
      return route.fulfill({ status: 201, json: { gif } });
    }
    return route.fulfill({ json: { gifs: uploaded ? [gif] : [] } });
  });
  await page.route(gif.playbackUrl, (route) => {
    downloads++;
    return route.fulfill({ status: 500 });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await page.getByRole('button', { name: 'Open GIF library', exact: true }).click();
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload GIF or video', exact: true }).click();
  await (await picker).setFiles(path.join(__dirname, '../fixtures/loop.mp4'));
  await expect(page.getByRole('button', { name: 'Send GIF', exact: true })).toBeVisible();
  const preview = page.locator('video');
  await expect(preview).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() =>
      preview.evaluate(
        (video: HTMLVideoElement) =>
          video.readyState >= 2 && !video.paused && video.muted && video.loop,
      ),
    )
    .toBeTruthy();
  await page.getByRole('button', { name: 'Send GIF', exact: true }).click();
  await expect(page.getByText('Your GIF library', { exact: true })).toHaveCount(0);
  const message = page.getByTestId('message-44444444-4444-4444-8444-444444444444');
  await expect(message.locator('video')).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() =>
      message
        .locator('video')
        .evaluate((video: HTMLVideoElement) => video.readyState >= 2 && !video.paused),
    )
    .toBeTruthy();
  expect(downloads).toBe(0);
});

test('voice attachments play, pause, seek on a straight progress line, and expose message options', async ({
  page,
}, testInfo) => {
  await mockApi(page, [
    { ...first, text: null, attachment: { type: 'voice', mediaId: 'incoming-voice' } },
  ]);
  let downloads = 0;
  await page.route('**/api/conversations/*/attachments/incoming-voice', (route) => {
    downloads++;
    expect(route.request().headers().authorization).toBe('Bearer access-token');
    return route.fulfill({
      path: path.join(__dirname, '../fixtures/voice.ogg'),
      contentType: 'application/octet-stream',
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const voice = page.getByTestId('voice-player');
  await expect(voice).toBeVisible();
  await expect(voice.getByText('0:03', { exact: true })).toBeVisible();
  await voice.getByRole('button', { name: 'Play voice message', exact: true }).click();
  await expect(
    voice.getByRole('button', { name: 'Pause voice message', exact: true }),
  ).toBeVisible();
  await voice.getByRole('button', { name: 'Pause voice message', exact: true }).click();
  const progress = voice.getByRole('slider', { name: 'Voice message progress', exact: true });
  const bounds = (await progress.boundingBox())!;
  await progress.click({ position: { x: bounds.width * 0.6, y: bounds.height / 2 } });
  await expect(progress).toHaveAttribute('aria-valuenow', '1');
  // Keep dragging when the pointer leaves both the track and its message bubble.
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width + 50, bounds.y - 60);
  await expect(page.getByTestId('chat-history')).toHaveCSS('overflow-y', 'hidden');
  await expect(progress).toHaveAttribute('aria-valuenow', '3');
  await page.mouse.up();
  await expect(page.getByTestId('chat-history')).not.toHaveCSS('overflow-y', 'hidden');
  await expect(progress).toHaveAttribute('aria-valuenow', '3');
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 60, bounds.y + 60);
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await page.mouse.up();
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByTestId('message-options')).toHaveCount(0);
  if (testInfo.project.name === 'mobile') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: bounds.x + 10, y: bounds.y + bounds.height / 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: bounds.x + bounds.width + 10, y: bounds.y + 60 }],
    });
    await expect(page.getByTestId('chat-history')).toHaveCSS('overflow-y', 'hidden');
    await expect(progress).toHaveAttribute('aria-valuenow', '3');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByTestId('chat-history')).not.toHaveCSS('overflow-y', 'hidden');
    await expect(progress).toHaveAttribute('aria-valuenow', '3');
    await cdp.detach();
  }
  await page.screenshot({ path: testInfo.outputPath('voice-message.png') });
  await expect(page.getByTestId('message-options')).toHaveCount(0);
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(
    page.getByTestId('reply-composer').getByText('Voice message', { exact: true }),
  ).toBeVisible();
  expect(downloads).toBe(1);
});

async function mockMicrophone(page: Page, mode: 'granted' | 'denied' | 'delayed' = 'granted') {
  await page.addInitScript((mode) => {
    const stats = { stopped: 0, resolve: undefined as undefined | (() => void) };
    Object.assign(window, { __voiceMicrophone: stats });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        if (mode === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
        const context = new AudioContext();
        const source = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        source.connect(destination);
        source.start();
        destination.stream.getTracks().forEach((track) => {
          const stop = track.stop.bind(track);
          track.stop = () => {
            stats.stopped++;
            stop();
            source.stop();
            void context.close();
          };
        });
        if (mode === 'delayed')
          await new Promise<void>((resolve) => {
            stats.resolve = resolve;
          });
        return destination.stream;
      },
    });
  }, mode);
}

test('hold-to-record releases, uploads kind=voice, sends a reply and reuses the local recording', async ({
  page,
}) => {
  await mockApi(page, [
    { ...first, text: null, attachment: { type: 'voice', mediaId: 'reply-voice' } },
  ]);
  await mockMicrophone(page);
  await page.route('**/api/conversations/*/attachments/reply-voice', (route) =>
    route.fulfill({
      path: path.join(__dirname, '../fixtures/voice.ogg'),
      contentType: 'audio/ogg',
    }),
  );
  let uploads = 0;
  let downloads = 0;
  await page.route('**/api/conversations/*/attachments', (route) => {
    uploads++;
    const body = route.request().postDataBuffer()!.toString('latin1');
    expect(body).toContain('name="kind"\r\n\r\nvoice');
    expect(body).toContain('name="file"');
    expect(body).toContain('audio/webm');
    return route.fulfill({
      status: 201,
      json: {
        attachment: {
          id: 'recorded-voice',
          type: 'voice',
          fileName: 'voice.ogg',
          contentType: 'audio/ogg',
          fileSize: 1234,
        },
      },
    });
  });
  await page.route('**/api/conversations/*/attachments/recorded-voice', (route) => {
    downloads++;
    return route.fulfill({ status: 500 });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.getByTestId('message-options')).toHaveCount(0);
  await expect(page.getByTestId('reply-composer')).toContainText('Voice message');
  const mic = page.getByRole('button', { name: 'Hold to record voice message', exact: true });
  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByText(/Recording 0:00 · release to send/)).toBeVisible();
  await page.waitForTimeout(450);
  const sent = page.waitForRequest(
    (request) => request.url().endsWith('/messages') && request.method() === 'POST',
  );
  await page.mouse.move(box.x - 120, box.y - 70);
  await page.mouse.up();
  expect((await sent).postDataJSON()).toEqual({
    attachment: { type: 'voice', mediaId: 'recorded-voice' },
    replyToMessageId: first.id,
  });
  const voice = page.getByTestId('voice-player').last();
  await expect(voice).toBeVisible();
  await voice.getByRole('button', { name: 'Play voice message', exact: true }).click();
  await expect(
    voice.getByRole('button', { name: 'Pause voice message', exact: true }),
  ).toBeVisible();
  await voice.getByRole('button', { name: 'Pause voice message', exact: true }).click();
  expect(uploads).toBe(1);
  expect(downloads).toBe(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __voiceMicrophone: { stopped: number } }).__voiceMicrophone
            .stopped,
      ),
    )
    .toBe(1);
});

for (const mode of ['denied', 'delayed'] as const) {
  test(`voice recording ${mode === 'denied' ? 'permission denial' : 'release during permission'} never uploads or keeps the microphone active`, async ({
    page,
  }) => {
    await mockApi(page);
    await mockMicrophone(page, mode);
    let uploads = 0;
    await page.route('**/api/conversations/*/attachments', (route) => {
      uploads++;
      return route.fulfill({ status: 500 });
    });
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    const mic = page.getByRole('button', { name: 'Hold to record voice message', exact: true });
    const box = (await mic.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    if (mode === 'denied')
      await expect(
        page.getByText('Allow microphone access to record voice messages.'),
      ).toBeVisible();
    else await expect(page.getByText('Preparing microphone…')).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable();
    await expect(mic).toBeEnabled();

    if (mode === 'delayed') {
      await page.evaluate(() =>
        (
          window as unknown as { __voiceMicrophone: { resolve?: () => void } }
        ).__voiceMicrophone.resolve?.(),
      );
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { __voiceMicrophone: { stopped: number } }).__voiceMicrophone
                .stopped,
          ),
        )
        .toBe(1);
    }
    await expect(page.getByText(/Recording .*release to send/)).toHaveCount(0);
    await expect(mic).toBeEnabled();
    expect(uploads).toBe(0);
  });
}

test('accidental mic taps leave typing usable and fast typing switches immediately to send', async ({
  page,
}) => {
  await mockApi(page);
  await mockMicrophone(page, 'delayed');
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  const mic = page.getByRole('button', { name: 'Hold to record voice message', exact: true });
  await mic.click();
  await expect(composer).toBeEditable();
  await expect(page.getByText('Preparing microphone…')).toHaveCount(0);
  await composer.focus();
  await page.keyboard.type('A quick message', { delay: 0 });
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await send.click();
  await expect(page.getByText('A quick message', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('');
  await expect(composer).toBeFocused();
  // Cancel a real preparation before its permission promise resolves. Typing
  // must work immediately, and late permission must not lock the new draft.
  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByText('Preparing microphone…')).toBeVisible();
  await page.mouse.up();
  await expect(composer).toBeEditable();
  await composer.fill('Typing after cancellation');
  await expect(send).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { __voiceMicrophone: { resolve?: () => void } }
    ).__voiceMicrophone.resolve?.(),
  );
  await expect(composer).toBeEditable();
  await expect(composer).toHaveValue('Typing after cancellation');
  await send.click();
  await expect(page.getByText('Typing after cancellation', { exact: true })).toBeVisible();
});

test('moving away while holding keeps recording until release; leaving the chat cancels without sending', async ({
  page,
}) => {
  await mockApi(page);
  await mockMicrophone(page);
  let uploads = 0;
  await page.route('**/api/conversations/*/attachments', (route) => {
    uploads++;
    return route.fulfill({ status: 500 });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const mic = page.getByRole('button', { name: 'Hold to record voice message', exact: true });
  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByText(/Recording .*release to send/)).toBeVisible();
  await page.mouse.move(box.x - 160, box.y - 100);
  await page.waitForTimeout(300);
  await expect(page.getByText(/Recording .*release to send/)).toBeVisible();
  expect(uploads).toBe(0);
  // Browser history navigation is equivalent to leaving the conversation while held.
  await page.goBack();
  await page.mouse.up();
  await expect(page.getByText(/Recording .*release to send/)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __voiceMicrophone: { stopped: number } }).__voiceMicrophone
            .stopped,
      ),
    )
    .toBe(1);
  expect(uploads).toBe(0);
});
