-- A ballot can be for any mix of groups (owners, long-term cruisers, transients,
-- employees). Owners vote once per slip; shared group logins vote once per name
-- (cast_vote from 017 already decides by the voter's login type).
drop trigger if exists events_vote_single_audience on public.events;
drop function if exists public.vote_single_audience();
