// Matches MAX_ATTACHMENT_SIZE_BYTES and MAX_GIF_SIZE_BYTES in the backend.
export const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

export function uploadSizeError(size = 0, label = 'file'): string | undefined {
  if (size > MAX_UPLOAD_SIZE_BYTES) return `Choose a ${label} no larger than 2 GB.`;
}
