// Hoops Stats API — shared by the Vercel function (api/index.js) and the local server (server.js).
// `db` must provide: query(text, params) -> rows, and tx(async q => ...) for transactions.
const crypto = require('node:crypto');

const SESSION_DAYS = 30;
const STAT_COLS = ['fg2m', 'fg2a', 'fg3m', 'fg3a', 'ftm', 'fta', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, username TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','viewer')))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username))`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_failures (ip TEXT NOT NULL, at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS seasons (id SERIAL PRIMARY KEY, name TEXT NOT NULL, team TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY, season_id INT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    name TEXT NOT NULL, number TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY, season_id INT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    date TEXT NOT NULL, time TEXT NOT NULL DEFAULT '', opponent TEXT NOT NULL DEFAULT '',
    team_score INT, opp_score INT, notes TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS stats (
    game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    ${STAT_COLS.map(c => `${c} INT NOT NULL DEFAULT 0`).join(', ')},
    PRIMARY KEY (game_id, player_id))`,
];

// ---------- helpers ----------
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
const fail = (s, m) => { throw new HttpError(s, m); };
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const int = v => (v === '' || v === null || v === undefined) ? null : Math.max(0, Math.min(999, parseInt(v, 10) || 0));
const num = v => Number(v);

function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPw(pw, user) {
  return crypto.timingSafeEqual(crypto.scryptSync(pw, user.salt, 64), Buffer.from(user.hash, 'hex'));
}
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (req.body !== undefined) { // Vercel already parsed it
    if (typeof req.body === 'string') { try { return JSON.parse(req.body || '{}'); } catch { fail(400, 'Bad JSON'); } }
    return req.body || {};
  }
  let data = '';
  for await (const c of req) { data += c; if (data.length > 1e6) fail(413, 'Too large'); }
  try { return data ? JSON.parse(data) : {}; } catch { fail(400, 'Bad JSON'); }
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '?';
}

function createHandler(db) {
  let ready;
  const q = (text, params) => db.query(text, params);
  const one = async (text, params) => (await q(text, params))[0];
  const ensureSchema = () => ready ??= (async () => { for (const s of SCHEMA) await q(s); })().catch(e => { ready = null; throw e; });

  async function getUser(req) {
    const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
    if (!m) return null;
    const row = await one(`SELECT u.id, u.username, u.role, s.expires FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token = $1`, [m[1]]);
    if (!row || num(row.expires) < Date.now()) return null;
    return { id: row.id, username: row.username, role: row.role, token: m[1] };
  }
  async function startSession(req, res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    await q('DELETE FROM sessions WHERE expires < $1', [Date.now()]);
    await q('INSERT INTO sessions (token, user_id, expires) VALUES ($1,$2,$3)', [token, userId, Date.now() + SESSION_DAYS * 864e5]);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  }

  async function api(req, res, p) {
    const method = req.method;
    await ensureSchema();
    const user = await getUser(req);
    const body = ['POST', 'PUT'].includes(method) ? await readBody(req) : {};
    let m;

    // ----- public -----
    if (p === '/api/me' && method === 'GET') {
      const { n } = await one('SELECT COUNT(*)::int AS n FROM users');
      return send(res, 200, { user: user && { username: user.username, role: user.role }, needsSetup: n === 0 });
    }
    if (p === '/api/setup' && method === 'POST') {
      const username = str(body.username, 50), pw = String(body.password || '');
      if (!username || pw.length < 8) fail(400, 'Username and a password of at least 8 characters are required');
      const { salt, hash } = hashPw(pw);
      // Only succeeds while there are no users at all.
      const row = await one(`INSERT INTO users (username, salt, hash, role)
        SELECT $1,$2,$3,'admin' WHERE NOT EXISTS (SELECT 1 FROM users) RETURNING id`, [username, salt, hash]);
      if (!row) fail(403, 'Already set up');
      await startSession(req, res, row.id);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/login' && method === 'POST') {
      const ip = clientIp(req), since = Date.now() - 15 * 60e3;
      await q('DELETE FROM login_failures WHERE at < $1', [since]);
      const { n } = await one('SELECT COUNT(*)::int AS n FROM login_failures WHERE ip = $1', [ip]);
      if (n >= 10) fail(429, 'Too many attempts. Try again in 15 minutes.');
      const u = await one('SELECT * FROM users WHERE lower(username) = lower($1)', [str(body.username, 50)]);
      if (!u || !checkPw(String(body.password || ''), u)) {
        await q('INSERT INTO login_failures (ip, at) VALUES ($1,$2)', [ip, Date.now()]);
        fail(401, 'Wrong username or password');
      }
      await startSession(req, res, u.id);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/logout' && method === 'POST') {
      if (user) await q('DELETE FROM sessions WHERE token = $1', [user.token]);
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return send(res, 200, { ok: true });
    }

    // ----- logged in -----
    if (!user) fail(401, 'Please log in');
    if (method !== 'GET' && user.role !== 'admin' && p !== '/api/password') fail(403, 'View-only account');

    if (p === '/api/password' && method === 'POST') {
      const u = await one('SELECT * FROM users WHERE id = $1', [user.id]);
      if (!checkPw(String(body.current || ''), u)) fail(400, 'Current password is wrong');
      if (String(body.password || '').length < 8) fail(400, 'New password must be at least 8 characters');
      const { salt, hash } = hashPw(String(body.password));
      await q('UPDATE users SET salt=$1, hash=$2 WHERE id=$3', [salt, hash, user.id]);
      await q('DELETE FROM sessions WHERE user_id = $1 AND token <> $2', [user.id, user.token]);
      return send(res, 200, { ok: true });
    }

    // Users (admin only — viewers were already stopped above for writes)
    if (p === '/api/users') {
      if (user.role !== 'admin') fail(403, 'Admins only');
      if (method === 'GET') return send(res, 200, await q('SELECT id, username, role FROM users ORDER BY id'));
      if (method === 'POST') {
        const username = str(body.username, 50), pw = String(body.password || '');
        const role = body.role === 'admin' ? 'admin' : 'viewer';
        if (!username || pw.length < 8) fail(400, 'Username and a password of at least 8 characters are required');
        if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) fail(400, 'That username is taken');
        const { salt, hash } = hashPw(pw);
        await q('INSERT INTO users (username, salt, hash, role) VALUES ($1,$2,$3,$4)', [username, salt, hash, role]);
        return send(res, 200, { ok: true });
      }
    }
    if ((m = /^\/api\/users\/(\d+)$/.exec(p)) && method === 'DELETE') {
      if (num(m[1]) === user.id) fail(400, "You can't delete your own account");
      await q('DELETE FROM users WHERE id = $1', [num(m[1])]);
      return send(res, 200, { ok: true });
    }

    // Seasons
    if (p === '/api/seasons') {
      if (method === 'GET') return send(res, 200, await q('SELECT * FROM seasons ORDER BY id DESC'));
      if (method === 'POST') {
        const name = str(body.name, 60) || fail(400, 'Season name is required');
        const { id } = await one('INSERT INTO seasons (name, team) VALUES ($1,$2) RETURNING id', [name, str(body.team, 80)]);
        if (body.copyPlayersFrom)
          await q('INSERT INTO players (season_id, name, number) SELECT $1, name, number FROM players WHERE season_id = $2 ORDER BY id',
            [id, num(body.copyPlayersFrom)]);
        return send(res, 200, { id });
      }
    }
    if ((m = /^\/api\/seasons\/(\d+)$/.exec(p))) {
      const id = num(m[1]);
      if (method === 'GET') {
        const season = await one('SELECT * FROM seasons WHERE id = $1', [id]) || fail(404, 'Season not found');
        const players = await q(`SELECT * FROM players WHERE season_id = $1
          ORDER BY NULLIF(regexp_replace(number, '\\D', '', 'g'), '')::int NULLS LAST, name`, [id]);
        const games = await q('SELECT * FROM games WHERE season_id = $1 ORDER BY date, time, id', [id]);
        const stats = await q('SELECT s.* FROM stats s JOIN games g ON g.id = s.game_id WHERE g.season_id = $1', [id]);
        return send(res, 200, { season, players, games, stats });
      }
      if (method === 'PUT') {
        await q('UPDATE seasons SET name=$1, team=$2 WHERE id=$3', [str(body.name, 60), str(body.team, 80), id]);
        return send(res, 200, { ok: true });
      }
      if (method === 'DELETE') { await q('DELETE FROM seasons WHERE id = $1', [id]); return send(res, 200, { ok: true }); }
    }

    // Players
    if (p === '/api/players' && method === 'POST') {
      const name = str(body.name, 80) || fail(400, 'Player name is required');
      const { id } = await one('INSERT INTO players (season_id, name, number) VALUES ($1,$2,$3) RETURNING id',
        [num(body.season_id), name, str(body.number, 4)]);
      return send(res, 200, { id });
    }
    if ((m = /^\/api\/players\/(\d+)$/.exec(p))) {
      if (method === 'PUT') {
        await q('UPDATE players SET name=$1, number=$2 WHERE id=$3', [str(body.name, 80), str(body.number, 4), num(m[1])]);
        return send(res, 200, { ok: true });
      }
      if (method === 'DELETE') { await q('DELETE FROM players WHERE id = $1', [num(m[1])]); return send(res, 200, { ok: true }); }
    }

    // Games: game info + every player's line, saved together
    async function saveGame(id) {
      const date = str(body.date, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Game date is required');
      const time = /^\d{2}:\d{2}$/.test(str(body.time, 5)) ? str(body.time, 5) : '';
      const info = [date, time, str(body.opponent, 80), int(body.team_score), int(body.opp_score), str(body.notes, 2000)];
      return db.tx(async t => {
        if (id) {
          const r = await t('UPDATE games SET date=$1, time=$2, opponent=$3, team_score=$4, opp_score=$5, notes=$6 WHERE id=$7 RETURNING id', [...info, id]);
          if (!r.length) fail(404, 'Game not found');
        } else {
          id = (await t(`INSERT INTO games (date, time, opponent, team_score, opp_score, notes, season_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [...info, num(body.season_id)]))[0].id;
        }
        await t('DELETE FROM stats WHERE game_id = $1', [id]);
        const cols = STAT_COLS.map((c, i) => `$${i + 3}`).join(',');
        for (const line of Array.isArray(body.lines) ? body.lines : []) {
          await t(`INSERT INTO stats (game_id, player_id, ${STAT_COLS.join(',')}) VALUES ($1,$2,${cols})`,
            [id, num(line.player_id), ...STAT_COLS.map(c => int(line[c]) || 0)]);
        }
        return id;
      });
    }
    if (p === '/api/games' && method === 'POST') return send(res, 200, { id: await saveGame(null) });
    if ((m = /^\/api\/games\/(\d+)$/.exec(p))) {
      if (method === 'PUT') return send(res, 200, { id: await saveGame(num(m[1])) });
      if (method === 'DELETE') { await q('DELETE FROM games WHERE id = $1', [num(m[1])]); return send(res, 200, { ok: true }); }
    }

    fail(404, 'Not found');
  }

  // (req, res, pathname) — returns a promise; always answers with JSON.
  return async (req, res, pathname) => {
    try { await api(req, res, pathname); }
    catch (e) {
      if (e instanceof HttpError) send(res, e.status, { error: e.message });
      else { console.error(e); send(res, 500, { error: 'Something went wrong' }); }
    }
  };
}

// Database adapter for any Postgres (Neon on Vercel) via the `pg` package.
function pgDb(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString, max: 3, ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false } });
  return {
    query: async (text, params) => (await pool.query(text, params)).rows,
    tx: async fn => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(async (text, params) => (await client.query(text, params)).rows);
        await client.query('COMMIT');
        return out;
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
      finally { client.release(); }
    },
  };
}

module.exports = { createHandler, pgDb };
