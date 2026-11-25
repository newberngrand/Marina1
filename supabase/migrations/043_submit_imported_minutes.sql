-- Put the minutes imported from Google Drive (May 13 to Nov 5, 2026, still drafts) on the
-- awaiting-approval list, owned by the board member who imported them (created_by).
update public.minutes_drafts
   set status = 'submitted', submitted_at = now(), submitted_by = created_by, locked_by = null, locked_at = null, updated_at = now()
 where status = 'draft' and document_id is null and meeting_date between '2026-05-13' and '2026-11-05';
