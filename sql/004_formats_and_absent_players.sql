-- ============================================================
-- 004 — match formats (Americano / Mexicano) + host-added players
-- ============================================================
-- Run in Supabase → SQL Editor BEFORE deploying the new index.html.
-- Safe to run twice.
--
-- What changes:
--   matches.format        'americano' (the old fixed draw) or 'mexicano'
--                         (round-by-round pairings from the standings)
--   matches.target_rounds how many rounds a Mexicano night runs for
--   players.added_by      the player who added this seat on someone's behalf
--                         (NULL = they joined themselves)
--   games unique index    one game per (match, round, court). Mexicano draws
--                         the next round from whichever phone saves the last
--                         score; if two phones do it at once the second insert
--                         fails with 23505 and the app shrugs it off.
-- ============================================================

alter table public.matches
  add column if not exists format        text    not null default 'americano',
  add column if not exists target_rounds integer;

alter table public.matches
  drop constraint if exists matches_format_check;
alter table public.matches
  add constraint matches_format_check check (format in ('americano','mexicano'));

comment on column public.matches.format is
  'americano = fixed draw from SCHEDULES, everyone partners everyone.
   mexicano  = round 1 random, then each round paired from the standings.';
comment on column public.matches.target_rounds is
  'Mexicano only: rounds to play. NULL for americano (the draw decides).';

alter table public.players
  add column if not exists added_by uuid references public.players(id) on delete set null;

comment on column public.players.added_by is
  'Set when the host added this player before they arrived. The player claims
   the seat from the "you have been added" prompt; nothing else reads this.';

-- Existing rows already have idx unique per match; this guards the per-round
-- draw. Old americano rows all have round+court set, so the index builds clean.
create unique index if not exists games_match_round_court_idx
  on public.games (match_id, round, court);

-- ------------------------------------------------------------
-- Check (optional)
-- ------------------------------------------------------------
-- select column_name, data_type, column_default
-- from information_schema.columns
-- where table_name in ('matches','players') and column_name in ('format','target_rounds','added_by');
