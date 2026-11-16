-- Documents can be marked Public (permits, rules, forms...). Every file stays in
-- the private marina-docs bucket; visitors who aren't logged in may list and
-- open only active documents marked public (through a short-lived signed link).
-- Everything else stays members-only.

alter table public.documents add column if not exists is_public boolean not null default false;

grant select on public.documents to anon;
drop policy if exists documents_public_read on public.documents;
create policy documents_public_read on public.documents for select to anon, authenticated
  using (active and is_public);

drop policy if exists marina_docs_public_read on storage.objects;
create policy marina_docs_public_read on storage.objects for select to anon, authenticated using (
  bucket_id = 'marina-docs'
  and exists (select 1 from public.documents d
              where d.storage_path = storage.objects.name and d.active and d.is_public)
);
