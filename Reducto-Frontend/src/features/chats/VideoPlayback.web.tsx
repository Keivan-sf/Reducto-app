import { useState } from 'react';
import { Text, View } from 'react-native';
export function VideoPlayback({ uri }: { uri: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <video
        aria-label="Video player"
        src={uri}
        autoPlay
        controls
        playsInline
        preload="auto"
        onError={() => setFailed(true)}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          backgroundColor: 'black',
        }}
      />
      {failed && (
        <Text
          accessibilityRole="alert"
          style={{ color: 'white', textAlign: 'center', padding: 24 }}
        >
          This video could not be played.
        </Text>
      )}
    </View>
  );
}
