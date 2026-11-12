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
              return sb.auth.signOut().then(function () {
                $('portalLoading').textContent = 'This slip\'s member access is not active. Please contact the marina office.';
              });
            }
            renderAccount(sb, m);
            loadEvents(sb);
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
    $('portalSlip').textContent = m.slip;
    $('portalOwner').textContent = m.owner_name || '';
    $('portalEmail').textContent = m.email || 'None on file';
    if (m.is_admin) $('portalAdminLink').hidden = false;

    $('portalLogout').addEventListener('click', function () {
      sb.auth.signOut().then(function () { window.location.href = 'index.html'; });
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

  function eventItem(ev, past) {
    return '<li class="event-item' + (past ? ' past' : '') + '">' +
      '<span class="badge badge-' + ev.event_type + '">' + D.eventTypeLabel(ev.event_type) + '</span>' +
      '<div><a class="event-title" href="event.html?id=' + ev.id + '">' + D.esc(ev.title) + '</a>' +
      (ev.starts_at ? '<div class="event-when">' + D.esc(D.fmtWhen(ev.starts_at, ev.ends_at)) + (ev.location ? ' &middot; ' + D.esc(ev.location) : '') + '</div>' : '') +
      (ev.summary ? '<p class="event-summary">' + D.esc(ev.summary) + '</p>' : '') +
      '</div></li>';
  }

  function loadEvents(sb) {
    sb.from('events').select('id, title, summary, event_type, starts_at, ends_at, location')
      .eq('active', true).then(function (r) {
        var list = r.data || [];
        if (!list.length) {
          $('portalEvents').innerHTML = '<p class="note" style="margin:0">No current events right now. Check back soon.</p>';
          return;
        }
        var now = Date.now();
        function endOf(ev) { return new Date(ev.ends_at || ev.starts_at).getTime() + (ev.ends_at ? 0 : 6 * 3600 * 1000); }
        var upcoming = list.filter(function (ev) { return !ev.starts_at || endOf(ev) >= now; })
          .sort(function (a, b) {
            if (!a.starts_at) return 1;
            if (!b.starts_at) return -1;
            return new Date(a.starts_at) - new Date(b.starts_at);
          });
        var past = list.filter(function (ev) { return ev.starts_at && endOf(ev) < now; })
          .sort(function (a, b) { return new Date(b.starts_at) - new Date(a.starts_at); });
        var html = upcoming.length
          ? '<ul class="event-list">' + upcoming.map(function (e) { return eventItem(e, false); }).join('') + '</ul>'
          : '<p class="note" style="margin:0">No upcoming events.</p>';
        if (past.length) {
          html += '<details class="past-events"><summary>Past events (' + past.length + ')</summary><ul class="event-list">' +
            past.map(function (e) { return eventItem(e, true); }).join('') + '</ul></details>';
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
          return '<div class="doc-section"><h4>' + c.label + '</h4>' + inner + '</div>';
        }).join('');
        $('portalDocs').innerHTML = html;
        $('portalDocs').addEventListener('click', function (e) {
          var b = e.target.closest('.doc-link');
          if (b) D.openDocument(sb, b.getAttribute('data-path'), b.getAttribute('data-name'));
        });
      });
  }
})();
