import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capJpegDensity, imageDensity } from '../src/lib/image-density';

const pixels = Buffer.from([0xff, 0xda, 0, 2, 0x12, 0x34, 0xff, 0, 0x56, 0xff, 0xd9]);
function jpeg(x: number, y: number, unit = 1) {
  return Buffer.concat([
    Buffer.from([
      0xff,
      0xd8,
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
      unit,
      x >> 8,
      x & 255,
      y >> 8,
      y & 255,
      0,
      0,
    ]),
    pixels,
  ]);
}

test('JPEG physical density caps at 96 per axis and preserves lower DPI', () => {
  const source = jpeg(300, 72);
  assert.deepEqual(imageDensity(source), { x: 300, y: 72 });
  const output = capJpegDensity(source, imageDensity(source));
  assert.deepEqual(imageDensity(output), { x: 96, y: 72 });
  assert.deepEqual(
    Buffer.from(output.slice(-pixels.length)),
    pixels,
    'compressed pixels are unchanged',
  );
  assert.deepEqual(imageDensity(capJpegDensity(output, { x: 60, y: 80 })), { x: 60, y: 80 });
});

test('JFIF centimetres convert to DPI and unitless aspect ratios are not DPI', () => {
  assert.deepEqual(imageDensity(jpeg(20, 30, 2)), { x: 50.8, y: 76.2 });
  assert.deepEqual(imageDensity(jpeg(1, 1, 0)), {});
  assert.deepEqual(imageDensity(capJpegDensity(jpeg(1, 1, 0), {})), { x: 96, y: 96 });
});

test('PNG pHYs pixels/metre retain fractional lower DPI in the JPEG Exif header', () => {
  const png = Buffer.alloc(29);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(9, 8);
  png.write('pHYs', 12);
  png.writeUInt32BE(2835, 16);
  png.writeUInt32BE(11811, 20);
  png[24] = 1;
  const density = imageDensity(png);
  assert.ok(Math.abs(density.x! - 72.009) < 0.00001);
  const result = imageDensity(capJpegDensity(jpeg(96, 96), density));
  assert.ok(Math.abs(result.x! - 72.009) < 0.00001);
  assert.equal(result.y, 96);
});

for (const little of [false, true]) {
  test(`${little ? 'little' : 'big'} endian Exif densities handle centimetres and rotated axes`, () => {
    const bytes = new Uint8Array(78);
    const view = new DataView(bytes.buffer);
    bytes.set(little ? [73, 73] : [77, 77]);
    view.setUint16(2, 42, little);
    view.setUint32(4, 8, little);
    view.setUint16(8, 4, little);
    for (const [index, tag, type, value] of [
      [0, 0x11a, 5, 62],
      [1, 0x11b, 5, 70],
      [2, 0x128, 3, 3],
      [3, 0x112, 3, 6],
    ]) {
      const offset = 10 + index * 12;
      view.setUint16(offset, tag, little);
      view.setUint16(offset + 2, type, little);
      view.setUint32(offset + 4, 1, little);
      if (type === 5) view.setUint32(offset + 8, value, little);
      else view.setUint16(offset + 8, value, little);
    }
    view.setUint32(62, 20, little);
    view.setUint32(66, 1, little);
    view.setUint32(70, 30, little);
    view.setUint32(74, 1, little);
    assert.deepEqual(imageDensity(bytes), { x: 76.2, y: 50.8 });
  });
}

test('missing and truncated density metadata are harmless; invalid encoded JPEG is rejected', () => {
  for (let length = 0; length < 30; length++)
    assert.doesNotThrow(() => imageDensity(jpeg(72, 72).subarray(0, length)));
  assert.throws(() => capJpegDensity(new Uint8Array(), {}), /did not produce a JPEG/);
});
