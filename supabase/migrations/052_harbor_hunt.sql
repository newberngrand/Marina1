-- Harbor Hunt: a two-player hidden-fleet game started from Marina Chat. Each player hides
-- four boats on an 8 x 8 harbor (Yacht 4, Sailboat 3, Trawler 3, Skiff 2), then they take
-- turns calling squares on the other's harbor. Boat positions stay on the server; a shot
-- only ever reveals hit, miss or sunk. Players are identified by login plus the chat window
-- (client id), so two people sharing a cruiser login are told apart.

create table public.hh_matches (
  id          uuid primary key default gen_random_uuid(),
  game        text not null default 'harbor_hunt',
  p1_user     uuid not null, p1_client uuid not null, p1_name text not null,
  p2_user     uuid not null, p2_client uuid not null, p2_name text not null,
  status      text not null default 'invited' check (status in ('invited', 'placing', 'playing', 'done', 'declined', 'cancelled')),
  p1_ready    boolean not null default false,
  p2_ready    boolean not null default false,
  turn        smallint check (turn in (1, 2)),
  winner      smallint check (winner in (1, 2)),
  shots       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index hh_matches_p1 on public.hh_matches (p1_user, status);
create index hh_matches_p2 on public.hh_matches (p2_user, status);

create table public.hh_boards (      -- hidden boats; read only through hh_my_board()
  match_id  uuid not null references public.hh_matches(id) on delete cascade,
  player    smallint not null check (player in (1, 2)),
  ships     jsonb not null,             -- [{ "type": "yacht", "cells": [0,1,2,3] }, ...]
  primary key (match_id, player)
);

create table public.hh_shots (
  id        bigint generated always as identity primary key,
  match_id  uuid not null references public.hh_matches(id) on delete cascade,
  player    smallint not null check (player in (1, 2)),   -- who fired
  cell      smallint not null check (cell between 0 and 63),
  result    text not null check (result in ('miss', 'hit', 'sunk')),
  sunk_type text,
  created_at timestamptz not null default now(),
  unique (match_id, player, cell)
);

alter table public.hh_matches enable row level security;
alter table public.hh_boards enable row level security;
alter table public.hh_shots enable row level security;
create policy hh_matches_read on public.hh_matches for select to authenticated
  using (p1_user = (select auth.uid()) or p2_user = (select auth.uid()));
create policy hh_shots_read on public.hh_shots for select to authenticated
  using (exists (select 1 from public.hh_matches g where g.id = match_id
                 and (g.p1_user = (select auth.uid()) or g.p2_user = (select auth.uid()))));
grant select on public.hh_matches, public.hh_shots to authenticated;
alter publication supabase_realtime add table public.hh_matches, public.hh_shots;

-- Chat lines from the game (e.g. who won) are shown as notes, not as someone's message.
-- They use member_class 'game'.

-- Which player (1 or 2) the caller is in a match, or null.
create or replace function public.hh_seat(g public.hh_matches, p_client uuid)
returns smallint language sql stable set search_path = ''
as $$
  select case when g.p1_user = auth.uid() and g.p1_client = p_client then 1::smallint
              when g.p2_user = auth.uid() and g.p2_client = p_client then 2::smallint end
$$;

-- People in the chat right now that you could challenge (not your own window), and whether they're already in a game.
create or replace function public.hh_players(p_client uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when not public.is_member() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('client', p.client_id, 'name', p.name,
             'busy', exists (select 1 from public.hh_matches g
                             where g.status in ('invited', 'placing', 'playing') and g.updated_at > now() - interval '30 minutes'
                               and (g.p1_client = p.client_id or g.p2_client = p.client_id))) order by p.name)
    from public.chat_presence p
    where p.seen_at > now() - interval '75 seconds' and p.client_id <> p_client), '[]'::jsonb) end
$$;

create or replace function public.hh_challenge(p_client uuid, p_target uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid(); mine public.chat_presence; them public.chat_presence; id uuid;
begin
  select * into mine from public.chat_presence where client_id = p_client and user_id = uid and seen_at > now() - interval '3 minutes';
  if mine.client_id is null then raise exception 'Please open Marina Chat to play.' using errcode = 'P0001'; end if;
  select * into them from public.chat_presence where client_id = p_target and seen_at > now() - interval '75 seconds';
  if them.client_id is null then raise exception 'That person has left the chat.' using errcode = 'P0001'; end if;
  if them.client_id = mine.client_id then raise exception 'You can''t challenge yourself.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.hh_matches g where g.status in ('invited', 'placing', 'playing')
               and g.updated_at > now() - interval '30 minutes'
               and (g.p1_client in (p_client, p_target) or g.p2_client in (p_client, p_target))) then
    raise exception 'One of you is already in a game. Finish it first.' using errcode = 'P0001';
  end if;
  delete from public.hh_matches where updated_at < now() - interval '30 days';
  insert into public.hh_matches (p1_user, p1_client, p1_name, p2_user, p2_client, p2_name)
  values (uid, p_client, mine.name, them.user_id, them.client_id, them.name)
  returning hh_matches.id into id;
  return id;
end
$$;

create or replace function public.hh_respond(p_match uuid, p_client uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare g public.hh_matches;
begin
  select * into g from public.hh_matches where id = p_match for update;
  if g.id is null or public.hh_seat(g, p_client) is distinct from 2 then raise exception 'That challenge isn''t for you.' using errcode = 'P0001'; end if;
  if g.status <> 'invited' then raise exception 'That challenge is no longer open.' using errcode = 'P0001'; end if;
  if g.created_at < now() - interval '5 minutes' then
    update public.hh_matches set status = 'cancelled', updated_at = now() where id = p_match;
    raise exception 'That challenge has expired.' using errcode = 'P0001';
  end if;
  update public.hh_matches set status = case when p_accept then 'placing' else 'declined' end, updated_at = now() where id = p_match;
end
$$;

-- Hide your boats. Exactly: yacht 4, sailboat 3, trawler 3, skiff 2; straight lines, on the grid, not overlapping.
create or replace function public.hh_place(p_match uuid, p_client uuid, p_ships jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare g public.hh_matches; seat smallint; s jsonb; cells int[]; allc int[] := '{}'; need jsonb := '{"yacht":4,"sailboat":3,"trawler":3,"skiff":2}';
        seen text[] := '{}'; t text; n int; i int; c int; dr int; dc int; all_ready boolean;
begin
  select * into g from public.hh_matches where id = p_match for update;
  seat := public.hh_seat(g, p_client);
  if g.id is null or seat is null then raise exception 'You''re not in that game.' using errcode = 'P0001'; end if;
  if g.status <> 'placing' then raise exception 'Boats can''t be moved now.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_ships) <> 'array' or jsonb_array_length(p_ships) <> 4 then raise exception 'Please place all four boats.' using errcode = 'P0001'; end if;
  for s in select * from jsonb_array_elements(p_ships) loop
    t := s->>'type';
    if t is null or not (need ? t) or t = any (seen) then raise exception 'Please place each boat once.' using errcode = 'P0001'; end if;
    seen := seen || t;
    select array_agg(x::int order by x::int) into cells from jsonb_array_elements_text(s->'cells') x;
    n := (need->>t)::int;
    if cells is null or array_length(cells, 1) <> n then raise exception 'A boat is the wrong length.' using errcode = 'P0001'; end if;
    if exists (select 1 from unnest(cells) v where v < 0 or v > 63) then raise exception 'A boat is off the harbor.' using errcode = 'P0001'; end if;
    -- straight: all in one row with consecutive columns, or one column with consecutive rows
    dr := 0; dc := 0;
    for i in 2..n loop
      if cells[i] - cells[i-1] = 1 and cells[i] / 8 = cells[i-1] / 8 then dc := dc + 1;
      elsif cells[i] - cells[i-1] = 8 then dr := dr + 1;
      else raise exception 'Boats must be in a straight line.' using errcode = 'P0001'; end if;
    end loop;
    if dr > 0 and dc > 0 then raise exception 'Boats must be in a straight line.' using errcode = 'P0001'; end if;
    if allc && cells then raise exception 'Boats can''t overlap.' using errcode = 'P0001'; end if;
    allc := allc || cells;
  end loop;
  insert into public.hh_boards (match_id, player, ships) values (p_match, seat, p_ships)
  on conflict (match_id, player) do update set ships = excluded.ships;
  if seat = 1 then update public.hh_matches set p1_ready = true, updated_at = now() where id = p_match;
  else update public.hh_matches set p2_ready = true, updated_at = now() where id = p_match; end if;
  select p1_ready and p2_ready into all_ready from public.hh_matches where id = p_match;
  if all_ready then
    update public.hh_matches set status = 'playing', turn = (1 + floor(random() * 2))::smallint, updated_at = now() where id = p_match;
  end if;
end
$$;

-- Your own boats (only yours).
create or replace function public.hh_my_board(p_match uuid, p_client uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare g public.hh_matches; seat smallint;
begin
  select * into g from public.hh_matches where id = p_match;
  seat := public.hh_seat(g, p_client);
  if seat is null then return null; end if;
  return (select ships from public.hh_boards where match_id = p_match and player = seat);
end
$$;

-- Call a square on the other harbor. Turns alternate after every shot.
create or replace function public.hh_fire(p_match uuid, p_client uuid, p_cell integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare g public.hh_matches; seat smallint; other smallint; board jsonb; s jsonb; res text := 'miss'; sunk text; hitcells int[];
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
      end if;
    end if;
  end loop;
  insert into public.hh_shots (match_id, player, cell, result, sunk_type) values (p_match, seat, p_cell, res, sunk);
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
  return jsonb_build_object('result', res, 'sunk', sunk, 'won', won);
end
$$;

-- Leave a game: before play it's cancelled; during play the other player wins.
create or replace function public.hh_leave(p_match uuid, p_client uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare g public.hh_matches; seat smallint;
begin
  select * into g from public.hh_matches where id = p_match for update;
  seat := public.hh_seat(g, p_client);
  if g.id is null or seat is null then return; end if;
  if g.status in ('invited', 'placing') then
    update public.hh_matches set status = case when g.status = 'invited' and seat = 2 then 'declined' else 'cancelled' end, updated_at = now() where id = p_match;
  elsif g.status = 'playing' then
    update public.hh_matches set status = 'done', winner = 3 - seat, turn = null, updated_at = now() where id = p_match;
  end if;
end
$$;

revoke execute on function public.hh_seat(public.hh_matches, uuid), public.hh_players(uuid), public.hh_challenge(uuid, uuid),
  public.hh_respond(uuid, uuid, boolean), public.hh_place(uuid, uuid, jsonb), public.hh_my_board(uuid, uuid),
  public.hh_fire(uuid, uuid, integer), public.hh_leave(uuid, uuid) from public, anon;
grant execute on function public.hh_players(uuid), public.hh_challenge(uuid, uuid),
  public.hh_respond(uuid, uuid, boolean), public.hh_place(uuid, uuid, jsonb), public.hh_my_board(uuid, uuid),
  public.hh_fire(uuid, uuid, integer), public.hh_leave(uuid, uuid) to authenticated;
