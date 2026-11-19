-- Game events (a kind of social event): which game, who can play, when it runs, and the prize.
--   game_kind    = which game (the list lives in member-data.js GAMES; add new ones to the check below)
--   game_players = member classes that can play (always a subset of who can see the event)
--   starts_at / ends_at = the dates the game is active (both required for a game)
--   game_prize   = prize text (optional)

alter table public.events drop constraint events_event_type_check;
alter table public.events add constraint events_event_type_check
  check (event_type in ('meeting','vote','notice','social','game','maintenance','other'));

alter table public.events
  add column game_kind    text check (game_kind in ('poker_run')),
  add column game_players text[] not null default '{}',
  add column game_prize   text not null default '' check (length(game_prize) <= 500),
  add constraint game_players_valid check (game_players <@ audience),
  add constraint game_needs_setup check (
    event_type <> 'game' or (
      game_kind is not null and cardinality(game_players) >= 1
      and starts_at is not null and ends_at is not null and ends_at > starts_at));
