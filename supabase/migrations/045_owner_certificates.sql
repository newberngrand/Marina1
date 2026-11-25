-- Slip owners can see and upload the certificate picture for their own slips (from My Account).
-- They can only touch certificates/<their slip>/ in storage and their own slips' rows.
-- uploaded_by_owner tells admins the picture came from the owner, not the office.

alter table public.member_certificates add column if not exists uploaded_by_owner boolean not null default false;

-- Is this slip one of the logged-in slip owner's own slips (same login, or same email on file)?
create or replace function public.owns_slip(p_slip text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.my_class() = 'certificated'
     and exists (select 1 from public.my_slips() s where s.slip = upper(p_slip))
$$;
revoke execute on function public.owns_slip(text) from public, anon;
grant execute on function public.owns_slip(text) to authenticated;

drop policy if exists certificates_owner_read on public.member_certificates;
create policy certificates_owner_read on public.member_certificates for select to authenticated
  using (public.owns_slip(slip));

-- Owners save their upload through this function (it checks the slip and the file paths).
-- Returns the previous files so the page can remove them.
create or replace function public.owner_certificate_save(p_slip text, p_storage_path text, p_thumb_path text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare old public.member_certificates; s text := upper(trim(coalesce(p_slip, '')));
begin
  if not public.owns_slip(s) then raise exception 'You can only add a certificate for your own slip.' using errcode = 'P0001'; end if;
  if p_storage_path not like 'certificates/' || s || '/%' or p_thumb_path not like 'certificates/' || s || '/%' then
    raise exception 'Invalid file.' using errcode = 'P0001';
  end if;
  select * into old from public.member_certificates where slip = s;
  insert into public.member_certificates (slip, storage_path, thumb_path, uploaded_at, uploaded_by, uploaded_by_owner)
  values (s, p_storage_path, p_thumb_path, now(), public.my_slip(), true)
  on conflict (slip) do update set storage_path = excluded.storage_path, thumb_path = excluded.thumb_path,
    uploaded_at = excluded.uploaded_at, uploaded_by = excluded.uploaded_by, uploaded_by_owner = true;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label)
  values (auth.uid(), public.my_slip(), true, 'certificate_uploaded', 'slip', s, s);
  return case when old.slip is null then '{}'::jsonb
              else jsonb_build_object('storage_path', old.storage_path, 'thumb_path', old.thumb_path) end;
end
$$;
revoke execute on function public.owner_certificate_save(text, text, text) from public, anon;
grant execute on function public.owner_certificate_save(text, text, text) to authenticated;

-- Storage: owners read, add and remove files only in their own slips' certificate folders.
drop policy if exists certs_owner_read on storage.objects;
create policy certs_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'marina-docs' and (storage.foldername(name))[1] = 'certificates' and public.owns_slip((storage.foldername(name))[2]));
drop policy if exists certs_owner_insert on storage.objects;
create policy certs_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'marina-docs' and (storage.foldername(name))[1] = 'certificates' and public.owns_slip((storage.foldername(name))[2]));
drop policy if exists certs_owner_delete on storage.objects;
create policy certs_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'marina-docs' and (storage.foldername(name))[1] = 'certificates' and public.owns_slip((storage.foldername(name))[2]));
