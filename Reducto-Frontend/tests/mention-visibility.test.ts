import assert from 'node:assert/strict';
import test from 'node:test';
import { mentionIsVisible } from '../src/lib/mention-visibility';

const viewport = { x: 100, y: 100, width: 400, height: 600 };
test('loaded mentions above, below, or alongside the viewport remain unseen', () => {
  for (const row of [
    { x: 100, y: -2000, width: 300, height: 80 },
    { x: 100, y: 701, width: 300, height: 80 },
    { x: -500, y: 200, width: 300, height: 80 },
    { x: 100, y: 700, width: 300, height: 80 },
    { x: 100, y: 200, width: 0, height: 80 },
  ])
    assert.equal(mentionIsVisible(row, viewport), false);
});
test('mentions need meaningful exposure inside the chat viewport, including tall messages', () => {
  assert.equal(mentionIsVisible({ x: 100, y: 200, width: 300, height: 80 }, viewport), true);
  assert.equal(mentionIsVisible({ x: 100, y: 680, width: 300, height: 80 }, viewport), false);
  assert.equal(mentionIsVisible({ x: 100, y: 650, width: 300, height: 80 }, viewport), true);
  assert.equal(mentionIsVisible({ x: 100, y: 100, width: 300, height: 1200 }, viewport), true);
});
