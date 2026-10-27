import { AppViewport } from '../components/AppViewport';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, useUIStyles } from '../components/ui';
export default function UnsupportedLink() {
  const styles = useUIStyles();
  return (
    <AppViewport>
      <View
        style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 20 }}
      >
        <Text style={styles.title}>Unsupported Reducto link</Text>
        <Text style={styles.subtitle}>
          This link is invalid or uses an action that isn’t supported yet.
        </Text>
        <Button title="Back to chats" onPress={() => router.replace('/')} />
      </View>
    </AppViewport>
  );
}
