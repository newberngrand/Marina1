-- Reviewing minutes written on the website, without the back-and-forth.
-- * Submitting a draft puts it under board review. No PDF is made at that point.
-- * Board members read the minutes on the Board page. Each one can Approve (optionally with a
--   suggested change) or just Suggest a change.
-- * The draft stays editable while under review. Whoever edits it sees every suggestion and marks
--   each one Made or Not made. Edits never clear approvals; a member who approved an earlier
--   version is shown what changed since.
-- * After the last board member approves, the approving member's browser makes the PDF from the
--   minutes as they stand and minutes_publish() files it in Documents, published to members.
--   That is the only PDF made.
-- Minutes uploaded as a file still use the earlier document review (minutes_for_review / minutes_approve).

alter table public.minutes_drafts drop constraint if exists minutes_drafts_status_check;
alter table public.minutes_drafts add constraint minutes_drafts_status_check
  check (status in ('draft', 'submitted', 'returned', 'published'));
alter table public.minutes_drafts
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by text,
  add column if not exists published_at timestamptz;

drop policy if exists drafts_board_delete on public.minutes_drafts;
create policy drafts_board_delete on public.minutes_drafts for delete to authenticated
  using ((select public.is_board()) and status in ('draft', 'returned'));

-- Each board member's reading and approval of a draft under review. approved_html is the
-- version they approved, so later changes can be shown to them.
create table if not exists public.minutes_approvals (
  draft_id       uuid not null references public.minutes_drafts (id) on delete cascade,
  slip           text not null references public.members (slip) on update cascade on delete cascade,
  viewed_at      timestamptz,
  approved_at    timestamptz,
  approved_html  text,
  approved_title text,
  primary key (draft_id, slip)
);
alter table public.minutes_approvals enable row level security;
drop policy if exists mapprovals_board_read on public.minutes_approvals;
create policy mapprovals_board_read on public.minutes_approvals for select to authenticated using ((select public.is_board()));
revoke insert, update, delete on public.minutes_approvals from anon, authenticated;
grant select on public.minutes_approvals to authenticated;

create table if not exists public.minutes_suggestions (
  id            uuid primary key default gen_random_uuid(),
  draft_id      uuid not null references public.minutes_drafts (id) on delete cascade,
  slip          text not null,
  body          text not null check (length(trim(body)) between 1 and 4000),
  with_approval boolean not null default false,
  status        text not null default 'open' check (status in ('open', 'made', 'not_made')),
  resolved_by   text,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists minutes_suggestions_draft on public.minutes_suggestions (draft_id, created_at);
alter table public.minutes_suggestions enable row level security;
drop policy if exists msuggest_board_read on public.minutes_suggestions;
create policy msuggest_board_read on public.minutes_suggestions for select to authenticated using ((select public.is_board()));
revoke insert, update, delete on public.minutes_suggestions from anon, authenticated;
grant select on public.minutes_suggestions to authenticated;

-- The draft stays editable while under review; only published minutes are closed.
create or replace function public.draft_open(p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare d public.minutes_drafts; me text := public.my_slip(); who text;
begin
  if not public.is_board() then raise exception 'Only board members write minutes.' using errcode = 'P0001'; end if;
  select * into d from public.minutes_drafts where id = p_id for update;
  if d.id is null then raise exception 'That draft no longer exists.' using errcode = 'P0001'; end if;
  if d.status = 'published' or (d.status = 'submitted' and d.document_id is not null) then
    return jsonb_build_object('editable', false, 'reason', d.status);
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
  if d.status = 'published' then raise exception 'These minutes were approved and published, so they can no longer be changed.' using errcode = 'P0001'; end if;
  if d.status = 'submitted' and d.document_id is not null then raise exception 'These minutes are under the earlier file review and can''t be edited.' using errcode = 'P0001'; end if;
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

-- Put a draft under board review (no PDF yet).
create or replace function public.draft_submit(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare d public.minutes_drafts;
begin
  if not public.is_board() then raise exception 'Only board members submit minutes.' using errcode = 'P0001'; end if;
  select * into d from public.minutes_drafts where id = p_id for update;
  if d.id is null or d.status not in ('draft', 'returned') then raise exception 'That draft could not be submitted.' using errcode = 'P0001'; end if;
  update public.minutes_drafts
     set status = 'submitted', submitted_at = now(), submitted_by = coalesce(public.my_board_slip(), public.my_slip()),
         locked_by = null, locked_at = null, return_note = null, returned_by = null, updated_at = now()
   where id = p_id;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label)
  values (auth.uid(), public.my_slip(), true, 'minutes_submitted', 'minutes', d.id::text, d.title);
end
$$;

-- Everything the Board page and the editor need about minutes under review.
create or replace function public.minutes_review_list()
returns table (id uuid, title text, meeting_date date, html text, submitted_at timestamptz, submitted_by text,
               updated_at timestamptz, updated_by text, board_size int, approved_count int, approvals jsonb,
               suggestions jsonb, my_viewed_at timestamptz, my_approved_at timestamptz, my_approved_html text)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.title, r.meeting_date, r.html, r.submitted_at, r.submitted_by, r.updated_at, r.updated_by,
         (select count(*)::int from public.members b where b.is_board and b.active),
         (select count(*)::int from public.minutes_approvals a join public.members b on b.slip = a.slip
           where a.draft_id = r.id and a.approved_at is not null and b.is_board and b.active),
         coalesce((select jsonb_agg(jsonb_build_object('slip', b.slip,
                      'name', coalesce(nullif(trim(b.board_name), ''), trim(split_part(b.owner_name, ',', 1))),
                      'at', a.approved_at, 'changed', a.approved_html is distinct from r.html) order by a.approved_at)
           from public.minutes_approvals a join public.members b on b.slip = a.slip
           where a.draft_id = r.id and a.approved_at is not null and b.is_board and b.active), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'slip', s.slip,
                      'name', coalesce((select coalesce(nullif(trim(m.board_name), ''), trim(split_part(m.owner_name, ',', 1))) from public.members m where m.slip = s.slip), 'Slip ' || s.slip),
                      'body', s.body, 'with_approval', s.with_approval, 'status', s.status,
                      'resolved_by', s.resolved_by, 'resolved_at', s.resolved_at, 'at', s.created_at) order by s.created_at)
           from public.minutes_suggestions s where s.draft_id = r.id), '[]'::jsonb),
         (select a.viewed_at from public.minutes_approvals a where a.draft_id = r.id and a.slip = public.my_board_slip()),
         (select a.approved_at from public.minutes_approvals a where a.draft_id = r.id and a.slip = public.my_board_slip()),
         (select a.approved_html from public.minutes_approvals a where a.draft_id = r.id and a.slip = public.my_board_slip())
  from public.minutes_drafts r
  where public.is_board() and r.status = 'submitted' and r.document_id is null
  order by r.meeting_date desc, r.submitted_at desc
$$;

create or replace function public.minutes_read(p_draft_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare me text := public.my_board_slip();
begin
  if me is null then raise exception 'Only board members review minutes.' using errcode = 'P0001'; end if;
  insert into public.minutes_approvals (draft_id, slip, viewed_at) values (p_draft_id, me, now())
  on conflict (draft_id, slip) do update set viewed_at = coalesce(public.minutes_approvals.viewed_at, excluded.viewed_at);
end
$$;

-- Approve (again, after changes, to accept them). An optional suggested change goes with it.
create or replace function public.minutes_approve_draft(p_draft_id uuid, p_suggestion text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare me text := public.my_board_slip(); r public.minutes_drafts; size int; done int; sug text := nullif(trim(coalesce(p_suggestion, '')), '');
begin
  if me is null then raise exception 'Only board members approve minutes.' using errcode = 'P0001'; end if;
  select * into r from public.minutes_drafts where id = p_draft_id for update;
  if r.id is null or r.status <> 'submitted' or r.document_id is not null then raise exception 'These minutes are not waiting for approval.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.minutes_approvals a where a.draft_id = r.id and a.slip = me and a.viewed_at is not null) then
    raise exception 'Please read the minutes before approving them.' using errcode = 'P0001';
  end if;
  update public.minutes_approvals set approved_at = now(), approved_html = r.html, approved_title = r.title
   where draft_id = r.id and slip = me;
  if sug is not null then
    insert into public.minutes_suggestions (draft_id, slip, body, with_approval) values (r.id, me, left(sug, 4000), true);
  end if;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details)
  values (auth.uid(), public.my_slip(), true, 'minutes_approved', 'minutes', r.id::text, r.title, jsonb_build_object('suggestion', sug is not null));
  select count(*) into size from public.members b where b.is_board and b.active;
  select count(*) into done from public.minutes_approvals a join public.members b on b.slip = a.slip
   where a.draft_id = r.id and a.approved_at is not null and b.is_board and b.active;
  return jsonb_build_object('approved', done, 'board_size', size, 'ready', size > 0 and done >= size);
end
$$;

create or replace function public.minutes_suggest(p_draft_id uuid, p_body text)
returns void language plpgsql security definer set search_path = ''
as $$
declare me text := public.my_board_slip(); r public.minutes_drafts; b text := nullif(trim(coalesce(p_body, '')), '');
begin
  if me is null then raise exception 'Only board members suggest changes.' using errcode = 'P0001'; end if;
  if b is null then raise exception 'Please type the change you are suggesting.' using errcode = 'P0001'; end if;
  select * into r from public.minutes_drafts where id = p_draft_id;
  if r.id is null or r.status <> 'submitted' then raise exception 'These minutes are not under review.' using errcode = 'P0001'; end if;
  insert into public.minutes_suggestions (draft_id, slip, body) values (r.id, me, left(b, 4000));
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label)
  values (auth.uid(), public.my_slip(), true, 'minutes_suggested', 'minutes', r.id::text, r.title);
end
$$;

-- The person editing marks a suggestion Made, Not made, or back to open.
create or replace function public.minutes_suggestion_set(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_board() then raise exception 'Only board members can do this.' using errcode = 'P0001'; end if;
  if p_status not in ('open', 'made', 'not_made') then raise exception 'Unknown status.' using errcode = 'P0001'; end if;
  update public.minutes_suggestions
     set status = p_status,
         resolved_by = case when p_status = 'open' then null else coalesce(public.my_board_slip(), public.my_slip()) end,
         resolved_at = case when p_status = 'open' then null else now() end
   where id = p_id;
  if not found then raise exception 'That suggestion no longer exists.' using errcode = 'P0001'; end if;
end
$$;

-- Minutes can be filed as published only by this function, after every board member approved.
create or replace function public.minutes_need_approval()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.category = 'minutes' and not coalesce(current_setting('app.publishing', true), '') = 'on' then
      new.approval_status := 'pending'; new.published_at := null;
      new.submitted_by := coalesce(new.submitted_by, public.my_slip());
    end if;
  elsif new.category = 'minutes' and (new.storage_path is distinct from old.storage_path or old.category <> 'minutes') then
    new.approval_status := 'pending'; new.published_at := null;
    delete from public.document_approvals where document_id = new.id;
  elsif new.approval_status is distinct from old.approval_status and not coalesce(current_setting('app.publishing', true), '') = 'on' then
    new.approval_status := old.approval_status;
  end if;
  return new;
end
$$;

-- After the last approval: the PDF (already uploaded by the browser) is filed in Documents and
-- published to members, and the draft is closed. If it was already published, returns that one.
create or replace function public.minutes_publish(p_draft_id uuid, p_storage_path text, p_file_name text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r public.minutes_drafts; size int; done int; doc uuid;
begin
  if not public.is_board() then raise exception 'Only board members publish minutes.' using errcode = 'P0001'; end if;
  select * into r from public.minutes_drafts where id = p_draft_id for update;
  if r.id is null then raise exception 'Those minutes no longer exist.' using errcode = 'P0001'; end if;
  if r.status = 'published' then return jsonb_build_object('document_id', r.document_id, 'already', true); end if;
  if r.status <> 'submitted' or r.document_id is not null then raise exception 'These minutes are not waiting for approval.' using errcode = 'P0001'; end if;
  select count(*) into size from public.members b where b.is_board and b.active;
  select count(*) into done from public.minutes_approvals a join public.members b on b.slip = a.slip
   where a.draft_id = r.id and a.approved_at is not null and b.is_board and b.active;
  if size = 0 or done < size then raise exception 'Not every board member has approved these minutes yet.' using errcode = 'P0001'; end if;
  if p_storage_path is null or p_storage_path !~ '^minutes/[0-9]{4}/' then raise exception 'Invalid file.' using errcode = 'P0001'; end if;
  perform set_config('app.publishing', 'on', true);
  insert into public.documents (category, title, description, doc_date, storage_path, file_name, mime_type, size_bytes, active,
                                approval_status, published_at, submitted_by)
  values ('minutes', r.title, 'Approved by the Board of Directors', r.meeting_date, p_storage_path, coalesce(nullif(p_file_name, ''), 'Minutes.pdf'),
          'application/pdf', coalesce(p_size, 0), true, 'approved', now(), r.submitted_by)
  returning id into doc;
  perform set_config('app.publishing', 'off', true);
  update public.minutes_drafts set status = 'published', document_id = doc, published_at = now(), locked_by = null, locked_at = null where id = r.id;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label)
  values (auth.uid(), public.my_slip(), true, 'minutes_published', 'document', doc::text, r.title);
  return jsonb_build_object('document_id', doc, 'already', false);
end
$$;

-- Menu count: minutes (written here or uploaded) still waiting for this member's approval.
create or replace function public.board_status()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'is_board', public.is_board(),
    'board_slip', public.my_board_slip(),
    'pending', case when public.is_board() then (
      (select count(*) from public.documents d
        where d.approval_status = 'pending'
          and not exists (select 1 from public.document_approvals a
                          where a.document_id = d.id and a.slip = public.my_board_slip() and a.approved_at is not null))
      + (select count(*) from public.minutes_drafts r
          where r.status = 'submitted' and r.document_id is null
            and not exists (select 1 from public.minutes_approvals a
                            where a.draft_id = r.id and a.slip = public.my_board_slip() and a.approved_at is not null))) else 0 end)
$$;

revoke execute on function public.draft_submit(uuid), public.minutes_review_list(), public.minutes_read(uuid),
  public.minutes_approve_draft(uuid, text), public.minutes_suggest(uuid, text), public.minutes_suggestion_set(uuid, text),
  public.minutes_publish(uuid, text, text, bigint) from public, anon;
grant execute on function public.draft_submit(uuid), public.minutes_review_list(), public.minutes_read(uuid),
  public.minutes_approve_draft(uuid, text), public.minutes_suggest(uuid, text), public.minutes_suggestion_set(uuid, text),
  public.minutes_publish(uuid, text, text, bigint) to authenticated;
