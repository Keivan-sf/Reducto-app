import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { useIsFocused } from 'expo-router';
import { Icon, colors } from '../../components/ui';
import { useCachedFile, voiceFileKey } from '../../context/VideosContext';
import { videoTime } from '../../lib/video-download.types';
import { voicePlayback } from '../../lib/voice-playback';
import { VoiceSeekBar } from './VoiceSeekBar';
import type { AttachmentMetadata } from '../../api/types';

export function VoiceMessage({
  conversationId,
  mediaId,
  metadata,
  active,
  onOptions,
  onError,
  onSeekingChange,
}: {
  conversationId: string;
  mediaId: string;
  metadata?: AttachmentMetadata;
  active: boolean;
  onOptions: (event: GestureResponderEvent) => void;
  onError: (message: string) => void;
  onSeekingChange?: (seeking: boolean) => void;
}) {
  const { state, download } = useCachedFile(voiceFileKey(conversationId, mediaId), active);
  const [autoplay, setAutoplay] = useState(false);
  useEffect(() => {
    if (active) void download().catch(() => {});
  }, [active, download]);
  return state.status === 'ready' ? (
    <VoicePlayer
      uri={state.file.uri}
      durationHint={metadata?.durationSeconds ?? state.file.duration}
      autoplay={autoplay}
      active={active}
      onOptions={onOptions}
      onError={onError}
      onSeekingChange={onSeekingChange}
    />
  ) : (
    <View style={s.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          state.status === 'error' ? 'Retry voice message' : 'Loading voice message'
        }
        disabled={state.status !== 'error'}
        onLongPress={onOptions}
        onPress={(event) => {
          event.stopPropagation();
          setAutoplay(true);
          void download().catch((err) => onError(err.message));
        }}
        style={s.play}
      >
        {state.status === 'error' ? (
          <Icon name="play" color="white" size={24} />
        ) : (
          <ActivityIndicator color="white" accessibilityLabel="Loading voice message" />
        )}
      </Pressable>
      <View style={{ flex: 1, gap: 8 }}>
        <View style={s.track} />
        <Text style={s.time}>
          {state.status === 'error'
            ? `Tap to retry${metadata?.durationSeconds ? ` · ${videoTime(metadata.durationSeconds)}` : ''}`
            : metadata?.durationSeconds
              ? videoTime(metadata.durationSeconds)
              : 'Voice message'}
        </Text>
      </View>
    </View>
  );
}
function VoicePlayer({
  uri,
  durationHint,
  autoplay,
  active,
  onOptions,
  onError,
  onSeekingChange,
}: {
  uri: string;
  durationHint?: number;
  autoplay: boolean;
  active: boolean;
  onOptions: (event: GestureResponderEvent) => void;
  onError: (message: string) => void;
  onSeekingChange?: (seeking: boolean) => void;
}) {
  const player = useAudioPlayer(uri, { updateInterval: 150 });
  const status = useAudioPlayerStatus(player);
  const focused = useIsFocused();
  const mounted = useRef(true);
  const autoplayed = useRef(false);
  const duration =
    Number.isFinite(status.duration) && status.duration > 0 ? status.duration : (durationHint ?? 0);
  useEffect(() => {
    // useAudioPlayer releases its native object before this effect cleans up.
    // Even reading player.id after that release calls into the native bridge.
    const playerId = player.id;
    let alive = true;
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (alive && state !== 'active') player.pause();
    });
    return () => {
      alive = false;
      mounted.current = false;
      subscription.remove();
      voicePlayback.release(playerId);
    };
  }, [player]);
  useEffect(() => {
    if (!active || !focused) player.pause();
  }, [active, focused, player]);
  useEffect(() => {
    if (!autoplay || autoplayed.current || !active || !focused || !status.isLoaded) return;
    autoplayed.current = true;
    voicePlayback.claim(player.id, () => player.pause());
    player.play();
  }, [autoplay, active, focused, status.isLoaded, player]);
  useEffect(() => {
    if (status.error) onError('This voice message could not be played.');
  }, [status.error, onError]);
  const seek = async (seconds: number) => {
    try {
      await player.seekTo(Math.min(duration, Math.max(0, seconds)));
    } catch (error) {
      if (mounted.current) onError('Could not seek this voice message.');
      throw error;
    }
  };
  return (
    <View testID="voice-player" style={s.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          !status.isLoaded
            ? 'Loading voice message'
            : status.playing
              ? 'Pause voice message'
              : 'Play voice message'
        }
        disabled={!status.isLoaded}
        onLongPress={onOptions}
        onPress={(event) => {
          event.stopPropagation();
          if (status.playing) player.pause();
          else {
            voicePlayback.claim(player.id, () => player.pause());
            void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
              .then(async () => {
                if (!mounted.current || !active || !focused) return;
                if (duration && status.currentTime >= duration - 0.05) await player.seekTo(0);
                if (mounted.current) player.play();
              })
              .catch(() => onError('Could not play this voice message.'));
          }
        }}
        style={s.play}
      >
        {status.isLoaded ? (
          <Icon name={status.playing ? 'pause' : 'play'} color="white" size={24} />
        ) : (
          <ActivityIndicator color="white" accessibilityLabel="Loading voice message" />
        )}
      </Pressable>
      <View style={{ flex: 1, gap: 5 }}>
        <VoiceSeekBar
          value={status.currentTime}
          duration={duration}
          enabled={active && focused}
          onDraggingChange={onSeekingChange}
          onSeek={seek}
        />
        <Text style={s.time}>
          {videoTime(status.playing || status.currentTime > 0 ? status.currentTime : duration)}
          {status.playing ? ` / ${videoTime(duration)}` : ''}
        </Text>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  row: {
    width: 236,
    maxWidth: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  play: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.blue,
    justifyContent: 'center',
    alignItems: 'center',
  },
  track: { height: 3, borderRadius: 2, backgroundColor: '#3390EC38' },
  time: { fontSize: 12, color: '#6C93AF' },
});
