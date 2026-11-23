-- Test votes: a vote marked as a test can have its ballots cleared, or be deleted
-- with its ballots. Real votes still can't be deleted once ballots are cast.
-- The test mark itself is locked once ballots exist, so a real vote can't be
-- turned into a test one to get rid of its ballots.

alter table public.events add column vote_test boolean not null default false;

create or replace function public.lock_ballot_after_votes()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (new.ballot_kind is distinct from old.ballot_kind
      or new.ballot_options is distinct from old.ballot_options
      or new.event_type is distinct from old.event_type
      or new.vote_test is distinct from old.vote_test)
     and exists (select 1 from public.votes v where v.event_id = old.id) then
    raise exception 'Votes have already been cast, so the ballot choices can no longer be changed.' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- Remove every ballot from a test vote (admins only).
create or replace function public.clear_test_votes(p_event uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'Only admins can do this.' using errcode = '42501'; end if;
  if not exists (select 1 from public.events e where e.id = p_event and e.vote_test) then
    raise exception 'Only a test vote can have its ballots cleared.' using errcode = 'P0001';
  end if;
  delete from public.votes where event_id = p_event;
  get diagnostics n = row_count;
  return n;
end
$$;

-- Delete a test vote together with its ballots (admins only).
create or replace function public.delete_test_vote(p_event uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.clear_test_votes(p_event);
  delete from public.events where id = p_event;
end
$$;

revoke all on function public.clear_test_votes(uuid) from public, anon;
revoke all on function public.delete_test_vote(uuid) from public, anon;
grant execute on function public.clear_test_votes(uuid) to authenticated;
grant execute on function public.delete_test_vote(uuid) to authenticated;
