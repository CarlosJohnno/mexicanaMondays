-- ============================================================
-- Mexicana Mondays — soft-hide a match
-- Run this in Supabase → SQL Editor BEFORE deploying the new
-- index.html. The app now filters on matches.hidden_at, so the
-- column has to exist first or every query 400s.
-- Safe to run twice.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1 — Add the flag
-- ------------------------------------------------------------
-- Timestamp, not boolean: NULL = visible, and you get "when" for free.
-- No flag on games: they inherit visibility from their parent match,
-- so the two can never drift out of sync. One source of truth.

alter table public.matches
  add column if not exists hidden_at   timestamptz,
  add column if not exists hidden_note text;

comment on column public.matches.hidden_at is
  'When set, this match is excluded from history, leaderboards and all-time
   stats. NULL means visible. Never delete the row — unhide by setting NULL.';

create index if not exists matches_hidden_at_idx
  on public.matches (hidden_at)
  where hidden_at is not null;


-- ------------------------------------------------------------
-- STEP 2 — Find the match. Run this on its own and read it.
-- ------------------------------------------------------------
select m.id,
       m.name,
       m.code,
       m.status,
       m.created_at,
       m.hidden_at,
       count(g.id) as games
from public.matches m
left join public.games g on g.match_id = m.id
where m.name ilike '%Mexicana Monday Extravaganza%'
group by m.id, m.name, m.code, m.status, m.created_at, m.hidden_at
order by m.created_at desc;

-- Expect ONE row. If you get several, your regular Monday matches are
-- probably named similarly — pick the right id from the code/date and
-- use the id directly in step 3 instead of the name.


-- ------------------------------------------------------------
-- STEP 3 — Hide it
-- ------------------------------------------------------------
begin;

update public.matches
set hidden_at   = now(),
    hidden_note = 'Hidden on request, 2026-07-31'
where id = '<PASTE-THE-ID-FROM-STEP-2>'
  and hidden_at is null;

-- Expect: UPDATE 1
select id, name, code, hidden_at, hidden_note
from public.matches
where id = '<PASTE-THE-ID-FROM-STEP-2>';

commit;   -- change to rollback; if that didn't look right


-- ------------------------------------------------------------
-- STEP 4 (recommended) — enforce it in the database too
-- ------------------------------------------------------------
-- Your publishable key ships inside index.html, so anyone who opens
-- devtools can query Supabase directly and read the match regardless of
-- what the app does. If "must not appear in anyone's history" needs to
-- hold against more than the UI, enforce it here.
--
-- First check whether RLS is even on — policies are ignored if it isn't:
--
--   select relname, relrowsecurity
--   from pg_class
--   where relname in ('matches','games','players') and relnamespace = 'public'::regnamespace;
--
-- If relrowsecurity is true for these tables, add the policies below.
-- They are RESTRICTIVE, so they AND with whatever policies you already
-- have rather than being OR'd away by a permissive "allow all".

-- create policy hide_hidden_matches on public.matches
--   as restrictive for select to anon
--   using (hidden_at is null);

-- create policy hide_games_of_hidden_matches on public.games
--   as restrictive for select to anon
--   using (exists (select 1 from public.matches m
--                  where m.id = games.match_id and m.hidden_at is null));

-- create policy hide_players_of_hidden_matches on public.players
--   as restrictive for select to anon
--   using (exists (select 1 from public.matches m
--                  where m.id = players.match_id and m.hidden_at is null));

-- Test after applying, as anon, that this returns nothing:
--   select * from public.matches where id = '<THE-ID>';
-- You'll still see the row in the Table Editor — the dashboard bypasses RLS.


-- ------------------------------------------------------------
-- To unhide
-- ------------------------------------------------------------
-- update public.matches
-- set hidden_at = null, hidden_note = null
-- where id = '<THE-ID>';
