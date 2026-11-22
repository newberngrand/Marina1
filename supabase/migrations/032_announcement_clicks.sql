-- Click tracking for member emails.
-- Each recipient's button links to newberngrand.com/go.html?t=<token>. That page
-- records the click and forwards to the event (or the member portal). When the
-- member reaches that page logged in, we record that too ("arrived").
-- Email security scanners often open every link before the person sees the email;
-- those clicks are kept but flagged so the counts can leave them out.

alter table public.announcements
  add column tracked       boolean not null default false,   -- sent with personal tracked links
  add column portal_button boolean not null default false;   -- button goes to the member portal (no event)
alter table public.announcements alter column tracked set default true;

alter table public.announcement_recipients
  add column token          uuid not null default gen_random_uuid(),
  add column clicks         integer not null default 0,      -- clicks that look like a person
  add column scanner_clicks integer not null default 0,      -- clicks that look like a security scanner
  add column first_click_at timestamptz,
  add column last_click_at  timestamptz,
  add column arrived_at     timestamptz,                     -- reached the page logged in
  add column arrived_slip   text;
create unique index announcement_recipients_token on public.announcement_recipients (token);

create table public.announcement_clicks (
  id              bigint generated always as identity primary key,
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  email           text not null,
  clicked_at      timestamptz not null default now(),
  user_agent      text not null default '',
  likely_scanner  boolean not null default false
);
create index announcement_clicks_by_announcement on public.announcement_clicks (announcement_id, clicked_at);
alter table public.announcement_clicks enable row level security;
create policy announcement_clicks_admin_read on public.announcement_clicks for select to authenticated using ((select public.is_admin()));
revoke all on public.announcement_clicks from anon, authenticated;
grant select on public.announcement_clicks to authenticated;

-- Called by go.html (no login needed; the token is a random id only that recipient has).
-- Records the click and returns where to send the visitor.
create or replace function public.announcement_click(p_token uuid, p_user_agent text default '', p_automated boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r public.announcement_recipients;
  a public.announcements;
  ua text := left(coalesce(p_user_agent, ''), 400);
  scanner boolean;
begin
  select * into r from public.announcement_recipients where token = p_token;
  if not found then return jsonb_build_object('dest', 'member-portal.html'); end if;
  select * into a from public.announcements where id = r.announcement_id;
  scanner := coalesce(p_automated, false)
    or ua = ''
    or ua ~* '(bot|crawl|spider|preview|scan|headless|phantom|python|curl|wget|java/|go-http|okhttp|safelinks|proofpoint|mimecast|barracuda|symantec|trend ?micro|sophos|forcepoint|fireeye|zscaler)'
    or now() < coalesce(r.sent_at, now()) + interval '20 seconds';   -- opened within seconds of sending
  -- Keep the log from growing without bound if a link is hammered.
  if (select count(*) from public.announcement_clicks c where c.announcement_id = r.announcement_id and c.email = r.email) < 200 then
    insert into public.announcement_clicks (announcement_id, email, user_agent, likely_scanner)
      values (r.announcement_id, r.email, ua, scanner);
  end if;
  if scanner then
    update public.announcement_recipients set scanner_clicks = scanner_clicks + 1
      where announcement_id = r.announcement_id and email = r.email;
  else
    update public.announcement_recipients
      set clicks = clicks + 1, first_click_at = coalesce(first_click_at, now()), last_click_at = now()
      where announcement_id = r.announcement_id and email = r.email;
  end if;
  return jsonb_build_object('dest',
    case when a.event_id is not null then 'event.html?id=' || a.event_id::text else 'member-portal.html' end);
end
$$;
revoke execute on function public.announcement_click(uuid, text, boolean) from public;
grant execute on function public.announcement_click(uuid, text, boolean) to anon, authenticated;

-- Called by the event / portal page once the visitor is logged in.
create or replace function public.announcement_arrived(p_token uuid)
returns void language sql security definer set search_path = ''
as $$
  update public.announcement_recipients
     set arrived_at = coalesce(arrived_at, now()),
         arrived_slip = coalesce(arrived_slip, (select m.slip from public.members m where m.user_id = auth.uid())),
         -- Reaching the page logged in means a person really clicked.
         clicks = greatest(clicks, 1),
         first_click_at = coalesce(first_click_at, now()),
         last_click_at = coalesce(last_click_at, now())
   where token = p_token and auth.uid() is not null
$$;
revoke execute on function public.announcement_arrived(uuid) from public, anon;
grant execute on function public.announcement_arrived(uuid) to authenticated;
