import { useEffect } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Avatar, Icon, IconButton } from '../../components/ui';
import { createThemedStyles, useTheme } from '../../context/ThemeContext';
import { useProfiles } from '../../context/ProfilesContext';
import { profileName } from '../../lib/messages';
import { searchSnippet, type SearchState } from '../../api/conversation-search';
import type { Message } from '../../api/types';

export function SearchInput({
  value,
  onChange,
  onSubmit,
  onClose,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View style={s.inputRow}>
      <Icon name="search-outline" size={20} color={colors.muted} />
      <TextInput
        underlineColorAndroid="transparent"
        autoFocus
        accessibilityLabel="Search in this conversation"
        placeholder="Search in this conversation"
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={1000}
        style={s.input}
      />
      <IconButton name="close" label="Close search" onPress={onClose} />
    </View>
  );
}

export function SearchMatch({ text, query }: { text: string; query: string }) {
  const { colors } = useTheme();
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts = [];
  let start = 0;
  let index = lower.indexOf(needle);
  while (index >= 0) {
    parts.push(text.slice(start, index));
    parts.push(
      <Text key={index} style={{ color: colors.blue, fontWeight: '600' }}>
        {text.slice(index, index + query.length)}
      </Text>,
    );
    start = index + query.length;
    index = lower.indexOf(needle, start);
  }
  parts.push(text.slice(start));
  return <>{parts}</>;
}

export function SearchResults({
  state,
  selectedId,
  userId,
  onSelect,
  onMore,
}: {
  state: SearchState;
  selectedId?: string;
  userId: string;
  onSelect: (message: Message, index: number) => void;
  onMore: () => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const { profiles, directory } = useProfiles();
  useEffect(() => {
    void directory.getMany(state.messages.map((message) => message.senderId));
  }, [directory, state.messages]);
  return (
    <View style={s.results} testID="message-search-results">
      <Text style={s.count} accessibilityLiveRegion="polite">
        {state.submitted
          ? `${state.messages.length}${state.nextCursor ? '+' : ''} messages found`
          : 'Search messages in this conversation'}
      </Text>
      <FlatList
        data={state.messages}
        keyExtractor={(message) => message.id}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => {
          if (state.nextCursor && !state.error) onMore();
        }}
        onEndReachedThreshold={0.4}
        renderItem={({ item, index }) => {
          const profile = profiles[item.senderId];
          const name = item.senderId === userId ? 'You' : profileName(profile);
          const snippet = searchSnippet(item);
          // Keep a matching filename or phrase visible even in a long caption.
          const match = snippet.toLowerCase().indexOf(state.query.toLowerCase());
          const excerpt = match > 45 ? `…${snippet.slice(match - 30)}` : snippet;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${name}: ${snippet}`}
              accessibilityState={{ selected: selectedId === item.id }}
              testID={`search-result-${item.id}`}
              onPress={() => onSelect(item, index)}
              style={[s.result, selectedId === item.id && { backgroundColor: colors.highlight }]}
            >
              <Avatar name={profileName(profile)} uri={profile?.avatarUrl ?? undefined} size={48} />
              <View style={s.resultBody}>
                <View style={s.resultHeading}>
                  <Text numberOfLines={1} style={s.name}>
                    {name}
                  </Text>
                  <Text style={s.date}>
                    {new Date(item.createdAt).toLocaleDateString([], {
                      day: 'numeric',
                      month: 'short',
                      year: '2-digit',
                    })}
                  </Text>
                </View>
                <Text numberOfLines={1} style={s.snippet}>
                  <SearchMatch text={excerpt} query={state.query} />
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !state.loading && !state.error ? (
            <Text style={s.empty}>
              {state.submitted
                ? 'No matching messages.'
                : 'Enter a word, filename, or music title.'}
            </Text>
          ) : null
        }
        ListFooterComponent={
          <View>
            {state.loading && (
              <ActivityIndicator
                accessibilityLabel="Searching messages"
                color={colors.blue}
                style={{ padding: 20 }}
              />
            )}
            {!!state.error && (
              <Pressable accessibilityRole="button" onPress={onMore} style={{ padding: 20 }}>
                <Text style={s.snippet}>{state.error} Tap to retry.</Text>
              </Pressable>
            )}
            {!!state.nextCursor && !state.loading && !state.error && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Load more search results"
                onPress={onMore}
                style={{ padding: 20, alignItems: 'center' }}
              >
                <Text style={{ color: colors.blue }}>Load more results</Text>
              </Pressable>
            )}
          </View>
        }
      />
    </View>
  );
}

export function SearchNavigation({
  state,
  index,
  list,
  busy,
  onList,
  onOlder,
  onNewer,
  onRetry,
}: {
  state: SearchState;
  index: number;
  list: boolean;
  busy: boolean;
  onList: () => void;
  onOlder: () => void;
  onNewer: () => void;
  onRetry: () => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const count = `${state.messages.length}${state.nextCursor ? '+' : ''}`;
  return (
    <View style={s.navigation} testID="search-navigation">
      {!!state.error && (
        <Pressable onPress={onRetry} accessibilityRole="button" style={{ padding: 12 }}>
          <Text style={s.snippet}>{state.error} Tap to retry.</Text>
        </Pressable>
      )}
      {!list && state.messages.length > 0 && (
        <View style={s.arrows}>
          <IconButton
            name="chevron-up"
            label="Older search result"
            disabled={
              busy || state.loading || (index >= state.messages.length - 1 && !state.nextCursor)
            }
            onPress={onOlder}
          />
          <IconButton
            name="chevron-down"
            label="Newer search result"
            disabled={busy || state.loading || index <= 0}
            onPress={onNewer}
          />
        </View>
      )}
      <View style={s.bottomBar}>
        <Icon name="search-outline" color={colors.blue} size={20} />
        <Text style={s.position} accessibilityLiveRegion="polite">
          {state.loading
            ? 'Searching…'
            : !state.submitted
              ? 'Press Search on your keyboard'
              : !state.messages.length
                ? 'No results'
                : list
                  ? `${count} results`
                  : `${index + 1} of ${count}`}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onList}
          disabled={!state.messages.length || busy}
          style={{ padding: 12 }}
        >
          <Text style={{ color: colors.blue, fontWeight: '600' }}>
            {list ? 'Show as Chat' : 'Show as List'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingLeft: 16,
    borderBottomWidth: 1,
    borderColor: colors.border,
    minHeight: 58,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    fontSize: 15,
    color: colors.dark,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  results: { flex: 1, minHeight: 0, backgroundColor: colors.surface },
  count: {
    fontSize: 12,
    color: colors.muted,
    backgroundColor: colors.pending,
    padding: 14,
    textAlign: 'right',
  },
  result: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, gap: 12, minHeight: 80 },
  resultBody: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 18,
    paddingRight: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 6,
  },
  resultHeading: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  name: { flex: 1, color: colors.dark, fontWeight: '600', fontSize: 15 },
  date: { color: colors.muted, fontSize: 11 },
  snippet: { color: colors.muted, fontSize: 14 },
  empty: { color: colors.muted, textAlign: 'center', padding: 28 },
  navigation: { backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    minHeight: 58,
    gap: 10,
  },
  position: { flex: 1, color: colors.dark, fontSize: 13 },
  arrows: {
    position: 'absolute',
    right: 12,
    bottom: 70,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
}));
