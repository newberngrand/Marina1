-- Shared logins (LTC / STC / staff): each sign-up needs an email address, and a
-- person can change or cancel their own entry after proving they own that email
-- (a 6-digit code emailed by the signup-code function, valid 30 minutes).

-- Email is required when a shared login signs up.
create or replace function public.signup_shared_email()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.members m where m.slip = new.slip and m.member_class <> 'certificated')
     and (new.email is null or trim(new.email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Please enter your email address. It is needed if you want to change or cancel your sign-up later.'
      using errcode = 'P0001';
  end if;
  return new;
end
$$;
drop trigger if exists event_signups_shared_email on public.event_signups;
create trigger event_signups_shared_email before insert on public.event_signups
  for each row execute function public.signup_shared_email();

-- One live code per (event, login, email). Server-side only.
create table if not exists public.signup_codes (
  event_id   uuid not null references public.events (id) on delete cascade,
  slip       text not null,
  email      text not null,               -- lower-case
  code_hash  text not null,
  expires_at timestamptz not null,
  attempts   int not null default 0,
  created_at timestamptz not null default now(),
  primary key (event_id, slip, email)
);
alter table public.signup_codes enable row level security;
revoke all on public.signup_codes from anon, authenticated;

-- Called by the signup-code function (service role) for the signed-in user.
-- Checks everything, stores a hashed code and returns the code to be emailed.
create or replace function public.signup_code_issue(p_uid uuid, p_event_id uuid, p_email text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  m public.members;
  e public.events;
  em text := lower(trim(coalesce(p_email, '')));
  c text;
  last_sent timestamptz;
begin
  select * into m from public.members where user_id = p_uid and active;
  if m.slip is null or m.is_admin or m.member_class = 'certificated' then
    raise exception 'This is only for shared logins.' using errcode = 'P0001';
  end if;
  select * into e from public.events where id = p_event_id;
  if e.id is null or not e.active or not e.signup_enabled or not (m.member_class = any (e.audience)) then
    raise exception 'This sign-up sheet is not available.' using errcode = 'P0001';
  end if;
  if e.signup_closes_at is not null and now() >= e.signup_closes_at then
    raise exception 'Sign-up has closed, so entries can no longer be changed online. Please call the marina office at (252) 638-0318.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.event_signups s
                 where s.event_id = e.id and s.slip = m.slip and lower(trim(s.email)) = em) then
    raise exception 'No sign-up for this event on this login uses that email address. Please check the spelling.' using errcode = 'P0001';
  end if;
  select created_at into last_sent from public.signup_codes where event_id = e.id and slip = m.slip and email = em;
  if last_sent is not null and last_sent > now() - interval '60 seconds' then
    raise exception 'A code was just sent. Please wait a minute before asking for another.' using errcode = 'P0001';
  end if;
  c := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.signup_codes (event_id, slip, email, code_hash, expires_at)
  values (e.id, m.slip, em, extensions.crypt(c, extensions.gen_salt('bf', 8)), now() + interval '30 minutes')
  on conflict (event_id, slip, email) do update
    set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = now();
  return c;
end
$$;
revoke execute on function public.signup_code_issue(uuid, uuid, text) from public, anon, authenticated;

-- Internal: is this code right for the signed-in shared login? Returns an error message, or null when OK.
-- Wrong codes are counted (5 tries per code); it never raises, so the count sticks.
create or replace function public.signup_code_problem(p_event_id uuid, p_email text, p_code text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  r public.signup_codes;
  me text := public.my_slip();
  em text := lower(trim(coalesce(p_email, '')));
begin
  if me is null or public.my_class() = 'certificated' then return 'This is only for shared logins.'; end if;
  select * into r from public.signup_codes where event_id = p_event_id and slip = me and email = em;
  if r.event_id is null or r.expires_at < now() then return 'That code has expired. Please ask for a new one.'; end if;
  if r.attempts >= 5 then return 'Too many wrong codes. Please ask for a new one.'; end if;
  if extensions.crypt(trim(coalesce(p_code, '')), r.code_hash) <> r.code_hash then
    update public.signup_codes set attempts = attempts + 1 where event_id = r.event_id and slip = r.slip and email = r.email;
    return 'That code isn''t right. Please check the email and try again.';
  end if;
  return null;
end
$$;
revoke execute on function public.signup_code_problem(uuid, text, text) from public, anon, authenticated;

-- The entries on this login that use the verified email.
create or replace function public.signup_code_entries(p_event_id uuid, p_email text, p_code text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.signup_code_problem(p_event_id, p_email, p_code);
begin
  if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  return jsonb_build_object('ok', true, 'entries', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'email', s.email, 'phone', s.phone, 'answers', s.answers) order by s.created_at)
    from public.event_signups s
    where s.event_id = p_event_id and s.slip = public.my_slip() and lower(trim(s.email)) = lower(trim(p_email))), '[]'::jsonb));
end
$$;

create or replace function public.signup_code_save(p_event_id uuid, p_email text, p_code text, p_id uuid,
  p_name text, p_new_email text, p_phone text, p_answers text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.signup_code_problem(p_event_id, p_email, p_code);
  nm text := nullif(trim(coalesce(p_name, '')), '');
  ne text := nullif(trim(coalesce(p_new_email, '')), '');
begin
  if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  if not public.signup_open(p_event_id) then return jsonb_build_object('ok', false, 'error', 'Sign-up has closed, so entries can no longer be changed.'); end if;
  if nm is null then return jsonb_build_object('ok', false, 'error', 'Please enter a name.'); end if;
  if ne is null or ne !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'Please enter a valid email address.'); end if;
  begin
    update public.event_signups
       set name = left(nm, 120), email = left(ne, 254), phone = left(nullif(trim(coalesce(p_phone, '')), ''), 40),
           answers = coalesce(p_answers[1:4], '{}')
     where id = p_id and event_id = p_event_id and slip = public.my_slip() and lower(trim(email)) = lower(trim(p_email));
    if not found then return jsonb_build_object('ok', false, 'error', 'That sign-up could not be found.'); end if;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'Someone named ' || nm || ' is already signed up from this login.');
  end;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.signup_code_delete(p_event_id uuid, p_email text, p_code text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.signup_code_problem(p_event_id, p_email, p_code);
begin
  if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  if not public.signup_open(p_event_id) then return jsonb_build_object('ok', false, 'error', 'Sign-up has closed, so entries can no longer be cancelled online.'); end if;
  delete from public.event_signups
   where id = p_id and event_id = p_event_id and slip = public.my_slip() and lower(trim(email)) = lower(trim(p_email));
  if not found then return jsonb_build_object('ok', false, 'error', 'That sign-up could not be found.'); end if;
  return jsonb_build_object('ok', true);
end
$$;

revoke execute on function public.signup_code_entries(uuid, text, text),
  public.signup_code_save(uuid, text, text, uuid, text, text, text, text[]),
  public.signup_code_delete(uuid, text, text, uuid) from public, anon;
grant execute on function public.signup_code_entries(uuid, text, text),
  public.signup_code_save(uuid, text, text, uuid, text, text, text, text[]),
  public.signup_code_delete(uuid, text, text, uuid) to authenticated;
