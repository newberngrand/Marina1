-- Documents attached to an event for review (votes, notices, any event).
-- An attachment is either a file uploaded for this event (document_id null),
-- or a link to an existing Marina Documents item (document_id set). Either way
-- storage_path points at the file, so members can open it from the event even
-- if the library item itself is hidden.

create table public.event_attachments (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  document_id   uuid references public.documents (id) on delete cascade,
  storage_path  text not null,
  title         text not null check (length(trim(title)) > 0),
  file_name     text not null default '',
  mime_type     text not null default '',
  size_bytes    bigint not null default 0,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index event_attachments_event on public.event_attachments (event_id, sort_order);

alter table public.event_attachments enable row level security;
create policy attachments_read on public.event_attachments for select to authenticated using (
  (select public.is_admin())
  or ((select public.is_member()) and exists (select 1 from public.events e where e.id = event_id and e.active))
);
create policy attachments_admin_insert on public.event_attachments for insert to authenticated with check ((select public.is_admin()));
create policy attachments_admin_update on public.event_attachments for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy attachments_admin_delete on public.event_attachments for delete to authenticated using ((select public.is_admin()));
revoke all on public.event_attachments from anon;
grant select, insert, update, delete on public.event_attachments to authenticated;

-- Members may open a file if it's an active library document or attached to an active event.
drop policy marina_docs_member_read on storage.objects;
create policy marina_docs_member_read on storage.objects
  for select to authenticated
  using (bucket_id = 'marina-docs' and (
    (select public.is_admin()) or (
      (select public.is_member()) and (
        exists (select 1 from public.documents d where d.storage_path = storage.objects.name and d.active)
        or exists (select 1 from public.event_attachments a join public.events e on e.id = a.event_id
                   where a.storage_path = storage.objects.name and e.active)
      )
    )
  ));
