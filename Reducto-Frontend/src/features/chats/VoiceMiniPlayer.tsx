import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, Icon, Notice } from '../../components/ui';
import { useVoicePlayback, useVoicePlaybackState } from '../../context/VoicePlaybackContext';
import { useProfiles } from '../../context/ProfilesContext';
import { profileName } from '../../lib/messages';

export function VoiceMiniPlayer() {
  const playback = useVoicePlayback();
  const state = useVoicePlaybackState();
  const { profiles } = useProfiles();
  if (!state.track) return null;
  const audio = state.track.kind === 'music' || state.track.kind === 'audio';
  const label = audio ? 'audio' : 'voice message';
  return (
    <View testID={audio ? 'audio-mini-player' : 'voice-mini-player'} style={s.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${state.playing ? 'Pause' : 'Play'} current ${label}`}
        onPress={() => (state.playing ? playback.pause() : void playback.resume())}
        style={s.button}
      >
        <Icon name={state.playing ? 'pause' : 'play'} color={colors.blue} size={19} />
      </Pressable>
      <Text numberOfLines={1} style={s.name}>
        {audio
          ? [state.track.title, state.track.artist].filter(Boolean).join(' · ')
          : profileName(profiles[state.track.senderId])}
      </Text>
      <Notice text={state.error ?? ''} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={audio ? 'Close audio player' : 'Close voice player'}
        onPress={playback.close}
        style={s.button}
      >
        <Icon name="close" size={19} color={colors.muted} />
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  bar: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.pale,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 6,
    gap: 6,
  },
  button: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, color: colors.dark, fontSize: 13, fontWeight: '500' },
});
