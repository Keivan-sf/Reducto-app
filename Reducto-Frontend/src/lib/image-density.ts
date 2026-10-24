export type ImageDensity = { x?: number; y?: number };

function text(bytes: Uint8Array, offset: number, value: string) {
  return [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}

/** Read TIFF/Exif physical resolution without decoding the image or its thumbnail. */
function exifDensity(bytes: Uint8Array): ImageDensity {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const little = text(bytes, 0, 'II');
    if ((!little && !text(bytes, 0, 'MM')) || view.getUint16(2, little) !== 42) return {};
    const ifd = view.getUint32(4, little);
    const count = view.getUint16(ifd, little);
    let x: number | undefined, y: number | undefined;
    let unit = 2,
      orientation = 1;
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      const tag = view.getUint16(entry, little);
      const type = view.getUint16(entry + 2, little);
      if (view.getUint32(entry + 4, little) !== 1) continue;
      if ((tag === 0x128 || tag === 0x112) && type === 3) {
        if (tag === 0x128) unit = view.getUint16(entry + 8, little);
        else orientation = view.getUint16(entry + 8, little);
      }
      if ((tag === 0x11a || tag === 0x11b) && type === 5) {
        const offset = view.getUint32(entry + 8, little);
        const value = view.getUint32(offset, little) / view.getUint32(offset + 4, little);
        if (Number.isFinite(value) && value > 0) {
          if (tag === 0x11a) x = value;
          else y = value;
        }
      }
    }
    if (unit !== 2 && unit !== 3) return {};
    const factor = unit === 3 ? 2.54 : 1;
    const density = {
      x: x === undefined ? undefined : x * factor,
      y: y === undefined ? undefined : y * factor,
    };
    return orientation >= 5 && orientation <= 8 ? { x: density.y, y: density.x } : density;
  } catch {
    // Missing or malformed optional metadata must not prevent an image upload.
    return {};
  }
}

function* jpegSegments(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let start = 2; start + 4 <= bytes.length;) {
    if (bytes[start] !== 0xff) return;
    const marker = bytes[start + 1];
    if (marker === 0xda || marker === 0xd9) return; // Compressed pixels begin here.
    const length = view.getUint16(start + 2);
    const end = start + 2 + length;
    if (length < 2 || end > bytes.length) return;
    yield { marker, start, end, data: start + 4 };
    start = end;
  }
}

/** JPEG JFIF/Exif, PNG pHYs/eXIf, WebP Exif, and TIFF density, in DPI. */
export function imageDensity(bytes: Uint8Array): ImageDensity {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let density: ImageDensity = {};
  for (const { marker, data, end } of jpegSegments(bytes)) {
    if (marker === 0xe1 && text(bytes, data, 'Exif\0\0')) {
      const exif = exifDensity(bytes.subarray(data + 6, end));
      density = { x: exif.x ?? density.x, y: exif.y ?? density.y };
    } else if (marker === 0xe0 && end - data >= 14 && text(bytes, data, 'JFIF\0')) {
      const unit = bytes[data + 7];
      if (unit === 1 || unit === 2) {
        const factor = unit === 2 ? 2.54 : 1;
        const x = view.getUint16(data + 8) * factor;
        const y = view.getUint16(data + 10) * factor;
        density = { x: density.x ?? (x || undefined), y: density.y ?? (y || undefined) };
      }
    }
  }
  if (text(bytes, 0, '\x89PNG\r\n\x1a\n')) {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) break;
      if (text(bytes, offset + 4, 'pHYs') && length === 9 && bytes[offset + 16] === 1) {
        const x = view.getUint32(offset + 8) * 0.0254;
        const y = view.getUint32(offset + 12) * 0.0254;
        density = { x: x || undefined, y: y || undefined };
      }
      if (text(bytes, offset + 4, 'eXIf')) {
        const exif = exifDensity(bytes.subarray(offset + 8, end - 4));
        density = { x: exif.x ?? density.x, y: exif.y ?? density.y };
      }
      offset = end;
    }
  } else if (text(bytes, 0, 'RIFF') && text(bytes, 8, 'WEBP')) {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const length = view.getUint32(offset + 4, true);
      const end = offset + 8 + length;
      if (end > bytes.length) break;
      if (text(bytes, offset, 'EXIF')) {
        const start = offset + 8;
        return exifDensity(bytes.subarray(start + (text(bytes, start, 'Exif\0\0') ? 6 : 0), end));
      }
      offset = end + (length % 2);
    }
  } else if (text(bytes, 0, 'II') || text(bytes, 0, 'MM')) return exifDensity(bytes);
  return density;
}

/** Update metadata only: preserve the encoder's JPEG pixels and quality. */
export function capJpegDensity(jpeg: Uint8Array, source: ImageDensity): Uint8Array<ArrayBuffer> {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8)
    throw new Error('Image compression did not produce a JPEG.');
  const cap = (value?: number) =>
    value && Number.isFinite(value) && value > 0 ? Math.min(96, value) : 96;
  const x = cap(source.x),
    y = cap(source.y);
  const jfif = new Uint8Array([
    0xff,
    0xe0,
    0,
    16,
    74,
    70,
    73,
    70,
    0,
    1,
    2,
    1,
    0,
    Math.max(1, Math.floor(x)),
    0,
    Math.max(1, Math.floor(y)),
    0,
    0,
  ]);
  // Exif rationals retain fractional lower densities, e.g. PNG pixels/metre.
  const exif = new Uint8Array(76);
  exif.set([0xff, 0xe1, 0, 74, 69, 120, 105, 102, 0, 0, 77, 77, 0, 42, 0, 0, 0, 8, 0, 3]);
  const view = new DataView(exif.buffer, 10);
  for (const [index, tag, value] of [
    [0, 0x11a, x],
    [1, 0x11b, y],
  ]) {
    const entry = 10 + index * 12;
    view.setUint16(entry, tag);
    view.setUint16(entry + 2, 5);
    view.setUint32(entry + 4, 1);
    view.setUint32(entry + 8, 50 + index * 8);
    view.setUint32(50 + index * 8, Math.round(value * 10000));
    view.setUint32(54 + index * 8, 10000);
  }
  view.setUint16(34, 0x128);
  view.setUint16(36, 3);
  view.setUint32(38, 1);
  view.setUint16(42, 2);
  const parts = [jpeg.subarray(0, 2), jfif, exif];
  let cursor = 2;
  for (const { marker, start, end, data } of jpegSegments(jpeg)) {
    if (
      (marker === 0xe0 && text(jpeg, data, 'JFIF\0')) ||
      (marker === 0xe1 && text(jpeg, data, 'Exif\0\0'))
    ) {
      parts.push(jpeg.subarray(cursor, start));
      cursor = end;
    }
  }
  parts.push(jpeg.subarray(cursor));
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
