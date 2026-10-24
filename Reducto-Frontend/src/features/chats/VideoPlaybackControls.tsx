import { StyleSheet, Text, View } from 'react-native';
import { useEvent } from 'expo';
import type { VideoPlayer } from 'expo-video';
import { IconButton } from '../../components/ui';
import { videoTime } from '../../lib/video-download.types';
import { VoiceSeekBar } from './VoiceSeekBar';

export function VideoPlaybackControls({
  player,
  active,
  onTogglePlay,
  onToggleMute,
  onSeek,
}: {
  player: VideoPlayer;
  active: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onSeek: (seconds: number) => void;
}) {
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const time = useEvent(player, 'timeUpdate');
  const currentTime = time?.currentTime ?? player.currentTime;
  const loaded = useEvent(player, 'sourceLoad');
  const { muted } = useEvent(player, 'mutedChange', { muted: player.muted });
  const duration = loaded?.duration ?? player.duration;
  return (
    <View style={s.controls} testID="video-playback-controls">
      <View style={s.row}>
        <IconButton
          name={isPlaying ? 'pause' : 'play'}
          label={isPlaying ? 'Pause video' : 'Play video'}
          color="white"
          onPress={onTogglePlay}
        />
        <Text style={s.time}>
          {videoTime(currentTime)} / {videoTime(duration)}
        </Text>
        <IconButton
          name={muted ? 'volume-mute' : 'volume-high'}
          label={muted ? 'Unmute video' : 'Mute video'}
          color="white"
          onPress={onToggleMute}
        />
      </View>
      <VoiceSeekBar
        value={currentTime}
        duration={duration}
        enabled={active}
        accessibilityLabel="Video progress"
        onSeek={onSeek}
      />
    </View>
  );
}

const s = StyleSheet.create({
  controls: { paddingHorizontal: 16, paddingBottom: 8, backgroundColor: 'black' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { flex: 1, color: 'white', fontSize: 13 },
});
