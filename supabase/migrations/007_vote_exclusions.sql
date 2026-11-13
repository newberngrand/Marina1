-- Make a slip ineligible for one particular vote (for example, in arrears).

create table public.vote_exclusions (
  event_id    uuid not null references public.events (id) on delete cascade,
  slip        text not null references public.members (slip) on update cascade on delete cascade,
  reason      text not null default 'In arrears',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  primary key (event_id, slip)
);

alter table public.vote_exclusions enable row level security;
-- Admins manage the list; members can see it only for their own slips.
create policy vote_exclusions_read on public.vote_exclusions
  for select to authenticated
  using ((select public.is_admin()) or slip in (select s.slip from public.my_slips() s));
create policy vote_exclusions_admin_insert on public.vote_exclusions
  for insert to authenticated with check ((select public.is_admin()));
create policy vote_exclusions_admin_update on public.vote_exclusions
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy vote_exclusions_admin_delete on public.vote_exclusions
  for delete to authenticated using ((select public.is_admin()));
revoke all on public.vote_exclusions from anon;
grant select, insert, update, delete on public.vote_exclusions to authenticated;

-- A slip that has already voted can't be made ineligible afterwards.
create or replace function public.exclusion_not_after_vote()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.votes v where v.event_id = new.event_id and v.slip = new.slip) then
    raise exception 'Slip % has already voted on this ballot, so it can''t be made ineligible now.', new.slip using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger vote_exclusions_check before insert or update on public.vote_exclusions
  for each row execute function public.exclusion_not_after_vote();

-- cast_vote: refuse slips that are ineligible for this vote.
create or replace function public.cast_vote(p_event_id uuid, p_choice text, p_slip text default null)
returns public.votes
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.members;
  e public.events;
  v public.votes;
  target text;
  target_votes boolean;
  why text;
begin
  select * into m from public.members where user_id = auth.uid();
  if m.slip is null or not m.active then
    raise exception 'Only active members can vote.' using errcode = 'P0001';
  end if;
  if m.is_admin then
    raise exception 'Admin accounts do not vote. Please log in with your slip.' using errcode = 'P0001';
  end if;
  target := upper(coalesce(nullif(trim(p_slip), ''), m.slip));
  select s.can_vote into target_votes from public.my_slips() s where s.slip = target;
  if target_votes is null then
    raise exception 'You can only vote for your own slips.' using errcode = 'P0001';
  end if;
  if not target_votes then
    raise exception 'Slip % is a non-voting slip.', target using errcode = 'P0001';
  end if;

  select * into e from public.events where id = p_event_id for share;
  if e.id is null or e.event_type <> 'vote' or not e.active then
    raise exception 'This ballot is not available.' using errcode = 'P0001';
  end if;

  select x.reason into why from public.vote_exclusions x where x.event_id = e.id and x.slip = target;
  if found then
    raise exception 'Slip % is not eligible to vote on this ballot (%). Please contact the marina office.', target, why using errcode = 'P0001';
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
  values (e.id, target, p_choice, auth.uid())
  returning * into v;
  return v;
exception
  when unique_violation then
    raise exception 'A vote has already been cast for slip %. Votes cannot be changed.', target using errcode = 'P0001';
end
$$;

-- Totals: ineligible slips are not counted as eligible for that vote.
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
           (select count(*) from public.members m
             where m.active and not m.is_admin and m.can_vote
               and not exists (select 1 from public.vote_exclusions x where x.event_id = e.id and x.slip = m.slip)),
           (select count(*) from public.votes v where v.event_id = e.id)
    from unnest(public.ballot_choices(e)) with ordinality as c(choice, ord)
    order by c.ord;
end
$$;
