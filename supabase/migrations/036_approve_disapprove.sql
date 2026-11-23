-- A ballot can offer Approve / Disapprove as a built-in choice.

alter table public.events drop constraint if exists events_ballot_kind_check;
alter table public.events add constraint events_ballot_kind_check
  check (ballot_kind in ('yes_no', 'yes_no_abstain', 'approve_disapprove', 'choice'));

create or replace function public.ballot_choices(e public.events)
returns text[] language sql immutable set search_path = ''
as $$
  select case e.ballot_kind
    when 'yes_no' then array['Yea', 'Nay']
    when 'yes_no_abstain' then array['Yea', 'Nay', 'Abstain']
    when 'approve_disapprove' then array['Approve', 'Disapprove']
    else e.ballot_options
  end
$$;
