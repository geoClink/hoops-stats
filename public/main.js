// Hoops Stats front end — plain JS, hash routes.
const $app = document.getElementById('app');
const state = { me: null, seasons: [], seasonId: null, data: null };

const STATS = [
  ['fg2m', '2PM', '2-pt made'], ['fg2a', '2PA', '2-pt attempts'],
  ['fg3m', '3PM', '3-pt made'], ['fg3a', '3PA', '3-pt attempts'],
  ['ftm', 'FTM', 'Free throws made'], ['fta', 'FTA', 'Free throw attempts'],
  ['reb', 'REB', 'Rebounds'], ['ast', 'AST', 'Assists'], ['stl', 'STL', 'Steals'],
  ['blk', 'BLK', 'Blocks'], ['tov', 'TO', 'Turnovers'], ['pf', 'PF', 'Fouls'],
];
const TRACK = [['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['stl', 'Steals'], ['blk', 'Blocks'], ['tov', 'Turnovers']];

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isAdmin = () => state.me?.role === 'admin';
const isParent = () => state.me?.role === 'parent';
const ROLE_LABEL = { admin: 'Can edit', viewer: 'View only', parent: 'Parent' };
const pts = l => 2 * l.fg2m + 3 * l.fg3m + l.ftm;
const pct = (m, a) => a ? Math.round(100 * m / a) + '%' : '–';
const avg = (n, gp) => gp ? (n / gp).toFixed(1) : '–';
const fmtDate = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const longDate = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
const fmtTime = t => t ? new Date(`2000-01-01T${t}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
// A game counts once it has a score or any player stats; otherwise it's just on the schedule.
const isPlayed = g => g.team_score != null || state.data.stats.some(s => s.game_id === g.id);
const playedGames = () => state.data.games.filter(isPlayed);
const playerLabel = p => (p.number !== '' ? `#${p.number} ` : '') + p.name;
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

// ---------- attendance ----------
// Who was at a game: the attendance list if one was taken, otherwise anyone with stats.
function presentAtGame(g, pid) {
  const rows = state.data.game_attendance.filter(a => a.game_id === g.id);
  return rows.length ? rows.some(a => a.player_id === pid) : state.data.stats.some(s => s.game_id === g.id && s.player_id === pid);
}
function attendance(pid) {
  const games = playedGames(), past = state.data.practices.filter(pr => pr.date <= todayStr());
  return {
    gHere: games.filter(g => presentAtGame(g, pid)).length, gTotal: games.length,
    pHere: past.filter(pr => state.data.practice_attendance.some(a => a.practice_id === pr.id && a.player_id === pid)).length,
    pTotal: past.length,
  };
}
const attText = (here, total) => total ? `${here}/${total}` : '–';

// ---------- badges ----------
// Milestones a player earned this season, oldest first. Worked out from the stats; nothing extra is stored.
function badges(pid) {
  const out = [], best = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 };
  const names = { pts: 'points', reb: 'rebounds', ast: 'assists', stl: 'steals', blk: 'blocks' };
  let basket = false, three = false, ft = false, season = 0;
  playerLines(pid).forEach((l, i) => {
    const when = `${fmtDate(l.game.date)} vs ${l.game.opponent || 'Opponent'}`;
    const add = (title, kind) => out.push({ title, when, kind });
    if (!basket && l.fg2m + l.fg3m > 0) { basket = true; add('First basket!', 'first'); }
    if (!three && l.fg3m > 0) { three = true; add('First 3-pointer!', 'first'); }
    if (!ft && l.ftm > 0) { ft = true; add('First free throw!', 'first'); }
    for (const k of Object.keys(best)) {
      if (i > 0 && l[k] > best[k] && l[k] >= 2) add(`Season high: ${l[k]} ${names[k]}`, 'high');
      best[k] = Math.max(best[k], l[k]);
    }
    if (l.pts >= 10) add(`Double digits: ${l.pts} points`, 'big');
    if (l.reb >= 8) add(`${l.reb} rebounds in a game`, 'big');
    if (l.ast >= 5) add(`${l.ast} assists in a game`, 'big');
    if (l.stl >= 5) add(`${l.stl} steals in a game`, 'big');
    if (l.blk >= 3) add(`${l.blk} blocks in a game`, 'big');
    const before = season; season += l.pts;
    for (const m of [25, 50, 100, 150, 200]) if (before < m && season >= m) add(`${m} points this season`, 'total');
  });
  const a = attendance(pid);
  if (a.pTotal >= 5 && a.pHere === a.pTotal) out.push({ title: 'Never missed a practice', when: `${a.pTotal} practices`, kind: 'team' });
  return out;
}
function badgeList(pid, max) {
  const all = badges(pid).reverse();
  if (!all.length) return '<p class="muted small">Badges appear here as milestones happen: first basket, season highs and more.</p>';
  return `<div class="badges">${all.slice(0, max || all.length).map(b => `<div class="badge badge-${b.kind}"><span class="medal" aria-hidden="true"></span>
    <div><b>${esc(b.title)}</b><small>${esc(b.when)}</small></div></div>`).join('')}</div>`;
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { state.me = null; route(); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}
function formData(form) { return Object.fromEntries(new FormData(form)); }

// ---------- stats math ----------
function totals(lines) {
  const t = { gp: lines.length, pts: 0 };
  STATS.forEach(([k]) => t[k] = 0);
  for (const l of lines) { STATS.forEach(([k]) => t[k] += l[k]); t.pts += pts(l); }
  t.fgm = t.fg2m + t.fg3m; t.fga = t.fg2a + t.fg3a;
  return t;
}
function playerLines(pid) {
  const { games, stats } = state.data;
  return games.map(g => {
    const l = stats.find(s => s.game_id === g.id && s.player_id === pid);
    return l ? { ...l, pts: pts(l), game: g } : null;
  }).filter(Boolean);
}
// Compare first half of games played vs second half.
function improvement(lines) {
  if (lines.length < 2) return null;
  const half = Math.floor(lines.length / 2);
  const a = totals(lines.slice(0, half)), b = totals(lines.slice(lines.length - half));
  return TRACK.map(([k, label]) => ({ k, label, early: a[k] / a.gp, late: b[k] / b.gp }))
    .concat([{ k: 'fgp', label: 'Field goal %', early: a.fga ? 100 * a.fgm / a.fga : null, late: b.fga ? 100 * b.fgm / b.fga : null, isPct: true },
             { k: 'ftp', label: 'Free throw %', early: a.fta ? 100 * a.ftm / a.fta : null, late: b.fta ? 100 * b.ftm / b.fta : null, isPct: true }]);
}
function result(g) {
  if (g.team_score == null || g.opp_score == null) return '';
  return g.team_score > g.opp_score ? 'W' : g.team_score < g.opp_score ? 'L' : 'T';
}

// ---------- chart ----------
function lineChart(values, labels, { height = 180, title = '' } = {}) {
  const w = 640, h = height, pad = { l: 34, r: 14, t: 18, b: 30 };
  if (!values.length) return '<p class="muted">No games yet.</p>';
  const max = Math.max(4, ...values);
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const x = i => pad.l + (values.length === 1 ? (w - pad.l - pad.r) / 2 : i * (w - pad.l - pad.r) / (values.length - 1));
  const y = v => pad.t + (h - pad.t - pad.b) * (1 - v / top);
  const grid = [0, 1, 2, 3, 4].map(i => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(i * step)}" y2="${y(i * step)}" class="grid"/>
    <text x="${pad.l - 6}" y="${y(i * step) + 4}" class="axis" text-anchor="end">${i * step}</text>`).join('');
  const pathD = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  // Trend line (least squares)
  let trend = '';
  if (values.length >= 3) {
    const n = values.length, mx = (n - 1) / 2, my = values.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    values.forEach((v, i) => { num += (i - mx) * (v - my); den += (i - mx) ** 2; });
    const slope = num / den, b0 = my - slope * mx;
    const clamp = v => Math.max(0, Math.min(top, v));
    trend = `<line x1="${x(0)}" y1="${y(clamp(b0))}" x2="${x(n - 1)}" y2="${y(clamp(b0 + slope * (n - 1)))}" class="trend"/>`;
  }
  const every = Math.ceil(labels.length / 10);
  const dots = values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" class="dot"><title>${esc(labels[i])}: ${v}</title></circle>
    ${i % every === 0 ? `<text x="${x(i)}" y="${h - 10}" class="axis" text-anchor="middle">${esc(labels[i])}</text>` : ''}`).join('');
  return `<figure class="chart">${title ? `<figcaption>${esc(title)} ${trend ? '<span class="legend"><i class="lg-line"></i>each game <i class="lg-trend"></i>trend</span>' : ''}</figcaption>` : ''}
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">${grid}${trend}<path d="${pathD}" class="line"/>${dots}</svg></figure>`;
}

// ---------- views ----------
function viewAuth(setup) {
  document.getElementById('topbar').hidden = true;
  $app.innerHTML = `
  <section class="auth">
    <div class="auth-card">
      <div class="brand big"><span class="ball" aria-hidden="true"></span>Hoops Stats</div>
      <p class="muted">${setup ? 'First time here. Create the main (admin) account — you\'ll use it to enter stats.' : 'Log in to see the team\'s stats.'}</p>
      <form id="auth">
        <label>Username <input name="username" autocomplete="username" required></label>
        <label>Password <input name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? 8 : 1}" required></label>
        <p class="error" id="err"></p>
        <button class="primary wide">${setup ? 'Create account' : 'Log in'}</button>
      </form>
    </div>
  </section>`;
  document.getElementById('auth').onsubmit = async e => {
    e.preventDefault();
    try { await api(setup ? '/setup' : '/login', { method: 'POST', body: formData(e.target) }); await boot(); }
    catch (err) { document.getElementById('err').textContent = err.message; }
  };
}

function seasonPicker() {
  if (!state.seasons.length) return '';
  return `<select id="seasonPick" class="no-print" aria-label="Season">${state.seasons.map(s =>
    `<option value="${s.id}" ${s.id === state.seasonId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
}
function bindSeasonPicker() {
  const sel = document.getElementById('seasonPick');
  if (sel) sel.onchange = async () => { state.seasonId = Number(sel.value); localStorage.seasonId = sel.value; await loadSeason(); route(); };
}

function noSeason() {
  $app.innerHTML = `<section class="empty"><h1>Welcome!</h1>
    ${isAdmin() ? `<p>Start by creating a season and adding the players.</p><a class="button primary" href="#/settings">Set up a season</a>`
      : '<p>No season has been set up yet.</p>'}</section>`;
}

function viewSeason() {
  if (!state.data) return noSeason();
  const { season, players } = state.data;
  const games = playedGames();
  const upcoming = state.data.games.filter(g => !isPlayed(g));
  const rec = games.reduce((r, g) => { const x = result(g); if (x) r[x]++; return r; }, { W: 0, L: 0, T: 0 });
  const rows = players.map(p => ({ p, t: totals(playerLines(p.id)), a: attendance(p.id) }));
  const gameRow = g => {
    const r = result(g);
    return `<a class="game-row" href="#/game/${g.id}"><span class="date">${fmtDate(g.date)}${g.time ? `<small>${fmtTime(g.time)}</small>` : ''}</span>
      <span class="opp">vs ${esc(g.opponent || 'Opponent')}</span>
      <span class="score">${r ? `<b class="res res-${r}">${r}</b> ${g.team_score}–${g.opp_score}` : isPlayed(g) ? 'Stats entered' : isAdmin() ? '<span class="tag">Enter stats →</span>' : '<span class="tag">Upcoming</span>'}</span></a>`;
  };
  const leader = k => rows.filter(r => r.t.gp).sort((a, b) => b.t[k] - a.t[k])[0];
  const leaders = [['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['stl', 'Steals']].map(([k, label]) => {
    const r = leader(k);
    return `<div class="tile"><span class="tile-label">${label} leader</span>
      <strong>${r && r.t[k] ? esc(r.p.name) : '–'}</strong><span class="muted">${r && r.t[k] ? `${r.t[k]} total · ${avg(r.t[k], r.t.gp)} per game` : ''}</span></div>`;
  }).join('');

  $app.innerHTML = `
  <div class="page-head">
    <div><h1>${esc(season.team || 'Our team')}</h1><p class="muted">${esc(season.name)} · ${games.length} game${games.length === 1 ? '' : 's'} played
      ${rec.W + rec.L + rec.T ? ` · Record <strong>${rec.W}-${rec.L}${rec.T ? '-' + rec.T : ''}</strong>` : ''}</p></div>
    <div class="actions">${seasonPicker()}${isAdmin() ? '<a class="button primary" href="#/game/new">+ Enter a game</a>' : ''}</div>
  </div>
  <div class="tiles">${leaders}</div>

  <h2>Player season stats <span class="muted small">— click a player to see their progress</span></h2>
  <div class="table-wrap"><table class="stats">
    <thead><tr><th class="left">Player</th><th title="Games played">GP</th><th>PTS</th><th>PPG</th><th>REB</th><th>RPG</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th><th>FG%</th><th>3P%</th><th>FT%</th><th title="Games attended">Att.</th><th title="Practices attended">Prac.</th></tr></thead>
    <tbody>${rows.map(({ p, t, a }) => `<tr>
      <td class="left"><a href="#/player/${p.id}">${esc(playerLabel(p))}</a></td><td>${t.gp}</td><td><strong>${t.pts}</strong></td><td>${avg(t.pts, t.gp)}</td>
      <td>${t.reb}</td><td>${avg(t.reb, t.gp)}</td><td>${t.ast}</td><td>${t.stl}</td><td>${t.blk}</td><td>${t.tov}</td><td>${t.pf}</td>
      <td>${pct(t.fgm, t.fga)}</td><td>${pct(t.fg3m, t.fg3a)}</td><td>${pct(t.ftm, t.fta)}</td>
      <td>${attText(a.gHere, a.gTotal)}</td><td>${attText(a.pHere, a.pTotal)}</td></tr>`).join('') ||
      `<tr><td colspan="16" class="muted">No players yet. ${isAdmin() ? '<a href="#/settings">Add players</a>' : ''}</td></tr>`}</tbody>
  </table></div>

  <h2>Schedule</h2>
  ${isAdmin() ? `<form id="schedule" class="inline card">
    <label>Date <input type="date" name="date" required></label>
    <label>Time <input type="time" name="time"></label>
    <label class="grow">Playing against <input name="opponent" required placeholder="e.g. Lincoln Elementary"></label>
    <button class="primary">Add to schedule</button>
  </form>` : ''}
  <div class="games">${upcoming.map(gameRow).join('') || '<p class="muted">No upcoming games on the schedule.</p>'}</div>

  <h2>Results</h2>
  <div class="games">${games.slice().reverse().map(gameRow).join('') || '<p class="muted">No games played yet.</p>'}</div>

  <h2>Practices</h2>
  ${isAdmin() ? `<form id="addPractice" class="inline card">
    <label>Date <input type="date" name="date" value="${todayStr()}" required></label>
    <label>Time <input type="time" name="time"></label>
    <button class="primary">Add practice &amp; take attendance</button>
  </form>` : ''}
  <div class="games">${state.data.practices.slice().reverse().map(pr => {
    const n = state.data.practice_attendance.filter(a => a.practice_id === pr.id).length;
    return `<a class="game-row" href="#/practice/${pr.id}"><span class="date">${fmtDate(pr.date)}${pr.time ? `<small>${fmtTime(pr.time)}</small>` : ''}</span>
      <span class="opp">Practice</span><span class="score">${n ? `${n} of ${players.length} here` : pr.date > todayStr() ? '<span class="tag">Upcoming</span>' : 'No attendance yet'}</span></a>`;
  }).join('') || '<p class="muted">No practices yet.</p>'}</div>`;
  bindSeasonPicker();
  const addPr = document.getElementById('addPractice');
  if (addPr) addPr.onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await api('/practices', { method: 'POST', body: { ...formData(addPr), season_id: state.seasonId, present: [] } });
      await loadSeason(); location.hash = `#/practice/${r.id}`;
    } catch (err) { toast(err.message, true); }
  };
  const sched = document.getElementById('schedule');
  if (sched) sched.onsubmit = async e => {
    e.preventDefault();
    try {
      await api('/games', { method: 'POST', body: { ...formData(sched), season_id: state.seasonId, lines: [] } });
      await loadSeason(); toast('Added to schedule'); viewSeason();
      document.querySelector('#schedule [name=date]').focus();
    } catch (err) { toast(err.message, true); }
  };
}

function viewGame(id) {
  if (!state.data) return noSeason();
  const { players, games, stats, season } = state.data;
  const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  const g = id === 'new' ? { date: today.toISOString().slice(0, 10), time: '', opponent: '', team_score: '', opp_score: '', notes: '' }
    : games.find(x => x.id === Number(id));
  if (!g) { $app.innerHTML = '<p>Game not found.</p>'; return; }
  const lineFor = pid => stats.find(s => s.game_id === g.id && s.player_id === pid);
  const noStatsYet = id === 'new' || !stats.some(s => s.game_id === g.id);

  if (!isAdmin()) {
    if (!isPlayed(g)) { $app.innerHTML = `<a href="#/" class="back">← Season</a><h1>vs ${esc(g.opponent || 'Opponent')}</h1>
      <p class="muted">${longDate(g.date)}${g.time ? ' · ' + fmtTime(g.time) : ''} · Stats not entered yet.</p>`; return; }
    return viewBoxScore(g, season, players, lineFor);
  }

  $app.innerHTML = `
  <div class="page-head">
    <div><a href="#/" class="back">← Season</a><h1>${id === 'new' ? 'Enter a game' : noStatsYet ? `Enter stats: vs ${esc(g.opponent || 'Opponent')}` : 'Edit game'}</h1>
    <p class="muted">Copy the numbers from the paper stat sheet. “Here” is attendance; uncheck “Played” for anyone who came but sat out.</p></div>
    <div class="actions">${id !== 'new' ? `<a class="button primary" href="#/live/${g.id}">Live entry (phone)</a><a class="button" href="#/box/${g.id}">Print box score</a>` : ''}</div>
  </div>
  <form id="game">
    <div class="game-info">
      <label>Date <input type="date" name="date" value="${esc(g.date)}" required></label>
      <label>Time <input type="time" name="time" value="${esc(g.time)}"></label>
      <label class="grow">Playing against <input name="opponent" value="${esc(g.opponent)}" placeholder="e.g. Lincoln Elementary"></label>
      <label>Our score <input type="number" min="0" name="team_score" value="${g.team_score ?? ''}" class="num"></label>
      <label>Their score <input type="number" min="0" name="opp_score" value="${g.opp_score ?? ''}" class="num"></label>
    </div>
    <div class="table-wrap"><table class="entry">
      <thead><tr><th class="left">Player</th><th>Here</th><th>Played</th>${STATS.map(([k, s, t]) => `<th title="${t}">${s}</th>`).join('')}<th>PTS</th></tr></thead>
      <tbody>${players.map(p => {
        const l = lineFor(p.id);
        const played = noStatsYet || !!l;
        const att = state.data.game_attendance.filter(a => a.game_id === g.id);
        const here = att.length ? att.some(a => a.player_id === p.id) : played;
        return `<tr data-pid="${p.id}" class="${played ? '' : 'dnp'}">
          <td class="left">${esc(playerLabel(p))}</td>
          <td><input type="checkbox" class="here" ${here ? 'checked' : ''} aria-label="${esc(p.name)} was here"></td>
          <td><input type="checkbox" class="played" ${played ? 'checked' : ''} aria-label="${esc(p.name)} played"></td>
          ${STATS.map(([k, s]) => `<td><input type="number" min="0" max="99" inputmode="numeric" data-k="${k}" value="${l ? l[k] : ''}" placeholder="0" aria-label="${esc(p.name)} ${s}"></td>`).join('')}
          <td class="pts-cell">${l ? pts(l) : 0}</td></tr>`;
      }).join('') || `<tr><td colspan="16" class="muted">Add players in Settings first.</td></tr>`}</tbody>
      <tfoot><tr><td class="left">Team</td><td></td><td></td>${STATS.map(([k]) => `<td data-total="${k}"></td>`).join('')}<td data-total="pts"></td></tr></tfoot>
    </table></div>
    <p class="warn" id="scoreCheck"></p>
    <label>Notes <textarea name="notes" rows="2" placeholder="Anything worth remembering about this game">${esc(g.notes)}</textarea></label>
    <div class="form-actions">
      <button class="primary">Save game</button>
      ${id !== 'new' ? '<button type="button" class="danger" id="delGame">Delete game</button>' : ''}
    </div>
  </form>`;

  const form = document.getElementById('game');
  const recalc = () => {
    const tot = Object.fromEntries(STATS.map(([k]) => [k, 0])); tot.pts = 0;
    form.querySelectorAll('tbody tr[data-pid]').forEach(tr => {
      const playedBox = tr.querySelector('.played');
      playedBox.disabled = !tr.querySelector('.here').checked;
      if (playedBox.disabled) playedBox.checked = false;
      const on = playedBox.checked;
      tr.classList.toggle('dnp', !on);
      const v = k => Number(tr.querySelector(`[data-k="${k}"]`).value) || 0;
      const p = 2 * v('fg2m') + 3 * v('fg3m') + v('ftm');
      tr.querySelector('.pts-cell').textContent = on ? p : '–';
      if (on) { STATS.forEach(([k]) => tot[k] += v(k)); tot.pts += p; }
      // made can't exceed attempts
      [['fg2m', 'fg2a'], ['fg3m', 'fg3a'], ['ftm', 'fta']].forEach(([mk, ak]) => {
        const bad = on && v(mk) > v(ak) && tr.querySelector(`[data-k="${ak}"]`).value !== '';
        tr.querySelector(`[data-k="${mk}"]`).classList.toggle('bad', bad);
      });
    });
    form.querySelectorAll('[data-total]').forEach(td => td.textContent = tot[td.dataset.total]);
    const ts = form.team_score.value;
    document.getElementById('scoreCheck').textContent = ts !== '' && Number(ts) !== tot.pts
      ? `Heads up: player points add up to ${tot.pts}, but our score is ${ts}.` : '';
  };
  form.addEventListener('input', recalc);
  recalc();
  // Enter moves to the next box, like a spreadsheet
  form.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('table input[type=number]')) {
      e.preventDefault();
      const all = [...form.querySelectorAll('table input[type=number]')];
      all[all.indexOf(e.target) + 1]?.focus();
    }
  });
  form.addEventListener('focusin', e => { if (e.target.matches('input[type=number]')) e.target.select(); });

  form.onsubmit = async e => {
    e.preventDefault();
    const body = { ...formData(form), season_id: state.seasonId, lines: [], present: [] };
    form.querySelectorAll('tbody tr[data-pid]').forEach(tr => {
      if (tr.querySelector('.here').checked) body.present.push(Number(tr.dataset.pid));
      if (!tr.querySelector('.played').checked) return;
      const line = { player_id: Number(tr.dataset.pid) };
      STATS.forEach(([k]) => line[k] = Number(tr.querySelector(`[data-k="${k}"]`).value) || 0);
      body.lines.push(line);
    });
    try {
      await api(id === 'new' ? '/games' : `/games/${id}`, { method: id === 'new' ? 'POST' : 'PUT', body });
      await loadSeason(); toast('Game saved'); location.hash = '#/';
    } catch (err) { toast(err.message, true); }
  };
  const del = document.getElementById('delGame');
  if (del) del.onclick = async () => {
    if (!confirm('Delete this game and all its stats? This cannot be undone.')) return;
    await api(`/games/${id}`, { method: 'DELETE' }); await loadSeason(); toast('Game deleted'); location.hash = '#/';
  };
}

function viewBoxScore(g, season, players, lineFor) {
  const r = result(g);
  const played = players.filter(p => lineFor(p.id));
  const t = totals(played.map(p => lineFor(p.id)));
  $app.innerHTML = `
  <div class="page-head">
    <div><a href="#/" class="back no-print">← Season</a><h1>vs ${esc(g.opponent || 'Opponent')}</h1>
      <p class="muted">${esc(season.team)} · ${longDate(g.date)}${g.time ? ' · ' + fmtTime(g.time) : ''}${r ? ` · <b class="res res-${r}">${r}</b> ${g.team_score}–${g.opp_score}` : ''}</p></div>
    <div class="actions no-print"><button onclick="print()">Print</button>${isAdmin() ? `<a class="button" href="#/game/${g.id}">Edit</a>` : ''}</div>
  </div>
  <div class="table-wrap"><table class="stats">
    <thead><tr><th class="left">Player</th><th>PTS</th><th>FG</th><th>3PT</th><th>FT</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th></tr></thead>
    <tbody>${players.map(p => {
      const l = lineFor(p.id);
      if (!l) return `<tr class="dnp"><td class="left">${esc(playerLabel(p))}</td><td colspan="10" class="muted">Did not play</td></tr>`;
      return `<tr><td class="left">${esc(playerLabel(p))}</td><td><strong>${pts(l)}</strong></td>
        <td>${l.fg2m + l.fg3m}-${l.fg2a + l.fg3a}</td><td>${l.fg3m}-${l.fg3a}</td><td>${l.ftm}-${l.fta}</td>
        <td>${l.reb}</td><td>${l.ast}</td><td>${l.stl}</td><td>${l.blk}</td><td>${l.tov}</td><td>${l.pf}</td></tr>`;
    }).join('')}</tbody>
    <tfoot ${isParent() ? 'hidden' : ''}><tr><td class="left">Team</td><td>${t.pts}</td><td>${t.fgm}-${t.fga}</td><td>${t.fg3m}-${t.fg3a}</td><td>${t.ftm}-${t.fta}</td>
      <td>${t.reb}</td><td>${t.ast}</td><td>${t.stl}</td><td>${t.blk}</td><td>${t.tov}</td><td>${t.pf}</td></tr></tfoot>
  </table></div>
  ${g.notes ? `<p class="notes"><strong>Notes:</strong> ${esc(g.notes)}</p>` : ''}`;
}

function playerSection(p, { compact = false } = {}) {
  const lines = playerLines(p.id);
  const t = totals(lines);
  const imp = improvement(lines);
  const labels = lines.map(l => fmtDate(l.game.date));
  const fmt = (v, isPct) => v == null ? '–' : isPct ? Math.round(v) + '%' : v.toFixed(1);
  const impRows = imp ? imp.map(r => {
    let cls = '', arrow = '';
    if (r.early != null && r.late != null && Math.abs(r.late - r.early) >= (r.isPct ? 1 : 0.1)) {
      const up = r.late > r.early;
      const good = r.k === 'tov' ? !up : up;
      cls = good ? 'up' : 'down'; arrow = up ? '▲' : '▼';
    }
    return `<tr><td class="left">${r.label}</td><td>${fmt(r.early, r.isPct)}</td><td>${fmt(r.late, r.isPct)}</td><td class="${cls}">${arrow}</td></tr>`;
  }).join('') : '';
  const half = Math.floor(lines.length / 2);
  const att = attendance(p.id);

  return `
  <div class="tiles small-tiles">
    <div class="tile"><span class="tile-label">Games</span><strong>${t.gp}</strong></div>
    <div class="tile"><span class="tile-label">Points</span><strong>${t.pts}</strong><span class="muted">${avg(t.pts, t.gp)} per game</span></div>
    <div class="tile"><span class="tile-label">Rebounds</span><strong>${t.reb}</strong><span class="muted">${avg(t.reb, t.gp)} per game</span></div>
    <div class="tile"><span class="tile-label">Assists</span><strong>${t.ast}</strong><span class="muted">${avg(t.ast, t.gp)} per game</span></div>
    <div class="tile"><span class="tile-label">Steals</span><strong>${t.stl}</strong><span class="muted">${avg(t.stl, t.gp)} per game</span></div>
    <div class="tile"><span class="tile-label">Shooting</span><strong>${pct(t.fgm, t.fga)}</strong><span class="muted">FT ${pct(t.ftm, t.fta)}</span></div>
    <div class="tile"><span class="tile-label">Attendance</span><strong>${attText(att.gHere, att.gTotal)}</strong><span class="muted">games · ${attText(att.pHere, att.pTotal)} practices</span></div>
  </div>
  <h3>Badges</h3>
  ${badgeList(p.id, compact ? 8 : 0)}
  <div class="two-col">
    <div>${compact ? lineChart(lines.map(l => l.pts), labels, { title: 'Points per game', height: 160 })
      : `<div class="no-print chart-pick">${TRACK.map(([k, l], i) => `<button type="button" class="chip ${i ? '' : 'on'}" data-k="${k}">${l}</button>`).join('')}</div>
         <div id="chartBox">${lineChart(lines.map(l => l.pts), labels, { title: 'Points per game' })}</div>`}</div>
    <div>${imp ? `<h3>Improvement</h3><p class="muted small">Per-game average in the first ${half} vs. the last ${half} games played.</p>
      <table class="stats imp"><thead><tr><th class="left"></th><th>Early</th><th>Late</th><th></th></tr></thead><tbody>${impRows}</tbody></table>`
      : '<p class="muted">Improvement shows up after 2 or more games.</p>'}</div>
  </div>
  <h3>Game by game</h3>
  <div class="table-wrap"><table class="stats">
    <thead><tr><th class="left">Date</th><th class="left">Opponent</th><th>PTS</th><th>FG</th><th>3PT</th><th>FT</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th></tr></thead>
    <tbody>${lines.map(l => `<tr><td class="left">${fmtDate(l.game.date)}</td><td class="left">${esc(l.game.opponent)}</td><td><strong>${l.pts}</strong></td>
      <td>${l.fg2m + l.fg3m}-${l.fg2a + l.fg3a}</td><td>${l.fg3m}-${l.fg3a}</td><td>${l.ftm}-${l.fta}</td>
      <td>${l.reb}</td><td>${l.ast}</td><td>${l.stl}</td><td>${l.blk}</td><td>${l.tov}</td><td>${l.pf}</td></tr>`).join('') ||
      '<tr><td colspan="12" class="muted">No games played yet.</td></tr>'}</tbody>
    ${lines.length ? `<tfoot><tr><td class="left" colspan="2">Season</td><td>${t.pts}</td><td>${t.fgm}-${t.fga}</td><td>${t.fg3m}-${t.fg3a}</td><td>${t.ftm}-${t.fta}</td>
      <td>${t.reb}</td><td>${t.ast}</td><td>${t.stl}</td><td>${t.blk}</td><td>${t.tov}</td><td>${t.pf}</td></tr></tfoot>` : ''}
  </table></div>`;
}

function viewPlayer(id) {
  if (!state.data) return noSeason();
  const p = state.data.players.find(x => x.id === Number(id));
  if (!p) { $app.innerHTML = '<p>Player not found.</p>'; return; }
  $app.innerHTML = `
  <div class="page-head">
    <div><a href="#/" class="back no-print">← Season</a><h1>${esc(playerLabel(p))}</h1><p class="muted">${esc(state.data.season.team)} · ${esc(state.data.season.name)}</p></div>
    <div class="actions no-print"><button onclick="print()">Print</button></div>
  </div>${playerSection(p)}`;
  const lines = playerLines(p.id), labels = lines.map(l => fmtDate(l.game.date));
  $app.querySelectorAll('.chip').forEach(b => b.onclick = () => {
    $app.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
    const label = TRACK.find(([k]) => k === b.dataset.k)[1];
    document.getElementById('chartBox').innerHTML = lineChart(lines.map(l => l[b.dataset.k]), labels, { title: label + ' per game' });
  });
}

// What a parent sees first: their child's season, plus what's coming up.
function viewParentHome() {
  if (!state.data) {
    $app.innerHTML = '<section class="empty"><h1>Welcome!</h1><p>Your player hasn\'t been added to a season yet. Check back soon.</p></section>';
    return;
  }
  const { season, players } = state.data;
  const upcoming = state.data.games.filter(g => !isPlayed(g)).slice(0, 4);
  const recent = playedGames().slice(-4).reverse();
  const row = (g, right) => `<div class="game-row"><span class="date">${fmtDate(g.date)}${g.time ? `<small>${fmtTime(g.time)}</small>` : ''}</span>
    <span class="opp">vs ${esc(g.opponent || 'Opponent')}</span><span class="score">${right}</span></div>`;
  $app.innerHTML = `
  <div class="page-head">
    <div><h1>${esc(season.team || 'Our team')}</h1><p class="muted">${esc(season.name)}</p></div>
    <div class="actions">${seasonPicker()}</div>
  </div>
  ${players.length === 1
    ? `<div class="page-head"><h2>${esc(playerLabel(players[0]))}</h2><a class="button" href="#/player/${players[0].id}">All charts &amp; games</a></div>
       ${playerSection(players[0], { compact: true })}`
    : `<div class="tiles">${players.map(p => {
        const t = totals(playerLines(p.id));
        return `<a class="tile kid" href="#/player/${p.id}"><span class="tile-label">${esc(playerLabel(p))}</span><strong>${t.pts} points</strong>
          <span class="muted">${avg(t.pts, t.gp)} per game · ${badges(p.id).length} badges</span></a>`;
      }).join('')}</div>`}
  <div class="two-col">
    <div><h2>Coming up</h2><div class="games">${upcoming.map(g => row(g, '')).join('') || '<p class="muted">Nothing on the schedule.</p>'}</div></div>
    <div><h2>Recent results</h2><div class="games">${recent.map(g => {
      const r = result(g);
      return row(g, r ? `<b class="res res-${r}">${r}</b> ${g.team_score}–${g.opp_score}` : '');
    }).join('') || '<p class="muted">No games yet.</p>'}</div></div>
  </div>`;
  bindSeasonPicker();
}

function viewReport() {
  if (!state.data) return noSeason();
  const { season, players } = state.data;
  const games = playedGames();
  const rec = games.reduce((r, g) => { const x = result(g); if (x) r[x]++; return r; }, { W: 0, L: 0, T: 0 });
  const team = totals(state.data.stats);
  const rows = players.map(p => ({ p, t: totals(playerLines(p.id)) }));
  $app.innerHTML = `
  <div class="page-head no-print">
    <div><h1>Year-end report</h1><p class="muted">${isParent() ? 'Your player\'s season, ready to print.' : 'A team summary page, then one page per player.'} Use “Print” and choose “Save as PDF” to keep a copy.</p></div>
    <div class="actions">${seasonPicker()}<button class="primary" onclick="print()">Print report</button></div>
  </div>
  ${isParent() ? '' : `<section class="report-page">
    <div class="report-title"><span class="ball" aria-hidden="true"></span><div><h1>${esc(season.team || 'Our team')}</h1><p>${esc(season.name)} season report</p></div></div>
    <div class="tiles">
      <div class="tile"><span class="tile-label">Games</span><strong>${games.length}</strong></div>
      <div class="tile"><span class="tile-label">Record</span><strong>${rec.W}-${rec.L}${rec.T ? '-' + rec.T : ''}</strong></div>
      <div class="tile"><span class="tile-label">Team points</span><strong>${team.pts}</strong><span class="muted">${avg(team.pts, games.length)} per game</span></div>
      <div class="tile"><span class="tile-label">Team rebounds</span><strong>${team.reb}</strong><span class="muted">${avg(team.reb, games.length)} per game</span></div>
    </div>
    <h2>Player totals</h2>
    <table class="stats"><thead><tr><th class="left">Player</th><th>GP</th><th>PTS</th><th>PPG</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>FG%</th><th>FT%</th><th>Games here</th><th>Practices</th></tr></thead>
    <tbody>${rows.map(({ p, t }) => `<tr><td class="left">${esc(playerLabel(p))}</td><td>${t.gp}</td><td><strong>${t.pts}</strong></td><td>${avg(t.pts, t.gp)}</td>
      <td>${t.reb}</td><td>${t.ast}</td><td>${t.stl}</td><td>${t.blk}</td><td>${t.tov}</td><td>${pct(t.fgm, t.fga)}</td><td>${pct(t.ftm, t.fta)}</td>
      ${(a => `<td>${attText(a.gHere, a.gTotal)}</td><td>${attText(a.pHere, a.pTotal)}</td>`)(attendance(p.id))}</tr>`).join('')}</tbody></table>
    <h2>Results</h2>
    <table class="stats"><thead><tr><th class="left">Date</th><th class="left">Opponent</th><th>Result</th><th>Score</th></tr></thead>
    <tbody>${games.map(g => `<tr><td class="left">${fmtDate(g.date)}${g.time ? ' · ' + fmtTime(g.time) : ''}</td><td class="left">${esc(g.opponent)}</td><td>${result(g) || '–'}</td>
      <td>${g.team_score != null && g.opp_score != null ? `${g.team_score}–${g.opp_score}` : '–'}</td></tr>`).join('')}</tbody></table>
  </section>`}
  ${players.map(p => `<section class="report-page">
    <div class="report-title"><span class="ball" aria-hidden="true"></span><div><h1>${esc(playerLabel(p))}</h1><p>${esc(season.team)} · ${esc(season.name)}</p></div></div>
    ${playerSection(p, { compact: true })}</section>`).join('')}`;
  bindSeasonPicker();
}

function kidPicker(selected) {
  return `<div class="kid-pick">${state.data.players.map(p => `<label class="check"><input type="checkbox" class="kid-box" value="${p.id}" ${selected.includes(p.id) ? 'checked' : ''}> ${esc(playerLabel(p))}</label>`).join('')}</div>`;
}

async function viewSettings() {
  const d = state.data;
  const users = isAdmin() ? await api('/users') : [];
  $app.innerHTML = `
  <div class="page-head"><div><h1>Settings</h1></div><div class="actions">${seasonPicker()}</div></div>
  ${isAdmin() ? `
  <div class="cards">
    ${d ? `<section class="card">
      <h2>Season</h2>
      <form id="seasonEdit" class="inline">
        <label>Season name <input name="name" value="${esc(d.season.name)}" required></label>
        <label class="grow">Team name <input name="team" value="${esc(d.season.team)}"></label>
        <button>Save</button>
      </form>
    </section>
    <section class="card">
      <h2>Roster</h2>
      <table class="roster"><tbody>${d.players.map(p => `<tr data-id="${p.id}">
        <td><input class="num" value="${esc(p.number)}" data-f="number" aria-label="Jersey number" placeholder="#"></td>
        <td><input value="${esc(p.name)}" data-f="name" aria-label="Name"></td>
        <td><button type="button" class="link save-p">Save</button> <button type="button" class="link danger del-p">Remove</button></td></tr>`).join('')}</tbody></table>
      <form id="addPlayer" class="inline">
        <label>#<input name="number" class="num" maxlength="4"></label>
        <label class="grow">New player <input name="name" required placeholder="First and last name"></label>
        <button class="primary">Add player</button>
      </form>
    </section>` : ''}
    <section class="card">
      <h2>Start a new season</h2>
      <form id="newSeason" class="inline">
        <label>Season name <input name="name" required placeholder="2026–27"></label>
        <label class="grow">Team name <input name="team" value="${esc(d?.season.team || '')}" placeholder="e.g. Oak Hill Owls"></label>
        ${d ? `<label class="check"><input type="checkbox" name="copy" checked> Copy this roster</label>` : ''}
        <button class="primary">Create season</button>
      </form>
    </section>
    <section class="card">
      <h2>Logins</h2>
      <p class="muted small"><b>Can edit</b>: enters and fixes stats. <b>View only</b>: sees and prints everything. <b>Parent</b>: sees only their own child's stats, badges and attendance.</p>
      <table class="roster"><tbody>${users.map(u => {
        const kids = (u.player_ids || []).map(id => d?.players.find(p => p.id === id)).filter(Boolean);
        return `<tr><td>${esc(u.username)}</td><td>${ROLE_LABEL[u.role] || u.role}${u.role === 'parent' ? `: ${kids.map(k => esc(k.name)).join(', ') || '<span class="muted">no players this season</span>'}` : ''}</td>
        <td>${u.role === 'parent' && d ? `<details class="kids-edit"><summary class="link">Change players</summary>${kidPicker(u.player_ids)}<button type="button" class="save-kids" data-id="${u.id}">Save</button></details>` : ''}
          ${u.username === state.me.username ? '<span class="muted">you</span>' : `<button class="link danger del-u" data-id="${u.id}">Remove</button>`}</td></tr>`;
      }).join('')}</tbody></table>
      <form id="addUser">
        <div class="inline">
          <label>Username <input name="username" required autocomplete="off"></label>
          <label>Password <input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
          <label>Access <select name="role" id="roleSel"><option value="viewer">View only</option><option value="admin">Can edit</option><option value="parent">Parent</option></select></label>
          <button class="primary">Add login</button>
        </div>
        <div id="kidPick" hidden><p class="muted small">Which player(s) is this parent's child?</p>${d ? kidPicker([]) : ''}</div>
      </form>
    </section>
  </div>` : ''}
  <section class="card">
    <h2>Change my password</h2>
    <form id="pw" class="inline">
      <label>Current <input name="current" type="password" required autocomplete="current-password"></label>
      <label>New <input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
      <button>Change password</button>
    </form>
  </section>`;
  bindSeasonPicker();
  const on = (sel, fn) => { const el = document.getElementById(sel); if (el) el.onsubmit = async e => { e.preventDefault(); try { await fn(formData(e.target), e.target); } catch (err) { toast(err.message, true); } }; };
  const refresh = async msg => { await loadSeasons(); await loadSeason(); toast(msg); viewSettings(); };

  on('seasonEdit', async f => { await api(`/seasons/${state.seasonId}`, { method: 'PUT', body: f }); await refresh('Season saved'); });
  on('addPlayer', async f => { await api('/players', { method: 'POST', body: { ...f, season_id: state.seasonId } }); await refresh('Player added'); });
  on('newSeason', async f => {
    const r = await api('/seasons', { method: 'POST', body: { ...f, copyPlayersFrom: f.copy ? state.seasonId : null } });
    state.seasonId = r.id; localStorage.seasonId = r.id; await refresh('Season created');
  });
  const pickedKids = el => [...el.querySelectorAll('.kid-box:checked')].map(c => Number(c.value));
  const roleSel = document.getElementById('roleSel');
  if (roleSel) roleSel.onchange = () => { document.getElementById('kidPick').hidden = roleSel.value !== 'parent'; };
  on('addUser', async (f, form) => { await api('/users', { method: 'POST', body: { ...f, player_ids: pickedKids(form) } }); await refresh('Login added'); });
  $app.querySelectorAll('.save-kids').forEach(b => b.onclick = async () => {
    try { await api(`/users/${b.dataset.id}`, { method: 'PUT', body: { player_ids: pickedKids(b.closest('details')) } }); await refresh('Players updated'); }
    catch (err) { toast(err.message, true); }
  });
  on('pw', async (f, form) => { await api('/password', { method: 'POST', body: f }); form.reset(); toast('Password changed'); });
  $app.querySelectorAll('.save-p').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr');
    await api(`/players/${tr.dataset.id}`, { method: 'PUT', body: { name: tr.querySelector('[data-f=name]').value, number: tr.querySelector('[data-f=number]').value } });
    await refresh('Player saved');
  });
  $app.querySelectorAll('.del-p').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this player? Their stats for this season will be deleted too.')) return;
    await api(`/players/${b.closest('tr').dataset.id}`, { method: 'DELETE' }); await refresh('Player removed');
  });
  $app.querySelectorAll('.del-u').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this login?')) return;
    await api(`/users/${b.dataset.id}`, { method: 'DELETE' }); await refresh('Login removed');
  });
}

// ---------- live (phone) stat entry ----------
// One player at a time with big buttons. Every tap is kept on the phone first,
// then saved to the server a moment later, so a weak gym signal doesn't lose stats.
const LIVE_STATS = [['reb', 'Rebound'], ['ast', 'Assist'], ['stl', 'Steal'], ['blk', 'Block'], ['tov', 'Turnover'], ['pf', 'Foul']];
const liveTimers = {};
window.addEventListener('online', () => window.liveRetry?.());

function viewLive(id) {
  if (!state.data) return noSeason();
  const g = state.data.games.find(x => x.id === Number(id));
  if (!g || !isAdmin()) { location.hash = g ? `#/game/${g.id}` : '#/'; return; }
  const { players } = state.data;
  const key = 'hoops-live-' + g.id;
  const empty = () => Object.fromEntries(STATS.map(([k]) => [k, 0]));
  let s = JSON.parse(localStorage.getItem(key) || 'null');
  if (!s || !s.dirty) { // nothing unsaved on this phone: start from what the server has
    const statRows = state.data.stats.filter(x => x.game_id === g.id);
    const att = state.data.game_attendance.filter(a => a.game_id === g.id).map(a => a.player_id);
    const present = att.length ? att : statRows.map(x => x.player_id);
    s = { present, lines: {}, opp: g.opp_score ?? 0, sel: null, undo: [], phase: present.length ? 'play' : 'roster', dirty: false };
    statRows.forEach(r => { s.lines[r.player_id] = Object.fromEntries(STATS.map(([k]) => [k, r[k]])); });
  }
  players.forEach(p => { s.lines[p.id] ??= empty(); });
  s.present = s.present.filter(pid => players.some(p => p.id === pid));
  if (!s.present.includes(s.sel)) s.sel = s.present[0] ?? null;
  let status = s.dirty ? 'Not saved yet' : 'All saved';
  navigator.wakeLock?.request('screen').catch(() => {}); // keep the screen on during the game

  const persist = () => localStorage.setItem(key, JSON.stringify(s));
  const teamPts = () => s.present.reduce((t, pid) => t + pts(s.lines[pid]), 0);
  const first = pid => players.find(p => p.id === pid)?.name.split(' ')[0] || '';

  async function save() {
    clearTimeout(liveTimers[key]);
    const body = {
      date: g.date, time: g.time, opponent: g.opponent, notes: g.notes, team_score: teamPts(), opp_score: s.opp,
      present: s.present, lines: s.present.map(pid => ({ player_id: pid, ...s.lines[pid] })),
    };
    try {
      await api(`/games/${g.id}`, { method: 'PUT', body });
      s.dirty = false; persist(); status = 'All saved';
      loadSeason().catch(() => {});
    } catch {
      status = 'No signal: kept on this phone, retrying';
      liveTimers[key] = setTimeout(save, 5000);
    }
    paintStatus();
    return !s.dirty;
  }
  window.liveRetry = () => { if (s.dirty) save(); };
  function change() {
    s.dirty = true; status = 'Saving…'; persist();
    clearTimeout(liveTimers[key]); liveTimers[key] = setTimeout(save, 700);
    if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(12);
    render();
  }
  function apply(entry, sign) {
    if (entry.opp) s.opp = Math.max(0, s.opp + sign * entry.opp);
    for (const [k, n] of Object.entries(entry.diff || {})) s.lines[entry.pid][k] = Math.max(0, s.lines[entry.pid][k] + sign * n);
  }
  function record(entry) { apply(entry, 1); s.undo.push(entry); if (s.undo.length > 60) s.undo.shift(); change(); }
  function paintStatus() {
    const el = document.getElementById('liveStatus');
    if (el) { el.textContent = status; el.className = 'live-status' + (status.startsWith('No signal') ? ' bad' : status === 'All saved' ? ' ok' : ''); }
  }

  function render() {
    if (location.hash !== `#/live/${g.id}`) return;
    const top = `<div class="live-top"><a href="#/game/${g.id}" class="back">← Game</a><span id="liveStatus"></span></div>`;
    if (s.phase === 'roster') {
      $app.innerHTML = `<div class="live">${top}
        <h1>Who's here?</h1>
        <p class="muted">vs ${esc(g.opponent || 'Opponent')} · ${fmtDate(g.date)}${g.time ? ' · ' + fmtTime(g.time) : ''}</p>
        <div class="roster-pick">${players.map(p => `<button type="button" class="pick ${s.present.includes(p.id) ? 'on' : ''}" data-pid="${p.id}">${esc(playerLabel(p))}</button>`).join('')}</div>
        <div class="live-actions">
          <button type="button" id="allHere">Everyone's here</button>
          <button type="button" class="primary" id="start" ${s.present.length ? '' : 'disabled'}>Start stats (${s.present.length} here)</button>
        </div></div>`;
      $app.querySelectorAll('.pick').forEach(b => b.onclick = () => {
        const pid = Number(b.dataset.pid);
        s.present = s.present.includes(pid) ? s.present.filter(x => x !== pid) : players.map(p => p.id).filter(x => x === pid || s.present.includes(x));
        change();
      });
      document.getElementById('allHere').onclick = () => { s.present = players.map(p => p.id); change(); };
      document.getElementById('start').onclick = () => { s.phase = 'play'; s.sel = s.present.includes(s.sel) ? s.sel : s.present[0]; persist(); render(); };
      return paintStatus();
    }
    const sel = players.find(p => p.id === s.sel), l = s.lines[s.sel];
    const last = s.undo[s.undo.length - 1];
    $app.innerHTML = `<div class="live">${top}
      <div class="scoreboard">
        <div class="side"><span>${esc(state.data.season.team || 'Us')}</span><b>${teamPts()}</b></div>
        <div class="side"><span>${esc(g.opponent || 'Them')}</span><b>${s.opp}</b>
          <div class="opp-btns">${[1, 2, 3].map(n => `<button type="button" data-opp="${n}">+${n}</button>`).join('')}<button type="button" data-opp="-1">−1</button></div></div>
      </div>
      <div class="chips-row">${s.present.map(pid => {
        const p = players.find(x => x.id === pid);
        return `<button type="button" class="pchip ${pid === s.sel ? 'on' : ''}" data-sel="${pid}">${p.number !== '' ? `<b>#${esc(p.number)}</b> ` : ''}${esc(first(pid))}<small>${pts(s.lines[pid])} pts</small></button>`;
      }).join('')}</div>
      ${sel ? `<div class="live-player">
        <h2>${esc(playerLabel(sel))}</h2>
        <p class="line"><b>${pts(l)} PTS</b> · ${l.reb} REB · ${l.ast} AST · ${l.stl} STL · ${l.blk} BLK · ${l.tov} TO · ${l.pf} PF<br>
          FG ${l.fg2m + l.fg3m}-${l.fg2a + l.fg3a} · 3PT ${l.fg3m}-${l.fg3a} · FT ${l.ftm}-${l.fta}</p>
        <div class="shot-grid">${[['fg2', '2 pts'], ['fg3', '3 pts'], ['ft', 'Free throw']].map(([k, label]) =>
          `<button type="button" class="made" data-shot="${k}" data-made="1">${label}<small>Made</small></button>
           <button type="button" class="miss" data-shot="${k}" data-made="0">${label}<small>Missed</small></button>`).join('')}</div>
        <div class="stat-grid">${LIVE_STATS.map(([k, label]) => `<button type="button" data-stat="${k}">${label}<small>${l[k]}</small></button>`).join('')}</div>
      </div>` : '<p class="muted">Pick who\'s here first.</p>'}
      <div class="live-actions">
        <button type="button" id="undo" ${last ? '' : 'disabled'}>Undo${last ? `: ${esc(last.label)}` : ''}</button>
        <button type="button" id="roster">Who's here</button>
        <button type="button" class="primary" id="done">Done</button>
      </div></div>`;
    $app.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => { s.sel = Number(b.dataset.sel); persist(); render(); });
    $app.querySelectorAll('[data-shot]').forEach(b => b.onclick = () => {
      const k = b.dataset.shot, made = b.dataset.made === '1';
      const diff = { [k + 'a']: 1 }; if (made) diff[k + 'm'] = 1;
      const what = { fg2: '2', fg3: '3', ft: 'FT' }[k];
      record({ pid: s.sel, diff, label: `${first(s.sel)} ${what} ${made ? 'made' : 'missed'}` });
    });
    $app.querySelectorAll('[data-stat]').forEach(b => b.onclick = () =>
      record({ pid: s.sel, diff: { [b.dataset.stat]: 1 }, label: `${first(s.sel)} ${b.textContent.replace(/\d+$/, '').trim().toLowerCase()}` }));
    $app.querySelectorAll('[data-opp]').forEach(b => b.onclick = () => {
      const n = Number(b.dataset.opp);
      if (n < 0 && s.opp === 0) return;
      record({ opp: n, label: `${g.opponent || 'Them'} ${n > 0 ? '+' + n : n}` });
    });
    document.getElementById('undo').onclick = () => { const e = s.undo.pop(); if (e) { apply(e, -1); change(); } };
    document.getElementById('roster').onclick = () => { s.phase = 'roster'; persist(); render(); };
    document.getElementById('done').onclick = async () => {
      if (s.dirty && !(await save())) return toast('Not saved yet: no signal. Your stats are safe on this phone.', true);
      localStorage.removeItem(key);
      await loadSeason(); location.hash = `#/box/${g.id}`;
    };
    paintStatus();
  }
  render();
  if (s.dirty) save();
}

// ---------- practices ----------
function viewPractice(id) {
  if (!state.data) return noSeason();
  const { players, practices, practice_attendance } = state.data;
  const pr = practices.find(x => x.id === Number(id));
  if (!pr) { $app.innerHTML = '<p>Practice not found.</p>'; return; }
  const here = new Set(practice_attendance.filter(a => a.practice_id === pr.id).map(a => a.player_id));
  const head = `<a href="#/" class="back">← Season</a><h1>Practice</h1>
    <p class="muted">${longDate(pr.date)}${pr.time ? ' · ' + fmtTime(pr.time) : ''}</p>`;
  if (!isAdmin()) {
    $app.innerHTML = `<div class="page-head"><div>${head}</div></div>
      <div class="roster-pick">${players.map(p => `<span class="pick ${here.has(p.id) ? 'on' : ''}">${esc(playerLabel(p))}${here.has(p.id) ? '' : ' (absent)'}</span>`).join('')}</div>
      ${pr.notes ? `<p class="notes">${esc(pr.notes)}</p>` : ''}`;
    return;
  }
  $app.innerHTML = `<div class="page-head"><div>${head}</div></div>
  <form id="practice">
    <div class="game-info">
      <label>Date <input type="date" name="date" value="${esc(pr.date)}" required></label>
      <label>Time <input type="time" name="time" value="${esc(pr.time)}"></label>
    </div>
    <h2>Who came? <span class="muted small" id="hereCount"></span></h2>
    <div class="roster-pick">${players.map(p => `<button type="button" class="pick ${here.has(p.id) ? 'on' : ''}" data-pid="${p.id}">${esc(playerLabel(p))}</button>`).join('')}</div>
    <p><button type="button" class="link" id="allHere">Everyone was here</button></p>
    <label>Notes <textarea name="notes" rows="2" placeholder="What you worked on">${esc(pr.notes)}</textarea></label>
    <div class="form-actions"><button class="primary">Save attendance</button><button type="button" class="danger" id="delPractice">Delete practice</button></div>
  </form>`;
  const count = () => document.getElementById('hereCount').textContent = `${here.size} of ${players.length}`;
  const form = document.getElementById('practice');
  form.querySelectorAll('.pick').forEach(b => b.onclick = () => {
    const pid = Number(b.dataset.pid);
    here.has(pid) ? here.delete(pid) : here.add(pid);
    b.classList.toggle('on', here.has(pid)); count();
  });
  document.getElementById('allHere').onclick = () => { players.forEach(p => here.add(p.id)); form.querySelectorAll('.pick').forEach(b => b.classList.add('on')); count(); };
  count();
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      await api(`/practices/${pr.id}`, { method: 'PUT', body: { ...formData(form), present: [...here] } });
      await loadSeason(); toast('Attendance saved'); location.hash = '#/';
    } catch (err) { toast(err.message, true); }
  };
  document.getElementById('delPractice').onclick = async () => {
    if (!confirm('Delete this practice and its attendance?')) return;
    await api(`/practices/${pr.id}`, { method: 'DELETE' }); await loadSeason(); toast('Practice deleted'); location.hash = '#/';
  };
}

// ---------- boot & routing ----------
async function loadSeasons() {
  state.seasons = await api('/seasons');
  const saved = Number(localStorage.seasonId);
  state.seasonId = state.seasons.some(s => s.id === state.seasonId) ? state.seasonId
    : state.seasons.some(s => s.id === saved) ? saved : state.seasons[0]?.id ?? null;
}
async function loadSeason() {
  state.data = state.seasonId ? await api(`/seasons/${state.seasonId}`) : null;
}
async function boot() {
  const r = await api('/me');
  state.me = r.user;
  if (!state.me) return viewAuth(r.needsSetup);
  document.getElementById('who').textContent = state.me.username + (state.me.role === 'viewer' ? ' (view only)' : isParent() ? ' (parent)' : '');
  document.querySelector('.topbar nav a[href="#/"]').textContent = isParent() ? 'My player' : 'Season';
  await loadSeasons(); await loadSeason();
  route();
}
function route() {
  if (!state.me) return boot();
  document.getElementById('topbar').hidden = false;
  const [, page, id] = location.hash.split('/');
  document.querySelectorAll('.topbar nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#/' + (page || '')));
  window.scrollTo(0, 0);
  if (page === 'game') return viewGame(id);
  if (page === 'box') {
    const g = state.data?.games.find(x => x.id === Number(id));
    if (!g) return viewSeason();
    return viewBoxScore(g, state.data.season, state.data.players, pid => state.data.stats.find(s => s.game_id === g.id && s.player_id === pid));
  }
  if (page === 'player') return viewPlayer(id);
  if (page === 'live') return viewLive(id);
  if (page === 'practice') return viewPractice(id);
  if (page === 'report') return viewReport();
  if (page === 'settings') return viewSettings();
  if (isParent()) return viewParentHome();
  viewSeason();
}
window.addEventListener('hashchange', route);
document.getElementById('logout').onclick = async () => { await api('/logout', { method: 'POST' }); state.me = null; location.hash = '#/'; boot(); };
boot();
