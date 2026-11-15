-- Sign-up sheets for (social) events: name, slip, email, phone plus up to four
-- free-form fields the admin names (e.g. Entree, Dessert, Beverage).

alter table public.events
  add column signup_enabled   boolean not null default false,
  add column signup_fields    text[]  not null default '{}',
  add column signup_closes_at timestamptz,
  add column signup_public    boolean not null default true,   -- members can see who signed up
  add constraint signup_fields_max check (cardinality(signup_fields) <= 4);

create table public.event_signups (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  slip        text not null references public.members (slip) on update cascade on delete cascade,
  name        text not null check (length(trim(name)) > 0 and length(name) <= 120),
  email       text check (email is null or length(email) <= 254),
  phone       text check (phone is null or length(phone) <= 40),
  answers     text[] not null default '{}' check (cardinality(answers) <= 4),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  unique (event_id, slip)                      -- one sign-up per slip per event
);
create index event_signups_event on public.event_signups (event_id, created_at);
create trigger event_signups_touch before update on public.event_signups
  for each row execute function public.touch_updated_at();

-- Is sign-up open for this event right now?
create or replace function public.signup_open(p_event_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.active and e.signup_enabled
      and (e.signup_closes_at is null or now() < e.signup_closes_at)
  )
$$;
-- The slip the signed-in account belongs to.
create or replace function public.my_slip()
returns text language sql stable security definer set search_path = ''
as $$ select m.slip from public.members m where m.user_id = (select auth.uid()) and m.active $$;
revoke execute on function public.signup_open(uuid), public.my_slip() from anon, public;
grant execute on function public.signup_open(uuid), public.my_slip() to authenticated;

alter table public.event_signups enable row level security;
-- Read: admins see everything; members see only their own full entry.
-- (The shared "who's coming" list comes from signup_list(), without email/phone.)
create policy signups_read on public.event_signups for select to authenticated using (
  (select public.is_admin()) or slip = (select public.my_slip())
);
-- Members sign up / change / cancel their own slip's entry while sign-up is open. Admins can always.
create policy signups_insert on public.event_signups for insert to authenticated with check (
  (select public.is_admin()) or (slip = (select public.my_slip()) and public.signup_open(event_id))
);
create policy signups_update on public.event_signups for update to authenticated
  using ((select public.is_admin()) or (slip = (select public.my_slip()) and public.signup_open(event_id)))
  with check ((select public.is_admin()) or (slip = (select public.my_slip()) and public.signup_open(event_id)));
create policy signups_delete on public.event_signups for delete to authenticated using (
  (select public.is_admin()) or (slip = (select public.my_slip()) and public.signup_open(event_id))
);
revoke all on public.event_signups from anon;
grant select, insert, update, delete on public.event_signups to authenticated;

-- Shared "who's coming" list for members (no email or phone), when the event allows it.
create or replace function public.signup_list(p_event_id uuid)
returns table (slip text, name text, answers text[], created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.slip, s.name, s.answers, s.created_at
  from public.event_signups s
  join public.events e on e.id = s.event_id
  where s.event_id = p_event_id
    and (public.is_admin() or (public.is_member() and e.active and e.signup_enabled and e.signup_public))
  order by s.created_at
$$;
revoke execute on function public.signup_list(uuid) from anon, public;
grant execute on function public.signup_list(uuid) to authenticated;

-- Activity log.
create or replace function public.log_signup_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  who text;
  r public.event_signups;
  t text;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  select m.slip into who from public.members m where m.user_id = uid;
  select e.title into t from public.events e where e.id = r.event_id;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details)
  values (uid, who, who is not null,
          'signup_' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'cancelled' end,
          'event', r.event_id::text, t, jsonb_build_object('slip', r.slip, 'name', r.name));
  return null;
end
$$;
create trigger log_signups after insert or update or delete on public.event_signups
  for each row execute function public.log_signup_change();
