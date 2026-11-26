-- Website look, chosen on the Admin page (Settings tab) and applied on every page for every
-- visitor: the color style, heading font, button shape, and the home page's main photo and its
-- vertical position. Stored in site_settings (admins only); this function lets anyone read
-- just these few keys.
create or replace function public.site_look()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'theme',   (select value from public.site_settings where key = 'site_theme'),
    'font',    (select value from public.site_settings where key = 'site_font'),
    'buttons', (select value from public.site_settings where key = 'site_buttons'),
    'hero',    (select value from public.site_settings where key = 'hero_image'),
    'heroPos', (select value from public.site_settings where key = 'hero_position'))
$$;
revoke execute on function public.site_look() from public;
grant execute on function public.site_look() to anon, authenticated;
