-- Current events and marina documents for the member portal.
-- Active members can read active items; admins can add/edit/delete everything.

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = (select auth.uid()) and m.active
  )
$$;
revoke execute on function public.is_member() from anon, public;
grant execute on function public.is_member() to authenticated;

-- Events ------------------------------------------------------------------
create table public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) > 0),
  summary     text not null default '',          -- short description shown in the list
  details     text not null default '',          -- full particulars on the event page
  event_type  text not null default 'meeting'
              check (event_type in ('meeting','vote','notice','social','maintenance','other')),
  starts_at   timestamptz,
  ends_at     timestamptz,
  location    text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index events_active_start on public.events (active, starts_at);
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

alter table public.events enable row level security;
create policy events_member_read on public.events
  for select to authenticated
  using ((active and (select public.is_member())) or (select public.is_admin()));
create policy events_admin_insert on public.events
  for insert to authenticated with check ((select public.is_admin()));
create policy events_admin_update on public.events
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy events_admin_delete on public.events
  for delete to authenticated using ((select public.is_admin()));
revoke all on public.events from anon;
grant select, insert, update, delete on public.events to authenticated;

-- Documents ---------------------------------------------------------------
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  category      text not null
                check (category in ('bylaws','rules','minutes','financials','permits','insurance','forms','other')),
  title         text not null check (length(trim(title)) > 0),
  description   text not null default '',
  doc_date      date,                 -- meeting date for minutes; effective/issue date otherwise
  storage_path  text not null unique, -- object path in the marina-docs bucket
  file_name     text not null,
  mime_type     text not null default '',
  size_bytes    bigint not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint minutes_need_date check (category <> 'minutes' or doc_date is not null)
);
create index documents_cat_date on public.documents (category, doc_date desc);
create trigger documents_touch before update on public.documents
  for each row execute function public.touch_updated_at();

alter table public.documents enable row level security;
create policy documents_member_read on public.documents
  for select to authenticated
  using ((active and (select public.is_member())) or (select public.is_admin()));
create policy documents_admin_insert on public.documents
  for insert to authenticated with check ((select public.is_admin()));
create policy documents_admin_update on public.documents
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy documents_admin_delete on public.documents
  for delete to authenticated using ((select public.is_admin()));
revoke all on public.documents from anon;
grant select, insert, update, delete on public.documents to authenticated;

-- File storage (private bucket; files are opened through short-lived signed links)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marina-docs', 'marina-docs', false, 26214400, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp'
]);

create policy marina_docs_member_read on storage.objects
  for select to authenticated
  using (bucket_id = 'marina-docs' and (
    (select public.is_admin()) or (
      (select public.is_member()) and exists (
        select 1 from public.documents d where d.storage_path = storage.objects.name and d.active
      )
    )
  ));
create policy marina_docs_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'marina-docs' and (select public.is_admin()));
create policy marina_docs_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'marina-docs' and (select public.is_admin()));
create policy marina_docs_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'marina-docs' and (select public.is_admin()));
