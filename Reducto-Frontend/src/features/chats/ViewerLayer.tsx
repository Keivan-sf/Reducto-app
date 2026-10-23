import { useEffect, type PropsWithChildren } from 'react';
import { Animated, BackHandler, Modal, Platform, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';

/** A fixed overlay outside AppViewport: safe-area colors and chat layout never change. */
export function ViewerLayer({
  visible,
  onClose,
  opacity,
  children,
}: PropsWithChildren<{
  visible: boolean;
  onClose: () => void;
  opacity: Animated.Value;
}>) {
  useEffect(() => {
    if (Platform.OS !== 'android' || !visible) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => back.remove();
  }, [visible, onClose]);
  const layer = (
    <Animated.View
      testID="media-viewer-layer"
      collapsable={false}
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityViewIsModal={visible}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      aria-hidden={!visible}
      style={[StyleSheet.absoluteFill, { zIndex: 10, backgroundColor: 'black', opacity }]}
    >
      {visible && <StatusBar style="light" />}
      {children}
    </Animated.View>
  );
  if (Platform.OS === 'android') return layer;
  return (
    <Modal
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {layer}
    </Modal>
  );
}
