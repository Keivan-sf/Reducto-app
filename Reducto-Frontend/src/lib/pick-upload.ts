import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

/** Android's picker grants access to the selected content URI. retainUpload
 * copies it directly into our scoped cache before any upload or preview reads.
 * DocumentPicker's intermediate cache can be outside that scope in Expo Go. */
export function pickUpload(type: DocumentPicker.DocumentPickerOptions['type'] = '*/*') {
  return DocumentPicker.getDocumentAsync({
    type,
    // Keep large browser files as File objects; base64 adds a full-size JS string.
    base64: false,
    copyToCacheDirectory: Platform.OS !== 'android',
  });
}
