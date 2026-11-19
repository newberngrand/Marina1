-- Poker Run fixes: no picks before the day a player joined; card times use the real clock so
-- several picks in one request keep their order.
alter table public.game_cards alter column picked_at set default clock_timestamp();

create or replace function public.game_entry_status(p_entry uuid,
  out picks integer, out held integer, out out_day integer, out picks_left integer, out phase text)
language plpgsql stable security definer set search_path = '' as $$
declare en public.game_entries; ck record; done integer;
begin
  select * into en from public.game_entries where id = p_entry;
  select * into ck from public.game_clock(en.event_id);
  select count(*) filter (where kind = 'pick'), count(*) filter (where not discarded)
    into picks, held from public.game_cards where entry_id = p_entry;
  done := case when ck.over then 5 when ck.cur is not null then ck.cur - 1 else ck.elapsed end;
  out_day := coalesce(en.out_day, public.game_out_day(p_entry, en.joined_day, done));
  picks_left := 0;
  if out_day is not null then phase := 'out'; return; end if;
  if ck.over then phase := 'over'; return; end if;
  if ck.cur is null then phase := case when ck.elapsed = 0 then 'waiting' else 'rest' end; return; end if;
  if ck.cur < en.joined_day then phase := 'waiting'; return; end if;
  picks_left := greatest(0, least(ck.cur, 5) - picks);
  if picks_left > 0 then phase := 'pick';
  elsif ck.cur = 5 and picks >= 5 then
    phase := case when not en.decided then 'decide' when en.draws_owed > 0 then 'drawing' else 'done' end;
  else phase := 'picked';
  end if;
end $$;
revoke execute on function public.game_entry_status(uuid) from public, anon, authenticated;
