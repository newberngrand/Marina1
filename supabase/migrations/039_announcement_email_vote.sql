-- The admin chooses whether a vote announcement includes the vote-from-email buttons.
alter table public.announcements add column email_vote boolean not null default false;
