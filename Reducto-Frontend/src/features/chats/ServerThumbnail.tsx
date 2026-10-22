import { useState } from 'react';
import { Image, StyleSheet } from 'react-native';

export function ServerThumbnail({ uri, label }: { uri?: string | null; label: string }) {
  const [failed, setFailed] = useState<string>();
  if (!uri || failed === uri) return null;
  return (
    <Image
      accessibilityLabel={label}
      source={{ uri }}
      resizeMode="contain"
      style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
      onError={() => setFailed(uri)}
    />
  );
}
