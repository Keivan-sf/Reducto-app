/** Pickers can label TypeScript's .ts extension as MPEG transport-stream video.
 * Prefer a document for source files, even when the picker reports media. */
export function uploadKind(mimeType?: string, fileName?: string): 'gif' | 'media' | 'document' {
  if (/\.(ts|tsx)$/i.test(fileName?.trim() ?? '')) return 'document';
  const type = mimeType?.split(';')[0].trim().toLowerCase();
  if (type === 'image/gif') return 'gif';
  return type && /^(image|video|audio)\//.test(type) ? 'media' : 'document';
}
