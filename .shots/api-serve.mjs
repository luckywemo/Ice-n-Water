// Local api runner — serves the vercel-style handlers in api/ on
// http://localhost:3000 with .env loaded. Lets the real X OAuth dance
// run end-to-end against the vite dev server:
//   1. node .shots/api-serve.mjs          (this — port 3000)
//   2. VITE_API_URL=http://localhost:3000 npm run dev
//   3. add http://localhost:3000/api/auth/x/callback to the X app's
//      callback whitelist
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// load .env — first wins, never overrides the real environment
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const routes = {
  '/api/auth/x': '../api/auth/x.js',
  '/api/auth/x/callback': '../api/auth/x/callback.js',
  '/api/me': '../api/me.js',
  '/api/ticket': '../api/ticket.js',
  '/api/score': '../api/score.js',
  '/api/board': '../api/board.js',
};

/** vercel's res helpers, shimmed onto a node ServerResponse */
function shim(res) {
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (j) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(j));
    return res;
  };
  res.redirect = (u) => {
    res.statusCode = 302;
    res.setHeader('Location', u);
    res.end();
    return res;
  };
  return res;
}

const readBody = (req) =>
  new Promise((r, j) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try {
        r(d ? JSON.parse(d) : {});
      } catch {
        j(new Error('bad json'));
      }
    });
    req.on('error', j);
  });

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  const file = routes[url.pathname];
  if (!file) {
    res.writeHead(404).end('not found');
    return;
  }
  const handler = (await import(new URL(file, import.meta.url))).default;
  req.query = Object.fromEntries(url.searchParams);
  req.body = req.method === 'POST' ? await readBody(req).catch(() => ({})) : {};
  await handler(req, shim(res));
}).listen(3000, () => {
  console.log('[api-serve] api/ handlers on http://localhost:3000');
  console.log('  game side: VITE_API_URL=http://localhost:3000 npm run dev');
});
