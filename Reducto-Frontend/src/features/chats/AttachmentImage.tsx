import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Text } from 'react-native';
import { api, useSession } from '../../context/SessionContext';
import { colors } from '../../components/ui';
import { MediaPreview } from './MediaPreview';
import type { MediaSize } from '../../lib/media-preview';

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
  const [size, setSize] = useState<MediaSize>();
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
      // React Native Web's onLoad event does not include native source dimensions.
      Image.getSize(
        objectUri,
        (width, height) => {
          if (!controller.signal.aborted) setSize({ width, height });
        },
        () => {},
      );
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
    <MediaPreview size={size} label="Image preview">
      {failed ? (
        <Text style={{ color: colors.muted }}>Tap to download image</Text>
      ) : source ? (
        <Image
          source={source}
          style={{ width: '100%', height: '100%' }}
          resizeMode="contain"
          onLoad={({ nativeEvent }) =>
            nativeEvent.source &&
            setSize({ width: nativeEvent.source.width, height: nativeEvent.source.height })
          }
          onError={() => setFailed(true)}
        />
      ) : (
        <ActivityIndicator color={colors.blue} />
      )}
    </MediaPreview>
  );
}
