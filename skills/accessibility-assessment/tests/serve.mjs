// Tiny static file server for the owned fixtures under tests/fixtures/. No deps: plain
// node:http. Picks a free/ephemeral port (listen on 0) and serves files relative to `dir`,
// decoding the URL pathname and ignoring any query string (fixtures read `?v=` themselves
// client-side via `location.search`, so the server doesn't need to know about it - the same
// URL serves every "variant", mirroring a real dev server that re-serves the same URL after a
// source edit).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Serves `dir` on an ephemeral port. Returns `{ server, port, url, close() }`. */
export function serveDir(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    try {
      const parsed = url.parse(req.url);
      let pathname = decodeURIComponent(parsed.pathname ?? '/');
      if (pathname === '/') pathname = '/index.html';
      const file = path.join(root, pathname);
      if (!file.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      res.writeHead(500).end(String(err?.message ?? err));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
