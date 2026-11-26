-- Members, long-term cruisers and transients who are logged in can send photos and videos
-- for the Gallery. Nothing is shown on the Gallery until an admin approves it on the
-- Gallery Review page (gallery-review.html). Uploads wait in a private storage bucket;
-- on approval the admin's browser copies the file to the public bucket and calls
-- gallery_submission_approve, which adds it to the Gallery.

create table public.gallery_submissions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  slip          text,
  member_class  text,
  kind          text not null check (kind in ('photo', 'video', 'video_link')),
  storage_path  text unique,                     -- in gallery-pending, for photo / video files
  file_name     text not null default '',
  mime          text not null default '',
  size_bytes    bigint,
  width         integer,
  height        integer,
  link_url      text,                            -- video_link: the link as pasted
  provider      text,                            -- video_link: youtube, vimeo, ...
  video_id      text,
  caption       text not null default '',
  credit        text not null default '',        -- who took it (shown small on the Gallery)
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text not null default '',
  published_id  uuid,                            -- the gallery_photos / gallery_videos row
  created_at    timestamptz not null default now(),
  constraint gallery_sub_file check (kind = 'video_link' or storage_path is not null),
  constraint gallery_sub_link check (kind <> 'video_link' or (link_url is not null and provider is not null and video_id is not null))
);
create index gallery_submissions_status on public.gallery_submissions (status, created_at);
create index gallery_submissions_user on public.gallery_submissions (user_id, created_at desc);

alter table public.gallery_submissions enable row level security;
-- People see their own uploads (to know what's waiting); admins see all. Writes go through the functions below.
create policy gallery_sub_read on public.gallery_submissions
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
grant select on public.gallery_submissions to authenticated;

-- Videos uploaded as files (not just links) can now be in the Gallery.
alter table public.gallery_videos add column if not exists storage_path text unique;
alter table public.gallery_videos drop constraint if exists gallery_videos_provider_check;
alter table public.gallery_videos add constraint gallery_videos_provider_check
  check (provider in ('youtube', 'vimeo', 'instagram', 'tiktok', 'facebook', 'file'));

-- Storage: uploads waiting for review (private), and approved video files (public).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('gallery-pending', 'gallery-pending', false, 52428800,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('gallery-videos', 'gallery-videos', true, 52428800, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

-- Logged-in members upload into their own folder (<user id>/...); admins read and remove.
create policy gallery_pending_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'gallery-pending' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_member()));
create policy gallery_pending_select on storage.objects
  for select to authenticated using (
    bucket_id = 'gallery-pending' and ((select public.is_admin()) or (storage.foldername(name))[1] = (select auth.uid())::text));
create policy gallery_pending_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'gallery-pending' and ((select public.is_admin()) or (storage.foldername(name))[1] = (select auth.uid())::text));
create policy gallery_videos_files_admin_select on storage.objects
  for select to authenticated using (bucket_id = 'gallery-videos' and (select public.is_admin()));
create policy gallery_videos_files_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'gallery-videos' and (select public.is_admin()));
create policy gallery_videos_files_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'gallery-videos' and (select public.is_admin()));

-- Send an upload (after the file is in gallery-pending) or a video link for review.
create or replace function public.gallery_submit(p_kind text, p_storage_path text, p_file_name text, p_mime text,
                                                 p_size bigint, p_width integer, p_height integer,
                                                 p_link_url text, p_provider text, p_video_id text,
                                                 p_caption text, p_credit text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid(); m public.members; id uuid;
begin
  select * into m from public.members x where x.user_id = uid and x.active;
  if uid is null or m.slip is null then
    raise exception 'Please log in to share photos and videos.' using errcode = 'P0001';
  end if;
  if p_kind not in ('photo', 'video', 'video_link') then raise exception 'Unknown upload type.' using errcode = 'P0001'; end if;
  if p_kind = 'video_link' then
    if p_provider is null or p_provider not in ('youtube', 'vimeo', 'instagram', 'tiktok', 'facebook')
       or nullif(trim(coalesce(p_video_id, '')), '') is null or coalesce(p_link_url, '') !~* '^https?://' then
      raise exception 'That video link isn''t one we can show.' using errcode = 'P0001';
    end if;
  else
    if coalesce(p_storage_path, '') !~ ('^' || uid::text || '/[\w.\-]+$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'gallery-pending' and o.name = p_storage_path) then
      raise exception 'The file didn''t finish uploading. Please try again.' using errcode = 'P0001';
    end if;
  end if;
  -- Shared logins are used by many people, so the limit is generous but stops a flood.
  if (select count(*) from public.gallery_submissions s where s.user_id = uid and s.created_at > now() - interval '1 day') >= 40 then
    raise exception 'Many items were sent from this login today. Please try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into public.gallery_submissions (user_id, slip, member_class, kind, storage_path, file_name, mime, size_bytes, width, height,
                                          link_url, provider, video_id, caption, credit)
  values (uid, m.slip, m.member_class, p_kind, case when p_kind <> 'video_link' then p_storage_path end,
          left(coalesce(p_file_name, ''), 200), left(coalesce(p_mime, ''), 60), p_size, p_width, p_height,
          case when p_kind = 'video_link' then left(p_link_url, 500) end,
          case when p_kind = 'video_link' then p_provider end,
          case when p_kind = 'video_link' then left(p_video_id, 500) end,
          left(trim(coalesce(p_caption, '')), 400), left(trim(coalesce(p_credit, '')), 120))
  returning gallery_submissions.id into id;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details)
  values (uid, m.slip, true, 'gallery_submitted', 'gallery_submission', id::text,
          left(coalesce(nullif(trim(p_caption), ''), p_file_name, p_link_url, ''), 200), jsonb_build_object('kind', p_kind));
  return id;
end
$$;

-- How many uploads are waiting (admins only; 0 for everyone else).
create or replace function public.gallery_pending_count()
returns integer language sql stable security definer set search_path = ''
as $$
  select case when public.is_admin() then (select count(*)::int from public.gallery_submissions where status = 'pending') else 0 end
$$;

-- Approve: puts it on the Gallery (at the end). For files, p_public_path is where the admin's
-- browser copied it: gallery/<path> for photos, gallery-videos/<path> for videos.
create or replace function public.gallery_submission_approve(p_id uuid, p_caption text, p_credit text, p_public_path text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare s public.gallery_submissions; pub uuid; base text := 'https://afejychfqezorwyqfcsh.supabase.co/storage/v1/object/public/';
        cap text := left(trim(coalesce(p_caption, '')), 400); cred text := left(trim(coalesce(p_credit, '')), 120); nxt int;
begin
  if not public.is_admin() then raise exception 'Only admins can approve uploads.' using errcode = 'P0001'; end if;
  select * into s from public.gallery_submissions where id = p_id for update;
  if s.id is null then raise exception 'That upload no longer exists.' using errcode = 'P0001'; end if;
  if s.status <> 'pending' then raise exception 'That upload was already reviewed.' using errcode = 'P0001'; end if;
  if s.kind = 'photo' then
    if coalesce(p_public_path, '') !~ '^[\w.\-/]+$'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'gallery' and o.name = p_public_path) then
      raise exception 'The photo wasn''t copied to the Gallery. Please try again.' using errcode = 'P0001';
    end if;
    select coalesce(max(sort_order), 0) + 10 into nxt from public.gallery_photos;
    insert into public.gallery_photos (src, storage_path, caption, sort_order, width, height, size_bytes)
    values (base || 'gallery/' || p_public_path, p_public_path,
            cap || case when cred <> '' then ' (Photo: ' || cred || ')' else '' end, nxt, s.width, s.height, s.size_bytes)
    returning id into pub;
  elsif s.kind = 'video' then
    if coalesce(p_public_path, '') !~ '^[\w.\-/]+$'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'gallery-videos' and o.name = p_public_path) then
      raise exception 'The video wasn''t copied to the Gallery. Please try again.' using errcode = 'P0001';
    end if;
    select coalesce(max(sort_order), 0) + 10 into nxt from public.gallery_videos;
    insert into public.gallery_videos (url, provider, video_id, title, credit, sort_order, storage_path)
    values (base || 'gallery-videos/' || p_public_path, 'file', p_public_path, cap, cred, nxt, p_public_path)
    returning id into pub;
  else
    select coalesce(max(sort_order), 0) + 10 into nxt from public.gallery_videos;
    insert into public.gallery_videos (url, provider, video_id, title, credit, sort_order)
    values (s.link_url, s.provider, s.video_id, cap, cred, nxt)
    returning id into pub;
  end if;
  update public.gallery_submissions set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         published_id = pub, caption = cap, credit = cred where id = p_id;
  return pub;
end
$$;

create or replace function public.gallery_submission_reject(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only admins can review uploads.' using errcode = 'P0001'; end if;
  update public.gallery_submissions set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = left(trim(coalesce(p_note, '')), 400)
   where id = p_id and status = 'pending';
  if not found then raise exception 'That upload was already reviewed.' using errcode = 'P0001'; end if;
end
$$;

revoke execute on function public.gallery_submit(text, text, text, text, bigint, integer, integer, text, text, text, text, text),
  public.gallery_pending_count(), public.gallery_submission_approve(uuid, text, text, text),
  public.gallery_submission_reject(uuid, text) from public, anon;
grant execute on function public.gallery_submit(text, text, text, text, bigint, integer, integer, text, text, text, text, text),
  public.gallery_pending_count(), public.gallery_submission_approve(uuid, text, text, text),
  public.gallery_submission_reject(uuid, text) to authenticated;
