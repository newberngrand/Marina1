-- Files attached to an announcement email: [{ "name": "Budget.pdf", "path": "announcements/<id>/Budget.pdf", "size": 12345 }].
-- The files live in the private marina-docs bucket under announcements/ (admins can already read and write there).
alter table public.announcements add column if not exists attachments jsonb not null default '[]'::jsonb;
