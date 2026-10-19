import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Text, View } from 'react-native';
import { api, useSession } from '../../context/SessionContext';
import { colors } from '../../components/ui';

export function AttachmentImage({
  conversationId,
  mediaId,
}: {
  conversationId: string;
  mediaId: string;
}) {
  const { session } = useSession();
  const token = session!.accessToken;
  const path = `/api/conversations/${conversationId}/attachments/${mediaId}`;
  const [uri, setUri] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const controller = new AbortController();
    let objectUri: string | undefined;
    void (async () => {
      const get = () =>
        fetch(`${api.baseUrl}${path}`, {
          headers: { Authorization: `Bearer ${api.getSession()?.accessToken}` },
          signal: controller.signal,
        });
      let response = await get();
      if (response.status === 401) {
        await api.refresh();
        response = await get();
      }
      if (!response.ok) throw new Error('Image unavailable');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUri = URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' }));
      setUri(objectUri);
    })().catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => {
      controller.abort();
      if (objectUri) URL.revokeObjectURL(objectUri);
    };
  }, [path, token]);
  const source =
    Platform.OS === 'web'
      ? uri
        ? { uri }
        : undefined
      : { uri: `${api.baseUrl}${path}`, headers: { Authorization: `Bearer ${token}` } };
  return (
    <View
      style={{
        width: 230,
        maxWidth: '100%',
        height: 180,
        borderRadius: 10,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {failed ? (
        <Text style={{ color: colors.muted }}>Tap to download image</Text>
      ) : source ? (
        <Image
          source={source}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <ActivityIndicator color={colors.blue} />
      )}
    </View>
  );
}
