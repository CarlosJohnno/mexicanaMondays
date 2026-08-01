-- ============================================================
-- 003 — merge duplicate profiles ("Joe Wilko" → "Joe")
-- ============================================================
-- Situation: Joe created his PIN profile as "Joe Wilko", but his game
-- data sits under a separate "Joe" profile. End state: one profile,
-- named "Joe", holding all history, with a PIN that works.
--
-- NOTE on PINs: the app hashes  lower(name) + ':' + pin , so a hash
-- made for "Joe Wilko" can never work on "Joe". Step 3 sets a fresh
-- PIN on the merged profile — Joe can choose the same digits.
--
-- Run each step separately in Supabase → SQL Editor, in order.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 0 — Look before touching. Confirms which profile is which.
-- ------------------------------------------------------------
select pr.id, pr.name, pr.created_at,
       count(p.id)              as player_rows,
       count(distinct p.match_id) as matches
from public.profiles pr
left join public.players p on p.profile_id = pr.id
where pr.name ilike '%joe%' or pr.name ilike '%wilko%'
group by pr.id, pr.name, pr.created_at
order by pr.created_at;

-- Expect two rows: "Joe" (with matches) and "Joe Wilko" (probably 0).
-- If reality differs from that, stop and tell Claude what you see.


-- ------------------------------------------------------------
-- STEP 1 — Check for the one case that can't auto-merge:
-- both names present in the SAME match (two seats, one human).
-- ------------------------------------------------------------
select match_id, array_agg(name) as names
from public.players
where profile_id in (select id from public.profiles where name in ('Joe','Joe Wilko'))
   or name in ('Joe','Joe Wilko')
group by match_id
having count(distinct name) > 1;

-- Expect zero rows. Any result means that match needs a human decision
-- — don't run step 2, come back with the output.


-- ------------------------------------------------------------
-- STEP 2 — The merge (one transaction; rollback if anything looks off)
-- ------------------------------------------------------------
begin;

-- 2a. move any player rows off the spare profile onto the keeper
update public.players
set profile_id = (select id from public.profiles where name = 'Joe')
where profile_id = (select id from public.profiles where name = 'Joe Wilko');

-- 2b. rename any historical player entries so match sheets read "Joe"
update public.players
set name = 'Joe'
where name = 'Joe Wilko';

-- 2c. remove the now-empty spare profile so the sign-in picker
--     doesn't offer a dead "Joe Wilko" forever
delete from public.profiles
where name = 'Joe Wilko'
  and not exists (select 1 from public.players where profile_id = profiles.id);

-- 2d. verify: should be exactly one Joe-ish profile, with all the data
select pr.id, pr.name, count(p.id) as player_rows, count(distinct p.match_id) as matches
from public.profiles pr
left join public.players p on p.profile_id = pr.id
where pr.name ilike '%joe%' or pr.name ilike '%wilko%'
group by pr.id, pr.name;

commit;   -- or: rollback;


-- ------------------------------------------------------------
-- STEP 3 — Give "Joe" a working PIN.
-- Replace 0000 with the 4 digits Joe wants (fine to reuse his old ones).
-- ------------------------------------------------------------
create extension if not exists pgcrypto;

update public.profiles
set pin_hash = encode(digest(lower(trim(name)) || ':' || '0000', 'sha256'), 'hex')
where name = 'Joe';

-- Joe then signs in on his phone: Profile tab → Find my profile → Joe →
-- new PIN. All nights, points and titles come with it.
