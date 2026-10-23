import Ionicons from '@expo/vector-icons/Ionicons';
import * as Font from 'expo-font';
import { Image, NativeModules, Platform } from 'react-native';

/** Retry native font loading using the server that actually delivered the JS
 * bundle, rather than a stale Expo Go manifest host or cached module asset. */
export async function loadIconFont(): Promise<void> {
  try {
    await Ionicons.loadFont();
    return;
  } catch (error) {
    if (Platform.OS === 'web') throw error;
    const font = Ionicons.font.ionicons;
    const source = typeof font === 'string' ? { uri: font } : Image.resolveAssetSource(font);
    if (!source?.uri) throw error;
    let uri = source.uri;
    const bundleUrl: unknown = NativeModules.SourceCode?.scriptURL;
    if (typeof bundleUrl === 'string' && /^https?:\/\//.test(bundleUrl)) {
      // Keep Metro's asset pathname and query (including pnpm's unstable_path).
      // LAN, tunnel, and adb-forwarded bundle addresses must remain reachable
      // from the phone, even if the manifest advertises a different hostname.
      const assetUrl = new URL(uri, bundleUrl);
      const server = new URL(bundleUrl);
      if (/^https?:$/.test(assetUrl.protocol)) {
        assetUrl.protocol = server.protocol;
        assetUrl.host = server.host;
        uri = assetUrl.href;
      }
    }
    // A URI source bypasses the failed module asset and its cached localUri.
    await Font.loadAsync(Ionicons.getFontFamily(), { uri });
  }
}
