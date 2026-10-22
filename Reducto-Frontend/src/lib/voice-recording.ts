import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import type { RecordingSession } from './voice-recording.types';

export async function beginVoiceRecording(signal: AbortSignal): Promise<RecordingSession> {
  const permission = await requestRecordingPermissionsAsync();
  if (!permission.granted) throw new Error('Allow microphone access to record voice messages.');
  if (signal.aborted) throw new Error('Recording cancelled');
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
  });
  if (signal.aborted) {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    throw new Error('Recording cancelled');
  }
  const preset = RecordingPresets.HIGH_QUALITY;
  // The native bridge exports this constructor dynamically; TypeScript verifies it.
  // eslint-disable-next-line import/namespace
  const { AudioRecorder: Recorder } = AudioModule;
  const recorder = new Recorder({
    extension: preset.extension,
    sampleRate: preset.sampleRate,
    numberOfChannels: 1,
    bitRate: 64000,
    ...(Platform.OS === 'ios' ? preset.ios : preset.android),
  });
  let released = false;
  let stopping = false;
  let cancelled = false;
  const release = () => {
    if (released) return;
    released = true;
    recorder.release();
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  };
  try {
    await recorder.prepareToRecordAsync();
    if (signal.aborted) {
      release();
      throw new Error('Recording cancelled');
    }
    recorder.record();
    const started = Date.now();
    return {
      stop: async () => {
        stopping = true;
        try {
          const duration = Math.max(
            recorder.getStatus().durationMillis / 1000,
            (Date.now() - started) / 1000,
          );
          await recorder.stop();
          const uri = recorder.uri;
          if (!uri) throw new Error('The voice recording could not be saved.');
          const dispose = () => {
            const file = new File(uri);
            if (file.exists) file.delete();
          };
          if (cancelled) {
            dispose();
            throw new Error('Recording cancelled');
          }
          return {
            asset: { uri, name: `voice-${Date.now()}.m4a`, mimeType: 'audio/mp4' },
            duration,
            dispose,
          };
        } finally {
          release();
        }
      },
      cancel: () => {
        cancelled = true;
        if (!stopping) {
          const uri = recorder.uri;
          release();
          if (uri) {
            const file = new File(uri);
            if (file.exists) file.delete();
          }
        }
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
