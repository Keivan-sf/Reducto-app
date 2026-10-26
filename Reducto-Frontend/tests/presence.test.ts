import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presenceLabel, startPresenceHeartbeat } from '../src/api/presence';

test('presence sends every 30 seconds, skips disconnected/background clients, and disposes', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const sent: string[] = [];
  let active = true;
  const socket = { connected: true, emit: (event: string) => sent.push(event) };
  const heartbeat = startPresenceHeartbeat(socket, () => active);
  heartbeat.resume();
  t.mock.timers.tick(29999);
  assert.deepEqual(sent, ['p']);
  t.mock.timers.tick(1);
  assert.deepEqual(sent, ['p', 'p']);
  socket.connected = false;
  t.mock.timers.tick(30000);
  socket.connected = true;
  active = false;
  t.mock.timers.tick(30000);
  assert.equal(sent.length, 2);
  active = true;
  heartbeat.resume();
  assert.equal(sent.length, 3);
  heartbeat.dispose();
  t.mock.timers.tick(60000);
  assert.equal(sent.length, 3);
});

test('leaving pauses the timer and returning sends immediately with a fresh 30-second interval', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const sent: string[] = [];
  let active = true;
  const socket = { connected: true, emit: (event: string) => sent.push(event) };
  const heartbeat = startPresenceHeartbeat(socket, () => active);
  heartbeat.resume();
  t.mock.timers.tick(20000);
  active = false;
  heartbeat.pause();
  t.mock.timers.tick(65000);
  assert.equal(sent.length, 1);
  // Reconnection in a hidden tab must not send a heartbeat either.
  heartbeat.resume();
  t.mock.timers.tick(30000);
  assert.equal(sent.length, 1);
  active = true;
  heartbeat.resume();
  assert.equal(sent.length, 2);
  t.mock.timers.tick(29999);
  assert.equal(sent.length, 2);
  t.mock.timers.tick(1);
  assert.equal(sent.length, 3);
  // Repeated resumes replace the timer rather than creating duplicate intervals.
  heartbeat.resume();
  heartbeat.resume();
  t.mock.timers.tick(30000);
  assert.equal(sent.length, 6);
  heartbeat.dispose();
  heartbeat.resume();
  t.mock.timers.tick(60000);
  assert.equal(sent.length, 6);
});

test('presence labels use online, the saved last seen date, and a fallback for missing timestamps', () => {
  assert.equal(presenceLabel({ online: true }), 'online');
  assert.equal(presenceLabel({ online: false, last_seen: null }), 'last seen a long time ago');
  assert.equal(presenceLabel({ last_seen: 'invalid' }), 'last seen a long time ago');
  assert.match(
    presenceLabel({ online: false, last_seen: '2026-10-26T12:00:00Z' }),
    /^last seen .*2026 at /,
  );
});
