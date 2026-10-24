import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type PropsWithChildren,
  type RefObject,
} from 'react';
import { Animated, Keyboard, Platform, StyleSheet, View } from 'react-native';
import { usePathname } from 'expo-router';
import { AppViewport } from '../../components/AppViewport';
import { MediaViewerSession } from '../../lib/media-viewer-session';
import { ImageViewer } from './ImageViewer';
import { GifViewer } from './GifViewer';
import { VideoViewer } from './VideoViewer';
import { ViewerLayer } from './ViewerLayer';

type ImageRequest = Omit<ComponentProps<typeof ImageViewer>, 'visible' | 'onClose'> & {
  onClose?: () => void;
};
type VideoRequest = Omit<
  ComponentProps<typeof VideoViewer>,
  'visible' | 'pauseRef' | 'onClose' | 'canPlay' | 'onCancelDownload'
> & { onClose?: () => void };
type GifRequest = Omit<
  ComponentProps<typeof GifViewer>,
  'visible' | 'pauseRef' | 'canPlay' | 'onClose'
> & {
  onClose?: () => void;
};
type Selection = (
  | { type: 'image'; props: ImageRequest }
  | { type: 'video'; props: VideoRequest }
  | { type: 'gif'; props: GifRequest }
) & { pathname: string };
type Session = MediaViewerSession<Selection>;
const Context = createContext<{
  openImage: (props: ImageRequest) => void;
  openVideo: (props: VideoRequest) => void;
  openGif: (props: GifRequest) => void;
  isOpen: Session['isOpen'];
  subscribe: Session['subscribe'];
}>(null!);

/** Chat consumers receive stable commands, never the viewer's render state. */
export function MediaViewersProvider({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const background = useRef<View>(null);
  const [session] = useState(
    () => new MediaViewerSession<Selection>((content) => content.props.onClose?.()),
  );
  const actions = useMemo(
    () => ({
      openImage: (props: ImageRequest) => {
        Keyboard.dismiss();
        session.open({ type: 'image', props, pathname });
      },
      openVideo: (props: VideoRequest) => {
        Keyboard.dismiss();
        session.open({ type: 'video', props, pathname });
      },
      openGif: (props: GifRequest) => {
        Keyboard.dismiss();
        session.open({ type: 'gif', props, pathname });
      },
      isOpen: session.isOpen,
      subscribe: session.subscribe,
    }),
    [session, pathname],
  );
  return (
    <Context.Provider value={actions}>
      <View style={{ flex: 1 }}>
        <View ref={background} style={{ flex: 1 }}>
          <AppViewport>{children}</AppViewport>
        </View>
        <MediaViewerHost session={session} pathname={pathname} background={background} />
      </View>
    </Context.Provider>
  );
}

/** Only this small sibling of the chat subscribes to media selection changes. */
function MediaViewerHost({
  session,
  pathname,
  background,
}: {
  session: Session;
  pathname: string;
  background: RefObject<View | null>;
}) {
  const { content, visible } = useSyncExternalStore(session.subscribe, session.read, session.read);
  const [opacity] = useState(() => new Animated.Value(0));
  const pauseRef = useRef<(() => void) | null>(null);
  const gifPauseRef = useRef<(() => void) | null>(null);
  const [retained, setRetained] = useState<{
    content: Selection | null;
    image?: ImageRequest;
    video?: VideoRequest;
    gif?: GifRequest;
  }>({ content: null });
  if (content !== retained.content) {
    setRetained({
      ...retained,
      content,
      ...(content?.type === 'image' ? { image: content.props } : {}),
      ...(content?.type === 'video' ? { video: content.props } : {}),
      ...(content?.type === 'gif' ? { gif: content.props } : {}),
    });
  }
  const close = useCallback(() => session.close(), [session]);
  useLayoutEffect(() => {
    if (Platform.OS !== 'android') return;
    // Change accessibility on the native container without rendering the chat again.
    background.current?.setNativeProps({
      importantForAccessibility: visible ? 'no-hide-descendants' : 'auto',
    });
  }, [visible, background]);
  useLayoutEffect(
    () =>
      session.attachDismiss((complete) => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 140,
          useNativeDriver: true,
          isInteraction: false,
        }).start(({ finished }) => {
          if (finished) complete();
        });
        if (session.read().content?.type === 'video') pauseRef.current?.();
        if (session.read().content?.type === 'gif') gifPauseRef.current?.();
      }),
    [session, opacity],
  );
  useLayoutEffect(() => {
    if (!visible) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
      isInteraction: false,
    }).start();
    return () => opacity.stopAnimation();
  }, [visible, content, opacity]);
  useEffect(() => {
    if (visible && content?.pathname !== pathname) close();
  }, [visible, content, pathname, close]);
  const showingImage = content?.type === 'image';
  const showingVideo = content?.type === 'video';
  const image = showingImage ? content.props : retained.image;
  const video = showingVideo ? content.props : retained.video;
  const showingGif = content?.type === 'gif';
  const gif = showingGif ? content.props : retained.gif;
  return (
    <ViewerLayer visible={visible} onClose={close} opacity={opacity}>
      <View
        pointerEvents={showingGif ? 'auto' : 'none'}
        accessibilityElementsHidden={!showingGif}
        importantForAccessibility={showingGif ? 'auto' : 'no-hide-descendants'}
        aria-hidden={!showingGif}
        style={[StyleSheet.absoluteFill, { opacity: showingGif ? 1 : 0 }]}
      >
        {(Platform.OS === 'android' || showingGif) && (
          <GifViewer
            gifId=""
            title=""
            createdAt=""
            {...gif}
            visible={visible && showingGif}
            onClose={close}
            onForward={() => session.close(() => gif?.onForward())}
            pauseRef={gifPauseRef}
            canPlay={session.canPlay}
          />
        )}
      </View>
      <View
        pointerEvents={showingImage ? 'auto' : 'none'}
        accessibilityElementsHidden={!showingImage}
        importantForAccessibility={showingImage ? 'auto' : 'no-hide-descendants'}
        aria-hidden={!showingImage}
        style={[StyleSheet.absoluteFill, { opacity: showingImage ? 1 : 0 }]}
      >
        {(Platform.OS === 'android' || showingImage) && (
          <ImageViewer
            conversationId=""
            mediaId=""
            title=""
            createdAt=""
            {...image}
            visible={visible && showingImage}
            onClose={close}
            onForward={() => session.close(() => image?.onForward())}
          />
        )}
      </View>
      <View
        pointerEvents={showingVideo ? 'auto' : 'none'}
        accessibilityElementsHidden={!showingVideo}
        importantForAccessibility={showingVideo ? 'auto' : 'no-hide-descendants'}
        aria-hidden={!showingVideo}
        style={[StyleSheet.absoluteFill, { opacity: showingVideo ? 1 : 0 }]}
      >
        {(Platform.OS === 'android' || showingVideo) && (
          <VideoViewer
            conversationId=""
            mediaId=""
            title=""
            {...video}
            visible={visible && showingVideo}
            onClose={close}
            pauseRef={pauseRef}
            canPlay={session.canPlay}
            onCancelDownload={(cancel) => session.close(cancel)}
          />
        )}
      </View>
    </ViewerLayer>
  );
}
export const useMediaViewers = () => useContext(Context);
