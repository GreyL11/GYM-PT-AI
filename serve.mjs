// ponytail: 25 lines of node:http instead of a dev-server dependency. No build step to serve.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 8080);
const ROOT = join(import.meta.dirname, 'www'); // same dir Capacitor bundles into the APK
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css',
  // Must be exact: browsers refuse to stream-compile a .wasm served as anything else.
  '.wasm': 'application/wasm', '.task': 'application/octet-stream',
};

createServer(async (req, res) => {
  // normalize() collapses ../ so a request cannot climb out of ROOT.
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const path = join(ROOT, rel === '/' || rel === '\\' ? 'index.html' : rel);
  if (!path.startsWith(ROOT)) { res.writeHead(403).end('nope'); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
