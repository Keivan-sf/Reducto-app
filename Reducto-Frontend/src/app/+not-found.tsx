import { AppViewport } from '../components/AppViewport';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
export default function NotFound() {
  return (
    <AppViewport>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <Text>This page could not be found.</Text>
        <Link href="/">Go to your chats</Link>
      </View>
    </AppViewport>
  );
}
