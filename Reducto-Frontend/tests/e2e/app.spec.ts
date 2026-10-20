import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import path from 'node:path';
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
  await expect(page.getByRole('button', { name: 'Save GIF to library' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Open GIF library' }).click();
  await expect(page.locator('video')).toBeVisible();
  await page.getByRole('button', { name: 'Send GIF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open gif attachment' })).toBeVisible();
  const sentVideo = page.getByRole('button', { name: 'Open gif attachment' }).locator('video');
  await expect(sentVideo).toHaveAttribute('src', playbackUrl);
  await expect
    .poll(() =>
      sentVideo.evaluate((video: HTMLVideoElement) => !video.paused && video.videoWidth > 0),
    )
    .toBe(true);
  expect(lookups).toBe(0);
});

test('visible GIF previews renew cached signed links before expiry', async ({ page }) => {
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
  await expect(page.locator('video')).toHaveAttribute('src', 'https://media.example/test.mp4?v=1');
  await page.clock.fastForward(10 * 60 * 1000 + 1000);
  await expect(page.locator('video')).toHaveAttribute('src', 'https://media.example/test.mp4?v=2');
  expect(lookups).toBe(2);
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
    } else if (path.endsWith('/messages')) body = { messages, nextCursor: null };
    else if (path.endsWith('/profile')) body = { user: { ...user, ...request.postDataJSON() } };
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

for (const gif of [false, true]) {
  test(`${gif ? 'GIF' : 'text'} message options fade out as one complete dialog`, async ({
    page,
  }) => {
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
    const label = gif ? 'Save GIF to library' : 'Copy text';
    await open();
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    const partialFrames = await page.evaluate(async (label) => {
      let partial = 0;
      const start = performance.now();
      const check = () => {
        const title = document.body.textContent?.includes('Message options') ?? false;
        const action = Array.from(document.querySelectorAll('button, [role="button"]')).some(
          (element) => element.textContent?.trim() === label,
        );
        if (title !== action) partial++;
      };
      const observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      document.querySelector<HTMLElement>('[aria-label="Close dialog"]')!.click();
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
    await expect(page.getByText('Message options', { exact: true })).toHaveCount(0);
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

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Open document attachment' }).click();
  expect((await downloading).suggestedFilename()).toBe('notes.txt');
  await expect(page.getByText('Message options', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  await expect(page.getByText('Message options', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Forward message', exact: true })).toBeVisible();
  const reaction = page.waitForRequest((request) => request.url().endsWith('/reactions'));
  await page.getByRole('button', { name: 'React 👍', exact: true }).click();
  const request = await reaction;
  expect(request.method()).toBe('PUT');
  expect(request.postDataJSON()).toEqual({ emoji: '👍' });
  await expect(page.getByText('Message options', { exact: true })).toHaveCount(0);
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
  await expect(page.getByText('Message options', { exact: true })).toHaveCount(0);

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
