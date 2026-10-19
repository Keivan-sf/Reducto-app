import { spawn } from 'node:child_process';

// Server selection is configured by each client on the sign-in screen.
const expo = spawn('pnpm', ['exec', 'expo', 'start', '--web', '--go', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
process.once('SIGINT', () => expo.kill('SIGTERM'));
process.once('SIGTERM', () => expo.kill('SIGTERM'));
expo.on('exit', (code) => process.exit(code ?? 0));
