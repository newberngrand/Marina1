-- Help requests from any logged-in member (slip owners, cruisers, employees), handled on the
-- Admin page's Help Requests tab. New requests are emailed to the address set there
-- (site_settings.help_notify_email) by the help-email function.
-- Announcement emails can carry a "Request help" button (announcements.help_button).

create table if not exists public.site_settings (
  key   text primary key,
  value text not null default ''
);
alter table public.site_settings enable row level security;
drop policy if exists settings_admin on public.site_settings;
create policy settings_admin on public.site_settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.site_settings to authenticated;

create table if not exists public.help_requests (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  user_id      uuid not null default auth.uid(),
  slip         text,
  member_class text,
  name         text not null default '',
  email        text not null default '',
  phone        text not null default '',
  contact_text boolean not null default false,
  contact_call boolean not null default false,
  topic        text not null default 'Other',
  message      text not null check (length(trim(message)) between 1 and 4000),
  status       text not null default 'new' check (status in ('new', 'open', 'done')),
  admin_note   text not null default '',
  handled_by   text,
  updated_at   timestamptz not null default now(),
  notified_at  timestamptz
);
create index if not exists help_requests_recent on public.help_requests (created_at desc);
alter table public.help_requests enable row level security;
drop policy if exists help_own_read on public.help_requests;
-- Own requests only on a personal login: cruiser / transient logins are shared by many people.
create policy help_own_read on public.help_requests for select to authenticated
  using ((user_id = (select auth.uid()) and coalesce((select public.my_class()), '') not in ('ltc', 'stc')) or (select public.is_admin()));
drop policy if exists help_admin_update on public.help_requests;
create policy help_admin_update on public.help_requests for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke insert, delete on public.help_requests from anon, authenticated;
grant select, update on public.help_requests to authenticated;

-- What the help page fills in: the name and email on file for slip owners, and the details from
-- this login's last request. Shared cruiser / transient logins get nothing filled in, so one
-- person's details are never shown to the next person using the same login.
create or replace function public.help_defaults()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'slip', m.slip, 'member_class', m.member_class,
    'name', case when m.member_class = 'certificated' then m.owner_name else '' end,
    'email', case when m.member_class = 'certificated' or m.admin_rights then coalesce(m.email, '') else '' end,
    'last_name', case when m.member_class in ('ltc', 'stc') then null else (select h.name from public.help_requests h where h.user_id = m.user_id order by h.created_at desc limit 1) end,
    'last_email', case when m.member_class in ('ltc', 'stc') then null else (select h.email from public.help_requests h where h.user_id = m.user_id order by h.created_at desc limit 1) end,
    'phone', case when m.member_class in ('ltc', 'stc') then null else (select h.phone from public.help_requests h where h.user_id = m.user_id and h.phone <> '' order by h.created_at desc limit 1) end,
    'shared', m.member_class in ('ltc', 'stc'))
  from public.members m where m.user_id = (select auth.uid()) and m.active
$$;

create or replace function public.help_request_submit(p_name text, p_email text, p_phone text, p_text boolean, p_call boolean,
                                                      p_topic text, p_message text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare m public.members; id uuid; em text := lower(trim(coalesce(p_email, ''))); ph text := trim(coalesce(p_phone, ''));
begin
  select * into m from public.members where user_id = auth.uid() and active;
  if m.slip is null then raise exception 'Please log in to request help.' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_message, '')), '') is null then raise exception 'Please describe what you need help with.' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Please enter your name.' using errcode = 'P0001'; end if;
  if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address doesn''t look right.' using errcode = 'P0001'; end if;
  if (coalesce(p_text, false) or coalesce(p_call, false)) and length(regexp_replace(ph, '\D', '', 'g')) < 10 then
    raise exception 'Please enter a phone number (with area code) so we can text or call you.' using errcode = 'P0001';
  end if;
  if em = '' and ph = '' then raise exception 'Please give an email address or a phone number so we can reach you.' using errcode = 'P0001'; end if;
  if (select count(*) from public.help_requests h where h.user_id = auth.uid() and h.created_at > now() - interval '1 day') >= 10 then
    raise exception 'You have sent a lot of requests today. Please call the marina office at (252) 638-0318.' using errcode = 'P0001';
  end if;
  insert into public.help_requests (slip, member_class, name, email, phone, contact_text, contact_call, topic, message)
  values (m.slip, m.member_class, left(trim(p_name), 120), left(em, 254), left(ph, 40), coalesce(p_text, false), coalesce(p_call, false),
          left(coalesce(nullif(trim(p_topic), ''), 'Other'), 60), left(trim(p_message), 4000))
  returning help_requests.id into id;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label)
  values (auth.uid(), m.slip, true, 'help_requested', 'help', id::text, left(coalesce(nullif(trim(p_topic), ''), 'Other'), 60));
  return id;
end
$$;
revoke execute on function public.help_defaults(), public.help_request_submit(text, text, text, boolean, boolean, text, text) from public, anon;
grant execute on function public.help_defaults(), public.help_request_submit(text, text, text, boolean, boolean, text, text) to authenticated;

-- Email the office about each new request (help-email function; it sends at most once per request).
create or replace function public.notify_help_email()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://afejychfqezorwyqfcsh.supabase.co/functions/v1/help-email',
    body := jsonb_build_object('id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_publishable_feYqbTeGauYt9xQaQk0mtw_7ZZsFbmM'));
  return null;
exception when others then
  return null;
end
$$;
drop trigger if exists help_requests_email on public.help_requests;
create trigger help_requests_email after insert on public.help_requests for each row execute function public.notify_help_email();

-- "Request help" button on announcement emails.
alter table public.announcements add column if not exists help_button boolean not null default false;
create or replace function public.announcement_click(p_token uuid, p_user_agent text default '', p_automated boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r public.announcement_recipients;
  a public.announcements;
  ua text := left(coalesce(p_user_agent, ''), 400);
  scanner boolean;
begin
  select * into r from public.announcement_recipients where token = p_token;
  if not found then return jsonb_build_object('dest', 'member-portal.html'); end if;
  select * into a from public.announcements where id = r.announcement_id;
  scanner := coalesce(p_automated, false)
    or ua = ''
    or ua ~* '(bot|crawl|spider|preview|scan|headless|phantom|python|curl|wget|java/|go-http|okhttp|safelinks|proofpoint|mimecast|barracuda|symantec|trend ?micro|sophos|forcepoint|fireeye|zscaler)'
    or now() < coalesce(r.sent_at, now()) + interval '20 seconds';
  if (select count(*) from public.announcement_clicks c where c.announcement_id = r.announcement_id and c.email = r.email) < 200 then
    insert into public.announcement_clicks (announcement_id, email, user_agent, likely_scanner)
      values (r.announcement_id, r.email, ua, scanner);
  end if;
  if scanner then
    update public.announcement_recipients set scanner_clicks = scanner_clicks + 1
      where announcement_id = r.announcement_id and email = r.email;
  else
    update public.announcement_recipients
      set clicks = clicks + 1, first_click_at = coalesce(first_click_at, now()), last_click_at = now()
      where announcement_id = r.announcement_id and email = r.email;
  end if;
  return jsonb_build_object('dest',
    case when a.event_id is not null then 'event.html?id=' || a.event_id::text
         when a.help_button then 'help.html'
         else 'member-portal.html' end);
end
$$;
