import { spawn } from 'node:child_process';
import { createProxy } from './proxy.mjs';

const proxy = createProxy();
proxy.on('error', (error) => {
  console.error(`Cannot start API proxy: ${error.message}`);
  process.exit(1);
});
proxy.listen(Number(process.env.PROXY_PORT ?? 3001), '0.0.0.0', () => {
  console.log('Reducto API proxy ready. Starting Expo for web and Expo Go.');
  const expo = spawn('pnpm', ['exec', 'expo', 'start', '--web', '--go', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });
  const stop = () => {
    expo.kill('SIGTERM');
    proxy.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  expo.on('exit', (code) => {
    proxy.close();
    process.exit(code ?? 0);
  });
});
