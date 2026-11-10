// Local runner for Hoops Stats.
//   node local-server.js                      -> uses a built-in database stored in ./data (no setup needed)
//   DATABASE_URL=postgres://... node local-server.js -> uses that Postgres (e.g. your Neon database)
// On Vercel this file is not used; api/index.js handles /api and public/ is served as static files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHandler, pgDb } = require('./lib/api');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');

async function localDb() {
  const { PGlite } = require('@electric-sql/pglite');
  const dir = process.env.DB_DIR || path.join(__dirname, 'data', 'pglite');
  fs.mkdirSync(dir, { recursive: true });
  const pg = await PGlite.create(dir);
  return {
    query: async (text, params) => (await pg.query(text, params)).rows,
    tx: fn => pg.transaction(t => fn(async (text, params) => (await t.query(text, params)).rows)),
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serveStatic(req, res, url) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

(async () => {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const handle = createHandler(dbUrl ? pgDb(dbUrl) : await localDb());
  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) handle(req, res, url.pathname);
    else serveStatic(req, res, url);
  }).listen(PORT, HOST, () =>
    console.log(`Hoops Stats running at http://localhost:${PORT} (${dbUrl ? 'Postgres' : 'local database in ./data'})`));
})();
