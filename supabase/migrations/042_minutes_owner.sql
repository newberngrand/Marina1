-- The board member who writes a set of minutes owns them: only they edit them, delete them and
-- mark each suggestion as changed or not. Everyone else on the board reads them, suggests changes
-- and approves. created_by holds the owner's board slip.

create or replace function public.minutes_owner_ok(p_created_by text)
returns boolean language sql stable security definer set search_path = ''
as $$ select p_created_by is null or p_created_by = public.my_board_slip() $$;

drop policy if exists drafts_board_delete on public.minutes_drafts;
create policy drafts_board_delete on public.minutes_drafts for delete to authenticated
  using ((select public.is_board()) and status in ('draft', 'returned') and public.minutes_owner_ok(created_by));

create or replace function public.minutes_owner_name(p_slip text)
returns text language sql stable security definer set search_path = ''
as $$ select coalesce((select coalesce(nullif(trim(m.board_name), ''), trim(split_part(m.owner_name, ',', 1))) from public.members m where m.slip = p_slip), 'slip ' || p_slip) $$;

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
  if not public.minutes_owner_ok(d.created_by) then
    return jsonb_build_object('editable', false, 'reason', 'owner', 'owner', d.created_by, 'owner_name', public.minutes_owner_name(d.created_by));
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
  if not public.minutes_owner_ok(d.created_by) then
    raise exception 'Only % (who wrote these minutes) can edit them. You can suggest a change on the Board page.', public.minutes_owner_name(d.created_by) using errcode = 'P0001';
  end if;
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

create or replace function public.draft_submit(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare d public.minutes_drafts;
begin
  if not public.is_board() then raise exception 'Only board members submit minutes.' using errcode = 'P0001'; end if;
  select * into d from public.minutes_drafts where id = p_id for update;
  if d.id is null or d.status not in ('draft', 'returned') then raise exception 'That draft could not be submitted.' using errcode = 'P0001'; end if;
  if not public.minutes_owner_ok(d.created_by) then
    raise exception 'Only % (who wrote these minutes) can submit them.', public.minutes_owner_name(d.created_by) using errcode = 'P0001';
  end if;
  update public.minutes_drafts
     set status = 'submitted', submitted_at = now(), submitted_by = coalesce(public.my_board_slip(), public.my_slip()),
         locked_by = null, locked_at = null, return_note = null, returned_by = null, updated_at = now()
   where id = p_id;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label)
  values (auth.uid(), public.my_slip(), true, 'minutes_submitted', 'minutes', d.id::text, d.title);
end
$$;

-- Only the owner marks a suggestion as changed (made) or not changed (not_made); logged.
create or replace function public.minutes_suggestion_set(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.minutes_suggestions; r public.minutes_drafts;
begin
  if not public.is_board() then raise exception 'Only board members can do this.' using errcode = 'P0001'; end if;
  if p_status not in ('open', 'made', 'not_made') then raise exception 'Unknown status.' using errcode = 'P0001'; end if;
  select * into s from public.minutes_suggestions where id = p_id;
  if s.id is null then raise exception 'That suggestion no longer exists.' using errcode = 'P0001'; end if;
  select * into r from public.minutes_drafts where id = s.draft_id;
  if not public.minutes_owner_ok(r.created_by) then
    raise exception 'Only % (who wrote these minutes) can mark suggestions.', public.minutes_owner_name(r.created_by) using errcode = 'P0001';
  end if;
  update public.minutes_suggestions
     set status = p_status,
         resolved_by = case when p_status = 'open' then null else coalesce(public.my_board_slip(), public.my_slip()) end,
         resolved_at = case when p_status = 'open' then null else now() end
   where id = p_id;
  insert into public.activity_log (user_id, slip, is_member, action, target_type, target_id, target_label, details)
  values (auth.uid(), public.my_slip(), true, 'minutes_suggestion_' || p_status, 'minutes', r.id::text, r.title, jsonb_build_object('suggestion', left(s.body, 200), 'from', s.slip));
end
$$;

-- The review list also says who owns each set of minutes, and whether that's the viewer.
drop function if exists public.minutes_review_list();
create function public.minutes_review_list()
returns table (id uuid, title text, meeting_date date, html text, submitted_at timestamptz, submitted_by text,
               updated_at timestamptz, updated_by text, board_size int, approved_count int, approvals jsonb,
               suggestions jsonb, my_viewed_at timestamptz, my_approved_at timestamptz, my_approved_html text,
               owner text, owner_name text, is_owner boolean)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.title, r.meeting_date, r.html, r.submitted_at, r.submitted_by, r.updated_at, r.updated_by,
         (select count(*)::int from public.members b where b.is_board and b.active),
         (select count(*)::int from public.minutes_approvals a join public.members b on b.slip = a.slip
           where a.draft_id = r.id and a.approved_at is not null and b.is_board and b.active),
         coalesce((select jsonb_agg(jsonb_build_object('slip', b.slip, 'name', public.minutes_owner_name(b.slip),
                      'at', a.approved_at, 'changed', a.approved_html is distinct from r.html) order by a.approved_at)
           from public.minutes_approvals a join public.members b on b.slip = a.slip
           where a.draft_id = r.id and a.approved_at is not null and b.is_board and b.active), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'slip', s.slip, 'name', public.minutes_owner_name(s.slip),
                      'body', s.body, 'with_approval', s.with_approval, 'status', s.status,
                      'resolved_by', s.resolved_by, 'resolved_at', s.resolved_at, 'at', s.created_at) order by s.created_at)
           from public.minutes_suggestions s where s.draft_id = r.id), '[]'::jsonb),
         (select a.viewed_at from public.minutes_approvals a where a.draft_id = r.id and a.slip = public.my_board_slip()),
         (select a.approved_at from public.minutes_approvals a where a.draft_id = r.id and a.slip = public.my_board_slip()),
         (select a.approved_html from public.minutes_approvals a where a.draft_id = r.id and a.slip = public.my_board_slip()),
         r.created_by, case when r.created_by is null then null else public.minutes_owner_name(r.created_by) end,
         public.minutes_owner_ok(r.created_by)
  from public.minutes_drafts r
  where public.is_board() and r.status = 'submitted' and r.document_id is null
  order by r.meeting_date desc, r.submitted_at desc
$$;

revoke execute on function public.minutes_owner_ok(text), public.minutes_owner_name(text), public.minutes_review_list() from public, anon;
grant execute on function public.minutes_owner_ok(text), public.minutes_owner_name(text), public.minutes_review_list() to authenticated;
