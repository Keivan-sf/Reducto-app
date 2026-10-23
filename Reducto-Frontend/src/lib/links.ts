export const INVITE_TOKEN = /^[a-f0-9]{64}$/;
export function groupJoinPath(token: string) {
  if (!INVITE_TOKEN.test(token)) throw new Error('Invalid group invite.');
  return `/api/groups/join/${token}` as const;
}
export function groupInviteUri(token: string) {
  return `reducto://${groupJoinPath(token)}`;
}

// Accept only the supported action, never turn arbitrary custom paths into API requests.
export function groupInviteToken(value: string): string | null {
  const text = value.trim();
  if (INVITE_TOKEN.test(text)) return text;
  try {
    const url = new URL(text, 'https://reducto.invalid');
    const path =
      url.protocol === 'reducto:'
        ? `/${url.host}${url.pathname}`.replace(/^\/\//, '/')
        : url.pathname;
    if (
      !['reducto:', 'http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.protocol === 'reducto:' && url.port)
    )
      return null;
    return path.match(/^\/api\/groups\/join\/([a-f0-9]{64})\/?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}
export function inviteTokenFromPath(path: string) {
  return path.match(/^\/api\/groups\/join\/([a-f0-9]{64})\/?$/)?.[1] ?? null;
}
export function internalLinkPath(value: string) {
  // Expo Router supplies the app's root URI when launched from the home screen.
  if (/^reducto:\/\/\/?(?:[?#].*)?$/i.test(value)) return '/';
  const token = /^reducto:\/\//i.test(value) ? groupInviteToken(value) : null;
  return token ? groupJoinPath(token) : '/unsupported-link';
}

export interface TextPart {
  text: string;
  href?: string;
  internal?: boolean;
}
export function linkify(text: string): TextPart[] {
  const pattern = /\b(?:(?:https?|ftp|reducto):\/\/|www\.)[^\s<>"'\u0000-\u001f]+/gi;
  const parts: TextPart[] = [];
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    let label = match[0].replace(/[.,!?;:\u201d\u2019]+$/, '');
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ]) {
      while (label.endsWith(close) && label.split(close).length > label.split(open).length)
        label = label.slice(0, -1);
    }
    const href = /^www\./i.test(label) ? `https://${label}` : label;
    try {
      const url = new URL(href);
      if (url.protocol !== 'reducto:' && !url.hostname) continue;
      if (match.index > position) parts.push({ text: text.slice(position, match.index) });
      parts.push({ text: label, href, internal: url.protocol === 'reducto:' });
      position = match.index + label.length;
    } catch {
      /* Leave malformed URLs as ordinary text. */
    }
  }
  if (position < text.length) parts.push({ text: text.slice(position) });
  return parts;
}
