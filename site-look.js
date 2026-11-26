/* Website look: the color style, heading font, button shape and the home page's main photo,
   chosen on the Admin page (Settings tab). Loaded at the top of every page. It applies the
   look remembered from the last visit straight away (so there's no flash of the old colors),
   then checks for a newer choice and applies that. */
(function () {
  var KEY = 'siteLook', URL = 'https://afejychfqezorwyqfcsh.supabase.co/rest/v1/rpc/site_look';
  var APIKEY = 'sb_publishable_feYqbTeGauYt9xQaQk0mtw_7ZZsFbmM';   // public key; the function only returns these few settings
  var THEMES = ['classic', 'coastal', 'sunset', 'nautical', 'slate', 'evergreen'];

  function apply(l) {
    l = l || {};
    var d = document.documentElement;
    d.setAttribute('data-theme', THEMES.indexOf(l.theme) >= 0 ? l.theme : 'classic');
    d.setAttribute('data-font', l.font === 'serif' ? 'serif' : 'sans');
    d.setAttribute('data-buttons', l.buttons === 'rounded' || l.buttons === 'square' ? l.buttons : 'pill');
    var hero = String(l.hero || '');
    if (/^(https:\/\/afejychfqezorwyqfcsh\.supabase\.co\/storage\/v1\/object\/public\/|images\/)[^"'()\\\s]+$/.test(hero)) d.style.setProperty('--hero-img', 'url("' + hero + '")');
    else d.style.removeProperty('--hero-img');
    var pos = parseInt(l.heroPos, 10);
    if (pos >= 0 && pos <= 100) d.style.setProperty('--hero-pos', pos + '%'); else d.style.removeProperty('--hero-pos');
  }
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  apply(saved);
  window.SiteLook = { apply: apply, saved: function () { return saved || {}; } };
  try {
    fetch(URL, { method: 'POST', headers: { apikey: APIKEY, 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (l) {
        if (!l) return;
        if (JSON.stringify(l) !== JSON.stringify(saved)) { saved = l; apply(l); try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) {} }
      }).catch(function () {});
  } catch (e) {}
})();
