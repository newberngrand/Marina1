-- Activity log: what members do (logins, documents, events, votes, admin changes)
-- plus anonymous site counts (page views, slip-finder searches, Reserve clicks).
-- Only admins can read it. Rows are added through log_event() or by triggers;
-- nobody can edit or delete log rows through the website.

create table public.activity_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  user_id      uuid,                 -- signed-in account, if any
  slip         text,                 -- slip the account belongs to (or slip typed on a failed login)
  is_member    boolean not null default false,
  action       text not null,
  target_type  text,                 -- event, document, member, page, slip, link...
  target_id    text,
  target_label text,                 -- human-readable name (event title, document title, slip)
  details      jsonb not null default '{}'::jsonb,
  page         text,                 -- page path where it happened
  visitor_id   text,                 -- random id kept in the browser, to count unique visitors
  device       text                  -- 'mobile' or 'desktop'
);
create index activity_log_at on public.activity_log (at desc);
create index activity_log_action_at on public.activity_log (action, at desc);
create index activity_log_slip_at on public.activity_log (slip, at desc);

alter table public.activity_log enable row level security;
create policy activity_log_admin_read on public.activity_log
  for select to authenticated using ((select public.is_admin()));
revoke all on public.activity_log from anon, authenticated;
grant select on public.activity_log to authenticated;

-- Actions the website may report. Member-only actions are ignored unless signed in.
create or replace function public.log_event(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_label text default null,
  p_details jsonb default '{}'::jsonb,
  p_page text default null,
  p_visitor text default null,
  p_device text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.members;
  public_actions text[] := array['page_view', 'slip_search', 'reserve_click', 'login_failed', 'reset_requested'];
  member_actions text[] := array['login', 'logout', 'view_portal', 'view_event', 'open_document', 'view_results',
                                 'change_password', 'reset_password_done', 'view_admin'];
  d jsonb := coalesce(p_details, '{}'::jsonb);
begin
  if p_action is null or not (p_action = any (public_actions || member_actions)) then
    return;
  end if;
  if uid is not null then
    select * into m from public.members where user_id = uid;
  end if;
  if p_action = any (member_actions) and m.slip is null then
    return;
  end if;
  if length(d::text) > 2000 then d := '{}'::jsonb; end if;

  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details, page, visitor_id, device)
  values (
    uid,
    coalesce(m.slip, case when p_action = 'login_failed' then left(upper(p_target_id), 20) end),
    m.slip is not null,
    p_action,
    left(p_target_type, 40),
    left(p_target_id, 100),
    left(p_label, 200),
    d,
    left(p_page, 200),
    left(p_visitor, 64),
    case when p_device in ('mobile', 'desktop') then p_device end
  );
end
$$;
revoke execute on function public.log_event(text, text, text, text, jsonb, text, text, text) from public;
grant execute on function public.log_event(text, text, text, text, jsonb, text, text, text) to anon, authenticated;

-- Server-side records of changes, so they're logged no matter how they're made.
create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  who text;
  act text;
  ttype text;
  tid text;
  lbl text;
  d jsonb := '{}'::jsonb;
  r record;
begin
  select m.slip into who from public.members m where m.user_id = uid;
  if tg_op = 'DELETE' then r := old; else r := new; end if;

  if tg_table_name = 'votes' then
    act := 'vote_cast'; ttype := 'event'; tid := r.event_id::text;
    select e.title into lbl from public.events e where e.id = r.event_id;
    d := jsonb_build_object('slip', r.slip, 'choice', r.choice);
  elsif tg_table_name = 'events' then
    act := 'event_' || lower(case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end);
    ttype := 'event'; tid := r.id::text; lbl := r.title;
    if tg_op = 'UPDATE' and old.active is distinct from new.active then d := jsonb_build_object('active', new.active); end if;
  elsif tg_table_name = 'documents' then
    act := 'document_' || lower(case tg_op when 'INSERT' then 'uploaded' when 'UPDATE' then 'updated' else 'deleted' end);
    ttype := 'document'; tid := r.id::text; lbl := r.title;
    d := jsonb_build_object('section', r.category);
    if tg_op = 'UPDATE' and old.active is distinct from new.active then d := d || jsonb_build_object('visible', new.active); end if;
  elsif tg_table_name = 'members' then
    if tg_op <> 'UPDATE' then
      act := case tg_op when 'INSERT' then 'member_added' else 'member_deleted' end;
    else
      act := 'member_updated';
      if old.owner_name is distinct from new.owner_name then d := d || jsonb_build_object('owner', jsonb_build_array(old.owner_name, new.owner_name)); end if;
      if old.email is distinct from new.email then d := d || jsonb_build_object('email', jsonb_build_array(old.email, new.email)); end if;
      if old.active is distinct from new.active then d := d || jsonb_build_object('active', new.active); end if;
      if old.can_vote is distinct from new.can_vote then d := d || jsonb_build_object('can_vote', new.can_vote); end if;
      if d = '{}'::jsonb then return null; end if;   -- nothing worth logging (e.g. timestamp only)
    end if;
    ttype := 'member'; tid := r.slip; lbl := r.slip;
  elsif tg_table_name = 'vote_exclusions' then
    act := case tg_op when 'DELETE' then 'ineligible_removed' else 'ineligible_marked' end;
    ttype := 'event'; tid := r.event_id::text;
    select e.title into lbl from public.events e where e.id = r.event_id;
    d := jsonb_build_object('slip', r.slip, 'reason', r.reason);
  elsif tg_table_name = 'member_notes' then
    act := 'member_note_changed'; ttype := 'member'; tid := r.slip; lbl := r.slip;
  end if;

  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details)
  values (uid, who, who is not null, act, ttype, tid, lbl, d);
  return null;
end
$$;

create trigger log_votes after insert on public.votes for each row execute function public.log_change();
create trigger log_events after insert or update or delete on public.events for each row execute function public.log_change();
create trigger log_documents after insert or update or delete on public.documents for each row execute function public.log_change();
create trigger log_members after insert or update or delete on public.members for each row execute function public.log_change();
create trigger log_vote_exclusions after insert or delete on public.vote_exclusions for each row execute function public.log_change();
create trigger log_member_notes after insert or update or delete on public.member_notes for each row execute function public.log_change();

-- Dashboard numbers for the admin Log tab.
create or replace function public.activity_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  res jsonb;
  tz text := 'America/New_York';
  today timestamptz := date_trunc('day', now() at time zone tz) at time zone tz;
begin
  if not public.is_admin() then return null; end if;
  select jsonb_build_object(
    'views_today',   count(*) filter (where action = 'page_view' and at >= today),
    'views_7d',      count(*) filter (where action = 'page_view' and at >= now() - interval '7 days'),
    'views_30d',     count(*) filter (where action = 'page_view' and at >= now() - interval '30 days'),
    'views_all',     count(*) filter (where action = 'page_view'),
    'visitors_30d',  count(distinct visitor_id) filter (where action = 'page_view' and at >= now() - interval '30 days'),
    'searches_30d',  count(*) filter (where action = 'slip_search' and at >= now() - interval '30 days'),
    'searches_all',  count(*) filter (where action = 'slip_search'),
    'reserve_30d',   count(*) filter (where action = 'reserve_click' and at >= now() - interval '30 days'),
    'reserve_all',   count(*) filter (where action = 'reserve_click'),
    'logins_30d',    count(*) filter (where action = 'login' and at >= now() - interval '30 days'),
    'members_30d',   count(distinct slip) filter (where action = 'login' and at >= now() - interval '30 days'),
    'failed_30d',    count(*) filter (where action = 'login_failed' and at >= now() - interval '30 days')
  ) into res
  from public.activity_log;

  res := res || jsonb_build_object(
    'top_pages', coalesce((select jsonb_agg(x) from (
      select page, count(*) as n from public.activity_log
      where action = 'page_view' and at >= now() - interval '30 days' and page is not null
      group by page order by n desc limit 8) x), '[]'::jsonb),
    'top_slips', coalesce((select jsonb_agg(x) from (
      select target_label as slip, count(*) as n from public.activity_log
      where action = 'slip_search' and at >= now() - interval '30 days' and target_label is not null
      group by target_label order by n desc limit 8) x), '[]'::jsonb)
  );
  return res;
end
$$;
revoke execute on function public.activity_summary() from anon, public;
grant execute on function public.activity_summary() to authenticated;
