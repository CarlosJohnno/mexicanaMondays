# Mexicana Mondays 🐿️🎾

The Monday-night padel app: fair pairings (everyone partners everyone),
live scoring, all-time leaderboard, match history — and a squirrel problem.

**Live site:** deployed on Netlify (drag this folder onto the site's
Deploys page, or push to GitHub once auto-deploys are linked).

## How it's built

One file. `index.html` contains the whole app — markup, styles, and logic.
Data lives in Supabase (Postgres) with four tables:

| table      | what it holds                                        |
|------------|------------------------------------------------------|
| `profiles` | one per player: name + 4-digit PIN (hashed)          |
| `matches`  | one per night: code, status, courts, `hidden_at`     |
| `players`  | who played in which match (links profile ↔ match)    |
| `games`    | every game: teams, scores, round, court              |

A match with `hidden_at` set is invisible everywhere (history,
leaderboards, discovery). Cancelling a match sets this — nothing is ever
deleted, so anything can be restored from the database.

## Making changes

1. Edit `index.html` (or ask Claude to).
2. If the database schema needs to change, add a new numbered file in
   `sql/` — never edit an old one — and run it in
   Supabase Dashboard → SQL Editor **before** deploying the app change.
3. Deploy: push to GitHub (auto-deploy) or drag the folder onto Netlify.

## Keys — what's safe here

The `SUPABASE_URL` and the **publishable** key inside `index.html` are
designed to be public; every visitor's browser uses them. What must
**never** be committed to this repo or pasted into the app:
the `service_role` / secret key, database passwords, or personal access
tokens. Those stay in the Supabase dashboard.

## History

Every change is a git commit. To see what changed and when:
GitHub → the repo → Commits. Any old version can be restored from there —
that's the point of all this.
