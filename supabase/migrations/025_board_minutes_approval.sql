-- Board of Directors and minutes approval.
-- * members.is_board marks a slip owner as a board member; it always comes with admin rights.
-- * New meeting minutes start "pending": hidden from members until every current board
--   member has opened them and approved them, then they are published automatically.
-- * Replacing the file of a set of minutes sends it back for approval.

alter table public.members add column if not exists is_board boolean not null default false;
alter table public.members add constraint members_board_owner check (not is_board or member_class = 'certificated');

create or replace function public.board_implies_admin()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.is_board and not new.is_admin then new.admin_rights := true; end if;
  return new;
end
$$;
drop trigger if exists members_board_admin on public.members;
create trigger members_board_admin before insert or update on public.members
  for each row execute function public.board_implies_admin();

alter table public.documents add column if not exists approval_status text not null default 'approved'
  check (approval_status in ('pending', 'approved'));
alter table public.documents add column if not exists published_at timestamptz;
alter table public.documents add column if not exists submitted_by text;

-- New minutes wait for the board; a replaced minutes file needs approving again.
create or replace function public.minutes_need_approval()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.category = 'minutes' then
      new.approval_status := 'pending'; new.published_at := null;
      new.submitted_by := coalesce(new.submitted_by, public.my_slip());
    end if;
  elsif new.category = 'minutes' and (new.storage_path is distinct from old.storage_path or old.category <> 'minutes') then
    new.approval_status := 'pending'; new.published_at := null;
    delete from public.document_approvals where document_id = new.id;
  elsif new.approval_status is distinct from old.approval_status and not coalesce(current_setting('app.publishing', true), '') = 'on' then
    new.approval_status := old.approval_status;     -- only the approval process publishes
  end if;
  return new;
end
$$;

create table if not exists public.document_approvals (
  document_id uuid not null references public.documents (id) on delete cascade,
  slip        text not null references public.members (slip) on update cascade on delete cascade,
  viewed_at   timestamptz,
  approved_at timestamptz,
  primary key (document_id, slip)
);
alter table public.document_approvals enable row level security;
drop policy if exists approvals_admin_read on public.document_approvals;
create policy approvals_admin_read on public.document_approvals for select to authenticated using ((select public.is_admin()));
revoke insert, update, delete on public.document_approvals from anon, authenticated;
grant select on public.document_approvals to authenticated;

drop trigger if exists documents_minutes_approval on public.documents;
create trigger documents_minutes_approval before insert or update on public.documents
  for each row execute function public.minutes_need_approval();

-- Members (and the public) only ever see approved documents.
drop policy documents_member_read on public.documents;
create policy documents_member_read on public.documents for select to authenticated using (
  (select public.is_admin()) or (active and approval_status = 'approved' and (select public.my_class()) = 'certificated'));
drop policy documents_public_read on public.documents;
create policy documents_public_read on public.documents for select to anon, authenticated
  using (active and is_public and approval_status = 'approved');

drop policy marina_docs_member_read on storage.objects;
create policy marina_docs_member_read on storage.objects for select to authenticated using (
  bucket_id = 'marina-docs' and (
    (select public.is_admin())
    or ((select public.my_class()) = 'certificated'
        and exists (select 1 from public.documents d where d.storage_path = storage.objects.name and d.active and d.approval_status = 'approved'))
    or exists (select 1 from public.event_attachments a
               where a.storage_path = storage.objects.name and public.can_see_event(a.event_id))
  )
);
drop policy marina_docs_public_read on storage.objects;
create policy marina_docs_public_read on storage.objects for select to anon, authenticated using (
  bucket_id = 'marina-docs'
  and exists (select 1 from public.documents d
              where d.storage_path = storage.objects.name and d.active and d.is_public and d.approval_status = 'approved')
);

-- Helpers.
create or replace function public.is_board()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.members m where m.user_id = (select auth.uid()) and m.is_board and m.active) $$;

-- For the menu: is this login on the board, and how many minutes still need its approval?
create or replace function public.board_status()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'is_board', public.is_board(),
    'pending', case when public.is_board() then (
      select count(*) from public.documents d
      where d.approval_status = 'pending'
        and not exists (select 1 from public.document_approvals a
                        where a.document_id = d.id and a.slip = public.my_slip() and a.approved_at is not null)) else 0 end)
$$;

-- Minutes waiting for the board, with who has approved so far.
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
         (select a.viewed_at from public.document_approvals a where a.document_id = d.id and a.slip = public.my_slip()),
         (select a.approved_at from public.document_approvals a where a.document_id = d.id and a.slip = public.my_slip())
  from public.documents d
  where public.is_board() and d.approval_status = 'pending'
  order by d.doc_date desc nulls last, d.created_at desc
$$;

-- Opening the minutes is required before approving them.
create or replace function public.minutes_viewed(p_document_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_board() then raise exception 'Only board members review minutes.' using errcode = 'P0001'; end if;
  insert into public.document_approvals (document_id, slip, viewed_at)
  values (p_document_id, public.my_slip(), now())
  on conflict (document_id, slip) do update set viewed_at = coalesce(public.document_approvals.viewed_at, excluded.viewed_at);
end
$$;

-- Approve; when every current board member has approved, the minutes go live.
create or replace function public.minutes_approve(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  me text := public.my_slip();
  d public.documents;
  size int; done int;
begin
  if not public.is_board() then raise exception 'Only board members approve minutes.' using errcode = 'P0001'; end if;
  select * into d from public.documents where id = p_document_id for update;
  if d.id is null or d.approval_status <> 'pending' then raise exception 'These minutes are not waiting for approval.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.document_approvals a where a.document_id = d.id and a.slip = me and a.viewed_at is not null) then
    raise exception 'Please open and read the minutes before approving them.' using errcode = 'P0001';
  end if;
  update public.document_approvals set approved_at = coalesce(approved_at, now()) where document_id = d.id and slip = me;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label)
  values (auth.uid(), me, true, 'minutes_approved', 'document', d.id::text, d.title);
  select count(*) into size from public.members b where b.is_board and b.active;
  select count(*) into done from public.document_approvals a join public.members b on b.slip = a.slip
   where a.document_id = d.id and a.approved_at is not null and b.is_board and b.active;
  if size > 0 and done >= size then
    perform set_config('app.publishing', 'on', true);
    update public.documents set approval_status = 'approved', published_at = now(), active = true where id = d.id;
    perform set_config('app.publishing', 'off', true);
    insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label)
    values (auth.uid(), me, true, 'minutes_published', 'document', d.id::text, d.title);
  end if;
  return jsonb_build_object('approved', done, 'board_size', size, 'published', size > 0 and done >= size);
end
$$;

revoke execute on function public.is_board(), public.board_status(), public.minutes_for_review(),
  public.minutes_viewed(uuid), public.minutes_approve(uuid) from public, anon;
grant execute on function public.is_board(), public.board_status(), public.minutes_for_review(),
  public.minutes_viewed(uuid), public.minutes_approve(uuid) to authenticated;
