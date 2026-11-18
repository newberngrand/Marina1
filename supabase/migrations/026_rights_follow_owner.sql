-- Admin and board rights follow the owner, not one slip: an owner whose slips share an
-- email (e.g. one person with ten slips) has the rights on whichever slip they log in with.
-- Board reviews are still recorded against the slip marked Board, so each board member
-- counts once no matter which slip they use.

-- Admin rights for a given login (used by is_admin() and by the server functions).
create or replace function public.admin_by_uid(p_uid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members me
    where me.user_id = p_uid and me.active
      and (me.is_admin or me.admin_rights
           or (me.member_class = 'certificated' and nullif(trim(me.email), '') is not null and exists (
                 select 1 from public.members m
                 where m.active and m.admin_rights and m.member_class = 'certificated'
                   and lower(trim(m.email)) = lower(trim(me.email)))))
  )
$$;
revoke execute on function public.admin_by_uid(uuid) from public, anon, authenticated;
grant execute on function public.admin_by_uid(uuid) to service_role;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.admin_by_uid((select auth.uid())) $$;

-- The board slip for this login: its own slip if marked Board, else the owner's slip that is.
create or replace function public.my_board_slip()
returns text language sql stable security definer set search_path = ''
as $$
  select m.slip
  from public.members me
  join public.members m on m.active and m.is_board
       and (m.slip = me.slip or (me.member_class = 'certificated' and nullif(trim(me.email), '') is not null
                                 and lower(trim(m.email)) = lower(trim(me.email))))
  where me.user_id = (select auth.uid()) and me.active
  order by (m.slip = me.slip) desc, m.slip
  limit 1
$$;
revoke execute on function public.my_board_slip() from public, anon;
grant execute on function public.my_board_slip() to authenticated;

create or replace function public.is_board()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.my_board_slip() is not null $$;

create or replace function public.board_status()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'is_board', public.is_board(),
    'board_slip', public.my_board_slip(),
    'pending', case when public.is_board() then (
      select count(*) from public.documents d
      where d.approval_status = 'pending'
        and not exists (select 1 from public.document_approvals a
                        where a.document_id = d.id and a.slip = public.my_board_slip() and a.approved_at is not null)) else 0 end)
$$;

create or replace function public.minutes_for_review()
returns table (id uuid, title text, description text, doc_date date, storage_path text, file_name text,
               created_at timestamptz, submitted_by text, board_size int, approved_count int,
               approved_by jsonb, my_viewed_at timestamptz, my_approved_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.title, d.description, d.doc_date, d.storage_path, d.file_name, d.created_at, d.submitted_by,
         (select count(*)::int from public.members b where b.is_board and b.active),
         (select count(*)::int from public.document_approvals a join public.members b on b.slip = a.slip
           where a.document_id = d.id and a.approved_at is not null and b.is_board and b.active),
         coalesce((select jsonb_agg(jsonb_build_object('slip', b.slip, 'name', b.owner_name, 'at', a.approved_at) order by a.approved_at)
           from public.document_approvals a join public.members b on b.slip = a.slip
           where a.document_id = d.id and a.approved_at is not null and b.is_board and b.active), '[]'::jsonb),
         (select a.viewed_at from public.document_approvals a where a.document_id = d.id and a.slip = public.my_board_slip()),
         (select a.approved_at from public.document_approvals a where a.document_id = d.id and a.slip = public.my_board_slip())
  from public.documents d
  where public.is_board() and d.approval_status = 'pending'
  order by d.doc_date desc nulls last, d.created_at desc
$$;

create or replace function public.minutes_viewed(p_document_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare me text := public.my_board_slip();
begin
  if me is null then raise exception 'Only board members review minutes.' using errcode = 'P0001'; end if;
  insert into public.document_approvals (document_id, slip, viewed_at)
  values (p_document_id, me, now())
  on conflict (document_id, slip) do update set viewed_at = coalesce(public.document_approvals.viewed_at, excluded.viewed_at);
end
$$;

create or replace function public.minutes_approve(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  me text := public.my_board_slip();
  d public.documents;
  size int; done int;
begin
  if me is null then raise exception 'Only board members approve minutes.' using errcode = 'P0001'; end if;
  select * into d from public.documents where id = p_document_id for update;
  if d.id is null or d.approval_status <> 'pending' then raise exception 'These minutes are not waiting for approval.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.document_approvals a where a.document_id = d.id and a.slip = me and a.viewed_at is not null) then
    raise exception 'Please open and read the minutes before approving them.' using errcode = 'P0001';
  end if;
  update public.document_approvals set approved_at = coalesce(approved_at, now()) where document_id = d.id and slip = me;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label)
  values (auth.uid(), public.my_slip(), true, 'minutes_approved', 'document', d.id::text, d.title);
  select count(*) into size from public.members b where b.is_board and b.active;
  select count(*) into done from public.document_approvals a join public.members b on b.slip = a.slip
   where a.document_id = d.id and a.approved_at is not null and b.is_board and b.active;
  if size > 0 and done >= size then
    perform set_config('app.publishing', 'on', true);
    update public.documents set approval_status = 'approved', published_at = now(), active = true where id = d.id;
    perform set_config('app.publishing', 'off', true);
    insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label)
    values (auth.uid(), public.my_slip(), true, 'minutes_published', 'document', d.id::text, d.title);
  end if;
  return jsonb_build_object('approved', done, 'board_size', size, 'published', size > 0 and done >= size);
end
$$;
