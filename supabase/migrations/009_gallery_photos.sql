-- Gallery photos managed from the Admin page. Anyone can see active photos;
-- only admins can add, edit, reorder, hide or delete them.

create table public.gallery_photos (
  id            uuid primary key default gen_random_uuid(),
  src           text not null,              -- relative path (images/...) or public storage URL
  storage_path  text unique,                -- set for photos uploaded through the Admin page
  caption       text not null default '',   -- shown in the full-size viewer; also the image description
  sort_order    integer not null default 0,
  active        boolean not null default true,
  width         integer,
  height        integer,
  size_bytes    bigint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index gallery_photos_order on public.gallery_photos (sort_order, created_at);
create trigger gallery_photos_touch before update on public.gallery_photos
  for each row execute function public.touch_updated_at();

alter table public.gallery_photos enable row level security;
-- Visitors can't run is_admin(), so they get their own simpler rule.
create policy gallery_anon_read on public.gallery_photos
  for select to anon using (active);
create policy gallery_auth_read on public.gallery_photos
  for select to authenticated using (active or (select public.is_admin()));
create policy gallery_admin_insert on public.gallery_photos
  for insert to authenticated with check ((select public.is_admin()));
create policy gallery_admin_update on public.gallery_photos
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy gallery_admin_delete on public.gallery_photos
  for delete to authenticated using ((select public.is_admin()));
grant select on public.gallery_photos to anon;
grant select, insert, update, delete on public.gallery_photos to authenticated;

-- The photos already on the site, in their current order.
insert into public.gallery_photos (src, caption, sort_order) values
  ('images/marina-golden-hour.webp', 'Sailboats lining the docks at New Bern Grand Marina at golden hour, downtown New Bern in the background', 10),
  ('images/downtown-clock.webp', 'Historic clock on Craven Street in downtown New Bern near dusk', 20),
  ('images/confluence-aerial.jpg', 'Aerial view of downtown New Bern at the confluence of the Neuse and Trent Rivers', 30),
  ('images/downtown-sunset.jpeg', 'Dramatic sunset over the downtown New Bern clock tower and waterfront', 40),
  ('images/hero-marina-sky.jpg', 'Aerial view of New Bern Grand Marina docks under a clear blue sky', 50),
  ('images/union-point-sunset.jpg', 'Sunset over Union Point Park with boats anchored offshore', 60),
  ('images/dock-map.jpg', 'Map of New Bern Grand Marina showing Docks B, C, D, E, G, and Z', 70);

-- Public photo storage (anyone can view; admins upload/delete).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

-- Storage only deletes files the caller is allowed to list, so admins need this too.
create policy gallery_files_admin_select on storage.objects
  for select to authenticated using (bucket_id = 'gallery' and (select public.is_admin()));
create policy gallery_files_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'gallery' and (select public.is_admin()));
create policy gallery_files_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'gallery' and (select public.is_admin()));
create policy gallery_files_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'gallery' and (select public.is_admin()));

-- Log gallery changes in the activity log.
create or replace function public.log_gallery_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  who text;
  r public.gallery_photos;
  act text;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if tg_op = 'UPDATE' and old.sort_order is distinct from new.sort_order
     and old.caption = new.caption and old.active = new.active and old.src = new.src then
    return null;  -- reordering alone isn't worth a log line per photo
  end if;
  act := 'photo_' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'updated' else 'deleted' end;
  select m.slip into who from public.members m where m.user_id = uid;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details)
  values (uid, who, who is not null, act, 'photo', r.id::text, left(r.caption, 200),
          case when tg_op = 'UPDATE' and old.active is distinct from new.active then jsonb_build_object('visible', new.active) else '{}'::jsonb end);
  return null;
end
$$;
create trigger log_gallery after insert or update or delete on public.gallery_photos
  for each row execute function public.log_gallery_change();
