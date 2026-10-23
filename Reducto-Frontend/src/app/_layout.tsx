import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../context/SessionContext';
import { colors } from '../components/ui';
import { IconFontGate } from '../components/IconFontGate';

function Navigation() {
  const { ready } = useSession();
  if (!ready)
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'white',
        }}
      >
        <ActivityIndicator color={colors.blue} />
      </View>
    );
  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />;
}
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <View style={{ flex: 1 }}>
          <StatusBar style="dark" />
          <IconFontGate>
            <Navigation />
          </IconFontGate>
        </View>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
