-- 5 Card Poker Run: game play.
-- Five game days (usually Mon-Fri). Each day a fresh deck of 239 cards (four full decks plus the
-- 2s through 8s and three 9s of a fifth deck) is dealt face down, one card under each slip on the map.
-- Each player picks one slip a day (two if they missed the day before); two missed days in a row
-- and they're out. On the last day, after the fifth card, they may trade up to 3 cards (4 if they
-- keep an Ace) by picking more slips. When the game ends, everyone's hand goes on the leaderboard.
-- Practice mode: an admin moves the game from day to day by hand and can add practice players.
-- All play goes through the functions below; players never see other hands until the game ends.

alter table public.events
  add column game_days          date[]  not null default '{}',
  add column game_practice      boolean not null default false,
  add column game_practice_day  integer not null default 1 check (game_practice_day between 1 and 5),
  add column game_practice_over boolean not null default false,
  add column game_finalized_at  timestamptz;
alter table public.events drop constraint game_needs_setup;
alter table public.events add constraint game_needs_setup check (
  event_type <> 'game' or (
    game_kind is not null and cardinality(game_players) >= 1 and cardinality(game_days) = 5
    and starts_at is not null and ends_at is not null and ends_at > starts_at));

-- The slips on the map (from images/marina-slip-map.svg).
create table public.game_slips (slip text primary key, sort integer not null);
insert into public.game_slips (slip, sort) values
('A0A',1),
('A2',2),
('A4',3),
('A6',4),
('A8',5),
('A10',6),
('A12',7),
('A14',8),
('A16',9),
('A18',10),
('A20',11),
('A22',12),
('A24',13),
('A26',14),
('A28',15),
('A30',16),
('A32',17),
('A34',18),
('A36',19),
('A38',20),
('A40',21),
('A42',22),
('A44',23),
('A46',24),
('A48',25),
('A1',26),
('A3',27),
('A5',28),
('A7',29),
('A9',30),
('A11',31),
('A13',32),
('A15',33),
('A17',34),
('A19',35),
('A21',36),
('A23',37),
('A25',38),
('A27',39),
('A29',40),
('A31',41),
('A33',42),
('A35',43),
('A37',44),
('A39',45),
('A41',46),
('A43',47),
('A45',48),
('A47',49),
('A49',50),
('A51',51),
('A53',52),
('A55',53),
('A57',54),
('A59',55),
('A61',56),
('A63',57),
('B0A',58),
('B2',59),
('B4',60),
('B6',61),
('B8',62),
('B10',63),
('B12',64),
('B14',65),
('B16',66),
('B18',67),
('B20',68),
('B22',69),
('B24',70),
('B26',71),
('B28',72),
('B30',73),
('B32',74),
('B34',75),
('B36',76),
('B38',77),
('B40',78),
('B42',79),
('B44',80),
('B46',81),
('B48',82),
('B0B',83),
('B1',84),
('B3',85),
('B5',86),
('B7',87),
('B9',88),
('B11',89),
('B13',90),
('B15',91),
('B17',92),
('B19',93),
('B21',94),
('B23',95),
('B25',96),
('B27',97),
('B29',98),
('B31',99),
('B33',100),
('B35',101),
('B37',102),
('B39',103),
('B41',104),
('B43',105),
('B45',106),
('B47',107),
('B49',108),
('B51',109),
('B53',110),
('B55',111),
('B50',112),
('B57',113),
('C0A',114),
('C2',115),
('C4',116),
('C6',117),
('C8',118),
('C10',119),
('C12',120),
('C14',121),
('C16',122),
('C18',123),
('C20',124),
('C22',125),
('C24',126),
('C26',127),
('C28',128),
('C30',129),
('C32',130),
('C34',131),
('C36',132),
('C38',133),
('C40',134),
('C42',135),
('C44',136),
('C0B',137),
('C1',138),
('C3',139),
('C5',140),
('C7',141),
('C9',142),
('C11',143),
('C13',144),
('C15',145),
('C17',146),
('C19',147),
('C21',148),
('C23',149),
('C25',150),
('C27',151),
('C29',152),
('C31',153),
('C33',154),
('C35',155),
('C37',156),
('C39',157),
('C41',158),
('C43',159),
('C46',160),
('C45',161),
('D0A',162),
('D0C',163),
('D10',164),
('D12',165),
('D14',166),
('D16',167),
('D18',168),
('D20',169),
('D22',170),
('D24',171),
('D26',172),
('D28',173),
('D30',174),
('D32',175),
('D0B',176),
('D1',177),
('D3',178),
('D5',179),
('D7',180),
('D9',181),
('D11',182),
('D13',183),
('D15',184),
('D17',185),
('D19',186),
('D21',187),
('D23',188),
('D25',189),
('D27',190),
('D29',191),
('E0C',192),
('E0A',193),
('E2',194),
('E4',195),
('E6',196),
('E8',197),
('E10',198),
('E12',199),
('E14',200),
('E16',201),
('E1',202),
('E0B',203),
('E3',204),
('E5',205),
('E7',206),
('E9',207),
('E11',208),
('E13',209),
('E15',210),
('F2',211),
('F4',212),
('F6',213),
('F8',214),
('F1',215),
('F3',216),
('F5',217),
('F0E',218),
('F0C',219),
('F0A',220),
('F0F',221),
('F0D',222),
('F0B',223),
('F0G',224),
('F7',225),
('F9',226),
('G2',227),
('G4',228),
('G6',229),
('G8',230),
('G10',231),
('G12',232),
('G14',233),
('G16',234),
('G18',235),
('G20',236),
('G22',237),
('Z1',238),
('Z2',239);

create table public.game_entries (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  player_key  text not null,               -- 'owner:<email or slip>' | 'email:<email>' (shared logins) | 'bot:<n>'
  name        text not null check (length(trim(name)) between 1 and 120),
  email       text,
  login_slip  text,
  user_id     uuid,
  is_bot      boolean not null default false,
  joined_day  integer not null default 1,  -- days before this count as missed
  decided     boolean not null default false,  -- made the last-day keep/trade choice
  draws_owed  integer not null default 0,
  finished_at timestamptz,
  out_day     integer,
  created_at  timestamptz not null default now(),
  unique (event_id, player_key)
);
create table public.game_boards (
  event_id  uuid not null references public.events (id) on delete cascade,
  day       integer not null,
  slip      text not null,
  card      text not null,
  entry_id  uuid references public.game_entries (id) on delete set null,
  picked_at timestamptz,
  primary key (event_id, day, slip)
);
create table public.game_cards (
  id        uuid primary key default gen_random_uuid(),
  entry_id  uuid not null references public.game_entries (id) on delete cascade,
  day       integer not null,
  slip      text,
  card      text not null,                 -- rank (2-9, T, J, Q, K, A) + suit (S, H, D, C)
  kind      text not null check (kind in ('pick', 'draw', 'auto')),
  discarded boolean not null default false,
  picked_at timestamptz not null default now()
);
create index game_cards_entry on public.game_cards (entry_id, picked_at);
create index game_entries_event on public.game_entries (event_id);

alter table public.game_slips enable row level security;
alter table public.game_entries enable row level security;
alter table public.game_boards enable row level security;
alter table public.game_cards enable row level security;
revoke all on public.game_slips, public.game_entries, public.game_boards, public.game_cards from anon, authenticated;

-- The 239-card deck.
create or replace function public.game_deck()
returns setof text language sql stable set search_path = '' as $$
  select r || s from unnest(array['2','3','4','5','6','7','8','9','T','J','Q','K','A']) r,
                     unnest(array['S','H','D','C']) s, generate_series(1, 4) g
  union all
  select r || s from unnest(array['2','3','4','5','6','7','8']) r, unnest(array['S','H','D','C']) s
  union all
  select unnest(array['9C','9D','9H'])
$$;

-- Where the game is: cur = today's game day (null if today isn't one), elapsed = game days started so far.
create or replace function public.game_clock(p_event uuid, out cur integer, out elapsed integer, out over boolean)
language plpgsql stable security definer set search_path = '' as $$
declare e public.events; today date := (now() at time zone 'America/New_York')::date;
begin
  select * into e from public.events where id = p_event;
  if e.game_practice then
    over := e.game_practice_over;
    elapsed := case when over then 5 else e.game_practice_day end;
    cur := case when over then null else e.game_practice_day end;
  else
    over := now() >= e.ends_at;
    select count(*) into elapsed from unnest(e.game_days) d where d <= today;
    cur := case when over then null else array_position(e.game_days, today) end;
    if over then elapsed := 5; end if;
  end if;
end $$;

-- The day a player was knocked out (second of two missed days in a row), looking at days 1..p_upto.
create or replace function public.game_out_day(p_entry uuid, p_joined integer, p_upto integer)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare k integer; m boolean; prev boolean := false;
begin
  for k in 1..coalesce(p_upto, 0) loop
    m := k < p_joined or not exists (
      select 1 from public.game_cards c where c.entry_id = p_entry and c.day = k and c.kind = 'pick');
    if m and prev then return k; end if;
    prev := m;
  end loop;
  return null;
end $$;

-- phase: waiting (before day 1) | rest (not a game day) | pick | picked (done for today)
--        | decide (last day: keep or trade) | drawing (picking trade cards) | done | out | over
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
  picks_left := greatest(0, least(ck.cur, 5) - picks);
  if picks_left > 0 then phase := 'pick';
  elsif ck.cur = 5 and picks >= 5 then
    phase := case when not en.decided then 'decide' when en.draws_owed > 0 then 'drawing' else 'done' end;
  else phase := 'picked';
  end if;
end $$;

-- Deal today's board (once).
create or replace function public.game_ensure_board(p_event uuid, p_day integer)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if exists (select 1 from public.game_boards where event_id = p_event and day = p_day) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event::text || ':' || p_day, 0));
  if exists (select 1 from public.game_boards where event_id = p_event and day = p_day) then return; end if;
  insert into public.game_boards (event_id, day, slip, card)
  select p_event, p_day, s.slip, d.card
  from (select slip, row_number() over (order by random()) n from public.game_slips) s
  join (select c as card, row_number() over (order by random()) n from public.game_deck() c) d using (n);
end $$;

create or replace function public.game_pick_for(p_entry uuid, p_slip text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare en public.game_entries; st record; ck record; v_card text; v_slip text := upper(trim(p_slip));
begin
  select * into en from public.game_entries where id = p_entry for update;
  select * into st from public.game_entry_status(p_entry);
  if st.phase not in ('pick', 'drawing') then
    raise exception '%', case st.phase
      when 'picked' then 'You''ve already picked today. Come back tomorrow!'
      when 'out' then 'You''re out of this game (two days missed in a row).'
      when 'over' then 'The game is over.'
      when 'decide' then 'Choose which cards to keep first.'
      when 'done' then 'Your hand is complete.'
      else 'There''s no pick today.' end;
  end if;
  select * into ck from public.game_clock(en.event_id);
  perform public.game_ensure_board(en.event_id, ck.cur);
  update public.game_boards b set entry_id = p_entry, picked_at = now()
   where b.event_id = en.event_id and b.day = ck.cur and b.slip = v_slip and b.entry_id is null
   returning b.card into v_card;
  if v_card is null then
    if exists (select 1 from public.game_slips where slip = v_slip) then
      raise exception 'Someone already picked that slip today. Choose another one.';
    end if;
    raise exception 'That isn''t a slip on the map.';
  end if;
  insert into public.game_cards (entry_id, day, slip, card, kind)
  values (p_entry, ck.cur, v_slip, v_card, case when st.phase = 'drawing' then 'draw' else 'pick' end);
  if st.phase = 'drawing' then
    update public.game_entries
       set draws_owed = draws_owed - 1, finished_at = case when draws_owed = 1 then now() else finished_at end
     where id = p_entry;
  end if;
  return v_card;
end $$;

create or replace function public.game_discard_for(p_entry uuid, p_cards uuid[])
returns void language plpgsql volatile security definer set search_path = '' as $$
declare st record; v uuid[] := coalesce(p_cards, '{}'); n integer := coalesce(cardinality(p_cards), 0); kept_ace boolean;
begin
  perform 1 from public.game_entries where id = p_entry for update;
  select * into st from public.game_entry_status(p_entry);
  if st.phase <> 'decide' then raise exception 'You can''t trade cards right now.'; end if;
  if n <> (select count(distinct x) from unnest(v) x)
     or n <> (select count(*) from public.game_cards c where c.entry_id = p_entry and not c.discarded and c.id = any (v)) then
    raise exception 'Those aren''t your cards.';
  end if;
  select exists (select 1 from public.game_cards c where c.entry_id = p_entry and not c.discarded
                 and left(c.card, 1) = 'A' and not (c.id = any (v))) into kept_ace;
  if n > 4 or (n = 4 and not kept_ace) then
    raise exception 'You can trade up to 3 cards, or 4 if you keep an Ace.';
  end if;
  update public.game_cards set discarded = true where id = any (v);
  update public.game_entries set decided = true, draws_owed = n,
         finished_at = case when n = 0 then now() else null end
   where id = p_entry;
end $$;

-- Practice players take their turn for today (they sometimes skip a day, to test catch-up and knock-outs).
create or replace function public.game_bots_play(p_event uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare b record; st record; s text; ids uuid[]; ck record;
begin
  select * into ck from public.game_clock(p_event);
  if ck.cur is null then return; end if;
  perform public.game_ensure_board(p_event, ck.cur);
  for b in select id from public.game_entries where event_id = p_event and is_bot order by created_at loop
    select * into st from public.game_entry_status(b.id);
    if st.phase = 'pick' and ck.cur < 5 and random() < 0.15 then continue; end if;
    loop
      select * into st from public.game_entry_status(b.id);
      exit when st.phase not in ('pick', 'decide', 'drawing');
      if st.phase = 'decide' then
        -- Trade the lowest unpaired cards (up to 3).
        select coalesce(array_agg(x.id), '{}') into ids from (
          select h.id from (
            select c.id, left(c.card, 1) r, count(*) over (partition by left(c.card, 1)) n
              from public.game_cards c where c.entry_id = b.id and not c.discarded) h
          where h.n = 1 order by position(h.r in '23456789TJQKA') limit 3) x;
        perform public.game_discard_for(b.id, ids);
      else
        select g.slip into s from public.game_boards g
         where g.event_id = p_event and g.day = ck.cur and g.entry_id is null order by random() limit 1;
        exit when s is null;
        perform public.game_pick_for(b.id, s);
      end if;
    end loop;
  end loop;
end $$;

-- After the game ends: knock-outs settled, short hands filled with random cards, finish times set.
create or replace function public.game_finalize(p_event uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare e public.events; en record; outd integer; h integer; i integer; last_at timestamptz;
begin
  select * into e from public.events where id = p_event for update;
  if e.game_finalized_at is not null then return; end if;
  for en in select * from public.game_entries where event_id = p_event loop
    outd := public.game_out_day(en.id, en.joined_day, 5);
    if outd is not null then
      update public.game_entries set out_day = outd where id = en.id;
      continue;
    end if;
    select count(*) into h from public.game_cards where entry_id = en.id and not discarded;
    select max(picked_at) into last_at from public.game_cards where entry_id = en.id;
    for i in 1..(5 - h) loop
      insert into public.game_cards (entry_id, day, card, kind)
      values (en.id, 5, (select c from public.game_deck() c order by random() limit 1), 'auto');
    end loop;
    update public.game_entries set draws_owed = 0,
           finished_at = case when h < 5 then (case when e.game_practice then now() else e.ends_at end)
                              else coalesce(finished_at, last_at) end
     where id = en.id;
  end loop;
  update public.events set game_finalized_at = now() where id = p_event;
end $$;

-- Who is playing from this login. Owners play as one entry per owner (slips sharing an email
-- play together); shared logins (cruisers, staff) play by the email each person types.
create or replace function public.game_identity(p_email text)
returns table (player_key text, shared boolean, name text, email text, slip text, cls text, admin boolean)
language plpgsql stable security definer set search_path = '' as $$
declare m public.members; v text := lower(trim(coalesce(p_email, '')));
begin
  select * into m from public.members where user_id = auth.uid() and active;
  if not found then return; end if;
  shared := not m.is_admin and m.member_class <> 'certificated';
  slip := m.slip; cls := m.member_class; admin := public.is_admin();
  if shared then
    if v ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then player_key := 'email:' || v; email := v; end if;
  else
    player_key := 'owner:' || coalesce(lower(nullif(trim(m.email), '')), m.slip);
    email := m.email;
    name := nullif(trim(m.owner_name), '');
  end if;
  return next;
end $$;

-- Everything the game screen needs. Only your own cards, until the game is over.
create or replace function public.game_state(p_event uuid, p_email text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare e public.events; ck record; me record; en public.game_entries; st record; can_play boolean; res jsonb;
begin
  if not public.can_see_event(p_event) then raise exception 'Game not found.'; end if;
  select * into e from public.events where id = p_event and event_type = 'game';
  if not found then raise exception 'Game not found.'; end if;
  select * into ck from public.game_clock(p_event);
  if ck.over and e.game_finalized_at is null then perform public.game_finalize(p_event); end if;
  select * into me from public.game_identity(p_email);
  can_play := coalesce(me.cls = any (e.game_players), false) or (e.game_practice and coalesce(me.admin, false));
  if me.player_key is not null then
    select * into en from public.game_entries where event_id = p_event and player_key = me.player_key;
  end if;
  res := jsonb_build_object(
    'day', ck.cur, 'elapsed', ck.elapsed, 'over', ck.over,
    'days', to_jsonb(e.game_days), 'ends_at', e.ends_at,
    'practice', e.game_practice, 'practice_day', e.game_practice_day,
    'shared', coalesce(me.shared, false),
    'need_email', coalesce(me.shared, false) and me.player_key is null,
    'is_admin', coalesce(me.admin, false),
    'can_play', can_play,
    'joined', en.id is not null,
    'join_open', can_play and en.id is null and not ck.over and (ck.elapsed < 2 or (ck.elapsed = 2 and ck.cur = 2)),
    'default_name', me.name,
    'players', (select count(*) from public.game_entries where event_id = p_event),
    'taken', case when ck.cur is null then '[]'::jsonb else coalesce((
      select jsonb_agg(b.slip) from public.game_boards b
       where b.event_id = p_event and b.day = ck.cur and b.entry_id is not null), '[]'::jsonb) end);
  if en.id is not null then
    select * into st from public.game_entry_status(en.id);
    res := res || jsonb_build_object('me', jsonb_build_object(
      'name', en.name, 'joined_day', en.joined_day, 'phase', st.phase, 'picks', st.picks,
      'picks_left', st.picks_left, 'out_day', st.out_day, 'draws_owed', en.draws_owed,
      'cards', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'day', c.day, 'slip', c.slip, 'card', c.card,
                 'kind', c.kind, 'discarded', c.discarded) order by c.picked_at)
               from public.game_cards c where c.entry_id = en.id), '[]'::jsonb)));
  end if;
  if ck.over then
    res := res || jsonb_build_object('leaderboard', coalesce((
      select jsonb_agg(jsonb_build_object('name', g.name, 'bot', g.is_bot, 'out_day', g.out_day,
               'finished_at', g.finished_at, 'mine', coalesce(g.id = en.id, false),
               'cards', coalesce((select jsonb_agg(c.card order by c.picked_at) from public.game_cards c
                                   where c.entry_id = g.id and not c.discarded), '[]'::jsonb)))
        from public.game_entries g where g.event_id = p_event), '[]'::jsonb));
  elsif coalesce(me.admin, false) then
    res := res || jsonb_build_object('roster', coalesce((
      select jsonb_agg(jsonb_build_object('name', g.name, 'bot', g.is_bot,
               'cards', (select count(*) from public.game_cards c where c.entry_id = g.id and not c.discarded))
               order by g.created_at)
        from public.game_entries g where g.event_id = p_event), '[]'::jsonb));
  end if;
  return res;
end $$;

create or replace function public.game_join(p_event uuid, p_name text default null, p_email text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare st jsonb; me record; ck record; nm text := nullif(trim(coalesce(p_name, '')), '');
begin
  st := public.game_state(p_event, p_email);
  if (st->>'need_email')::boolean then raise exception 'Please enter a valid email address.'; end if;
  if (st->>'joined')::boolean then return; end if;
  if not (st->>'can_play')::boolean then raise exception 'This game isn''t open to your group.'; end if;
  if not (st->>'join_open')::boolean then raise exception 'Sign-up for this game has closed.'; end if;
  select * into me from public.game_identity(p_email);
  if me.shared and nm is null then raise exception 'Please enter your name.'; end if;
  select * into ck from public.game_clock(p_event);
  insert into public.game_entries (event_id, player_key, name, email, login_slip, user_id, joined_day)
  values (p_event, me.player_key, left(coalesce(nm, me.name, 'Slip ' || me.slip), 120), me.email, me.slip, auth.uid(),
          case when ck.cur is not null then ck.cur else ck.elapsed + 1 end)
  on conflict (event_id, player_key) do nothing;
end $$;

create or replace function public.game_my_entry(p_event uuid, p_email text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare me record; eid uuid;
begin
  if not public.can_see_event(p_event) then raise exception 'Game not found.'; end if;
  select * into me from public.game_identity(p_email);
  select id into eid from public.game_entries where event_id = p_event and player_key = me.player_key;
  if eid is null then raise exception 'Join the game first.'; end if;
  return eid;
end $$;

create or replace function public.game_pick(p_event uuid, p_slip text, p_email text default null)
returns text language sql volatile security definer set search_path = '' as $$
  select public.game_pick_for(public.game_my_entry(p_event, p_email), p_slip)
$$;

create or replace function public.game_discard(p_event uuid, p_cards uuid[], p_email text default null)
returns void language sql volatile security definer set search_path = '' as $$
  select public.game_discard_for(public.game_my_entry(p_event, p_email), p_cards)
$$;

-- Practice controls (admins): next_day | end | reset | bots (add p_n practice players) | bots_play
create or replace function public.game_admin(p_event uuid, p_action text, p_n integer default 0)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare e public.events; i integer; k integer;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  select * into e from public.events where id = p_event and event_type = 'game' for update;
  if not found then raise exception 'Game not found.'; end if;
  if not e.game_practice then raise exception 'These controls only work in practice mode.'; end if;
  if p_action = 'reset' then
    delete from public.game_entries where event_id = p_event;
    delete from public.game_boards where event_id = p_event;
    update public.events set game_practice_day = 1, game_practice_over = false, game_finalized_at = null where id = p_event;
  elsif p_action = 'next_day' then
    if e.game_practice_over or e.game_practice_day >= 5 then raise exception 'This is the last day. Use End game.'; end if;
    perform public.game_bots_play(p_event);
    update public.events set game_practice_day = game_practice_day + 1 where id = p_event;
  elsif p_action = 'end' then
    if e.game_practice_over then return; end if;
    perform public.game_bots_play(p_event);
    update public.events set game_practice_over = true where id = p_event;
  elsif p_action = 'bots' then
    if e.game_practice_over or e.game_practice_day > 2 then raise exception 'Practice players can only join on day 1 or 2.'; end if;
    select count(*) into k from public.game_entries where event_id = p_event and is_bot;
    for i in 1..least(greatest(coalesce(p_n, 1), 1), 30) loop
      insert into public.game_entries (event_id, player_key, name, is_bot, joined_day)
      values (p_event, 'bot:' || (k + i), 'Practice Player ' || (k + i), true, e.game_practice_day);
    end loop;
  elsif p_action = 'bots_play' then
    perform public.game_bots_play(p_event);
  else
    raise exception 'Unknown action.';
  end if;
end $$;

revoke execute on function public.game_deck(), public.game_clock(uuid), public.game_out_day(uuid, integer, integer),
  public.game_entry_status(uuid), public.game_ensure_board(uuid, integer), public.game_pick_for(uuid, text),
  public.game_discard_for(uuid, uuid[]), public.game_bots_play(uuid), public.game_finalize(uuid),
  public.game_identity(text), public.game_my_entry(uuid, text) from public, anon, authenticated;
revoke execute on function public.game_state(uuid, text), public.game_join(uuid, text, text),
  public.game_pick(uuid, text, text), public.game_discard(uuid, uuid[], text), public.game_admin(uuid, text, integer)
  from public, anon;
grant execute on function public.game_state(uuid, text), public.game_join(uuid, text, text),
  public.game_pick(uuid, text, text), public.game_discard(uuid, uuid[], text), public.game_admin(uuid, text, integer)
  to authenticated;
