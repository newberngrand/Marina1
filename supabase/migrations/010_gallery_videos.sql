-- Gallery videos (YouTube mostly; also Vimeo, Instagram, TikTok, Facebook).
-- Videos stay on their own sites; we store the link and show it in an embedded player.

create table public.gallery_videos (
  id          uuid primary key default gen_random_uuid(),
  url         text not null,                 -- the link as pasted
  provider    text not null check (provider in ('youtube', 'vimeo', 'instagram', 'tiktok', 'facebook')),
  video_id    text not null,                 -- id/code used to build the embedded player
  title       text not null default '',
  description text not null default '',
  credit      text not null default '',      -- who made it (shown small)
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index gallery_videos_order on public.gallery_videos (sort_order, created_at);
create trigger gallery_videos_touch before update on public.gallery_videos
  for each row execute function public.touch_updated_at();

alter table public.gallery_videos enable row level security;
create policy videos_anon_read on public.gallery_videos for select to anon using (active);
create policy videos_auth_read on public.gallery_videos for select to authenticated using (active or (select public.is_admin()));
create policy videos_admin_insert on public.gallery_videos for insert to authenticated with check ((select public.is_admin()));
create policy videos_admin_update on public.gallery_videos for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy videos_admin_delete on public.gallery_videos for delete to authenticated using ((select public.is_admin()));
grant select on public.gallery_videos to anon;
grant select, insert, update, delete on public.gallery_videos to authenticated;

insert into public.gallery_videos (url, provider, video_id, title, credit, sort_order) values
  ('https://youtu.be/2Vp6CZNPgRY', 'youtube', '2Vp6CZNPgRY',
   'New Bern Grand Marina Yacht Club - View from Assisted Living - April 12, 2026', 'Capt Joe & DeDe Stramel', 10);

-- Log video changes like photo changes.
create or replace function public.log_video_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  who text;
  r public.gallery_videos;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if tg_op = 'UPDATE' and old.sort_order is distinct from new.sort_order
     and old.title = new.title and old.active = new.active and old.url = new.url and old.description = new.description then
    return null;
  end if;
  select m.slip into who from public.members m where m.user_id = uid;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details)
  values (uid, who, who is not null,
          'video_' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'updated' else 'deleted' end,
          'video', r.id::text, left(r.title, 200),
          jsonb_build_object('provider', r.provider) ||
          case when tg_op = 'UPDATE' and old.active is distinct from new.active then jsonb_build_object('visible', new.active) else '{}'::jsonb end);
  return null;
end
$$;
create trigger log_videos after insert or update or delete on public.gallery_videos
  for each row execute function public.log_video_change();

-- Allow the website to log when someone plays a video.
create or replace function public.log_event(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_label text default null,
  p_details jsonb default '{}'::jsonb,
  p_page text default null,
  p_visitor text default null,
  p_device text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.members;
  public_actions text[] := array['page_view', 'slip_search', 'reserve_click', 'login_failed', 'reset_requested', 'video_play'];
  member_actions text[] := array['login', 'logout', 'view_portal', 'view_event', 'open_document', 'view_results',
                                 'change_password', 'reset_password_done', 'view_admin'];
  d jsonb := coalesce(p_details, '{}'::jsonb);
begin
  if p_action is null or not (p_action = any (public_actions || member_actions)) then
    return;
  end if;
  if uid is not null then
    select * into m from public.members where user_id = uid;
  end if;
  if p_action = any (member_actions) and m.slip is null then
    return;
  end if;
  if length(d::text) > 2000 then d := '{}'::jsonb; end if;

  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details, page, visitor_id, device)
  values (
    uid,
    coalesce(m.slip, case when p_action = 'login_failed' then left(upper(p_target_id), 20) end),
    m.slip is not null,
    p_action,
    left(p_target_type, 40),
    left(p_target_id, 100),
    left(p_label, 200),
    d,
    left(p_page, 200),
    left(p_visitor, 64),
    case when p_device in ('mobile', 'desktop') then p_device end
  );
end
$$;
