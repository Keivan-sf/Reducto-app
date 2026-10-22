import type { VideoProgress } from '../api/video-cache';
export interface VideoDownloadRequest {
  url: string;
  headers: Record<string, string>;
  refresh: () => Promise<Record<string, string>>;
  signal: AbortSignal;
  progress: (value: VideoProgress) => void;
}
export function videoBytes(bytes: number) {
  if (bytes < 1024) return `${Math.max(0, bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function videoTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}
