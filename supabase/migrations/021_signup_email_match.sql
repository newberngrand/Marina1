-- Simpler change/cancel for shared logins: no emailed code. Typing the email
-- used on a sign-up (on the same login) is enough to edit or cancel it.
-- Email is required for LTC and STC sign-ups.

drop function if exists public.signup_code_entries(uuid, text, text);
drop function if exists public.signup_code_save(uuid, text, text, uuid, text, text, text, text[]);
drop function if exists public.signup_code_delete(uuid, text, text, uuid);
drop function if exists public.signup_code_problem(uuid, text, text);
drop function if exists public.signup_code_issue(uuid, uuid, text);
drop table if exists public.signup_codes;

create or replace function public.signup_shared_email()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.members m where m.slip = new.slip and m.member_class in ('ltc', 'stc'))
     and (new.email is null or trim(new.email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Please enter your email address. It is needed if you want to change or cancel your sign-up later.'
      using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- Internal: error message, or null when the signed-in login is a shared one.
create or replace function public.signup_email_problem(p_email text)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when public.my_slip() is null or public.my_class() = 'certificated' then 'This is only for shared logins.'
    when trim(coalesce(p_email, '')) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'Please type the email you used when you signed up.'
  end
$$;
revoke execute on function public.signup_email_problem(text) from public, anon, authenticated;

create or replace function public.signup_email_entries(p_event_id uuid, p_email text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  why text := public.signup_email_problem(p_email);
  list jsonb;
begin
  if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'email', s.email, 'phone', s.phone, 'answers', s.answers) order by s.created_at)
    into list
    from public.event_signups s
   where s.event_id = p_event_id and s.slip = public.my_slip() and lower(trim(s.email)) = lower(trim(p_email));
  if list is null then
    return jsonb_build_object('ok', false, 'error', 'No sign-up for this event on this login uses that email address. Please check the spelling.');
  end if;
  return jsonb_build_object('ok', true, 'entries', list);
end
$$;

create or replace function public.signup_email_save(p_event_id uuid, p_email text, p_id uuid,
  p_name text, p_new_email text, p_phone text, p_answers text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.signup_email_problem(p_email);
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

create or replace function public.signup_email_delete(p_event_id uuid, p_email text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.signup_email_problem(p_email);
begin
  if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  if not public.signup_open(p_event_id) then return jsonb_build_object('ok', false, 'error', 'Sign-up has closed, so entries can no longer be cancelled online.'); end if;
  delete from public.event_signups
   where id = p_id and event_id = p_event_id and slip = public.my_slip() and lower(trim(email)) = lower(trim(p_email));
  if not found then return jsonb_build_object('ok', false, 'error', 'That sign-up could not be found.'); end if;
  return jsonb_build_object('ok', true);
end
$$;

revoke execute on function public.signup_email_entries(uuid, text),
  public.signup_email_save(uuid, text, uuid, text, text, text, text[]),
  public.signup_email_delete(uuid, text, uuid) from public, anon;
grant execute on function public.signup_email_entries(uuid, text),
  public.signup_email_save(uuid, text, uuid, text, text, text, text[]),
  public.signup_email_delete(uuid, text, uuid) to authenticated;
