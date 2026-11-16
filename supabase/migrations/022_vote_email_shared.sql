-- Voting on a shared LTC / STC login: name and email are both required, and each
-- email gets one vote (as well as each name). The voter's receipt goes to that email.

alter table public.votes add column if not exists voter_email text
  check (voter_email is null or voter_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
create unique index if not exists votes_one_per_email on public.votes (event_id, slip, lower(voter_email))
  where voter_email is not null;

drop function public.cast_vote(uuid, text, text, text);
create function public.cast_vote(p_event_id uuid, p_choice text, p_slip text default null,
  p_voter_name text default null, p_voter_email text default null)
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
  em text := nullif(lower(trim(coalesce(p_voter_email, ''))), '');
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
    target := m.slip;
    if nm is null then
      raise exception 'Please type your name.' using errcode = 'P0001';
    end if;
    if length(nm) > 80 then nm := left(nm, 80); end if;
    if em is not null and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'That email address doesn''t look right.' using errcode = 'P0001';
    end if;
    if em is null and m.member_class in ('ltc', 'stc') then
      raise exception 'Please type your email address.' using errcode = 'P0001';
    end if;
  else
    nm := null; em := null;
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

  if em is not null and exists (select 1 from public.votes x where x.event_id = e.id and x.slip = target and lower(x.voter_email) = em) then
    raise exception 'A vote has already been cast with the email %. Votes cannot be changed.', em using errcode = 'P0001';
  end if;

  insert into public.votes (event_id, slip, choice, cast_by, voter_name, voter_email)
  values (e.id, target, p_choice, auth.uid(), nm, em)
  returning * into v;
  return v;
exception
  when unique_violation then
    if nm is not null then
      raise exception 'Someone named % (or with that email) has already voted on this ballot. Votes cannot be changed.', nm using errcode = 'P0001';
    end if;
    raise exception 'A vote has already been cast for slip %. Votes cannot be changed.', target using errcode = 'P0001';
end
$$;
revoke all on function public.cast_vote(uuid, text, text, text, text) from public, anon;
grant execute on function public.cast_vote(uuid, text, text, text, text) to authenticated;
