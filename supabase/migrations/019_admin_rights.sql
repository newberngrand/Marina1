-- Admin rights for a regular owner slip. The owner keeps voting and everything
-- else about their slip, and also gets the Admin page. (members.is_admin still
-- means a separate board account such as BOD, which doesn't vote or count.)
alter table public.members add column if not exists admin_rights boolean not null default false;
alter table public.members add constraint members_admin_rights_owner
  check (not admin_rights or member_class = 'certificated');

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = (select auth.uid()) and (m.is_admin or m.admin_rights) and m.active
  )
$$;
