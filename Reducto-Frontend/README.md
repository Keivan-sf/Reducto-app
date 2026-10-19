# Reducto

A Telegram-inspired messenger built with **Expo SDK 57**, React Native, TypeScript, and Expo Router. The same application runs on web and Android through Expo Go. The blue palette, compact conversation list, green outgoing bubbles, and responsive split view follow Telegram’s [web and mobile applications](https://telegram.org/apps).

## Run locally

With the reference backend running on port 3000:

```sh
cd Reducto-Frontend
pnpm install
pnpm dev
```

Open **http://localhost:8081** on web. Scan the terminal QR code with **Expo Go compatible with SDK 57** on Android. This SDK was selected following Expo’s [physical-device guidance](https://docs.expo.dev/get-started/create-a-project/). No custom native build is needed for the implemented features.

`pnpm dev` starts Expo and a development API proxy on port 3001. The reference backend does not send CORS headers; the proxy adds them for local web origins and forwards Socket.IO WebSockets. Backend source remains unchanged. `BROWSER=none pnpm dev` starts without opening a browser.

For an Android phone, use the same Wi-Fi network as your computer. The app automatically uses Metro’s LAN hostname and port 3000 for the API. The backend and port 8081 must be reachable from the phone. For an Android emulator, set `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000`. You can also run `pnpm android` or `pnpm start --go` when a web proxy is not needed.

Copy `.env.example` to `.env` to override automatic addresses, then restart Expo:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000
```

For web, use the proxy address (`http://localhost:3001`) or an API that supports your web origin. `API_TARGET` and `PROXY_PORT` configure the development proxy; changing its port also requires changing `EXPO_PUBLIC_API_URL`. The proxy reads process environment variables; run it with `node --env-file=.env scripts/dev.mjs` if overriding those values in `.env`.

## Features

- Email/password sign-in and sign-up with an optional username, validation, show/hide password, session restore, sign-out, and coordinated refresh-token rotation.
- Searchable conversation list with group and unread filters, desktop split view, and phone navigation.
- Private conversations by username (with or without `@`), with user ID as a fallback; create groups and join by invite link/token.
- Paginated history, text messages, message search, real-time delivery, reconnect synchronization, and session-local unread counts.
- Attachment upload and authenticated download, image previews, message forwarding, and all eight supported emoji reactions.
- Group renaming, invitations, adding/removing members, owner/admin roles, leaving groups, and confirmed group deletion.
- Blue, clickable HTTP(S), FTP, `www.` and `reducto://` links in messages. Web links open separately; Reducto group invites stay inside the app.
- GIF/video upload, GIF library add/remove, and inline GIF previews that autoplay muted on a loop without video controls.
- Profile name/username editing, square avatar crop/resize/upload, and copying your user ID.

## Backend boundaries

Copied group invitations use `reducto:///api/groups/join/<token>`. Clicking one in a conversation opens the internal join screen, which submits an authenticated request and opens the group. Signed-out users are sent to sign-in and then returned to their invitation. Only the group-join action is supported for Reducto URIs; other actions show an unsupported-link message. The Join group field also accepts these URIs and existing backend invite links.

In-app links work in Expo Go. Launching an app from an external `reducto://` URI requires an installed native build with the configured scheme. Expo Go uses `exp://<host>:8081/--/api/groups/join/<token>` for external deep links, as described in [Expo’s linking documentation](https://docs.expo.dev/versions/v57.0.0/sdk/linking/). On web, `/api/groups/join/<token>` is the corresponding frontend route and must be served by the frontend host.

User profiles are fetched by ID and username and shared across the chat list, conversation headers, group senders, member lists, and forwarded messages. Private chats show display names and usernames. The `user.profile_updated` Socket.IO event immediately refreshes the changed user, including their signed avatar URL, across all these views. Reconnecting, returning to the app, or manually refreshing chats also fetches fresh profiles to recover changes missed offline. The backend notifies shared-chat peers; the current user's own edits refresh locally after saving. Profiles are otherwise cached for ten minutes and renewed periodically before the backend’s fifteen-minute signed avatar URLs expire. Stale requests cannot overwrite newer notifications. Missing photos show initials, and failed profile lookups preserve existing details and retry without blocking messaging. Share your username from Settings so friends can start a conversation. The API does not provide user search, presence, read receipts, or persistent read positions. Unread counts track events received during the current app session; a sent checkmark means the server accepted a message.

Avatars use signed URLs from the user profile API; the backend’s `S3_ENDPOINT` must be reachable from the web browser or Android phone. No public storage URL is needed for avatars. GIF previews use `playbackUrl` from the library/upload responses or authenticated `GET /api/gifs/:gifId` for received messages. Signed links play directly without a bearer header. A bounded, session-local cache shares requests and reuses library/upload metadata; links renew after ten minutes or one minute before their signed expiry, whichever comes first. Visible previews recheck on app resume; offscreen chat GIFs pause. Image and GIF previews adapt to their media dimensions, stay within 260 × 280 logical pixels and the available bubble width, and contain the full media without cropping. Extremely tall or wide media uses padding within a bounded frame. No public storage base URL is required for GIFs. Conversation attachments use the API’s authenticated download endpoint and do not require public storage. Videos/audio/documents download or open through the device share sheet; inline playback for ordinary video/audio attachments and push notifications are not implemented.

Native credentials use Expo SecureStore. Web credentials use tab-scoped sessionStorage. Messages are held in memory and synchronized from the server. For hosted deployment, configure HTTPS, API CORS/WebSocket origin handling, a reachable API URL, and a host that routes application paths to the web entry point; the included proxy is for local development.

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
