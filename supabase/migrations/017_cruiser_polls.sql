-- Ballots / polls for one group: owners (certificated), long-term cruisers (ltc)
-- or transients (stc). Cruiser groups share one login, so on a cruiser poll each
-- person votes under their own name (one vote per name). Owner ballots are
-- unchanged: one vote per slip.

alter table public.votes add column if not exists id uuid not null default gen_random_uuid();
alter table public.votes add column if not exists voter_name text
  check (voter_name is null or length(trim(voter_name)) between 1 and 80);
alter table public.votes drop constraint votes_pkey;
alter table public.votes add primary key (id);
create unique index votes_one_per_voter on public.votes (event_id, slip, lower(coalesce(voter_name, '')));

-- A ballot is for exactly one group.
create or replace function public.vote_single_audience()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.event_type = 'vote' and coalesce(array_length(new.audience, 1), 0) <> 1 then
    raise exception 'A ballot must be for exactly one group: owners, long-term cruisers or transients.';
  end if;
  return new;
end
$$;
drop trigger if exists events_vote_single_audience on public.events;
create trigger events_vote_single_audience before insert or update on public.events
  for each row execute function public.vote_single_audience();

-- Shared logins can't see who on their login voted (names stay private).
drop policy votes_read on public.votes;
create policy votes_read on public.votes for select to authenticated using (
  (select public.is_admin())
  or ((select public.my_class()) = 'certificated' and slip in (select s.slip from public.my_slips() s)));

drop function public.cast_vote(uuid, text, text);
create function public.cast_vote(p_event_id uuid, p_choice text, p_slip text default null, p_voter_name text default null)
returns public.votes
language plpgsql security definer set search_path = ''
as $$
declare
  m public.members;
  e public.events;
  v public.votes;
  target text;
  target_votes boolean;
  why text;
  nm text := nullif(regexp_replace(trim(coalesce(p_voter_name, '')), '\s+', ' ', 'g'), '');
  group_poll boolean;
begin
  select * into m from public.members where user_id = auth.uid();
  if m.slip is null or not m.active then
    raise exception 'Only active members can vote.' using errcode = 'P0001';
  end if;
  if m.is_admin then
    raise exception 'Admin accounts do not vote. Please log in with your slip.' using errcode = 'P0001';
  end if;

  select * into e from public.events where id = p_event_id for share;
  if e.id is null or e.event_type <> 'vote' or not e.active or not (m.member_class = any (e.audience)) then
    raise exception 'This ballot is not available.' using errcode = 'P0001';
  end if;
  group_poll := m.member_class <> 'certificated';

  if group_poll then
    -- Shared login: one vote per person, by name.
    target := m.slip;
    if nm is null then
      raise exception 'Please type your name.' using errcode = 'P0001';
    end if;
    if length(nm) > 80 then nm := left(nm, 80); end if;
  else
    nm := null;
    target := upper(coalesce(nullif(trim(p_slip), ''), m.slip));
    select s.can_vote into target_votes from public.my_slips() s where s.slip = target;
    if target_votes is null then
      raise exception 'You can only vote for your own slips.' using errcode = 'P0001';
    end if;
    if not target_votes then
      raise exception 'Slip % is a non-voting slip.', target using errcode = 'P0001';
    end if;
    select x.reason into why from public.vote_exclusions x where x.event_id = e.id and x.slip = target;
    if found then
      raise exception 'Slip % is not eligible to vote on this ballot (%). Please contact the marina office.', target, why using errcode = 'P0001';
    end if;
  end if;

  if e.vote_opens_at is not null and now() < e.vote_opens_at then
    raise exception 'Voting has not opened yet.' using errcode = 'P0001';
  end if;
  if now() >= e.vote_closes_at then
    raise exception 'Voting has closed. No more votes are being accepted.' using errcode = 'P0001';
  end if;
  if not (p_choice = any (public.ballot_choices(e))) then
    raise exception 'That is not one of the choices on this ballot.' using errcode = 'P0001';
  end if;

  insert into public.votes (event_id, slip, choice, cast_by, voter_name)
  values (e.id, target, p_choice, auth.uid(), nm)
  returning * into v;
  return v;
exception
  when unique_violation then
    if nm is not null then
      raise exception 'Someone named % has already voted on this poll. Votes cannot be changed.', nm using errcode = 'P0001';
    end if;
    raise exception 'A vote has already been cast for slip %. Votes cannot be changed.', target using errcode = 'P0001';
end
$$;
revoke all on function public.cast_vote(uuid, text, text, text) from public, anon;
grant execute on function public.cast_vote(uuid, text, text, text) to authenticated;

-- The email function finds the vote by its id.
create or replace function public.notify_vote_email()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://afejychfqezorwyqfcsh.supabase.co/functions/v1/vote-email',
    body := jsonb_build_object('event_id', new.event_id, 'slip', new.slip, 'vote_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'apikey', 'sb_publishable_feYqbTeGauYt9xQaQk0mtw_7ZZsFbmM')
  );
  return null;
exception when others then
  return null;
end
$$;

-- Shared LTC / STC passwords are set by the admin only. Admin → Set Password
-- opens a short unlock window (admin-members function); any other password
-- change on those logins is refused.
create table if not exists public.password_unlocks (
  user_id uuid primary key,
  until   timestamptz not null
);
alter table public.password_unlocks enable row level security;   -- service role only

create or replace function public.guard_shared_password()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     and exists (select 1 from public.members m where m.user_id = new.id and m.member_class in ('ltc', 'stc'))
     and not exists (select 1 from public.password_unlocks u where u.user_id = new.id and u.until > now()) then
    raise exception 'The password for this shared login can only be changed by the marina admin.';
  end if;
  delete from public.password_unlocks where user_id = new.id;
  return new;
end
$$;
drop trigger if exists guard_shared_password on auth.users;
create trigger guard_shared_password before update of encrypted_password on auth.users
  for each row execute function public.guard_shared_password();
