import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconButton } from '../../components/ui';
import { createThemedStyles, useTheme } from '../../context/ThemeContext';
import type { VideoFile } from '../../api/video-cache';
import { retainUpload } from '../../lib/local-attachments';
import type { UploadAsset } from '../../lib/uploads';
import { VideoPlayback } from './VideoPlayback';

/** Own the original until Cancel disposes it or Send transfers it to the outbox. */
export function MediaSendPreview({
  asset,
  onClose,
  onSend,
}: {
  asset: UploadAsset;
  onClose: () => void;
  onSend: (file: VideoFile, caption: string, asDocument: boolean) => boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && width >= 768;
  const video = asset.mimeType?.toLowerCase().startsWith('video/') ?? false;
  const mediaName = video ? 'video' : 'image';
  const insets = useSafeAreaInsets();
  const [caption, setCaption] = useState('');
  const [captionFocused, setCaptionFocused] = useState(false);
  const [asDocument, setAsDocument] = useState(false);
  const [file, setFile] = useState<VideoFile>();
  const [error, setError] = useState('');
  const transferred = useRef(false);
  const captionInput = useRef<TextInput>(null);
  useEffect(() => {
    let alive = true;
    let owned: VideoFile | undefined;
    void retainUpload(asset)
      .then((original) => {
        owned = original;
        if (!alive) original.dispose();
        else setFile(original);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
      if (!transferred.current) owned?.dispose();
    };
  }, [asset]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  function submit() {
    if (!file || transferred.current) return;
    // Consume synchronously; double taps must never enqueue the same file twice.
    transferred.current = true;
    try {
      if (!onSend(file, caption.trim(), !video && asDocument)) transferred.current = false;
    } catch (err) {
      transferred.current = false;
      setError((err as Error).message);
    }
  }
  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => {
        if (desktop) captionInput.current?.focus();
      }}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <KeyboardAvoidingView
        style={[s.overlay, !desktop && s.phoneOverlay]}
        enabled={Platform.OS !== 'web'}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View
          testID={`${mediaName}-send-preview`}
          accessibilityViewIsModal
          style={[
            s.panel,
            desktop
              ? { maxHeight: height - 40 }
              : [
                  s.phonePanel,
                  {
                    paddingTop: insets.top,
                    paddingBottom: insets.bottom,
                  },
                ],
          ]}
        >
          <View style={s.header}>
            <Text style={[s.title, !desktop && s.white]}>
              {video ? 'Send a video' : 'Send an image'}
            </Text>
            <IconButton
              name="close"
              label={`Cancel ${mediaName} send`}
              onPress={onClose}
              color={desktop ? colors.muted : 'white'}
            />
          </View>
          <View
            style={[s.preview, desktop ? { height: Math.min(340, height * 0.45) } : s.phonePreview]}
          >
            {file && video ? (
              <View style={{ width: '100%', height: '100%' }}>
                <VideoPlayback uri={file.uri} active={false} nativeControls />
              </View>
            ) : file ? (
              <Image
                source={{ uri: file.uri }}
                resizeMode="contain"
                accessibilityLabel="Image to send"
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              !error && <ActivityIndicator color={colors.blue} />
            )}
          </View>
          <View style={s.controls}>
            {!!error && (
              <Text accessibilityRole="alert" style={{ color: colors.danger }}>
                {error}
              </Text>
            )}
            {!video && (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="Send as a document"
                accessibilityState={{ checked: asDocument }}
                onPress={() => setAsDocument(!asDocument)}
                style={s.checkboxRow}
              >
                <View
                  style={[
                    s.checkbox,
                    asDocument && { backgroundColor: colors.blue, borderColor: colors.blue },
                  ]}
                >
                  {asDocument && <Icon name="checkmark" size={18} color={colors.surface} />}
                </View>
                <Text style={[s.label, !desktop && s.white]}>Send as a document</Text>
              </Pressable>
            )}
            <View style={[s.captionField, captionFocused && { borderBottomColor: colors.blue }]}>
              <TextInput
                ref={captionInput}
                autoFocus={desktop}
                accessibilityLabel={video ? 'Video caption' : 'Image caption'}
                placeholder="Add a caption…"
                placeholderTextColor={colors.muted}
                value={caption}
                onChangeText={setCaption}
                onFocus={() => setCaptionFocused(true)}
                onBlur={() => setCaptionFocused(false)}
                onKeyPress={(event) => {
                  const key = event.nativeEvent as unknown as {
                    key: string;
                    shiftKey?: boolean;
                    isComposing?: boolean;
                    repeat?: boolean;
                  };
                  if (desktop && key.key === 'Enter' && !key.shiftKey && !key.isComposing) {
                    event.preventDefault();
                    if (!key.repeat) submit();
                  }
                }}
                multiline
                numberOfLines={Platform.OS === 'web' ? 1 : undefined}
                maxLength={10000}
                style={[s.caption, !desktop && s.white]}
              />
            </View>
            <View style={s.actions}>
              <Pressable accessibilityRole="button" onPress={onClose} style={s.action}>
                <Text style={s.actionText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Send ${mediaName}`}
                disabled={!file}
                onPress={submit}
                style={[s.action, !file && { opacity: 0.4 }]}
              >
                <Text style={s.actionText}>Send</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createThemedStyles((colors) => ({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#00000099',
  },
  phoneOverlay: { padding: 0, backgroundColor: 'black' },
  panel: {
    width: '100%',
    maxWidth: 456,
    borderRadius: 10,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  phonePanel: { flex: 1, maxWidth: '100%', borderRadius: 0, backgroundColor: 'black' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 28,
    paddingRight: 12,
    paddingVertical: 8,
  },
  title: { fontSize: 20, fontWeight: '500', color: colors.dark },
  white: { color: 'white' },
  preview: {
    marginHorizontal: 28,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: colors.mediaPlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
  },
  phonePreview: { flex: 1, marginHorizontal: 0, borderRadius: 0, backgroundColor: 'black' },
  controls: { paddingHorizontal: 28, paddingTop: 12 },
  checkboxRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16, color: colors.dark },
  captionField: {
    marginTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  caption: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.dark,
    minHeight: 48,
    maxHeight: 114,
    paddingVertical: 13,
    paddingHorizontal: 0,
    textAlignVertical: 'top',
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
    outlineWidth: 0,
    ...(Platform.OS === 'web'
      ? { outlineStyle: 'solid', boxShadow: 'none', fieldSizing: 'content' }
      : {}),
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, paddingVertical: 8 },
  action: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontSize: 16, fontWeight: '500', color: colors.blue },
}));
