import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

// Development-only CORS adapter; forward auth and bytes without logging secrets.
export function createProxy(target) {
  if (
    !(target instanceof URL) ||
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.pathname !== '/' ||
    target.search ||
    target.hash
  )
    throw new Error('Provide a server origin, such as https://chat.example.com');
  const transport = target.protocol === 'https:' ? https : http;
  return http
    .createServer((request, response) => {
      const origin = request.headers.origin;
      if (
        origin &&
        !/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):\d+$/.test(
          origin,
        )
      ) {
        response.writeHead(403);
        response.end('Origin not allowed');
        return;
      }
      const cors = {
        ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Expose-Headers': 'Content-Disposition, Content-Type',
      };
      if (request.method === 'OPTIONS') {
        response.writeHead(204, cors);
        response.end();
        return;
      }
      if (!/^\/(api\/|health(?:\?|$)|openapi\.json(?:\?|$)|socket\.io\/)/.test(request.url ?? '')) {
        response.writeHead(404, cors);
        response.end();
        return;
      }
      const upstream = transport.request(
        new URL(request.url, target),
        { method: request.method, headers: { ...request.headers, host: target.host } },
        (result) => {
          response.writeHead(result.statusCode ?? 502, { ...result.headers, ...cors });
          result.pipe(response);
        },
      );
      upstream.on('error', () => {
        if (!response.headersSent)
          response.writeHead(502, { ...cors, 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'The Reducto backend is unavailable.' }));
      });
      request.on('aborted', () => upstream.destroy());
      request.pipe(upstream);
    })
    .on('upgrade', (request, socket, head) => {
      if (!request.url?.startsWith('/socket.io/')) {
        socket.destroy();
        return;
      }
      const upstream = transport.request(new URL(request.url, target), {
        headers: { ...request.headers, host: target.host },
      });
      upstream.on('upgrade', (response, peer, initial) => {
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\r\n')}\r\n\r\n`,
        );
        if (initial.length) socket.write(initial);
        if (head.length) peer.write(head);
        peer.pipe(socket);
        socket.pipe(peer);
        peer.on('error', () => socket.destroy());
        socket.on('error', () => peer.destroy());
        socket.on('close', () => peer.destroy());
      });
      upstream.on('error', () => socket.destroy());
      upstream.end();
    });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PROXY_PORT ?? 3001);
  if (!process.argv[2]) throw new Error('Usage: pnpm proxy <server-url>');
  createProxy(new URL(process.argv[2])).listen(port, '0.0.0.0', () =>
    console.log(`Reducto web API proxy: http://localhost:${port}`),
  );
}
