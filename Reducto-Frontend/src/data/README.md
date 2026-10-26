The emoji catalogue is generated from Unicode Emoji 17.0:
https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt

It includes every fully-qualified sequence and standalone component, in Unicode's
CLDR order, with the original English names. This covers country, territory and
subdivision flags, skin tones, gender variants, families and joined sequences.
The operating system supplies the emoji artwork.

Regenerate with `node scripts/generate-emojis.mjs /path/to/emoji-test.txt`, then
format `src/data/emojis.json` with Prettier. The data is covered by the accompanying
UNICODE-LICENSE.txt. No network requests are needed by the picker.
