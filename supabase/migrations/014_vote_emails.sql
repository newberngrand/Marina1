-- Vote emails: a receipt to the voter and a notice to the vote-counting committee,
-- sent by the vote-email function right after each vote is recorded.

create extension if not exists pg_net with schema extensions;

alter table public.events
  add column vote_notify_email text not null default '';    -- committee address(es), comma-separated

alter table public.votes
  add column receipt_sent_at   timestamptz,
  add column committee_sent_at timestamptz;

-- After a vote is stored, ask the vote-email function to send the emails.
-- The function looks the vote up itself and sends each email at most once,
-- so calling it can't be used to send anything else.
create or replace function public.notify_vote_email()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://afejychfqezorwyqfcsh.supabase.co/functions/v1/vote-email',
    body := jsonb_build_object('event_id', new.event_id, 'slip', new.slip),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'apikey', 'sb_publishable_feYqbTeGauYt9xQaQk0mtw_7ZZsFbmM')
  );
  return null;
exception when others then
  return null;   -- never block a vote because of email trouble
end
$$;
create trigger votes_send_emails after insert on public.votes
  for each row execute function public.notify_vote_email();

-- Totals for the committee email (server only; the public vote_totals checks the caller's login).
create or replace function public.vote_totals_internal(p_event_id uuid)
returns table (choice text, votes bigint, eligible bigint, cast_total bigint)
language sql stable security definer set search_path = ''
as $$
  select c.choice,
         (select count(*) from public.votes v where v.event_id = e.id and v.choice = c.choice),
         (select count(*) from public.members m
           where m.active and not m.is_admin and m.can_vote
             and not exists (select 1 from public.vote_exclusions x where x.event_id = e.id and x.slip = m.slip)),
         (select count(*) from public.votes v where v.event_id = e.id)
  from public.events e, unnest(public.ballot_choices(e)) with ordinality as c(choice, ord)
  where e.id = p_event_id
  order by c.ord
$$;
revoke execute on function public.vote_totals_internal(uuid) from public, anon, authenticated;
grant execute on function public.vote_totals_internal(uuid) to service_role;
