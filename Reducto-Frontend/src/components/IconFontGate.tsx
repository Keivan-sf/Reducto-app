import { useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from './ui';

/** Keep icons from starting uncaught font downloads in their mount lifecycle. */
export function IconFontGate({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => Ionicons.loadFont())
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (ready) return children;
  // This screen deliberately uses no icon components, including its retry button.
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: 'white',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 16,
      }}
    >
      {failed ? (
        <>
          <Text accessibilityRole="alert" style={{ color: colors.dark, textAlign: 'center' }}>
            Could not load app icons. Check your connection and try again.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading icons"
            onPress={() => {
              setFailed(false);
              setAttempt((current) => current + 1);
            }}
            style={{ backgroundColor: colors.blue, padding: 14, borderRadius: 10 }}
          >
            <Text style={{ color: 'white', fontWeight: '600' }}>Try again</Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator accessibilityLabel="Loading app icons" color={colors.blue} />
      )}
    </View>
  );
}
