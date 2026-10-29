These small audio fixtures contain a generated 440 Hz tone (0.25 seconds),
with title `آهنگ Test` and artist `Test Artist`. No external audio is used.
Generate each file with FFmpeg, replacing EXT with mp3, m4a, or flac:

```sh
ffmpeg -nostdin -v error -f lavfi -i 'sine=frequency=440:duration=0.25' \
  -metadata 'title=آهنگ Test' -metadata 'artist=Test Artist' tagged.EXT
```
