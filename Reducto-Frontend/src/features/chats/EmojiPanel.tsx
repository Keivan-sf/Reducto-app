import { useTheme, createThemedStyles } from '../../context/ThemeContext';
import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from '../../components/ui';
import { emojiGroups, emojiVariants, searchEmojis, type PickerEmoji } from '../../lib/emoji-picker';
import { mostUsedEmojis } from '../../lib/emoji-usage';
import { useEmojiUsage } from './useEmojiUsage';

type EmojiRow =
  { key: string; title: string; empty?: boolean } | { key: string; emojis: PickerEmoji[] };

export function EmojiPanel({ onSelect }: { onSelect: (emoji: string) => void }) {
  const { colors } = useTheme();
  const s = useStyles();
  const panel = useRef<View>(null);
  const suppressTouchClick = useRef(false);
  const [toneMenu, setToneMenu] = useState<{
    variants: PickerEmoji[];
    x: number;
    y: number;
    width: number;
  } | null>(null);
  function choose(emoji: string) {
    setToneMenu(null);
    onSelect(emoji);
    void record(emoji);
  }
  function openTones(entry: PickerEmoji, pageX: number, pageY: number) {
    const variants = emojiVariants(entry.emoji);
    if (!variants.length) return;
    suppressTouchClick.current = true;
    panel.current?.measureInWindow((x, y, width, height) => {
      const menuWidth = Math.min(296, width - 16);
      setToneMenu({
        variants,
        width: menuWidth,
        x: Math.max(8, Math.min(width - menuWidth - 8, pageX - x - menuWidth / 2)),
        y: Math.max(4, Math.min(height - 56, pageY - y - 66)),
      });
    });
  }
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(-1);
  const { usage, record } = useEmojiUsage();
  const [width, setWidth] = useState(336);
  const scroll = useRef<FlatList<EmojiRow>>(null);
  const search = query.trim();
  const columns = Math.max(1, Math.floor(width / 42));
  const rows = useMemo(() => {
    const frequent = mostUsedEmojis(usage);
    const groups = search
      ? searchEmojis(search)
      : category < 0
        ? [{ name: 'Frequently used', emojis: frequent }, ...emojiGroups]
        : [emojiGroups[category]];
    const result: EmojiRow[] = [];
    for (const group of groups) {
      result.push({
        key: group.name,
        title: group.name,
        empty: group.name === 'Frequently used' && !group.emojis.length,
      });
      for (let index = 0; index < group.emojis.length; index += columns) {
        result.push({
          key: `${group.name}:${index}`,
          emojis: group.emojis.slice(index, index + columns),
        });
      }
    }
    return result;
  }, [search, category, usage, columns]);
  return (
    <View
      ref={panel}
      style={{ flex: 1, minHeight: 0, position: 'relative' }}
      {...(Platform.OS === 'web'
        ? {
            onTouchStartCapture: () => {
              suppressTouchClick.current = false;
            },
            onTouchEndCapture: (event: { preventDefault: () => void }) => {
              // Mobile browsers synthesize a click at release, which would hit the
              // new backdrop and immediately dismiss a menu opened by this hold.
              if (suppressTouchClick.current) event.preventDefault();
              suppressTouchClick.current = false;
            },
          }
        : {})}
    >
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
                scroll.current?.scrollToOffset({ offset: 0, animated: false });
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
          underlineColorAndroid="transparent"
          accessibilityLabel="Search emoji"
          placeholder="Search"
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            scroll.current?.scrollToOffset({ offset: 0, animated: false });
          }}
          style={s.searchInput}
        />
      </View>
      <FlatList<EmojiRow>
        ref={scroll}
        style={{ flex: 1, minHeight: 0 }}
        onScrollBeginDrag={() => setToneMenu(null)}
        testID="emoji-list"
        data={rows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="always"
        onLayout={({ nativeEvent }) => setWidth(Math.max(42, nativeEvent.layout.width - 32))}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
        initialNumToRender={10}
        maxToRenderPerBatch={12}
        windowSize={5}
        ListEmptyComponent={<Text style={s.emptyText}>No emoji found</Text>}
        renderItem={({ item }) =>
          'title' in item ? (
            <View>
              <Text style={s.groupTitle}>{item.title}</Text>
              {item.empty && (
                <Text style={s.emptyText}>Your most used emojis will appear here.</Text>
              )}
            </View>
          ) : (
            <View
              testID={item.key.startsWith('Frequently used:') ? 'frequent-emoji-row' : undefined}
              style={s.emojiGrid}
            >
              {item.emojis.map(({ emoji, name }) => (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={`Insert ${name}`}
                  accessibilityHint={
                    emojiVariants(emoji).length ? 'Hold to choose a skin tone' : undefined
                  }
                  delayLongPress={350}
                  onLongPress={(event) =>
                    openTones({ emoji, name }, event.nativeEvent.pageX, event.nativeEvent.pageY)
                  }
                  onPress={() => choose(emoji)}
                  {...{
                    onContextMenu: (event: { preventDefault: () => void }) =>
                      event.preventDefault(),
                  }}
                  style={({ pressed }) => [
                    s.emojiCell,
                    pressed && { backgroundColor: colors.pale },
                  ]}
                >
                  <Text selectable={false} style={s.emoji}>
                    {emoji}
                  </Text>
                  {emojiVariants(emoji).length > 0 && <View style={s.variantMark} />}
                </Pressable>
              ))}
              {Array.from({ length: columns - item.emojis.length }, (_, index) => (
                <View key={`empty-${index}`} style={s.emojiCell} />
              ))}
            </View>
          )
        }
      />
      {toneMenu && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close skin tone menu"
            onPress={() => setToneMenu(null)}
            style={[StyleSheet.absoluteFill, { zIndex: 3 }]}
          />
          <View
            testID="emoji-tone-menu"
            accessibilityLabel="Choose skin tone"
            style={[s.toneMenu, { left: toneMenu.x, top: toneMenu.y, width: toneMenu.width }]}
          >
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={toneMenu.variants.length > 6}
              contentContainerStyle={{ alignItems: 'center' }}
            >
              {toneMenu.variants.map((entry) => (
                <Pressable
                  key={entry.emoji}
                  accessibilityRole="button"
                  accessibilityLabel={`Insert ${entry.name}`}
                  onPress={() => choose(entry.emoji)}
                  style={({ pressed }) => [
                    s.toneOption,
                    pressed && { backgroundColor: colors.pale },
                  ]}
                >
                  <Text selectable={false} style={s.emoji}>
                    {entry.emoji}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
    backgroundColor: colors.emojiBorder,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 36,
    color: colors.dark,
    fontSize: 14,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  groupTitle: {
    color: colors.dark,
    fontSize: 14,
    fontWeight: '500',
    marginVertical: 6,
    marginLeft: 4,
  },
  emojiGrid: { flexDirection: 'row', height: 46, flexShrink: 0, alignItems: 'center' },
  emojiCell: {
    flex: 1,
    minWidth: 0,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  emoji: { fontSize: 29, lineHeight: 38, textAlign: 'center', includeFontPadding: false },
  variantMark: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    width: 0,
    height: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomColor: '#ABB6C2',
    borderLeftColor: 'transparent',
  },
  toneMenu: {
    position: 'absolute',
    height: 54,
    zIndex: 4,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: '0 3px 16px #17212B33',
  },
  toneOption: {
    width: 48,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
}));
