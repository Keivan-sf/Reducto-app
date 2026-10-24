import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Notification = { id: symbol; text: string; success?: boolean; exiting?: boolean };
const NoticeContext = createContext<(notice: Notification) => () => void>(() => () => {});

// Each native modal needs its own host so notifications appear above its content.
export function NoticeProvider({ children }: PropsWithChildren) {
  const [notice, setNotice] = useState<Notification | null>(null);
  const insets = useSafeAreaInsets();
  const show = useCallback((next: Notification) => {
    setNotice(next);
    return () =>
      setNotice((current) => (current?.id === next.id ? { ...current, exiting: true } : current));
  }, []);
  const remove = useCallback((id: symbol) => {
    setNotice((current) => (current?.id === id ? null : current));
  }, []);
  return (
    <NoticeContext.Provider value={show}>
      {children}
      {notice && (
        <View pointerEvents="none" style={[s.position, { bottom: Math.max(insets.bottom, 16) }]}>
          <AnimatedNotice notice={notice} onExited={remove} />
        </View>
      )}
    </NoticeContext.Provider>
  );
}

function AnimatedNotice({
  notice,
  onExited,
}: {
  notice: Notification;
  onExited: (id: symbol) => void;
}) {
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!notice.exiting) opacity.setValue(0);
    const animation = Animated.timing(opacity, {
      toValue: notice.exiting ? 0 : 1,
      duration: notice.exiting ? 200 : 160,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start(({ finished }) => {
      if (finished && notice.exiting) onExited(notice.id);
    });
    return () => animation.stop();
  }, [notice.id, notice.exiting, opacity, onExited]);
  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="notification"
      style={[s.toast, { opacity }]}
    >
      <Text style={s.text}>{notice.text}</Text>
    </Animated.View>
  );
}

export function Notice({
  text,
  success,
  onDismiss,
}: {
  text: string;
  success?: boolean;
  onDismiss?: () => void;
}) {
  const show = useContext(NoticeContext);
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    if (!text) return;
    const hide = show({ id: Symbol(), text, success });
    const timer = setTimeout(() => {
      hide();
      dismiss.current?.();
    }, 1800);
    return () => {
      clearTimeout(timer);
      hide();
    };
  }, [text, success, show]);
  return null;
}

const s = StyleSheet.create({
  position: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 1000 },
  toast: {
    maxWidth: 400,
    backgroundColor: 'rgba(23, 33, 43, 0.65)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  text: { color: 'white', fontSize: 13, lineHeight: 18 },
});
