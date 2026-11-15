/* Visit replay: steps through one slip's logged activity on one day,
   showing the page they were on with a banner describing each action. */
(function () {
  var D = window.MemberData;
  function $(id) { return document.getElementById(id); }
  var params = new URLSearchParams(location.search);
  var sb, visits = [], steps = [], pos = 0, timer = null, playing = false;
  var VISIT_GAP = 30 * 60 * 1000;   // a new visit starts after 30 minutes of nothing

  var LABEL = {
    page_view: 'Viewed page', login: 'Logged in', logout: 'Logged out', login_failed: 'Failed login attempt',
    view_portal: 'Opened the member portal', view_event: 'Viewed event', open_document: 'Opened document',
    vote_cast: 'Voted', change_password: 'Changed their password', reset_requested: 'Asked for a password reset',
    reset_password_done: 'Reset their password from the email link', slip_search: 'Searched the slip finder',
    reserve_click: 'Clicked a Reserve button', view_admin: 'Opened the admin page',
    event_created: 'Created event', event_updated: 'Updated event', event_deleted: 'Deleted event',
    document_uploaded: 'Uploaded document', document_updated: 'Updated document', document_deleted: 'Deleted document',
    member_added: 'Added slip', member_updated: 'Updated slip', member_note_changed: 'Changed an admin note',
    password_set: 'Set a slip\'s password', ineligible_marked: 'Marked a slip ineligible', ineligible_removed: 'Restored a slip\'s eligibility',
    photo_added: 'Added a gallery photo', photo_updated: 'Updated a gallery photo', photo_deleted: 'Deleted a gallery photo'
  };
  var ICON = { login: '&#128275;', logout: '&#128274;', login_failed: '&#9888;', open_document: '&#128196;', vote_cast: '&#9745;',
    slip_search: '&#128269;', reserve_click: '&#128197;', view_event: '&#128197;', page_view: '&#128065;' };

  function stepFor(x) {
    var d = x.details || {}, label = LABEL[x.action] || x.action, what = x.target_label || '', url = x.page || 'index.html', extra = '';
    switch (x.action) {
      case 'view_portal': url = 'member-portal.html'; break;
      case 'view_event': url = 'event.html?id=' + encodeURIComponent(x.target_id || ''); break;
      case 'vote_cast':
        url = 'event.html?id=' + encodeURIComponent(x.target_id || '');
        extra = '<strong>' + D.esc(d.choice || '') + '</strong> for slip ' + D.esc(d.slip || ''); break;
      case 'open_document': url = x.page || 'member-portal.html'; if (d.section) extra = D.categoryLabel(d.section); break;
      case 'slip_search':
        url = 'marina-map.html?slip=' + encodeURIComponent(x.target_label || '');
        extra = d.found ? 'found' : 'not found'; break;
      case 'reserve_click': extra = 'goes to the MarinaGO reservation site (outside this website)'; break;
      case 'page_view': what = (x.target_label || x.page || '').replace(/\s*\|\s*New Bern Grand Marina\s*$/, ''); break;
      case 'login': case 'logout': case 'login_failed': case 'change_password': case 'reset_requested': case 'reset_password_done': what = ''; break;
      default:
        if (/^(event|document|member|photo|password|ineligible)/.test(x.action)) url = 'admin.html';
        if (d.slip) extra = 'slip ' + D.esc(d.slip) + (d.reason ? ' (' + D.esc(d.reason) + ')' : '');
    }
    return { row: x, at: new Date(x.at).getTime(), label: label, what: what, extra: extra, url: url, icon: ICON[x.action] || '&#8226;' };
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('rpDate').value = params.get('date') || D.toLocalInput(new Date().toISOString()).slice(0, 10);
    $('rpSlip').value = (params.get('slip') || '').toUpperCase();
    $('rpPick').addEventListener('submit', function (e) {
      e.preventDefault();
      var u = new URL(location.href);
      u.searchParams.set('slip', $('rpSlip').value.trim().toUpperCase());
      u.searchParams.set('date', $('rpDate').value);
      u.searchParams.delete('at');
      history.replaceState(null, '', u);
      params = u.searchParams;
      load();
    });
    wireControls();

    MemberAuth.getClient().then(function (client) {
      sb = client;
      return sb.auth.getSession();
    }).then(function (r) {
      if (!r.data.session) { msg('Please log in with an admin account.'); MemberAuth.openLogin('login'); return; }
      return sb.rpc('is_admin').then(function (a) {
        if (!a.data) { msg('Visit replay is for board administrators.'); return; }
        if ($('rpSlip').value) load(); else msg('Enter a date and slip, then click Load.');
      });
    }).catch(function (e) { msg(e.message || 'Something went wrong.'); });
  });

  function msg(t) { $('rpMsg').textContent = t; $('rpMsg').hidden = false; $('rpStage').hidden = true; $('rpControls').hidden = true; }

  function load() {
    stop();
    var slip = $('rpSlip').value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    var day = $('rpDate').value;
    if (!slip || !day) return msg('Enter a date and slip, then click Load.');
    var p = day.split('-');
    var next = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1)).toISOString().slice(0, 10);
    var from = D.fromLocalInput(day + 'T00:00'), to = D.fromLocalInput(next + 'T00:00');
    $('rpTitle').textContent = 'Visit replay: Slip ' + slip + ' · ' + D.fmtDay(day);
    document.title = 'Replay ' + slip + ' ' + day + ' | New Bern Grand Marina';
    msg('Loading…');
    sb.from('activity_log').select('*').eq('slip', slip).gte('at', from).lt('at', to).order('at', { ascending: true }).limit(3000)
      .then(function (r) {
        if (r.error) return msg(r.error.message);
        var rows = r.data || [];
        if (!rows.length) return msg('No activity for slip ' + slip + ' on ' + D.fmtDay(day) + '. Only things done while logged in with that slip (or failed logins typing it) are recorded.');
        // Split into visits.
        visits = [];
        rows.map(stepFor).forEach(function (s) {
          var v = visits[visits.length - 1];
          if (!v || s.at - v[v.length - 1].at > VISIT_GAP) visits.push([s]); else v.push(s);
        });
        $('rpVisit').innerHTML = visits.map(function (v, i) {
          return '<option value="' + i + '">Visit ' + (i + 1) + ': ' + time(v[0].at) + ' – ' + time(v[v.length - 1].at) +
            ' (' + v.length + ' step' + (v.length > 1 ? 's' : '') + ')</option>';
        }).join('');
        // Start at the visit (and step) the admin clicked from, if given.
        var at = params.get('at') ? new Date(params.get('at')).getTime() : null, vi = 0, si = 0;
        if (at) visits.forEach(function (v, i) { v.forEach(function (s, j) { if (Math.abs(s.at - at) < 1000) { vi = i; si = j; } }); });
        $('rpVisit').value = vi;
        $('rpMsg').hidden = true; $('rpStage').hidden = false; $('rpControls').hidden = false;
        chooseVisit(vi, si);
      });
  }

  function time(ms) { return new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' }); }

  function chooseVisit(i, start) {
    stop();
    steps = visits[i];
    $('rpSteps').innerHTML = steps.map(function (s, k) {
      return '<li data-k="' + k + '"><span class="rp-time">' + time(s.at) + '</span>' +
        '<span class="rp-what"><span class="rp-icon">' + s.icon + '</span>' + D.esc(s.label) +
        (s.what ? ': <em>' + D.esc(s.what) + '</em>' : '') + '</span></li>';
    }).join('');
    go(start || 0);
  }

  function go(k) {
    pos = Math.max(0, Math.min(steps.length - 1, k));
    var s = steps[pos];
    Array.prototype.forEach.call($('rpSteps').children, function (li, i) {
      li.classList.toggle('current', i === pos);
      li.classList.toggle('done', i < pos);
    });
    var cur = $('rpSteps').children[pos];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
    $('rpBanner').innerHTML = '<span class="rp-icon">' + s.icon + '</span><div><div class="rp-b-head">' + D.esc(s.label) +
      (s.what ? ': <strong>' + D.esc(s.what) + '</strong>' : '') + '</div>' +
      '<div class="rp-b-sub">' + time(s.at) + (s.extra ? ' · ' + s.extra : '') +
      (s.row.device ? ' · on ' + s.row.device : '') + ' · page: ' + D.esc(s.url.split('?')[0]) + '</div></div>';
    $('rpBanner').className = 'replay-banner act-' + s.row.action;
    var f = $('rpFrame');
    if (f.getAttribute('data-url') !== s.url) { f.setAttribute('data-url', s.url); f.src = s.url; }
    $('rpPos').textContent = 'Step ' + (pos + 1) + ' of ' + steps.length;
    $('rpBar').style.width = (steps.length > 1 ? pos * 100 / (steps.length - 1) : 100) + '%';
  }

  function delayFor(k) {
    var mode = $('rpSpeed').value;
    if (mode === 'step' || k + 1 >= steps.length) return 2000;
    var gap = steps[k + 1].at - steps[k].at;
    return Math.max(600, Math.min(gap, mode === 'real' ? 10000 : 3000));
  }
  function tick() {
    if (pos >= steps.length - 1) return stop();
    timer = setTimeout(function () { go(pos + 1); tick(); }, delayFor(pos));
  }
  function play() {
    if (pos >= steps.length - 1) go(0);
    playing = true; $('rpPlay').innerHTML = '&#10074;&#10074; Pause'; tick();
  }
  function stop() {
    playing = false; clearTimeout(timer); timer = null;
    if ($('rpPlay')) $('rpPlay').innerHTML = '&#9654; Play';
  }

  function wireControls() {
    $('rpPlay').addEventListener('click', function () { if (playing) stop(); else play(); });
    $('rpPrev').addEventListener('click', function () { stop(); go(pos - 1); });
    $('rpNext').addEventListener('click', function () { stop(); go(pos + 1); });
    $('rpFirst').addEventListener('click', function () { stop(); go(0); });
    $('rpVisit').addEventListener('change', function () { chooseVisit(+$('rpVisit').value, 0); });
    $('rpSpeed').addEventListener('change', function () { if (playing) { clearTimeout(timer); tick(); } });
    $('rpSteps').addEventListener('click', function (e) {
      var li = e.target.closest('li[data-k]');
      if (li) { stop(); go(+li.getAttribute('data-k')); }
    });
    document.addEventListener('keydown', function (e) {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); if (playing) stop(); else play(); }
      if (e.key === 'ArrowRight') { stop(); go(pos + 1); }
      if (e.key === 'ArrowLeft') { stop(); go(pos - 1); }
    });
  }
})();
