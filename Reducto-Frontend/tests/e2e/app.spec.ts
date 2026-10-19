import { expect, test, type Page } from '@playwright/test';
const inviteToken = '32d48175eefe9c95142073e7c2ac93aadf87e126616733142362774c8c8ab40a';
const inviteUri = `reducto:///api/groups/join/${inviteToken}`;

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
async function mockApi(page: Page, initialMessages: object[] = [first]) {
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
  await page.route('**:3001/api/**', async (route) => {
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
