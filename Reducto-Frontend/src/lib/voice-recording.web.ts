import type { RecordingSession } from './voice-recording.types';

export async function beginVoiceRecording(signal: AbortSignal): Promise<RecordingSession> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
    throw new Error('Voice recording requires a supported browser with HTTPS or localhost.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error('Allow microphone access to record voice messages.');
  }
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    stream.getTracks().forEach((track) => track.stop());
  };
  if (signal.aborted) {
    cleanup();
    throw new Error('Recording cancelled');
  }
  const mimeType = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ].find((type) => MediaRecorder.isTypeSupported(type));
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined,
    );
  } catch (error) {
    cleanup();
    throw error;
  }
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.addEventListener(
      'stop',
      () => {
        cleanup();
        resolve();
      },
      { once: true },
    );
    recorder.addEventListener(
      'error',
      () => {
        cleanup();
        reject(new Error('Voice recording failed. Please try again.'));
      },
      { once: true },
    );
  });
  void stopped.catch(() => {});
  try {
    recorder.start(250);
  } catch (error) {
    cleanup();
    throw error;
  }
  const started = Date.now();
  return {
    stop: async () => {
      const duration = (Date.now() - started) / 1000;
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      const type = recorder.mimeType || mimeType || 'audio/webm';
      const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const file = new File(chunks, `voice-${Date.now()}.${extension}`, { type });
      if (!file.size)
        throw new Error('The recording was empty. Hold the microphone and try again.');
      const uri = URL.createObjectURL(file);
      return {
        asset: { uri, name: file.name, mimeType: type, file },
        duration,
        dispose: () => URL.revokeObjectURL(uri),
      };
    },
    cancel: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      cleanup();
    },
  };
}
