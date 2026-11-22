-- Test emails that have a button are kept in the Sent list (marked TEST) with
-- click tracking, so admins can try the button and see their own click recorded.
alter table public.announcements add column is_test boolean not null default false;
