import { useTheme } from '../context/ThemeContext';
import { useSyncExternalStore, type PropsWithChildren } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function subscribeToKeyboard(onChange: () => void) {
  if (Platform.OS !== 'android') return () => {};
  const shown = Keyboard.addListener('keyboardDidShow', onChange);
  const hidden = Keyboard.addListener('keyboardDidHide', onChange);
  return () => {
    shown.remove();
    hidden.remove();
  };
}
const keyboardIsVisible = () => Platform.OS === 'android' && Keyboard.isVisible();
const serverKeyboardIsVisible = () => false;

export function AppViewport({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  const keyboardVisible = useSyncExternalStore(
    subscribeToKeyboard,
    keyboardIsVisible,
    serverKeyboardIsVisible,
  );

  return (
    // Use screen coordinates for keyboard avoidance, outside the safe area.
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      enabled={Platform.OS === 'android'}
      behavior="height"
    >
      {/* The keyboard already covers the navigation bar. Its bottom inset must
          not be added a second time above the keyboard. */}
      <SafeAreaView
        style={{ flex: 1 }}
        edges={keyboardVisible ? ['top', 'left', 'right'] : ['top', 'left', 'right', 'bottom']}
      >
        {children}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
