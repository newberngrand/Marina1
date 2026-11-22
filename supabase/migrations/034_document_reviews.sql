-- Documents sent out for review. An admin uploads a file and invites reviewers: the
-- board, chosen slips, and/or anyone by email. Each reviewer gets a private link
-- (review.html?t=<token>) that opens the document without logging in, and can
-- approve it, ask for changes, or just leave a comment. The review edge function
-- does the emailing and serves the file to link holders; admins read everything here.

create table if not exists public.doc_reviews (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(trim(title)) between 1 and 200),
  message      text not null default '' check (length(message) <= 4000),
  storage_path text not null,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,
  due_date     date,
  status       text not null default 'open' check (status in ('open', 'closed')),
  created_by   text,
  created_at   timestamptz not null default now()
);
alter table public.doc_reviews enable row level security;
drop policy if exists doc_reviews_admin on public.doc_reviews;
create policy doc_reviews_admin on public.doc_reviews for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.doc_reviews to authenticated;

create table if not exists public.doc_reviewers (
  id           uuid primary key default gen_random_uuid(),
  review_id    uuid not null references public.doc_reviews (id) on delete cascade,
  email        text not null,
  name         text not null default '',
  slip         text,
  via          text not null check (via in ('board', 'slip', 'email')),
  token        uuid not null unique default gen_random_uuid(),
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  email_error  text,
  invited_at   timestamptz,
  viewed_at    timestamptz,
  decision     text check (decision in ('approved', 'changes', 'comment')),
  comment      text check (length(comment) <= 4000),
  responded_at timestamptz,
  unique (review_id, email)
);
create index if not exists doc_reviewers_review on public.doc_reviewers (review_id);
alter table public.doc_reviewers enable row level security;
drop policy if exists doc_reviewers_admin_read on public.doc_reviewers;
create policy doc_reviewers_admin_read on public.doc_reviewers for select to authenticated using ((select public.is_admin()));
drop policy if exists doc_reviewers_admin_delete on public.doc_reviewers;
create policy doc_reviewers_admin_delete on public.doc_reviewers for delete to authenticated using ((select public.is_admin()));
revoke insert, update on public.doc_reviewers from anon, authenticated;
grant select, delete on public.doc_reviewers to authenticated;
