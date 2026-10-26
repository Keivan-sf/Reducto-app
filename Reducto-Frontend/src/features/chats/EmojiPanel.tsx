import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, Icon } from '../../components/ui';
import { defaultRecentEmojis, emojiGroups, rememberEmoji } from '../../lib/emoji-picker';

export function EmojiPanel({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(-1);
  const [recent, setRecent] = useState(defaultRecentEmojis);
  const scroll = useRef<ScrollView>(null);
  const search = query.trim().toLowerCase();
  const groups = search
    ? emojiGroups
        .map((group) => ({
          ...group,
          emojis: group.emojis.filter((entry) => `${entry.name} ${entry.emoji}`.includes(search)),
        }))
        .filter((group) => group.emojis.length)
    : category < 0
      ? [
          {
            name: 'Frequently used',
            emojis: recent.map((emoji) => ({
              emoji,
              name:
                emojiGroups.flatMap((group) => group.emojis).find((entry) => entry.emoji === emoji)
                  ?.name ?? emoji,
            })),
          },
          ...emojiGroups,
        ]
      : [emojiGroups[category]];
  return (
    <View style={{ flex: 1 }}>
      <View style={s.categories}>
        {[{ name: 'Frequently used', icon: 'time-outline' as const }, ...emojiGroups].map(
          (group, index) => (
            <Pressable
              key={group.name}
              accessibilityRole="button"
              accessibilityLabel={group.name}
              accessibilityState={{ selected: category === index - 1 }}
              onPress={() => {
                setCategory(index - 1);
                setQuery('');
                scroll.current?.scrollTo({ y: 0, animated: false });
              }}
              style={[s.category, category === index - 1 && s.selectedCategory]}
            >
              <Icon
                name={group.icon}
                size={20}
                color={category === index - 1 ? colors.blue : colors.muted}
              />
            </Pressable>
          ),
        )}
      </View>
      <View style={s.search}>
        <Icon name="search-outline" size={18} />
        <TextInput
          accessibilityLabel="Search emoji"
          placeholder="Search"
          value={query}
          onChangeText={setQuery}
          style={s.searchInput}
        />
      </View>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
      >
        {groups.map((group) => (
          <View key={group.name}>
            <Text style={s.groupTitle}>{group.name}</Text>
            <View style={s.emojiGrid}>
              {group.emojis.map(({ emoji, name }) => (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={`Insert ${name}`}
                  onPress={() => {
                    onSelect(emoji);
                    setRecent((current) => rememberEmoji(current, emoji));
                  }}
                  style={({ pressed }) => [
                    s.emojiCell,
                    pressed && { backgroundColor: colors.pale },
                  ]}
                >
                  <Text style={s.emoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        {!groups.length && <Text style={s.emptyText}>No emoji found</Text>}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  emptyText: { color: colors.muted, textAlign: 'center', padding: 8 },
  categories: {
    height: 46,
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  category: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderColor: 'transparent',
  },
  selectedCategory: { borderColor: colors.blue },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    margin: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#EEEFF2',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 36,
    color: colors.dark,
    fontSize: 14,
    outlineWidth: 0,
  },
  groupTitle: {
    color: colors.dark,
    fontSize: 14,
    fontWeight: '500',
    marginVertical: 6,
    marginLeft: 4,
  },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  emojiCell: {
    width: 42,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  emoji: { fontSize: 29, lineHeight: 38 },
});
