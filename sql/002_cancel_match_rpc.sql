-- ============================================================
-- 002 — cancel_match function
-- ============================================================
-- Why: 001's restrictive RLS policies stop the anon role from ever
-- setting hidden_at — an update that makes a row invisible to the role
-- writing it fails ("new row violates row-level security policy").
-- That's correct in general, but the app's Cancel-match button needs a
-- sanctioned way through. This SECURITY DEFINER function runs with the
-- owner's rights and does exactly one thing: hide one match.
--
-- Run in Supabase → SQL Editor BEFORE deploying the app change that
-- calls it. Safe to run twice.
-- ============================================================

create or replace function public.cancel_match(p_match_id uuid, p_note text default null, p_only_if_status text default null)
returns boolean
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.matches
    set hidden_at   = now(),
        hidden_note = coalesce(p_note, 'cancelled in app')
    where id = p_match_id
      and hidden_at is null
      and (p_only_if_status is null or status = p_only_if_status)
    returning id
  )
  select count(*) > 0 from updated;
$$;

-- lock it down: only the app roles may call it, nothing else inherits it
revoke all on function public.cancel_match(uuid, text, text) from public;
grant execute on function public.cancel_match(uuid, text, text) to anon, authenticated;

comment on function public.cancel_match is
  'Sanctioned soft-hide for the app''s Cancel-match button. Sets hidden_at
   on one match. Deliberately narrow: cannot unhide, cannot touch other
   columns, cannot delete. Reverse by setting hidden_at = null as admin.';
