import type { Session } from '../api/types';

export const SERVER_KEY = 'reducto.server.v1';
export function normalizeServerUrl(input: string): string {
  const message =
    'Enter the server address, including http:// or https://, without /api or another path.';
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(message);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error(message);
  return url.origin;
}

export function parseStoredSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      !value?.user?.id ||
      typeof value.accessToken !== 'string' ||
      !value.accessToken ||
      typeof value.refreshToken !== 'string' ||
      !value.refreshToken ||
      typeof value.serverUrl !== 'string'
    )
      return null;
    return { ...value, serverUrl: normalizeServerUrl(value.serverUrl) };
  } catch {
    return null;
  }
}
