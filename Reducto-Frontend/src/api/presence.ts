import type { UserPresence } from './types';

export const PRESENCE_HEARTBEAT_MS = 30_000;

/** Never queue heartbeats while disconnected or while the app is in the background. */
export function startPresenceHeartbeat(
  socket: { connected: boolean; emit: (event: string) => unknown },
  isActive: () => boolean,
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  const pause = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const resume = () => {
    pause();
    if (disposed || !socket.connected || !isActive()) return;
    socket.emit('p');
    // The next heartbeat is a full interval after returning to the app.
    timer = setInterval(() => {
      if (!socket.connected || !isActive()) {
        pause();
        return;
      }
      socket.emit('p');
    }, PRESENCE_HEARTBEAT_MS);
  };
  return {
    resume,
    pause,
    dispose: () => {
      disposed = true;
      pause();
    },
  };
}

export function presenceLabel(presence?: UserPresence, now = Date.now()) {
  if (presence?.online) return 'online';
  if (!presence?.last_seen) return 'last seen a long time ago';
  const date = new Date(presence.last_seen);
  if (!Number.isFinite(date.getTime())) return 'last seen a long time ago';
  const minutes = Math.floor(Math.max(0, now - date.getTime()) / 60_000);
  if (minutes < 1) return 'last seen just now';
  if (minutes < 60) return `last seen ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  if (minutes < 12 * 60) {
    const hours = Math.floor(minutes / 60);
    return `last seen ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  if (minutes < 24 * 60) return `last seen at ${date.getHours()}:${pad(date.getMinutes())}`;
  return `last seen ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}
