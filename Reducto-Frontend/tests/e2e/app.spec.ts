import { expect, test, type Page } from '@playwright/test';

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
async function mockApi(page: Page) {
  const messages: object[] = [first];
  await page.route('**:3001/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path.endsWith('/sign-in') || path.endsWith('/sign-up')) {
      if (request.postDataJSON().password === 'wrongpassword')
        return route.fulfill({ status: 401, json: { error: 'Invalid credentials' } });
      body = { user, accessToken: 'access-token', refreshToken: 'refresh-token' };
    } else if (path.endsWith('/me')) body = { user };
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
