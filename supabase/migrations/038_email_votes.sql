-- Vote from the announcement email.
-- A vote announcement's email has one button per ballot choice. Each links to
-- vote.html?t=<the recipient's personal token>&c=<choice>, where the owner confirms
-- before anything is recorded (email security scanners open links on their own, so
-- a link alone must never cast a vote). Only slip owners (certificated) vote this
-- way; shared cruiser logins still vote on the website by name.
-- The same rules apply as on the website: one vote per slip, final once cast,
-- voting slips only, not excluded, and only while voting is open.

alter table public.votes alter column cast_by drop not null;
alter table public.votes add column cast_via text not null default 'website'
  check (cast_via in ('website', 'email'));

-- The recipient and the slips they may vote for with this token.
create or replace function public.email_vote_slips(p_token uuid)
returns table (slip text, owner_name text, eligible boolean, voted boolean, why text, event_id uuid)
language sql stable security definer set search_path = ''
as $$
  select m.slip, m.owner_name,
         (m.can_vote and x.slip is null and v.slip is null) as eligible,
         v.slip is not null as voted,
         case when v.slip is not null then 'already voted'
              when not m.can_vote then 'non-voting slip'
              when x.slip is not null then coalesce(nullif(x.reason, ''), 'not eligible on this ballot')
         end as why,
         a.event_id
  from public.announcement_recipients r
  join public.announcements a on a.id = r.announcement_id and not a.is_test
  join public.members m on m.slip = any (r.slips)
       and m.active and not m.is_admin and m.member_class = 'certificated'
       and lower(trim(coalesce(m.email, ''))) = lower(trim(r.email))
  left join public.vote_exclusions x on x.event_id = a.event_id and x.slip = m.slip
  left join lateral (select vv.slip from public.votes vv where vv.event_id = a.event_id and vv.slip = m.slip limit 1) v on true
  where r.token = p_token and a.event_id is not null
$$;
revoke all on function public.email_vote_slips(uuid) from public, anon, authenticated;

-- What vote.html shows before the owner confirms.
create or replace function public.email_vote_info(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  e public.events;
  ev_id uuid;
  st text;
begin
  select a.event_id into ev_id
  from public.announcement_recipients r join public.announcements a on a.id = r.announcement_id
  where r.token = p_token;
  select * into e from public.events where id = ev_id;
  if e.id is null or e.event_type <> 'vote' or not e.active or not ('certificated' = any (e.audience)) then
    return jsonb_build_object('ok', false, 'error', 'This voting link is not valid for a ballot. Please vote on the website instead.');
  end if;
  st := case when e.vote_opens_at is not null and now() < e.vote_opens_at then 'upcoming'
             when now() >= e.vote_closes_at then 'closed' else 'open' end;
  return jsonb_build_object('ok', true, 'event_id', e.id, 'title', e.title, 'summary', e.summary,
    'choices', to_jsonb(public.ballot_choices(e)), 'state', st,
    'opens_at', e.vote_opens_at, 'closes_at', e.vote_closes_at, 'test', e.vote_test,
    'slips', coalesce((select jsonb_agg(jsonb_build_object('slip', s.slip, 'owner', s.owner_name,
                         'eligible', s.eligible, 'voted', s.voted, 'why', s.why) order by s.slip)
                       from public.email_vote_slips(p_token) s), '[]'::jsonb));
end
$$;
revoke all on function public.email_vote_info(uuid) from public;
grant execute on function public.email_vote_info(uuid) to anon, authenticated;

-- Cast the owner's vote for the slips they ticked. All or nothing.
create or replace function public.email_cast_vote(p_token uuid, p_choice text, p_slips text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  e public.events;
  s record;
  want text[];
  done text[] := '{}';
  uid uuid;
begin
  select * into e from public.events where id =
    (select a.event_id from public.announcement_recipients r join public.announcements a on a.id = r.announcement_id where r.token = p_token)
  for share;
  if e.id is null or e.event_type <> 'vote' or not e.active or not ('certificated' = any (e.audience)) then
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
  select array_agg(distinct upper(trim(x))) into want from unnest(coalesce(p_slips, '{}')) x where trim(x) <> '';
  if want is null then
    raise exception 'Please tick at least one slip.' using errcode = 'P0001';
  end if;

  for s in select * from public.email_vote_slips(p_token) where slip = any (want) loop
    if not s.eligible then
      raise exception 'Slip % can''t vote on this ballot (%).', s.slip, s.why using errcode = 'P0001';
    end if;
    select m.user_id into uid from public.members m where m.slip = s.slip;
    insert into public.votes (event_id, slip, choice, cast_by, cast_via)
    values (e.id, s.slip, p_choice, uid, 'email');
    done := done || s.slip;
  end loop;
  if cardinality(done) <> cardinality(want) then
    raise exception 'You can only vote for the slips this email was sent for.' using errcode = 'P0001';
  end if;

  -- Count it as a real click on the email.
  update public.announcement_recipients
     set clicks = greatest(clicks, 1), first_click_at = coalesce(first_click_at, now()), last_click_at = now(),
         arrived_at = coalesce(arrived_at, now()), arrived_slip = coalesce(arrived_slip, done[1])
   where token = p_token;
  return jsonb_build_object('ok', true, 'slips', to_jsonb(done), 'choice', p_choice);
exception
  when unique_violation then
    raise exception 'A vote has already been cast for one of these slips. Votes cannot be changed.' using errcode = 'P0001';
end
$$;
revoke all on function public.email_cast_vote(uuid, text, text[]) from public;
grant execute on function public.email_cast_vote(uuid, text, text[]) to anon, authenticated;
