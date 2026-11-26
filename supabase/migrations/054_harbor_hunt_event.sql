-- Harbor Hunt can be run as a Game event: members play one-on-one against the computer
-- (harbor-solo.html). Unlike the Poker Run it has no game days; it's playable from its
-- start time (or right away) until its end time (or until the event is turned off).
alter table public.events drop constraint if exists events_game_kind_check;
alter table public.events add constraint events_game_kind_check check (game_kind in ('poker_run', 'harbor_hunt'));

alter table public.events drop constraint if exists game_needs_setup;
alter table public.events add constraint game_needs_setup check (
  event_type <> 'game' or (
    game_kind is not null and cardinality(game_players) >= 1
    and (game_kind <> 'poker_run' or (cardinality(game_days) = 5 and starts_at is not null and ends_at is not null and ends_at > starts_at))
    and (starts_at is null or ends_at is null or ends_at > starts_at)
  )
);
