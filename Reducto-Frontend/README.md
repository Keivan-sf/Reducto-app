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

## Live Android debugging over ADB

Connect your phone with USB or pair it using Android's Wireless debugging. Once
`adb devices` lists it as `device`, run:

```sh
pnpm android:dev
```

This builds the native debug APK on the first run, installs it, forwards Metro
(8081) and the local backend (3000) through ADB, and opens Reducto. It starts Metro
if needed or reuses an existing server on 8081. Keep Metro running while testing.
Save JavaScript/TypeScript changes for Fast Refresh on the phone. Shake the phone
to open the development menu; use React Native DevTools from Metro to debug JS.
The debug APK uses Reducto's own native configuration, including its Android
keyboard/window behavior. It installs as an update to a locally signed release
APK when the signing key matches, preserving app data.

Enter `http://localhost:3000` as the server URL to use the forwarded local backend,
or keep using your existing reachable server. Media URLs still need to be
reachable from the phone. If a local media server advertises `localhost:9000`,
also run `adb reverse tcp:9000 tcp:9000`.

After changing native dependencies, app configuration, or config plugins, rebuild:

```sh
pnpm android:dev --build
```

Run `pnpm android:dev` again after reconnecting wireless debugging to restore the
forwarding and reopen the app. If multiple devices are connected, select one with
`ANDROID_SERIAL=<serial> pnpm android:dev`. Android builds use the existing Nix
toolchain described below and select the connected phone's CPU architecture.

To build and install a fresh release APK through the same USB or paired wireless
ADB connection, run:

```sh
pnpm android:dev-no-debug
```

This always rebuilds `dist/reducto.apk` for the selected phone's architecture,
installs it as an update, forwards the local backend port (3000), and opens the
app. It bundles the JavaScript and runs without Metro, Fast Refresh, or the dev
menu. Run the command again to apply code changes. `ANDROID_SERIAL` and the
`APK_*` build options work with this command too. Backend forwarding requires the
ADB connection to remain active; use a reachable server URL to run independently.

## Build an Android APK on NixOS

From this directory, run:

```sh
pnpm android:release
```

The APK is written to `dist/reducto.apk`, with a SHA-256 checksum alongside it.
This command runs `./build-apk.sh` and only builds; no phone connection is needed.
It includes the application bundle and runs without Expo Go, Metro, Android
Studio, or an Expo account. Install it on your phone by opening the APK and
allowing installation from that source, or use `adb install -r dist/reducto.apk`.
Choose your reachable backend address on the sign-in screen as usual.

The script uses `android-build.nix` to supply Java 21, Node, pnpm, Android SDK 36,
build tools, NDK and CMake in a Linux FHS environment. Nix and a configured
`<nixpkgs>` are required, along with enabled Linux user namespaces. The Nix
expression accepts the Android SDK license. The first build needs network access
and several GB of downloads/cache space; subsequent builds reuse Nix packages,
`.gradle-apk/`, and generated native build outputs. Native directories are
generated with Expo prebuild; keep native configuration in app config/plugins.

By default the APK supports ARM64 and ARMv7 phones. For an ARM64-only build:

```sh
APK_ARCHITECTURES=arm64-v8a ./build-apk.sh
```

Set `APK_BUILD_JOBS` to adjust the Gradle worker count (default 2), or
`APK_BUILD_VERBOSE=1` for detailed Gradle output. Gradle logs are saved to
`.gradle-apk/build.log`. Use
`./build-apk.sh --help` for available options. The build toolchain versions match
the current Expo/React Native dependencies; review `android-build.nix` when
upgrading those dependencies.

This is a release-mode **sideload APK**, signed with a persistent local key in
`.apk-signing/local.keystore` using the standard Android debug credentials. Keep
that directory to install future builds as updates. It and the build caches are
ignored by Git. This signing setup is for local use; Play Store publishing needs
private production signing credentials. The APK permits HTTP connections because
the application supports user-selected HTTP/LAN servers.

## Features

- Email/password sign-in and sign-up with an optional username, validation, show/hide password, session restore, sign-out, and coordinated refresh-token rotation.
- Searchable conversation list with group and unread filters, desktop split view, and phone navigation.
- Private conversations by username (with or without `@`), with user ID as a fallback; create groups and join by invite link/token.
- Cached, paginated history, text messages, message search, real-time delivery, reconnect synchronization, and session-local unread counts.
- Replies with sender names and compact text/attachment previews, a cancellable reply composer, and click-to-jump navigation with a brief target highlight.
- Attachment upload and authenticated download, image previews, message forwarding, and all eight supported emoji reactions.
- Attachments and GIF/video uploads support files up to 2 GB (2,147,483,648 bytes), matching the backend. Avatars retain the backend's separate 5 MB limit.
- Uploads have no frontend time limit. Chat uploads can still be cancelled manually.
- Downloads have no frontend time limit on web or Android. Manual download cancellation remains available.
- Group renaming, invitations, adding/removing members, owner/admin roles, leaving groups, and confirmed group deletion.
- Blue, clickable HTTP(S), FTP, `www.` and `reducto://` links in messages. Web links open separately; Reducto group invites stay inside the app.
- GIF/video upload, GIF library add/remove, and inline GIF previews that autoplay muted on a loop without video controls.
- Profile name/username editing, square avatar crop/resize/upload, and copying your user ID.

## Backend boundaries

Copied group invitations use `reducto:///api/groups/join/<token>`. Clicking one in a conversation opens the internal join screen, which submits an authenticated request and opens the group. Signed-out users are sent to sign-in and then returned to their invitation. Only the group-join action is supported for Reducto URIs; other actions show an unsupported-link message. The Join group field also accepts these URIs and existing backend invite links.

In-app links work in Expo Go. Launching an app from an external `reducto://` URI requires an installed native build with the configured scheme. Expo Go uses `exp://<host>:8081/--/api/groups/join/<token>` for external deep links, as described in [Expo’s linking documentation](https://docs.expo.dev/versions/v57.0.0/sdk/linking/). On web, `/api/groups/join/<token>` is the corresponding frontend route and must be served by the frontend host.

User profiles are fetched by ID and username and shared across the chat list, conversation headers, group senders, member lists, and forwarded messages. Private chats show display names and usernames. The `user.profile_updated` Socket.IO event immediately refreshes the changed user, including their signed avatar URL, across all these views. Reconnecting, returning to the app, or manually refreshing chats also fetches fresh profiles to recover changes missed offline. The backend notifies shared-chat peers; the current user's own edits refresh locally after saving. Profiles are otherwise cached for ten minutes and renewed periodically before the backend’s fifteen-minute signed avatar URLs expire. Stale requests cannot overwrite newer notifications. Missing photos show initials, and failed profile lookups preserve existing details and retry without blocking messaging. Share your username from Settings so friends can start a conversation. The API does not provide user search or presence. A sent checkmark means the server accepted a message; peer seen notifications and read-receipt rendering are not used yet.

Avatars use signed URLs from the user profile API; the backend’s `S3_ENDPOINT` must be reachable from the web browser or Android phone. GIFs resolve `playbackUrl` from cached library/upload metadata or authenticated `GET /api/gifs/:gifId`, then download once without sending a bearer token to object storage. GIFs, images, voice recordings, downloaded videos, and uploaded originals share a session-local file cache on Android and web. Scrolling or reopening chats reuses these files; cached GIF playback no longer depends on the signed link remaining valid. Downloads share one request per file. An expired GIF download link is renewed once before retrying.

The file cache retains up to 512 files or 256 MiB, evicting the least recently used files while protecting active subscribers. Files removed by Android are downloaded again when needed. Signing out, changing server/account, or restarting the app clears the session cache. Attachment and GIF metadata each retain up to 2,048 entries. Attachment details without thumbnail URLs remain cached for the session; signed thumbnail links renew after ten minutes or one minute before expiry, whichever comes first. Locally cached GIFs reuse their metadata without periodic URL lookups. Offscreen GIFs pause, and cached playback does not show a network loading spinner while the decoder starts. Image and GIF previews adapt to their media dimensions within 260 × 280 logical pixels and contain the full media without cropping. Videos open in the in-app player; voice messages have inline playback and seeking. Voice playback belongs to the signed-in session and continues when its message scrolls offscreen or the user changes conversations. A compact player with the sender’s name, play/pause, and close controls appears below the conversation header, or below the chat-list tabs when no conversation is open. Wide layouts show it only in the conversation pane while a conversation is selected. Closing the player or signing out stops playback; starting a recording or opening a video pauses it. Other audio/documents use the device share sheet. Push notifications are not implemented.

Unread badges start from the API’s `unreadCount` and `lastSeenMessageId`. History loads only when a chat is opened. A saved read position opens a cached/API window of 50 messages before and 50 after that message; with no saved position, it resolves the oldest message through `/api/conversations/:id/messages/first`, loads the surrounding window, and opens at that first message. Empty conversations are cached without requesting a context window. Scrolling near either unloaded edge automatically fetches the next 50-message batch, deduplicates overlapping requests, and preserves the visible message. There are no load-more prompts. Successful sends advance the sender’s watermark to the sent message immediately, including attachments, GIFs, voice messages, and forwards; already received newer messages remain unread. Messages visible for 350 ms in the focused, unobscured chat also advance the watermark through `PUT /api/conversations/:id/seen`. Counts update immediately for the inclusive range read, with concurrent writes coalesced and serialized; the response reconciles the server count. Background list/history requests do not mark messages read. Failed writes retry, and stale requests cannot undo newer reads. Conversation-list polling every ten seconds while the app is active, plus resume/reconnect/manual refresh, picks up other clients’ saved positions without consuming `conversation.seen` notifications. Polling refreshes read state without downloading message history.

Sending text, a GIF, or an uploaded attachment clears the composer and adds a local bubble immediately. Sends run concurrently without blocking the next draft or replacing the send icon with a spinner. A clock indicates a pending send, a tick confirms delivery to the server, and a red exclamation mark indicates failure. Failed bubbles retain their text, attachment and reply target and offer retry/discard through message options. The session-owned outbox survives conversation navigation, reconciles HTTP responses and realtime echoes, and only uses confirmed server IDs for seen updates. Voice recordings enter the same outbox after their media upload completes. Sign-out/server changes discard the session outbox.

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

Music uploads read local title, artist, duration, and artwork before displaying
the pending bubble. Missing or unreadable tags use the same fixed music layout
and fallbacks as sent messages. Reads use file ranges with time and memory limits.
The `music-metadata>file-type` pnpm override keeps file-type on 21.3.4 because
22.x uses regular expression flags unsupported by this SDK's Android Hermes compiler.

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
