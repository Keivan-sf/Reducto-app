import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { api } from '../context/SessionContext';

export async function downloadAttachment(conversationId: string, mediaId: string) {
  const url = `${api.baseUrl}/api/conversations/${conversationId}/attachments/${mediaId}`;
  if (Platform.OS === 'web') {
    let response = await fetch(url, {
      headers: { Authorization: `Bearer ${api.getSession()?.accessToken}` },
    });
    if (response.status === 401) {
      await api.refresh();
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${api.getSession()?.accessToken}` },
      });
    }
    if (!response.ok) throw new Error('Could not download this attachment.');
    const blobUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = decodeURIComponent(
      response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ??
        response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        'attachment',
    );
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  } else {
    const destination = `${FileSystem.cacheDirectory}${mediaId}`;
    const get = () =>
      FileSystem.downloadAsync(url, destination, {
        headers: { Authorization: `Bearer ${api.getSession()?.accessToken}` },
      });
    let result = await get();
    if (result.status === 401) {
      await api.refresh();
      result = await get();
    }
    if (result.status !== 200) throw new Error('Could not download this attachment.');
    const disposition =
      result.headers['Content-Disposition'] ?? result.headers['content-disposition'];
    const fileName =
      disposition?.match(/filename="([^"]+)"/)?.[1]?.replace(/[/\\]/g, '_') ?? 'attachment';
    const namedUri = `${FileSystem.cacheDirectory}${mediaId}-${fileName}`;
    await FileSystem.deleteAsync(namedUri, { idempotent: true });
    await FileSystem.moveAsync({ from: result.uri, to: namedUri });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(namedUri);
    else throw new Error('Sharing files is unavailable on this device.');
  }
}
