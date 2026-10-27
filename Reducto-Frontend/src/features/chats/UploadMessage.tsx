import { createThemedStyles } from '../../context/ThemeContext';
import { memo, useCallback, useState, useSyncExternalStore } from 'react';
import type { MessageOutbox } from '../../api/message-outbox';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PendingUpload } from '../../api/types';
import { Icon } from '../../components/ui';
import { mediaPreviewSize, type MediaSize } from '../../lib/media-preview';
import { videoBytes, videoTime } from '../../lib/video-download.types';
import { DownloadProgressRing } from './DownloadProgressRing';
import { AttachmentControlIcon } from './AttachmentControlIcon';
import { VideoPlayback } from './VideoPlayback';
import { VoiceSeekBar } from './VoiceSeekBar';

const UploadVideoPreview = memo(VideoPlayback);

export function UploadMessage({
  upload: initialUpload,
  outbox,
  localId,
  failed,
  onCancel,
  onRetry,
}: {
  upload: PendingUpload;
  outbox: MessageOutbox;
  localId: string;
  failed: boolean;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const s = useStyles();
  const subscribe = useCallback(
    (listener: () => void) => outbox.subscribeUpload(localId, listener),
    [outbox, localId],
  );
  const snapshot = useCallback(
    () => outbox.getUpload(localId) ?? initialUpload,
    [outbox, localId, initialUpload],
  );
  const upload = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [size, setSize] = useState<MediaSize>();
  const visual = ['image', 'video', 'gif'].includes(upload.type);
  const progress = upload.total ? upload.sent / upload.total : 0;
  const status = failed
    ? 'Tap to retry'
    : `${videoBytes(upload.sent)} / ${videoBytes(upload.total)}`;
  const control = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={failed ? `Retry ${upload.type} upload` : `Cancel ${upload.type} upload`}
      onPress={(event) => {
        event.stopPropagation();
        if (failed) onRetry();
        else onCancel();
      }}
      style={[s.control, visual && s.visualControl]}
    >
      {!failed && <DownloadProgressRing progress={progress} label="Upload progress" />}
      {failed ? (
        <Icon name="refresh" color="white" size={24} />
      ) : (
        <AttachmentControlIcon name="close" />
      )}
    </Pressable>
  );
  if (visual)
    return (
      <View testID="upload-media" style={[s.media, mediaPreviewSize(size)]}>
        {!!upload.uri &&
          (upload.type === 'video' ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <UploadVideoPreview
                uri={upload.uri}
                active={false}
                muted
                nativeControls={false}
                onSize={setSize}
              />
            </View>
          ) : (
            <Image
              source={{ uri: upload.uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onLoad={(event) => setSize(event.nativeEvent.source)}
            />
          ))}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.shade]} />
        {control}
        {(upload.type !== 'image' || failed) && <Text style={s.badge}>{status}</Text>}
      </View>
    );
  return (
    <View testID="upload-file" style={[s.row, upload.type === 'voice' && s.voiceRow]}>
      {control}
      <View style={[s.details, upload.type === 'voice' && s.voiceDetails]}>
        {upload.type === 'voice' ? (
          <VoiceSeekBar
            value={0}
            duration={upload.duration ?? 0}
            enabled={false}
            onSeek={() => {}}
          />
        ) : (
          <Text numberOfLines={1} style={s.name}>
            {upload.name}
          </Text>
        )}
        <Text style={s.status}>
          {upload.type === 'voice' && !failed ? videoTime(upload.duration ?? 0) : status}
        </Text>
      </View>
    </View>
  );
}
const useStyles = createThemedStyles((colors) => ({
  row: {
    width: 280,
    maxWidth: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // Match the completed voice player's width and seek/duration spacing.
  voiceRow: { width: 236 },
  voiceDetails: { gap: 0 },
  control: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visualControl: { backgroundColor: '#00000070' },
  details: { flex: 1, minWidth: 0, gap: 5 },
  name: { color: colors.dark, fontSize: 14, fontWeight: '500' },
  status: { color: colors.fileAccent, fontSize: 12, lineHeight: 14 },
  media: {
    maxWidth: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#17212B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shade: { backgroundColor: '#00000035' },
  badge: {
    position: 'absolute',
    top: 7,
    left: 7,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 12,
    color: 'white',
    backgroundColor: '#00000070',
    fontSize: 12,
  },
}));
