-- Move minutes that were submitted under the earlier flow (a PDF made at submit, reviewed as a
-- document) to the new review: the draft goes back under review, any approvals already given are
-- kept (as approvals of the minutes as they stand now), and the early PDF's document row is removed.
-- The early PDF file itself is removed from storage by the Board page (storage can't be cleaned from SQL).

create table if not exists public.minutes_stale_files (storage_path text primary key, created_at timestamptz not null default now());
alter table public.minutes_stale_files enable row level security;
drop policy if exists stale_files_board_read on public.minutes_stale_files;
create policy stale_files_board_read on public.minutes_stale_files for select to authenticated using ((select public.is_board()));
grant select on public.minutes_stale_files to authenticated;

-- The Board page calls this after it has removed a stale file from storage.
create or replace function public.minutes_stale_file_removed(p_path text)
returns void language sql security definer set search_path = ''
as $$ delete from public.minutes_stale_files where storage_path = p_path and public.is_board() $$;
revoke execute on function public.minutes_stale_file_removed(text) from public, anon;
grant execute on function public.minutes_stale_file_removed(text) to authenticated;

do $$
declare r record;
begin
  for r in
    select dr.id as draft_id, dr.html, dr.title, d.id as doc_id, d.storage_path, d.created_at, d.submitted_by
    from public.minutes_drafts dr join public.documents d on d.id = dr.document_id
    where dr.status = 'submitted' and d.approval_status = 'pending'
  loop
    insert into public.minutes_approvals (draft_id, slip, viewed_at, approved_at, approved_html, approved_title)
    select r.draft_id, a.slip, a.viewed_at, a.approved_at, case when a.approved_at is not null then r.html end, case when a.approved_at is not null then r.title end
    from public.document_approvals a where a.document_id = r.doc_id
    on conflict (draft_id, slip) do nothing;
    update public.minutes_drafts
       set document_id = null, submitted_at = coalesce(submitted_at, r.created_at), submitted_by = coalesce(submitted_by, r.submitted_by)
     where id = r.draft_id;
    insert into public.minutes_stale_files (storage_path) values (r.storage_path) on conflict do nothing;
    delete from public.documents where id = r.doc_id;
  end loop;
end
$$;
