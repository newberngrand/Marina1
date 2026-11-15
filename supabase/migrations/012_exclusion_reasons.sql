-- Reasons a slip can be ineligible to vote, managed from the vote form's drop-down.
create table public.exclusion_reasons (
  id          uuid primary key default gen_random_uuid(),
  label       text not null unique check (length(trim(label)) between 1 and 120),
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now()
);
alter table public.exclusion_reasons enable row level security;
create policy exclusion_reasons_admin_all on public.exclusion_reasons
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.exclusion_reasons from anon;
grant select, insert, update, delete on public.exclusion_reasons to authenticated;

insert into public.exclusion_reasons (label, sort_order)
values ('In arrears on dues and/or assessment payments', 0);

alter table public.vote_exclusions alter column reason set default 'In arrears on dues and/or assessment payments';
