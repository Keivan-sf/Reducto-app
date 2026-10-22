import type { UploadAsset } from './uploads';
export interface RecordedVoice {
  asset: UploadAsset;
  duration: number;
  dispose: () => void;
}
export interface RecordingSession {
  stop: () => Promise<RecordedVoice>;
  cancel: () => void;
}
export type RecordingPhase = 'idle' | 'preparing' | 'recording' | 'stopping' | 'sending';
