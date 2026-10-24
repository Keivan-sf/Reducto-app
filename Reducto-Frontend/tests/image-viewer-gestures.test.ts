import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageViewerGestures } from '../src/features/chats/image-viewer-gestures';

function viewer() {
  const gestures = new ImageViewerGestures(() => {});
  gestures.layout(400, 600);
  gestures.imageSize(800, 1200);
  return gestures;
}
const pinch = (span: number, x = 200, y = 300) => [
  { x: x - span / 2, y },
  { x: x + span / 2, y },
];
function doubleTap(gestures: ImageViewerGestures, x = 200, y = 300, time = 0) {
  for (const start of [time, time + 100]) {
    gestures.update([{ x, y }], start);
    gestures.finish(false, start + 20);
  }
}

test('pinch follows its focal point, supports two-finger panning, and clamps zoom to 1–4', () => {
  const t = viewer();
  t.update(pinch(100, 250));
  t.update(pinch(200, 250));
  assert.deepEqual(t.transform, { scale: 2, x: -50, y: 0, dismiss: 0 });
  t.update(pinch(200, 280, 340));
  assert.deepEqual(t.transform, { scale: 2, x: -20, y: 40, dismiss: 0 });
  t.update(pinch(1000));
  assert.equal(t.transform.scale, 4);
  t.update(pinch(10));
  assert.deepEqual(t.transform, { scale: 1, x: 0, y: 0, dismiss: 0 });
  assert.equal(t.finish(), false);
});

test('double tap zooms around the tapped point and panning stays within actual image edges', () => {
  const t = viewer();
  doubleTap(t, 250, 350);
  assert.deepEqual(t.transform, { scale: 2.5, x: -75, y: -75, dismiss: 0 });
  t.update([{ x: 200, y: 300 }]);
  t.update([{ x: 2000, y: -2000 }]);
  assert.deepEqual(t.transform, { scale: 2.5, x: 300, y: -450, dismiss: 0 });
  assert.equal(t.finish(), false);
  doubleTap(t, 200, 300, 1000);
  assert.deepEqual(t.transform, { scale: 1, x: 0, y: 0, dismiss: 0 });

  t.imageSize(1200, 400);
  doubleTap(t, 200, 300, 2000);
  t.update([{ x: 200, y: 300 }]);
  t.update([{ x: 200, y: 500 }]);
  assert.equal(t.transform.y, 0, 'letterboxed images stay centered along the shorter axis');
  assert.equal(
    t.finish(),
    false,
    'a zoomed image cannot dismiss even when it cannot pan vertically',
  );
});

test('pinching interrupts an existing close drag and remaining fingers never dismiss', () => {
  const t = viewer();
  t.update([{ x: 200, y: 300 }]);
  t.update([{ x: 200, y: 450 }]);
  assert.equal(t.transform.dismiss, 150);
  t.update(pinch(100));
  assert.equal(t.transform.dismiss, 0);
  t.update(pinch(200));
  t.update(pinch(50));
  t.update([{ x: 200, y: 300 }]);
  t.update([{ x: 200, y: 500 }]);
  assert.equal(t.finish(), false);
  t.update([{ x: 200, y: 300 }]);
  t.update([{ x: 200, y: 450 }]);
  assert.equal(t.finish(), true, 'only a new gesture at base zoom may dismiss');
});

test('cancelled, held, distant, and dragged taps never accidentally toggle zoom', () => {
  for (const mode of ['cancel', 'hold', 'distant', 'drag']) {
    const t = viewer();
    t.update([{ x: 200, y: 300 }], 0);
    if (mode === 'drag') t.update([{ x: 250, y: 300 }], 20);
    t.finish(mode === 'cancel', mode === 'hold' ? 400 : 40);
    t.update([{ x: mode === 'distant' ? 300 : 200, y: 300 }], 150);
    t.finish(false, 170);
    assert.equal(t.transform.scale, 1, mode);
  }
});

test('reopening, changing images, or resizing clears zoom, active gestures, and pending taps', () => {
  const t = viewer();
  doubleTap(t);
  t.update([{ x: 200, y: 300 }]);
  t.reset();
  assert.equal(t.finish(), false);
  assert.deepEqual(t.transform, { scale: 1, x: 0, y: 0, dismiss: 0 });
  doubleTap(t);
  t.layout(600, 400);
  assert.deepEqual(t.transform, { scale: 1, x: 0, y: 0, dismiss: 0 });
});
