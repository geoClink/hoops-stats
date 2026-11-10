// Vercel serverless function: every /api/* request is routed here (see vercel.json).
const { createHandler, pgDb } = require('../lib/api');

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const handle = url ? createHandler(pgDb(url)) : null;

module.exports = async (req, res) => {
  if (!handle) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Database not connected. Add Neon in the Vercel project (Storage tab), then redeploy.' }));
  }
  const u = new URL(req.url, 'http://x');
  const path = u.searchParams.get('__path');
  await handle(req, res, path !== null ? '/api/' + path : u.pathname);
};
