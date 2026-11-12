-- Members, keyed by slip. Each slip has its own Supabase login account.
-- The login account's email is an internal address built from the slip
-- (slip-a1@members.newberngrand.com); the owner's real contact email is
-- stored in members.email and is what password resets are checked against.
-- When a slip is sold, update owner_name / email on that slip's row and
-- set a new password; the slip keeps the same login account.

create table public.members (
  slip        text primary key check (slip ~ '^[A-Z0-9-]+$'),
  user_id     uuid unique references auth.users (id) on delete set null,
  owner_name  text not null default '',
  email       text,
  is_admin    boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Internal notes about a slip (from the "Notes" sheet); admins only.
create table public.member_notes (
  slip        text primary key references public.members (slip) on update cascade on delete cascade,
  note        text not null default '',
  updated_at  timestamptz not null default now()
);

create or replace function public.slip_auth_email(p_slip text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'slip-' || lower(p_slip) || '@members.newberngrand.com'
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = (select auth.uid()) and m.is_admin and m.active
  )
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger members_touch before update on public.members
  for each row execute function public.touch_updated_at();
create trigger member_notes_touch before update on public.member_notes
  for each row execute function public.touch_updated_at();

alter table public.members enable row level security;
alter table public.member_notes enable row level security;

-- A member can read only their own slip's row; admins can read all rows.
create policy members_select on public.members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy members_admin_insert on public.members
  for insert to authenticated with check ((select public.is_admin()));
create policy members_admin_update on public.members
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy members_admin_delete on public.members
  for delete to authenticated using ((select public.is_admin()));

create policy member_notes_admin_all on public.member_notes
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.members, public.member_notes from anon;
grant select, insert, update, delete on public.members, public.member_notes to authenticated;
revoke execute on function public.is_admin() from anon, public;
grant execute on function public.is_admin() to authenticated;
