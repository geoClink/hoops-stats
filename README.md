# Hoops Stats

Team stats site for an elementary basketball team: logins, a game schedule, stat entry from the paper sheet, player progress charts and a printable year-end report.

## Put it online (Vercel + Neon)

1. Push this folder to a GitHub repo, then in Vercel: **Add New → Project** → import the repo. No build settings are needed.
2. In the Vercel project: **Storage → Create Database → Neon (Postgres)** → connect it to the project. This adds `DATABASE_URL` automatically.
3. **Deployments → Redeploy** so the site picks up the database.
4. Open the site. The first visit asks you to create the main account. The tables are created automatically.

Or from a terminal in this folder:

```bash
vercel
```

## Run it on your computer

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. With no settings it uses a built-in database saved in `data/`. To use your Neon database locally instead, set `DATABASE_URL` first (copy it from Vercel → Storage).

## Using it

1. **Settings** → name the season and team, add players (name + jersey #).
2. **Settings → Logins** → add the coach (**Can edit** or **View only**). For families, choose **Parent** and tick their child: parents only ever see their own child's stats, badges, attendance and report page. Copying the roster into a new season keeps parents linked.
3. **Schedule** (Season page) → add each game's date, time and who they're playing; several games on one day is fine. After the game, click it and copy in the stats from the paper sheet. Enter jumps to the next box; points add up automatically, and it warns if they don't match the final score.
4. **At the game on a phone:** open the game → **Live entry (phone)**. Tap who's here, then pick a player and tap Made/Missed, Rebound, Steal and so on. The score adds itself up, Undo fixes mis-taps, and stats are kept on the phone if the gym has no signal, then saved when it's back.
5. **Practices:** on the Season page, add a practice and tap who came. Attendance shows on the season table, player pages and the report.
6. Click a player to see game-by-game stats, a progress chart with trend line, early-vs-late season improvement, attendance, and badges (first basket, season highs, 50 points this season…).
7. **Year-end report** → Print → "Save as PDF": a team summary page plus one page per player.

Each game also has a printable box score. Next season: Settings → Start a new season (can copy the roster).

## Files

- `public/` — the web pages (served as static files; page script is `main.js`)
- `lib/api.js` — logins and data API (shared)
- `api/index.js` — the Vercel function that runs the API
- `local-server.js` — local runner
