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

export function presenceLabel(presence?: UserPresence) {
  if (presence?.online) return 'online';
  if (!presence?.last_seen) return 'last seen a long time ago';
  const date = new Date(presence.last_seen);
  if (!Number.isFinite(date.getTime())) return 'last seen a long time ago';
  return `last seen ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
