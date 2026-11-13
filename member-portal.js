/* Member Portal landing page: current events, marina documents, account. */
(function () {
  var D = window.MemberData;
  function $(id) { return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', function () {
    MemberAuth.getClient().then(function (sb) {
      return sb.auth.getSession().then(function (r) {
        var session = r.data.session;
        if (!session) {
          $('portalLoading').textContent = 'Please log in to view the member portal.';
          MemberAuth.openLogin('login');
          return;
        }
        return sb.from('members')
          .select('slip, owner_name, email, is_admin, active')
          .eq('user_id', session.user.id)
          .maybeSingle()
          .then(function (res) {
            var m = res.data;
            if (!m || !m.active) {
              return MemberAuth.signOut().then(function () {
                $('portalLoading').textContent = 'This slip\'s member access is not active. Please contact the marina office.';
              });
            }
            renderAccount(sb, m);
            loadEvents(sb, m);
            loadDocs(sb);
          });
      });
    }).catch(function (err) {
      $('portalLoading').textContent = err.message || 'Something went wrong loading the portal.';
    });
  });

  function renderAccount(sb, m) {
    $('portalLoading').hidden = true;
    $('portalMember').hidden = false;
    $('portalWelcome').textContent = 'Welcome, ' + (m.owner_name || 'Member');
    $('portalSlipTop').textContent = m.slip;
    $('portalSlip').textContent = 'Slip ' + m.slip;
    $('portalEmail').textContent = m.email || 'None on file';
    var mine = m.is_admin ? Promise.resolve({ data: [] }) : sb.rpc('my_slips');
    mine.then(function (r) {
      var rows = r.data && r.data.length ? r.data : [{ slip: m.slip, owner_name: m.owner_name, is_login: true }];
      $('portalSlips').innerHTML = rows.map(function (x) {
        return '<tr><td><strong>' + D.esc(x.slip) + '</strong>' + (x.is_login ? ' <span class="note">(logged in)</span>' : '') +
          (x.can_vote === false ? ' <span class="note">(non-voting)</span>' : '') +
          '</td><td>' + D.esc(x.owner_name) + '</td></tr>';
      }).join('');
      if (rows.length > 1) {
        $('portalSlipsHead').textContent = 'Your slips (' + rows.length + ')';
        $('portalSlipLabel').textContent = 'Slips';
        $('portalSlipTop').textContent = rows.map(function (x) { return x.slip; }).join(', ');
        $('portalSlipsNote').hidden = false;
      }
    });
    if (m.is_admin) $('portalAdminLink').hidden = false;

    $('portalLogout').addEventListener('click', function () {
      MemberAuth.logOut();
    });
    $('portalShowPw').addEventListener('click', function () {
      $('portalPwForm').hidden = !$('portalPwForm').hidden;
      if (!$('portalPwForm').hidden) $('portalPw1').focus();
    });
    $('portalPwForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var p1 = $('portalPw1').value, p2 = $('portalPw2').value;
      var err = $('portalPwError'), done = $('portalPwDone');
      err.hidden = true; done.hidden = true;
      if (p1.length < 8) { err.textContent = 'Please use at least 8 characters.'; err.hidden = false; return; }
      if (p1 !== p2) { err.textContent = 'The two passwords don\'t match.'; err.hidden = false; return; }
      sb.auth.updateUser({ password: p1 }).then(function (res) {
        if (res.error) { err.textContent = res.error.message; err.hidden = false; return; }
        $('portalPwForm').reset();
        done.hidden = false;
      });
    });
  }

  function voteTag(ev, voted, isAdmin) {
    if (ev.event_type !== 'vote') return '';
    var st = D.voteState(ev);
    var tag = '';
    var href = 'event.html?id=' + ev.id + '#ballot';
    if (!isAdmin && voted.total > 0) {
      var n = voted[ev.id] || 0, total = voted.total;
      if (n >= total) tag = '<a class="vote-tag voted" href="' + href + '">' + (total > 1 ? 'All slips voted' : 'You voted') + '</a>';
      else if (st === 'open') tag = '<a class="vote-tag open" href="' + href + '">' + (n ? n + ' of ' + total + ' slips voted &rsaquo;' : 'Vote now &rsaquo;') + '</a>';
      else if (n) tag = '<a class="vote-tag voted" href="' + href + '">' + n + ' of ' + total + ' slips voted</a>';
    }
    return '<div class="vote-state vote-' + st + '">' + D.esc(D.voteWindowText(ev)) + tag + '</div>';
  }

  function eventItem(ev, past, voted, isAdmin) {
    return '<li class="event-item' + (past ? ' past' : '') + '">' +
      '<a class="badge badge-' + ev.event_type + '" href="event.html?id=' + ev.id + (ev.event_type === 'vote' ? '#ballot' : '') + '">' + D.eventTypeLabel(ev.event_type) + '</a>' +
      '<div><a class="event-title" href="event.html?id=' + ev.id + '">' + D.esc(ev.title) + '</a>' +
      (ev.starts_at ? '<div class="event-when">' + D.esc(D.fmtWhen(ev.starts_at, ev.ends_at)) + (ev.location ? ' &middot; ' + D.esc(ev.location) : '') + '</div>' : '') +
      voteTag(ev, voted, isAdmin) +
      (ev.summary ? '<p class="event-summary">' + D.esc(ev.summary) + '</p>' : '') +
      '</div></li>';
  }

  function loadEvents(sb, m) {
    Promise.all([
      sb.from('events').select('id, title, summary, event_type, starts_at, ends_at, location, vote_opens_at, vote_closes_at').eq('active', true),
      m.is_admin ? Promise.resolve({ data: [] }) : sb.from('votes').select('event_id, slip'),
      m.is_admin ? Promise.resolve({ data: [] }) : sb.rpc('my_slips')
    ]).then(function (res) {
        var r = res[0];
        var mySlips = res[2].data || [];
        var voted = { total: mySlips.length ? mySlips.filter(function (s) { return s.can_vote; }).length : 1 };
        (res[1].data || []).forEach(function (v) { voted[v.event_id] = (voted[v.event_id] || 0) + 1; });
        var isAdmin = m.is_admin;
        var list = r.data || [];
        if (!list.length) {
          $('portalEvents').innerHTML = '<p class="note" style="margin:0">No current events right now. Check back soon.</p>';
          return;
        }
        var now = Date.now();
        function endOf(ev) {
          if (ev.event_type === 'vote' && ev.vote_closes_at) return new Date(ev.vote_closes_at).getTime();
          if (!ev.starts_at) return Infinity;
          return new Date(ev.ends_at || ev.starts_at).getTime() + (ev.ends_at ? 0 : 6 * 3600 * 1000);
        }
        function sortKey(ev) { return ev.starts_at || (ev.event_type === 'vote' ? ev.vote_closes_at : null); }
        var upcoming = list.filter(function (ev) { return endOf(ev) >= now; })
          .sort(function (a, b) {
            var ka = sortKey(a), kb = sortKey(b);
            if (!ka) return 1;
            if (!kb) return -1;
            return new Date(ka) - new Date(kb);
          });
        var past = list.filter(function (ev) { return endOf(ev) < now; })
          .sort(function (a, b) { return new Date(sortKey(b)) - new Date(sortKey(a)); });
        var html = upcoming.length
          ? '<ul class="event-list">' + upcoming.map(function (e) { return eventItem(e, false, voted, isAdmin); }).join('') + '</ul>'
          : '<p class="note" style="margin:0">No upcoming events.</p>';
        if (past.length) {
          html += '<details class="past-events"><summary>Past events (' + past.length + ')</summary><ul class="event-list">' +
            past.map(function (e) { return eventItem(e, true, voted, isAdmin); }).join('') + '</ul></details>';
        }
        $('portalEvents').innerHTML = html;
      });
  }

  function docLink(d) {
    return '<li><button type="button" class="doc-link" data-path="' + D.esc(d.storage_path) + '" data-name="' + D.esc(d.file_name) + '">' +
      D.esc(d.title) + '</button>' +
      (d.doc_date ? ' <span class="note">&middot; ' + D.fmtDay(d.doc_date) + '</span>' : '') +
      (d.description ? '<div class="note">' + D.esc(d.description) + '</div>' : '') + '</li>';
  }

  function loadDocs(sb) {
    sb.from('documents').select('id, category, title, description, doc_date, storage_path, file_name')
      .eq('active', true)
      .order('doc_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .then(function (r) {
        var docs = r.data || [];
        if (!docs.length) {
          $('portalDocs').innerHTML = '<p class="note" style="margin:0">No documents have been posted yet.</p>';
          return;
        }
        var html = D.DOC_CATEGORIES.map(function (c) {
          var list = docs.filter(function (d) { return d.category === c.id; });
          if (!list.length) return '';
          var inner;
          if (c.id === 'minutes') {
            // Year > Month > documents. Newest year open.
            var years = [], byYear = {};
            list.forEach(function (d) {
              var y = d.doc_date.slice(0, 4);
              if (!byYear[y]) { byYear[y] = { months: [], byMonth: {} }; years.push(y); }
              var k = D.monthKey(d.doc_date);
              if (!byYear[y].byMonth[k]) { byYear[y].byMonth[k] = []; byYear[y].months.push(k); }
              byYear[y].byMonth[k].push(d);
            });
            inner = years.map(function (y, i) {
              return '<details class="doc-year"' + (i === 0 ? ' open' : '') + '><summary>' + y + '</summary>' +
                byYear[y].months.map(function (m) {
                  return '<h5 class="month-head">' + m.replace(' ' + y, '') + '</h5><ul class="doc-list">' + byYear[y].byMonth[m].map(docLink).join('') + '</ul>';
                }).join('') + '</details>';
            }).join('');
          } else {
            inner = '<ul class="doc-list">' + list.map(docLink).join('') + '</ul>';
          }
          return '<div class="doc-section doc-' + c.id + '">' +
            '<div class="doc-head"><h4>' + c.label + '</h4><span class="doc-count">' + list.length + '</span></div>' +
            '<div class="doc-body">' + inner + '</div></div>';
        }).join('');
        $('portalDocs').innerHTML = '<div class="doc-grid">' + html + '</div>';
        $('portalDocs').addEventListener('click', function (e) {
          var b = e.target.closest('.doc-link');
          if (b) D.openDocument(sb, b.getAttribute('data-path'), b.getAttribute('data-name'));
        });
      });
  }
})();
