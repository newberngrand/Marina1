-- The Help Desk button in member emails opens the help form without logging in (people who
-- need help may be the ones who can't log in). The button's personal link (?t=<token>) says
-- who the email went to, so it stands in for the login.

-- Requests sent from an email link have no login.
alter table public.help_requests alter column user_id drop not null;
alter table public.help_requests add column if not exists via_email boolean not null default false;

-- Who an email link was sent to: the name and email to fill in on the help form.
-- Links older than 180 days no longer work.
create or replace function public.help_token_info(p_token uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', r.name, 'email', r.email, 'slips', to_jsonb(r.slips))
  from public.announcement_recipients r
  join public.announcements a on a.id = r.announcement_id
  where r.token = p_token and a.created_at > now() - interval '180 days'
$$;

create or replace function public.help_request_submit_link(p_token uuid, p_name text, p_email text, p_phone text,
                                                           p_text boolean, p_call boolean, p_topic text, p_message text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare r public.announcement_recipients; m public.members; id uuid;
        em text := lower(trim(coalesce(p_email, ''))); ph text := trim(coalesce(p_phone, ''));
begin
  select x.* into r from public.announcement_recipients x join public.announcements a on a.id = x.announcement_id
   where x.token = p_token and a.created_at > now() - interval '180 days';
  if r.token is null then
    raise exception 'This help link has expired. Please call the marina office at (252) 638-0318.' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_message, '')), '') is null then raise exception 'Please describe what you need help with.' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Please enter your name.' using errcode = 'P0001'; end if;
  if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address doesn''t look right.' using errcode = 'P0001'; end if;
  if (coalesce(p_text, false) or coalesce(p_call, false)) and length(regexp_replace(ph, '\D', '', 'g')) < 10 then
    raise exception 'Please enter a phone number (with area code) so we can text or call you.' using errcode = 'P0001';
  end if;
  if em = '' and ph = '' then raise exception 'Please give an email address or a phone number so we can reach you.' using errcode = 'P0001'; end if;
  -- A link can be forwarded, so keep it from being used for a flood of requests.
  if (select count(*) from public.help_requests h
       where h.via_email and h.created_at > now() - interval '1 day'
         and h.email = lower(r.email)) >= 5 then
    raise exception 'Several requests have been sent from this email today. Please call the marina office at (252) 638-0318.' using errcode = 'P0001';
  end if;
  select * into m from public.members where slip = r.slips[1];
  insert into public.help_requests (user_id, slip, member_class, name, email, phone, contact_text, contact_call, topic, message, via_email)
  values (null, nullif(array_to_string(r.slips, ', '), ''), m.member_class, left(trim(p_name), 120), left(coalesce(nullif(em, ''), lower(r.email)), 254), left(ph, 40),
          coalesce(p_text, false), coalesce(p_call, false), left(coalesce(nullif(trim(p_topic), ''), 'Other'), 60), left(trim(p_message), 4000), true)
  returning help_requests.id into id;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details)
  values (null, nullif(array_to_string(r.slips, ', '), ''), true, 'help_requested', 'help', id::text,
          left(coalesce(nullif(trim(p_topic), ''), 'Other'), 60), jsonb_build_object('from_email_link', true));
  return id;
end
$$;

revoke execute on function public.help_token_info(uuid),
  public.help_request_submit_link(uuid, text, text, text, boolean, boolean, text, text) from public;
grant execute on function public.help_token_info(uuid),
  public.help_request_submit_link(uuid, text, text, text, boolean, boolean, text, text) to anon, authenticated;
