-- A photo of each slip's membership certificate, shown on the Admin page's Edit Slip form.
-- The image and its thumbnail live in the private marina-docs bucket under certificates/<slip>/.
-- Only admins can see or change them (marina-docs already lets admins read and write).
create table if not exists public.member_certificates (
  slip         text primary key references public.members (slip) on update cascade on delete cascade,
  storage_path text not null,
  thumb_path   text not null,
  uploaded_at  timestamptz not null default now(),
  uploaded_by  text
);
alter table public.member_certificates enable row level security;
drop policy if exists certificates_admin on public.member_certificates;
create policy certificates_admin on public.member_certificates for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.member_certificates from anon;
grant select, insert, update, delete on public.member_certificates to authenticated;
