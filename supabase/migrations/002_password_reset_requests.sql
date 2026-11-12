-- Log of password-reset requests, used to rate-limit the reset function.
create table public.password_reset_requests (
  id bigint generated always as identity primary key,
  slip text not null,
  matched boolean not null,
  created_at timestamptz not null default now()
);
create index password_reset_requests_slip_time on public.password_reset_requests (slip, created_at desc);
alter table public.password_reset_requests enable row level security;
create policy reset_requests_admin_read on public.password_reset_requests
  for select to authenticated using ((select public.is_admin()));
revoke all on public.password_reset_requests from anon;
grant select on public.password_reset_requests to authenticated;
