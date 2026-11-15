-- Email announcements to members, sent by the announce function.
-- One email per distinct address (owners with several slips get one email).

create table public.announcements (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null,
  body        text not null,
  audience    text not null check (audience in ('all', 'voting')),
  event_id    uuid references public.events (id) on delete set null,
  sent_by     text,
  status      text not null default 'sending' check (status in ('sending', 'paused', 'done')),
  total       integer not null default 0,
  sent        integer not null default 0,
  failed      integer not null default 0,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger announcements_touch before update on public.announcements
  for each row execute function public.touch_updated_at();

create table public.announcement_recipients (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  email           text not null,
  name            text not null default '',
  slips           text[] not null default '{}',
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error           text,
  sent_at         timestamptz,
  primary key (announcement_id, email)
);
create index announcement_recipients_pending on public.announcement_recipients (announcement_id, status);

alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
create policy announcements_admin_read on public.announcements for select to authenticated using ((select public.is_admin()));
create policy announcement_recipients_admin_read on public.announcement_recipients for select to authenticated using ((select public.is_admin()));
revoke all on public.announcements, public.announcement_recipients from anon, authenticated;
grant select on public.announcements, public.announcement_recipients to authenticated;
