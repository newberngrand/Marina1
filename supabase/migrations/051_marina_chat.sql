-- Marina Chat: one live chat room for anyone logged in (slip owners, long-term cruisers,
-- transients and staff). Messages arrive instantly through Supabase Realtime and are kept
-- for 90 days (older ones are cleared whenever someone posts). Admins can delete any
-- message and mute a login. Who has the chat open is tracked with a heartbeat, so the
-- Member Portal can say how many people are in the chat right now.

create table public.chat_messages (
  id            bigint generated always as identity primary key,
  user_id       uuid not null,
  slip          text,
  member_class  text,
  name          text not null,
  body          text not null check (length(body) between 1 and 1000),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid
);
create index chat_messages_created on public.chat_messages (created_at);

alter table public.chat_messages enable row level security;
-- Anyone logged in can read the chat; posting and deleting go through the functions below.
create policy chat_read on public.chat_messages
  for select to authenticated using ((select public.is_member()));
grant select on public.chat_messages to authenticated;

-- Live updates (new and deleted messages) for everyone with the chat open.
alter publication supabase_realtime add table public.chat_messages;

-- Who has the chat open: each open chat window checks in about every 30 seconds.
-- One row per window (a shared login can be open on several phones at once).
create table public.chat_presence (
  client_id   uuid primary key,
  user_id     uuid not null,
  name        text not null,
  seen_at     timestamptz not null default now()
);
alter table public.chat_presence enable row level security;   -- read only through chat_online()

-- Logins an admin has muted can read but not post.
alter table public.members add column if not exists chat_muted boolean not null default false;

-- The name shown on a message: owners show their name and slip; shared logins (cruisers,
-- staff) give a first name, shown with the kind of login.
create or replace function public.chat_display_name(m public.members, p_name text)
returns text language sql immutable set search_path = ''
as $$
  select case
    when m.member_class is null or m.member_class = 'certificated' or m.is_admin
      then left(coalesce(nullif(trim(m.owner_name), ''), 'Slip ' || m.slip), 60) || ' (' || m.slip || ')'
    else left(coalesce(nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), ''), 'Guest'), 40) || ' (' ||
         case m.member_class when 'ltc' then 'Long-term cruiser' when 'stc' then 'Transient' when 'employee' then 'Staff' else m.member_class end || ')'
  end
$$;

create or replace function public.chat_send(p_body text, p_name text)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid(); m public.members; b text := trim(coalesce(p_body, '')); id bigint;
begin
  select * into m from public.members x where x.user_id = uid and x.active;
  if uid is null or m.slip is null then raise exception 'Please log in to use the chat.' using errcode = 'P0001'; end if;
  if m.chat_muted then raise exception 'This login has been muted in the chat by the marina.' using errcode = 'P0001'; end if;
  if b = '' then raise exception 'Please type a message.' using errcode = 'P0001'; end if;
  if length(b) > 1000 then raise exception 'Messages can be up to 1,000 characters.' using errcode = 'P0001'; end if;
  -- Slow down floods: at most 10 messages in 30 seconds per login.
  if (select count(*) from public.chat_messages c where c.user_id = uid and c.created_at > now() - interval '30 seconds') >= 10 then
    raise exception 'You''re sending messages very quickly. Please wait a moment.' using errcode = 'P0001';
  end if;
  insert into public.chat_messages (user_id, slip, member_class, name, body)
  values (uid, m.slip, m.member_class, public.chat_display_name(m, p_name), b)
  returning chat_messages.id into id;
  -- Keep 90 days of chat.
  delete from public.chat_messages where created_at < now() - interval '90 days';
  return id;
end
$$;

-- Delete a message: your own, or any message if you're an admin. It disappears for everyone.
create or replace function public.chat_delete(p_id bigint)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid(); c public.chat_messages; adm boolean := public.is_admin();
begin
  select * into c from public.chat_messages where id = p_id;
  if c.id is null or c.deleted_at is not null then return; end if;
  if c.user_id <> uid and not adm then raise exception 'You can only delete your own messages.' using errcode = 'P0001'; end if;
  update public.chat_messages set deleted_at = now(), deleted_by = uid, body = '(deleted)' where id = p_id;
  if c.user_id <> uid then
    insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details)
    values (uid, (select slip from public.members where user_id = uid limit 1), true, 'chat_deleted', 'chat', p_id::text,
            left(c.name, 200), jsonb_build_object('text', left(c.body, 300), 'from_slip', c.slip));
  end if;
end
$$;

-- Admins: mute or unmute the login that sent a message.
create or replace function public.chat_mute(p_slip text, p_muted boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'Only admins can mute logins.' using errcode = 'P0001'; end if;
  update public.members set chat_muted = coalesce(p_muted, false) where slip = p_slip;
  if not found then raise exception 'No such login.' using errcode = 'P0001'; end if;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details)
  values (uid, (select slip from public.members where user_id = uid limit 1), true,
          case when p_muted then 'chat_muted' else 'chat_unmuted' end, 'member', p_slip, p_slip, '{}'::jsonb);
end
$$;

-- An open chat window checks in (and says who it is); closing it removes the row.
create or replace function public.chat_heartbeat(p_client uuid, p_name text, p_leaving boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid(); m public.members;
begin
  select * into m from public.members x where x.user_id = uid and x.active;
  if uid is null or m.slip is null or p_client is null then return; end if;
  if p_leaving then delete from public.chat_presence where client_id = p_client and user_id = uid; return; end if;
  insert into public.chat_presence (client_id, user_id, name, seen_at)
  values (p_client, uid, public.chat_display_name(m, p_name), now())
  on conflict (client_id) do update set name = excluded.name, seen_at = now() where public.chat_presence.user_id = uid;
  delete from public.chat_presence where seen_at < now() - interval '10 minutes';
end
$$;

-- Who is in the chat now (checked in within the last 75 seconds), for anyone logged in.
create or replace function public.chat_online()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when not public.is_member() then jsonb_build_object('count', 0, 'names', '[]'::jsonb) else (
    select jsonb_build_object('count', count(distinct name), 'names', coalesce(jsonb_agg(distinct name), '[]'::jsonb))
    from public.chat_presence where seen_at > now() - interval '75 seconds') end
$$;

-- Messages since a time (for the unread count on the Chat button), not counting your own.
create or replace function public.chat_unread(p_since timestamptz)
returns integer language sql stable security definer set search_path = ''
as $$
  select case when not public.is_member() then 0 else (
    select count(*)::int from public.chat_messages
    where created_at > coalesce(p_since, now() - interval '7 days') and deleted_at is null and user_id <> auth.uid()) end
$$;

-- Admins see which logins are muted.
create or replace function public.chat_muted_slips()
returns text[] language sql stable security definer set search_path = ''
as $$
  select case when public.is_admin() then coalesce(array_agg(slip order by slip), '{}') else '{}' end
  from public.members where chat_muted
$$;

revoke execute on function public.chat_display_name(public.members, text), public.chat_send(text, text), public.chat_delete(bigint),
  public.chat_mute(text, boolean), public.chat_heartbeat(uuid, text, boolean), public.chat_online(),
  public.chat_unread(timestamptz), public.chat_muted_slips() from public, anon;
grant execute on function public.chat_send(text, text), public.chat_delete(bigint),
  public.chat_mute(text, boolean), public.chat_heartbeat(uuid, text, boolean), public.chat_online(),
  public.chat_unread(timestamptz), public.chat_muted_slips() to authenticated;
