-- Employees can be given admin rights too (owners already could). Shared cruiser
-- logins (LTC / STC) still can't.
alter table public.members drop constraint members_admin_rights_owner;
alter table public.members add constraint members_admin_rights_owner
  check (not admin_rights or member_class in ('certificated', 'employee'));
