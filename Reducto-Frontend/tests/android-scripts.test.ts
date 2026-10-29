import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));

function runRelease(overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'reducto-android-test-'));
  const log = path.join(directory, 'calls.jsonl');
  try {
    const mock = path.join(directory, 'mock.cjs');
    writeFileSync(
      mock,
      String.raw`#!${process.execPath}
const { appendFileSync } = require('node:fs');
const command = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_LOG, JSON.stringify({ command, args, abi: process.env.APK_ARCHITECTURES }) + '\n');
if (command === 'adb' && args[0] === 'devices') {
  console.log('List of devices attached\n' + process.env.TEST_DEVICES);
} else if (command === 'adb' && args.includes('getprop')) {
  console.log('arm64-v8a');
} else if (command === 'bash') {
  process.exit(Number(process.env.TEST_BUILD_EXIT || 0));
} else if (command === 'pnpm') {
  process.exit(99);
}
`,
      { mode: 0o755 },
    );
    for (const command of ['adb', 'bash', 'pnpm']) {
      symlinkSync(mock, path.join(directory, command));
    }
    const result = spawnSync(process.execPath, ['scripts/android-dev.mjs', '--release'], {
      cwd: project,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: directory,
        ANDROID_SERIAL: '',
        APK_ARCHITECTURES: '',
        TEST_LOG: log,
        TEST_DEVICES: '192.168.1.56:44053\tdevice',
        ...overrides,
      },
    });
    assert.ifError(result.error);
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    return { ...result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('release phone flow builds, forwards backend, installs and launches without Metro', () => {
  const { status, calls, stderr } = runRelease();
  assert.equal(status, 0, stderr);
  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args]),
    [
      ['adb', 'devices'],
      ['adb', '-s', '192.168.1.56:44053', 'shell', 'getprop', 'ro.product.cpu.abi'],
      ['bash', './build-apk.sh'],
      ['adb', '-s', '192.168.1.56:44053', 'reverse', 'tcp:3000', 'tcp:3000'],
      ['adb', '-s', '192.168.1.56:44053', 'install', '-r', 'dist/reducto.apk'],
      [
        'adb',
        '-s',
        '192.168.1.56:44053',
        'shell',
        'am',
        'start',
        '-n',
        'app.reducto.messenger/.MainActivity',
      ],
    ],
  );
  assert.equal(calls.find(({ command }) => command === 'bash').abi, 'arm64-v8a');
});

test('release phone flow respects explicit device and architecture selection', () => {
  const { status, calls, stderr } = runRelease({
    TEST_DEVICES: 'usb-phone\tdevice\n192.168.1.56:44053\tdevice',
    ANDROID_SERIAL: 'usb-phone',
    APK_ARCHITECTURES: 'arm64-v8a,armeabi-v7a',
  });
  assert.equal(status, 0, stderr);
  assert.ok(
    calls
      .filter(({ command, args }) => command === 'adb' && args[0] === '-s')
      .every(({ args }) => args[1] === 'usb-phone'),
  );
  assert.equal(calls.find(({ command }) => command === 'bash').abi, 'arm64-v8a,armeabi-v7a');
});

test('failed release builds stop before installing any APK', () => {
  const { status, calls, stderr } = runRelease({ TEST_BUILD_EXIT: '1' });
  assert.equal(status, 1);
  assert.match(stderr, /bash exited with 1/);
  assert.equal(calls.length, 3);
});

test('ambiguous device selection stops before building or installing', () => {
  const { status, calls, stderr } = runRelease({ TEST_DEVICES: 'one\tdevice\ntwo\tdevice' });
  assert.equal(status, 1);
  assert.match(stderr, /Connect one authorized phone/);
  assert.equal(calls.length, 1);
});

test('package commands expose build-only and release install entry points', () => {
  const { scripts } = JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8'));
  assert.equal(scripts['android:release'], 'bash ./build-apk.sh');
  assert.equal(scripts['android:dev-no-debug'], 'node scripts/android-dev.mjs --release');
  assert.equal(scripts['android:dev'], 'node scripts/android-dev.mjs');
});
