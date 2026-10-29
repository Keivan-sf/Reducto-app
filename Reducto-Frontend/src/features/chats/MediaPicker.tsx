import { useTheme, createThemedStyles } from '../../context/ThemeContext';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View, type ScrollViewProps } from 'react-native';
import { pickUpload } from '../../lib/pick-upload';
import { api, useSession } from '../../context/SessionContext';
import type { Gif } from '../../api/types';
import { Button, Dialog, Field, Icon, IconButton, Notice } from '../../components/ui';
import { fileForm } from '../../lib/uploads';
import { uploadSizeError } from '../../lib/upload-limits';
import { GifPreview } from './GifPreview';
import { useVideos, gifFileKey } from '../../context/VideosContext';
import { retainUpload } from '../../lib/local-attachments';
import type { VideoFile } from '../../api/video-cache';
import { useGifs } from '../../context/GifsContext';
import { EmojiPanel } from './EmojiPanel';
import { gifRecencyStore } from '../../lib/gif-recency-store';
import { sortGifsByRecency } from '../../lib/gif-recency';
import { ChatHistoryScrollView } from './ChatHistoryScrollView';

function renderGifScroll(props: ScrollViewProps) {
  return (
    <ChatHistoryScrollView
      {...props}
      scrollbarInverted={false}
      scrollbarLabel="GIF menu scrollbar"
    />
  );
}

type Tab = 'GIF' | 'Emoji';
export function MediaPicker({
  onClose,
  onSend,
  onEmoji,
  onHoldOpen,
  height,
}: {
  onClose: () => void;
  onSend: (id: string) => boolean;
  onEmoji: (emoji: string) => void;
  onHoldOpen: (hold: boolean) => void;
  height: number;
}) {
  const { colors } = useTheme();
  const s = useStyles();
  const { session } = useSession();
  const recency = gifRecencyStore(session!.user.id);
  const order = useSyncExternalStore(recency.subscribe, recency.snapshot, recency.snapshot);
  const cache = useGifs();
  const files = useVideos();
  const [gifs, setGifs] = useState<Gif[]>([]);
  const sortedGifs = useMemo(() => sortGifsByRecency(gifs, order), [gifs, order]);
  const [gifId, setGifId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<Tab>('GIF');
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const viewability = useCallback(({ viewableItems }: { viewableItems: { item: Gif }[] }) => {
    setVisibleIds(new Set(viewableItems.map(({ item }) => item.id)));
  }, []);
  function showAdd(show: boolean) {
    setAdding(show);
    onHoldOpen(show);
  }
  async function load() {
    const result = await api.get<{ gifs: Gif[] }>('/api/gifs');
    result.gifs.forEach((gif) => cache.remember(gif));
    await recency.syncLibrary(result.gifs.map((gif) => gif.id));
    setGifs(result.gifs);
  }
  useEffect(() => {
    const controller = new AbortController();
    void api
      .get<{ gifs: Gif[] }>('/api/gifs', controller.signal)
      .then(async (result) => {
        result.gifs.forEach((gif) => cache.remember(gif));
        await recency.syncLibrary(result.gifs.map((gif) => gif.id));
        if (!controller.signal.aborted) setGifs(result.gifs);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cache, recency]);
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
    const picked = await pickUpload(['image/gif', 'video/*']);
    if (picked.canceled) return;
    await run(async () => {
      const file = picked.assets[0];
      const sizeError = uploadSizeError(file.size, 'GIF or video');
      if (sizeError) throw new Error(sizeError);
      let local: VideoFile | undefined;
      try {
        local = await retainUpload(file);
        const retainedSizeError = uploadSizeError(local.bytes, 'GIF or video');
        if (retainedSizeError) throw new Error(retainedSizeError);
        const body = await fileForm('gif', { ...file, uri: local.uri });
        const { gif } = await api.request<{ gif: Gif }>('/api/gifs', {
          method: 'POST',
          body,
        });
        await recency.record(gif.id);
        cache.remember(gif);
        files.remember(gifFileKey(gif.id), local);
        local = undefined;
      } finally {
        local?.dispose();
      }
      await load();
      showAdd(false);
    });
  }
  return (
    <View testID="media-picker" style={[s.panel, { height }]}>
      {tab === 'Emoji' ? (
        <EmojiPanel onSelect={onEmoji} />
      ) : (
        <>
          <View style={s.header}>
            <Text style={s.heading}>GIFs</Text>
            <IconButton name="close-outline" label="Close media picker" onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            {loading ? (
              <ActivityIndicator style={s.empty} color={colors.blue} />
            ) : (
              <FlatList
                renderScrollComponent={renderGifScroll}
                data={sortedGifs}
                numColumns={3}
                keyExtractor={(gif) => gif.id}
                contentContainerStyle={{ padding: 8, paddingBottom: 64, flexGrow: 1 }}
                columnWrapperStyle={{ gap: 2 }}
                ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
                onViewableItemsChanged={viewability}
                viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
                initialNumToRender={12}
                windowSize={3}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <View style={s.empty}>
                    <Icon name="images-outline" size={40} />
                    <Text style={s.emptyTitle}>Your GIF collection</Text>
                    <Text style={s.emptyText}>Tap + to add a GIF or video.</Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityRole="button"
                    testID={`gif-choice-${item.id}`}
                    accessibilityLabel="Send GIF"
                    accessibilityHint="Immediately sends this GIF to the chat"
                    disabled={busy}
                    onPress={() => {
                      try {
                        if (onSend(item.id)) {
                          void recency.record(item.id);
                          onClose();
                        }
                      } catch (err) {
                        setError((err as Error).message);
                      }
                    }}
                    onLongPress={() => {
                      setGifId(item.id);
                      showAdd(true);
                    }}
                    style={({ pressed }) => [s.tile, { opacity: pressed || busy ? 0.6 : 1 }]}
                  >
                    <GifPreview
                      gifId={item.id}
                      initialMetadata={item}
                      active={tab === 'GIF' && visibleIds.has(item.id)}
                      fill
                    />
                  </Pressable>
                )}
              />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a new GIF"
              onPress={() => showAdd(true)}
              style={s.add}
            >
              <Icon name="add" size={28} color="white" />
            </Pressable>
          </View>
        </>
      )}
      <Notice text={error} onDismiss={() => setError('')} />
      <View accessibilityRole="tablist" style={s.tabs}>
        {(['GIF', 'Emoji'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            onPress={() => setTab(value)}
            style={s.tab}
          >
            <Text
              style={{
                color: tab === value ? colors.blue : colors.muted,
                fontWeight: tab === value ? '600' : '400',
              }}
            >
              {value}
            </Text>
            {tab === value && <View style={s.underline} />}
          </Pressable>
        ))}
      </View>
      <Dialog
        visible={adding}
        title="Add a GIF"
        onClose={() => {
          if (!busy) showAdd(false);
        }}
      >
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
          disabled={busy || !gifId.trim()}
          onPress={() =>
            void run(async () => {
              await api.request(`/api/gifs/${encodeURIComponent(gifId.trim())}`, { method: 'PUT' });
              await recency.record(gifId.trim());
              setGifId('');
              await load();
              showAdd(false);
            })
          }
        />
        {gifs.some((gif) => gif.id === gifId.trim()) && (
          <Button
            title="Remove from library"
            secondary
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await api.request(`/api/gifs/${encodeURIComponent(gifId.trim())}`, {
                  method: 'DELETE',
                });
                setGifId('');
                await load();
                showAdd(false);
              })
            }
          />
        )}
        <Notice text={error} onDismiss={() => setError('')} />
      </Dialog>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  panel: {
    backgroundColor: colors.surface,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  header: {
    height: 44,
    paddingLeft: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  heading: { color: colors.muted, fontSize: 14 },
  tile: { width: '33.0%', aspectRatio: 1.25, overflow: 'hidden', backgroundColor: colors.pale },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, padding: 24 },
  emptyTitle: { color: colors.dark, fontSize: 16, fontWeight: '600' },
  emptyText: { color: colors.muted, textAlign: 'center', padding: 8 },
  add: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 3px 10px #17212B33',
  },
  tabs: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.pickerBackground,
  },
  tab: { minWidth: 72, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  underline: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.blue,
  },
}));
