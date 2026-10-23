import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--build')) {
  console.error('Usage: pnpm android:dev [--build]');
  process.exit(1);
}

function output(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}
function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}
async function metroReady() {
  try {
    const response = await fetch('http://127.0.0.1:8081/status', {
      signal: AbortSignal.timeout(1000),
    });
    return (await response.text()) === 'packager-status:running';
  } catch {
    return false;
  }
}

let metro;
try {
  const devices = output('adb', ['devices'])
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, state]) => state === 'device')
    .map(([serial]) => serial);
  const serial = process.env.ANDROID_SERIAL || (devices.length === 1 ? devices[0] : undefined);
  if (!serial || !devices.includes(serial)) {
    throw new Error('Connect one authorized phone with adb, or set ANDROID_SERIAL to its serial.');
  }
  const adb = (...args) => run('adb', ['-s', serial, ...args]);
  console.log(`Using Android device: ${serial}`);
  const apk = 'dist/reducto-debug.apk';
  if (args.includes('--build') || !existsSync(apk)) {
    const abi = output('adb', ['-s', serial, 'shell', 'getprop', 'ro.product.cpu.abi']);
    await run('bash', ['./build-apk.sh', '--debug'], {
      ...process.env,
      APK_ARCHITECTURES: process.env.APK_ARCHITECTURES || abi,
    });
  }
  // Reverse forwarding works over an already paired wireless ADB connection too.
  for (const port of [8081, 3000]) await adb('reverse', `tcp:${port}`, `tcp:${port}`);
  await adb('install', '-r', apk);

  if (!(await metroReady())) {
    metro = spawn('pnpm', ['exec', 'expo', 'start', '--localhost', '--port', '8081'], {
      stdio: 'inherit',
      env: { ...process.env, BROWSER: 'none' },
    });
    metro.once('error', (error) => {
      console.error(error.message);
      process.exit(1);
    });
    for (let attempt = 0; !(await metroReady()); attempt++) {
      if (metro.exitCode !== null || attempt >= 60)
        throw new Error('Metro did not start on port 8081.');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } else {
    console.log('Reusing Metro on port 8081.');
  }

  await adb('shell', 'am', 'start', '-n', 'app.reducto.messenger/.MainActivity');
  console.log(
    'Reducto is live. Save JS/TS changes for Fast Refresh. Backend: http://localhost:3000',
  );
  console.log('Dev menu: shake the phone. Native/config changes: pnpm android:dev --build');
  if (metro) {
    process.once('SIGINT', () => metro.kill('SIGTERM'));
    process.once('SIGTERM', () => metro.kill('SIGTERM'));
    metro.once('exit', (code) => process.exit(code ?? 0));
  }
} catch (error) {
  metro?.kill('SIGTERM');
  console.error(error.message);
  process.exitCode = 1;
}
