import { createThemedStyles } from '../../context/ThemeContext';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { documentFileKey, useCachedFile, voiceFileKey } from '../../context/VideosContext';
import { videoTime } from '../../lib/video-download.types';
import { useVoicePlayback, useVoicePlaybackState } from '../../context/VoicePlaybackContext';
import { VoiceSeekBar } from './VoiceSeekBar';
import { AttachmentControlIcon } from './AttachmentControlIcon';
import { DownloadProgressRing } from './DownloadProgressRing';
import { useAttachmentMetadata } from '../../context/MediaMetadataContext';
import { ServerThumbnail } from './ServerThumbnail';
import type { AttachmentMetadata } from '../../api/types';
import { audioMessageLayout } from './audio-message-layout';

export function VoiceMessage({
  conversationId,
  senderId,
  mediaId,
  metadata: initialMetadata,
  kind = 'voice',
  active,
  onOptions,
  onError,
  onSeekingChange,
}: {
  conversationId: string;
  senderId: string;
  mediaId: string;
  metadata?: AttachmentMetadata;
  kind?: 'voice' | 'music' | 'audio';
  active: boolean;
  onOptions: (event: GestureResponderEvent) => void;
  onError: (message: string) => void;
  onSeekingChange?: (seeking: boolean) => void;
}) {
  const metadata = useAttachmentMetadata(conversationId, mediaId, active, initialMetadata);
  const fileKey =
    kind === 'voice'
      ? voiceFileKey(conversationId, mediaId)
      : documentFileKey(conversationId, mediaId);
  const { state, download, cancel } = useCachedFile(fileKey, active);
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
      fileKey={fileKey}
      kind={kind}
      metadata={metadata}
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
  kind,
  metadata,
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
  kind: 'voice' | 'music' | 'audio';
  metadata?: AttachmentMetadata;
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
  const s = useStyles();
  const audio = kind !== 'voice';
  const label = audio ? 'audio' : 'voice message';
  const title = metadata?.title?.trim() || metadata?.fileName || 'Audio';
  const artist = metadata?.artist?.trim() || 'Unknown artist';
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
  const track = uri
    ? { key: fileKey, uri, senderId, duration: knownDuration, kind, title, artist }
    : undefined;
  const seek = async (seconds: number) => {
    if (!track) return;
    try {
      playback.select(track);
      await playback.seek(seconds);
    } catch (error) {
      onError(`Could not seek this ${label}.`);
      throw error;
    }
  };
  return (
    <View testID={audio ? 'audio-player' : ready ? 'voice-player' : undefined} style={s.row}>
      {uri && !knownDuration && !selected && (
        <VoiceDurationProbe uri={uri} onDuration={setProbedDuration} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          completing
            ? audio
              ? 'Audio download complete'
              : 'Voice download complete'
            : downloading
              ? audio
                ? 'Cancel audio download'
                : 'Cancel voice download'
              : !ready
                ? `Download ${label}`
                : playing
                  ? `Pause ${label}`
                  : `Play ${label}`
        }
        disabled={completing}
        onLongPress={onOptions}
        onPress={(event) => {
          event.stopPropagation();
          if (!track) {
            onDownloadPress();
            return;
          }
          if (playing) playback.pause();
          else void playback.play(track).catch(() => onError(`Could not play this ${label}.`));
        }}
        style={[s.play, audio && s.audioPlay]}
      >
        {audio && (
          <ServerThumbnail
            uri={metadata?.coverUrl}
            cacheKey={`cover:${fileKey}:${metadata?.coverKey || ''}`}
            label="Audio cover"
          />
        )}
        {audio && !!metadata?.coverUrl && (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: '#00000045' }]}
          />
        )}
        {(downloading || completing) && <DownloadProgressRing progress={progress} />}
        <AttachmentControlIcon name={icon} />
      </Pressable>
      <View style={s.controls}>
        {audio && (
          <View style={s.heading}>
            <Text numberOfLines={1} style={s.title}>
              {title}
            </Text>
          </View>
        )}
        {audio && !playing ? (
          <Text numberOfLines={1} style={s.artist}>
            {artist}
          </Text>
        ) : ready ? (
          <VoiceSeekBar
            compact={audio}
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
            : audio
              ? `${videoTime(position)} / ${videoTime(duration)}`
              : ready || duration
                ? videoTime(playing || position > 0 ? position : duration)
                : 'Voice message'}
          {!audio && ready && playing ? ` / ${videoTime(duration)}` : ''}
        </Text>
      </View>
    </View>
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
const useStyles = createThemedStyles((colors) => ({
  row: audioMessageLayout.row,
  play: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.blue,
    justifyContent: 'center',
    alignItems: 'center',
  },
  audioPlay: { overflow: 'hidden' },
  heading: audioMessageLayout.heading,
  title: { ...audioMessageLayout.title, color: colors.dark },
  artist: { ...audioMessageLayout.artist, color: colors.muted },
  controls: audioMessageLayout.controls,
  // Match VoiceSeekBar's touch area so the duration stays put when loading finishes.
  seekPlaceholder: { height: 32, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, backgroundColor: '#3390EC38' },
  time: { ...audioMessageLayout.time, color: colors.fileAccent },
}));
