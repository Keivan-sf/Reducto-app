import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../context/SessionContext';

import { NoticeProvider } from '../components/Notice';
import { IconFontGate } from '../components/IconFontGate';

function Navigation() {
  const { colors } = useTheme();
  const { ready } = useSession();
  if (!ready)
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.surface,
        }}
      >
        <ActivityIndicator color={colors.blue} />
      </View>
    );
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        contentStyle: { backgroundColor: colors.surface },
      }}
    />
  );
}
function ThemedApp() {
  const { theme, colors } = useTheme();
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <View style={{ flex: 1, backgroundColor: colors.surface }}>
          <NoticeProvider>
            <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
            <IconFontGate>
              <Navigation />
            </IconFontGate>
          </NoticeProvider>
        </View>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  );
}
