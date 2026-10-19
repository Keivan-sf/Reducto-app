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

- Email/password sign-in and sign-up with validation, show/hide password, session restore, sign-out, and coordinated refresh-token rotation.
- Searchable conversation list with group and unread filters, desktop split view, and phone navigation.
- Private conversations by recipient user ID; create groups and join by invite link/token.
- Paginated history, text messages, message search, real-time delivery, reconnect synchronization, and session-local unread counts.
- Attachment upload and authenticated download, image previews, message forwarding, and all eight supported emoji reactions.
- Group renaming, invitations, adding/removing members, owner/admin roles, leaving groups, and confirmed group deletion.
- GIF/video upload, GIF library add/remove, and sending GIF references.
- Profile name/username editing, square avatar crop/resize/upload, and copying your user ID.

## Backend boundaries

The API does not provide user search, participant profiles, presence, read receipts, or persistent read positions. Private chats and other participants therefore use their user IDs. Share your ID from Settings to start a conversation. Unread counts track events received during the current app session; a sent checkmark means the server accepted a message.

Avatars and GIF records contain object-storage keys without a download endpoint. Set `EXPO_PUBLIC_MEDIA_BASE_URL` to a readable storage base URL to display avatars and open GIFs from the library. Without it, avatars show initials and GIFs remain available as sendable library entries. Conversation attachments use the API’s authenticated download endpoint and do not require public storage. Videos/audio/documents download or open through the device share sheet; inline video/audio playback and push notifications are not implemented.

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
