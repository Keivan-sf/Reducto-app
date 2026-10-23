import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoicePlayback, type VoiceAudioPlayer, type VoiceStatus } from '../src/lib/voice-playback';

const track = (key: string) => ({
  key,
  uri: `file:///${key}.ogg`,
  senderId: 'sender',
  duration: 30,
});
function harness(prepare = async () => {}) {
  const players: ReturnType<typeof makePlayer>[] = [];
  const pins = new Set<string>();
  function makePlayer() {
    let released = false;
    let listener: ((status: VoiceStatus) => void) | undefined;
    let plays = 0;
    let pauses = 0;
    let releases = 0;
    const check = () => assert.equal(released, false, 'Native player was already released');
    const status: VoiceStatus = { playing: false, currentTime: 0, duration: 30, isLoaded: true };
    const emit = (value: Partial<VoiceStatus>) => {
      Object.assign(status, value);
      listener?.({ ...status });
    };
    const player: VoiceAudioPlayer = {
      get currentStatus() {
        check();
        return { ...status };
      },
      play() {
        check();
        plays++;
        emit({ playing: true, didJustFinish: false, error: null });
      },
      pause() {
        check();
        pauses++;
        emit({ playing: false });
      },
      async seekTo(currentTime) {
        check();
        emit({ currentTime, didJustFinish: false });
      },
      release() {
        check();
        released = true;
        releases++;
      },
      addListener(_event, callback) {
        listener = callback;
        return {
          remove() {
            listener = undefined;
          },
        };
      },
    };
    return { player, emit, counts: () => ({ plays, pauses, releases }) };
  }
  const playback = new VoicePlayback(
    () => {
      const next = makePlayer();
      players.push(next);
      return next.player;
    },
    prepare,
    (key) => {
      pins.add(key);
      return () => {
        pins.delete(key);
      };
    },
  );
  return { playback, players, pins };
}

test('bubble subscribers can unmount while session playback and its cached file remain active', async () => {
  const { playback, players, pins } = harness();
  const unmountBubble = playback.subscribe(() => {});
  await playback.play(track('one'));
  unmountBubble();
  players[0].emit({ currentTime: 7 });
  assert.equal(playback.read().playing, true);
  assert.equal(playback.read().currentTime, 7);
  assert.deepEqual([...pins], ['one']);
  assert.deepEqual(players[0].counts(), { plays: 1, pauses: 0, releases: 0 });
  playback.close();
});

test('mini player pause/resume preserves position and shares the existing player', async () => {
  const { playback, players } = harness();
  await playback.play(track('one'));
  players[0].emit({ currentTime: 8 });
  playback.pause();
  assert.equal(playback.read().playing, false);
  await playback.resume();
  assert.equal(playback.read().playing, true);
  assert.equal(playback.read().currentTime, 8);
  assert.equal(players.length, 1);
  playback.close();
});

test('switching messages stops/releases the old player and transfers the cache pin', async () => {
  const { playback, players, pins } = harness();
  await playback.play(track('one'));
  await playback.play(track('two'));
  assert.deepEqual(players[0].counts(), { plays: 1, pauses: 1, releases: 1 });
  assert.deepEqual([...pins], ['two']);
  players[0].emit({ currentTime: 99 });
  assert.equal(playback.read().track?.key, 'two');
  assert.equal(playback.read().currentTime, 0);
  playback.close();
});

test('close/sign-out releases once, clears the bar, and never touches a released native object', async () => {
  const { playback, players, pins } = harness();
  await playback.play(track('one'));
  playback.close();
  playback.close();
  playback.pause();
  await playback.resume();
  assert.equal(playback.read().track, undefined);
  assert.equal(pins.size, 0);
  assert.equal(players[0].counts().releases, 1);
});

test('close or pause during audio setup prevents late playback', async () => {
  for (const action of ['close', 'pause'] as const) {
    let ready!: () => void;
    const { playback, players } = harness(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const starting = playback.play(track('one'));
    playback[action]();
    ready();
    await starting;
    assert.equal(players[0].counts().plays, 0);
    playback.close();
  }
});

test('seeking a paused voice preserves pause and completion can be replayed from the beginning', async () => {
  const { playback, players } = harness();
  await playback.play(track('one'));
  playback.pause();
  await playback.seek(12);
  assert.equal(playback.read().currentTime, 12);
  assert.equal(playback.read().playing, false);
  players[0].emit({ currentTime: 30, didJustFinish: true, playing: false });
  await playback.resume();
  assert.equal(playback.read().currentTime, 0);
  assert.equal(playback.read().playing, true);
  playback.close();
});
