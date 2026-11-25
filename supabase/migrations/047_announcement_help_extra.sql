-- Announcements can carry an extra "Request Help" button alongside their main button.
alter table public.announcements add column if not exists help_extra boolean not null default false;
