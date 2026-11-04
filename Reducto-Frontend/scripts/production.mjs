import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(projectDir, 'dist/web');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export async function compressAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await compressAssets(path);
    else if (entry.isFile() && /\.(html|js|css|json|svg|txt)$/.test(entry.name)) {
      const data = await readFile(path);
      if (data.length < 1024) continue;
      for (const [suffix, compressed] of [
        [
          'br',
          await promisify(brotliCompress)(data, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 9 },
          }),
        ],
        ['gz', await promisify(gzip)(data, { level: 9 })],
      ]) {
        if (compressed.length < data.length) await writeFile(`${path}.${suffix}`, compressed);
      }
    }
  }
}

// Prefer Brotli on a tie, but respect explicit q=0 exclusions.
function encodings(header = '') {
  const weights = new Map(
    header
      .toLowerCase()
      .split(',')
      .map((part) => {
        const [name, ...params] = part.trim().split(';');
        const quality = params.find((param) => param.trim().startsWith('q='));
        return [name, quality ? Number(quality.trim().slice(2)) : 1];
      }),
  );
  return ['br', 'gzip']
    .map((name) => [name, weights.get(name) ?? weights.get('*') ?? 0])
    .filter(([, weight]) => weight > 0 && weight <= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

export async function createProductionServer(directory = outputDir) {
  const root = await realpath(directory);
  await access(resolve(root, 'index.html'));
  const insideRoot = (path) => {
    const fromRoot = relative(root, path);
    return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
  };
  async function file(path) {
    try {
      const actual = await realpath(path);
      if (!insideRoot(actual)) return null;
      const info = await stat(actual);
      return info.isFile() ? { path: actual, info } : null;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    }
  }
  return createServer(async (request, response) => {
    const reply = (status, message) => {
      response.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(request.method === 'HEAD' ? undefined : message);
    };
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', 'GET, HEAD');
        return reply(405, 'Method not allowed');
      }
      let pathname;
      try {
        pathname = decodeURIComponent(request.url.split('?')[0]);
      } catch {
        return reply(400, 'Malformed URL');
      }
      if (
        !pathname.startsWith('/') ||
        pathname.includes('\\') ||
        pathname.includes('\0') ||
        pathname.split('/').some((part) => part.startsWith('.')) ||
        /\.(br|gz|map)$/.test(pathname)
      ) {
        return reply(404, 'Not found');
      }
      const candidate = resolve(root, `.${pathname}`);
      if (!insideRoot(candidate)) return reply(404, 'Not found');
      let asset = await file(candidate);
      // Missing JS/images must return 404, while browser navigation supports Router deep links.
      if (
        !asset &&
        (pathname === '/' || request.headers.accept?.includes('text/html')) &&
        !extname(pathname) &&
        !pathname.startsWith('/_expo/') &&
        !pathname.startsWith('/assets/')
      ) {
        asset = await file(resolve(root, 'index.html'));
      }
      if (!asset) return reply(404, 'Not found');
      const original = asset.path;
      let encoding;
      for (const name of encodings(request.headers['accept-encoding'])) {
        const compressed = await file(`${original}.${name === 'gzip' ? 'gz' : 'br'}`);
        if (compressed) {
          asset = compressed;
          encoding = name;
          break;
        }
      }
      const etag = `W/"${asset.info.size.toString(16)}-${asset.info.mtimeMs.toString(16)}-${encoding ?? 'identity'}"`;
      response.setHeader('Content-Type', types[extname(original)] ?? 'application/octet-stream');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Vary', 'Accept-Encoding');
      // Only content-hashed Expo assets can safely survive a deployment in browser caches.
      response.setHeader(
        'Cache-Control',
        /[-./][a-f0-9]{32,}\.[^/]+$/.test(relative(root, original))
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
      response.setHeader('ETag', etag);
      if (encoding) response.setHeader('Content-Encoding', encoding);
      if (
        request.headers['if-none-match']?.split(/,\s*/).some((tag) => tag === etag || tag === '*')
      ) {
        response.writeHead(304);
        return response.end();
      }
      response.setHeader('Content-Length', asset.info.size);
      response.writeHead(200);
      if (request.method === 'HEAD') return response.end();
      await pipeline(createReadStream(asset.path), response);
    } catch (error) {
      if (error.code === 'ERR_STREAM_PREMATURE_CLOSE' || request.destroyed) return;
      console.error(error);
      if (response.headersSent) response.destroy();
      else reply(500, 'Internal server error');
    }
  });
}

async function build() {
  await new Promise((done, reject) => {
    const child = spawn(
      'pnpm',
      ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', 'dist/web'],
      {
        cwd: projectDir,
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production', CI: '1' },
      },
    );
    const stop = () => child.kill('SIGTERM');
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
      if (code === 0) done();
      else reject(new Error(`Expo export failed (${signal ?? code})`));
    });
  });
  await compressAssets(outputDir);
  console.log(`Production web build ready: ${outputDir}`);
}

async function main() {
  const command = process.argv[2] ?? 'start';
  if (command === '--help') {
    console.log(
      'Usage: node scripts/production.mjs [build|start|deploy]\nHOST=0.0.0.0 PORT=8080 by default. deploy builds, then starts.',
    );
    return;
  }
  if (!['build', 'start', 'deploy'].includes(command) || process.argv.length > 3) {
    throw new Error('Expected build, start, or deploy. Use --help for usage.');
  }
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  if (command !== 'start') await build();
  if (command === 'build') return;
  const server = await createProductionServer().catch((error) => {
    throw new Error(`Cannot load dist/web; run pnpm build:production first. ${error.message}`);
  });
  server.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  const host = process.env.HOST ?? '0.0.0.0';
  server.listen(port, host, () =>
    console.log(`Reducto production web server: http://${host}:${port}`),
  );
  const shutdown = () => {
    server.close();
    setTimeout(() => server.closeAllConnections(), 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
