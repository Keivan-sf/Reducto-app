import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

/** Android's picker grants access to the selected content URI. retainUpload
 * copies it directly into our scoped cache before any upload or preview reads.
 * DocumentPicker's intermediate cache can be outside that scope in Expo Go. */
export function pickUpload(type: DocumentPicker.DocumentPickerOptions['type'] = '*/*') {
  return DocumentPicker.getDocumentAsync({
    type,
    copyToCacheDirectory: Platform.OS !== 'android',
  });
}
