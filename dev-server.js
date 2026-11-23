// Servidor local para testar o site + API sem Vercel.
// Usa o PGlite (Postgres em memória). Execute: npm install && npm run dev
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createComunidade } from './lib/comunidade.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

export async function startDevServer(port = 3000) {
  const { PGlite } = await import('@electric-sql/pglite');
  const pgl = new PGlite();
  const db = { query: (t, p) => pgl.query(t, p), exec: (t) => pgl.exec(t) };
  const api = createComunidade(db, { secureCookies: false });
  const root = process.cwd();
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/api/comunidade') return api(req, res);
    const file = path === '/' ? 'eurozuca.html' : normalize(path).replace(/^([/\\])+/, '');
    if (file.startsWith('..') || file.startsWith('node_modules') || file.startsWith('lib')) { res.statusCode = 404; return res.end(); }
    try {
      const data = await readFile(join(root, file));
      res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
      res.end(data);
    } catch { res.statusCode = 404; res.end('404'); }
  });
  await new Promise((r) => server.listen(port, r));
  return { server, pgl, url: `http://localhost:${server.address().port}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startDevServer(Number(process.env.PORT) || 3000);
  console.log(`Eurozuca local: ${url}/eurozuca-comunidade.html`);
}
