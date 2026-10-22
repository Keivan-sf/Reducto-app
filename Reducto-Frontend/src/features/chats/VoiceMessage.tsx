import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
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

export function VoiceMessage({
  conversationId,
  mediaId,
  active,
  onOptions,
  onError,
}: {
  conversationId: string;
  mediaId: string;
  active: boolean;
  onOptions: (event: GestureResponderEvent) => void;
  onError: (message: string) => void;
}) {
  const { state, download } = useCachedFile(voiceFileKey(conversationId, mediaId), active);
  const [autoplay, setAutoplay] = useState(false);
  useEffect(() => {
    if (active) void download().catch(() => {});
  }, [active, download]);
  return state.status === 'ready' ? (
    <VoicePlayer
      uri={state.file.uri}
      durationHint={state.file.duration}
      autoplay={autoplay}
      active={active}
      onOptions={onOptions}
      onError={onError}
    />
  ) : (
    <View style={s.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Play voice message"
        onLongPress={onOptions}
        onPress={(event) => {
          event.stopPropagation();
          setAutoplay(true);
          void download().catch((err) => onError(err.message));
        }}
        style={s.play}
      >
        {state.status === 'loading' ? (
          <ActivityIndicator color="white" />
        ) : (
          <Icon name="play" color="white" size={24} />
        )}
      </Pressable>
      <View style={{ flex: 1, gap: 8 }}>
        <View style={s.track} />
        <Text style={s.time}>{state.status === 'error' ? 'Tap to retry' : 'Voice message'}</Text>
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
}: {
  uri: string;
  durationHint?: number;
  autoplay: boolean;
  active: boolean;
  onOptions: (event: GestureResponderEvent) => void;
  onError: (message: string) => void;
}) {
  const player = useAudioPlayer(uri, { updateInterval: 150 });
  const status = useAudioPlayerStatus(player);
  const focused = useIsFocused();
  const mounted = useRef(true);
  const autoplayed = useRef(false);
  const [trackWidth, setTrackWidth] = useState(1);
  const duration =
    Number.isFinite(status.duration) && status.duration > 0 ? status.duration : (durationHint ?? 0);
  const fraction = duration > 0 ? Math.min(1, Math.max(0, status.currentTime / duration)) : 0;
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
  const seek = (seconds: number) => {
    void player
      .seekTo(Math.min(duration, Math.max(0, seconds)))
      .catch(() => onError('Could not seek this voice message.'));
  };
  return (
    <View testID="voice-player" style={s.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice message' : 'Play voice message'}
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
        <Icon name={status.playing ? 'pause' : 'play'} color="white" size={24} />
      </Pressable>
      <View style={{ flex: 1, gap: 5 }}>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Voice message progress"
          aria-valuemin={0}
          aria-valuemax={Math.ceil(duration)}
          aria-valuenow={Math.floor(status.currentTime)}
          aria-valuetext={`${videoTime(status.currentTime)} of ${videoTime(duration)}`}
          accessibilityValue={{
            min: 0,
            max: Math.ceil(duration),
            now: Math.floor(status.currentTime),
            text: `${videoTime(status.currentTime)} of ${videoTime(duration)}`,
          }}
          onLayout={({ nativeEvent }) => setTrackWidth(nativeEvent.layout.width)}
          onPress={(event) => {
            event.stopPropagation();
            if (!duration) return;
            if (Platform.OS === 'web') {
              const pointer = event as unknown as {
                nativeEvent: { clientX: number };
                currentTarget: HTMLElement;
              };
              const bounds = pointer.currentTarget.getBoundingClientRect();
              if (Number.isFinite(pointer.nativeEvent.clientX) && bounds.width)
                seek(((pointer.nativeEvent.clientX - bounds.left) / bounds.width) * duration);
            } else if (Number.isFinite(event.nativeEvent.locationX))
              seek((event.nativeEvent.locationX / trackWidth) * duration);
          }}
          onLongPress={onOptions}
          {...(Platform.OS === 'web'
            ? {
                onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    seek(status.currentTime + (event.key === 'ArrowRight' ? 5 : -5));
                  }
                },
              }
            : {})}
          style={s.seek}
        >
          <View style={s.track}>
            <View style={[s.fill, { width: `${fraction * 100}%` }]} />
            <View style={[s.dot, { left: `${fraction * 100}%` }]} />
          </View>
        </Pressable>
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
  seek: { height: 28, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, backgroundColor: '#3390EC38' },
  fill: { height: 3, backgroundColor: colors.blue, borderRadius: 2 },
  dot: {
    position: 'absolute',
    top: -2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.blue,
    marginLeft: -3,
  },
  time: { fontSize: 12, color: '#6C93AF' },
});
