// Usage: node scripts/generate-emojis.mjs /path/to/emoji-test.txt
// Source: https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt
import { readFileSync, writeFileSync } from 'node:fs';
const input = readFileSync(process.argv[2], 'utf8');
if (!input.includes('# Version: 17.0')) throw new Error('Expected Unicode Emoji 17.0 data');
const groups = [];
let group;
for (const line of input.split('\n')) {
  if (line.startsWith('# group: ')) {
    group = { name: line.slice(9), emojis: [] };
    groups.push(group);
  }
  const match = line.match(/^([\dA-F ]+); (?:fully-qualified|component)\s+# (\S+) E[\d.]+ (.+)$/u);
  if (!match) continue;
  group.emojis.push({ emoji: match[2], name: match[3] });
}
writeFileSync(
  new URL('../src/data/emojis.json', import.meta.url),
  `${JSON.stringify(groups, null, 2)}\n`,
);
console.log(
  `Generated ${groups.reduce((sum, group) => sum + group.emojis.length, 0)} emoji in ${groups.length} groups.`,
);
