import { internalLinkPath } from '../lib/links';

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return /^reducto:/i.test(path) ? internalLinkPath(path) : path;
}
