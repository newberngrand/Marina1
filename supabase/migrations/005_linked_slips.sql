-- Owners with several slips (same email on file) see and vote all of them
-- from whichever slip they log in with.

-- The signed-in slip plus every active slip sharing its email address.
create or replace function public.my_slips()
returns table (slip text, owner_name text, email text, is_login boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.slip, lower(trim(m.email)) as em, m.is_admin
    from public.members m
    where m.user_id = (select auth.uid()) and m.active
  )
  select m.slip, m.owner_name, m.email, m.slip = me.slip
  from public.members m, me
  where m.active and not m.is_admin and not me.is_admin
    and (m.slip = me.slip or (me.em is not null and me.em <> '' and lower(trim(m.email)) = me.em))
  order by m.slip <> me.slip, m.slip
$$;
revoke execute on function public.my_slips() from anon, public;
grant execute on function public.my_slips() to authenticated;

-- Members can read the votes of all their slips.
drop policy votes_read on public.votes;
create policy votes_read on public.votes
  for select to authenticated
  using ((select public.is_admin()) or slip in (select s.slip from public.my_slips() s));

-- Cast a vote for one of the signed-in owner's slips.
drop function public.cast_vote(uuid, text);
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
begin
  select * into m from public.members where user_id = auth.uid();
  if m.slip is null or not m.active then
    raise exception 'Only active members can vote.' using errcode = 'P0001';
  end if;
  if m.is_admin then
    raise exception 'Admin accounts do not vote. Please log in with your slip.' using errcode = 'P0001';
  end if;
  target := upper(coalesce(nullif(trim(p_slip), ''), m.slip));
  if not exists (select 1 from public.my_slips() s where s.slip = target) then
    raise exception 'You can only vote for your own slips.' using errcode = 'P0001';
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
  values (e.id, target, p_choice, auth.uid())
  returning * into v;
  return v;
exception
  when unique_violation then
    raise exception 'A vote has already been cast for slip %. Votes cannot be changed.', target using errcode = 'P0001';
end
$$;
revoke execute on function public.cast_vote(uuid, text, text) from anon, public;
grant execute on function public.cast_vote(uuid, text, text) to authenticated;
