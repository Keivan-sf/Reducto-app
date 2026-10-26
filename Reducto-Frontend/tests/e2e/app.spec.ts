import { expect, test, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import path from 'node:path';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { imageDensity } from '../../src/lib/image-density';
const inviteToken = '32d48175eefe9c95142073e7c2ac93aadf87e126616733142362774c8c8ab40a';
const inviteUri = `reducto:///api/groups/join/${inviteToken}`;

async function expectMediaBubble(page: Page, frame: Locator) {
  const bubble = page.getByTestId(`message-${first.id}`);
  const meta = page.getByTestId(`message-meta-${first.id}`);
  await expect(meta).toHaveCSS('position', 'absolute');
  await expect(meta).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.4)');
  await expect
    .poll(async () => {
      const [outer, media, badge] = await Promise.all([
        bubble.boundingBox(),
        frame.boundingBox(),
        meta.boundingBox(),
      ]);
      return (
        !!outer &&
        !!media &&
        !!badge &&
        Math.abs(media.x - outer.x - 2) < 1 &&
        Math.abs(outer.width - media.width - 4) < 1 &&
        Math.abs(media.x + media.width - badge.x - badge.width - 6) < 1 &&
        Math.abs(media.y + media.height - badge.y - badge.height - 6) < 1 &&
        badge.x >= media.x &&
        badge.y >= media.y
      );
    })
    .toBe(true);
}

for (const type of ['image', 'gif', 'video'] as const) {
  test(`forwarded ${type} bubbles keep headers and captions within the media width`, async ({
    page,
  }) => {
    const mediaId = 'forwarded-media';
    const caption =
      'A long forwarded media caption that should wrap inside the narrow portrait bubble.';
    await mockApi(page, [
      {
        ...first,
        senderId: user.id,
        text: caption,
        forwardedFrom: { senderId: friend.id, messageId: first.id, conversationId: chat.id },
        attachment: type === 'gif' ? { type, gifId: mediaId } : { type, mediaId },
        attachmentMetadata: {
          id: mediaId,
          type,
          width: 120,
          height: 240,
          fileSize: 100,
          contentType: type === 'image' ? 'image/png' : 'video/mp4',
          playbackUrl: 'https://media.example/forwarded.mp4',
          thumbnailUrl: null,
        },
        reactions: [{ userId: friend.id, emoji: '👍' }],
      },
    ]);
    await page.route(`**/api/conversations/*/attachments/${mediaId}`, (route) => route.abort());
    await page.route('https://media.example/forwarded.mp4', (route) => route.abort());
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    const frame =
      type === 'video'
        ? page.getByTestId(`video-card-${mediaId}`)
        : page.getByLabel(type === 'image' ? 'Image preview' : 'GIF preview', { exact: true });
    await expectMediaBubble(page, frame);
    await expect(page.getByTestId(`message-status-${first.id}`)).toHaveAccessibleName(
      'Message sent',
    );
    const bubble = page.getByTestId(`message-${first.id}`);
    for (const text of [
      bubble.getByText('Forwarded from Grace Hopper'),
      bubble.getByText(caption),
    ]) {
      await expect(text).toBeVisible();
      const [label, media] = await Promise.all([text.boundingBox(), frame.boundingBox()]);
      expect(label!.x).toBeGreaterThanOrEqual(media!.x);
      expect(label!.x + label!.width).toBeLessThanOrEqual(media!.x + media!.width);
    }
  });
}

test('message metadata sizes unloaded media and shows durations without detail requests', async ({
  page,
}) => {
  const media = [
    {
      id: 'inline-image',
      type: 'image',
      width: 90,
      height: 180,
      fileSize: 100,
      fileName: 'photo.png',
      contentType: 'image/png',
    },
    {
      id: 'inline-video',
      type: 'video',
      width: 320,
      height: 180,
      fileSize: 100,
      fileName: 'clip.mp4',
      contentType: 'video/mp4',
      durationSeconds: 73,
      thumbnailUrl: null,
    },
    {
      id: 'inline-voice',
      type: 'voice',
      fileSize: 100,
      fileName: 'voice.ogg',
      contentType: 'audio/ogg',
      durationSeconds: 64,
    },
    {
      id: 'inline-music',
      type: 'music',
      fileSize: 100,
      fileName: 'song.mp3',
      contentType: 'audio/mpeg',
      durationSeconds: 122,
    },
  ] as const;
  const gifId = 'inline-gif';
  const messages = [
    ...media.map((item, index) => ({
      ...first,
      id: `inline-message-${index}`,
      text: null,
      createdAt: `2026-10-18T12:0${index}:00Z`,
      attachment: { type: item.type, mediaId: item.id },
      attachmentMetadata: item,
    })),
    {
      ...first,
      id: 'inline-message-gif',
      text: null,
      createdAt: '2026-10-18T12:04:00Z',
      attachment: { type: 'gif', gifId },
      attachmentMetadata: {
        id: gifId,
        objectKey: 'gifs/inline.mp4',
        fileSize: 100,
        createdAt: first.createdAt,
        playbackUrl: 'https://media.example/inline.mp4',
        thumbnailUrl: null,
        width: 80,
        height: 200,
      },
    },
  ];
  await mockApi(page, messages);
  let details = 0;
  await page.route('**/api/conversations/*/attachments/*/metadata', (route) => {
    details++;
    return route.fulfill({ status: 500 });
  });
  await page.route(`**/api/gifs/${gifId}`, (route) => {
    details++;
    return route.fulfill({ status: 500 });
  });
  await page.route('https://media.example/inline.mp4', (route) => route.abort());
  await page.route('**/api/conversations/*/attachments/inline-image', (route) => route.abort());
  await page.route('**/api/conversations/*/attachments/inline-voice', (route) => route.abort());
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const image = page.getByLabel('Image preview', { exact: true });
  const video = page.getByTestId('video-card-inline-video');
  const gif = page.getByLabel('GIF preview', { exact: true });
  for (const [frame, expected] of [
    [image, 0.5],
    [video, 320 / 180],
    [gif, 80 / 200],
  ] as const) {
    await expect
      .poll(async () => {
        const box = await frame.boundingBox();
        return box ? box.width / box.height : 0;
      })
      .toBeCloseTo(expected, 1);
  }
  await expect(video.getByText('Video · 1:13')).toBeVisible();
  await expect(page.getByText('1:04', { exact: true })).toBeVisible();
  await expect(page.getByText('0:00 / 2:02', { exact: true })).toBeVisible();
  expect(details).toBe(0);
});

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
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
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
            frame.width <= 290 &&
            frame.height <= 400 &&
            frame.left >= 0 &&
            frame.right <= window.innerWidth
          );
        }),
      )
      .toBe(true);
    await expect(video).toHaveCSS('object-fit', 'cover');
    await expectMediaBubble(page, video);
  });
}

for (const panorama of [false, true]) {
  test(`image previews adapt to ${panorama ? 'extreme panorama' : 'portrait'} dimensions and fill their frame`, async ({
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
    await expectMediaBubble(page, frame);
    await expect
      .poll(async () => {
        const box = await frame.boundingBox();
        return box ? box.width / box.height : 0;
      })
      .toBeCloseTo(panorama ? 4 : 0.5, 1);
    await expect
      .poll(() =>
        frame.evaluate((element) => {
          const box = element.getBoundingClientRect();
          // React Native Web renders an Image as a background sized to cover the frame.
          const image = element.querySelector('[style*="background-image"]');
          return (
            box.width <= 290 &&
            box.height <= 400 &&
            box.left >= 0 &&
            box.right <= window.innerWidth &&
            !!image &&
            getComputedStyle(image).backgroundSize === 'cover'
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
  isEdited: false,
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
    else if (path === `/api/conversations/${chat.id}`) body = { conversation: chat };
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

test('unseen mentions jump oldest first, mark only visible targets, and disappear when exhausted', async ({
  page,
}) => {
  const history = Array.from({ length: 130 }, (_, index) => ({
    ...first,
    id: `mention-${String(130 - index).padStart(3, '0')}`,
    text: `Message ${index} @ada`,
    createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
  }));
  await mockApi(page, history);
  const realtime = await mockRealtime(page);
  let mentions = [history[80], history[5]].map((message) => ({
    userId: user.id,
    conversationId: chat.id,
    messageId: message.id,
    seen: false,
  }));
  const marked: string[] = [];
  let failSeen = true;
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({
      json: {
        conversations: [
          { ...chat, lastSeenMessageId: history[129].id, unreadCount: 5, unseenMentions: mentions },
        ],
      },
    }),
  );
  await page.route('**/api/conversations/*/messages/*', (route) => {
    const message = history.find((entry) => route.request().url().endsWith(`/${entry.id}`));
    return message ? route.fulfill({ json: { message } }) : route.fallback();
  });
  await page.route('**/api/conversations/*/mentions/*/seen', async (route) => {
    expect(route.request().method()).toBe('PUT');
    expect(route.request().headers().authorization).toBe('Bearer access-token');
    const mention = mentions.find((entry) =>
      route.request().url().includes(`/${entry.messageId}/`),
    )!;
    await expect(page.getByTestId(`message-${mention.messageId}`)).toBeInViewport();
    if (failSeen) {
      failSeen = false;
      return route.fulfill({ status: 500, json: { error: 'Mention update failed' } });
    }
    marked.push(mention.messageId);
    mentions = mentions.filter((entry) => entry !== mention);
    return route.fulfill({ json: { mention: { ...mention, seen: true } } });
  });
  await signIn(page);
  await expect(page.getByTestId(`mentions-${chat.id}`)).toBeVisible();
  const mentionBadge = await page.getByTestId(`mentions-${chat.id}`).boundingBox();
  const unreadBadge = await page.getByTestId(`unread-${chat.id}`).boundingBox();
  expect(mentionBadge!.x + mentionBadge!.width).toBeLessThan(unreadBadge!.x);
  const mentionGlyph = await page.getByTestId(`mentions-${chat.id}`).locator('svg').boundingBox();
  expect(
    Math.abs(mentionGlyph!.y + mentionGlyph!.height / 2 - unreadBadge!.y - unreadBadge!.height / 2),
  ).toBeLessThan(1);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const jump = page.getByTestId('jump-to-mention');
  await expect(page.getByTestId('unseen-mentions-count')).toHaveText('2');
  expect(marked).toEqual([]);
  await jump.click();
  await expect(page.getByText('Mention update failed', { exact: true })).toBeVisible();
  await expect(page.getByTestId('unseen-mentions-count')).toHaveText('2');
  await jump.click();
  await expect.poll(() => marked).toEqual([history[5].id]);
  await expect(page.getByTestId('unseen-mentions-count')).toHaveText('1');
  await expect(page.getByTestId('scroll-to-latest')).toBeVisible();
  const [mentionButton, latestButton] = await Promise.all([
    jump.boundingBox(),
    page.getByTestId('scroll-to-latest').boundingBox(),
  ]);
  expect(mentionButton!.y + mentionButton!.height).toBeLessThan(latestButton!.y);
  await jump.click();
  await expect.poll(() => marked).toEqual([history[5].id, history[80].id]);
  await expect(jump).toBeHidden();
  mentions = [
    { userId: user.id, conversationId: chat.id, messageId: history[100].id, seen: false },
  ];
  await expect.poll(realtime.connections).toBeGreaterThan(0);
  realtime.emit('mention.created', { mention: mentions[0] });
  realtime.emit('mention.created', { mention: mentions[0] });
  realtime.emit('mention.created', {
    mention: { ...mentions[0], userId: 'someone-else', messageId: history[101].id },
  });
  await expect(page.getByTestId('unseen-mentions-count')).toHaveText('1');
  await jump.click();
  await expect.poll(() => marked).toEqual([history[5].id, history[80].id, history[100].id]);
  await expect(jump).toBeHidden();
});

test('visible mentions are seen on opening, scrolling, and realtime delivery without using the mention button', async ({
  page,
}) => {
  const history = Array.from({ length: 30 }, (_, index) => ({
    ...first,
    id: `visible-mention-${index}`,
    text: `Message ${index} @ada`,
    createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
  }));
  await mockApi(page, history);
  const realtime = await mockRealtime(page);
  const mentionFor = (index: number) => ({
    userId: user.id,
    conversationId: chat.id,
    messageId: history[index].id,
    seen: false,
  });
  let mentions = [mentionFor(0), mentionFor(15), mentionFor(28), mentionFor(29)];
  const marked: string[] = [];
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({
      json: {
        conversations: [
          { ...chat, lastSeenMessageId: history[29].id, unreadCount: 0, unseenMentions: mentions },
        ],
      },
    }),
  );
  await page.route('**/api/conversations/*/mentions/*/seen', async (route) => {
    const mention = mentions.find((entry) =>
      route.request().url().includes(`/${entry.messageId}/`),
    )!;
    await expect(page.getByTestId(`message-${mention.messageId}`)).toBeInViewport();
    marked.push(mention.messageId);
    mentions = mentions.filter((entry) => entry !== mention);
    return route.fulfill({ json: { mention: { ...mention, seen: true } } });
  });
  await signIn(page);
  await page.waitForTimeout(450);
  expect(marked).toEqual([]);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect.poll(() => [...marked].sort()).toEqual([history[28].id, history[29].id].sort());
  await expect(page.getByTestId('unseen-mentions-count')).toHaveText('2');
  await expect.poll(realtime.connections).toBeGreaterThan(0);
  mentions.push(mentionFor(27));
  realtime.emit('mention.created', { mention: mentionFor(27) });
  await expect.poll(() => marked.includes(history[27].id)).toBe(true);
  await expect(page.getByTestId('unseen-mentions-count')).toHaveText('2');
  await page.getByTestId('chat-history').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => marked.includes(history[0].id)).toBe(true);
  expect(marked).not.toContain(history[15].id);
  await expect(page.getByTestId('unseen-mentions-count')).toHaveText('1');
  await page.getByTestId('jump-to-mention').click();
  await expect.poll(() => marked.includes(history[15].id)).toBe(true);
  await expect(page.getByTestId('jump-to-mention')).toBeHidden();
  expect(new Set(marked).size).toBe(marked.length);
});

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

async function mockRealtime(page: Page, accessToken = 'access-token', pingInterval = 25000) {
  let socket: WebSocketRoute | undefined;
  let connections = 0;
  let heartbeats = 0;
  await page.routeWebSocket(/\/socket\.io\//, (route) => {
    socket = route;
    connections++;
    // Engine.IO open packet, then Socket.IO authenticated namespace handshake.
    route.send(
      `0${JSON.stringify({ sid: `engine-${connections}`, upgrades: [], pingInterval, pingTimeout: 20000, maxPayload: 1000000 })}`,
    );
    route.onMessage((message) => {
      const packet = message.toString();
      if (packet === '42["p"]') heartbeats++;
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
    heartbeats: () => heartbeats,
    url: () => socket?.url(),
  };
}

test('scroll-to-latest shows live unread counts away from the bottom and clears after jumping', async ({
  page,
}) => {
  const history = Array.from({ length: 40 }, (_, index) => ({
    ...first,
    id: `scroll-latest-${index}`,
    text: `History message ${index}`,
    createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
  }));
  await mockApi(page, history);
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({
      json: {
        conversations: [{ ...chat, lastSeenMessageId: history.at(-1)!.id, unreadCount: 0 }],
      },
    }),
  );
  const realtime = await mockRealtime(page);
  await signIn(page);
  await expect.poll(realtime.connections).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const button = page.getByTestId('scroll-to-latest');
  const badge = page.getByTestId('scroll-to-latest-unread');
  await expect(page.getByTestId(`message-${history.at(-1)!.id}`)).toBeInViewport();
  await expect(page.getByTestId('chat-history-loading')).toBeHidden();
  await expect(button).toBeHidden();
  const scrollUp = async () => {
    await page.getByTestId('chat-history').dispatchEvent('wheel', { deltaY: -650, bubbles: true });
    await page.getByTestId('chat-history').evaluate((element) => {
      element.scrollTop = 650;
    });
  };
  await scrollUp();
  await expect(button).toBeVisible();
  await expect(badge).toBeHidden();
  // Hide before the last few pixels of a slow scroll settle at exactly zero.
  await page.getByTestId('chat-history').evaluate((element) => {
    element.scrollTop = 20;
  });
  await expect(button).toBeHidden();
  await page.getByTestId('chat-history').evaluate((element) => {
    element.scrollTop = 40;
  });
  await expect(button).toBeHidden();
  await scrollUp();
  await expect(button).toBeVisible();
  for (let index = 0; index < 2; index++) {
    realtime.emit('message.created', {
      message: {
        ...first,
        id: `scroll-new-${index}`,
        text: `New arrival ${index}`,
        createdAt: new Date(Date.parse(first.createdAt) + (40 + index) * 1000).toISOString(),
      },
    });
  }
  await expect(badge).toHaveText('2');
  const buttonBounds = await button.boundingBox();
  if (!buttonBounds) throw new Error('Scroll-to-latest button must be visible');
  await page.mouse.move(
    buttonBounds.x + buttonBounds.width / 2,
    buttonBounds.y + buttonBounds.height / 2,
  );
  await page.mouse.down();
  // The jump must complete while held, before release/click or fade completion.
  await expect
    .poll(() => page.getByTestId('chat-history').evaluate((element) => element.scrollTop))
    .toBe(0);
  await page.mouse.up();
  await expect(page.getByTestId('message-scroll-new-1')).toBeInViewport();
  await expect(button).toBeHidden();
  await page.waitForTimeout(450); // Allow the existing read-visibility dwell time.
  await scrollUp();
  await expect(button).toBeVisible();
  await expect(badge).toBeHidden();
});

test('outgoing ticks update when a group member sees a message and recover after reload', async ({
  page,
}, testInfo) => {
  const firstSent = {
    ...first,
    id: 'outgoing-first',
    senderId: user.id,
    text: 'First outgoing message',
  };
  const secondSent = {
    ...firstSent,
    id: 'outgoing-second',
    text: 'Second outgoing message',
    createdAt: '2026-10-18T12:02:00Z',
  };
  let peerSeen: string | null = null;
  await mockApi(page, [secondSent, firstSent]);
  await page.route(`http://localhost:3001/api/conversations/${chat.id}/members`, (route) =>
    route.fulfill({
      json: {
        members: [
          { userId: user.id, conversationId: chat.id, role: 'owner' },
          {
            userId: 'friend',
            conversationId: chat.id,
            role: 'member',
            lastSeenMessageId: peerSeen,
          },
        ],
      },
    }),
  );
  const realtime = await mockRealtime(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const firstStatus = page.getByTestId(`message-status-${firstSent.id}`);
  const secondStatus = page.getByTestId(`message-status-${secondSent.id}`);
  await expect(firstStatus).toHaveAttribute('aria-label', 'Message sent');
  await expect(secondStatus).toHaveAttribute('aria-label', 'Message sent');

  peerSeen = secondSent.id;
  realtime.emit('conversation.seen', {
    conversationId: chat.id,
    userId: 'friend',
    lastSeenMessageId: secondSent.id,
  });
  await expect(firstStatus).toHaveAttribute('aria-label', 'Message seen');
  await expect(secondStatus).toHaveAttribute('aria-label', 'Message seen');

  await page.reload();
  if (testInfo.project.name === 'desktop') {
    await expect(page.getByRole('button', { name: 'Open Weekend plans' })).toBeVisible();
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  }
  await expect(page.getByTestId(`message-status-${firstSent.id}`)).toHaveAttribute(
    'aria-label',
    'Message seen',
  );
});

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

test('composer fills the chat width and centers circular controls', async ({ page }, testInfo) => {
  await mockApi(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  const bar = input.locator('..');
  const header = page.getByRole('button', { name: 'View conversation details' }).locator('..');
  const attach = page.getByRole('button', { name: 'Attach a file', exact: true });
  const gifs = page.getByRole('button', { name: 'Open GIF library', exact: true });
  const mic = page.getByRole('button', { name: 'Hold to record voice message', exact: true });
  await expect(input).toBeVisible();
  const headerBox = (await header.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  expect(Math.abs(barBox.x - headerBox.x)).toBeLessThan(1);
  expect(Math.abs(barBox.width - headerBox.width)).toBeLessThan(1);
  expect(barBox.height).toBeLessThanOrEqual(60);
  for (const control of [attach, input, gifs, mic]) {
    const box = (await control.boundingBox())!;
    expect(Math.abs(box.y + box.height / 2 - barBox.y - barBox.height / 2)).toBeLessThan(1);
  }
  await expect(mic).toHaveCSS('border-radius', '22px');
  await input.fill('Test message');
  await expect(input).toHaveCSS('border-top-width', '0px');
  await expect(input).toHaveCSS('outline-width', '0px');
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await expect(send).toHaveCSS('border-radius', '22px');
  await page.screenshot({ path: testInfo.outputPath('composer.png') });
  await input.fill('First line\nSecond line\nThird line');
  await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(44);
  await input.fill('');
  await expect.poll(async () => (await bar.boundingBox())!.height).toBe(barBox.height);
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

test('optimistic sends clear immediately, allow concurrent messages, and show failure/retry status per bubble', async ({
  page,
}) => {
  await mockApi(page);
  const bodies: { text: string }[] = [];
  const finish: ((failed?: boolean) => Promise<void>)[] = [];
  await page.route('**/api/conversations/*/messages', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    const index = bodies.length;
    bodies.push(body);
    finish.push((failed = false) =>
      route.fulfill(
        failed
          ? { status: 500, json: { error: 'Could not send now' } }
          : {
              json: {
                message: {
                  ...first,
                  ...body,
                  id: `burst-${index}`,
                  senderId: user.id,
                  createdAt: new Date(Date.now() + index).toISOString(),
                },
              },
            },
      ),
    );
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  for (const text of ['First queued message', 'Second queued message']) {
    await composer.fill(text);
    const send = page.getByRole('button', { name: 'Send message', exact: true });
    await expect(send.getByRole('progressbar')).toHaveCount(0);
    await send.click();
    await expect(composer).toHaveValue('');
    await expect(composer).toBeFocused();
    await expect(page.getByTestId('chat-history').getByText(text, { exact: true })).toBeVisible();
  }
  await expect.poll(() => bodies.length).toBe(2);
  await expect(page.getByLabel('Sending message', { exact: true })).toHaveCount(2);
  await finish[1]();
  await expect(page.getByTestId('message-status-burst-1')).toHaveAttribute(
    'aria-label',
    'Message sent',
  );
  await expect(page.getByLabel('Sending message', { exact: true })).toHaveCount(1);
  await finish[0](true);
  await expect(page.getByLabel('Message failed to send', { exact: true })).toBeVisible();
  await expect(
    page.getByTestId('chat-history').getByText('First queued message', { exact: true }),
  ).toBeVisible();
  await composer.fill('Draft while retrying');
  await page.getByTestId('chat-history').getByText('First queued message', { exact: true }).click();
  await page.getByRole('button', { name: 'Retry sending', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(3);
  expect(bodies[2]).toEqual(bodies[0]);
  await expect(page.getByLabel('Sending message', { exact: true })).toHaveCount(1);
  await finish[2]();
  await expect(page.getByTestId('message-status-burst-2')).toHaveAttribute(
    'aria-label',
    'Message sent',
  );
  await expect(composer).toHaveValue('Draft while retrying');
  await expect(page.getByLabel('Message failed to send', { exact: true })).toHaveCount(0);
  await expect(
    page.getByTestId('chat-history').getByText('First queued message', { exact: true }),
  ).toHaveCount(1);
});

test('sent bubbles stay above the composer through keyboard-sized viewport changes and confirmation', async ({
  page,
}) => {
  const history = Array.from({ length: 80 }, (_, index) => ({
    ...first,
    id: `keyboard-history-${index}`,
    text: `History ${index}\nA second line`,
    createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
  }));
  await mockApi(page, history);
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({
      json: {
        conversations: [{ ...chat, lastSeenMessageId: history[79].id, unreadCount: 0 }],
      },
    }),
  );
  let confirm!: () => Promise<void>;
  await page.route('**/api/conversations/*/messages', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    confirm = () =>
      route.fulfill({
        json: {
          message: {
            ...first,
            ...body,
            id: 'keyboard-confirmed',
            senderId: user.id,
            createdAt: new Date().toISOString(),
          },
        },
      });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByTestId('chat-history-loading')).toHaveCount(0);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: 450 });
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Visible with the keyboard open');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const bubble = page
    .getByTestId('chat-history')
    .getByText('Visible with the keyboard open', { exact: true });
  const aboveComposer = async () => {
    const message = await bubble.boundingBox();
    const input = await composer.boundingBox();
    const list = await page.getByTestId('chat-history').boundingBox();
    return (
      !!message && !!input && !!list && message.y >= list.y && message.y + message.height <= input.y
    );
  };
  await expect.poll(aboveComposer).toBe(true);
  // Further keyboard/composer reflow can occur after the first send frame.
  await page.setViewportSize({ width: viewport.width, height: 390 });
  await expect.poll(aboveComposer).toBe(true);
  await confirm();
  await expect(page.getByTestId('message-keyboard-confirmed')).toBeVisible();
  await expect.poll(aboveComposer).toBe(true);
  await page.setViewportSize(viewport);
  await expect.poll(aboveComposer).toBe(true);
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

test('failed replies remain in failed bubbles and retry with their original target', async ({
  page,
}) => {
  await mockApi(page);
  await mockRealtime(page);
  let attempts = 0;
  await page.route('**/api/conversations/*/messages', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    attempts++;
    if (attempts === 1)
      return route.fulfill({ status: 400, json: { error: 'Reply target is unavailable' } });
    expect(route.request().postDataJSON()).toEqual({
      text: 'Keep this draft',
      replyToMessageId: first.id,
    });
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
  await expect(page.getByLabel('Message failed to send', { exact: true })).toBeVisible();
  await expect(page.getByTestId('reply-composer')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  await page.getByTestId('chat-history').getByText('Keep this draft', { exact: true }).click();
  await page.getByRole('button', { name: 'Retry sending', exact: true }).click();
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

test('API unread counts decrease as visible messages are read, persist seen positions, and recover another client on refresh without polling', async ({
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
    expect(listCalls).toBe(before);
    await page.getByRole('button', { name: 'Refresh conversations', exact: true }).click();
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
    // The outbox retains the confirmed message even while latest history is pending.
    await expect(page.getByTestId(`message-${sent.id}`)).toBeVisible();
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

test('opening reveals history already at last seen without an animated scroll', async ({
  page,
}) => {
  const history = Array.from({ length: 201 }, (_, index) => ({
    ...first,
    id: `position-${index}`,
    text: `Position message ${index}\n${'More text\n'.repeat(index % 4)}`,
    createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
  }));
  await mockApi(page, history);
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({
      json: {
        conversations: [{ ...chat, lastSeenMessageId: 'position-100', unreadCount: 100 }],
      },
    }),
  );
  let releaseHistory!: () => Promise<void>;
  await page.route('**/messages/position-100/around?*', (route) => {
    releaseHistory = () =>
      route.fulfill({
        json: {
          message: history[100],
          before: history.slice(50, 100),
          after: history.slice(101, 151),
          hasMoreBefore: true,
          hasMoreAfter: true,
        },
      });
  });
  await signIn(page);
  await page.evaluate(() => {
    const state = { scrolls: [] as string[], revealed: false, targetVisibleOnReveal: false };
    (window as unknown as { __historyOpening: typeof state }).__historyOpening = state;
    const scroll = Element.prototype.scroll;
    Element.prototype.scroll = function (this: Element, ...args: unknown[]) {
      if (this.getAttribute('data-testid') === 'chat-history') {
        state.scrolls.push((args[0] as ScrollToOptions)?.behavior ?? 'auto');
      }
      Reflect.apply(scroll, this, args);
    } as Element['scroll'];
    const check = () => {
      const container = document.querySelector('[data-testid="positioned-chat-history"]');
      if (container && getComputedStyle(container).opacity === '1') {
        state.revealed = true;
        const viewport = document
          .querySelector('[data-testid="chat-history"]')
          ?.getBoundingClientRect();
        const target = document
          .querySelector('[data-testid="message-position-100"]')
          ?.getBoundingClientRect();
        state.targetVisibleOnReveal =
          !!viewport && !!target && target.bottom > viewport.top && target.top < viewport.bottom;
      } else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByTestId('chat-history-loading')).toBeVisible();
  await expect(page.getByTestId('positioned-chat-history')).toHaveCSS('opacity', '0');
  await expect.poll(() => !!releaseHistory).toBe(true);
  await releaseHistory();
  await expect(page.getByTestId('chat-history-loading')).toHaveCount(0);
  await expect(page.getByTestId('positioned-chat-history')).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('message-position-100')).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __historyOpening: { revealed: boolean } }).__historyOpening
            .revealed,
      ),
    )
    .toBe(true);
  const result = await page.evaluate(
    () =>
      (
        window as unknown as {
          __historyOpening: { scrolls: string[]; targetVisibleOnReveal: boolean };
        }
      ).__historyOpening,
  );
  expect(result.targetVisibleOnReveal).toBe(true);
  expect(result.scrolls.length).toBeGreaterThan(0);
  expect(result.scrolls).not.toContain('smooth');
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
      const previousHeight = await list.evaluate((element) => element.scrollHeight);
      await list.dispatchEvent('wheel', { deltaY: -500, bubbles: true });
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect.poll(() => batches).toContain(`older-${edge}`);
      // Wait for the returned batch to affect layout before the next gesture.
      await expect(page.getByLabel('Loading more messages', { exact: true })).toHaveCount(0);
      await expect
        .poll(() => list.evaluate((element) => element.scrollHeight))
        .toBeGreaterThan(previousHeight + 500);
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
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({
      json: {
        conversations: [{ ...chat, lastSeenMessageId: first.id, unreadCount: 0 }],
      },
    }),
  );
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
  await page.getByRole('button', { name: 'Download voice message', exact: true }).click();
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

test('document messages download on demand, retry, cancel, and save original bytes and filename', async ({
  page,
}, testInfo) => {
  const mediaId = 'download-document';
  const fileName = 'PhoneticsPhonology2018-Preface.docx';
  const bytes = Buffer.from('original document bytes');
  const metadata = {
    id: mediaId,
    type: 'document',
    fileName,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: bytes.length,
  };
  let downloads = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockApi(page, [{ ...first, text: null, attachment: { type: 'document', mediaId } }]);
  await page.route(`**/api/conversations/*/attachments/${mediaId}/metadata`, (route) =>
    route.fulfill({ json: { attachment: metadata } }),
  );
  await page.route(`**/api/conversations/*/attachments/${mediaId}`, async (route) => {
    const attempt = ++downloads;
    if (attempt === 1) return route.fulfill({ status: 503 });
    if (attempt === 2) await held;
    return route.fulfill({ contentType: 'application/octet-stream', body: bytes });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const row = page.getByTestId(`document-message-${mediaId}`);
  await expect(row.getByText(fileName, { exact: true })).toBeVisible();
  await expect(row.getByText(`${bytes.length} B`, { exact: true })).toBeVisible();
  expect(downloads).toBe(0);
  await row.getByRole('button', { name: 'Download document', exact: true }).click();
  await expect(row.getByText('Tap to retry')).toBeVisible();
  await row.getByRole('button', { name: 'Download document', exact: true }).click();
  await expect.poll(() => downloads).toBe(2);
  await expect(row.getByText(`0 B / ${bytes.length} B`, { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Cancel document download', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Download document', exact: true })).toBeVisible();
  release();
  await row.getByRole('button', { name: 'Download document', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Save document', exact: true })).toBeVisible();
  const saved = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Save document', exact: true }).click();
  const file = await saved;
  expect(file.suggestedFilename()).toBe(fileName);
  expect(readFileSync((await file.path())!)).toEqual(bytes);
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(row.getByRole('button', { name: 'Save document', exact: true })).toBeVisible();
  expect(downloads).toBe(3);
});

test('uncached voice messages wait for a download click and reuse the cached download on return', async ({
  page,
}, testInfo) => {
  const mediaId = 'delayed-voice';
  let downloads = 0;
  let finishDownload!: () => void;
  const held = new Promise<void>((resolve) => {
    finishDownload = resolve;
  });
  await mockApi(page, [{ ...first, text: null, attachment: { type: 'voice', mediaId } }]);
  await page.route(`**/api/conversations/*/attachments/${mediaId}`, async (route) => {
    downloads++;
    await held;
    return route.fulfill({
      path: path.join(__dirname, '../fixtures/voice.ogg'),
      contentType: 'audio/ogg',
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByRole('button', { name: 'Download voice message' })).toBeVisible();
  expect(downloads).toBe(0);
  await page.getByRole('button', { name: 'Download voice message' }).click();
  await expect(page.getByRole('button', { name: 'Cancel voice download' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play voice message' })).toHaveCount(0);
  await expect.poll(() => downloads).toBe(1);
  finishDownload();
  await expect(page.getByRole('button', { name: 'Play voice message' })).toBeVisible();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByRole('button', { name: 'Play voice message' })).toBeVisible();
  expect(downloads).toBe(1);
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
    if (kind === 'voice')
      await page.getByRole('button', { name: 'Download voice message', exact: true }).click();
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
    const open = () => page.getByRole('button', { name: 'Message actions', exact: true }).click();
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

for (const outgoing of [false, true]) {
  test(`${outgoing ? 'outgoing' : 'incoming'} reaction badges highlight my reactions and toggle independently`, async ({
    page,
  }) => {
    await mockApi(page, [
      {
        ...first,
        senderId: outgoing ? user.id : friend.id,
        reactions: [
          { userId: friend.id, emoji: '👍' },
          { userId: user.id, emoji: '❤️' },
        ],
      },
    ]);
    const changes: { method: string; emoji: string }[] = [];
    await page.route('**/api/conversations/*/messages/*/reactions', (route) => {
      changes.push({
        method: route.request().method(),
        emoji: route.request().postDataJSON().emoji,
      });
      return route.fulfill({ json: {} });
    });
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    const bubble = page.getByTestId(`message-${first.id}`);
    const addThumb = bubble.getByRole('button', { name: 'Add 👍 reaction', exact: true });
    const removeThumb = bubble.getByRole('button', { name: 'Remove 👍 reaction', exact: true });
    const removeHeart = bubble.getByRole('button', { name: 'Remove ❤️ reaction', exact: true });
    await expect(addThumb).toHaveAttribute('aria-selected', 'false');
    await expect(removeHeart).toHaveAttribute('aria-selected', 'true');
    const unselectedColor = await addThumb.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    const selectedColor = await removeHeart.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    expect(selectedColor).not.toBe(unselectedColor);

    await addThumb.click();
    await expect(removeThumb).toHaveText('👍 2');
    await expect(removeThumb).toHaveCSS('background-color', selectedColor);
    await expect(removeHeart).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('message-options')).toHaveCount(0);

    await removeThumb.click();
    await expect(addThumb).toHaveText('👍 1');
    await expect(addThumb).toHaveCSS('background-color', unselectedColor);
    await removeHeart.click();
    await expect(removeHeart).toHaveCount(0);
    await expect(bubble.getByText('❤️ 1', { exact: true })).toHaveCount(0);
    expect(changes).toEqual([
      { method: 'PUT', emoji: '👍' },
      { method: 'DELETE', emoji: '👍' },
      { method: 'DELETE', emoji: '❤️' },
    ]);
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
  await expect(page.getByText('User details', { exact: true })).toBeVisible();
  await expect(page.getByText('MEMBERS', { exact: true })).toHaveCount(0);
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
  await expect(
    page
      .getByTestId(`conversation-${chat.id}`)
      .getByText('Forwarded from Grace Live', { exact: true }),
  ).toBeVisible();
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
  await expectMediaBubble(page, card);
  await expect(card.getByRole('img', { name: 'Video thumbnail' })).toBeVisible();
  await expect(card.locator('[style*="background-image"]')).toHaveCSS('background-size', 'cover');
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
    await expect(page.getByTestId('notification')).toHaveCount(0);
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
    let thumbnailDownloads = 0;
    const attachment = kind === 'gif' ? { type: kind, gifId: mediaId } : { type: kind, mediaId };
    await mockApi(page, [{ ...first, text: null, attachment }]);
    const thumbnailUrl = 'https://media.example/server-thumbnail.jpg';
    await page.route('https://media.example/server-thumbnail.jpg', async (route) => {
      thumbnailDownloads++;
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
        .toBeCloseTo(360 / 640, 2);
      if (kind !== 'image') {
        await expect.poll(() => thumbnailDownloads).toBe(1);
      }
      if (kind === 'video') {
        expect(originalDownloads).toBe(0);
        await expect(frame.locator('video')).toHaveCount(0);
      }
      releaseMedia();
      if (kind === 'video')
        await expect(
          page.getByRole('img', { name: 'Video thumbnail', exact: true }),
        ).toHaveAttribute('src', /^blob:/);
      if (kind === 'gif') {
        await expect
          .poll(() =>
            frame
              .locator('video')
              .evaluate((video: HTMLVideoElement) => video.readyState >= 2 && !video.paused),
          )
          .toBe(true);
        await expect(page.getByRole('img', { name: 'GIF thumbnail', exact: true })).toHaveCount(0);
        await expect(frame.locator('video')).toHaveCSS('object-fit', 'cover');
      }
      await expect
        .poll(async () => {
          const box = await frame.boundingBox();
          return box ? box.width / box.height : 0;
        })
        .toBeCloseTo(360 / 640, 2);
    } finally {
      releaseMetadata();
      releaseMedia();
    }
  });
}

test('video thumbnail URLs renew from cached metadata without downloading the video', async ({
  page,
}, testInfo) => {
  await page.clock.install();
  let lookups = 0;
  let downloads = 0;
  let thumbnailDownloads = 0;
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
  await page.route('https://media.example/renewing-thumb.jpg*', (route) => {
    thumbnailDownloads++;
    return route.fulfill({
      path: path.join(__dirname, '../fixtures/portrait.png'),
      contentType: 'image/jpeg',
    });
  });
  await page.route(`**/api/conversations/*/attachments/${mediaId}`, (route) => {
    downloads++;
    return route.fulfill({ status: 500 });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const thumbnail = page.getByRole('img', { name: 'Video thumbnail', exact: true });
  await expect(thumbnail).toHaveAttribute('src', /^blob:/);
  const cachedSource = await thumbnail.getAttribute('src');
  await page.clock.fastForward(10 * 60 * 1000 + 1000);
  await expect.poll(() => lookups).toBe(2);
  await expect(thumbnail).toHaveAttribute('src', cachedSource!);
  expect(lookups).toBe(2);
  expect(thumbnailDownloads).toBe(1);
  expect(downloads).toBe(0);
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByRole('img', { name: 'Video thumbnail', exact: true })).toHaveAttribute(
    'src',
    cachedSource!,
  );
  expect(thumbnailDownloads).toBe(1);
});

test('GIF thumbnails reuse cached bytes after returning to the chat', async ({
  page,
}, testInfo) => {
  const gifId = 'cached-gif-thumbnail';
  const thumbnailUrl = 'https://media.example/cached-gif-thumbnail.jpg';
  let thumbnailDownloads = 0;
  await mockApi(page, [
    {
      ...first,
      text: null,
      attachment: { type: 'gif', gifId },
      attachmentMetadata: {
        id: gifId,
        objectKey: 'gifs/cached.mp4',
        fileSize: 100,
        width: 120,
        height: 200,
        createdAt: first.createdAt,
        playbackUrl: 'https://media.example/unavailable-gif.mp4',
        thumbnailUrl,
      },
    },
  ]);
  await page.route(thumbnailUrl, (route) => {
    thumbnailDownloads++;
    return route.fulfill({
      path: path.join(__dirname, '../fixtures/portrait.png'),
      contentType: 'image/jpeg',
    });
  });
  await page.route('https://media.example/unavailable-gif.mp4', (route) => route.abort());
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const thumbnail = page.getByRole('img', { name: 'GIF thumbnail', exact: true });
  await expect(thumbnail).toHaveAttribute('src', /^blob:/);
  const cachedSource = await thumbnail.getAttribute('src');
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByRole('img', { name: 'GIF thumbnail', exact: true })).toHaveAttribute(
    'src',
    cachedSource!,
  );
  expect(thumbnailDownloads).toBe(1);
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
  await expectMediaBubble(page, card);
  await expect(card.getByRole('button', { name: 'Play video', exact: true })).toBeVisible();
  const box = (await card.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(1, 2);
  await expect(card.getByRole('img', { name: 'Video thumbnail', exact: true })).toHaveCount(0);
  await expect(card.locator('video')).toHaveCount(0);
  expect(downloads).toBe(0);
});

for (const selection of [
  'image',
  'image-wide',
  'image-tall',
  'image-small',
  'video',
  'document',
  'audio',
  'typescript',
] as const) {
  test(`uploaded ${selection} attachments reuse local bytes for previews, playback, saving, and reopening`, async ({
    page,
  }, testInfo) => {
    const kind =
      selection === 'typescript' ? 'document' : selection.startsWith('image') ? 'image' : selection;
    const imageSize =
      selection === 'image-wide'
        ? [4000, 2000]
        : selection === 'image-tall'
          ? [2000, 4000]
          : selection === 'image-small'
            ? [64, 32]
            : undefined;
    await mockApi(page, []);
    if (kind === 'image')
      await page.addInitScript(() => {
        const toBlob = HTMLCanvasElement.prototype.toBlob;
        (window as any).__imageEncodings = [];
        HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
          (window as any).__imageEncodings.push({ type, quality });
          return toBlob.call(this, callback, type, quality);
        };
      });
    let downloads = 0;
    const id = `uploaded-${kind}`;
    const name =
      selection === 'typescript'
        ? 'example.ts'
        : kind === 'image'
          ? imageSize
            ? 'uploaded.jpeg'
            : 'uploaded.png'
          : kind === 'video'
            ? 'uploaded.mp4'
            : kind === 'audio'
              ? 'sound.mp3'
              : 'notes.txt';
    const mimeType =
      selection === 'typescript'
        ? 'video/mp2t'
        : kind === 'image'
          ? imageSize
            ? 'image/jpeg'
            : 'image/png'
          : kind === 'video'
            ? 'video/mp4'
            : kind === 'audio'
              ? 'audio/mpeg'
              : 'text/plain';
    const buffer = imageSize
      ? Buffer.from(
          await page.evaluate(([width, height]) => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d')!;
            context.fillStyle = '#3390EC';
            context.fillRect(0, 0, width, height);
            return Array.from(atob(canvas.toDataURL('image/jpeg', 1).split(',')[1]), (char) =>
              char.charCodeAt(0),
            );
          }, imageSize),
        )
      : kind === 'image'
        ? readFileSync(path.join(__dirname, '../fixtures/portrait.png'))
        : kind === 'video'
          ? readFileSync(path.join(__dirname, '../fixtures/portrait.mp4'))
          : Buffer.from('original uploaded bytes');
    if (imageSize) {
      const jfif = buffer.indexOf(Buffer.from('JFIF\0'));
      expect(jfif).toBeGreaterThan(0);
      buffer[jfif + 7] = 1;
      buffer.writeUInt16BE(selection === 'image-small' ? 72 : 300, jfif + 8);
      buffer.writeUInt16BE(selection === 'image-small' ? 48 : 300, jfif + 10);
    }
    const uploadName = kind === 'image' ? 'uploaded.jpg' : name;
    const uploadMime = kind === 'image' ? 'image/jpeg' : mimeType;
    let uploadedBytes: Buffer;
    await page.route('**/api/conversations/*/attachments', async (route) => {
      expect(route.request().method()).toBe('POST');
      const multipart = route.request().postDataBuffer()!.toString();
      if (kind === 'document') expect(multipart).toContain('name="kind"\r\n\r\ndocument');
      else if (kind === 'audio') expect(multipart).toContain('name="kind"\r\n\r\nmusic');
      else expect(multipart).not.toContain('name="kind"');
      const form = await new Response(new Uint8Array(route.request().postDataBuffer()!), {
        headers: { 'Content-Type': route.request().headers()['content-type'] },
      }).formData();
      const uploaded = (form as unknown as { get(name: string): File }).get('file');
      expect(uploaded.name).toBe(uploadName);
      expect(uploaded.type).toBe(uploadMime);
      uploadedBytes = Buffer.from(await uploaded.arrayBuffer());
      if (kind === 'image') {
        expect(uploadedBytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
        expect(uploadedBytes.equals(buffer)).toBe(false);
        expect(imageDensity(uploadedBytes)).toEqual(
          selection === 'image-small' ? { x: 72, y: 48 } : { x: 96, y: 96 },
        );
      }
      return route.fulfill({
        status: 201,
        json: {
          attachment: {
            id,
            type: kind,
            fileName: uploadName,
            contentType: uploadMime,
            fileSize: uploadedBytes.length,
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
    const message = page.getByTestId('message-44444444-4444-4444-8444-444444444444');
    await expect(message).toBeVisible();
    if (kind === 'image') {
      expect(await page.evaluate(() => (window as any).__imageEncodings)).toContainEqual({
        type: 'image/jpeg',
        quality: 0.87,
      });
      await expect(message.locator('img')).toHaveAttribute('src', /^blob:/);
      const cached = await message.locator('img').evaluate(async (image: HTMLImageElement) => {
        const response = await fetch(image.src);
        const blob = await response.blob();
        return { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
      });
      expect(cached.type).toBe('image/jpeg');
      expect(Buffer.from(cached.bytes)).toEqual(uploadedBytes!);
      await expect
        .poll(() =>
          message.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth > 0),
        )
        .toBeTruthy();
      const dimensions = await message.locator('img').evaluate((image: HTMLImageElement) => ({
        width: image.naturalWidth,
        height: image.naturalHeight,
      }));
      expect(dimensions.width).toBeLessThanOrEqual(1280);
      expect(dimensions.height).toBeLessThanOrEqual(1280);
      if (imageSize) {
        const scale = Math.min(1, 1280 / Math.max(...imageSize));
        expect(dimensions).toEqual({
          width: Math.round(imageSize[0] * scale),
          height: Math.round(imageSize[1] * scale),
        });
      }
    }
    if (kind === 'document') {
      await expect(message.getByText(name, { exact: true })).toBeVisible();
      const saved = page.waitForEvent('download');
      await message.getByRole('button', { name: 'Save document', exact: true }).click();
      expect((await saved).suggestedFilename()).toBe(name);
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
    const savedFile = await saved;
    expect(savedFile.suggestedFilename()).toBe(uploadName);
    expect(readFileSync((await savedFile.path())!)).toEqual(uploadedBytes!);
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

test('voice downloads can be cancelled and retried without starting playback', async ({
  page,
}, testInfo) => {
  const mediaId = 'cancel-voice';
  let downloads = 0;
  let finishDownload!: () => void;
  const held = new Promise<void>((resolve) => {
    finishDownload = resolve;
  });
  await mockApi(page, [{ ...first, text: null, attachment: { type: 'voice', mediaId } }]);
  await page.route(`**/api/conversations/*/attachments/${mediaId}`, async (route) => {
    downloads++;
    await held;
    await route
      .fulfill({
        path: path.join(__dirname, '../fixtures/voice.ogg'),
        contentType: 'audio/ogg',
      })
      .catch(() => {});
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const cancel = page.getByRole('button', { name: 'Cancel voice download', exact: true });
  await page.getByRole('button', { name: 'Download voice message', exact: true }).click();
  await expect(cancel).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Voice download progress' })).toHaveAttribute(
    'aria-valuenow',
    '1',
  );
  await expect.poll(() => downloads).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('voice-download-ring.png') });
  await cancel.click();
  const download = page.getByRole('button', { name: 'Download voice message', exact: true });
  await expect(download).toBeVisible();
  await expect(page.getByText('Download cancelled', { exact: true })).toHaveCount(0);
  await download.click();
  await expect(cancel).toBeVisible();
  await expect.poll(() => downloads).toBe(2);
  finishDownload();
  const completionStarted = Date.now();
  const complete = page.getByRole('button', { name: 'Voice download complete', exact: true });
  await expect(complete).toBeDisabled();
  const completedRing = page.getByRole('progressbar', { name: 'Voice download progress' });
  await expect(completedRing).toHaveAttribute('aria-valuenow', '100');
  await expect(completedRing.locator('circle')).toHaveAttribute('stroke-dashoffset', '0');
  await expect(page.getByRole('button', { name: 'Play voice message', exact: true })).toBeVisible();
  expect(Date.now() - completionStarted).toBeGreaterThanOrEqual(1000);
  await expect(page.getByTestId('voice-icon-play')).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('voice-icon-close')).toHaveCSS('opacity', '0');
  await expect(page.getByRole('button', { name: 'Pause voice message', exact: true })).toHaveCount(
    0,
  );
});

test('voice download progress animates a partial ring without a background or DOM property errors', async ({
  page,
}, testInfo) => {
  const bytes = readFileSync(path.join(__dirname, '../fixtures/voice.ogg'));
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  let finishDownload!: () => void;
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'audio/ogg',
      'Content-Length': bytes.length,
    });
    const half = Math.floor(bytes.length / 2);
    response.write(bytes.subarray(0, half));
    finishDownload = () => response.end(bytes.subarray(half));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await mockApi(
      page,
      [{ ...first, text: null, attachment: { type: 'voice', mediaId: 'streamed-voice' } }],
      origin,
    );
    await page.route(`${origin}/api/conversations/*/attachments/streamed-voice`, (route) =>
      route.continue(),
    );
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    await page.evaluate(() => {
      const offsets: number[] = [];
      Object.assign(window, { __voiceRingOffsets: offsets });
      new MutationObserver((records) => {
        for (const record of records) {
          const element = record.target as Element;
          if (element.tagName.toLowerCase() === 'circle') {
            const offset = element.getAttribute('stroke-dashoffset');
            if (offset !== null) offsets.push(Number(offset));
          }
        }
      }).observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['stroke-dashoffset'],
      });
    });
    await page.getByRole('button', { name: 'Download voice message', exact: true }).click();
    const progress = page.getByRole('progressbar', { name: 'Voice download progress' });
    await expect(progress).toHaveAttribute('aria-valuenow', /^(49|50)$/);
    await expect(progress.locator('circle')).toHaveCount(1);
    const initialRotation = await progress.evaluate(
      (element) => getComputedStyle(element).transform,
    );
    await expect
      .poll(() => progress.evaluate((element) => getComputedStyle(element).transform))
      .not.toBe(initialRotation);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const offsets = (window as unknown as { __voiceRingOffsets: number[] })
            .__voiceRingOffsets;
          return new Set(offsets.filter((value) => value > 58 && value < 112)).size;
        }),
      )
      .toBeGreaterThan(2);
    await expect(progress.locator('circle').last()).toHaveAttribute(
      'transform',
      'rotate(-90 21 21)',
    );
    await page.screenshot({ path: testInfo.outputPath('voice-partial-download-ring.png') });
    finishDownload();
    await expect(
      page.getByRole('button', { name: 'Play voice message', exact: true }),
    ).toBeVisible();
    expect(errors.filter((error) => /Invalid DOM property|transform-origin/.test(error))).toEqual(
      [],
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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
  await page.getByRole('button', { name: 'Download voice message', exact: true }).click();
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
  await page.route('**/api/conversations/*/messages', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      json: {
        message: {
          ...first,
          text: null,
          ...route.request().postDataJSON(),
          id: '44444444-4444-4444-8444-444444444444',
          senderId: user.id,
          createdAt: '2026-10-18T12:02:00Z',
        },
      },
    });
  });
  await mockMicrophone(page);
  await page.route('**/api/conversations/*/attachments/reply-voice', (route) =>
    route.fulfill({
      path: path.join(__dirname, '../fixtures/voice.ogg'),
      contentType: 'audio/ogg',
    }),
  );
  let finishUpload: (() => void) | undefined;
  let uploads = 0;
  let downloads = 0;
  await page.route('**/api/conversations/*/attachments', async (route) => {
    uploads++;
    const body = route.request().postDataBuffer()!.toString('latin1');
    expect(body).toContain('name="kind"\r\n\r\nvoice');
    expect(body).toContain('name="file"');
    expect(body).toContain('audio/webm');
    await new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
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
  const uploading = page.getByTestId('upload-file');
  await expect(uploading).toBeVisible();
  const uploadSize = (await uploading.boundingBox())!;
  const uploadBubbleSize = (await uploading.locator('..').boundingBox())!;
  const uploadSeekSize = (await uploading
    .getByLabel('Voice message progress', { exact: true })
    .boundingBox())!;
  await expect.poll(() => !!finishUpload).toBe(true);
  finishUpload!();
  expect((await sent).postDataJSON()).toEqual({
    attachment: { type: 'voice', mediaId: 'recorded-voice' },
    replyToMessageId: first.id,
  });
  const voice = page.getByTestId('voice-player').last();
  await expect(voice).toBeVisible();
  const completedSize = (await voice.boundingBox())!;
  const completedBubbleSize = (await voice.locator('..').boundingBox())!;
  const completedSeekSize = (await voice
    .getByLabel('Voice message progress', { exact: true })
    .boundingBox())!;
  expect(uploadSize.width).toBeCloseTo(completedSize.width, 0);
  expect(uploadSize.height).toBeCloseTo(completedSize.height, 0);
  expect(uploadBubbleSize.width).toBeCloseTo(completedBubbleSize.width, 0);
  expect(uploadBubbleSize.height).toBeCloseTo(completedBubbleSize.height, 0);
  expect(uploadSeekSize.width).toBeCloseTo(completedSeekSize.width, 0);
  expect(uploadSeekSize.y - uploadSize.y).toBeCloseTo(completedSeekSize.y - completedSize.y, 0);
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

test('swiping up locks voice recording until Cancel or Send, including touch gestures', async ({
  page,
}, testInfo) => {
  await mockApi(page);
  await mockMicrophone(page);
  let uploads = 0;
  await page.route('**/api/conversations/*/attachments', (route) => {
    uploads++;
    return route.fulfill({
      status: 201,
      json: {
        attachment: {
          id: 'locked-voice',
          type: 'voice',
          fileName: 'voice.ogg',
          contentType: 'audio/ogg',
          fileSize: 1234,
        },
      },
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const cdp =
    testInfo.project.name === 'mobile' ? await page.context().newCDPSession(page) : undefined;
  for (const action of ['Cancel', 'Send']) {
    const mic = page.getByRole('button', { name: 'Hold to record voice message', exact: true });
    const box = (await mic.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
    }
    await expect(page.getByText('Slide up to lock')).toBeVisible();
    await page.waitForTimeout(350);
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - 90 }],
      });
    } else await page.mouse.move(x, y - 90, { steps: 5 });
    const send = page.getByRole('button', { name: 'Send voice message', exact: true });
    await expect(send).toBeVisible();
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.mouse.up();
    await expect(send).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeHidden();
    await expect(page.getByText('0:01', { exact: true })).toBeVisible();
    expect(uploads).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`locked-recording-${action}.png`) });
    if (action === 'Cancel') {
      await page.getByRole('button', { name: 'Cancel voice recording' }).click();
    } else {
      const sent = page.waitForRequest(
        (request) => request.url().endsWith('/messages') && request.method() === 'POST',
      );
      await send.click();
      expect((await sent).postDataJSON()).toEqual({
        attachment: { type: 'voice', mediaId: 'locked-voice' },
      });
    }
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable();
    await expect(mic).toBeVisible();
  }
  expect(uploads).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __voiceMicrophone: { stopped: number } }).__voiceMicrophone
            .stopped,
      ),
    )
    .toBe(2);
  await cdp?.detach();
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

test('message editing saves text, preserves drafts, handles errors, and applies live edits', async ({
  page,
}) => {
  const own = {
    ...first,
    id: 'own-message',
    senderId: user.id,
    text: 'My original text',
    createdAt: '2026-10-18T12:02:00Z',
  };
  const reply = {
    ...first,
    id: 'reply-message',
    text: 'A reply',
    replyToMessageId: own.id,
    createdAt: '2026-10-18T12:03:00Z',
  };
  await mockApi(page, [first, own, reply]);
  const realtime = await mockRealtime(page);
  let fail = true;
  const edits: unknown[] = [];
  await page.route(`**/api/conversations/${chat.id}/messages/${own.id}`, async (route) => {
    expect(route.request().method()).toBe('PATCH');
    expect(route.request().headers().authorization).toBe('Bearer access-token');
    const body = route.request().postDataJSON();
    edits.push(body);
    if (fail) return route.fulfill({ status: 403, json: { error: 'Editing is unavailable' } });
    return route.fulfill({ json: { message: { ...own, text: body.text, isEdited: true } } });
  });
  await signIn(page);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Keep my unsent draft');
  await page
    .getByTestId(`message-${first.id}`)
    .getByRole('button', { name: 'Message actions', exact: true })
    .click();
  await expect(
    page.getByTestId('message-options').getByRole('button', { name: 'Edit', exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  const openEdit = async () => {
    await page
      .getByTestId(`message-${own.id}`)
      .getByRole('button', { name: 'Message actions', exact: true })
      .click();
    await page
      .getByTestId('message-options')
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
  };
  await openEdit();
  const editor = page.getByRole('textbox', { name: 'Edit message text' });
  await expect(editor).toHaveValue(own.text);
  await editor.fill('Cancelled change');
  await page.getByRole('button', { name: 'Cancel edit', exact: true }).click();
  await expect(composer).toHaveValue('Keep my unsent draft');
  await openEdit();
  await editor.fill('   ');
  await expect(page.getByRole('button', { name: 'Save message edit' })).toBeDisabled();
  await editor.fill('  My corrected text  ');
  await page.getByRole('button', { name: 'Save message edit' }).click();
  await expect(page.getByText('Editing is unavailable', { exact: true })).toBeVisible();
  await expect(editor).toHaveValue('  My corrected text  ');
  fail = false;
  await page.getByRole('button', { name: 'Save message edit' }).click();
  await expect(editor).toHaveCount(0);
  const bubble = page.getByTestId(`message-${own.id}`);
  await expect(bubble.getByText('My corrected text', { exact: true })).toBeVisible();
  await expect(bubble.getByText(/^edited /)).toBeVisible();
  await expect(composer).toHaveValue('Keep my unsent draft');
  expect(edits).toEqual([{ text: 'My corrected text' }, { text: 'My corrected text' }]);
  realtime.emit('message.updated', {
    isEdited: true,
    conversationId: chat.id,
    messageId: own.id,
    text: 'Live correction',
  });
  await expect(bubble.getByText('Live correction', { exact: true })).toBeVisible();
  await expect(
    page.getByTestId('message-reply-message').getByText('Live correction', { exact: true }),
  ).toBeVisible();
  realtime.emit('message.updated', {
    isEdited: true,
    conversationId: chat.id,
    messageId: first.id,
    text: 'Friend corrected this',
  });
  await expect(
    page.getByTestId(`message-${first.id}`).getByText('Friend corrected this', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId(`message-${first.id}`).getByText(/^edited /)).toBeVisible();
});

test('persisted edited marks render on initial history and after reload', async ({ page }) => {
  const edited = { ...first, isEdited: true };
  const original = {
    ...first,
    id: 'original-message',
    text: 'Never edited',
    createdAt: '2026-10-18T12:02:00Z',
  };
  await mockApi(page, [edited, original]);
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const marked = page.getByTestId(`message-${edited.id}`).getByText(/^edited /);
  await expect(marked).toHaveCount(1);
  await expect(page.getByTestId(`message-${original.id}`).getByText(/^edited /)).toHaveCount(0);
  await page.reload();
  await expect(marked).toHaveCount(1);
});

test('failed icon font downloads show a retry screen and recover without refreshing', async ({
  page,
}) => {
  await mockApi(page);
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));
  const fontUrl = /Ionicons[^?]*\.ttf/;
  await page.route(fontUrl, (route) => route.abort());
  await page.goto('/');
  await expect(
    page.getByText('Could not load app icons. Check your connection and try again.'),
  ).toBeVisible();
  await page.unroute(fontUrl);
  await page.getByRole('button', { name: 'Retry loading icons' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(uncaught).toEqual([]);
});

test('switching conversations retains the mounted history, exact reading position, drafts and background edits', async ({
  page,
}, testInfo) => {
  const history = Array.from({ length: 101 }, (_, index) => ({
    ...first,
    id: `retained-${index}`,
    text: `Retained message ${index}`,
    createdAt: new Date(Date.parse(first.createdAt) + index * 1000).toISOString(),
  }));
  const other = { ...chat, id: 'other-conversation', name: 'Other conversation' };
  await mockApi(page, history);
  const realtime = await mockRealtime(page);
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({
      json: {
        conversations: [{ ...chat, lastSeenMessageId: 'retained-50', unreadCount: 50 }, other],
      },
    }),
  );
  await page.route(`**/api/conversations/${other.id}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith('/members')
        ? { members: [{ userId: user.id, conversationId: other.id, role: 'owner' }] }
        : path.endsWith('/first')
          ? { message: null }
          : path.endsWith('/seen')
            ? { lastSeenMessageId: null, unreadCount: 0 }
            : { messages: [], nextCursor: null },
    });
  });
  let historyRequests = 0;
  await page.route(`**/api/conversations/${chat.id}/messages/**`, (route) => {
    if (route.request().method() === 'GET') historyRequests++;
    return route.fallback();
  });
  await signIn(page);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const screen = page.getByTestId(`conversation-${chat.id}`);
  const list = screen.getByTestId('chat-history');
  await expect(screen.getByTestId('chat-history-loading')).toHaveCount(0);
  await expect(screen.getByTestId('message-retained-50')).toBeInViewport();
  // Move away from last seen and save the actual DOM node, not just its data.
  await list.dispatchEvent('wheel', { deltaY: 280, bubbles: true });
  await list.evaluate((element) => {
    element.scrollTop += 280;
  });
  const draft = screen.getByRole('textbox', { name: 'Message', exact: true });
  await draft.fill('Retain my draft');
  const position = await list.evaluate((element) => {
    const viewport = element.getBoundingClientRect();
    const row = [...element.querySelectorAll<HTMLElement>('[data-testid^="message-row-"]')].find(
      (row) => {
        const box = row.getBoundingClientRect();
        return box.top >= viewport.top && box.bottom <= viewport.bottom;
      },
    )!;
    (window as any).__retainedList = element;
    return {
      offset: element.scrollTop,
      row: row.getAttribute('data-testid')!,
      top: row.getBoundingClientRect().top,
    };
  });
  const initialRequests = historyRequests;
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Other conversation' }).click();
  await expect(
    page
      .getByRole('button', { name: 'View conversation details' })
      .getByText('Other conversation', { exact: true }),
  ).toBeVisible();
  realtime.emit('message.updated', {
    conversationId: chat.id,
    messageId: 'retained-50',
    text: 'Edited while away',
    isEdited: true,
  });
  await expect(
    screen.getByTestId('message-retained-50').getByText('Edited while away', { exact: true }),
  ).toHaveCount(1);
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(screen).toHaveCSS('opacity', '1');
  expect(await list.evaluate((element) => element === (window as any).__retainedList)).toBe(true);
  await expect(screen.getByTestId('chat-history-loading')).toHaveCount(0);
  await expect(draft).toHaveValue('Retain my draft');
  expect(await list.evaluate((element) => element.scrollTop)).toBeCloseTo(position.offset, 0);
  expect((await screen.getByTestId(position.row).boundingBox())!.y).toBeCloseTo(position.top, 0);
  expect(historyRequests).toBe(initialRequests);
  // Settings also lives outside the retained chat layer.
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  expect(await list.evaluate((element) => element === (window as any).__retainedList)).toBe(true);
  expect(await list.evaluate((element) => element.scrollTop)).toBeCloseTo(position.offset, 0);
  await expect(draft).toHaveValue('Retain my draft');
  // New messages must not move the reading position in a hidden chat either.
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Other conversation' }).click();
  realtime.emit('message.created', {
    message: {
      ...first,
      id: 'background-arrival',
      text: 'Arrived while away',
      createdAt: '2026-10-19T12:00:00Z',
    },
  });
  await expect(page.getByText('Arrived while away', { exact: true }).first()).toBeAttached();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  expect((await screen.getByTestId(position.row).boundingBox())!.y).toBeCloseTo(position.top, 0);
  // A new app session starts from the saved seen position again.
  await page.reload();
  await expect(screen.getByTestId('message-retained-50')).toBeInViewport();
  await expect(draft).toHaveValue('');
});

test('image viewer opens full screen, reuses cached bytes, closes with Back, Escape and vertical swipes, and preserves message actions', async ({
  page,
}, testInfo) => {
  await mockApi(page, [{ ...first, attachment: { type: 'image', mediaId: 'viewer-photo' } }]);
  let downloads = 0;
  await page.route('**/api/conversations/*/attachments/viewer-photo', (route) => {
    downloads++;
    return route.fulfill({
      path: path.join(__dirname, '../fixtures/portrait.png'),
      contentType: 'image/png',
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const open = page.getByRole('button', { name: 'Open image attachment', exact: true });
  const viewer = page.getByTestId('image-viewer');
  await open.click();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole('img', { name: 'Full screen image' })).toBeVisible();
  await expect(viewer.getByText('Grace Hopper', { exact: true })).toBeVisible();
  await expect(page.getByTestId('message-options')).toHaveCount(0);
  const box = (await viewer.boundingBox())!;
  expect(box.width).toBe(page.viewportSize()!.width);
  expect(box.height).toBe(page.viewportSize()!.height);
  await expect(viewer.locator('[style*="background-image"]')).toHaveCSS(
    'background-size',
    'contain',
  );
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
  await page.screenshot({ path: testInfo.outputPath('image-viewer.png') });
  await viewer.getByRole('button', { name: 'Back to conversation' }).click();
  await expect(viewer).toHaveCount(0);
  await open.click();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  const cdp =
    testInfo.project.name === 'mobile' ? await page.context().newCDPSession(page) : undefined;
  for (const [dx, dy, closes] of [
    [5, 25, false],
    [140, 15, false],
    [5, -140, true],
    [5, 140, true],
  ] as const) {
    if (!(await viewer.count())) await open.click();
    const surface = (await page.getByTestId('image-viewer-surface').boundingBox())!;
    const x = surface.x + surface.width / 2,
      y = surface.y + surface.height / 2;
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + dx, y: y + dy }],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 5 });
      await page.mouse.up();
    }
    if (closes) await expect(viewer).toHaveCount(0);
    else await expect(viewer).toBeVisible();
  }
  await cdp?.detach();
  expect(downloads).toBe(1);
  // The surrounding message row keeps its original menu instead of opening media.
  await page.getByTestId(`message-row-${first.id}`).click({ position: { x: 2, y: 5 } });
  for (const name of ['Reply', 'Forward', 'Save attachment'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Close message options' })
    .click({ position: { x: 2, y: 2 } });
  await open.click();
  const saved = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'Save attachment', exact: true }).click();
  expect((await saved).suggestedFilename()).toBeTruthy();
  await expect(viewer).toBeVisible();
  await expect(page.getByTestId('message-options')).toHaveCount(0);
  expect(downloads).toBe(1);
  await viewer.getByRole('button', { name: 'Forward image' }).click();
  await expect(page.getByText('Forward to…', { exact: true })).toBeVisible();
});

for (const kind of ['image', 'gif'] as const) {
  test(`${kind} viewer zooms, pans, and only swipes closed at base zoom`, async ({
    page,
  }, testInfo) => {
    await mockApi(page, [
      {
        ...first,
        attachment:
          kind === 'image'
            ? { type: 'image', mediaId: 'zoom-photo' }
            : { type: 'gif', gifId: 'zoom-gif' },
      },
    ]);
    if (kind === 'gif')
      await page.route('**/api/gifs/zoom-gif', (route) =>
        route.fulfill({
          json: {
            gif: {
              id: 'zoom-gif',
              width: 360,
              height: 640,
              playbackUrl: 'https://media.example/zoom-gif.mp4',
              fileSize: 1000,
            },
          },
        }),
      );
    let downloads = 0;
    await page.route(
      kind === 'image'
        ? '**/api/conversations/*/attachments/zoom-photo'
        : 'https://media.example/zoom-gif.mp4',
      (route) => {
        downloads++;
        return route.fulfill({
          path: path.join(__dirname, `../fixtures/portrait.${kind === 'image' ? 'png' : 'mp4'}`),
          contentType: kind === 'image' ? 'image/png' : 'video/mp4',
        });
      },
    );
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    const open = page.getByRole('button', { name: `Open ${kind} attachment`, exact: true });
    await open.click();
    const viewer = page.getByTestId(`${kind}-viewer`);
    if (kind === 'image')
      await expect(viewer.getByRole('img', { name: 'Full screen image' })).toBeVisible();
    else
      await expect
        .poll(() =>
          viewer.locator('video').evaluate((video: HTMLVideoElement) => ({
            ready: video.readyState >= 2,
            playing: !video.paused,
            muted: video.muted,
            loop: video.loop,
            controls: video.controls,
            inline: video.playsInline,
          })),
        )
        .toEqual({
          ready: true,
          playing: true,
          muted: true,
          loop: true,
          controls: false,
          inline: true,
        });
    const surface = (await page.getByTestId(`${kind}-viewer-surface`).boundingBox())!;
    const x = surface.x + surface.width / 2;
    const y = surface.y + surface.height / 2;
    const transform = () =>
      page.getByTestId(`${kind}-viewer-transform`).evaluate((element) => {
        const matrix = new DOMMatrix(getComputedStyle(element).transform);
        return { scale: matrix.a, x: matrix.e, y: matrix.f };
      });
    const mobile = testInfo.project.name === 'mobile';
    const cdp = mobile ? await page.context().newCDPSession(page) : undefined;
    const doubleTap = async () => {
      if (mobile) {
        await page.touchscreen.tap(x, y);
        await page.touchscreen.tap(x, y);
      } else await page.mouse.dblclick(x, y);
    };
    const animatedDoubleTap = async (targetScale: number) => {
      const frames = page.getByTestId(`${kind}-viewer-transform`).evaluate(
        (element, target) =>
          new Promise<number[]>((resolve) => {
            const samples: number[] = [];
            const sample = () => {
              const scale = new DOMMatrix(getComputedStyle(element).transform).a;
              samples.push(scale);
              if (scale === target) resolve(samples);
              else requestAnimationFrame(sample);
            };
            sample();
          }),
        targetScale,
      );
      await doubleTap();
      expect((await frames).some((scale) => scale > 1 && scale < 2.5)).toBe(true);
    };
    const drag = async (dx: number, dy: number) => {
      if (cdp) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + dx, y: y + dy }],
        });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + dx, y + dy, { steps: 5 });
        await page.mouse.up();
      }
    };
    await animatedDoubleTap(2.5);
    await expect.poll(async () => (await transform()).scale).toBe(2.5);
    await drag(0, 140);
    await expect(viewer).toBeVisible();
    await expect.poll(async () => (await transform()).y).toBe(140);
    await drag(0, -220);
    await expect(viewer).toBeVisible();
    await expect.poll(async () => (await transform()).y).toBe(-80);
    await animatedDoubleTap(1);
    await expect.poll(transform).toEqual({ scale: 1, x: 0, y: 0 });

    if (cdp) {
      const points = (span: number) => [
        { x: x - span / 2, y, id: 1 },
        { x: x + span / 2, y, id: 2 },
      ];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(80) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(160) });
      await expect.poll(async () => (await transform()).scale).toBeCloseTo(2);
      // Pinch back to fit and keep dragging with the finger that remains down.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(40) });
      await expect.poll(async () => (await transform()).scale).toBe(1);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [{ x: x - 20, y, id: 1 }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - 20, y: y + 150, id: 1 }],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(viewer).toBeVisible();
    }
    await drag(0, 140);
    await expect(viewer).toHaveCount(0);
    await open.click();
    await expect.poll(transform).toEqual({ scale: 1, x: 0, y: 0 });
    await cdp?.detach();
    expect(downloads).toBe(1);
  });
}

test('GIF viewer preserves image viewer controls, fades, cached bytes, and inline playback', async ({
  page,
}) => {
  const gifId = 'viewer-gif';
  await mockApi(page, [{ ...first, attachment: { type: 'gif', gifId } }]);
  await page.route(`**/api/gifs/${gifId}`, (route) =>
    route.fulfill({
      json: {
        gif: {
          id: gifId,
          width: 360,
          height: 640,
          playbackUrl: 'https://media.example/viewer-gif.mp4',
          fileSize: 1000,
        },
      },
    }),
  );
  let downloads = 0;
  await page.route('https://media.example/viewer-gif.mp4', (route) => {
    downloads++;
    return route.fulfill({
      path: path.join(__dirname, '../fixtures/portrait.mp4'),
      contentType: 'video/mp4',
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const open = page.getByRole('button', { name: 'Open gif attachment', exact: true });
  const inline = open.locator('video');
  await expect
    .poll(() =>
      inline.evaluate((video: HTMLVideoElement) => !video.paused && video.readyState >= 2),
    )
    .toBe(true);
  const row = await page.getByTestId(`message-row-${first.id}`).elementHandle();
  const opening = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const samples: number[] = [];
        const sample = () => {
          const layer = document.querySelector('[data-testid="media-viewer-layer"]');
          if (layer) {
            const opacity = Number(getComputedStyle(layer).opacity);
            samples.push(opacity);
            if (opacity === 1) {
              resolve(samples);
              return;
            }
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  await open.click();
  const viewer = page.getByTestId('gif-viewer');
  expect((await opening).some((opacity) => opacity > 0 && opacity < 1)).toBe(true);
  await expect(viewer.getByText('Grace Hopper', { exact: true })).toBeVisible();
  await expect(viewer.getByText(first.text!, { exact: true })).toBeVisible();
  const bounds = (await viewer.boundingBox())!;
  expect(bounds.width).toBe(page.viewportSize()!.width);
  expect(bounds.height).toBe(page.viewportSize()!.height);
  await expect.poll(() => inline.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  const playback = viewer.locator('video');
  await expect
    .poll(() =>
      playback.evaluate(
        (video: HTMLVideoElement) =>
          !video.paused && video.readyState >= 2 && video.loop && video.muted && !video.controls,
      ),
    )
    .toBe(true);
  // Observe a loop wrapping while the full-screen GIF plays.
  await playback.evaluate((video: HTMLVideoElement & { wraps?: number }) => {
    video.wraps = 0;
    let previous = video.currentTime;
    video.addEventListener('timeupdate', () => {
      if (video.currentTime < previous) video.wraps!++;
      previous = video.currentTime;
    });
  });
  await expect
    .poll(() => playback.evaluate((video: HTMLVideoElement & { wraps?: number }) => video.wraps), {
      timeout: 10000,
    })
    .toBeGreaterThan(0);
  const saved = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'Save attachment', exact: true }).click();
  expect((await saved).suggestedFilename()).toMatch(/\.mp4$/);
  await expect(viewer).toBeVisible();
  const playingElement = await playback.elementHandle();
  const closing = page.getByTestId('media-viewer-layer').evaluate(
    (element) =>
      new Promise<number[]>((resolve) => {
        const samples: number[] = [];
        const sample = () => {
          if (!element.isConnected) {
            resolve(samples);
            return;
          }
          samples.push(Number(getComputedStyle(element).opacity));
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  await viewer.getByRole('button', { name: 'Back to conversation' }).click();
  expect((await closing).some((opacity) => opacity > 0 && opacity < 1)).toBe(true);
  expect(await playingElement!.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  expect(await row!.evaluate((element) => element.isConnected)).toBe(true);
  await expect.poll(() => inline.evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
  await open.click();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await page.getByRole('button', { name: 'Message actions', exact: true }).click();
  for (const name of ['Reply', 'Forward', 'Save GIF'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Close message options' })
    .click({ position: { x: 2, y: 2 } });
  await open.click();
  await viewer.getByRole('button', { name: 'Forward GIF' }).click();
  await expect(page.getByText('Forward to…', { exact: true })).toBeVisible();
  await expect(viewer).toHaveCount(0);
  expect(downloads).toBe(1);
});

test('GIF viewer retries a failed download', async ({ page }) => {
  const gifId = 'retry-viewer-gif';
  await mockApi(page, [{ ...first, attachment: { type: 'gif', gifId } }]);
  await page.route(`**/api/gifs/${gifId}`, (route) =>
    route.fulfill({
      json: {
        gif: {
          id: gifId,
          width: 360,
          height: 640,
          playbackUrl: 'https://media.example/retry-viewer-gif.mp4',
          fileSize: 1000,
        },
      },
    }),
  );
  let fail = true;
  await page.route('https://media.example/retry-viewer-gif.mp4', (route) =>
    fail
      ? route.fulfill({ status: 500 })
      : route.fulfill({
          path: path.join(__dirname, '../fixtures/portrait.mp4'),
          contentType: 'video/mp4',
        }),
  );
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await page.getByRole('button', { name: 'Open gif attachment', exact: true }).click();
  const viewer = page.getByTestId('gif-viewer');
  await expect(viewer.getByRole('button', { name: 'Retry GIF' })).toBeVisible();
  fail = false;
  await viewer.getByRole('button', { name: 'Retry GIF' }).click();
  await expect
    .poll(() =>
      viewer
        .locator('video')
        .evaluate(
          (video: HTMLVideoElement) =>
            !video.paused && video.readyState >= 2 && video.loop && video.muted,
        ),
    )
    .toBe(true);
});

test('image viewer recovers from a failed download using Retry image', async ({ page }) => {
  await mockApi(page, [
    { ...first, text: null, attachment: { type: 'image', mediaId: 'retry-photo' } },
  ]);
  let fail = true;
  await page.route('**/api/conversations/*/attachments/retry-photo', (route) =>
    fail
      ? route.fulfill({ status: 503, body: 'Temporarily unavailable' })
      : route.fulfill({
          path: path.join(__dirname, '../fixtures/portrait.png'),
          contentType: 'image/png',
        }),
  );
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await page.getByRole('button', { name: 'Open image attachment', exact: true }).click();
  const viewer = page.getByTestId('image-viewer');
  await expect(viewer.getByRole('button', { name: 'Retry image' })).toBeVisible();
  fail = false;
  await viewer.getByRole('button', { name: 'Retry image' }).click();
  await expect(viewer.getByRole('img', { name: 'Full screen image' })).toBeVisible();
});

test('image viewer fades in and out while keeping the underlying chat mounted', async ({
  page,
}) => {
  await mockApi(page, [{ ...first, attachment: { type: 'image', mediaId: 'fade-photo' } }]);
  await page.route('**/api/conversations/*/attachments/fade-photo', (route) =>
    route.fulfill({
      path: path.join(__dirname, '../fixtures/portrait.png'),
      contentType: 'image/png',
    }),
  );
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const row = await page.getByTestId(`message-row-${first.id}`).elementHandle();
  const opening = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const samples: number[] = [];
        const sample = () => {
          const layer = document.querySelector('[data-testid="media-viewer-layer"]');
          if (layer) {
            const opacity = Number(getComputedStyle(layer).opacity);
            samples.push(opacity);
            if (opacity === 1) {
              resolve(samples);
              return;
            }
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  await page.getByRole('button', { name: 'Open image attachment', exact: true }).click();
  const openingSamples = await opening;
  expect(openingSamples.some((value) => value > 0 && value < 1)).toBe(true);
  const layer = page.getByTestId('media-viewer-layer');
  const closing = layer.evaluate(
    (element) =>
      new Promise<number[]>((resolve) => {
        const samples: number[] = [];
        const sample = () => {
          if (!element.isConnected) {
            resolve(samples);
            return;
          }
          samples.push(Number(getComputedStyle(element).opacity));
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  await page.getByRole('button', { name: 'Back to conversation' }).click();
  const closingSamples = await closing;
  expect(closingSamples.some((value) => value > 0 && value < 1)).toBe(true);
  await expect(page.getByTestId('image-viewer')).toHaveCount(0);
  expect(await row!.evaluate((element) => element.isConnected)).toBe(true);
  await page.getByRole('button', { name: 'Open image attachment', exact: true }).click();
  await expect(layer).toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('image-viewer')).toHaveCount(0);
});

test('persistent voice mini player follows navigation, survives scrolling, and closes playback', async ({
  page,
}, testInfo) => {
  const voice = {
    ...first,
    text: null,
    attachment: { type: 'voice', mediaId: 'persistent-voice' },
    attachmentMetadata: { id: 'persistent-voice', type: 'voice', durationSeconds: 120 },
  };
  const later = Array.from({ length: 35 }, (_, index) => ({
    ...first,
    id: `after-voice-${index}`,
    text: `Later message ${index}`,
    createdAt: new Date(Date.parse(first.createdAt) + (index + 1) * 1000).toISOString(),
  }));
  const other = { ...chat, id: 'other-voice-chat', name: 'Other conversation' };
  await mockApi(page, [voice, ...later]);
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({ json: { conversations: [chat, other] } }),
  );
  await page.route(`**/api/conversations/${other.id}/**`, (route) => {
    const pathname = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: pathname.endsWith('/members')
        ? { members: [{ userId: user.id, conversationId: other.id, role: 'owner' }] }
        : pathname.endsWith('/first')
          ? { message: null }
          : { messages: [], nextCursor: null },
    });
  });
  // A long, valid PCM WAV keeps playback running throughout navigation checks.
  const samples = 8000 * 120;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  let downloads = 0;
  await page.route('**/api/conversations/*/attachments/persistent-voice', (route) => {
    downloads++;
    return route.fulfill({ body: wav, contentType: 'audio/wav' });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const screen = page.getByTestId(`conversation-${chat.id}`);
  await screen.getByRole('button', { name: 'Download voice message', exact: true }).click();
  await screen.getByRole('button', { name: 'Play voice message', exact: true }).click();
  const mini = page.getByTestId('voice-mini-player');
  await expect(mini).toHaveCount(1);
  await expect(mini.getByText('Grace Hopper', { exact: true })).toBeVisible();
  await expect(mini.getByRole('button')).toHaveCount(2);
  const pause = () =>
    mini.getByRole('button', { name: 'Pause current voice message', exact: true });
  await expect(pause()).toBeVisible();
  await expect(mini).toHaveCSS('height', '36px');
  await expect(mini).toHaveCSS('background-color', 'rgb(244, 247, 250)');
  const header = screen.getByRole('button', { name: 'View conversation details' });
  expect((await mini.boundingBox())!.y).toBeGreaterThan((await header.boundingBox())!.y);
  await screen.getByTestId('chat-history').evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(screen.getByTestId(`message-${first.id}`)).not.toBeInViewport();
  await expect(pause()).toBeVisible();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Other conversation' }).click();
  await expect(mini).toHaveCount(1);
  await expect(
    page.getByTestId(`conversation-${other.id}`).getByTestId('voice-mini-player'),
  ).toBeVisible();
  await expect(pause()).toBeVisible();
  // Back to the list: the bar moves beneath its tabs, including on wide screens.
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  else
    await page.evaluate(() => {
      history.pushState({}, '', '/');
      dispatchEvent(new PopStateEvent('popstate'));
    });
  await expect(mini).toHaveCount(1);
  const tabs = page.getByRole('tab', { name: 'All chats' });
  const tabBox = (await tabs.boundingBox())!;
  expect((await mini.boundingBox())!.y).toBeGreaterThanOrEqual(tabBox.y + tabBox.height - 1);
  await expect(pause()).toBeVisible();
  await pause().click();
  await expect(
    mini.getByRole('button', { name: 'Play current voice message', exact: true }),
  ).toBeVisible();
  await mini.getByRole('button', { name: 'Play current voice message', exact: true }).click();
  await expect(pause()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('voice-mini-player-list.png') });
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(mini).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('voice-mini-player-conversation.png') });
  await mini.getByRole('button', { name: 'Close voice player', exact: true }).click();
  await expect(mini).toHaveCount(0);
  expect(downloads).toBe(1);
});

test('notifications float without moving the form and dismiss after two seconds', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/login');
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(submit).toBeVisible();
  const before = await submit.boundingBox();
  await submit.click();
  const notification = page.getByTestId('notification');
  await expect(notification).toBeVisible();
  await expect(notification).toHaveCSS('background-color', 'rgba(23, 33, 43, 0.65)');
  expect(await submit.boundingBox()).toEqual(before);
  const samples = await page.evaluate(async () => {
    const values: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 2200) {
      const element = document.querySelector('[data-testid="notification"]');
      if (element) values.push(Number(getComputedStyle(element).opacity));
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return values;
  });
  const peak = samples.indexOf(1);
  expect(peak).toBeGreaterThan(-1);
  expect(samples.slice(peak + 1).some((opacity) => opacity > 0 && opacity < 1)).toBe(true);
  await expect(notification).toBeHidden();
  expect(await submit.boundingBox()).toEqual(before);
  await submit.click();
  await expect(notification).toBeVisible();
  await expect(notification).toBeHidden({ timeout: 3000 });
});

test('persistent music mini player follows navigation, survives scrolling, and closes playback', async ({
  page,
}, testInfo) => {
  const music = {
    ...first,
    text: null,
    attachment: { type: 'music', mediaId: 'persistent-music' },
    attachmentMetadata: {
      id: 'persistent-music',
      type: 'music',
      durationSeconds: 120,
      title: 'Test song',
      artist: 'Test artist',
      fileName: 'test.wav',
      contentType: 'audio/wav',
      fileSize: 1920044,
      coverKey: 'covers/test.png',
      coverUrl: 'https://media.example/test-cover.png',
    },
  };
  const later = Array.from({ length: 35 }, (_, index) => ({
    ...first,
    id: `after-music-${index}`,
    text: `Later message ${index}`,
    createdAt: new Date(Date.parse(first.createdAt) + (index + 1) * 1000).toISOString(),
  }));
  const other = { ...chat, id: 'other-music-chat', name: 'Other conversation' };
  const voice = {
    ...first,
    id: 'switching-voice',
    text: null,
    attachment: { type: 'voice', mediaId: 'switching-voice' },
    attachmentMetadata: { id: 'switching-voice', type: 'voice', durationSeconds: 120 },
  };
  await mockApi(page, [music, voice, ...later]);
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({ json: { conversations: [chat, other] } }),
  );
  await page.route(`**/api/conversations/${other.id}/**`, (route) => {
    const pathname = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: pathname.endsWith('/members')
        ? { members: [{ userId: user.id, conversationId: other.id, role: 'owner' }] }
        : pathname.endsWith('/first')
          ? { message: null }
          : { messages: [], nextCursor: null },
    });
  });
  // A long, valid PCM WAV keeps playback running throughout navigation checks.
  const samples = 8000 * 120;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  let downloads = 0;
  await page.route('**/api/conversations/*/attachments/persistent-music', (route) => {
    downloads++;
    return route.fulfill({ body: wav, contentType: 'audio/wav' });
  });
  await page.route('**/api/conversations/*/attachments/switching-voice', (route) =>
    route.fulfill({ body: wav, contentType: 'audio/wav' }),
  );
  await page.route('https://media.example/test-cover.png', (route) =>
    route.fulfill({
      body: readFileSync(path.join(process.cwd(), 'tests/fixtures/portrait.png')),
      contentType: 'image/png',
    }),
  );
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const screen = page.getByTestId(`conversation-${chat.id}`);
  await screen.getByRole('button', { name: 'Download audio', exact: true }).click();
  await screen.getByRole('button', { name: 'Play audio', exact: true }).click();
  const cover = screen.getByRole('img', { name: 'Audio cover' });
  await expect(cover).toBeVisible();
  await expect
    .poll(() => cover.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  const mini = page.getByTestId('audio-mini-player');
  await expect(mini).toHaveCount(1);
  await expect(mini.getByText('Test song · Test artist', { exact: true })).toBeVisible();
  await expect(mini.getByRole('button')).toHaveCount(2);
  const pause = () => mini.getByRole('button', { name: 'Pause current audio', exact: true });
  await expect(pause()).toBeVisible();
  // Switching in either direction replaces the single session player.
  await screen.getByRole('button', { name: 'Download voice message', exact: true }).click();
  await screen.getByRole('button', { name: 'Play voice message', exact: true }).click();
  await expect(mini).toHaveCount(0);
  await expect(page.getByTestId('voice-mini-player')).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Play audio', exact: true })).toBeVisible();
  await screen.getByRole('button', { name: 'Play audio', exact: true }).click();
  await expect(page.getByTestId('voice-mini-player')).toHaveCount(0);
  await expect(
    screen.getByRole('button', { name: 'Play voice message', exact: true }),
  ).toBeVisible();
  await expect(pause()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('music-card-playing.png') });
  await pause().click();
  await expect(
    screen.getByTestId('audio-player').getByText('Test artist', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('music-card-paused.png') });
  await mini.getByRole('button', { name: 'Play current audio', exact: true }).click();
  await expect(mini).toHaveCSS('height', '36px');
  await expect(mini).toHaveCSS('background-color', 'rgb(244, 247, 250)');
  const header = screen.getByRole('button', { name: 'View conversation details' });
  expect((await mini.boundingBox())!.y).toBeGreaterThan((await header.boundingBox())!.y);
  await screen.getByTestId('chat-history').evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(screen.getByTestId(`message-${first.id}`)).not.toBeInViewport();
  await expect(pause()).toBeVisible();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Open Other conversation' }).click();
  await expect(mini).toHaveCount(1);
  await expect(
    page.getByTestId(`conversation-${other.id}`).getByTestId('audio-mini-player'),
  ).toBeVisible();
  await expect(pause()).toBeVisible();
  // Back to the list: the bar moves beneath its tabs, including on wide screens.
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  else
    await page.evaluate(() => {
      history.pushState({}, '', '/');
      dispatchEvent(new PopStateEvent('popstate'));
    });
  await expect(mini).toHaveCount(1);
  const tabs = page.getByRole('tab', { name: 'All chats' });
  const tabBox = (await tabs.boundingBox())!;
  expect((await mini.boundingBox())!.y).toBeGreaterThanOrEqual(tabBox.y + tabBox.height - 1);
  await expect(pause()).toBeVisible();
  await pause().click();
  await expect(mini.getByRole('button', { name: 'Play current audio', exact: true })).toBeVisible();
  await mini.getByRole('button', { name: 'Play current audio', exact: true }).click();
  await expect(pause()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('audio-mini-player-list.png') });
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(mini).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('audio-mini-player-conversation.png') });
  await mini.getByRole('button', { name: 'Close audio player', exact: true }).click();
  await expect(mini).toHaveCount(0);
  expect(downloads).toBe(1);
});

test('empty private chats open without reloading the list and remain local until refresh', async ({
  page,
}, testInfo) => {
  await mockApi(page, []);
  const privateChat = { ...chat, id: 'private-chat', type: 'private', name: null };
  let listRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/conversations') listRequests++;
  });
  await page.route('**:3001/api/conversations/private', (route) =>
    route.fulfill({ json: { conversation: privateChat } }),
  );
  await page.route('**:3001/api/conversations/private-chat', (route) =>
    route.fulfill({ json: { conversation: privateChat } }),
  );
  await signIn(page);
  const baseline = listRequests;
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.getByPlaceholder('@username').fill('grace');
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/private-chat$/);
  await expect(page.getByPlaceholder('Write a message…')).toBeVisible();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats' }).click();
  await expect(page.getByRole('button', { name: 'Open Grace Hopper', exact: true })).toBeVisible();
  expect(listRequests).toBe(baseline);
  await page.getByRole('button', { name: 'Refresh conversations', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Grace Hopper', exact: true })).toHaveCount(0);
});

test('realtime messages discover only the affected chat and renames and deletions update locally', async ({
  page,
}) => {
  await mockApi(page);
  const realtime = await mockRealtime(page);
  const incomingChat = { ...chat, id: 'incoming-private', type: 'private', name: null };
  await page.route('**:3001/api/conversations/incoming-private', (route) =>
    route.fulfill({ json: { conversation: incomingChat } }),
  );
  let listCalls = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/conversations') listCalls++;
  });
  await signIn(page);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  const baseline = listCalls;
  realtime.emit('message.created', {
    message: { ...first, id: 'incoming', conversationId: incomingChat.id, text: 'First hello' },
  });
  await expect(page.getByRole('button', { name: 'Open Grace Hopper', exact: true })).toBeVisible();
  await expect(page.getByTestId(`preview-${incomingChat.id}`)).toHaveText('First hello');
  await expect(page.getByTestId(`unread-${incomingChat.id}`)).toHaveText('1');
  realtime.emit('conversation.updated', { conversationId: chat.id, name: 'Renamed group' });
  await expect(page.getByRole('button', { name: 'Open Renamed group', exact: true })).toBeVisible();
  realtime.emit('conversation.deleted', { conversationId: incomingChat.id });
  await expect(page.getByRole('button', { name: 'Open Grace Hopper', exact: true })).toHaveCount(0);
  expect(listCalls).toBe(baseline);
});

test('sending the first private message keeps the conversation after refresh', async ({
  page,
}, testInfo) => {
  await mockApi(page, []);
  await mockRealtime(page);
  const privateChat = { ...chat, id: 'first-message-chat', type: 'private', name: null };
  const sent = {
    ...first,
    id: 'first-private-message',
    conversationId: privateChat.id,
    senderId: user.id,
    text: 'Hello Grace',
  };
  let sentFirstMessage = false;
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({ json: { conversations: sentFirstMessage ? [chat, privateChat] : [chat] } }),
  );
  await page.route('**:3001/api/conversations/private', (route) =>
    route.fulfill({ json: { conversation: privateChat } }),
  );
  await page.route('**:3001/api/conversations/first-message-chat', (route) =>
    route.fulfill({ json: { conversation: privateChat } }),
  );
  await page.route('**:3001/api/conversations/first-message-chat/messages*', (route) => {
    if (route.request().method() === 'POST') {
      sentFirstMessage = true;
      return route.fulfill({ json: { message: sent } });
    }
    return route.fulfill({ json: { messages: sentFirstMessage ? [sent] : [], nextCursor: null } });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.getByPlaceholder('@username').fill('grace');
  await page.getByRole('button', { name: 'Open chat', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(sent.text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId(`message-${sent.id}`)).toBeVisible();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh conversations', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Grace Hopper', exact: true })).toBeVisible();
  await expect(page.getByTestId(`preview-${privateChat.id}`)).toHaveText('You: Hello Grace');
});

for (const entry of ['message avatar', 'member avatar'] as const) {
  test(`group ${entry} opens user details and a private conversation without refreshing the list`, async ({
    page,
  }) => {
    await mockApi(page);
    await mockRealtime(page);
    const member = entry === 'member avatar' ? { ...friend, username: null } : friend;
    await page.route('**:3001/api/users/friend', (route) =>
      route.fulfill({ json: { user: member } }),
    );
    const privateChat = { ...chat, id: 'profile-private-chat', type: 'private', name: null };
    let attempts = 0;
    let listCalls = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/conversations') listCalls++;
    });
    await page.route('**:3001/api/conversations/private', (route) => {
      expect(route.request().postDataJSON()).toEqual({ userId: friend.id });
      attempts++;
      if (attempts === 1)
        return route.fulfill({ status: 503, json: { error: 'Please try again' } });
      return route.fulfill({ json: { conversation: privateChat } });
    });
    await page.route('**:3001/api/conversations/profile-private-chat', (route) =>
      route.fulfill({ json: { conversation: privateChat } }),
    );
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    const baseline = listCalls;
    if (entry === 'member avatar')
      await page.getByRole('button', { name: 'View conversation details' }).click();
    await page
      .getByRole('button', { name: 'View Grace Hopper profile', exact: true })
      .last()
      .click();
    await expect(page.getByText('User details', { exact: true })).toBeVisible();
    await expect(page.getByText('USER ID', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('img', { name: 'Grace Hopper profile photo' }).last(),
    ).toBeVisible();
    if (member.username)
      await expect(page.getByText('@grace', { exact: true }).last()).toBeVisible();
    await expect(page.getByTestId('message-options')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    await expect(page.getByText('Please try again', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    await expect(page).toHaveURL(/\/chat\/profile-private-chat$/);
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    await expect(page.getByText('User details', { exact: true })).toHaveCount(0);
    expect(listCalls).toBe(baseline);
    expect(attempts).toBe(2);
  });
}

test('group member names and your own member row open user details', async ({ page }) => {
  await mockApi(page);
  await mockRealtime(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await page.getByRole('button', { name: 'View conversation details' }).click();
  await page
    .getByRole('button', { name: 'View Grace Hopper profile', exact: true })
    .last()
    .getByText('Grace Hopper', { exact: true })
    .click();
  await expect(page.getByText('User details', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close dialog' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByText('User details', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View conversation details' }).click();
  await page
    .getByRole('button', { name: 'View Ada Lovelace profile', exact: true })
    .getByText('Ada Lovelace (you)', { exact: true })
    .click();
  await expect(page.getByText('User details', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open conversation', exact: true })).toHaveCount(0);
});

test('private conversation menu opens the other user details', async ({ page }) => {
  await mockApi(page);
  await mockRealtime(page);
  await page.route('**:3001/api/conversations', (route) =>
    route.fulfill({ json: { conversations: [{ ...chat, type: 'private', name: null }] } }),
  );
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill('ada@example.com');
  await page.getByPlaceholder('Enter your password').fill('goodpassword');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Open Grace Hopper', exact: true }).click();
  await page.getByRole('button', { name: 'Conversation details', exact: true }).click();
  await expect(page.getByText('User details', { exact: true })).toBeVisible();
  await expect(page.getByText('@grace', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('MEMBERS', { exact: true })).toHaveCount(0);
});

test('message username mentions link by syntax and look up users only when clicked', async ({
  page,
}) => {
  await mockApi(page, [
    { ...first, text: 'Hello (@Username_12), @missing_user and @offline_user. mail@example.com' },
  ]);
  await mockRealtime(page);
  const lookups: string[] = [];
  await page.route('**:3001/api/users/by-username/*', (route) => {
    const username = new URL(route.request().url()).pathname.split('/').at(-1)!;
    lookups.push(username);
    if (username === 'missing_user')
      return route.fulfill({ status: 404, json: { error: 'User not found' } });
    if (username === 'offline_user')
      return route.fulfill({ status: 503, json: { error: 'Server unavailable' } });
    return route.fulfill({ json: { user: { ...friend, username } } });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  const mention = page.getByRole('link', { name: '@Username_12', exact: true });
  await expect(mention).toBeVisible();
  await expect(mention).toHaveCSS('color', 'rgb(51, 144, 236)');
  expect(lookups).toEqual([]);
  await expect(page.getByRole('link', { name: '@example', exact: true })).toHaveCount(0);
  await mention.click();
  await expect(page.getByText('User details', { exact: true })).toBeVisible();
  await expect(page.getByText('@username_12', { exact: true })).toBeVisible();
  await expect(page.getByTestId('message-options')).toHaveCount(0);
  expect(lookups).toEqual(['username_12']);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByText('User details', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '@missing_user', exact: true }).click();
  await expect(page.getByTestId('notification')).toHaveText(
    "Username @missing_user doesn't exist.",
  );
  await expect(page.getByText('User details', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '@offline_user', exact: true }).click();
  await expect(page.getByTestId('notification')).toHaveText('Server unavailable');
  expect(lookups).toEqual(['username_12', 'missing_user', 'offline_user']);
});

for (const privateChat of [false, true]) {
  test(`presence updates ${privateChat ? 'private list, header and profile' : 'group message and member'} avatars live`, async ({
    page,
  }) => {
    await mockApi(page);
    const realtime = await mockRealtime(page);
    if (privateChat) {
      const conversation = { ...chat, type: 'private' };
      await page.route('**/api/conversations', (route) =>
        route.fulfill({ json: { conversations: [conversation] } }),
      );
      await page.route(`**/api/conversations/${chat.id}`, (route) =>
        route.fulfill({ json: { conversation } }),
      );
    }
    await page.route('**/api/users/friend', (route) =>
      route.fulfill({
        json: { user: { ...friend, online: true, last_seen: '2026-10-26T12:00:00Z' } },
      }),
    );
    await page.goto('/');
    await page.getByPlaceholder('you@example.com').fill('ada@example.com');
    await page.getByPlaceholder('Enter your password').fill('goodpassword');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const row = page.getByRole('button', {
      name: privateChat ? 'Open Grace Hopper' : 'Open Weekend plans',
    });
    await expect(row).toBeVisible();
    if (privateChat)
      await expect(row.getByLabel('Grace Hopper online', { exact: true })).toBeVisible();
    await row.click();
    if (privateChat) {
      await expect(page.getByText('online', { exact: true })).toHaveCSS(
        'color',
        'rgb(51, 144, 236)',
      );
      await page.getByRole('button', { name: 'View conversation details' }).click();
    } else {
      await expect(page.getByTestId(`message-${first.id}`)).toBeVisible();
      await expect(page.getByLabel('Grace Hopper online', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'View conversation details' }).click();
    }
    await expect(
      page.getByText(privateChat ? 'User details' : 'Group details', { exact: true }),
    ).toBeVisible();
    await expect.poll(() => realtime.connections()).toBeGreaterThan(0);
    realtime.emit('user.presence', {
      userId: friend.id,
      online: false,
      last_seen: '2026-10-26T12:01:00Z',
    });
    await expect(page.getByLabel('Grace Hopper online', { exact: true })).toHaveCount(0);
    realtime.emit('user.presence', {
      userId: friend.id,
      online: true,
      last_seen: '2026-10-26T12:02:00Z',
    });
    await expect(page.getByLabel('Grace Hopper online', { exact: true }).last()).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    realtime.emit('user.presence', {
      userId: friend.id,
      online: false,
      last_seen: '2026-10-26T12:03:00Z',
    });
    if (privateChat) {
      await expect(page.getByText(/^last seen /)).toHaveCSS('color', 'rgb(122, 138, 153)');
    }
    await expect(page.getByLabel('Grace Hopper online', { exact: true })).toHaveCount(0);
  });
}

test('presence heartbeat pauses in a hidden tab and restarts immediately on return', async ({
  page,
}) => {
  await mockApi(page);
  const realtime = await mockRealtime(page, 'access-token', 1_000_000);
  await signIn(page);
  await expect.poll(() => realtime.heartbeats()).toBe(1);
  await page.clock.install({ time: new Date('2026-10-26T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-26T12:00:01Z'));
  const visibility = async (state: 'hidden' | 'visible') => {
    await page.evaluate((value) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  };
  await page.clock.runFor(20000);
  await visibility('hidden');
  await page.clock.runFor(65000);
  expect(realtime.heartbeats()).toBe(1);
  await visibility('visible');
  await expect.poll(() => realtime.heartbeats()).toBe(2);
  await page.clock.runFor(29999);
  expect(realtime.heartbeats()).toBe(2);
  await page.clock.runFor(1);
  await expect.poll(() => realtime.heartbeats()).toBe(3);
  await visibility('hidden');
  await page.clock.runFor(60000);
  expect(realtime.heartbeats()).toBe(3);
});

test('concurrent uploads keep their bubbles and destinations while both chats remain usable', async ({
  page,
}) => {
  await mockApi(page, []);
  const other = { ...chat, id: '77777777-7777-4777-8777-777777777777', name: 'Another chat' };
  await page.route('**/api/conversations', (route) =>
    route.fulfill({ json: { conversations: [chat, other] } }),
  );
  await page.route(`**/api/conversations/${other.id}`, (route) =>
    route.fulfill({ json: { conversation: other } }),
  );
  const sent: { conversationId: string; text?: string; attachment?: object }[] = [];
  await page.route('**/api/conversations/*/messages', async (route) => {
    if (route.request().method() !== 'POST')
      return route.fulfill({ json: { messages: [], nextCursor: null } });
    const conversationId = new URL(route.request().url()).pathname.split('/')[3];
    const payload = route.request().postDataJSON();
    sent.push({ conversationId, ...payload });
    return route.fulfill({
      json: {
        message: {
          ...first,
          ...payload,
          conversationId,
          senderId: user.id,
          id: `sent-${sent.length}`,
          createdAt: new Date().toISOString(),
        },
      },
    });
  });
  const uploads: { conversationId: string; release: () => void }[] = [];
  await page.route('**/api/conversations/*/attachments', async (route) => {
    const conversationId = new URL(route.request().url()).pathname.split('/')[3];
    await new Promise<void>((resolve) => uploads.push({ conversationId, release: resolve }));
    await route.fulfill({
      status: 201,
      json: {
        attachment: {
          id: `file-${conversationId}`,
          type: 'document',
          fileName: 'report.pdf',
          contentType: 'application/pdf',
          fileSize: 100,
        },
      },
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  async function attach(name: string) {
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach a file', exact: true }).click();
    await (await picker).setFiles({ name, mimeType: 'application/pdf', buffer: Buffer.alloc(100) });
  }
  async function back() {
    const button = page.getByRole('button', { name: 'Back to chats', exact: true });
    if (await button.isVisible()) await button.click();
  }
  await attach('first.pdf');
  await expect(page.getByTestId('upload-file')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Upload progress' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('During first upload');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect
    .poll(() => sent.some((message) => message.text === 'During first upload'))
    .toBe(true);
  await back();
  await page.getByRole('button', { name: 'Open Another chat' }).click();
  await attach('second.pdf');
  await expect(page.getByText('second.pdf', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('During second upload');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => uploads.length).toBe(2);
  expect(uploads.map((upload) => upload.conversationId)).toEqual([chat.id, other.id]);
  await back();
  await page.getByRole('button', { name: 'Open Weekend plans' }).click();
  await expect(page.getByText('first.pdf', { exact: true })).toBeVisible();
  uploads[1].release();
  await expect.poll(() => sent.filter((message) => message.attachment).length).toBe(1);
  expect(sent.find((message) => message.attachment)?.conversationId).toBe(other.id);
  await page.getByRole('button', { name: 'Cancel document upload', exact: true }).click();
  await expect(page.getByTestId('upload-file')).toHaveCount(0);
  uploads[0].release();
  await expect.poll(() => sent.filter((message) => message.attachment).length).toBe(1);
  expect(sent.filter((message) => message.text).map((message) => message.conversationId)).toEqual([
    chat.id,
    other.id,
  ]);
});

for (const kind of ['image', 'video', 'music'] as const) {
  test(`uploaded pending ${kind} attachments show cancellable progress inside their own bubble`, async ({
    page,
  }) => {
    await mockApi(page, []);
    let release: (() => void) | undefined;
    await page.route('**/api/conversations/*/attachments', async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ status: 500, json: { error: 'Cancelled test upload' } });
    });
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach a file', exact: true }).click();
    const fixture = kind === 'image' ? 'portrait.png' : kind === 'video' ? 'loop.mp4' : null;
    await (
      await picker
    ).setFiles(
      fixture
        ? path.join(__dirname, '../fixtures', fixture)
        : {
            name: 'song.mp3',
            mimeType: 'audio/mpeg',
            buffer: Buffer.alloc(1024),
          },
    );
    const bubble = page.getByTestId(kind === 'music' ? 'upload-file' : 'upload-media');
    await expect(bubble).toBeVisible();
    await expect(bubble.getByRole('progressbar', { name: 'Upload progress' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable();
    await expect(page.getByRole('button', { name: 'Attach a file', exact: true })).toBeEnabled();
    if (kind === 'image') {
      await expect(bubble.getByText(/\//)).toHaveCount(0);
      await expect
        .poll(() => bubble.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
    } else if (kind === 'video') {
      await expect
        .poll(() => bubble.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth))
        .toBeGreaterThan(0);
    } else await expect(bubble.getByText('song.mp3', { exact: true })).toBeVisible();
    await expect.poll(() => !!release).toBe(true);
    await page.getByRole('button', { name: `Cancel ${kind} upload`, exact: true }).click();
    await expect(bubble).toHaveCount(0);
    release!();
  });
}

test('large video upload keeps file handling and progress work away from chatting', async ({
  page,
}, testInfo) => {
  const { mkdtempSync, copyFileSync, truncateSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const directory = mkdtempSync(path.join(tmpdir(), 'reducto-large-upload-'));
  const videoPath = path.join(directory, 'large.mp4');
  copyFileSync(path.join(__dirname, '../fixtures/loop.mp4'), videoPath);
  truncateSync(videoPath, 45 * 1024 * 1024);
  await mockApi(
    page,
    Array.from({ length: 80 }, (_, index) => ({
      ...first,
      id: `history-${index}`,
      text: `History ${index}`,
    })),
  );
  await page.addInitScript(() => {
    const diagnostics = {
      base64Reads: 0,
      blobFetches: 0,
      longTasks: [] as number[],
      progress: null as (() => void) | null,
    };
    (window as any).__uploadDiagnostics = diagnostics;
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob) {
      diagnostics.base64Reads++;
      return read.call(this, blob);
    };
    const fetchFile = window.fetch;
    window.fetch = function (...args) {
      if (String(args[0]).startsWith('blob:')) diagnostics.blobFetches++;
      return fetchFile(args[0] as RequestInfo, args[1]);
    };
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof FormData && body.get('file') instanceof Blob) {
        const xhr = this;
        let loaded = 0;
        diagnostics.progress = () => {
          loaded += 50000;
          xhr.upload.dispatchEvent(
            new ProgressEvent('progress', {
              loaded,
              total: 45 * 1024 * 1024,
              lengthComputable: true,
            }),
          );
        };
      }
      return send.call(this, body);
    };
    new PerformanceObserver((list) => {
      diagnostics.longTasks.push(...list.getEntries().map((entry) => entry.duration));
    }).observe({ type: 'longtask', buffered: false });
  });
  let release: (() => void) | undefined;
  await page.route('**/api/conversations/*/attachments', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ status: 500, json: { error: 'Cancelled test upload' } });
  });
  try {
    await signIn(page);
    await page.getByRole('button', { name: 'Open Weekend plans' }).click();
    await page.evaluate(() => {
      (window as any).__uploadDiagnostics.longTasks = [];
    });
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach a file', exact: true }).click();
    await (await picker).setFiles(videoPath);
    await expect(
      page.getByRole('button', { name: 'Cancel video upload', exact: true }),
    ).toBeVisible();
    await expect.poll(() => !!release, { timeout: 20000 }).toBe(true);
    await page.evaluate(() => {
      const diagnostics = (window as any).__uploadDiagnostics;
      (window as any).__progressTimer = setInterval(() => diagnostics.progress?.(), 16);
    });
    const text = 'Typing a message while a large video uploads smoothly.';
    const started = Date.now();
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .pressSequentially(text, { delay: 15 });
    const typingMs = Date.now() - started;
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(text);
    await page.evaluate(() => clearInterval((window as any).__progressTimer));
    const diagnostics = await page.evaluate(() => {
      const d = (window as any).__uploadDiagnostics;
      return { base64Reads: d.base64Reads, blobFetches: d.blobFetches, longTasks: d.longTasks };
    });
    console.log('Large upload diagnostics', testInfo.project.name, { ...diagnostics, typingMs });
    expect(diagnostics.base64Reads).toBe(0);
    expect(diagnostics.blobFetches).toBe(0);
    const sent = page.waitForRequest(
      (request) => request.url().endsWith('/messages') && request.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    expect((await sent).postDataJSON()).toEqual({ text });
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'Cancel video upload', exact: true }).click();
    release!();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
