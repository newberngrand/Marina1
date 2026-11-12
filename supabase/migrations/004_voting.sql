-- Online voting: one vote per slip per ballot, final once cast.

alter table public.events
  add column ballot_kind     text not null default 'yes_no'
    check (ballot_kind in ('yes_no', 'yes_no_abstain', 'choice')),
  add column ballot_options  text[] not null default '{}',   -- used when ballot_kind = 'choice'
  add column vote_opens_at   timestamptz,
  add column vote_closes_at  timestamptz,
  add column results_visibility text not null default 'after_close'
    check (results_visibility in ('after_close', 'live', 'admins_only'));

-- Existing vote events need a closing time before the rule below applies.
update public.events set vote_closes_at = coalesce(ends_at, starts_at, now() + interval '30 days')
where event_type = 'vote' and vote_closes_at is null;

alter table public.events
  add constraint vote_window_order check (vote_opens_at is null or vote_closes_at is null or vote_closes_at > vote_opens_at),
  add constraint vote_needs_close check (event_type <> 'vote' or vote_closes_at is not null),
  add constraint choice_needs_options check (event_type <> 'vote' or ballot_kind <> 'choice' or cardinality(ballot_options) >= 2);

-- The choices a ballot offers.
create or replace function public.ballot_choices(e public.events)
returns text[] language sql immutable set search_path = ''
as $$
  select case e.ballot_kind
    when 'yes_no' then array['Yea', 'Nay']
    when 'yes_no_abstain' then array['Yea', 'Nay', 'Abstain']
    else e.ballot_options
  end
$$;

create table public.votes (
  event_id  uuid not null references public.events (id) on delete restrict,
  slip      text not null references public.members (slip) on update cascade on delete restrict,
  choice    text not null,
  cast_at   timestamptz not null default now(),
  cast_by   uuid not null default auth.uid(),
  primary key (event_id, slip)          -- one vote per slip per ballot
);

alter table public.votes enable row level security;
-- Members can see their own slip's vote; admins see all. Nobody can insert,
-- change or delete votes directly: casting goes through cast_vote().
create policy votes_read on public.votes
  for select to authenticated
  using ((select public.is_admin()) or slip = (
    select m.slip from public.members m where m.user_id = (select auth.uid())
  ));
revoke all on public.votes from anon, authenticated;
grant select on public.votes to authenticated;

-- Cast the signed-in slip's vote.
create or replace function public.cast_vote(p_event_id uuid, p_choice text)
returns public.votes
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.members;
  e public.events;
  v public.votes;
begin
  select * into m from public.members where user_id = auth.uid();
  if m.slip is null or not m.active then
    raise exception 'Only active members can vote.' using errcode = 'P0001';
  end if;
  if m.is_admin then
    raise exception 'Admin accounts do not vote. Please log in with your slip.' using errcode = 'P0001';
  end if;

  select * into e from public.events where id = p_event_id for share;
  if e.id is null or e.event_type <> 'vote' or not e.active then
    raise exception 'This ballot is not available.' using errcode = 'P0001';
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

  insert into public.votes (event_id, slip, choice, cast_by)
  values (e.id, m.slip, p_choice, auth.uid())
  returning * into v;
  return v;
exception
  when unique_violation then
    raise exception 'A vote has already been cast for slip %. Votes cannot be changed.', m.slip using errcode = 'P0001';
end
$$;
revoke execute on function public.cast_vote(uuid, text) from anon, public;
grant execute on function public.cast_vote(uuid, text) to authenticated;

-- Totals for a ballot. Members get them when the ballot allows it; admins always.
create or replace function public.vote_totals(p_event_id uuid)
returns table (choice text, votes bigint, eligible bigint, cast_total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.events;
begin
  select * into e from public.events where id = p_event_id;
  if e.id is null or e.event_type <> 'vote' then return; end if;
  if not public.is_admin() then
    if not public.is_member() or not e.active then return; end if;
    if e.results_visibility = 'admins_only' then return; end if;
    if e.results_visibility = 'after_close' and now() < e.vote_closes_at then return; end if;
  end if;
  return query
    select c.choice,
           (select count(*) from public.votes v where v.event_id = e.id and v.choice = c.choice),
           (select count(*) from public.members m where m.active and not m.is_admin),
           (select count(*) from public.votes v where v.event_id = e.id)
    from unnest(public.ballot_choices(e)) with ordinality as c(choice, ord)
    order by c.ord;
end
$$;
revoke execute on function public.vote_totals(uuid) from anon, public;
grant execute on function public.vote_totals(uuid) to authenticated;

-- Once votes exist, the ballot's choices are locked.
create or replace function public.lock_ballot_after_votes()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (new.ballot_kind is distinct from old.ballot_kind
      or new.ballot_options is distinct from old.ballot_options
      or new.event_type is distinct from old.event_type)
     and exists (select 1 from public.votes v where v.event_id = old.id) then
    raise exception 'Votes have already been cast, so the ballot choices can no longer be changed.' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger events_lock_ballot before update on public.events
  for each row execute function public.lock_ballot_after_votes();
