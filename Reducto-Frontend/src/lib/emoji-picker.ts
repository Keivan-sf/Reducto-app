import catalogue from '../data/emojis.json';

export interface PickerEmoji {
  emoji: string;
  name: string;
}
const categories = [
  {
    name: 'Smileys & People',
    icon: 'happy-outline',
    groups: ['Smileys & Emotion', 'People & Body', 'Component'],
  },
  { name: 'Animals & Nature', icon: 'paw-outline', groups: ['Animals & Nature'] },
  { name: 'Food & Drink', icon: 'nutrition-outline', groups: ['Food & Drink'] },
  { name: 'Activity', icon: 'football-outline', groups: ['Activities'] },
  { name: 'Travel & Places', icon: 'car-outline', groups: ['Travel & Places'] },
  { name: 'Objects', icon: 'bulb-outline', groups: ['Objects'] },
  { name: 'Symbols', icon: 'heart-outline', groups: ['Symbols'] },
  { name: 'Flags', icon: 'flag-outline', groups: ['Flags'] },
] as const;
const allEmojis = catalogue.flatMap((group) => group.emojis);
export const emojiByValue = new Map(allEmojis.map((entry) => [entry.emoji, entry]));
const hasSkinTone = (emoji: string) => /[\u{1F3FB}-\u{1F3FF}]/u.test(emoji);
const normalizedSequence = (emoji: string) => emoji.replace(/[\u{1F3FB}-\u{1F3FF}\uFE0F]/gu, '');
const defaults = allEmojis.filter((entry) => !hasSkinTone(entry.emoji));
const defaultBySequence = new Map(
  defaults.map((entry) => [normalizedSequence(entry.emoji), entry]),
);
const defaultByName = new Map(defaults.map((entry) => [entry.name, entry]));
const baseByValue = new Map<string, PickerEmoji>();
const variantsByValue = new Map<string, PickerEmoji[]>();
for (const entry of allEmojis) {
  const name = entry.name
    .replace(/(?:,? )?(?:light|medium-light|medium|medium-dark|dark) skin tone/g, '')
    .replace(/:$/, '')
    .trim();
  const base =
    defaultBySequence.get(normalizedSequence(entry.emoji)) ??
    defaultByName.get(name) ??
    defaultByName.get(name.replace(': person, person', ''));
  if (!base) continue; // Standalone skin-tone swatches are options, rather than grid entries.
  baseByValue.set(entry.emoji, base);
  if (hasSkinTone(entry.emoji)) {
    const variants = variantsByValue.get(base.emoji) ?? [base];
    variants.push(entry);
    variantsByValue.set(base.emoji, variants);
  }
}
export const defaultEmoji = (emoji: string) => baseByValue.get(emoji);
export const emojiVariants = (emoji: string) =>
  variantsByValue.get(defaultEmoji(emoji)?.emoji ?? emoji) ?? [];
export const emojiGroups = categories.map(({ name, icon, groups }) => ({
  name,
  icon,
  emojis: catalogue
    .filter((group) => (groups as readonly string[]).includes(group.name))
    .flatMap((group) => group.emojis)
    .filter((entry) => !hasSkinTone(entry.emoji)),
}));

export function searchEmojis(query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/);
  return emojiGroups
    .map((group) => ({
      ...group,
      emojis: group.emojis.filter((entry) => {
        const text = [entry, ...emojiVariants(entry.emoji)]
          .map((variant) => `${variant.name} ${variant.emoji}`)
          .join(' ')
          .toLocaleLowerCase();
        return terms.every((term) => text.includes(term));
      }),
    }))
    .filter((group) => group.emojis.length);
}
