import { useWindowDimensions, View } from 'react-native';
import ChatList from './ChatList';
import ChatView from './ChatView';
import { colors } from '../../components/ui';
export default function ChatShell({ id }: { id?: string }) {
  const wide = useWindowDimensions().width >= 850;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: 'white' }}>
      {(wide || !id) && (
        <View
          style={{
            width: wide ? 360 : '100%',
            borderRightWidth: wide ? 1 : 0,
            borderColor: colors.border,
          }}
        >
          <ChatList />
        </View>
      )}
      {(wide || id) && (
        <View style={{ flex: 1 }}>
          <ChatView key={id ?? 'welcome'} id={id} />
        </View>
      )}
    </View>
  );
}
