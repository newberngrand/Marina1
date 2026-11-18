-- Writing minutes on the website: templates, private drafts (board only) with a one-editor-
-- at-a-time lock, and "needs changes" to send submitted minutes back to their draft.

create table if not exists public.minutes_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 120),
  html       text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.minutes_templates enable row level security;
drop policy if exists templates_board on public.minutes_templates;
create policy templates_board on public.minutes_templates for all to authenticated
  using ((select public.is_board()) or (select public.is_admin()))
  with check ((select public.is_board()) or (select public.is_admin()));
grant select, insert, update, delete on public.minutes_templates to authenticated;
drop trigger if exists minutes_templates_touch on public.minutes_templates;
create trigger minutes_templates_touch before update on public.minutes_templates
  for each row execute function public.touch_updated_at();

create table if not exists public.minutes_drafts (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(trim(title)) between 1 and 200),
  meeting_date  date not null,
  html          text not null default '',
  template_name text,
  status        text not null default 'draft' check (status in ('draft', 'submitted', 'returned')),
  locked_by     text,
  locked_at     timestamptz,
  document_id   uuid references public.documents (id) on delete set null,
  return_note   text,
  returned_by   text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_by    text,
  updated_at    timestamptz not null default now()
);
alter table public.minutes_drafts enable row level security;
-- Board members read drafts and start new ones; changes go through the functions below.
drop policy if exists drafts_board_read on public.minutes_drafts;
create policy drafts_board_read on public.minutes_drafts for select to authenticated using ((select public.is_board()));
drop policy if exists drafts_board_insert on public.minutes_drafts;
create policy drafts_board_insert on public.minutes_drafts for insert to authenticated with check ((select public.is_board()) and status = 'draft');
drop policy if exists drafts_board_delete on public.minutes_drafts;
create policy drafts_board_delete on public.minutes_drafts for delete to authenticated using ((select public.is_board()) and status <> 'submitted');
grant select, insert, delete on public.minutes_drafts to authenticated;
revoke update on public.minutes_drafts from authenticated;

-- Who is editing? A lock lasts 2 minutes without a save (the editor saves every few seconds).
create or replace function public.draft_open(p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare d public.minutes_drafts; me text := public.my_slip(); who text;
begin
  if not public.is_board() then raise exception 'Only board members write minutes.' using errcode = 'P0001'; end if;
  select * into d from public.minutes_drafts where id = p_id for update;
  if d.id is null then raise exception 'That draft no longer exists.' using errcode = 'P0001'; end if;
  if d.status = 'submitted' then
    return jsonb_build_object('editable', false, 'reason', 'submitted');
  end if;
  if d.locked_by is null or d.locked_by = me or d.locked_at < now() - interval '2 minutes' then
    update public.minutes_drafts set locked_by = me, locked_at = now() where id = p_id;
    return jsonb_build_object('editable', true);
  end if;
  select coalesce(owner_name, '') into who from public.members where slip = d.locked_by;
  return jsonb_build_object('editable', false, 'reason', 'locked', 'locked_by', d.locked_by, 'locked_name', who);
end
$$;

create or replace function public.draft_save(p_id uuid, p_title text, p_meeting_date date, p_html text)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare d public.minutes_drafts; me text := public.my_slip(); t timestamptz := now();
begin
  if not public.is_board() then raise exception 'Only board members write minutes.' using errcode = 'P0001'; end if;
  select * into d from public.minutes_drafts where id = p_id for update;
  if d.id is null then raise exception 'That draft no longer exists.' using errcode = 'P0001'; end if;
  if d.status = 'submitted' then raise exception 'These minutes were already submitted for approval.' using errcode = 'P0001'; end if;
  if d.locked_by is distinct from me and d.locked_at >= now() - interval '2 minutes' then
    raise exception 'Someone else is editing this draft right now.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_html, '')) > 2000000 then raise exception 'This draft is too large.' using errcode = 'P0001'; end if;
  update public.minutes_drafts
     set title = coalesce(nullif(trim(p_title), ''), title), meeting_date = coalesce(p_meeting_date, meeting_date),
         html = coalesce(p_html, html), locked_by = me, locked_at = t, updated_by = me, updated_at = t
   where id = p_id;
  return t;
end
$$;

create or replace function public.draft_release(p_id uuid)
returns void language sql security definer set search_path = ''
as $$ update public.minutes_drafts set locked_by = null, locked_at = null where id = p_id and locked_by = public.my_slip() $$;

-- After the PDF is uploaded and added to Documents (pending board approval).
create or replace function public.draft_submitted(p_id uuid, p_document_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_board() then raise exception 'Only board members submit minutes.' using errcode = 'P0001'; end if;
  update public.minutes_drafts
     set status = 'submitted', document_id = p_document_id, locked_by = null, locked_at = null,
         return_note = null, returned_by = null, updated_by = public.my_slip(), updated_at = now()
   where id = p_id and status <> 'submitted';
  if not found then raise exception 'That draft could not be submitted.' using errcode = 'P0001'; end if;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label)
  select auth.uid(), public.my_slip(), true, 'minutes_submitted', 'document', p_document_id::text, title from public.minutes_drafts where id = p_id;
end
$$;

-- "Needs changes": take submitted minutes out of review and back to their draft.
-- Returns the file path so the page can remove the PDF.
create or replace function public.minutes_return(p_document_id uuid, p_note text)
returns text language plpgsql security definer set search_path = ''
as $$
declare d public.documents; dr public.minutes_drafts;
begin
  if not public.is_board() then raise exception 'Only board members can send minutes back.' using errcode = 'P0001'; end if;
  select * into d from public.documents where id = p_document_id and approval_status = 'pending';
  if d.id is null then raise exception 'These minutes are not waiting for approval.' using errcode = 'P0001'; end if;
  select * into dr from public.minutes_drafts where document_id = d.id;
  if dr.id is null then raise exception 'These minutes were uploaded as a file, not written here. Upload a corrected file instead.' using errcode = 'P0001'; end if;
  update public.minutes_drafts
     set status = 'returned', document_id = null, return_note = left(nullif(trim(coalesce(p_note, '')), ''), 2000),
         returned_by = public.my_slip(), updated_at = now()
   where id = dr.id;
  delete from public.documents where id = d.id;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details)
  values (auth.uid(), public.my_slip(), true, 'minutes_returned', 'document', d.id::text, d.title, jsonb_build_object('note', p_note));
  return d.storage_path;
end
$$;

-- The review list also says which minutes were written here (and so can be sent back).
drop function if exists public.minutes_for_review();
create function public.minutes_for_review()
returns table (id uuid, title text, description text, doc_date date, storage_path text, file_name text,
               created_at timestamptz, submitted_by text, board_size int, approved_count int,
               approved_by jsonb, my_viewed_at timestamptz, my_approved_at timestamptz, draft_id uuid)
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
         (select a.approved_at from public.document_approvals a where a.document_id = d.id and a.slip = public.my_board_slip()),
         (select r.id from public.minutes_drafts r where r.document_id = d.id)
  from public.documents d
  where public.is_board() and d.approval_status = 'pending'
  order by d.doc_date desc nulls last, d.created_at desc
$$;

-- Board member names for filling in templates (vote tables).
create or replace function public.board_members()
returns table (slip text, owner_name text)
language sql stable security definer set search_path = ''
as $$ select m.slip, m.owner_name from public.members m where m.is_board and m.active and (public.is_board() or public.is_admin()) order by m.slip $$;

revoke execute on function public.draft_open(uuid), public.draft_save(uuid, text, date, text), public.draft_release(uuid),
  public.draft_submitted(uuid, uuid), public.minutes_return(uuid, text), public.minutes_for_review(), public.board_members() from public, anon;
grant execute on function public.draft_open(uuid), public.draft_save(uuid, text, date, text), public.draft_release(uuid),
  public.draft_submitted(uuid, uuid), public.minutes_return(uuid, text), public.minutes_for_review(), public.board_members() to authenticated;

-- (028) A short name for board documents (owner names on file are often legal ownership names).
alter table public.members add column if not exists board_name text check (board_name is null or length(board_name) <= 80);
drop function if exists public.board_members();
create function public.board_members()
returns table (slip text, name text)
language sql stable security definer set search_path = ''
as $$
  select m.slip, coalesce(nullif(trim(m.board_name), ''), trim(split_part(m.owner_name, ',', 1)))
  from public.members m
  where m.is_board and m.active and (public.is_board() or public.is_admin())
  order by m.slip
$$;
revoke execute on function public.board_members() from public, anon;
grant execute on function public.board_members() to authenticated;
