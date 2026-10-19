import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '../../context/SessionContext';
import type { Gif } from '../../api/types';
import { Button, Dialog, Field, Notice, styles } from '../../components/ui';
import { fileForm } from '../../lib/uploads';
import { objectUrl } from '../../lib/config';

export function GifDialog({
  visible,
  onClose,
  onSend,
}: {
  visible: boolean;
  onClose: () => void;
  onSend: (id: string) => Promise<void>;
}) {
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [gifId, setGifId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const result = await api.get<{ gifs: Gif[] }>('/api/gifs');
    setGifs(result.gifs);
  }
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    void api
      .get<{ gifs: Gif[] }>('/api/gifs', controller.signal)
      .then((result) => setGifs(result.gifs))
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [visible]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['image/gif', 'video/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    await run(async () => {
      const file = picked.assets[0];
      if ((file.size ?? 0) > 50 * 1024 * 1024)
        throw new Error('Choose a GIF or video smaller than 50 MB.');
      const body = await fileForm('gif', file);
      await api.request('/api/gifs', { method: 'POST', body, signal: AbortSignal.timeout(120000) });
      await load();
    });
  }
  return (
    <Dialog visible={visible} title="Your GIF library" onClose={onClose}>
      <Text style={styles.subtitle}>Upload a GIF or video, or add a GIF shared with you.</Text>
      <Button
        title="Upload GIF or video"
        secondary
        busy={busy}
        onPress={() => void upload().catch((err) => setError(err.message))}
      />
      <Field
        label="Add an existing GIF by ID"
        value={gifId}
        onChangeText={setGifId}
        autoCapitalize="none"
        placeholder="GIF ID"
      />
      <Button
        title="Add to library"
        secondary
        disabled={busy || !gifId.trim()}
        onPress={() =>
          void run(async () => {
            await api.request(`/api/gifs/${encodeURIComponent(gifId.trim())}`, { method: 'PUT' });
            setGifId('');
            await load();
          })
        }
      />
      <Notice text={error} />
      {!gifs.length && (
        <Text style={styles.subtitle}>Your library is empty. Add your first GIF above.</Text>
      )}
      {gifs.map((gif, index) => (
        <View
          key={gif.id}
          style={{ gap: 8, padding: 14, borderRadius: 12, backgroundColor: '#F4F7FA' }}
        >
          <Text style={styles.title}>GIF {index + 1}</Text>
          <Text selectable style={{ color: '#7A8A99', fontSize: 11 }}>
            {gif.id}
          </Text>
          <Text style={styles.subtitle}>{(gif.fileSize / 1024 / 1024).toFixed(1)} MB</Text>
          {objectUrl(gif.objectKey) && (
            <Button
              title="Open GIF"
              secondary
              onPress={() =>
                void Linking.openURL(objectUrl(gif.objectKey)!).catch((err) =>
                  setError(err.message),
                )
              }
            />
          )}
          <Button
            title="Send GIF"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await onSend(gif.id);
                onClose();
              })
            }
          />
          <Button
            title="Remove from library"
            secondary
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await api.request(`/api/gifs/${gif.id}`, { method: 'DELETE' });
                await load();
              })
            }
          />
        </View>
      ))}
    </Dialog>
  );
}
