import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, Icon } from '../../components/ui';
import { useVoicePlayback, useVoicePlaybackState } from '../../context/VoicePlaybackContext';
import { useProfiles } from '../../context/ProfilesContext';
import { profileName } from '../../lib/messages';

export function VoiceMiniPlayer() {
  const playback = useVoicePlayback();
  const state = useVoicePlaybackState();
  const { profiles } = useProfiles();
  if (!state.track) return null;
  return (
    <View testID="voice-mini-player" style={s.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          state.playing ? 'Pause current voice message' : 'Play current voice message'
        }
        onPress={() => (state.playing ? playback.pause() : void playback.resume())}
        style={s.button}
      >
        <Icon name={state.playing ? 'pause' : 'play'} color={colors.blue} size={19} />
      </Pressable>
      <Text numberOfLines={1} style={s.name}>
        {profileName(profiles[state.track.senderId])}
      </Text>
      {!!state.error && (
        <Text numberOfLines={1} accessibilityRole="alert" style={s.error}>
          Unable to play
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close voice player"
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
  error: { color: colors.danger, fontSize: 11, flexShrink: 1 },
});
