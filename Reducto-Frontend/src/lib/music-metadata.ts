import { parseBlob, selectCover } from 'music-metadata';

export interface MusicMetadata {
  title?: string;
  artist?: string;
  duration?: number;
  coverUrl?: string;
}

export interface MusicSource {
  size: number;
  type: string;
  read: (start: number, end: number) => Promise<ArrayBuffer>;
}

/** Random reads skip audio payloads, including MP4 files with tags at the end. */
export async function readMusicMetadata(
  source: MusicSource,
  signal: AbortSignal,
): Promise<MusicMetadata> {
  const deadline = Date.now() + 5000;
  let remaining = 16 * 1024 * 1024;
  const check = () => {
    if (signal.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
    if (Date.now() > deadline) throw new Error('Music metadata read timed out.');
  };
  check();
  try {
    // parseBlob only needs size, type and slice().arrayBuffer(). Supply lazy
    // ranges rather than materializing a potentially 2 GB native file as a Blob.
    const blob = {
      size: source.size,
      type: source.type,
      slice(start = 0, end = source.size) {
        return {
          async arrayBuffer() {
            check();
            remaining -= end - start;
            if (remaining < 0) throw new Error('Music metadata read limit exceeded.');
            const bytes = await source.read(start, end);
            check();
            return bytes;
          },
        };
      },
    } as Blob;
    const metadata = await parseBlob(blob, {
      maxMemoryAllocation: 4 * 1024 * 1024,
      maxMetadataEntries: 1000,
      skipPostHeaders: false,
    });
    check();
    const cover = selectCover(metadata.common.picture);
    let coverUrl: string | undefined;
    if (cover && ['image/jpeg', 'image/png', 'image/webp'].includes(cover.format)) {
      let binary = '';
      for (let i = 0; i < cover.data.length; i += 8192)
        binary += String.fromCharCode(...cover.data.subarray(i, i + 8192));
      coverUrl = `data:${cover.format};base64,${btoa(binary)}`;
    }
    return {
      title: metadata.common.title?.trim() || undefined,
      artist: metadata.common.artist?.trim() || undefined,
      duration:
        Number.isFinite(metadata.format.duration) && metadata.format.duration! > 0
          ? metadata.format.duration
          : undefined,
      coverUrl,
    };
  } catch {
    if (signal.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
    // Unrecognized/malformed tags must not prevent an otherwise valid upload.
    return {};
  }
}
