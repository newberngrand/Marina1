-- A "Board Documents" section: only board members (and admins) can see these.
-- They are never public and never shown to other members.

alter table public.documents drop constraint documents_category_check;
alter table public.documents add constraint documents_category_check
  check (category in ('bylaws', 'rules', 'minutes', 'financials', 'permits', 'insurance', 'forms', 'other', 'board'));
alter table public.documents add constraint board_docs_private check (category <> 'board' or not is_public);

drop policy documents_member_read on public.documents;
create policy documents_member_read on public.documents for select to authenticated using (
  (select public.is_admin())
  or (active and approval_status = 'approved' and category <> 'board' and (select public.my_class()) = 'certificated')
  or (active and category = 'board' and (select public.is_board())));

drop policy marina_docs_member_read on storage.objects;
create policy marina_docs_member_read on storage.objects for select to authenticated using (
  bucket_id = 'marina-docs' and (
    (select public.is_admin())
    or ((select public.my_class()) = 'certificated'
        and exists (select 1 from public.documents d where d.storage_path = storage.objects.name
                    and d.active and d.approval_status = 'approved' and d.category <> 'board'))
    or ((select public.is_board())
        and exists (select 1 from public.documents d where d.storage_path = storage.objects.name
                    and d.active and d.category = 'board'))
    or exists (select 1 from public.event_attachments a
               where a.storage_path = storage.objects.name and public.can_see_event(a.event_id))
  )
);
