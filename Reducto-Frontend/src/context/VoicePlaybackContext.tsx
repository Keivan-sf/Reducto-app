import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { VoicePlayback } from '../lib/voice-playback';
import { useVideos } from './VideosContext';

const Context = createContext<VoicePlayback>(null!);
export function VoicePlaybackProvider({ children }: PropsWithChildren) {
  const cache = useVideos();
  const [playback] = useState(
    () =>
      new VoicePlayback(
        (uri) => createAudioPlayer(uri, { updateInterval: 150 }),
        () => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }),
        (key) => cache.subscribe(key, () => {}),
      ),
  );
  useEffect(() => () => playback.close(), [playback]);
  return <Context.Provider value={playback}>{children}</Context.Provider>;
}
export const useVoicePlayback = () => useContext(Context);
export function useVoicePlaybackState() {
  const playback = useVoicePlayback();
  return useSyncExternalStore(playback.subscribe, playback.read, playback.read);
}
