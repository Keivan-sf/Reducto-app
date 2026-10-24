import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Icon, colors } from '../../components/ui';
import { useCachedFile, voiceFileKey } from '../../context/VideosContext';
import { videoTime } from '../../lib/video-download.types';
import { useVoicePlayback, useVoicePlaybackState } from '../../context/VoicePlaybackContext';
import { VoiceSeekBar } from './VoiceSeekBar';
import { DownloadProgressRing } from './DownloadProgressRing';
import type { AttachmentMetadata } from '../../api/types';

export function VoiceMessage({
  conversationId,
  senderId,
  mediaId,
  metadata,
  active,
  onOptions,
  onError,
  onSeekingChange,
}: {
  conversationId: string;
  senderId: string;
  mediaId: string;
  metadata?: AttachmentMetadata;
  active: boolean;
  onOptions: (event: GestureResponderEvent) => void;
  onError: (message: string) => void;
  onSeekingChange?: (seeking: boolean) => void;
}) {
  const { state, download, cancel } = useCachedFile(voiceFileKey(conversationId, mediaId), active);
  const request = useRef(0);
  const [previousStatus, setPreviousStatus] = useState(state.status);
  const [completing, setCompleting] = useState(false);
  if (previousStatus !== state.status) {
    setPreviousStatus(state.status);
    setCompleting(previousStatus === 'loading' && state.status === 'ready');
  }
  useEffect(() => {
    if (!completing) return;
    // Allow the final eased stroke to finish, then hold the full circle for a second.
    const timer = setTimeout(() => setCompleting(false), 520);
    return () => clearTimeout(timer);
  }, [completing]);
  const loading = state.status === 'loading';
  const total = loading ? state.progress.total || metadata?.fileSize || 0 : 0;
  const progress = loading && total > 0 ? Math.min(1, state.progress.received / total) : 0;
  return (
    <VoicePlayer
      uri={state.status === 'ready' ? state.file.uri : undefined}
      fileKey={voiceFileKey(conversationId, mediaId)}
      senderId={senderId}
      durationHint={
        metadata?.durationSeconds ?? (state.status === 'ready' ? state.file.duration : undefined)
      }
      downloading={loading}
      completing={completing}
      progress={completing ? 1 : progress}
      failed={state.status === 'error'}
      onDownloadPress={() => {
        const current = ++request.current;
        if (loading) cancel();
        else
          void download().catch((err) => {
            if (request.current === current && err.name !== 'AbortError') onError(err.message);
          });
      }}
      active={active}
      onOptions={onOptions}
      onError={onError}
      onSeekingChange={onSeekingChange}
    />
  );
}
function VoicePlayer({
  uri,
  fileKey,
  senderId,
  durationHint,
  downloading,
  completing,
  progress,
  failed,
  onDownloadPress,
  active,
  onOptions,
  onError,
  onSeekingChange,
}: {
  uri?: string;
  fileKey: string;
  senderId: string;
  durationHint?: number;
  downloading: boolean;
  completing: boolean;
  progress: number;
  failed: boolean;
  onDownloadPress: () => void;
  active: boolean;
  onOptions: (event: GestureResponderEvent) => void;
  onError: (message: string) => void;
  onSeekingChange?: (seeking: boolean) => void;
}) {
  const playback = useVoicePlayback();
  const state = useVoicePlaybackState();
  const [probedDuration, setProbedDuration] = useState(0);
  const knownDuration = durationHint || probedDuration;
  const selected = state.track?.key === fileKey;
  const playing = selected && state.playing;
  const position = selected ? state.currentTime : 0;
  const duration = selected && state.duration > 0 ? state.duration : knownDuration;
  const ready = !!uri && !completing;
  const icon =
    downloading || completing ? 'close' : !ready ? 'arrow-down' : playing ? 'pause' : 'play';
  const seek = async (seconds: number) => {
    if (!uri) return;
    try {
      playback.select({ key: fileKey, uri, senderId, duration: knownDuration });
      await playback.seek(seconds);
    } catch (error) {
      onError('Could not seek this voice message.');
      throw error;
    }
  };
  return (
    <View testID={ready ? 'voice-player' : undefined} style={s.row}>
      {uri && !knownDuration && !selected && (
        <VoiceDurationProbe uri={uri} onDuration={setProbedDuration} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          completing
            ? 'Voice download complete'
            : downloading
              ? 'Cancel voice download'
              : !ready
                ? 'Download voice message'
                : playing
                  ? 'Pause voice message'
                  : 'Play voice message'
        }
        disabled={completing}
        onLongPress={onOptions}
        onPress={(event) => {
          event.stopPropagation();
          if (!uri) {
            onDownloadPress();
            return;
          }
          if (playing) playback.pause();
          else
            void playback
              .play({ key: fileKey, uri, senderId, duration: knownDuration })
              .catch(() => onError('Could not play this voice message.'));
        }}
        style={s.play}
      >
        {(downloading || completing) && <DownloadProgressRing progress={progress} />}
        <VoiceControlIcon name={icon} />
      </Pressable>
      <View style={s.controls}>
        {ready ? (
          <VoiceSeekBar
            value={position}
            duration={duration}
            enabled={active}
            onDraggingChange={onSeekingChange}
            onSeek={seek}
          />
        ) : (
          <View style={s.seekPlaceholder}>
            <View style={s.track} />
          </View>
        )}
        <Text style={s.time}>
          {failed
            ? `Tap to retry${duration ? ` · ${videoTime(duration)}` : ''}`
            : ready || duration
              ? videoTime(playing || position > 0 ? position : duration)
              : 'Voice message'}
          {ready && playing ? ` / ${videoTime(duration)}` : ''}
        </Text>
      </View>
    </View>
  );
}
const voiceIcons = ['arrow-down', 'close', 'play', 'pause'] as const;
function VoiceControlIcon({ name }: { name: (typeof voiceIcons)[number] }) {
  return (
    <View pointerEvents="none" style={{ width: 24, height: 24 }}>
      {voiceIcons.map((icon) => (
        <VoiceIconLayer key={icon} name={icon} visible={name === icon} />
      ))}
    </View>
  );
}
function VoiceIconLayer({
  name,
  visible,
}: {
  name: (typeof voiceIcons)[number];
  visible: boolean;
}) {
  const opacity = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: 140,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
  }, [visible, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      testID={`voice-icon-${name}`}
      style={[
        StyleSheet.absoluteFill,
        name === 'play' && { transform: [{ translateX: 1 }] },
        style,
      ]}
    >
      <Icon name={name} color="white" size={24} />
    </Animated.View>
  );
}
// Older messages may lack server duration metadata. This silent probe is
// released after reading the duration; it never owns message playback.
function VoiceDurationProbe({
  uri,
  onDuration,
}: {
  uri: string;
  onDuration: (value: number) => void;
}) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  useEffect(() => {
    if (Number.isFinite(status.duration) && status.duration > 0) onDuration(status.duration);
  }, [status.duration, onDuration]);
  return null;
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
  controls: { flex: 1 },
  // Match VoiceSeekBar's touch area so the duration stays put when loading finishes.
  seekPlaceholder: { height: 32, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, backgroundColor: '#3390EC38' },
  time: { fontSize: 12, lineHeight: 14, color: '#6C93AF' },
});
