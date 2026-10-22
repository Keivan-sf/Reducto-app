# Reducto

A Telegram-inspired messenger built with **Expo SDK 57**, React Native, TypeScript, and Expo Router. The same application runs on web and Android through Expo Go. The blue palette, compact conversation list, green outgoing bubbles, and responsive split view follow Telegram’s [web and mobile applications](https://telegram.org/apps).

## Run locally

Start the client:

```sh
cd Reducto-Frontend
pnpm install
pnpm dev
```

Open **http://localhost:8081** on web, or scan the QR code with **Expo Go compatible with SDK 57** on Android. No custom native build is required.

On the sign-in or sign-up screen, enter your **Server URL**, including `http://` or `https://` and the port if needed. Enter the server origin without `/api` or another path. The app remembers the address and stores it with the authenticated session. REST requests, uploads, downloads, token refresh, and Socket.IO use that selected server. No API URL environment variable or rebuild is required. Sign out to choose another server; the previous address remains editable on the login screen.

For a physical Android phone, use a server address reachable from that phone, such as your computer’s LAN address on the same Wi-Fi network. `localhost` on a phone refers to the phone itself. Old saved sessions without a server address require signing in again, so tokens are never guessed to belong to a different server.

For web, the selected server must allow the frontend’s origin through CORS. An HTTPS frontend requires an HTTPS server. `pnpm dev` starts only Expo. If the reference backend has no CORS support, you can explicitly run the optional development proxy in another terminal:

```sh
pnpm proxy http://YOUR_BACKEND_HOST:3000
```

Then enter the proxy’s address (port 3001 by default) as the **Server URL** on the web login screen. The proxy target is supplied as a command argument; it is never taken from `API_TARGET`. `PROXY_PORT` controls only the local listening port. This proxy is a local development tool, not required for servers that support CORS.

## Features

- Email/password sign-in and sign-up with an optional username, validation, show/hide password, session restore, sign-out, and coordinated refresh-token rotation.
- Searchable conversation list with group and unread filters, desktop split view, and phone navigation.
- Private conversations by username (with or without `@`), with user ID as a fallback; create groups and join by invite link/token.
- Cached, paginated history, text messages, message search, real-time delivery, reconnect synchronization, and session-local unread counts.
- Replies with sender names and compact text/attachment previews, a cancellable reply composer, and click-to-jump navigation with a brief target highlight.
- Attachment upload and authenticated download, image previews, message forwarding, and all eight supported emoji reactions.
- Group renaming, invitations, adding/removing members, owner/admin roles, leaving groups, and confirmed group deletion.
- Blue, clickable HTTP(S), FTP, `www.` and `reducto://` links in messages. Web links open separately; Reducto group invites stay inside the app.
- GIF/video upload, GIF library add/remove, and inline GIF previews that autoplay muted on a loop without video controls.
- Profile name/username editing, square avatar crop/resize/upload, and copying your user ID.

## Backend boundaries

Copied group invitations use `reducto:///api/groups/join/<token>`. Clicking one in a conversation opens the internal join screen, which submits an authenticated request and opens the group. Signed-out users are sent to sign-in and then returned to their invitation. Only the group-join action is supported for Reducto URIs; other actions show an unsupported-link message. The Join group field also accepts these URIs and existing backend invite links.

In-app links work in Expo Go. Launching an app from an external `reducto://` URI requires an installed native build with the configured scheme. Expo Go uses `exp://<host>:8081/--/api/groups/join/<token>` for external deep links, as described in [Expo’s linking documentation](https://docs.expo.dev/versions/v57.0.0/sdk/linking/). On web, `/api/groups/join/<token>` is the corresponding frontend route and must be served by the frontend host.

User profiles are fetched by ID and username and shared across the chat list, conversation headers, group senders, member lists, and forwarded messages. Private chats show display names and usernames. The `user.profile_updated` Socket.IO event immediately refreshes the changed user, including their signed avatar URL, across all these views. Reconnecting, returning to the app, or manually refreshing chats also fetches fresh profiles to recover changes missed offline. The backend notifies shared-chat peers; the current user's own edits refresh locally after saving. Profiles are otherwise cached for ten minutes and renewed periodically before the backend’s fifteen-minute signed avatar URLs expire. Stale requests cannot overwrite newer notifications. Missing photos show initials, and failed profile lookups preserve existing details and retry without blocking messaging. Share your username from Settings so friends can start a conversation. The API does not provide user search or presence. A sent checkmark means the server accepted a message; peer seen notifications and read-receipt rendering are not used yet.

Avatars use signed URLs from the user profile API; the backend’s `S3_ENDPOINT` must be reachable from the web browser or Android phone. GIFs resolve `playbackUrl` from cached library/upload metadata or authenticated `GET /api/gifs/:gifId`, then download once without sending a bearer token to object storage. GIFs, images, voice recordings, downloaded videos, and uploaded originals share a session-local file cache on Android and web. Scrolling or reopening chats reuses these files; cached GIF playback no longer depends on the signed link remaining valid. Downloads share one request per file. An expired GIF download link is renewed once before retrying.

The file cache retains up to 512 files or 256 MiB, evicting the least recently used files while protecting active subscribers. Files removed by Android are downloaded again when needed. Signing out, changing server/account, or restarting the app clears the session cache. Attachment and GIF metadata each retain up to 2,048 entries. Attachment details without thumbnail URLs remain cached for the session; signed thumbnail links renew after ten minutes or one minute before expiry, whichever comes first. Locally cached GIFs reuse their metadata without periodic URL lookups. Offscreen GIFs pause, and cached playback does not show a network loading spinner while the decoder starts. Image and GIF previews adapt to their media dimensions within 260 × 280 logical pixels and contain the full media without cropping. Videos open in the in-app player; voice messages have inline playback and seeking. Other audio/documents use the device share sheet. Push notifications are not implemented.

Unread badges start from the API’s `unreadCount` and `lastSeenMessageId`. History loads only when a chat is opened. A saved read position opens a cached/API window of 50 messages before and 50 after that message; with no saved position, it resolves the oldest message through `/api/conversations/:id/messages/first`, loads the surrounding window, and opens at that first message. Empty conversations are cached without requesting a context window. Scrolling near either unloaded edge automatically fetches the next 50-message batch, deduplicates overlapping requests, and preserves the visible message. There are no load-more prompts. Messages visible for 350 ms in the focused, unobscured chat advance the watermark through `PUT /api/conversations/:id/seen`. Counts update immediately for the inclusive range read, with concurrent writes coalesced and serialized; the response reconciles the server count. Background list/history requests do not mark messages read. Failed writes retry, and stale requests cannot undo newer reads. Conversation-list polling every ten seconds while the app is active, plus resume/reconnect/manual refresh, picks up other clients’ saved positions without consuming `conversation.seen` notifications. Polling refreshes read state without downloading message history.

Chat history is cached in memory for the current server/account session. Reopening a chat reuses its growing contiguous window, including empty chats; concurrent requests share one flight. Conversation-list refreshes fetch just the latest message (`limit=1`) per conversation for previews, timestamps, and sorting. This separate preview cache updates on realtime delivery and never inserts a disconnected latest message into the loaded history or changes read state. Startup does not fetch full history pages for closed chats. Reconnects, app resume, and manual refresh extend the active live window without splicing disconnected latest pages into an older reading position. Reply targets are resolved once through the single-message API. Jumps outside the current history use the around endpoint and a separate contiguous context window, with automatic older/newer pagination and a button to return to latest messages. Jump windows and target details are also cached; sign-out/server changes clear the caches, and removed chats are pruned.

Native credentials use Expo SecureStore. Web credentials persist in localStorage across tab and browser restarts; existing sessionStorage entries migrate automatically. Refresh tokens rotate on renewal, with Web Locks coordinating tabs where available, and sign-out synchronizes across open tabs. Browser storage remains scoped to the same scheme, hostname, and port. Messages are held in memory and synchronized from the server. For hosted deployment, configure HTTPS, API CORS/WebSocket origin handling, a server address reachable by clients, and a host that routes application paths to the web entry point; the included proxy is for local development.

## Project layout

```text
src/
  app/                 Expo Router routes and authenticated layout
  api/                 API types, errors, request and token-refresh handling
  components/          Shared controls, forms, avatars, dialogs, and colors
  context/             Session and chat state, realtime subscriptions
  features/
    auth/              Sign-in and sign-up
    chats/             List, conversation, groups, GIF library, uploads
    settings/          Profile editing and account settings
  lib/                 Configuration, storage, files, message helpers
scripts/               Development server and CORS/WebSocket proxy
tests/                 API/state/proxy tests and browser flow tests
```

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm exec expo install --check
pnpm exec expo export --platform web --platform android
```

Browser tests use mocked API responses, so they never modify your backend data:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chrome/Chromium executable. The browser suite covers login errors, sign-up, sending messages, profile editing, and sign-out in desktop and Pixel 7 layouts. Screenshots and failure traces are written to `test-results/`.
