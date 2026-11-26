-- Harbor Hunt: when a boat is sunk, the shot also records that boat's squares, so the
-- other player's board can show the whole boat sinking. Every one of those squares has
-- already been hit, so this gives nothing away.
alter table public.hh_shots add column if not exists sunk_cells smallint[];

-- Call a square on the other harbor. Turns alternate after every shot.
create or replace function public.hh_fire(p_match uuid, p_client uuid, p_cell integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare g public.hh_matches; seat smallint; other smallint; board jsonb; s jsonb; res text := 'miss'; sunk text; sunkcells smallint[]; hitcells int[];
        won boolean; winner_name text; loser_name text; winner_user uuid; total int;
begin
  select * into g from public.hh_matches where id = p_match for update;
  seat := public.hh_seat(g, p_client);
  if g.id is null or seat is null then raise exception 'You''re not in that game.' using errcode = 'P0001'; end if;
  if g.status <> 'playing' then raise exception 'The game isn''t in play.' using errcode = 'P0001'; end if;
  if g.turn <> seat then raise exception 'It''s not your turn yet.' using errcode = 'P0001'; end if;
  if p_cell is null or p_cell < 0 or p_cell > 63 then raise exception 'Pick a square on the harbor.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.hh_shots where match_id = p_match and player = seat and cell = p_cell) then
    raise exception 'You already called that square.' using errcode = 'P0001';
  end if;
  other := 3 - seat;
  select ships into board from public.hh_boards where match_id = p_match and player = other;
  for s in select * from jsonb_array_elements(board) loop
    if (s->'cells') @> to_jsonb(p_cell) then
      res := 'hit';
      select array_agg(cell) into hitcells from public.hh_shots where match_id = p_match and player = seat and result <> 'miss';
      hitcells := coalesce(hitcells, '{}') || p_cell;
      if not exists (select 1 from jsonb_array_elements_text(s->'cells') x where not (x::int = any (hitcells))) then
        res := 'sunk'; sunk := s->>'type';
        select array_agg(x::smallint) into sunkcells from jsonb_array_elements_text(s->'cells') x;
      end if;
    end if;
  end loop;
  insert into public.hh_shots (match_id, player, cell, result, sunk_type, sunk_cells) values (p_match, seat, p_cell, res, sunk, sunkcells);
  -- All 12 boat squares hit?
  select count(*) = 12 into won from public.hh_shots where match_id = p_match and player = seat and result <> 'miss';
  select count(*) into total from public.hh_shots where match_id = p_match and player = seat;
  if won then
    update public.hh_matches set status = 'done', winner = seat, turn = null, shots = shots + 1, updated_at = now() where id = p_match;
    winner_name := case when seat = 1 then g.p1_name else g.p2_name end;
    loser_name := case when seat = 1 then g.p2_name else g.p1_name end;
    winner_user := case when seat = 1 then g.p1_user else g.p2_user end;
    insert into public.chat_messages (user_id, slip, member_class, name, body)
    values (winner_user, null, 'game', 'Harbor Hunt', winner_name || ' beat ' || loser_name || ' at Harbor Hunt, finding every boat in ' || total || ' shots.');
  else
    update public.hh_matches set turn = other, shots = shots + 1, updated_at = now() where id = p_match;
  end if;
  return jsonb_build_object('result', res, 'sunk', sunk, 'sunk_cells', to_jsonb(sunkcells), 'won', won);
end
$$;

