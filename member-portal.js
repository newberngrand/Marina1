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
          .select('slip, owner_name, email, is_admin, admin_rights, active, member_class')
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
            MemberAuth.track('view_portal');
            loadEvents(sb, m);
            // Marina Documents are for slip owners (and admins).
            if (m.is_admin || m.admin_rights || !m.member_class || m.member_class === 'certificated') loadDocs(sb);
            else $('portalDocsCard').hidden = true;
          });
      });
    }).catch(function (err) {
      $('portalLoading').textContent = err.message || 'Something went wrong loading the portal.';
    });
  });

  // Marina Chat: how many people are in the chat now, and new messages since this person last looked.
  function loadChatNotice(sb) {
    var since = null;
    try { since = localStorage.getItem('chatLastRead'); } catch (e) {}
    Promise.all([sb.rpc('chat_online'), sb.rpc('chat_unread', { p_since: since })]).then(function (res) {
      if (res[0].error) return;
      var d = res[0].data || { count: 0, names: [] }, n = d.count || 0, unread = (res[1] && res[1].data) || 0;
      var names = (d.names || []).slice().sort(), who = names.slice(0, 4).map(D.esc).join(', ') + (names.length > 4 ? ' and ' + (names.length - 4) + ' more' : '');
      var el = $('portalChat');
      el.innerHTML = '<span class="chat-notice-icon" aria-hidden="true">&#128172;</span><span class="chat-notice-text"><strong>Marina Chat:</strong> ' +
        (n ? n + (n === 1 ? ' person is' : ' people are') + ' in the chat now <span class="chat-notice-who">(' + who + ')</span>' : 'no one is in the chat right now') +
        (unread ? ' &middot; <strong>' + unread + ' new message' + (unread > 1 ? 's' : '') + '</strong>' + (since ? ' since your last visit' : ' this week') : '') +
        '</span><span class="chat-notice-go">' + (n ? 'Join' : 'Open Chat') + ' &rarr;</span>';
      el.classList.toggle('busy', n > 0);
      el.hidden = false;
      var bl = $('portalChatLink');
      bl.innerHTML = 'Chat' + (unread ? '<span class="board-count">' + unread + '</span>' : '');
      bl.title = n + ' in the chat now' + (unread ? ', ' + unread + ' new message' + (unread > 1 ? 's' : '') : '');
    });
  }

  function renderAccount(sb, m) {
    $('portalLoading').hidden = true;
    $('portalMember').hidden = false;
    loadChatNotice(sb);
    setInterval(function () { if (document.visibilityState === 'visible') loadChatNotice(sb); }, 60000);
    $('portalWelcome').textContent = 'Welcome, ' + (m.owner_name || 'Member');
    // Board members: a Board button (the only way in to the Board page), plus a reminder
    // when minutes are waiting for their approval.
    sb.rpc('board_status').then(function (r) {
      var st = (r && r.data) || {}, n = st.pending || 0;
      if (!st.is_board) return;
      var bl = $('portalBoardLink');
      bl.innerHTML = 'Board<span class="board-count"' + (n ? '' : ' hidden') + '>' + n + '</span>';
      bl.title = n ? n + ' set' + (n > 1 ? 's' : '') + ' of minutes waiting for your approval' : 'Board of Directors: minutes and approvals';
      bl.hidden = false;
      if (!n || document.getElementById('boardAlert')) return;
      $('portalMember').insertAdjacentHTML('afterbegin', '<div class="board-alert" id="boardAlert">Board of Directors: <strong>' + n +
        ' set' + (n > 1 ? 's' : '') + ' of meeting minutes</strong> ' + (n > 1 ? 'are' : 'is') + ' waiting for your approval. ' +
        '<a href="board.html">Review now &rarr;</a></div>');
    });
    var shared = !m.is_admin && m.member_class && m.member_class !== 'certificated';
    if (shared) {
      // Group logins (LTC / STC / staff) are shared, so no slip list or password change here.
      var kind = { ltc: 'Long-term cruiser', stc: 'Transient cruiser', employee: 'Marina staff' }[m.member_class] || '';
      $('portalSlipLabel').textContent = kind + ' login';
      $('portalSlipsHead').hidden = true;
      $('portalSlipsWrap').hidden = true;
      // Shared logins can't change the password here; an employee with admin rights has their own login and can.
      if (!m.admin_rights) $('portalPwActions').hidden = true;
    }
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
      if (!m.is_admin && (m.member_class || 'certificated') === 'certificated') setupCertificates(rows.map(function (x) { return x.slip; }));
    });

    /* ---------- My membership certificate(s): see, zoom and upload ---------- */
    function setupCertificates(slips) {
      var certs = {};
      function signed(path) {
        return sb.storage.from('marina-docs').createSignedUrl(path, 3600).then(function (r) { return r.data && r.data.signedUrl; });
      }
      function draw() {
        $('portalCertList').innerHTML = slips.map(function (s) {
          var c = certs[s];
          return '<div class="pc-item">' +
            '<button type="button" class="cert-thumb" data-pc-view="' + D.esc(s) + '"' + (c ? '' : ' disabled') + ' title="Click to view and zoom">' +
              (c ? '<span class="note">Loading&hellip;</span>' : '<span class="note">No certificate yet</span>') + '</button>' +
            '<div class="pc-side"><strong>Slip ' + D.esc(s) + '</strong>' +
              (c ? '<span class="note">Added ' + D.esc(D.fmtWhen(c.uploaded_at)) + '</span>' : '') +
              '<label class="btn-sm ed-import">' + (c ? 'Replace with a new photo&hellip;' : 'Upload a photo&hellip;') +
                '<input type="file" accept="image/*" data-pc-up="' + D.esc(s) + '" hidden></label>' +
            '</div></div>';
        }).join('');
        slips.forEach(function (s) {
          var c = certs[s]; if (!c) return;
          signed(c.thumb_path).then(function (u) {
            var b = document.querySelector('[data-pc-view="' + s + '"]');
            if (b && u) b.innerHTML = '<img src="' + u + '" alt="Certificate for slip ' + D.esc(s) + '">';
          });
        });
      }
      function load() {
        return sb.from('member_certificates').select('slip, storage_path, thumb_path, uploaded_at').in('slip', slips).then(function (r) {
          certs = {}; (r.data || []).forEach(function (c) { certs[c.slip] = c; });
          draw();
        });
      }
      $('portalCerts').hidden = false;
      load();
      $('portalCertList').addEventListener('click', function (e) {
        var b = e.target.closest('[data-pc-view]'); if (!b || b.disabled) return;
        var s = b.getAttribute('data-pc-view'), c = certs[s]; if (!c) return;
        signed(c.storage_path).then(function (u) { if (u) D.openViewer(u, 'Slip ' + s + ' · Membership certificate'); });
      });
      $('portalCertList').addEventListener('change', function (e) {
        var inp = e.target.closest('[data-pc-up]'); if (!inp) return;
        var s = inp.getAttribute('data-pc-up'), f = inp.files[0], err = $('portalCertError'); inp.value = '';
        if (!f) return;
        if (!/^image\//.test(f.type)) { err.textContent = 'Please choose a photo (JPG, PNG or similar).'; err.hidden = false; return; }
        err.hidden = true;
        var lab = inp.parentNode; lab.firstChild.textContent = 'Uploading…';
        var url = URL.createObjectURL(f), base = 'certificates/' + s + '/' + Date.now(), blobs;
        D.loadImage(url).then(function (img) {
          return D.drawImage(img, 2400, false).then(function (full) { return D.drawImage(img, 480, false).then(function (th) { blobs = [full, th]; }); });
        }).then(function () {
          URL.revokeObjectURL(url);
          return sb.storage.from('marina-docs').upload(base + '.jpg', blobs[0], { contentType: 'image/jpeg' });
        }).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          return sb.storage.from('marina-docs').upload(base + '_thumb.jpg', blobs[1], { contentType: 'image/jpeg' });
        }).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          return sb.rpc('owner_certificate_save', { p_slip: s, p_storage_path: base + '.jpg', p_thumb_path: base + '_thumb.jpg' });
        }).then(function (r) {
          if (r.error) { sb.storage.from('marina-docs').remove([base + '.jpg', base + '_thumb.jpg']); throw new Error(r.error.message); }
          var old = r.data || {};
          if (old.storage_path) sb.storage.from('marina-docs').remove([old.storage_path, old.thumb_path]);
          return load();
        }).catch(function (ex) {
          err.textContent = 'Could not upload the picture: ' + ex.message; err.hidden = false;
          draw();
        });
      });
    }
    // Admin rights follow the owner: any of their slips (same email) shows the Admin button.
    // With Gallery uploads waiting, it carries the count like the Board button, plus a reminder.
    function showAdmin() {
      $('portalAdminLink').hidden = false;
      sb.rpc('gallery_pending_count').then(function (r) {
        var n = (r && r.data) || 0;
        if (!n) return;
        var al = $('portalAdminLink');
        al.innerHTML = 'Admin<span class="board-count">' + n + '</span>';
        al.title = n + ' Gallery upload' + (n > 1 ? 's' : '') + ' waiting for review';
        if (document.getElementById('galleryAlert')) return;
        $('portalMember').insertAdjacentHTML('afterbegin', '<div class="board-alert" id="galleryAlert">Gallery: <strong>' + n +
          ' photo' + (n > 1 ? 's or videos' : ' or video') + '</strong> sent by members ' + (n > 1 ? 'are' : 'is') + ' waiting for review. ' +
          '<a href="gallery-review.html">Review now &rarr;</a></div>');
      });
    }
    if (m.is_admin || m.admin_rights) showAdmin();
    else sb.rpc('is_admin').then(function (r) { if (r.data) showAdmin(); });

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
        MemberAuth.track('change_password');
        done.hidden = false;
      });
    });
  }

  function voteTag(ev, voted, isAdmin) {
    if (ev.event_type !== 'vote') return '';
    var st = D.voteState(ev);
    var tag = '';
    var href = 'event.html?id=' + ev.id + '#ballot';
    var total = voted.total - (voted.excluded[ev.id] || 0);
    if (voted.shared) {
      // Shared cruiser login: everyone on it votes by name, so just point to the ballot.
      if (st === 'open') tag = '<a class="vote-tag open" href="' + href + '">Vote now &rsaquo;</a>';
    } else if (!isAdmin && voted.total > 0 && total <= 0) {
      tag = '<a class="vote-tag ineligible" href="' + href + '">Not eligible</a>';
    } else if (!isAdmin && voted.total > 0) {
      var n = voted[ev.id] || 0;
      if (n >= total) tag = '<a class="vote-tag voted" href="' + href + '">' + (total > 1 ? 'All slips voted' : 'You voted') + '</a>';
      else if (st === 'open') tag = '<a class="vote-tag open" href="' + href + '">' + (n ? n + ' of ' + total + ' slips voted &rsaquo;' : 'Vote now &rsaquo;') + '</a>';
      else if (n) tag = '<a class="vote-tag voted" href="' + href + '">' + n + ' of ' + total + ' slips voted</a>';
    }
    return '<div class="vote-state vote-' + st + '">' + D.esc(D.voteWindowText(ev)) + tag + '</div>';
  }

  function signupTag(ev, voted, isAdmin) {
    if (!ev.signup_enabled) return '';
    var href = 'event.html?id=' + ev.id + '#signup';
    var open = !ev.signup_closes_at || new Date(ev.signup_closes_at) > new Date();
    if (voted.signedUp && voted.signedUp[ev.id]) return '<div class="vote-state"><a class="vote-tag signup" href="' + href + '">You\'re signed up &#10003;</a></div>';
    if (open) return '<div class="vote-state">Sign-up sheet' + (ev.signup_closes_at ? ' open until ' + D.esc(D.fmtWhen(ev.signup_closes_at)) : '') +
      ' <a class="vote-tag signup go" href="' + href + '">Sign up &rsaquo;</a></div>';
    return '';
  }

  function gameTag(ev) {
    if (ev.event_type !== 'game') return '';
    var now = Date.now(), started = ev.starts_at && new Date(ev.starts_at).getTime() <= now, over = ev.ends_at && new Date(ev.ends_at).getTime() <= now;
    return '<div class="vote-state">' + D.esc(D.gameLabel(ev.game_kind)) + (ev.game_prize ? ' &middot; Prize: ' + D.esc(ev.game_prize) : '') +
      ' <a class="vote-tag signup go" href="game.html?id=' + ev.id + '">' + (over ? 'See the leaderboard' : started ? 'Play' : 'Join') + ' &rsaquo;</a></div>';
  }

  function eventItem(ev, past, voted, isAdmin) {
    return '<li class="event-item' + (past ? ' past' : '') + '">' +
      '<a class="badge badge-' + ev.event_type + '" href="' + (ev.event_type === 'game' ? 'game.html' : 'event.html') + '?id=' + ev.id + (ev.event_type === 'vote' ? '#ballot' : '') + '">' + D.eventTypeLabel(ev.event_type) + '</a>' +
      '<div><a class="event-title" href="event.html?id=' + ev.id + '">' + D.esc(ev.title) + '</a>' +
      (ev.starts_at ? '<div class="event-when">' + D.esc(D.fmtWhen(ev.starts_at, ev.ends_at)) + (ev.location ? ' &middot; ' + D.esc(ev.location) : '') + '</div>' : '') +
      voteTag(ev, voted, isAdmin) +
      signupTag(ev, voted, isAdmin) +
      gameTag(ev) +
      (ev.summary ? '<p class="event-summary">' + D.esc(ev.summary) + '</p>' : '') +
      '</div></li>';
  }

  function loadEvents(sb, m) {
    Promise.all([
      sb.from('events').select('id, title, summary, event_type, starts_at, ends_at, location, vote_opens_at, vote_closes_at, signup_enabled, signup_closes_at, game_kind, game_prize').eq('active', true),
      m.is_admin ? Promise.resolve({ data: [] }) : sb.from('votes').select('event_id, slip'),
      m.is_admin ? Promise.resolve({ data: [] }) : sb.rpc('my_slips'),
      m.is_admin ? Promise.resolve({ data: [] }) : sb.from('vote_exclusions').select('event_id, slip'),
      sb.from('event_signups').select('event_id').eq('slip', m.slip)
    ]).then(function (res) {
        var r = res[0];
        var mySlips = res[2].data || [];
        var voted = { total: mySlips.length ? mySlips.filter(function (s) { return s.can_vote; }).length : 1, excluded: {} };
        // Count only this owner's slips: owners with admin rights can read every slip's votes and exclusions.
        var mine = {};
        if (mySlips.length) mySlips.forEach(function (s) { if (s.can_vote) mine[s.slip] = true; });
        else mine[m.slip] = true;
        (res[3].data || []).forEach(function (x) { if (mine[x.slip]) voted.excluded[x.event_id] = (voted.excluded[x.event_id] || 0) + 1; });
        voted.shared = !m.is_admin && !!m.member_class && m.member_class !== 'certificated';
        voted.signedUp = {};
        (res[4].data || []).forEach(function (x) { voted.signedUp[x.event_id] = true; });
        (res[1].data || []).forEach(function (v) { if (mine[v.slip]) voted[v.event_id] = (voted[v.event_id] || 0) + 1; });
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
    return '<li><button type="button" class="doc-link" data-path="' + D.esc(d.storage_path) + '" data-name="' + D.esc(d.file_name) +
      '" data-id="' + D.esc(d.id) + '" data-title="' + D.esc(d.title) + '" data-cat="' + D.esc(d.category) + '">' +
      D.esc(d.title) + '</button>' +
      (d.doc_date ? ' <span class="note">&middot; ' + D.fmtDay(d.doc_date) + '</span>' : '') +
      (d.description ? '<div class="note">' + D.esc(d.description) + '</div>' : '') + '</li>';
  }

  function loadDocs(sb) {
    sb.from('documents').select('id, category, title, description, doc_date, storage_path, file_name')
      .eq('active', true)
      .neq('category', 'board')  // board members see these on the Board page
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
          if (b) D.openDocument(sb, b.getAttribute('data-path'), b.getAttribute('data-name'),
            { id: b.getAttribute('data-id'), title: b.getAttribute('data-title'), category: b.getAttribute('data-cat') });
        });
      });
  }
})();
