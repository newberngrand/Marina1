-- Member classes and who-can-see rules.
--   certificated = slip owners (everyone so far)
--   ltc          = long-term (live-aboard) cruisers / renters
--   stc          = short-term (transient) cruisers
--   employee     = marina staff (rules to come)
-- Events choose which classes can see them (default: owners only).
-- Marina Documents stay owners-only for now.

alter table public.members
  add column member_class text not null default 'certificated'
    check (member_class in ('certificated', 'ltc', 'stc', 'employee'));

alter table public.events
  add column audience text[] not null default '{certificated}',
  add constraint events_audience_valid check (
    cardinality(audience) >= 1 and audience <@ array['certificated', 'ltc', 'stc', 'employee']);

-- The signed-in account's class (null when not an active member).
create or replace function public.my_class()
returns text language sql stable security definer set search_path = ''
as $$ select m.member_class from public.members m where m.user_id = (select auth.uid()) and m.active $$;
revoke execute on function public.my_class() from anon, public;
grant execute on function public.my_class() to authenticated;

-- Can the signed-in account see this event? (admins: always)
create or replace function public.can_see_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1 from public.events e
    where e.id = p_event_id and e.active and public.my_class() = any (e.audience))
$$;
revoke execute on function public.can_see_event(uuid) from anon, public;
grant execute on function public.can_see_event(uuid) to authenticated;

-- Events: members see active events meant for their class.
drop policy events_member_read on public.events;
create policy events_member_read on public.events for select to authenticated using (
  (select public.is_admin()) or (active and (select public.my_class()) = any (audience))
);

-- Marina Documents: owners only (admins see all).
drop policy documents_member_read on public.documents;
create policy documents_member_read on public.documents for select to authenticated using (
  (select public.is_admin()) or (active and (select public.my_class()) = 'certificated')
);

-- Event attachments follow the event's visibility.
drop policy attachments_read on public.event_attachments;
create policy attachments_read on public.event_attachments for select to authenticated using (
  public.can_see_event(event_id)
);

-- Files: owners' library documents, or files attached to an event the member can see.
drop policy marina_docs_member_read on storage.objects;
create policy marina_docs_member_read on storage.objects for select to authenticated using (
  bucket_id = 'marina-docs' and (
    (select public.is_admin())
    or ((select public.my_class()) = 'certificated'
        and exists (select 1 from public.documents d where d.storage_path = storage.objects.name and d.active))
    or exists (select 1 from public.event_attachments a
               where a.storage_path = storage.objects.name and public.can_see_event(a.event_id))
  )
);

-- Sign-ups: only open to classes that can see the event.
create or replace function public.signup_open(p_event_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.active and e.signup_enabled
      and (e.signup_closes_at is null or now() < e.signup_closes_at)
      and (public.is_admin() or public.my_class() = any (e.audience))
  )
$$;
create or replace function public.signup_list(p_event_id uuid)
returns table (slip text, name text, answers text[], created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.slip, s.name, s.answers, s.created_at
  from public.event_signups s
  join public.events e on e.id = s.event_id
  where s.event_id = p_event_id
    and (public.is_admin() or (e.active and e.signup_enabled and e.signup_public and public.my_class() = any (e.audience)))
  order by s.created_at
$$;

-- An owner's linked slips (same email) stay within the same class.
create or replace function public.my_slips()
returns table (slip text, owner_name text, email text, is_login boolean, can_vote boolean)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select m.slip, lower(trim(m.email)) as em, m.is_admin, m.member_class
    from public.members m
    where m.user_id = (select auth.uid()) and m.active
  )
  select m.slip, m.owner_name, m.email, m.slip = me.slip, m.can_vote
  from public.members m, me
  where m.active and not m.is_admin and not me.is_admin and m.member_class = me.member_class
    and (m.slip = me.slip or (me.em is not null and me.em <> '' and lower(trim(m.email)) = me.em))
  order by m.slip <> me.slip, m.slip
$$;

-- Vote totals: members only for votes their class can see.
create or replace function public.vote_totals(p_event_id uuid)
returns table (choice text, votes bigint, eligible bigint, cast_total bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  e public.events;
begin
  select * into e from public.events where id = p_event_id;
  if e.id is null or e.event_type <> 'vote' then return; end if;
  if not public.is_admin() then
    if not public.is_member() or not e.active or not (public.my_class() = any (e.audience)) then return; end if;
    if e.results_visibility = 'admins_only' then return; end if;
    if e.results_visibility = 'after_close' and now() < e.vote_closes_at then return; end if;
  end if;
  return query
    select c.choice,
           (select count(*) from public.votes v where v.event_id = e.id and v.choice = c.choice),
           (select count(*) from public.members m
             where m.active and not m.is_admin and m.can_vote and m.member_class = any (e.audience)
               and not exists (select 1 from public.vote_exclusions x where x.event_id = e.id and x.slip = m.slip)),
           (select count(*) from public.votes v where v.event_id = e.id)
    from unnest(public.ballot_choices(e)) with ordinality as c(choice, ord)
    order by c.ord;
end
$$;

-- cast_vote: the login's class must be in the ballot's audience (rest unchanged from 007).
--   ... if e.id is null or e.event_type <> 'vote' or not e.active or not (m.member_class = any (e.audience)) then
--         raise exception 'This ballot is not available.'
-- vote_totals_internal: eligible slips also limited to classes in the ballot's audience.

-- Email Members can target the new classes.
alter table public.announcements drop constraint announcements_audience_check;
alter table public.announcements add constraint announcements_audience_check
  check (audience in ('all', 'voting', 'docks', 'slips', 'ltc', 'stc', 'employee'));

-- Shared logins (LTC / STC / staff) are used by many people, so they may add
-- several sign-ups but can't read, change or cancel them (no one sees another
-- cruiser's email or phone). Slip owners keep one sign-up per slip.
alter table public.event_signups drop constraint event_signups_event_id_slip_key;
create unique index event_signups_one_per_name on public.event_signups (event_id, slip, lower(name));
create or replace function public.signup_one_per_owner_slip()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.members m where m.slip = new.slip and m.member_class = 'certificated')
     and exists (select 1 from public.event_signups s where s.event_id = new.event_id and s.slip = new.slip and s.id <> new.id) then
    raise exception 'Slip % is already signed up for this event.', new.slip using errcode = '23505';
  end if;
  return new;
end
$$;
create trigger event_signups_owner_once before insert or update on public.event_signups
  for each row execute function public.signup_one_per_owner_slip();
drop policy signups_read on public.event_signups;
create policy signups_read on public.event_signups for select to authenticated using (
  (select public.is_admin()) or (slip = (select public.my_slip()) and (select public.my_class()) = 'certificated'));
drop policy signups_update on public.event_signups;
create policy signups_update on public.event_signups for update to authenticated
  using ((select public.is_admin()) or (slip = (select public.my_slip()) and (select public.my_class()) = 'certificated' and public.signup_open(event_id)))
  with check ((select public.is_admin()) or (slip = (select public.my_slip()) and (select public.my_class()) = 'certificated' and public.signup_open(event_id)));
drop policy signups_delete on public.event_signups;
create policy signups_delete on public.event_signups for delete to authenticated using (
  (select public.is_admin()) or (slip = (select public.my_slip()) and (select public.my_class()) = 'certificated' and public.signup_open(event_id)));
