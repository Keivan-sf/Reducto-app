/** Renew signed media before either the conservative TTL or URL expiry. */
export function signedMediaRenewAt(urls: (string | null | undefined)[], now = Date.now()) {
  let renewAt = now + 10 * 60 * 1000;
  for (const url of urls) {
    if (!url) continue;
    try {
      const params = new URL(url).searchParams;
      const date = params.get('X-Amz-Date');
      const seconds = Number(params.get('X-Amz-Expires'));
      if (!date || !/^\d{8}T\d{6}Z$/.test(date) || seconds <= 0) continue;
      const start = Date.parse(
        `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`,
      );
      if (Number.isFinite(start) && Number.isFinite(seconds))
        renewAt = Math.min(renewAt, start + seconds * 1000 - 60000);
    } catch {
      /* Non-S3 URLs use the conservative TTL. */
    }
  }
  return renewAt;
}
