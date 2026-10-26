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

test('presence labels handle online and missing, invalid, or future timestamps', () => {
  const now = new Date(2026, 2, 3, 9, 30).getTime();
  assert.equal(presenceLabel({ online: true }, now), 'online');
  assert.equal(presenceLabel({ online: false, last_seen: null }, now), 'last seen a long time ago');
  assert.equal(presenceLabel({ last_seen: 'invalid' }, now), 'last seen a long time ago');
  assert.equal(
    presenceLabel({ last_seen: new Date(now + 60000).toISOString() }, now),
    'last seen just now',
  );
});

test('last seen uses whole minutes or hours below 12 hours, local time below 24 hours, then DD/MM/YYYY', () => {
  const lastSeen = new Date(2026, 2, 2, 9, 30);
  const presence = { online: false, last_seen: lastSeen.toISOString() };
  const examples: [number, string][] = [
    [0, 'last seen just now'],
    [59999, 'last seen just now'],
    [60000, 'last seen 1 minute ago'],
    [47 * 60000, 'last seen 47 minutes ago'],
    [60 * 60000 - 1, 'last seen 59 minutes ago'],
    [60 * 60000, 'last seen 1 hour ago'],
    [119 * 60000, 'last seen 1 hour ago'],
    [4 * 3600000 + 47 * 60000, 'last seen 4 hours ago'],
    [12 * 3600000 - 1, 'last seen 11 hours ago'],
    [12 * 3600000, 'last seen at 9:30'],
    [24 * 3600000 - 1, 'last seen at 9:30'],
    [24 * 3600000, 'last seen 02/03/2026'],
    [48 * 3600000, 'last seen 02/03/2026'],
  ];
  for (const [elapsed, expected] of examples) {
    assert.equal(
      presenceLabel(presence, lastSeen.getTime() + elapsed),
      expected,
      `${elapsed}ms ago`,
    );
  }
});
