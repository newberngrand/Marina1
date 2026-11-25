/* Admin page: manage current events, marina documents, and view members. */
(function () {
  var D = window.MemberData;
  var sb = null;
  var events = [], docs = [];

  function $(id) { return document.getElementById(id); }
  function showErr(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }

  document.addEventListener('DOMContentLoaded', function () {
    MemberAuth.getClient().then(function (client) {
      sb = client;
      return sb.auth.getSession();
    }).then(function (r) {
      if (!r.data.session) {
        $('adminLoading').textContent = 'Please log in with an admin account.';
        MemberAuth.openLogin('login');
        return;
      }
      return sb.rpc('is_admin').then(function (res) {
        if (!res.data) {
          $('adminLoading').innerHTML = 'This page is for board administrators. <a href="member-portal.html">Go to the Member Portal</a>.';
          return;
        }
        $('adminLoading').hidden = true;
        $('adminApp').hidden = false;
        MemberAuth.track('view_admin');
        setupTabs();
        setupEvents();
        setupDocs();
        loadMembers();
        setupLog();
        setupGallery();
        setupVideos();
        setupAnnouncements();
        setupRequests();
      });
    }).catch(function (e) {
      $('adminLoading').textContent = e.message || 'Something went wrong.';
    });
  });

  /* ---------- Tabs ---------- */
  function setupTabs() {
    var tabs = document.querySelectorAll('.admin-tab[data-tab]');
    // Board members: a "Board" tab (a link to the Board page) with the count of minutes waiting for them.
    sb.rpc('board_status').then(function (r) {
      var st = (r && r.data) || {}, n = st.pending || 0;
      if (!st.is_board) return;
      $('boardTab').innerHTML = 'Board<span class="board-count"' + (n ? '' : ' hidden') + '>' + n + '</span>';
      $('boardTab').title = n ? n + ' set' + (n > 1 ? 's' : '') + ' of minutes waiting for your approval' : 'Review and approve meeting minutes';
      $('boardTab').hidden = false;
    });
    function show(name) {
      tabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
      document.querySelectorAll('.admin-panel').forEach(function (p) {
        p.hidden = p.getAttribute('data-panel') !== name;
      });
      // Remember the tab, except in the site map's preview of this page (a frame).
      try { if (window.top === window.self) sessionStorage.setItem('adminTab', name); } catch (e) {}
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { show(t.getAttribute('data-tab')); }); });
    var saved = null;
    try { saved = sessionStorage.getItem('adminTab'); } catch (e) {}
    // admin.html#help (Back to Help), or #events, #docs ... (the site map's previews) open that tab.
    var hashTab = location.hash.slice(1);
    if (hashTab && document.querySelector('.admin-tab[data-tab="' + hashTab.replace(/[^a-z]/g, '') + '"]')) saved = hashTab.replace(/[^a-z]/g, '');
    if (saved) show(saved);
  }

  /* ---------- Events ---------- */
  function setupEvents() {
    $('evType').innerHTML = D.EVENT_TYPES.map(function (t) {
      return '<option value="' + t.id + '">' + t.label + '</option>';
    }).join('');
    $('evGameKind').innerHTML = D.GAMES.map(function (g) {
      return '<option value="' + g.id + '">' + D.esc(g.label) + '</option>';
    }).join('');
    // Players can always see the game: ticking a player group ticks it under "Who can see this" too.
    document.querySelectorAll('#evGamePlayers input').forEach(function (c) {
      c.addEventListener('change', function () {
        if (c.checked) { var a = document.querySelector('#evAudience input[value="' + c.value + '"]'); if (a) a.checked = true; }
        updateBallotBox();
      });
    });
    document.querySelectorAll('#evAudience input').forEach(function (c) {
      c.addEventListener('change', function () {
        if (!c.checked) { var p = document.querySelector('#evGamePlayers input[value="' + c.value + '"]'); if (p) p.checked = false; }
      });
    });
    $('evGameWeek').addEventListener('click', function () { setGameDays(nextWeekdays()); });
    $('evNew').addEventListener('click', function () { openEventForm(null); });
    $('evCancel').addEventListener('click', function () { $('evForm').hidden = true; });
    $('evForm').addEventListener('submit', saveEvent);
    $('evType').addEventListener('change', updateBallotBox);
    document.querySelectorAll('#evAudience input').forEach(function (c) { c.addEventListener('change', updateBallotBox); });
    $('evBallotKind').addEventListener('change', updateBallotBox);
    $('evSignupOn').addEventListener('change', updateBallotBox);
    setupResults();
    setupExclusions();
    setupAttachments();
    setupSignups();
    $('evRows').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var ev = events.find(function (x) { return x.id === b.getAttribute('data-id'); });
      if (!ev) return;
      var act = b.getAttribute('data-act');
      if (act === 'edit') openEventForm(ev);
      if (act === 'results') showResults(ev);
      if (act === 'signups') showSignups(ev);
      if (act === 'toggle') sb.from('events').update({ active: !ev.active }).eq('id', ev.id).then(loadEvents);
      var testVote = ev.event_type === 'vote' && ev.vote_test;
      if (act === 'clear' && testVote && confirm('Clear all ' + (voteCounts[ev.id] || 0) + ' ballots from the test vote "' + ev.title + '"? This cannot be undone.')) {
        sb.rpc('clear_test_votes', { p_event: ev.id }).then(function (r) {
          if (r.error) alert(r.error.message);
          loadEvents();
        });
      }
      if (act === 'delete' && confirm('Delete "' + ev.title + '"' + (testVote && voteCounts[ev.id] ? ' and its ' + voteCounts[ev.id] + ' test ballots' : '') +
          '? This cannot be undone.\n\nTip: choose Deactivate instead to just hide it from members.')) {
        // Files uploaded just for this event go with it (linked library documents stay).
        sb.from('event_attachments').select('storage_path, document_id').eq('event_id', ev.id).then(function (a) {
          var del = testVote ? sb.rpc('delete_test_vote', { p_event: ev.id }) : sb.from('events').delete().eq('id', ev.id);
          return del.then(function (r) {
            if (!r.error) {
              var own = (a.data || []).filter(function (x) { return !x.document_id; }).map(function (x) { return x.storage_path; });
              if (own.length) sb.storage.from('marina-docs').remove(own);
            }
            return r;
          });
        }).then(function (r) {
          if (r.error) alert(r.error.code === '23503'
            ? 'This vote already has ballots cast, so it can\'t be deleted (the voting record is kept). Use Deactivate to hide it from members.'
            : r.error.message);
          loadEvents();
        });
      }
    });
    loadEvents();
  }

  var voteCounts = {}, signupCounts = {};

  function loadEvents() {
    return Promise.all([
      sb.from('events').select('*').order('starts_at', { ascending: false, nullsFirst: true }),
      sb.from('votes').select('event_id'),
      sb.from('event_signups').select('event_id')
    ]).then(function (res) {
      var r = res[0];
      voteCounts = {}; signupCounts = {};
      (res[1].data || []).forEach(function (v) { voteCounts[v.event_id] = (voteCounts[v.event_id] || 0) + 1; });
      (res[2].data || []).forEach(function (v) { signupCounts[v.event_id] = (signupCounts[v.event_id] || 0) + 1; });
      events = r.data || [];
      if (!events.length) {
        $('evRows').innerHTML = '<tr><td colspan="5">No events yet. Click <strong>+ Add Event</strong> to create one.</td></tr>';
        return;
      }
      $('evRows').innerHTML = events.map(function (ev) {
        var isVote = ev.event_type === 'vote';
        var voteInfo = '';
        if (isVote) {
          var st = D.voteState(ev);
          voteInfo = '<div class="vote-state vote-' + st + '">' + D.esc(D.voteWindowText(ev)) + '</div>' +
            '<div class="note">' + (voteCounts[ev.id] || 0) + ' vote' + ((voteCounts[ev.id] || 0) === 1 ? '' : 's') + ' cast &middot; ' +
            D.esc(D.ballotChoices(ev).join(' / ')) + '</div>';
        }
        if (ev.signup_enabled) {
          var open = !ev.signup_closes_at || new Date(ev.signup_closes_at) > new Date();
          voteInfo += '<div class="note">Sign-up sheet: ' + (signupCounts[ev.id] || 0) + ' signed up &middot; ' +
            (open ? (ev.signup_closes_at ? 'closes ' + D.esc(D.fmtWhen(ev.signup_closes_at)) : 'open') : 'closed') + '</div>';
        }
        if (ev.event_type === 'game') {
          var now = new Date(), gs = ev.starts_at && new Date(ev.starts_at), ge = ev.ends_at && new Date(ev.ends_at);
          var gst = gs && now < gs ? 'Not started yet' : ge && now > ge ? 'Finished' : 'In play';
          if (ev.game_practice) gst = 'Practice mode, day ' + ev.game_practice_day + (ev.game_practice_over ? ' (finished)' : '');
          voteInfo += '<div class="note"><strong>' + D.esc(D.gameLabel(ev.game_kind)) + '</strong> &middot; ' + gst +
            ' &middot; Players: ' + (ev.game_players || []).map(function (a) { return CLASS_SHORT[a] || a; }).join(', ') +
            (ev.game_prize ? '<br>Prize: ' + D.esc(ev.game_prize) : '') + '</div>';
        }
        return '<tr' + (ev.active ? '' : ' class="row-inactive"') + '>' +
          '<td><a href="event.html?id=' + ev.id + '" target="_blank" rel="noopener"><strong>' + D.esc(ev.title) + '</strong></a>' +
            (ev.summary ? '<div class="note">' + D.esc(ev.summary) + '</div>' : '') + '</td>' +
          '<td><span class="badge badge-' + ev.event_type + '">' + D.eventTypeLabel(ev.event_type) + '</span>' +
            (isVote && ev.vote_test ? ' <span class="badge badge-test">Test</span>' : '') +
            '<div class="note" style="margin-top:4px">' + (ev.audience || ['certificated']).map(function (a) { return CLASS_SHORT[a] || a; }).join(', ') + '</div></td>' +
          '<td>' + (ev.starts_at ? D.esc(D.fmtWhen(ev.starts_at, ev.ends_at)) : (isVote ? '' : '<span class="note">No date</span>')) + voteInfo + '</td>' +
          '<td>' + (ev.active ? 'Active' : '<span class="inactive">Inactive</span>') + '</td>' +
          '<td class="row-actions">' +
            (isVote ? '<button type="button" class="btn-sm btn-primary-sm" data-act="results" data-id="' + ev.id + '">Results</button>' : '') +
            (ev.event_type === 'game' ? '<a class="btn-sm btn-primary-sm" href="game.html?id=' + ev.id + '" target="_blank" rel="noopener">' + (ev.game_practice ? 'Practice' : 'Open game') + '</a>' : '') +
            (ev.signup_enabled ? '<button type="button" class="btn-sm btn-primary-sm" data-act="signups" data-id="' + ev.id + '">Sign-ups (' + (signupCounts[ev.id] || 0) + ')</button>' : '') +
            (isVote && ev.vote_test && voteCounts[ev.id] ? '<button type="button" class="btn-sm" data-act="clear" data-id="' + ev.id + '">Clear test ballots</button>' : '') +
            '<button type="button" class="btn-sm" data-act="edit" data-id="' + ev.id + '">Edit</button>' +
            '<button type="button" class="btn-sm" data-act="toggle" data-id="' + ev.id + '">' + (ev.active ? 'Deactivate' : 'Activate') + '</button>' +
            '<button type="button" class="btn-sm btn-danger" data-act="delete" data-id="' + ev.id + '">Delete</button>' +
          '</td></tr>';
      }).join('');
    });
  }

  function openEventForm(ev) {
    $('evFormTitle').textContent = ev ? 'Edit Event' : 'Add Event';
    $('evId').value = ev ? ev.id : '';
    $('evTitle').value = ev ? ev.title : '';
    $('evType').value = ev ? ev.event_type : 'meeting';
    $('evLocation').value = ev ? ev.location : '';
    $('evStart').value = ev ? D.toLocalInput(ev.starts_at) : '';
    $('evEnd').value = ev ? D.toLocalInput(ev.ends_at) : '';
    $('evSummary').value = ev ? ev.summary : '';
    $('evDetails').value = ev ? ev.details : '';
    $('evActive').checked = ev ? ev.active : true;
    var aud = ev && ev.audience && ev.audience.length ? ev.audience : ['certificated'];
    document.querySelectorAll('#evAudience input').forEach(function (c) { c.checked = aud.indexOf(c.value) !== -1; });
    $('evBallotKind').value = ev ? ev.ballot_kind : 'yes_no';
    $('evResults').value = ev ? ev.results_visibility : 'after_close';
    $('evOptions').value = ev && ev.ballot_options ? ev.ballot_options.join('\n') : '';
    $('evVoteOpen').value = ev ? D.toLocalInput(ev.vote_opens_at) : '';
    $('evVoteClose').value = ev ? D.toLocalInput(ev.vote_closes_at) : '';
    $('evNotifyEmail').value = ev ? (ev.vote_notify_email || '') : '';
    $('evVoteTest').checked = !!(ev && ev.vote_test);
    $('evGameKind').value = ev && ev.game_kind ? ev.game_kind : D.GAMES[0].id;
    setGameDays(ev && ev.game_days && ev.game_days.length === 5 ? ev.game_days : nextWeekdays());
    $('evGameEndTime').value = ev && ev.event_type === 'game' && ev.ends_at ? D.toLocalInput(ev.ends_at).slice(11) : '20:00';
    $('evGamePractice').checked = !!(ev && ev.game_practice);
    $('evGamePrize').value = ev ? (ev.game_prize || '') : '';
    var players = ev && ev.game_players && ev.game_players.length ? ev.game_players : ['certificated'];
    document.querySelectorAll('#evGamePlayers input').forEach(function (c) { c.checked = players.indexOf(c.value) !== -1; });
    loadExclusionsFor(ev);
    loadAttachmentsFor(ev);
    $('evSignupOn').checked = !!(ev && ev.signup_enabled);
    var sf = document.querySelectorAll('.ev-sf');
    sf.forEach(function (inp, i) { inp.value = ev && ev.signup_fields && ev.signup_fields[i] ? ev.signup_fields[i] : ''; });
    $('evSignupClose').value = ev ? D.toLocalInput(ev.signup_closes_at) : '';
    $('evSignupPublic').checked = ev ? ev.signup_public !== false : true;
    var locked = !!(ev && voteCounts[ev.id]);
    $('evBallotLocked').hidden = !locked;
    $('evBallotKind').disabled = locked;
    $('evOptions').disabled = locked;
    $('evType').disabled = locked;
    $('evVoteTest').disabled = locked;
    // Once votes are in, the groups on the ballot can be added to but not taken away.
    document.querySelectorAll('#evAudience input').forEach(function (c) { c.disabled = locked && c.checked; });
    updateBallotBox();
    showErr($('evError'), '');
    $('evForm').hidden = false;
    $('evForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('evTitle').focus();
  }

  function saveEvent(e) {
    e.preventDefault();
    var row = {
      title: $('evTitle').value.trim(),
      event_type: $('evType').value,
      location: $('evLocation').value.trim(),
      starts_at: D.fromLocalInput($('evStart').value),
      ends_at: D.fromLocalInput($('evEnd').value),
      summary: $('evSummary').value.trim(),
      details: $('evDetails').value.trim(),
      active: $('evActive').checked
    };
    if (!row.title) return showErr($('evError'), 'Please enter a title.');
    row.audience = Array.prototype.filter.call(document.querySelectorAll('#evAudience input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
    if (!row.audience.length) return showErr($('evError'), 'Tick at least one group under "Who can see this".');
    if (row.event_type !== 'game' && row.starts_at && row.ends_at && row.ends_at < row.starts_at) return showErr($('evError'), 'The end time is before the start time.');
    var id = $('evId').value, clearPractice = false;
    if (row.event_type === 'vote') {
      row.results_visibility = $('evResults').value;
      row.vote_opens_at = D.fromLocalInput($('evVoteOpen').value);
      row.vote_closes_at = D.fromLocalInput($('evVoteClose').value);
      if (!row.vote_closes_at) return showErr($('evError'), 'Please set when voting closes.');
      var mails = $('evNotifyEmail').value.split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
      var badMail = mails.filter(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
      if (badMail.length) return showErr($('evError'), 'This committee email doesn\'t look right: ' + badMail.join(', '));
      row.vote_notify_email = mails.join(', ');
      if (row.vote_opens_at && row.vote_closes_at <= row.vote_opens_at) return showErr($('evError'), 'Voting must close after it opens.');
      if (!$('evBallotKind').disabled) {
        row.ballot_kind = $('evBallotKind').value;
        row.ballot_options = row.ballot_kind === 'choice'
          ? $('evOptions').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean)
              .filter(function (s, i, a) { return a.indexOf(s) === i; })
          : [];
        if (row.ballot_kind === 'choice' && row.ballot_options.length < 2) return showErr($('evError'), 'Please enter at least two custom choices, one per line.');
        row.vote_test = $('evVoteTest').checked;
      }
      if (!id && new Date(row.vote_closes_at) <= new Date() &&
          !confirm('The closing time is in the past, so this ballot will not accept any votes. Save anyway?')) return;
    }
    if (row.event_type === 'game') {
      row.game_kind = $('evGameKind').value;
      row.game_prize = $('evGamePrize').value.trim();
      row.game_players = Array.prototype.filter.call(document.querySelectorAll('#evGamePlayers input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
      if (!row.game_players.length) return showErr($('evError'), 'Tick at least one group under "Who can play".');
      row.game_days = Array.prototype.map.call(document.querySelectorAll('.ev-gday'), function (i) { return i.value; });
      if (row.game_days.some(function (d) { return !d; })) return showErr($('evError'), 'Please fill in all five game days.');
      var sorted = row.game_days.slice().sort();
      if (sorted.some(function (d, i) { return i && d === sorted[i - 1]; })) return showErr($('evError'), 'Each game day must be a different date.');
      row.game_days = sorted;
      var endTime = $('evGameEndTime').value || '20:00';
      if (endTime === '00:00') return showErr($('evError'), 'Please pick an end time later than midnight on day 5.');
      row.starts_at = D.fromLocalInput(sorted[0] + 'T00:00');
      row.ends_at = D.fromLocalInput(sorted[4] + 'T' + endTime);
      var wasPractice = !!(events.find(function (x) { return x.id === id; }) || {}).game_practice;
      row.game_practice = $('evGamePractice').checked;
      if (wasPractice && !row.game_practice &&
          !confirm('Turning off practice mode starts the real game. All practice plays will be cleared first. Continue?')) return;
      clearPractice = wasPractice && !row.game_practice;
      row.game_players.forEach(function (p) { if (row.audience.indexOf(p) === -1) row.audience.push(p); });
    } else if (row.event_type) {
      row.game_kind = null;
      row.game_players = [];
      row.game_prize = '';
      row.game_days = [];
      row.game_practice = false;
    }
    if (row.event_type === 'social' && $('evSignupOn').checked) {
      row.signup_enabled = true;
      row.signup_fields = Array.prototype.map.call(document.querySelectorAll('.ev-sf'), function (i) { return i.value.trim(); }).filter(Boolean);
      // Blank closing time = sign-up closes when the event starts.
      row.signup_closes_at = D.fromLocalInput($('evSignupClose').value) || row.starts_at || null;
      row.signup_public = $('evSignupPublic').checked;
    } else if (row.event_type) {
      row.signup_enabled = false;
    }
    if ($('evType').disabled) delete row.event_type;
    var isVoteNow = (row.event_type || (events.find(function (x) { return x.id === id; }) || {}).event_type) === 'vote';
    function write() { return id ? sb.from('events').update(row).eq('id', id).select('id').single() : sb.from('events').insert(row).select('id').single(); }
    // Clear practice plays (while still in practice mode) before switching a game to the real thing.
    var q = clearPractice
      ? sb.rpc('game_admin', { p_event: id, p_action: 'reset' }).then(function (r) { return r.error ? r : write(); })
      : write();
    q.then(function (r) {
      if (r.error) return showErr($('evError'), r.error.message);
      var eid = r.data.id;
      $('evError').hidden = true;
      return (isVoteNow ? saveExclusions(eid) : Promise.resolve(null)).then(function (p1) {
        return saveAttachments(eid).then(function (p2) { return p1 || p2; });
      }).then(function (problem) {
        if (problem) return showErr($('evError'), 'The event was saved, but: ' + problem);
        $('evForm').hidden = true;
        loadEvents();
      });
    });
  }

  /* ---------- Game days ---------- */
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function nextWeekdays() {
    var d = new Date(); d.setHours(12, 0, 0, 0);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 1);
    var out = [];
    for (var i = 0; i < 5; i++) { out.push(ymd(d)); d.setDate(d.getDate() + 1); }
    return out;
  }
  function setGameDays(days) {
    document.querySelectorAll('.ev-gday').forEach(function (inp, i) { inp.value = days[i] || ''; });
  }

  /* ---------- Documents for review (event attachments) ---------- */
  var atList = [], atRemoved = [];

  function setupAttachments() {
    $('atFiles').addEventListener('change', function () {
      var err = $('atError'); err.hidden = true;
      Array.prototype.forEach.call($('atFiles').files, function (f) {
        if (f.size > 25 * 1024 * 1024) { showErr(err, f.name + ' is larger than 25 MB.'); return; }
        atList.push({ title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), file_name: f.name, size_bytes: f.size, file: f });
      });
      $('atFiles').value = '';
      drawAttachments();
    });
    $('atLibrary').addEventListener('change', function () {
      var d = docs.find(function (x) { return x.id === $('atLibrary').value; });
      $('atLibrary').value = '';
      if (!d) return;
      if (atList.some(function (a) { return a.document_id === d.id; })) return;
      atList.push({ title: d.title, file_name: d.file_name, size_bytes: d.size_bytes, document_id: d.id, storage_path: d.storage_path, mime_type: d.mime_type });
      drawAttachments();
    });
    $('atRows').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-at]');
      if (!b) return;
      var i = +b.getAttribute('data-i'), act = b.getAttribute('data-at');
      if (act === 'rm') { var gone = atList.splice(i, 1)[0]; if (gone.id) atRemoved.push(gone); }
      if (act === 'up' && i > 0) atList.splice(i - 1, 0, atList.splice(i, 1)[0]);
      if (act === 'down' && i < atList.length - 1) atList.splice(i + 1, 0, atList.splice(i, 1)[0]);
      if (act === 'open' && atList[i].storage_path) D.openDocument(sb, atList[i].storage_path, atList[i].file_name);
      drawAttachments();
    });
    $('atRows').addEventListener('input', function (e) {
      var inp = e.target.closest('input[data-at-title]');
      if (inp) atList[+inp.getAttribute('data-at-title')].title = inp.value;
    });
  }

  function fillLibrary() {
    $('atLibrary').innerHTML = '<option value="">\u2026or attach from Marina Documents</option>' +
      D.DOC_CATEGORIES.map(function (c) {
        var list = (docs || []).filter(function (d) { return d.category === c.id; });
        return list.length ? '<optgroup label="' + D.esc(c.label) + '">' + list.map(function (d) {
          return '<option value="' + d.id + '">' + D.esc(d.title) + (d.doc_date ? ' (' + D.fmtDay(d.doc_date) + ')' : '') + (d.active ? '' : ' [hidden]') + '</option>';
        }).join('') + '</optgroup>' : '';
      }).join('');
  }

  function drawAttachments() {
    $('atRows').innerHTML = atList.length ? atList.map(function (a, i) {
      var src = a.file ? '<span class="badge badge-notice">New upload</span>' : a.document_id ? '<span class="badge badge-meeting">From Marina Documents</span>' : '<span class="badge badge-social">Uploaded</span>';
      return '<tr><td style="min-width:200px"><input type="text" class="at-title" data-at-title="' + i + '" value="' + D.esc(a.title) + '" maxlength="150" aria-label="Title shown to members"></td>' +
        '<td class="note">' + D.esc(a.file_name) + (a.size_bytes ? ' &middot; ' + D.fileSize(a.size_bytes) : '') + '<br>' + src + '</td>' +
        '<td class="row-actions">' +
          (a.storage_path ? '<button type="button" class="btn-sm" data-at="open" data-i="' + i + '">Open</button>' : '') +
          '<button type="button" class="btn-sm" data-at="up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>&#8593;</button>' +
          '<button type="button" class="btn-sm" data-at="down" data-i="' + i + '"' + (i === atList.length - 1 ? ' disabled' : '') + '>&#8595;</button>' +
          '<button type="button" class="btn-sm btn-danger" data-at="rm" data-i="' + i + '">Remove</button></td></tr>';
    }).join('') : '<tr><td class="note">No documents attached.</td></tr>';
  }

  function loadAttachmentsFor(ev) {
    atList = []; atRemoved = [];
    $('atError').hidden = true;
    fillLibrary();
    if (!ev) { drawAttachments(); return; }
    sb.from('event_attachments').select('*').eq('event_id', ev.id).order('sort_order').then(function (r) {
      atList = (r.data || []).map(function (a) { return Object.assign({}, a, { _origTitle: a.title, _origOrder: a.sort_order }); });
      drawAttachments();
    });
  }

  function safeFileName(n) { return n.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').slice(-80); }

  // Save the attachment list for an event. Returns a problem message, if any.
  function saveAttachments(eventId) {
    var problems = [];
    var jobs = atRemoved.map(function (a) {
      return sb.from('event_attachments').delete().eq('id', a.id).then(function () {
        if (!a.document_id) return sb.storage.from('marina-docs').remove([a.storage_path]);
      });
    });
    return Promise.all(jobs).then(function () {
      return atList.reduce(function (chain, a, i) {
        var order = (i + 1) * 10;
        return chain.then(function () {
          if (a.id) {
            var title = (a.title || '').trim() || a.file_name;
            if (title === a._origTitle && order === a._origOrder) return;
            return sb.from('event_attachments').update({ title: title, sort_order: order }).eq('id', a.id);
          }
          if (a.document_id) {
            return sb.from('event_attachments').insert({ event_id: eventId, document_id: a.document_id, storage_path: a.storage_path,
              title: (a.title || '').trim() || a.file_name, file_name: a.file_name || '', mime_type: a.mime_type || '', size_bytes: a.size_bytes || 0, sort_order: order });
          }
          var path = 'events/' + eventId + '/' + Date.now() + '-' + safeFileName(a.file.name);
          return sb.storage.from('marina-docs').upload(path, a.file, { contentType: a.file.type || 'application/octet-stream', upsert: false }).then(function (up) {
            if (up.error) { problems.push(a.file.name + ': ' + (/mime/i.test(up.error.message) ? 'file type not allowed' : up.error.message)); return; }
            return sb.from('event_attachments').insert({ event_id: eventId, storage_path: path, title: (a.title || '').trim() || a.file_name,
              file_name: a.file.name, mime_type: a.file.type || '', size_bytes: a.file.size, sort_order: order }).then(function (ins) {
              if (ins.error) { problems.push(a.file.name + ': ' + ins.error.message); sb.storage.from('marina-docs').remove([path]); }
            });
          });
        });
      }, Promise.resolve());
    }).then(function () { return problems.length ? 'some documents were not attached (' + problems.join('; ') + ')' : null; });
  }

  /* ---------- Ineligible slips on the vote form ---------- */
  var DEFAULT_REASON = 'In arrears on dues and/or assessment payments';
  var reasons = [], voterSlips = {}, exList = [], exOriginal = {}, exVoted = {};

  function loadReasons() {
    return sb.from('exclusion_reasons').select('label').order('sort_order').order('label').then(function (r) {
      reasons = (r.data || []).map(function (x) { return x.label; });
      if (reasons.indexOf(DEFAULT_REASON) === -1) reasons.unshift(DEFAULT_REASON);
      document.querySelectorAll('.reason-select').forEach(function (sel) { fillReasons(sel, sel.value); });
    });
  }
  function fillReasons(sel, selected) {
    var pick = selected && reasons.indexOf(selected) !== -1 ? selected : (selected && selected !== '__new' ? selected : reasons[0]);
    var opts = reasons.slice();
    if (pick && opts.indexOf(pick) === -1) opts.push(pick);       // keep an older custom reason visible
    sel.innerHTML = opts.map(function (x) { return '<option' + (x === pick ? ' selected' : '') + '>' + D.esc(x) + '</option>'; }).join('') +
      '<option value="__new">+ Add a new reason\u2026</option>';
  }
  // Choosing "+ Add a new reason..." in any reason drop-down.
  document.addEventListener('change', function (e) {
    var sel = e.target;
    if (!sel.classList || !sel.classList.contains('reason-select') || sel.value !== '__new') return;
    var label = (prompt('New reason a slip can be ineligible to vote:') || '').trim().slice(0, 120);
    var prev = sel.getAttribute('data-prev') || reasons[0];
    if (!label) { fillReasons(sel, prev); return; }
    var add = reasons.indexOf(label) === -1 ? sb.from('exclusion_reasons').insert({ label: label }) : Promise.resolve({});
    add.then(function () { return loadReasons(); }).then(function () {
      fillReasons(sel, label);
      sel.setAttribute('data-prev', label);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  document.addEventListener('focusin', function (e) {
    if (e.target.classList && e.target.classList.contains('reason-select')) e.target.setAttribute('data-prev', e.target.value);
  });

  function setupExclusions() {
    loadReasons();
    sb.from('members').select('slip, owner_name, active, can_vote, is_admin').then(function (r) {
      voterSlips = {};
      (r.data || []).forEach(function (m) { if (m.active && m.can_vote && !m.is_admin) voterSlips[m.slip] = m.owner_name; });
      $('exSlipList').innerHTML = Object.keys(voterSlips).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); })
        .map(function (s) { return '<option value="' + D.esc(s) + '">' + D.esc(voterSlips[s]) + '</option>'; }).join('');
    });
    $('exAddBtn').addEventListener('click', addExclusions);
    $('exAddSlips').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addExclusions(); } });
    $('exRows').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ex-rm]');
      if (!b) return;
      var slip = b.getAttribute('data-ex-rm');
      exList = exList.filter(function (x) { return x.slip !== slip; });
      drawExclusions();
    });
    $('exRows').addEventListener('change', function (e) {
      var sel = e.target.closest('select[data-ex-slip]');
      if (!sel || sel.value === '__new') return;
      var x = exList.find(function (y) { return y.slip === sel.getAttribute('data-ex-slip'); });
      if (x) x.reason = sel.value;
    });
  }

  function addExclusions() {
    var err = $('exError'); err.hidden = true;
    var reason = $('exAddReason').value;
    if (!reason || reason === '__new') reason = DEFAULT_REASON;
    var slips = $('exAddSlips').value.toUpperCase().split(/[\s,;]+/).filter(Boolean);
    var bad = [], voted = [];
    slips.forEach(function (s) {
      if (!voterSlips.hasOwnProperty(s)) { bad.push(s); return; }
      if (exVoted[s]) { voted.push(s); return; }
      var x = exList.find(function (y) { return y.slip === s; });
      if (x) x.reason = reason; else exList.push({ slip: s, reason: reason });
    });
    exList.sort(function (a, b) { return a.slip.localeCompare(b.slip, undefined, { numeric: true }); });
    var msg = [];
    if (bad.length) msg.push('Not voting slips (check the number, or the slip is non-voting/inactive): ' + bad.join(', '));
    if (voted.length) msg.push('Already voted, so they can\'t be made ineligible: ' + voted.join(', '));
    if (msg.length) showErr(err, msg.join('. ') + '.');
    $('exAddSlips').value = '';
    drawExclusions();
  }

  function drawExclusions() {
    $('exCount').textContent = exList.length ? '(' + exList.length + ')' : '';
    $('exRows').innerHTML = exList.length ? exList.map(function (x) {
      return '<tr><td><strong>' + D.esc(x.slip) + '</strong></td><td class="note">' + D.esc(voterSlips[x.slip] || '') + '</td>' +
        '<td><select class="reason-select" data-ex-slip="' + D.esc(x.slip) + '" aria-label="Reason for ' + D.esc(x.slip) + '"></select></td>' +
        '<td class="row-actions"><button type="button" class="btn-sm" data-ex-rm="' + D.esc(x.slip) + '">Remove</button></td></tr>';
    }).join('') : '<tr><td class="note">No ineligible slips. Every voting slip can vote.</td></tr>';
    exList.forEach(function (x) { fillReasons($('exRows').querySelector('select[data-ex-slip="' + x.slip + '"]'), x.reason); });
  }

  function loadExclusionsFor(ev) {
    exList = []; exOriginal = {}; exVoted = {};
    $('exError').hidden = true;
    fillReasons($('exAddReason'), DEFAULT_REASON);
    if (!ev || ev.event_type !== 'vote') { drawExclusions(); return; }
    Promise.all([
      sb.from('vote_exclusions').select('slip, reason').eq('event_id', ev.id),
      sb.from('votes').select('slip').eq('event_id', ev.id)
    ]).then(function (r) {
      (r[0].data || []).forEach(function (x) { exList.push({ slip: x.slip, reason: x.reason }); exOriginal[x.slip] = x.reason; });
      (r[1].data || []).forEach(function (v) { exVoted[v.slip] = true; });
      exList.sort(function (a, b) { return a.slip.localeCompare(b.slip, undefined, { numeric: true }); });
      drawExclusions();
    });
  }

  // Bring the database in line with the list on the form. Returns a problem message, if any.
  function saveExclusions(eventId) {
    var keep = {}; exList.forEach(function (x) { keep[x.slip] = x.reason; });
    var removed = Object.keys(exOriginal).filter(function (s) { return !keep.hasOwnProperty(s); });
    var changed = exList.filter(function (x) { return exOriginal[x.slip] !== x.reason; });
    var jobs = [];
    if (removed.length) jobs.push(sb.from('vote_exclusions').delete().eq('event_id', eventId).in('slip', removed));
    if (changed.length) jobs.push(sb.from('vote_exclusions').upsert(changed.map(function (x) { return { event_id: eventId, slip: x.slip, reason: x.reason }; })));
    return Promise.all(jobs).then(function (res) {
      var e = res.filter(function (r) { return r && r.error; })[0];
      return e ? e.error.message : null;
    });
  }

  function updateBallotBox() {
    var isVote = $('evType').value === 'vote';
    $('evBallot').hidden = !isVote;
    $('evOptionsWrap').hidden = $('evBallotKind').value !== 'choice';
    $('evVoteClose').required = isVote;
    var aud = Array.prototype.filter.call(document.querySelectorAll('#evAudience input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
    $('evAudienceLabel').textContent = isVote ? 'Who can see and vote on this' : 'Who can see this';
    $('evExclBox').hidden = isVote && aud.indexOf('certificated') === -1;
    $('evGroupRuleNote').hidden = !aud.some(function (a) { return a !== 'certificated'; });
    var isGame = $('evType').value === 'game';
    $('evGame').hidden = !isGame;
    $('evStartWrap').hidden = isGame;
    $('evAttach').hidden = isGame;
    $('evEndWrap').hidden = isGame;
    var isSocial = $('evType').value === 'social';
    $('evSignup').hidden = !isSocial;
    $('evSignupOpts').hidden = !(isSocial && $('evSignupOn').checked);
  }

  /* ---------- Sign-up sheets ---------- */
  var spEvent = null, spRows = [];

  function setupSignups() {
    $('spClose').addEventListener('click', function () { $('signupPanel').hidden = true; spEvent = null; });
    $('spRefresh').addEventListener('click', function () { if (spEvent) showSignups(spEvent); });
    $('spCsv').addEventListener('click', signupCsv);
    $('spPrint').addEventListener('click', signupPrint);
    $('spRows').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-sp-del]');
      if (!b || !spEvent) return;
      var row = spRows.find(function (x) { return x.id === b.getAttribute('data-sp-del'); });
      if (row && confirm('Remove ' + row.name + ' (slip ' + row.slip + ') from the sign-up sheet?')) {
        sb.from('event_signups').delete().eq('id', row.id).then(function () { showSignups(spEvent); loadEvents(); });
      }
    });
  }

  function showSignups(ev) {
    var same = spEvent && spEvent.id === ev.id;
    spEvent = ev;
    $('spTitle').textContent = 'Sign-ups: ' + ev.title;
    var open = !ev.signup_closes_at || new Date(ev.signup_closes_at) > new Date();
    $('spStatus').textContent = (ev.starts_at ? D.fmtWhen(ev.starts_at, ev.ends_at) + ' · ' : '') +
      (open ? 'Sign-up is open' + (ev.signup_closes_at ? ' until ' + D.fmtWhen(ev.signup_closes_at) : '') : 'Sign-up closed ' + D.fmtWhen(ev.signup_closes_at)) +
      (ev.active ? '' : ' · event is inactive (members can\'t see it)');
    var fields = ev.signup_fields || [];
    $('spHead').innerHTML = '<tr><th>#</th><th>Name</th><th>Slip</th><th>Email</th><th>Phone</th>' +
      fields.map(function (f) { return '<th>' + D.esc(f) + '</th>'; }).join('') + '<th>Signed up</th><th></th></tr>';
    if (!same) $('spRows').innerHTML = '<tr><td colspan="' + (7 + fields.length) + '">Loading&hellip;</td></tr>';
    $('signupPanel').hidden = false;
    if (!same) $('signupPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    sb.from('event_signups').select('*').eq('event_id', ev.id).order('created_at').then(function (r) {
      spRows = r.data || [];
      $('spRows').innerHTML = spRows.length ? spRows.map(function (x, i) {
        return '<tr><td>' + (i + 1) + '</td><td><strong>' + D.esc(x.name) + '</strong></td><td>' + D.esc(x.slip) + '</td>' +
          '<td>' + (x.email ? '<a href="mailto:' + D.esc(x.email) + '">' + D.esc(x.email) + '</a>' : '') + '</td>' +
          '<td>' + (x.phone ? '<a href="tel:' + D.esc(x.phone.replace(/[^\d+]/g, '')) + '">' + D.esc(x.phone) + '</a>' : '') + '</td>' +
          fields.map(function (f, k) { return '<td>' + D.esc((x.answers || [])[k] || '') + '</td>'; }).join('') +
          '<td class="note">' + D.esc(D.fmtWhen(x.created_at)) + '</td>' +
          '<td class="row-actions"><button type="button" class="btn-sm btn-danger" data-sp-del="' + x.id + '">Remove</button></td></tr>';
      }).join('') : '<tr><td colspan="' + (7 + fields.length) + '" class="note">Nobody has signed up yet.</td></tr>';
      $('spStatus').textContent += ' · ' + spRows.length + ' signed up';
    });
  }

  function signupCsv() {
    if (!spEvent) return;
    var fields = spEvent.signup_fields || [];
    function q(s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; }
    var lines = [['Name', 'Slip', 'Email', 'Phone'].concat(fields).concat(['Signed up (Eastern)']).map(q).join(',')];
    spRows.forEach(function (x) {
      lines.push([x.name, x.slip, x.email, x.phone].concat(fields.map(function (f, k) { return (x.answers || [])[k] || ''; }))
        .concat([D.fmtWhen(x.created_at)]).map(q).join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = spEvent.title.replace(/[^\w-]+/g, '_') + '_signups.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function signupPrint() {
    if (!spEvent) return;
    var fields = spEvent.signup_fields || [];
    var w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + D.esc(spEvent.title) + ' sign-ups</title>' +
      '<style>body{font-family:Arial,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%;font-size:12px}' +
      'td,th{border:1px solid #bbb;padding:5px 6px;text-align:left}th{background:#eee}</style></head><body>' +
      '<h2>' + D.esc(spEvent.title) + '</h2><p>' + D.esc(spEvent.starts_at ? D.fmtWhen(spEvent.starts_at, spEvent.ends_at) : '') +
      (spEvent.location ? ' &middot; ' + D.esc(spEvent.location) : '') + ' &middot; ' + spRows.length + ' signed up</p>' +
      '<table><thead><tr><th>#</th><th>Name</th><th>Slip</th><th>Email</th><th>Phone</th>' + fields.map(function (f) { return '<th>' + D.esc(f) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      spRows.map(function (x, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + D.esc(x.name) + '</td><td>' + D.esc(x.slip) + '</td><td>' + D.esc(x.email || '') + '</td><td>' + D.esc(x.phone || '') + '</td>' +
          fields.map(function (f, k) { return '<td>' + D.esc((x.answers || [])[k] || '') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></body></html>');
    w.document.close(); w.focus(); w.print();
  }

  /* ---------- Vote results ---------- */
  var current = null, resultRows = [];

  function setupResults() {
    $('vrClose').addEventListener('click', function () { $('voteResults').hidden = true; current = null; });
    $('vrRefresh').addEventListener('click', function () { if (current) showResults(current); });
    $('vrSearch').addEventListener('input', drawResults);
    $('vrShow').addEventListener('change', drawResults);
    $('vrCsv').addEventListener('click', downloadCsv);
    $('vrPrint').addEventListener('click', printResults);
    $('vrExForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var slips = $('vrExSlips').value.toUpperCase().split(/[\s,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      slips = slips.filter(function (s, i) { return slips.indexOf(s) === i; });
      if (!slips.length) return showErr($('vrExError'), 'Please type at least one slip.');
      excludeSlips(slips, $('vrExReason').value || DEFAULT_REASON);
    });
    $('vrRows').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ex]');
      if (!b || !current) return;
      var slip = b.getAttribute('data-slip');
      if (b.getAttribute('data-ex') === 'add') {
        var reason = $('vrExReason').value || DEFAULT_REASON;
        if (!confirm('Make slip ' + slip + ' ineligible for "' + current.title + '"?\n\nReason: ' + reason +
          '\n\n(To use a different reason, pick it in the "Make slips ineligible" box first.)')) return;
        excludeSlips([slip], reason);
      } else {
        if (!confirm('Restore slip ' + slip + ' so it can vote on "' + current.title + '"?')) return;
        sb.from('vote_exclusions').delete().eq('event_id', current.id).eq('slip', slip).then(function (r) {
          if (r.error) return showErr($('vrExError'), r.error.message);
          showResults(current);
        });
      }
    });
  }

  function excludeSlips(slips, reason) {
    $('vrExError').hidden = true; $('vrExDone').hidden = true;
    var known = {}, problems = [];
    resultRows.forEach(function (r) { known[r.slip] = r; });
    var ok = slips.filter(function (s) {
      if (!known[s]) { problems.push(s + ' (not a voting slip)'); return false; }
      if (known[s].vote) { problems.push(s + ' (already voted)'); return false; }
      return true;
    });
    if (!ok.length) return showErr($('vrExError'), 'Nothing marked: ' + problems.join(', ') + '.');
    sb.from('vote_exclusions').upsert(ok.map(function (s) { return { event_id: current.id, slip: s, reason: reason }; }))
      .then(function (r) {
        if (r.error) return showErr($('vrExError'), r.error.message);
        $('vrExDone').textContent = 'Marked ineligible (' + reason + '): ' + ok.join(', ') + '.' +
          (problems.length ? ' Skipped: ' + problems.join(', ') + '.' : '');
        $('vrExDone').hidden = false;
        $('vrExSlips').value = '';
        showResults(current);
      });
  }

  // Ballots that include shared logins (LTC / STC / staff): those vote by name, so there is no fixed voter list.
  function groupBallot(ev) { return !!(ev && (ev.audience || []).some(function (a) { return a !== 'certificated'; })); }
  function ownersBallot(ev) { return !ev || !ev.audience || !ev.audience.length || ev.audience.indexOf('certificated') !== -1; }

  function showResults(ev) {
    var same = current && current.id === ev.id;
    current = ev;
    $('vrTitle').textContent = 'Results: ' + ev.title;
    $('vrStatus').textContent = D.voteWindowText(ev) + '.';
    if (!same) {
      $('vrRows').innerHTML = '<tr><td colspan="5">Loading&hellip;</td></tr>';
      $('vrTotals').innerHTML = '';
      $('vrExError').hidden = true; $('vrExDone').hidden = true;
    }
    $('voteResults').hidden = false;
    if (!same) $('voteResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
    Promise.all([
      sb.from('members').select('slip, owner_name, active, is_admin, can_vote').eq('is_admin', false),
      sb.from('votes').select('slip, choice, cast_at, voter_name, voter_email').eq('event_id', ev.id),
      sb.from('vote_exclusions').select('slip, reason').eq('event_id', ev.id)
    ]).then(function (r) {
      $('vrOwnerHead').textContent = groupBallot(ev) ? 'Owner / name' : 'Owner';
      var all = r[1].data || [];
      var named = all.filter(function (v) { return v.voter_name; })
        .sort(function (a, b) { return a.cast_at < b.cast_at ? -1 : 1; })
        .map(function (v) { return { slip: v.slip, owner: v.voter_name, email: v.voter_email || '', vote: v, excluded: null, named: true }; });
      var votes = {}, excl = {};
      all.forEach(function (v) { if (!v.voter_name) votes[v.slip] = v; });
      (r[2].data || []).forEach(function (x) { excl[x.slip] = x.reason; });
      resultRows = (r[0].data || [])
        .filter(function (m) { return (m.active && m.can_vote) || votes[m.slip]; })
        .sort(function (a, b) { return a.slip.localeCompare(b.slip, undefined, { numeric: true }); })
        .map(function (m) { return { slip: m.slip, owner: m.owner_name, vote: votes[m.slip] || null, excluded: excl[m.slip] || null }; });
      if (!ownersBallot(ev)) resultRows = resultRows.filter(function (x) { return x.vote; });
      resultRows = resultRows.concat(named);
      drawResults();
    });
  }

  function drawResults() {
    if (!current) return;
    var open = D.voteState(current) !== 'closed';
    var f = $('vrSearch').value.toLowerCase(), show = $('vrShow').value;
    var rows = resultRows.filter(function (r) {
      if (show === 'voted' && !r.vote) return false;
      if (show === 'not' && (r.vote || r.excluded)) return false;
      if (show === 'excluded' && !r.excluded) return false;
      return !f || (r.slip + ' ' + r.owner + ' ' + (r.email || '')).toLowerCase().indexOf(f) !== -1;
    });
    $('vrRows').innerHTML = rows.length ? rows.map(function (r) {
      var status = r.vote ? '<span class="vote-choice">' + D.esc(r.vote.choice) + '</span>'
        : r.excluded ? '<span class="inactive">Ineligible</span> <span class="note">' + D.esc(r.excluded) + '</span>'
        : '<span class="note">Not voted</span>';
      var action = r.vote ? ''
        : r.excluded ? '<button type="button" class="btn-sm" data-ex="remove" data-slip="' + D.esc(r.slip) + '">Restore</button>'
        : (open ? '<button type="button" class="btn-sm btn-danger" data-ex="add" data-slip="' + D.esc(r.slip) + '">Ineligible</button>' : '');
      return '<tr' + (r.excluded ? ' class="row-inactive"' : '') + '><td><strong>' + D.esc(r.slip) + '</strong></td><td>' + D.esc(r.owner) +
        (r.email ? '<div class="note">' + D.esc(r.email) + '</div>' : '') + '</td>' +
        '<td>' + status + '</td>' +
        '<td class="note">' + (r.vote ? D.esc(D.fmtWhen(r.vote.cast_at)) : '') + '</td>' +
        '<td class="row-actions">' + action + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="note">' + (groupBallot(current) ? 'No votes yet.' : 'No slips match.') + '</td></tr>';

    // Running totals (all slips, not just the filtered rows). Ineligible slips don't count.
    var choices = D.ballotChoices(current);
    var counts = {}; choices.forEach(function (c) { counts[c] = 0; });
    var cast = 0, excluded = 0;
    resultRows.forEach(function (r) {
      if (r.excluded) { excluded++; return; }
      if (r.vote) { cast++; counts[r.vote.choice] = (counts[r.vote.choice] || 0) + 1; }
    });
    var eligible = resultRows.filter(function (x) { return !x.named; }).length - excluded;
    function pct(n, d) { return d ? (Math.round(n * 1000 / d) / 10) + '%' : '–'; }
    var maxCount = Math.max.apply(null, choices.map(function (c) { return counts[c]; }));
    if (groupBallot(current)) {
      // No fixed list of voters, so show each choice as a share of the votes cast.
      var namedCast = resultRows.filter(function (x) { return x.named; }).length, ownerCast = cast - namedCast;
      $('vrTurnout').innerHTML = '<strong>' + cast + '</strong> vote' + (cast === 1 ? '' : 's') + ' cast' +
        (ownersBallot(current) ? ' &middot; ' + ownerCast + ' of ' + eligible + ' owner slips (' + pct(ownerCast, eligible) + ') &middot; ' + namedCast + ' by name on shared logins' : '') +
        (excluded ? ' &middot; <span class="inactive">' + excluded + ' ineligible</span>' : '') + '<br>' +
        choices.map(function (c) { return D.esc(c) + ': <strong>' + counts[c] + '</strong> (' + pct(counts[c], cast) + ')'; }).join(' &middot; ');
      $('vrTotals').innerHTML =
        '<tr class="vr-total-head"><td>Running total</td><td>Votes</td><td colspan="3">% of votes cast</td></tr>' +
        choices.map(function (c) {
          var lead = cast && counts[c] === maxCount;
          return '<tr class="vr-total' + (lead ? ' lead' : '') + '"><td><strong>' + D.esc(c) + '</strong></td>' +
            '<td><strong>' + counts[c] + '</strong></td>' +
            '<td colspan="3"><strong>' + pct(counts[c], cast) + '</strong><div class="vr-bar"><span style="width:' + (cast ? counts[c] * 100 / cast : 0) + '%"></span></div></td></tr>';
        }).join('') +
        '<tr class="vr-total"><td>Votes cast</td><td><strong>' + cast + '</strong></td><td colspan="3"></td></tr>';
      return;
    }
    $('vrTurnout').innerHTML = '<strong>' + cast + '</strong> of <strong>' + eligible + '</strong> eligible slips have voted &middot; <strong>' +
      pct(cast, eligible) + '</strong> turnout' +
      (excluded ? ' &middot; <span class="inactive">' + excluded + ' ineligible</span>' : '') + '<br>' +
      choices.map(function (c) {
        return D.esc(c) + ': <strong>' + counts[c] + '</strong> (' + pct(counts[c], eligible) + ')';
      }).join(' &middot; ');
    $('vrTotals').innerHTML =
      '<tr class="vr-total-head"><td>Running total</td><td>Votes</td><td colspan="3">% of all ' + eligible + ' eligible slips</td></tr>' +
      choices.map(function (c) {
        var lead = cast && counts[c] === maxCount;
        return '<tr class="vr-total' + (lead ? ' lead' : '') + '"><td><strong>' + D.esc(c) + '</strong></td>' +
          '<td><strong>' + counts[c] + '</strong></td>' +
          '<td colspan="3"><strong>' + pct(counts[c], eligible) + '</strong><div class="vr-bar"><span style="width:' + (eligible ? counts[c] * 100 / eligible : 0) + '%"></span></div></td></tr>';
      }).join('') +
      '<tr class="vr-total"><td>Voted</td><td><strong>' + cast + '</strong></td><td colspan="3"><strong>' + pct(cast, eligible) + '</strong></td></tr>' +
      '<tr class="vr-total"><td>Not yet voted</td><td>' + (eligible - cast) + '</td><td colspan="3">' + pct(eligible - cast, eligible) + '</td></tr>' +
      (excluded ? '<tr class="vr-total"><td>Ineligible (not counted)</td><td>' + excluded + '</td><td colspan="3"></td></tr>' : '');
  }

  function rowStatus(r) {
    return r.vote ? r.vote.choice : r.excluded ? 'Ineligible: ' + r.excluded : 'Not voted';
  }

  function downloadCsv() {
    if (!current) return;
    function q(s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; }
    var lines = [['Slip', groupBallot(current) ? 'Owner / name' : 'Owner', 'Email (shared logins)', 'Vote', 'Cast at (Eastern)'].map(q).join(',')];
    resultRows.forEach(function (r) {
      lines.push([r.slip, r.owner, r.email || '', rowStatus(r), r.vote ? D.fmtWhen(r.vote.cast_at) : ''].map(q).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = current.title.replace(/[^\w-]+/g, '_') + '_results.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function printResults() {
    if (!current) return;
    var w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + D.esc(current.title) + ' results</title>' +
      '<style>body{font-family:Arial,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%;font-size:12px}' +
      'td,th{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left}tfoot td{font-weight:bold;border-top:2px solid #000}.vr-bar{display:none}</style></head><body>' +
      '<h2>' + D.esc(current.title) + '</h2><p>' + D.esc(D.voteWindowText(current)) + '. Printed ' + D.esc(D.fmtWhen(new Date().toISOString())) + '.</p>' +
      '<table><thead><tr><th>Slip</th><th>' + (groupBallot(current) ? 'Name' : 'Owner') + '</th><th>Vote</th><th>Cast</th><th></th></tr></thead><tbody>' +
      resultRows.map(function (r) {
        return '<tr><td>' + D.esc(r.slip) + '</td><td>' + D.esc(r.owner) + '</td><td>' + D.esc(rowStatus(r)) + '</td><td>' + (r.vote ? D.esc(D.fmtWhen(r.vote.cast_at)) : '') + '</td><td></td></tr>';
      }).join('') + '</tbody><tfoot>' + $('vrTotals').innerHTML + '</tfoot></table></body></html>');
    w.document.close();
    w.focus();
    w.print();
  }

  /* ---------- Documents ---------- */
  function setupDocs() {
    $('docCategory').innerHTML = D.DOC_CATEGORIES.map(function (c) {
      return '<option value="' + c.id + '">' + c.label + '</option>';
    }).join('') + '<option value="review">For Review (email the board, slips or anyone)</option>';
    $('docCategory').addEventListener('change', function () {
      updateDateLabel();
      // New uploads: suggest Public for permits, rules and forms until the box is changed by hand.
      if (!$('docId').value && !docPublicTouched) $('docPublic').checked = PUBLIC_BY_DEFAULT.indexOf($('docCategory').value) !== -1;
    });
    $('docPublic').addEventListener('change', function () { docPublicTouched = true; });
    $('docNew').addEventListener('click', function () { openDocForm(null); });
    $('docCancel').addEventListener('click', function () { $('docForm').hidden = true; });
    $('docForm').addEventListener('submit', saveDoc);
    $('docFile').addEventListener('change', function () {
      var f = $('docFile').files[0];
      if (f && !$('docTitle').value.trim()) $('docTitle').value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    });
    $('docList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var d = docs.find(function (x) { return x.id === b.getAttribute('data-id'); });
      if (!d) return;
      var act = b.getAttribute('data-act');
      if (act === 'open') D.openDocument(sb, d.storage_path, d.file_name, { id: d.id, title: d.title, category: d.category });
      if (act === 'edit') openDocForm(d);
      if (act === 'toggle') sb.from('documents').update({ active: !d.active }).eq('id', d.id).then(loadDocs);
      if (act === 'delete' && confirm('Delete "' + d.title + '" and its file? This cannot be undone.\n\nTip: choose Hide instead to just remove it from the member page.')) {
        sb.storage.from('marina-docs').remove([d.storage_path]).then(function () {
          return sb.from('documents').delete().eq('id', d.id);
        }).then(loadDocs);
      }
    });
    loadDocs();
    setupReviews();
  }

  var PUBLIC_BY_DEFAULT = ['permits', 'rules', 'forms'], docPublicTouched = false;

  function updateDateLabel() {
    var review = $('docCategory').value === 'review';
    var cat = review ? { id: 'review', dateLabel: 'Respond by' } : D.DOC_CATEGORIES.find(function (c) { return c.id === $('docCategory').value; });
    // "For Review": the date is the respond-by date and the description is the message to reviewers.
    $('docReviewNote').hidden = $('rvWho').hidden = !review;
    $('docActiveWrap').hidden = $('docPublicWrap').hidden = review;
    $('docDescLabel').textContent = review ? 'Message to reviewers (optional)' : 'Description (optional)';
    $('docDesc').maxLength = review ? 4000 : 400;
    $('docDesc').rows = review ? 3 : 2;
    $('docTitle').maxLength = review ? 200 : 150;
    $('docFormTitle').textContent = review ? 'Upload a Document for Review' : $('docId').value ? 'Edit Document' : 'Upload Document';
    $('docSave').textContent = review ? 'Upload & Send Invites' : $('docId').value ? 'Save Changes' : 'Upload';
    $('docDateLabel').textContent = cat.dateLabel + (cat.id === 'minutes' ? ' (required)' : ' (optional)');
    $('docDate').required = cat.id === 'minutes';
    $('docMinutesNote').hidden = cat.id !== 'minutes';
    // Board Documents are never public.
    $('docBoardNote').hidden = cat.id !== 'board';
    if (cat.id === 'board') $('docPublic').checked = false;
    $('docPublic').disabled = cat.id === 'board';
  }

  function openDocForm(d) {
    $('docFormTitle').textContent = d ? 'Edit Document' : 'Upload Document';
    $('docSave').textContent = d ? 'Save Changes' : 'Upload';
    $('docId').value = d ? d.id : '';
    $('docCategory').value = d ? d.category : 'minutes';
    $('docCategory').querySelector('option[value=review]').disabled = !!d;  // an existing document can't become a review
    $('rvBoard').checked = true; $('rvSlips').value = ''; $('rvEmails').value = '';
    $('docDate').value = d && d.doc_date ? d.doc_date : '';
    $('docTitle').value = d ? d.title : '';
    $('docDesc').value = d ? d.description : '';
    $('docActive').checked = d ? d.active : true;
    docPublicTouched = false;
    $('docPublic').checked = d ? !!d.is_public : PUBLIC_BY_DEFAULT.indexOf('minutes') !== -1;
    $('docFile').value = '';
    $('docFile').required = !d;
    $('docFileWrap').firstChild.textContent = d
      ? 'Replace file (optional; currently ' + d.file_name + ')'
      : 'File (PDF, Word, Excel, PowerPoint or image; up to 25 MB)';
    updateDateLabel();
    showErr($('docError'), '');
    $('docForm').hidden = false;
    $('docForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function safeName(n) {
    return n.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').slice(-80);
  }

  function saveDoc(e) {
    e.preventDefault();
    if ($('docCategory').value === 'review') return sendForReview();
    var id = $('docId').value;
    var file = $('docFile').files[0];
    var row = {
      category: $('docCategory').value,
      title: $('docTitle').value.trim(),
      description: $('docDesc').value.trim(),
      doc_date: $('docDate').value || null,
      active: $('docActive').checked,
      is_public: $('docPublic').checked
    };
    var err = $('docError');
    if (!row.title) return showErr(err, 'Please enter a title.');
    if (row.category === 'minutes' && !row.doc_date) return showErr(err, 'Minutes need a meeting date so they can be filed under the right month.');
    if (!id && !file) return showErr(err, 'Please choose a file to upload.');
    if (file && file.size > 25 * 1024 * 1024) return showErr(err, 'That file is larger than 25 MB.');

    var btn = $('docSave');
    btn.disabled = true;
    var oldPath = null;
    var chain = Promise.resolve();
    if (file) {
      var year = (row.doc_date || new Date().toISOString()).slice(0, 4);
      var path = row.category + '/' + year + '/' + Date.now() + '-' + safeName(file.name);
      showErr(err, '');
      btn.textContent = 'Uploading\u2026';
      chain = sb.storage.from('marina-docs').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
        .then(function (r) {
          if (r.error) throw new Error(r.error.message.indexOf('mime') !== -1 ? 'That file type is not allowed.' : r.error.message);
          row.storage_path = path;
          row.file_name = file.name;
          row.mime_type = file.type || '';
          row.size_bytes = file.size;
          if (id) oldPath = docs.find(function (x) { return x.id === id; }).storage_path;
        });
    }
    chain.then(function () {
      return id ? sb.from('documents').update(row).eq('id', id) : sb.from('documents').insert(row);
    }).then(function (r) {
      if (r.error) {
        if (row.storage_path) sb.storage.from('marina-docs').remove([row.storage_path]);
        throw new Error(r.error.message);
      }
      if (oldPath) sb.storage.from('marina-docs').remove([oldPath]);
      $('docForm').hidden = true;
      return loadDocs();
    }).catch(function (ex) {
      showErr(err, ex.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = id ? 'Save Changes' : 'Upload';
    });
  }

  var docApprovals = {}, boardSize = 0;
  function docRow(d) {
    return '<tr' + (d.active ? '' : ' class="row-inactive"') + '>' +
      '<td><strong>' + D.esc(d.title) + '</strong>' + (d.description ? '<div class="note">' + D.esc(d.description) + '</div>' : '') + '</td>' +
      '<td>' + (d.doc_date ? D.fmtDay(d.doc_date) : '') + '</td>' +
      '<td class="note">' + D.esc(d.file_name) + '<br>' + D.fileSize(d.size_bytes) + '</td>' +
      '<td>' + (d.approval_status === 'pending'
          ? '<a class="badge badge-board" href="board.html" title="Review and approve on the Board page">Awaiting board approval &rarr;</a><div class="note">' + (docApprovals[d.id] || 0) + ' of ' + boardSize + ' approved &middot; <a href="board.html">Board page</a></div>'
          : (d.active ? 'Visible' : '<span class="inactive">Hidden</span>')) +
        '<div>' + (d.category === 'board' ? '<span class="badge badge-board">Board only</span>' : d.is_public ? '<span class="badge badge-public">Public</span>' : '<span class="badge badge-private">Members only</span>') + '</div></td>' +
      '<td class="row-actions">' +
        '<button type="button" class="btn-sm" data-act="open" data-id="' + d.id + '">Open</button>' +
        '<button type="button" class="btn-sm" data-act="edit" data-id="' + d.id + '">Edit</button>' +
        '<button type="button" class="btn-sm" data-act="toggle" data-id="' + d.id + '">' + (d.active ? 'Hide' : 'Show') + '</button>' +
        '<button type="button" class="btn-sm btn-danger" data-act="delete" data-id="' + d.id + '">Delete</button>' +
      '</td></tr>';
  }

  function loadDocs() {
    return Promise.all([
      sb.from('documents').select('*').order('doc_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
      sb.from('document_approvals').select('document_id, approved_at').not('approved_at', 'is', null),
      sb.from('members').select('slip', { count: 'exact', head: true }).eq('is_board', true).eq('active', true)
    ]).then(function (res) {
      var r = res[0];
      docs = r.data || [];
      docApprovals = {};
      (res[1].data || []).forEach(function (a) { docApprovals[a.document_id] = (docApprovals[a.document_id] || 0) + 1; });
      boardSize = res[2].count || 0;
      var head = '<thead><tr><th>Title</th><th>Date</th><th>File</th><th>Status</th><th></th></tr></thead>';
      var html = D.DOC_CATEGORIES.map(function (c) {
        var list = docs.filter(function (d) { return d.category === c.id; });
        var body;
        if (!list.length) {
          body = '<p class="note" style="margin:0">Nothing uploaded yet.</p>';
        } else if (c.id === 'minutes') {
          var months = [], byMonth = {};
          list.forEach(function (d) {
            var k = D.monthKey(d.doc_date);
            if (!byMonth[k]) { byMonth[k] = []; months.push(k); }
            byMonth[k].push(d);
          });
          body = months.map(function (m) {
            return '<h4 class="month-head">' + m + '</h4><div class="admin-table-wrap"><table class="admin-table">' + head + '<tbody>' + byMonth[m].map(docRow).join('') + '</tbody></table></div>';
          }).join('');
        } else {
          body = '<div class="admin-table-wrap"><table class="admin-table">' + head + '<tbody>' + list.map(docRow).join('') + '</tbody></table></div>';
        }
        return '<div class="portal-card"><h3>' + c.label + ' <span class="count">(' + list.length + ')</span></h3>' + body + '</div>';
      }).join('');
      $('docList').innerHTML = html;
    });
  }

  /* ---------- Gallery photos ---------- */
  var galPhotos = [], galWired = false;

  function setupGallery() {
    if (galWired) return;
    galWired = true;
    $('galForm').addEventListener('submit', uploadPhotos);
    $('galList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-gal]');
      if (!b) return;
      var p = galPhotos.find(function (x) { return x.id === b.getAttribute('data-id'); });
      if (!p) return;
      var act = b.getAttribute('data-gal');
      if (act === 'up' || act === 'down') movePhoto(p, act === 'up' ? -1 : 1);
      if (act === 'toggle') sb.from('gallery_photos').update({ active: !p.active }).eq('id', p.id).then(loadGallery);
      if (act === 'save') {
        var text = document.querySelector('textarea[data-cap="' + p.id + '"]').value.trim();
        sb.from('gallery_photos').update({ caption: text }).eq('id', p.id).then(function (r) {
          if (r.error) return alert(r.error.message);
          b.textContent = 'Saved ✓';
          setTimeout(function () { b.textContent = 'Save description'; }, 1500);
          p.caption = text;
        });
      }
      if (act === 'delete' && confirm('Delete this photo from the gallery? This cannot be undone.\n\nTip: choose Hide instead to just take it off the Gallery page.')) {
        var gone = p.storage_path ? sb.storage.from('gallery').remove([p.storage_path]) : Promise.resolve();
        gone.then(function () { return sb.from('gallery_photos').delete().eq('id', p.id); }).then(loadGallery);
      }
    });
    loadGallery();
  }

  function loadGallery() {
    return sb.from('gallery_photos').select('*').order('sort_order').order('created_at').then(function (r) {
      galPhotos = r.data || [];
      var shown = galPhotos.filter(function (p) { return p.active; }).length;
      $('galCount').textContent = galPhotos.length + ' photos · ' + shown + ' showing on the Gallery page';
      $('galList').innerHTML = galPhotos.length ? galPhotos.map(function (p, i) {
        return '<div class="gal-card' + (p.active ? '' : ' hidden-photo') + '">' +
          '<div class="gal-thumb"><img src="' + D.esc(p.src) + '" alt="" loading="lazy">' +
            '<span class="gal-pos">' + (i + 1) + '</span>' + (p.active ? '' : '<span class="gal-flag">Hidden</span>') + '</div>' +
          '<textarea rows="3" maxlength="300" data-cap="' + p.id + '">' + D.esc(p.caption) + '</textarea>' +
          '<div class="gal-actions">' +
            '<button type="button" class="btn-sm" data-gal="up" data-id="' + p.id + '"' + (i === 0 ? ' disabled' : '') + ' title="Move earlier">&#8593;</button>' +
            '<button type="button" class="btn-sm" data-gal="down" data-id="' + p.id + '"' + (i === galPhotos.length - 1 ? ' disabled' : '') + ' title="Move later">&#8595;</button>' +
            '<button type="button" class="btn-sm btn-primary-sm" data-gal="save" data-id="' + p.id + '">Save description</button>' +
            '<button type="button" class="btn-sm" data-gal="toggle" data-id="' + p.id + '">' + (p.active ? 'Hide' : 'Show') + '</button>' +
            '<button type="button" class="btn-sm btn-danger" data-gal="delete" data-id="' + p.id + '">Delete</button>' +
          '</div></div>';
      }).join('') : '<p class="note">No photos yet.</p>';
    });
  }

  function movePhoto(p, dir) {
    var i = galPhotos.indexOf(p), j = i + dir;
    if (j < 0 || j >= galPhotos.length) return;
    var order = galPhotos.slice();
    order.splice(j, 0, order.splice(i, 1)[0]);
    var updates = [];
    order.forEach(function (x, k) {
      var want = (k + 1) * 10;
      if (x.sort_order !== want) updates.push(sb.from('gallery_photos').update({ sort_order: want }).eq('id', x.id));
    });
    Promise.all(updates).then(loadGallery);
  }

  // Shrink big photos (longest side 2400px) before upload so the gallery loads fast.
  function shrink(file) {
    return new Promise(function (resolve) {
      if (file.type === 'image/gif') return resolve({ blob: file, type: file.type, ext: 'gif' });
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 2400, w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, max / Math.max(w, h));
        if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
          URL.revokeObjectURL(url);
          return resolve({ blob: file, type: file.type, ext: (file.name.split('.').pop() || 'jpg').toLowerCase(), w: w, h: h });
        }
        var c = document.createElement('canvas');
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        c.toBlob(function (b) { resolve({ blob: b || file, type: type, ext: type === 'image/png' ? 'png' : 'jpg', w: c.width, h: c.height }); }, type, 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve({ blob: file, type: file.type, ext: 'jpg' }); };
      img.src = url;
    });
  }

  function uploadPhotos(e) {
    e.preventDefault();
    var files = Array.prototype.slice.call($('galFiles').files);
    var err = $('galError'), done = $('galDone');
    err.hidden = true; done.hidden = true;
    if (!files.length) return showErr(err, 'Please choose at least one photo.');
    var bad = files.filter(function (f) { return !/^image\/(jpeg|png|webp|gif)$/.test(f.type); });
    if (bad.length) return showErr(err, 'These aren\'t JPG, PNG, WebP or GIF photos: ' + bad.map(function (f) { return f.name; }).join(', '));
    var btn = $('galUpload'); btn.disabled = true;
    var caption = $('galCaption').value.trim();
    var nextOrder = galPhotos.reduce(function (m, p) { return Math.max(m, p.sort_order); }, 0);
    var cfg = MemberAuth.config, added = 0, failed = [];

    files.reduce(function (chain, f, k) {
      return chain.then(function () {
        btn.textContent = 'Uploading ' + (k + 1) + ' of ' + files.length + '\u2026';
        return shrink(f).then(function (s) {
          var base = f.name.replace(/\.[^.]+$/, '');
          var path = new Date().getFullYear() + '/' + Date.now() + '-' + base.normalize('NFKD').replace(/[^\w-]+/g, '-').slice(0, 60) + '.' + s.ext;
          return sb.storage.from('gallery').upload(path, s.blob, { contentType: s.type, upsert: false }).then(function (up) {
            if (up.error) throw new Error(up.error.message);
            nextOrder += 10;
            return sb.from('gallery_photos').insert({
              src: cfg.url + '/storage/v1/object/public/gallery/' + path,
              storage_path: path,
              caption: caption && files.length === 1 ? caption : (caption ? caption + ' (' + (k + 1) + ')' : base.replace(/[_-]+/g, ' ')),
              sort_order: nextOrder, width: s.w || null, height: s.h || null, size_bytes: s.blob.size
            }).then(function (ins) {
              if (ins.error) { sb.storage.from('gallery').remove([path]); throw new Error(ins.error.message); }
              added++;
            });
          });
        }).catch(function (ex) { failed.push(f.name + ' (' + ex.message + ')'); });
      });
    }, Promise.resolve()).then(function () {
      btn.disabled = false; btn.textContent = 'Upload';
      if (added) {
        done.textContent = added + ' photo' + (added > 1 ? 's' : '') + ' added to the end of the gallery.';
        done.hidden = false;
        $('galForm').reset();
      }
      if (failed.length) showErr(err, 'Not uploaded: ' + failed.join('; '));
      loadGallery();
    });
  }

  /* ---------- Gallery videos ---------- */
  var vids = [], vidWired = false, vidParsed = null;

  function setupVideos() {
    if (vidWired) return;
    vidWired = true;
    var V = window.VideoUtils;
    var lookupTimer = null;
    $('vidUrl').addEventListener('input', function () {
      clearTimeout(lookupTimer);
      lookupTimer = setTimeout(detectVideo, 400);
    });
    function detectVideo() {
      var raw = $('vidUrl').value.trim();
      vidParsed = raw ? V.parse(raw) : null;
      if (!vidParsed) { $('vidDetected').textContent = 'For YouTube and Vimeo, the title and credit fill in automatically after you paste the link.'; return; }
      if (vidParsed.error) { $('vidDetected').innerHTML = '<span class="inactive">' + D.esc(vidParsed.error) + '</span>'; return; }
      $('vidDetected').textContent = V.name(vidParsed.provider) + ' video recognized' + (vidParsed.vertical ? ' (tall/vertical format)' : '') + '.';
      var oembed = vidParsed.provider === 'youtube' ? 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + vidParsed.id)
        : vidParsed.provider === 'vimeo' ? 'https://vimeo.com/api/oembed.json?url=' + encodeURIComponent('https://vimeo.com/' + vidParsed.id) : null;
      if (!oembed) return;
      fetch(oembed).then(function (r) { return r.ok ? r.json() : null; }).then(function (o) {
        if (!o) return;
        if (!$('vidTitle').value.trim() && o.title) $('vidTitle').value = o.title;
        if (!$('vidCredit').value.trim() && o.author_name) $('vidCredit').value = o.author_name;
      }).catch(function () {});
    }

    $('vidForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('vidError'), done = $('vidDone');
      err.hidden = true; done.hidden = true;
      var p = V.parse($('vidUrl').value);
      if (p.error) return showErr(err, p.error);
      var title = $('vidTitle').value.trim();
      if (!title) return showErr(err, 'Please enter a title.');
      if (vids.some(function (v) { return v.provider === p.provider && v.video_id === p.id; })) return showErr(err, 'That video is already in the list.');
      var order = vids.reduce(function (m, v) { return Math.max(m, v.sort_order); }, 0) + 10;
      $('vidSave').disabled = true;
      sb.from('gallery_videos').insert({
        url: p.url, provider: p.provider, video_id: p.id, title: title,
        credit: $('vidCredit').value.trim(), description: $('vidDesc').value.trim(), sort_order: order
      }).then(function (r) {
        $('vidSave').disabled = false;
        if (r.error) return showErr(err, r.error.message);
        done.textContent = '"' + title + '" added to the end of the Videos page.';
        done.hidden = false;
        $('vidForm').reset();
        $('vidDetected').textContent = 'For YouTube and Vimeo, the title and credit fill in automatically after you paste the link.';
        loadVideos();
      });
    });

    $('vidList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-vid]');
      if (!b) return;
      var v = vids.find(function (x) { return x.id === b.getAttribute('data-id'); });
      if (!v) return;
      var act = b.getAttribute('data-vid');
      if (act === 'up' || act === 'down') moveVideo(v, act === 'up' ? -1 : 1);
      if (act === 'toggle') sb.from('gallery_videos').update({ active: !v.active }).eq('id', v.id).then(loadVideos);
      if (act === 'save') {
        var card = b.closest('.gal-card');
        var upd = { title: card.querySelector('[data-f="title"]').value.trim(), credit: card.querySelector('[data-f="credit"]').value.trim(),
                    description: card.querySelector('[data-f="desc"]').value.trim() };
        if (!upd.title) return alert('Please enter a title.');
        sb.from('gallery_videos').update(upd).eq('id', v.id).then(function (r) {
          if (r.error) return alert(r.error.message);
          Object.assign(v, upd);
          b.textContent = 'Saved ✓';
          setTimeout(function () { b.textContent = 'Save'; }, 1500);
        });
      }
      if (act === 'delete' && confirm('Remove "' + v.title + '" from the gallery? (The video itself stays on ' + V.name(v.provider) + '.)')) {
        sb.from('gallery_videos').delete().eq('id', v.id).then(loadVideos);
      }
    });
    loadVideos();
  }

  function loadVideos() {
    var V = window.VideoUtils;
    return sb.from('gallery_videos').select('*').order('sort_order').order('created_at').then(function (r) {
      vids = r.data || [];
      var shown = vids.filter(function (v) { return v.active; }).length;
      $('vidCount').textContent = vids.length + ' video' + (vids.length === 1 ? '' : 's') + ' · ' + shown + ' showing on the Videos page';
      $('vidList').innerHTML = vids.length ? vids.map(function (v, i) {
        var thumb = V.thumbUrl(v);
        return '<div class="gal-card' + (v.active ? '' : ' hidden-photo') + '">' +
          '<div class="gal-thumb video-thumb vt-' + D.esc(v.provider) + '">' +
            (thumb ? '<img src="' + D.esc(thumb) + '" alt="" loading="lazy">' : '<span class="vt-name">' + D.esc(V.name(v.provider)) + '</span>') +
            '<span class="gal-pos">' + (i + 1) + '</span>' + (v.active ? '' : '<span class="gal-flag">Hidden</span>') +
            '<span class="video-source">' + D.esc(V.name(v.provider)) + '</span></div>' +
          '<div class="vid-fields">' +
            '<input type="text" data-f="title" maxlength="200" value="' + D.esc(v.title) + '" aria-label="Title">' +
            '<input type="text" data-f="credit" maxlength="120" value="' + D.esc(v.credit) + '" placeholder="Credit" aria-label="Credit">' +
            '<input type="text" data-f="desc" maxlength="300" value="' + D.esc(v.description) + '" placeholder="Short description" aria-label="Description">' +
            '<a href="' + D.esc(v.url) + '" target="_blank" rel="noopener" class="note">Open on ' + D.esc(V.name(v.provider)) + ' &#8599;</a>' +
          '</div>' +
          '<div class="gal-actions">' +
            '<button type="button" class="btn-sm" data-vid="up" data-id="' + v.id + '"' + (i === 0 ? ' disabled' : '') + ' title="Move earlier">&#8593;</button>' +
            '<button type="button" class="btn-sm" data-vid="down" data-id="' + v.id + '"' + (i === vids.length - 1 ? ' disabled' : '') + ' title="Move later">&#8595;</button>' +
            '<button type="button" class="btn-sm btn-primary-sm" data-vid="save" data-id="' + v.id + '">Save</button>' +
            '<button type="button" class="btn-sm" data-vid="toggle" data-id="' + v.id + '">' + (v.active ? 'Hide' : 'Show') + '</button>' +
            '<button type="button" class="btn-sm btn-danger" data-vid="delete" data-id="' + v.id + '">Remove</button>' +
          '</div></div>';
      }).join('') : '<p class="note">No videos yet.</p>';
    });
  }

  function moveVideo(v, dir) {
    var i = vids.indexOf(v), j = i + dir;
    if (j < 0 || j >= vids.length) return;
    var order = vids.slice();
    order.splice(j, 0, order.splice(i, 1)[0]);
    Promise.all(order.map(function (x, k) {
      var want = (k + 1) * 10;
      return x.sort_order === want ? null : sb.from('gallery_videos').update({ sort_order: want }).eq('id', x.id);
    })).then(loadVideos);
  }

  /* ---------- Documents out for review ---------- */
  var reviews = [], reviewers = {}, rvOpen = {};

  function callReview(payload) {
    return sb.functions.invoke('review', { body: payload }).then(function (r) {
      if (r.error) {
        var ctx = r.error.context;
        if (ctx && typeof ctx.json === 'function') {
          return ctx.json().then(function (b) { throw new Error(b.error || r.error.message); }, function () { throw new Error(r.error.message); });
        }
        throw new Error(r.error.message);
      }
      if (r.data && r.data.error) throw new Error(r.data.error);
      return r.data;
    });
  }

  // What happened with an invite, in words ("3 invited. Slip Z9 wasn't found.").
  function inviteSummary(r) {
    var bits = [];
    bits.push(r.added ? r.added + ' invitation' + (r.added > 1 ? 's' : '') + ' sent' + (r.failed ? ' (' + r.failed + ' could not be emailed; use Resend later)' : '') + '.' : 'No new reviewers.');
    if (r.already) bits.push(r.already + ' already invited.');
    if (r.unknown && r.unknown.length) bits.push('Not found: slip ' + r.unknown.join(', ') + '.');
    if (r.noEmail && r.noEmail.length) bits.push('No email on file for slip ' + r.noEmail.join(', ') + '.');
    if (r.badEmail && r.badEmail.length) bits.push('Not a valid email: ' + r.badEmail.join(', ') + '.');
    return bits.join(' ');
  }

  function setupReviews() {
    sb.from('members').select('slip', { count: 'exact', head: true }).eq('is_board', true).eq('active', true).then(function (r) {
      $('rvBoardCount').textContent = r.count ? '(' + r.count + ' members)' : '';
    });
    $('rvList').addEventListener('click', reviewClick);
    $('rvList').addEventListener('submit', function (e) {
      var f = e.target.closest('form[data-rv-add]');
      if (!f) return;
      e.preventDefault();
      var id = f.getAttribute('data-rv-add'), msg = f.querySelector('.rv-add-msg'), btn = f.querySelector('button[type=submit]');
      btn.disabled = true; msg.textContent = 'Sending…'; msg.hidden = false;
      callReview({ action: 'invite', review_id: id, board: f.querySelector('[name=board]').checked,
        slips: f.querySelector('[name=slips]').value, emails: f.querySelector('[name=emails]').value })
        .then(function (r) { rvOpen[id] = inviteSummary(r); return loadReviews(); })
        .catch(function (ex) { msg.textContent = ex.message; btn.disabled = false; });
    });
    loadReviews();
  }

  // Upload Document form with Section "For Review": upload the file, then email the reviewers.
  function sendForReview() {
    var err = $('docError'), btn = $('docSave'), file = $('docFile').files[0];
    var title = $('docTitle').value.trim();
    var board = $('rvBoard').checked, slips = $('rvSlips').value.trim(), emails = $('rvEmails').value.trim();
    if (!title) return showErr(err, 'Please enter a title.');
    if (!file) return showErr(err, 'Please choose a file.');
    if (file.size > 25 * 1024 * 1024) return showErr(err, 'That file is larger than 25 MB.');
    if (!board && !slips && !emails) return showErr(err, 'Choose who should review it: the board, some slips, or email addresses.');
    showErr(err, '');
    btn.disabled = true; btn.textContent = 'Uploading\u2026';
    var path = 'reviews/' + new Date().getFullYear() + '/' + Date.now() + '-' + safeName(file.name), reviewId = null;
    sb.storage.from('marina-docs').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
      .then(function (r) {
        if (r.error) throw new Error(r.error.message.indexOf('mime') !== -1 ? 'That file type is not allowed.' : r.error.message);
        return sb.from('doc_reviews').insert({ title: title, message: $('docDesc').value.trim(), due_date: $('docDate').value || null,
          storage_path: path, file_name: file.name, mime_type: file.type || '', size_bytes: file.size }).select('id').single();
      })
      .then(function (r) {
        if (r.error) { sb.storage.from('marina-docs').remove([path]); throw new Error(r.error.message); }
        reviewId = r.data.id;
        btn.textContent = 'Sending invites\u2026';
        return callReview({ action: 'invite', review_id: reviewId, board: board, slips: slips, emails: emails });
      })
      .then(function (r) {
        rvOpen[reviewId] = inviteSummary(r);
        $('docForm').hidden = true;
        return loadReviews().then(function () { $('rvSection').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      })
      .catch(function (ex) {
        showErr(err, reviewId ? 'The document was saved, but invites were not sent: ' + ex.message + ' You can add reviewers from the Out for Review list.' : ex.message);
        if (reviewId) loadReviews();
      })
      .then(function () { btn.disabled = false; btn.textContent = 'Upload & Send Invites'; });
  }

  var DECISION = { approved: ['Approved', 'badge-public'], changes: ['Changes requested', 'badge-returned'], comment: ['Commented', 'badge-meeting'] };

  function loadReviews() {
    return Promise.all([
      sb.from('doc_reviews').select('*').order('created_at', { ascending: false }).limit(100),
      sb.from('doc_reviewers').select('*').limit(5000)
    ]).then(function (res) {
      if (res[0].error) { $('rvSection').hidden = true; return; }
      reviews = res[0].data || [];
      reviewers = {};
      (res[1].data || []).forEach(function (x) { (reviewers[x.review_id] = reviewers[x.review_id] || []).push(x); });
      $('rvSection').hidden = !reviews.length;
      reviews.sort(function (a, b) { return (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1); });
      $('rvList').innerHTML = reviews.map(reviewCard).join('');
    });
  }

  function reviewCard(rv) {
    var list = (reviewers[rv.id] || []).slice().sort(function (a, b) {
      return (a.via === 'board' ? 0 : a.via === 'slip' ? 1 : 2) - (b.via === 'board' ? 0 : b.via === 'slip' ? 1 : 2) || (a.name || a.email).localeCompare(b.name || b.email);
    });
    var n = list.length, done = list.filter(function (x) { return x.decision; });
    var appr = done.filter(function (x) { return x.decision === 'approved'; }).length;
    var chg = done.filter(function (x) { return x.decision === 'changes'; }).length;
    var opened = list.filter(function (x) { return x.viewed_at; }).length;
    var open = rv.id in rvOpen;
    var pct = n ? Math.round(done.length * 100 / n) : 0;
    var html = '<div class="portal-card rv-card' + (rv.status === 'closed' ? ' rv-closed' : '') + '">' +
      '<div class="rv-card-head"><div><strong>' + D.esc(rv.title) + '</strong> ' +
        (rv.status === 'closed' ? '<span class="badge badge-private">Closed</span>' : '<span class="badge badge-notice">Open</span>') +
        '<div class="note">Sent ' + D.esc(D.fmtWhen(rv.created_at)) + (rv.due_date ? ' &middot; respond by ' + D.esc(D.fmtDay(rv.due_date)) : '') +
        ' &middot; ' + D.esc(rv.file_name) + (rv.size_bytes ? ' (' + D.fileSize(rv.size_bytes) + ')' : '') + '</div></div>' +
        '<div class="row-actions">' +
          '<button type="button" class="btn-sm" data-rv="open" data-id="' + rv.id + '">Open file</button>' +
          '<button type="button" class="btn-sm" data-rv="toggle" data-id="' + rv.id + '">' + (open ? 'Hide responses' : 'Responses') + '</button>' +
          '<button type="button" class="btn-sm" data-rv="status" data-id="' + rv.id + '">' + (rv.status === 'open' ? 'Close review' : 'Reopen') + '</button>' +
          '<button type="button" class="btn-sm btn-danger" data-rv="delete" data-id="' + rv.id + '">Delete</button>' +
        '</div></div>' +
      '<div class="rv-progress" title="' + done.length + ' of ' + n + ' responded"><div class="an-chart-track"><div class="an-chart-bar" style="width:' + pct + '%"></div></div>' +
        '<span><strong>' + done.length + ' of ' + n + '</strong> responded &middot; ' + appr + ' approved' + (chg ? ' &middot; <strong>' + chg + ' want changes</strong>' : '') + ' &middot; ' + opened + ' opened it</span></div>';
    if (open) {
      if (rvOpen[rv.id]) html += '<p class="member-login-note" style="margin:10px 0 0">' + D.esc(rvOpen[rv.id]) + '</p>';
      html += '<div class="admin-table-wrap" style="margin-top:10px"><table class="admin-table"><thead><tr><th>Reviewer</th><th>Invited</th><th>Opened</th><th>Response</th><th></th></tr></thead><tbody>' +
        (list.length ? list.map(function (x) {
          var d = DECISION[x.decision];
          var via = x.via === 'board' ? 'Board' + (x.slip ? ' &middot; slip ' + D.esc(x.slip) : '') : x.via === 'slip' ? 'Slip ' + D.esc(x.slip) : 'Email invite';
          return '<tr><td><strong>' + D.esc(x.name || x.email) + '</strong><div class="note">' + via + (x.name ? ' &middot; ' + D.esc(x.email) : '') + '</div></td>' +
            '<td class="nowrap">' + (x.email_status === 'sent' ? D.esc(D.fmtWhen(x.invited_at)) : x.email_status === 'failed' ? '<span class="inactive" title="' + D.esc(x.email_error || '') + '">Email failed</span>' : '<span class="note">Not sent</span>') + '</td>' +
            '<td class="nowrap">' + (x.viewed_at ? D.esc(D.fmtWhen(x.viewed_at)) : '<span class="note">No</span>') + '</td>' +
            '<td>' + (d ? '<span class="badge ' + d[1] + '">' + d[0] + '</span> <span class="note">' + D.esc(D.fmtWhen(x.responded_at)) + '</span>' +
              (x.comment ? '<div class="rv-comment">' + D.esc(x.comment).replace(/\n/g, '<br>') + '</div>' : '') : '<span class="note">Waiting</span>') + '</td>' +
            '<td class="row-actions"><button type="button" class="btn-sm" data-rv="resend" data-id="' + x.id + '">Resend</button>' +
              '<button type="button" class="btn-sm btn-danger" data-rv="remove" data-id="' + x.id + '">Remove</button></td></tr>';
        }).join('') : '<tr><td colspan="5" class="note">No reviewers yet.</td></tr>') + '</tbody></table></div>';
      if (rv.status === 'open') {
        var hasBoard = list.some(function (x) { return x.via === 'board'; });
        html += '<form class="rv-add" data-rv-add="' + rv.id + '"><strong>Add reviewers</strong>' +
          '<label class="check"><input type="checkbox" name="board"> <span>The Board' + (hasBoard ? ' <span class="note">(anyone new on the board)</span>' : '') + '</span></label>' +
          '<input type="text" name="slips" placeholder="Slips, e.g. A12, B7" aria-label="Slips">' +
          '<input type="text" name="emails" placeholder="Emails, e.g. pat@example.com" aria-label="Email addresses">' +
          '<button type="submit" class="btn-sm btn-primary-sm">Send invites</button>' +
          '<span class="note rv-add-msg" hidden></span></form>';
      }
    }
    return html + '</div>';
  }

  function reviewClick(e) {
    var b = e.target.closest('button[data-rv]');
    if (!b) return;
    var act = b.getAttribute('data-rv'), id = b.getAttribute('data-id');
    var rv = reviews.find(function (x) { return x.id === id; });
    if (act === 'open' && rv) D.openDocument(sb, rv.storage_path, rv.file_name, { id: rv.id, title: rv.title, category: 'review' });
    if (act === 'toggle') { if (id in rvOpen) delete rvOpen[id]; else rvOpen[id] = ''; $('rvList').innerHTML = reviews.map(reviewCard).join(''); }
    if (act === 'status' && rv) {
      sb.from('doc_reviews').update({ status: rv.status === 'open' ? 'closed' : 'open' }).eq('id', id).then(loadReviews);
    }
    if (act === 'delete' && rv && confirm('Delete the review "' + rv.title + '", its file and all responses? This cannot be undone.\n\nTip: Close review keeps the responses but stops new ones.')) {
      sb.storage.from('marina-docs').remove([rv.storage_path]).then(function () {
        return sb.from('doc_reviews').delete().eq('id', id);
      }).then(function () { delete rvOpen[id]; return loadReviews(); });
    }
    var who = null;
    Object.keys(reviewers).some(function (k) { who = reviewers[k].find(function (x) { return x.id === id; }); return who; });
    if (act === 'resend' && who) {
      b.disabled = true; b.textContent = 'Sending…';
      callReview({ action: 'resend', reviewer_id: id }).then(function () {
        rvOpen[who.review_id] = 'Sent the review link to ' + (who.name || who.email) + ' again.';
        return loadReviews();
      }).catch(function (ex) { alert(ex.message); b.disabled = false; b.textContent = 'Resend'; });
    }
    if (act === 'remove' && who && confirm('Remove ' + (who.name || who.email) + ' from this review? Their link will stop working' + (who.decision ? ' and their response will be deleted' : '') + '.')) {
      sb.from('doc_reviewers').delete().eq('id', id).then(loadReviews);
    }
  }

  /* ---------- Email members (announcements) ---------- */
  var anWired = false, anCounts = {};

  function callAnnounce(payload) {
    return sb.functions.invoke('announce', { body: payload }).then(function (r) {
      if (r.error) {
        var ctx = r.error.context;
        if (ctx && typeof ctx.json === 'function') {
          return ctx.json().then(function (b) { throw new Error(b.error || r.error.message); }, function () { throw new Error(r.error.message); });
        }
        throw new Error(r.error.message);
      }
      if (r.data && r.data.error) throw new Error(r.data.error);
      return r.data;
    });
  }

  function anTarget() {
    var aud = $('anAudience').value;
    var t = { audience: aud };
    if (aud === 'docks') t.docks = Array.prototype.filter.call(document.querySelectorAll('#anDocks input'), function (c) { return c.checked; }).map(function (c) { return c.value; });
    if (aud === 'slips') t.slips = $('anSlips').value;
    return t;
  }
  function anTargetKey() { return JSON.stringify(anTarget()); }

  // Files attached to the email. Each is uploaded once (on the first test or send) and reused.
  var anFiles = [], AN_MAX_BYTES = 15 * 1024 * 1024;
  function anSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function anFilesTooBig() { return anFiles.reduce(function (n, f) { return n + f.size; }, 0) > AN_MAX_BYTES; }
  function renderAnFiles() {
    $('anFileList').innerHTML = anFiles.map(function (f, i) {
      return '<li>&#128206; ' + D.esc(f.name) + ' <span class="note">' + anSize(f.size) + '</span><button type="button" data-an-unattach="' + i + '" title="Remove" aria-label="Remove ' + D.esc(f.name) + '">&times;</button></li>';
    }).join('');
    previewAnnouncement();
  }
  function uploadAnFiles() {
    var folder = 'announcements/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '/';
    return anFiles.reduce(function (chain, f) {
      return chain.then(function () {
        if (f.path) return;
        var path = folder + (f.name.replace(/[^\w.\-]+/g, '_') || 'file');
        return sb.storage.from('marina-docs').upload(path, f.file, { contentType: f.file.type || 'application/octet-stream', upsert: false }).then(function (up) {
          if (up.error) throw new Error('Could not upload ' + f.name + ': ' + up.error.message);
          f.path = path;
        });
      });
    }, Promise.resolve()).then(function () {
      return anFiles.map(function (f) { return { name: f.name, path: f.path, size: f.size }; });
    });
  }
  // Emails with attachments go out one at a time, so a big send can take several calls; keep going until done.
  function anKeepSending(r, onProgress) {
    if (!r.more) return Promise.resolve(r);
    if (onProgress) onProgress(r);
    return callAnnounce({ action: 'resume', announcement_id: r.id }).then(function (r2) { return anKeepSending(r2, onProgress); });
  }

  function setupAnnouncements() {
    if (anWired) return;
    anWired = true;
    var countTimer = null;
    function recount() { clearTimeout(countTimer); countTimer = setTimeout(updateAnCount, 400); }
    $('anAudience').addEventListener('change', function () {
      $('anDocksWrap').hidden = $('anAudience').value !== 'docks';
      $('anSlipsWrap').hidden = $('anAudience').value !== 'slips';
    });
    $('anDocks').addEventListener('change', recount);
    $('anSlips').addEventListener('input', recount);
    $('anEmailVote').addEventListener('change', previewAnnouncement);
    $('anHelpExtra').addEventListener('change', previewAnnouncement);
    $('anFiles').addEventListener('change', function () {
      var err = $('anError'); err.hidden = true;
      Array.prototype.forEach.call($('anFiles').files, function (file) {
        if (!anFiles.some(function (f) { return f.name === file.name && f.size === file.size; })) anFiles.push({ file: file, name: file.name, size: file.size, path: null });
      });
      $('anFiles').value = '';
      if (anFilesTooBig()) showErr(err, 'The attachments add up to ' + anSize(anFiles.reduce(function (n, f) { return n + f.size; }, 0)) + '. Please keep them under 15 MB in all (remove one, or put a large file on the Documents page and link to it).');
      renderAnFiles();
    });
    $('anFileList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-an-unattach]');
      if (!b) return;
      anFiles.splice(+b.getAttribute('data-an-unattach'), 1);
      $('anError').hidden = true;
      renderAnFiles();
    });
    $('anAudience').addEventListener('change', previewAnnouncement);
    ['anSubject', 'anBody', 'anEvent'].forEach(function (id) { $(id).addEventListener('input', previewAnnouncement); $(id).addEventListener('change', previewAnnouncement); });
    $('anAudience').addEventListener('change', updateAnCount);
    $('anTest').addEventListener('click', function () {
      var err = $('anError'), done = $('anDone'); err.hidden = true; done.hidden = true;
      var to = $('anTestTo').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return showErr(err, 'Type the email address to send the test to.');
      if (anFilesTooBig()) return showErr(err, 'The attachments are over 15 MB in all. Please remove one.');
      var btn = $('anTest'); btn.disabled = true; btn.textContent = 'Sending\u2026';
      uploadAnFiles().then(function (atts) {
        return callAnnounce({ action: 'test', subject: $('anSubject').value, body: $('anBody').value, event_id: $('anEvent').value || null, email_vote: anEmailVoteOn(), help_extra: anHelpExtraOn(), attachments: atts, to: to });
      })
        .then(function (r) { done.textContent = r.message + ' Check that inbox (and spam) before sending to everyone.'; done.hidden = false; if (r.tracked) loadAnnouncements(); })
        .catch(function (ex) { showErr(err, ex.message); })
        .then(function () { btn.disabled = false; btn.textContent = 'Send test'; });
    });
    $('anForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('anError'), done = $('anDone'); err.hidden = true; done.hidden = true;
      var subject = $('anSubject').value.trim(), body = $('anBody').value.trim();
      if (!subject || !body) return showErr(err, 'Please fill in the subject and message.');
      var n = anCounts[anTargetKey()];
      if (n === 0) return showErr(err, 'Nobody to send to: pick docks or type slips that have an email on file.');
      if (!confirm('Send "' + subject + '" to ' + (n != null ? n + ' email addresses' : 'all members') + ' now?\n\nThis can\'t be undone. (Tip: send yourself a test first.)')) return;
      if (anFilesTooBig()) return showErr(err, 'The attachments are over 15 MB in all. Please remove one.');
      var btn = $('anSend'); btn.disabled = true; btn.textContent = anFiles.length ? 'Uploading files\u2026' : 'Sending\u2026 please wait';
      uploadAnFiles().then(function (atts) {
        btn.textContent = 'Sending\u2026 please wait';
        return callAnnounce(Object.assign({ action: 'send', subject: subject, body: body, event_id: $('anEvent').value || null, email_vote: anEmailVoteOn(), help_extra: anHelpExtraOn(), attachments: atts }, anTarget()));
      })
        .then(function (r) {
          return anKeepSending(r, function (p) { btn.textContent = 'Sending\u2026 ' + p.sent + ' of ' + (p.sent + p.failed + p.pending) + ' sent; keep this page open'; });
        })
        .then(function (r) {
          done.textContent = 'Sent to ' + r.sent + ' of ' + (r.sent + r.failed + r.pending) + ' addresses.' +
            (r.pending ? ' ' + r.pending + ' still waiting: ' + r.note : '') + (r.failed ? ' ' + r.failed + ' failed.' : '');
          done.hidden = false;
          if (!r.pending) { $('anForm').reset(); anFiles = []; renderAnFiles(); }
          previewAnnouncement(); loadAnnouncements();
        })
        .catch(function (ex) { showErr(err, ex.message); })
        .then(function () { btn.disabled = false; btn.textContent = 'Send to members'; updateAnCount(); });
    });
    $('anHistory').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-an-resume]');
      if (!b) return;
      b.disabled = true; b.textContent = 'Sending\u2026';
      callAnnounce({ action: 'resume', announcement_id: b.getAttribute('data-an-resume') })
        .then(function (r) { return anKeepSending(r, function (p) { b.textContent = 'Sending\u2026 ' + p.sent + ' sent'; }); })
        .then(function (r) { alert('Sent ' + r.sent + ' so far' + (r.pending ? '; ' + r.pending + ' still waiting. ' + r.note : '. All done.')); })
        .catch(function (ex) { alert(ex.message); })
        .then(loadAnnouncements);
    });
    $('anHistory').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-an-clicks]');
      if (!b) return;
      var id = b.getAttribute('data-an-clicks'), row = document.getElementById('anClicks-' + id);
      if (row) { row.remove(); b.textContent = 'Who clicked'; return; }
      b.textContent = 'Hide list';
      b.closest('tr').insertAdjacentHTML('afterend', '<tr class="an-clicks-row" id="anClicks-' + id + '"><td colspan="7"><p class="note">Loading&hellip;</p></td></tr>');
      showClickList(id);
    });
    sb.from('events').select('id, title, event_type, active, ballot_kind, ballot_options, audience').eq('active', true).order('created_at', { ascending: false }).then(function (r) {
      anEvents = {};
      (r.data || []).forEach(function (ev) { anEvents[ev.id] = ev; });
      $('anEvent').innerHTML = '<option value="">No button</option><option value="portal">Member Portal (login page)</option><option value="help">Help Desk (help request form, no login needed)</option>' + (r.data || []).map(function (ev) {
        return '<option value="' + ev.id + '">' + D.esc(ev.title) + ' (' + D.eventTypeLabel(ev.event_type) + ')</option>';
      }).join('');
    });
    updateAnCount();
    previewAnnouncement();
    loadAnnouncements();
  }

  function updateAnCount() {
    var t = anTarget(), key = JSON.stringify(t);
    if (t.audience === 'docks' && !t.docks.length) { anCounts[key] = 0; $('anCount').textContent = 'Tick one or more docks.'; $('anSend').textContent = 'Send to members'; return; }
    if (t.audience === 'slips' && !String(t.slips || '').trim()) { anCounts[key] = 0; $('anCount').textContent = 'Type the slip numbers to send to.'; $('anSend').textContent = 'Send to members'; return; }
    $('anCount').textContent = 'Counting recipients\u2026';
    callAnnounce(Object.assign({ action: 'preview' }, t)).then(function (r) {
      if (key !== anTargetKey()) return;   // the choice changed while counting
      anCounts[key] = r.count;
      var who = t.audience === 'docks' ? ' on dock' + (t.docks.length > 1 ? 's ' : ' ') + t.docks.join(', ') : '';
      $('anCount').innerHTML = 'Goes to <strong>' + r.count + ' email address' + (r.count === 1 ? '' : 'es') + '</strong> covering ' + r.slips + ' slip' + (r.slips === 1 ? '' : 's') + who + ' (owners with several slips get one email).' +
        (r.unknown && r.unknown.length ? '<br><span class="inactive">Not found: ' + D.esc(r.unknown.join(', ')) + '. Check those slip numbers.</span>' : '') +
        (r.no_email && r.no_email.length ? '<br><span class="inactive">No email on file, will be skipped: ' + D.esc(r.no_email.join(', ')) + '</span>' : '') +
        '';
      $('anSend').textContent = 'Send to ' + r.count + ' member' + (r.count === 1 ? '' : 's');
    }).catch(function (ex) { $('anCount').textContent = ex.message; });
  }

  // Vote-by-email buttons: offered when the button goes to a vote that slip owners vote on.
  var anEvents = {};
  var OWNER_AUD = ['all', 'voting', 'docks', 'slips'];
  function anVoteChoices() {
    var ev = anEvents[$('anEvent').value];
    if (!ev || ev.event_type !== 'vote' || (ev.audience || []).indexOf('certificated') < 0) return [];
    return D.ballotChoices(ev);
  }
  function anHelpExtraOn() { return $('anHelpExtra').checked && $('anEvent').value !== 'help'; }
  function anEmailVoteOn() {
    return anVoteChoices().length > 0 && OWNER_AUD.indexOf($('anAudience').value) >= 0 && $('anEmailVote').checked;
  }
  function previewAnnouncement() {
    var choices = anVoteChoices();
    $('anEmailVoteWrap').hidden = !choices.length || OWNER_AUD.indexOf($('anAudience').value) < 0;
    $('anHelpExtraWrap').hidden = $('anEvent').value === 'help';   // the main button already is Request Help
    var helpBox = anHelpExtraOn() ? '<p><span class="an-btn an-btn-help">Help Desk &rarr;</span></p>' : '';
    $('anEmailVoteChoices').textContent = choices.join(' / ');
    var voteBox = anEmailVoteOn()
      ? '<div class="an-vote-box"><p><strong>Or vote right from this email:</strong></p><p>' + choices.map(function (c, i) {
          return '<span class="an-btn an-vote-' + (i % 6) + '">' + D.esc(c) + '</span>'; }).join(' ') + '</p>' +
        '<p class="note">No login needed. You&rsquo;ll be asked to confirm before your vote is recorded. One vote per slip; votes are final and can&rsquo;t be changed. Please don&rsquo;t forward this email: its buttons vote for your slip.</p></div>'
      : '';
    var ev = $('anEvent').selectedOptions[0];
    var btnLabel = !ev || !ev.value ? '' : ev.value === 'portal' ? 'Go to the Member Portal' : ev.value === 'help' ? 'Help Desk' : ev.textContent.replace(/ \([^)]*\)$/, '');
    $('anPrevSubject').textContent = $('anSubject').value.trim() || '(no subject)';
    $('anPreview').innerHTML = '<p>Dear [Owner name],</p><div>' + (D.richText($('anBody').value) || '<span class="note">Your message appears here.</span>') + '</div>' +
      (btnLabel ? '<p><span class="an-btn">' + D.esc(btnLabel) + ' &rarr;</span></p>' + (ev.value === 'help' ? '' : '<p class="note" style="margin-top:-6px">You\'ll be asked to log in with your slip number and password.</p>') : '') + voteBox + helpBox + (anFiles.length ? '<div class="an-prev-files"><strong>Attached:</strong> ' + anFiles.map(function (f) { return '&#128206; ' + D.esc(f.name); }).join(', ') + '</div>' : '') +
      '<p style="margin-top:18px">New Bern Grand Marina<br>134 Craven St, New Bern, NC &middot; (252) 638-0318<br>newberngrand.com</p>' +
      '<p class="note an-foot">You\'re receiving this as the owner of record for slip [slips] at New Bern Grand Marina.</p>';
  }

  var anRows = {};
  function loadAnnouncements() {
    sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(50).then(function (r) {
      var rows = r.data || [];
      rows.forEach(function (a) { anRows[a.id] = a; });
      var tracked = rows.filter(function (a) { return a.tracked; }).map(function (a) { return a.id; });
      // Only the recipients who clicked (or reached the page) are needed for the counts.
      var clicked = tracked.length
        ? sb.from('announcement_recipients').select('announcement_id, clicks, arrived_at')
            .in('announcement_id', tracked).or('clicks.gt.0,arrived_at.not.is.null').limit(5000)
        : Promise.resolve({ data: [] });
      return clicked.then(function (c) {
        var n = {};
        (c.data || []).forEach(function (x) {
          var k = n[x.announcement_id] || (n[x.announcement_id] = { clicked: 0, arrived: 0 });
          k.clicked++; if (x.arrived_at) k.arrived++;
        });
        $('anHistory').innerHTML = rows.length ? rows.map(function (a) {
          var pending = a.total - a.sent - a.failed, k = n[a.id] || { clicked: 0, arrived: 0 };
          var clicks = !a.tracked ? '<span class="note">' + (a.event_id || a.portal_button ? 'Not tracked (sent before tracking)' : 'No button') + '</span>'
            : '<strong>' + k.clicked + '</strong> of ' + a.sent + (a.sent ? ' (' + Math.round(k.clicked * 100 / a.sent) + '%)' : '') +
              '<div class="note">' + k.arrived + ' logged in</div>';
          return '<tr><td class="note nowrap">' + D.esc(D.fmtWhen(a.created_at)) + '</td><td><strong>' + D.esc(a.subject) + '</strong>' +
            ((a.attachments || []).length ? '<div class="note">&#128206; ' + a.attachments.map(function (f) { return D.esc(f.name); }).join(', ') + '</div>' : '') +
            (a.note ? '<div class="note">' + D.esc(a.note) + '</div>' : '') + '</td>' +
            '<td class="note">' + (a.is_test ? '<span class="an-test-tag">TEST</span> to ' + D.esc(a.target) : { all: 'All owners', voting: 'Voting slips', docks: 'Dock ' + D.esc(a.target), slips: 'Slips ' + D.esc(a.target), ltc: 'Long-term cruisers', stc: 'Transients', employee: 'Employees' }[a.audience] || a.audience) + '</td>' +
            '<td>' + a.sent + ' of ' + a.total + (a.failed ? ' <span class="inactive">(' + a.failed + ' failed)</span>' : '') + '</td>' +
            '<td>' + clicks + '</td>' +
            '<td>' + (a.status === 'done' ? 'Done' : '<span class="inactive">' + (a.status === 'paused' ? 'Paused' : 'Sending') + '</span>') + '</td>' +
            '<td class="row-actions">' + (a.tracked ? '<button type="button" class="btn-sm" data-an-clicks="' + a.id + '">Who clicked</button>' : '') +
            (pending > 0 ? '<button type="button" class="btn-sm btn-primary-sm" data-an-resume="' + a.id + '">Resume (' + pending + ' left)</button>' : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="7" class="note">Nothing sent yet.</td></tr>';
      });
    });
  }

  // Everyone an email went to: who clicked the button, when, whether they logged in,
  // and (for a vote) whether they voted. People who clicked are listed first.
  function showClickList(id) {
    var a = anRows[id], cell = document.querySelector('#anClicks-' + id + ' td');
    Promise.all([
      sb.from('announcement_recipients').select('email, name, slips, status, clicks, scanner_clicks, first_click_at, last_click_at, arrived_at, arrived_slip')
        .eq('announcement_id', id).limit(5000),
      a.event_id ? sb.from('events').select('event_type').eq('id', a.event_id).maybeSingle() : Promise.resolve({ data: null })
    ]).then(function (res) {
      var list = res[0].data || [], isVote = !!(res[1].data && res[1].data.event_type === 'vote');
      return (isVote ? sb.from('votes').select('slip').eq('event_id', a.event_id) : Promise.resolve({ data: [] })).then(function (v) {
        var voted = {};
        (v.data || []).forEach(function (x) { voted[x.slip] = true; });
        function did(r) { return r.clicks > 0 || !!r.arrived_at; }
        function slipKey(r) { return (r.slips && r.slips[0]) || ''; }
        list.sort(function (x, y) {
          return (did(y) ? 1 : 0) - (did(x) ? 1 : 0) || slipKey(x).localeCompare(slipKey(y), undefined, { numeric: true });
        });
        var clicked = list.filter(did).length;
        var arrived = list.filter(function (r) { return r.arrived_at; }).length;
        var scannerOnly = list.filter(function (r) { return !did(r) && r.scanner_clicks > 0; }).length;
        var votedCount = list.filter(function (r) { return (r.slips || []).some(function (s) { return voted[s]; }); }).length;
        var head = '<p style="margin:4px 0 10px"><strong>' + clicked + ' of ' + list.length + '</strong> clicked the button' +
          ' &middot; ' + arrived + ' logged in' + (isVote ? ' &middot; ' + votedCount + ' voted' : '') +
          ' &middot; ' + (list.length - clicked) + ' haven&rsquo;t clicked</p>' +
          (scannerOnly ? '<p class="note" style="margin:-4px 0 10px">' + scannerOnly + ' more had the link opened only by an email security scanner, which isn&rsquo;t counted as a click.</p>' : '');
        var table = '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Slip</th><th>Owner</th><th>Clicked</th><th>Logged in</th>' +
          (isVote ? '<th>Voted</th>' : '') + '</tr></thead><tbody>' +
          list.map(function (r) {
            var slips = r.slips || [];
            var slipsVoted = slips.filter(function (s) { return voted[s]; });
            return '<tr><td class="nowrap">' + D.esc(slips.join(', ')) + '</td><td>' + D.esc(r.name || r.email) +
              (r.status !== 'sent' ? ' <span class="inactive">(' + (r.status === 'failed' ? 'email failed' : 'not sent yet') + ')</span>' : '') + '</td>' +
              '<td>' + (did(r) ? D.esc(D.fmtWhen(r.first_click_at || r.arrived_at)) + (r.clicks > 1 ? ' <span class="note">(' + r.clicks + ' times)</span>' : '') : '<span class="note">No</span>') + '</td>' +
              '<td>' + (r.arrived_at ? 'Yes' + (r.arrived_slip && slips.indexOf(r.arrived_slip) < 0 ? ' <span class="note">(as ' + D.esc(r.arrived_slip) + ')</span>' : '') : '<span class="note">No</span>') + '</td>' +
              (isVote ? '<td>' + (slipsVoted.length ? 'Yes' + (slips.length > 1 ? ' <span class="note">(' + D.esc(slipsVoted.join(', ')) + ')</span>' : '') : '<span class="note">No</span>') + '</td>' : '') + '</tr>';
          }).join('') + '</tbody></table></div>';
        // Bar chart: every bar is measured against the emails sent for this mailer.
        var sentN = list.filter(function (r) { return r.status === 'sent'; }).length;
        var bars = [['Emails sent', sentN], ['Clicked', clicked], ['Logged in', arrived]];
        if (isVote) bars.push(['Voted', votedCount]);
        var chart = '<div class="an-chart" role="img" aria-label="' + bars.map(function (b) { return b[0] + ' ' + b[1]; }).join(', ') + ' (out of ' + sentN + ' sent)">' +
          bars.map(function (b, i) {
            var pct = sentN ? Math.min(100, Math.round(b[1] * 100 / sentN)) : 0;
            var tip = b[0] + ': ' + b[1] + ' of ' + sentN + ' sent' + (i ? ' (' + pct + '%)' : '');
            return '<div class="an-chart-row" title="' + D.esc(tip) + '"><span class="an-chart-label">' + b[0] + '</span>' +
              '<span class="an-chart-track"><span class="an-chart-bar' + (i ? '' : ' an-chart-base') + '" style="width:' + (b[1] ? Math.max(pct, 1) : 0) + '%"></span></span>' +
              '<span class="an-chart-val"><strong>' + b[1] + '</strong>' + (i ? ' <span class="note">' + pct + '%</span>' : '') + '</span></div>';
          }).join('') + '</div>';
        cell.innerHTML = chart + head + table;
      });
    }).catch(function (ex) { cell.innerHTML = '<p class="inactive">' + D.esc(ex.message || 'Could not load the list.') + '</p>'; });
  }

  /* ---------- Activity log ---------- */
  var LOG_ACTIONS = [
    ['Member activity', [
      ['login', 'Logged in'], ['logout', 'Logged out'], ['login_failed', 'Failed login'],
      ['view_portal', 'Opened member portal'], ['view_event', 'Viewed event'], ['open_document', 'Opened document'],
      ['vote_cast', 'Voted'], ['change_password', 'Changed own password'],
      ['reset_requested', 'Requested password reset'], ['reset_password_done', 'Reset password (email link)']
    ]],
    ['Admin changes', [
      ['view_admin', 'Opened admin page'],
      ['event_created', 'Event created'], ['event_updated', 'Event updated'], ['event_deleted', 'Event deleted'],
      ['document_uploaded', 'Document uploaded'], ['document_updated', 'Document updated'], ['document_deleted', 'Document deleted'],
      ['member_added', 'Slip added'], ['member_updated', 'Slip updated'], ['member_note_changed', 'Admin note changed'],
      ['password_set', 'Password set by admin'], ['ineligible_marked', 'Marked ineligible'], ['ineligible_removed', 'Eligibility restored'],
      ['announcement_sent', 'Email sent to members'], ['photo_added', 'Gallery photo added'], ['photo_updated', 'Gallery photo updated'], ['photo_deleted', 'Gallery photo deleted'],
      ['signup_added', 'Signed up for event'], ['signup_changed', 'Changed event sign-up'], ['signup_cancelled', 'Cancelled event sign-up'],
      ['video_added', 'Gallery video added'], ['video_updated', 'Gallery video updated'], ['video_deleted', 'Gallery video removed']
    ]],
    ['Public website', [
      ['page_view', 'Page view'], ['slip_search', 'Slip finder search'], ['reserve_click', 'Reserve button click'], ['video_play', 'Video played']
    ]]
  ];
  var LOG_LABEL = {};
  LOG_ACTIONS.forEach(function (g) { g[1].forEach(function (a) { LOG_LABEL[a[0]] = a[1]; }); });
  var LOG_PAGE = 200, logOffset = 0, logRowsData = [], logWired = false;

  function setupLog() {
    if (logWired) return;
    logWired = true;
    $('logAction').innerHTML = '<option value="">All activity (except page views)</option><option value="*">Everything, including page views</option>' + LOG_ACTIONS.map(function (g) {
      return '<optgroup label="' + g[0] + '">' + g[1].map(function (a) { return '<option value="' + a[0] + '">' + a[1] + '</option>'; }).join('') + '</optgroup>';
    }).join('');
    $('logFilters').addEventListener('submit', function (e) { e.preventDefault(); loadLog(true); });
    $('logClear').addEventListener('click', function () { $('logFilters').reset(); loadLog(true); });
    $('logMore').addEventListener('click', function () { loadLog(false); });
    $('logRefresh').addEventListener('click', function () { loadSummary(); loadLog(true); });
    $('logCsv').addEventListener('click', logCsv);
    $('logTops').addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter-action]');
      if (!b) return;
      $('logFilters').reset();
      $('logAction').value = b.getAttribute('data-filter-action');
      $('logText').value = b.getAttribute('data-filter-text') || '';
      loadLog(true);
      $('logFilters').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.querySelector('[data-tab="log"]').addEventListener('click', function () {
      if (!$('logRows').children.length) { loadSummary(); loadLog(true); }
    });
    if (!$('adminApp').querySelector('[data-panel="log"]').hidden) { loadSummary(); loadLog(true); }
  }

  function num(n) { return Number(n || 0).toLocaleString('en-US'); }

  function loadSummary() {
    sb.rpc('activity_summary').then(function (r) {
      var s = r.data;
      if (!s) { $('logStats').innerHTML = '<p class="note">Summary unavailable.</p>'; return; }
      function card(title, big, sub) {
        return '<div class="stat-card"><div class="stat-title">' + title + '</div><div class="stat-big">' + big + '</div><div class="stat-sub">' + sub + '</div></div>';
      }
      $('logStats').innerHTML =
        card('Page views', num(s.views_today) + ' <small>today</small>', num(s.views_7d) + ' in 7 days &middot; ' + num(s.views_30d) + ' in 30 days &middot; ' + num(s.views_all) + ' total') +
        card('Visitors', num(s.visitors_30d), 'different browsers in 30 days') +
        card('Slip finder searches', num(s.searches_30d), 'in 30 days &middot; ' + num(s.searches_all) + ' total') +
        card('Reserve button clicks', num(s.reserve_30d), 'in 30 days &middot; ' + num(s.reserve_all) + ' total') +
        card('Member logins', num(s.logins_30d), num(s.members_30d) + ' different slips in 30 days') +
        card('Failed logins', num(s.failed_30d), 'in 30 days') +
        '<form class="stat-card replay-card" id="replayForm">' +
          '<div class="stat-title">Visit replay</div>' +
          '<div class="replay-inputs">' +
            '<input type="date" id="replayDate" value="' + D.toLocalInput(new Date().toISOString()).slice(0, 10) + '" required aria-label="Date">' +
            '<input type="text" id="replaySlip" placeholder="Slip" required autocapitalize="characters" spellcheck="false" aria-label="Slip">' +
          '</div>' +
          '<button type="submit" class="btn-sm btn-primary-sm">&#9654; Play visit</button>' +
          '<div class="stat-sub">Opens in a new tab</div>' +
        '</form>';
      $('replayForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var slip = $('replaySlip').value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
        if (!slip) return;
        window.open('replay.html?slip=' + encodeURIComponent(slip) + '&date=' + encodeURIComponent($('replayDate').value), '_blank');
      });
      function list(title, rows, key, action) {
        if (!rows || !rows.length) return '';
        return '<div class="stat-list"><div class="stat-title">' + title + '</div><ol>' + rows.map(function (x) {
          return '<li><button type="button" class="linkish" data-filter-action="' + action + '" data-filter-text="' + D.esc(x[key]) + '">' +
            D.esc(x[key]) + '</button> <span class="note">' + num(x.n) + '</span></li>';
        }).join('') + '</ol></div>';
      }
      $('logTops').innerHTML = list('Most viewed pages (30 days)', s.top_pages, 'page', 'page_view') +
        list('Most searched slips (30 days)', s.top_slips, 'slip', 'slip_search');
    });
  }

  // YYYY-MM-DD in Eastern time -> ISO timestamp at local midnight.
  function easternMidnight(ymd) { return ymd ? D.fromLocalInput(ymd + 'T00:00') : null; }

  function logQuery() {
    var q = sb.from('activity_log').select('*', { count: 'exact' }).order('at', { ascending: false });
    var from = easternMidnight($('logFrom').value);
    var to = $('logTo').value;
    if (from) q = q.gte('at', from);
    if (to) {
      var p = to.split('-'); var next = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1));
      q = q.lt('at', easternMidnight(next.toISOString().slice(0, 10)));
    }
    var act = $('logAction').value;
    if (act === '') q = q.neq('action', 'page_view');      // page views are counted at the top, not listed
    else if (act !== '*') q = q.eq('action', act);
    if ($('logWho').value === 'members') q = q.eq('is_member', true);
    if ($('logWho').value === 'visitors') q = q.eq('is_member', false);
    var slip = $('logSlip').value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (slip) q = q.or('slip.eq.' + slip + ',target_id.eq.' + slip + ',details->>slip.eq.' + slip);
    var t = $('logText').value.trim().replace(/[,()*%]/g, ' ').trim();
    if (t) q = q.or('target_label.ilike.*' + t + '*,page.ilike.*' + t + '*,target_id.ilike.*' + t + '*');
    return q;
  }

  function loadLog(reset) {
    if (reset) { logOffset = 0; logRowsData = []; $('logRows').innerHTML = '<tr><td colspan="6">Loading&hellip;</td></tr>'; }
    logQuery().range(logOffset, logOffset + LOG_PAGE - 1).then(function (r) {
      if (r.error) { $('logRows').innerHTML = '<tr><td colspan="6" class="inactive">' + D.esc(r.error.message) + '</td></tr>'; return; }
      var rows = r.data || [];
      logRowsData = logRowsData.concat(rows);
      logOffset += rows.length;
      $('logCount').textContent = r.count != null ? 'Showing ' + num(logRowsData.length) + ' of ' + num(r.count) + ' entries' : '';
      $('logMore').hidden = !(r.count != null && logOffset < r.count);
      var html = logRowsData.map(logRow).join('');
      $('logRows').innerHTML = html || '<tr><td colspan="6" class="note">No activity matches.</td></tr>';
    });
  }

  function detailText(x) {
    var d = x.details || {}, parts = [];
    if (x.action === 'vote_cast') return 'Slip ' + (d.slip || '') + ': ' + (d.choice || '');
    if (x.action === 'slip_search') return d.found ? 'Found' + (d.from_link ? ' (shared link)' : '') : 'Not found' + (d.query ? ' ("' + d.query + '")' : '');
    if (x.action === 'ineligible_marked' || x.action === 'ineligible_removed') return 'Slip ' + (d.slip || '') + (d.reason ? ' (' + d.reason + ')' : '');
    if (x.action === 'member_updated') {
      if (d.owner) parts.push('Owner: ' + (d.owner[0] || '') + ' → ' + (d.owner[1] || ''));
      if (d.email) parts.push('Email: ' + (d.email[0] || 'none') + ' → ' + (d.email[1] || 'none'));
      if ('active' in d) parts.push(d.active ? 'Activated' : 'Deactivated');
      if ('can_vote' in d) parts.push(d.can_vote ? 'Voting on' : 'Voting off');
      return parts.join('; ');
    }
    if ('active' in d) parts.push(d.active ? 'Made active' : 'Made inactive');
    if ('visible' in d) parts.push(d.visible ? 'Shown' : 'Hidden');
    if (d.section) parts.push(D.categoryLabel(d.section));
    if (d.type) parts.push(D.eventTypeLabel(d.type));
    return parts.join('; ');
  }

  function whoText(x) {
    if (x.slip && x.is_member) {
      return '<strong>' + D.esc(x.slip) + '</strong> <a class="replay-link" title="Replay this slip\'s visit that day" target="_blank" rel="noopener" href="replay.html?slip=' +
        encodeURIComponent(x.slip) + '&date=' + D.toLocalInput(x.at).slice(0, 10) + '&at=' + encodeURIComponent(x.at) + '">&#9654;</a>';
    }
    if (x.action === 'login_failed') return '<span class="note">Visitor (tried ' + D.esc(x.slip || '?') + ')</span>';
    if (!x.user_id && !x.visitor_id) return '<span class="note">System</span>';
    return '<span class="note">Visitor' + (x.visitor_id ? ' ' + D.esc(x.visitor_id.slice(0, 6)) : '') + '</span>';
  }

  function logRow(x) {
    var item = x.target_label || x.target_id || '';
    if (x.target_type === 'event' && x.target_id && x.action !== 'event_deleted') item = '<a href="event.html?id=' + D.esc(x.target_id) + '" target="_blank" rel="noopener">' + D.esc(item) + '</a>';
    else item = D.esc(item);
    var cls = /failed|deleted/.test(x.action) ? ' class="log-warn"' : '';
    return '<tr' + cls + '><td class="nowrap">' + D.esc(D.fmtWhen(x.at)) + '</td><td>' + whoText(x) + '</td>' +
      '<td>' + D.esc(LOG_LABEL[x.action] || x.action) + '</td><td>' + item + '</td>' +
      '<td class="note">' + D.esc(detailText(x)) + '</td>' +
      '<td class="note">' + D.esc(x.page || '') + (x.device ? (x.page ? ' &middot; ' : '') + x.device : '') + '</td></tr>';
  }

  function logCsv() {
    // Export everything that matches the current search (up to 10,000 rows).
    var btn = $('logCsv'); btn.disabled = true; btn.textContent = 'Preparing\u2026';
    var all = [];
    function page(off) {
      return logQuery().range(off, off + 999).then(function (r) {
        var rows = r.data || [];
        all = all.concat(rows);
        if (rows.length === 1000 && all.length < 10000) return page(off + 1000);
      });
    }
    page(0).then(function () {
      function q(s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; }
      var lines = [['When (Eastern)', 'Slip', 'Member', 'Activity', 'Item', 'Details', 'Page', 'Device', 'Visitor'].map(q).join(',')];
      all.forEach(function (x) {
        lines.push([D.fmtWhen(x.at), x.slip, x.is_member ? 'yes' : 'no', LOG_LABEL[x.action] || x.action,
          x.target_label || x.target_id, detailText(x), x.page, x.device, x.visitor_id].map(q).join(','));
      });
      var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'activity_log_' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }).then(function () { btn.disabled = false; btn.textContent = 'Download CSV'; });
  }

  /* ---------- Members ---------- */
  var memRows = [], memNotes = {}, memCerts = {}, memEditing = null, memWired = false;

  function loadMembers() {
    if (!memWired) { wireMembers(); memWired = true; }
    return Promise.all([
      sb.from('members').select('slip, owner_name, email, active, is_admin, admin_rights, is_board, board_name, can_vote, user_id, member_class'),
      sb.from('member_notes').select('slip, note'),
      sb.from('member_certificates').select('slip, storage_path, thumb_path, uploaded_at, uploaded_by, uploaded_by_owner')
    ]).then(function (r) {
      if (r[0].error) return;
      memCerts = {};
      (r[2].data || []).forEach(function (c) { memCerts[c.slip] = c; });
      memNotes = {};
      (r[1].data || []).forEach(function (n) { memNotes[n.slip] = n.note; });
      memRows = r[0].data.sort(function (a, b) { return a.slip.localeCompare(b.slip, undefined, { numeric: true }); });
      var voting = memRows.filter(function (m) { return m.active && m.can_vote && !m.is_admin; }).length;
      var noEmail = memRows.filter(function (m) { return !m.is_admin && !m.email; }).length;
      $('memCount').textContent = memRows.filter(function (m) { return !m.is_admin; }).length + ' slips on file · ' + voting + ' voting · ' + noEmail + ' with no email. Click Edit to change an owner, email, note, status or password.';
      drawMembers();
    });
  }

  function drawMembers() {
    var f = $('memSearch').value.toLowerCase(), show = $('memShow').value, sortBy = $('memSort').value;
    var bySlip = function (a, b) { return a.slip.localeCompare(b.slip, undefined, { numeric: true }); };
    var byText = function (x, y) {
      x = (x || '').toLowerCase(); y = (y || '').toLowerCase();
      if (!x !== !y) return x ? -1 : 1; // blanks last
      return x.localeCompare(y);
    };
    var statusRank = function (m) { return m.is_admin ? 2 : (m.active ? 0 : 1); };
    var typeRank = { certificated: 0, ltc: 1, stc: 2, employee: 3 };
    var cmp = {
      slip: bySlip,
      owner: function (a, b) { return byText(a.owner_name, b.owner_name) || bySlip(a, b); },
      'owner-desc': function (a, b) { return byText(b.owner_name, a.owner_name) || bySlip(a, b); },
      email: function (a, b) { return byText(a.email, b.email) || bySlip(a, b); },
      status: function (a, b) { return statusRank(a) - statusRank(b) || bySlip(a, b); },
      type: function (a, b) { return (typeRank[a.member_class || 'certificated'] || 0) - (typeRank[b.member_class || 'certificated'] || 0) || bySlip(a, b); }
    }[sortBy] || bySlip;
    $('memRows').innerHTML = memRows.slice().sort(cmp).filter(function (m) {
      if (show === 'noemail' && (m.email || m.is_admin)) return false;
      if (show === 'nonvoting' && (m.can_vote || m.is_admin)) return false;
      if (show === 'inactive' && m.active) return false;
      if (show === 'admins' && !m.is_admin && !m.admin_rights) return false;
      if (show === 'board' && !m.is_board) return false;
      if (show.indexOf('c:') === 0 && m.member_class !== show.slice(2)) return false;
      return !f || (m.slip + ' ' + m.owner_name + ' ' + (m.email || '') + ' ' + (memNotes[m.slip] || '')).toLowerCase().indexOf(f) !== -1;
    }).map(function (m) {
      return '<tr' + (m.active ? '' : ' class="row-inactive"') + '><td><strong>' + D.esc(m.slip) + '</strong></td><td>' + D.esc(m.owner_name) +
        (memNotes[m.slip] ? '<div class="note">' + D.esc(memNotes[m.slip]) + '</div>' : '') +
        (memCerts[m.slip] ? '<div><span class="badge badge-cert" title="Membership certificate on file">Certificate</span></div>' : '') +
        '</td><td>' + (m.email ? D.esc(m.email) : '<em>none</em>') + '</td>' +
        '<td>' + (m.is_admin ? 'Admin' : (m.active ? 'Active' : '<span class="inactive">Inactive</span>')) +
        (!m.is_admin && !m.can_vote ? '<div class="note">Non-voting</div>' : '') +
        (m.is_board ? '<div><span class="badge badge-board">Board</span></div>' : '') +
        (m.admin_rights && !m.is_board ? '<div><span class="badge badge-admin">Admin</span></div>' : '') +
        (!m.is_admin && m.member_class && m.member_class !== 'certificated' ? '<div><span class="badge badge-class-' + m.member_class + '">' + CLASS_LABEL[m.member_class] + '</span></div>' : '') + '</td>' +
        '<td class="row-actions"><button type="button" class="btn-sm" data-slip="' + D.esc(m.slip) + '">Edit</button></td></tr>';
    }).join('') || '<tr><td colspan="5" class="note">No slips match.</td></tr>';
  }

  function callAdmin(payload) {
    return sb.functions.invoke('admin-members', { body: payload }).then(function (r) {
      if (r.error) {
        // Pull the server's message out of the error response when there is one.
        var ctx = r.error.context;
        if (ctx && typeof ctx.json === 'function') {
          return ctx.json().then(function (b) { throw new Error(b.error || r.error.message); }, function () { throw new Error(r.error.message); });
        }
        throw new Error(r.error.message);
      }
      if (r.data && r.data.error) throw new Error(r.data.error);
      return r.data;
    });
  }

  function suggestPassword() {
    var words = ['Harbor', 'Anchor', 'Tide', 'Cove', 'Marina', 'Neuse', 'Trent', 'Keel', 'Mast', 'Pier', 'Sail', 'Dock', 'Buoy', 'Helm'];
    var a = new Uint32Array(3); crypto.getRandomValues(a);
    return words[a[0] % words.length] + '-' + words[a[1] % words.length] + '-' + (1000 + a[2] % 9000);
  }

  function openMemberForm(m) {
    memEditing = m;
    var isNew = !m;
    $('memFormTitle').textContent = isNew ? 'Add a Slip' : 'Edit Slip ' + m.slip;
    $('memSoldTip').hidden = isNew || m.is_admin;
    $('memSlip').value = isNew ? '' : m.slip;
    $('memSlip').readOnly = !isNew;
    $('memOwner').value = isNew ? '' : m.owner_name;
    $('memEmail').value = isNew ? '' : (m.email || '');
    $('memNote').value = isNew ? '' : (memNotes[m.slip] || '');
    $('memActive').checked = isNew ? true : m.active;
    $('memCanVote').checked = isNew ? true : m.can_vote;
    $('memClass').value = isNew ? 'certificated' : (m.member_class || 'certificated');
    $('memClass').disabled = !isNew && m.is_admin;
    $('memActive').disabled = !isNew && m.is_admin;
    $('memCanVote').disabled = !isNew && m.is_admin;
    $('memAdminWrap').hidden = !isNew && m.is_admin;   // BOD-style board accounts are always admins
    $('memAdmin').checked = !isNew && !!m.admin_rights;
    $('memBoardWrap').hidden = !isNew && m.is_admin;
    $('memBoard').checked = !isNew && !!m.is_board;
    $('memBoardName').value = isNew ? '' : (m.board_name || '');
    $('memBoardNameWrap').hidden = !$('memBoard').checked;
    $('memBoard').disabled = $('memClass').value !== 'certificated';
    $('memAdmin').disabled = !adminAllowed();
    $('memPw').value = '';
    $('memPwLegend').textContent = isNew ? 'Starting password (required)' : 'Set a new password';
    $('memPwSet').hidden = isNew;
    $('memPwHelp').textContent = isNew
      ? 'Give this password to the owner privately. They can change it after logging in.'
      : 'Sets the password right away. Give it to the owner privately; they can change it after logging in.';
    $('memSave').textContent = isNew ? 'Add Slip' : 'Save Changes';
    ['memError', 'memDone', 'memPwDone', 'memAdded'].forEach(function (id) { $(id).hidden = true; });
    $('certBox').hidden = isNew || m.is_admin;
    if (!isNew) showCert(m.slip);
    $('memForm').hidden = false;
    $('memForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    (isNew ? $('memSlip') : $('memOwner')).focus();
  }

  /* ---------- Membership certificates (private: admins only) ---------- */
  var certShown = null;
  function signed(path) {
    return sb.storage.from('marina-docs').createSignedUrl(path, 3600).then(function (r) { return r.data && r.data.signedUrl; });
  }
  function showCert(slip) {
    var c = memCerts[slip], t = $('certThumb');
    certShown = slip;
    $('certRotate').hidden = $('certRemove').hidden = !c;
    $('certInfo').textContent = c ? (c.uploaded_by_owner ? 'Uploaded by the owner' + (c.uploaded_by ? ' (slip ' + c.uploaded_by + ')' : '') : 'Added') + ' ' + D.fmtWhen(c.uploaded_at) +
      '. Click the picture to view it full size and zoom.' : 'Upload a photo or scan of this slip’s certificate. Owners can also add it from My Account.';
    if (!c) { t.innerHTML = '<span class="note">No certificate yet</span>'; t.disabled = true; return; }
    t.disabled = false;
    t.innerHTML = '<span class="note">Loading&hellip;</span>';
    signed(c.thumb_path).then(function (u) { if (certShown === slip && u) t.innerHTML = '<img src="' + u + '" alt="Certificate for slip ' + D.esc(slip) + '">'; });
  }
  var loadImage = D.loadImage, drawTo = D.drawImage;
  // Store a certificate image for a slip: the image itself plus a thumbnail; replaces any earlier one.
  function saveCert(slip, fullBlob) {
    var url = URL.createObjectURL(fullBlob), base = 'certificates/' + slip + '/' + Date.now(), old = memCerts[slip];
    return loadImage(url).then(function (img) { return drawTo(img, 2400, false).then(function (full) { return drawTo(img, 480, false).then(function (th) { return [full, th]; }); }); })
      .then(function (b) {
        URL.revokeObjectURL(url);
        return sb.storage.from('marina-docs').upload(base + '.jpg', b[0], { contentType: 'image/jpeg' }).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          return sb.storage.from('marina-docs').upload(base + '_thumb.jpg', b[1], { contentType: 'image/jpeg' });
        });
      }).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        var row = { slip: slip, storage_path: base + '.jpg', thumb_path: base + '_thumb.jpg', uploaded_at: new Date().toISOString(), uploaded_by: null, uploaded_by_owner: false };
        return sb.from('member_certificates').upsert(row).select().single();
      }).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        memCerts[slip] = r.data;
        if (old) sb.storage.from('marina-docs').remove([old.storage_path, old.thumb_path]);
      });
  }
  function wireCerts() {
    $('certFile').addEventListener('change', function () {
      var f = this.files[0], slip = memEditing && memEditing.slip; this.value = '';
      if (!f || !slip) return;
      $('certInfo').textContent = 'Uploading…';
      saveCert(slip, f).then(function () { showCert(slip); drawMembers(); }, function (ex) { $('certInfo').textContent = ex.message; });
    });
    $('certRotate').addEventListener('click', function () {
      var slip = memEditing && memEditing.slip, c = memCerts[slip]; if (!c) return;
      var b = this; b.disabled = true; $('certInfo').textContent = 'Rotating…';
      signed(c.storage_path).then(loadImage).then(function (img) { return drawTo(img, 2400, true); })
        .then(function (blob) { return saveCert(slip, blob); })
        .then(function () { showCert(slip); }, function (ex) { $('certInfo').textContent = ex.message; })
        .then(function () { b.disabled = false; });
    });
    $('certRemove').addEventListener('click', function () {
      var slip = memEditing && memEditing.slip, c = memCerts[slip]; if (!c) return;
      if (!confirm('Remove the certificate picture for slip ' + slip + '?')) return;
      sb.from('member_certificates').delete().eq('slip', slip).then(function (r) {
        if (r.error) { alert(r.error.message); return; }
        sb.storage.from('marina-docs').remove([c.storage_path, c.thumb_path]);
        delete memCerts[slip]; showCert(slip); drawMembers();
      });
    });
    $('certThumb').addEventListener('click', function () {
      var slip = memEditing && memEditing.slip, c = memCerts[slip]; if (!c) return;
      signed(c.storage_path).then(function (u) { if (u) openViewer(u, 'Slip ' + slip + ' · ' + (memEditing.owner_name || '')); });
    });
    // Many at once: files named by slip (A3.jpg, B-12.jpg, "Slip C 24.jpeg"...).
    $('certBulk').addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files), out = $('certBulkDone'); this.value = '';
      if (!files.length) return;
      var bySlip = {}; memRows.forEach(function (m) { bySlip[m.slip.toUpperCase()] = m; });
      var jobs = [], unknown = [];
      files.forEach(function (f) {
        var key = f.name.replace(/\.[^.]+$/, '').toUpperCase().replace(/^SLIP\s*/, '').replace(/[^A-Z0-9]/g, '');
        if (bySlip[key]) jobs.push({ f: f, slip: bySlip[key].slip }); else unknown.push(f.name);
      });
      var done = 0, failed = [];
      out.hidden = false;
      out.textContent = 'Uploading ' + jobs.length + ' certificate' + (jobs.length === 1 ? '' : 's') + '…';
      jobs.reduce(function (p, j) {
        return p.then(function () {
          return saveCert(j.slip, j.f).then(function () { done++; out.textContent = 'Uploaded ' + done + ' of ' + jobs.length + '…'; },
            function (ex) { failed.push(j.f.name + ' (' + ex.message + ')'); });
        });
      }, Promise.resolve()).then(function () {
        out.innerHTML = 'Uploaded <strong>' + done + '</strong> certificate' + (done === 1 ? '' : 's') + '.' +
          (unknown.length ? '<br>No slip matches these file names (name each file by its slip, e.g. A3.jpg): ' + D.esc(unknown.join(', ')) : '') +
          (failed.length ? '<br>Could not upload: ' + D.esc(failed.join(', ')) : '');
        drawMembers();
        if (memEditing) showCert(memEditing.slip);
      });
    });
  }

  var openViewer = D.openViewer;


  function adminAllowed() { return $('memClass').value === 'certificated' || $('memClass').value === 'employee'; }
  var CLASS_LABEL = { certificated: 'Owner', ltc: 'Long-term cruiser', stc: 'Transient', employee: 'Employee' };
  var CLASS_SHORT = { certificated: 'Owners', ltc: 'LTC', stc: 'STC', employee: 'Employees' };
  function wireMembers() {
    $('memClass').addEventListener('change', function () {
      if (!memEditing && $('memClass').value !== 'certificated') $('memCanVote').checked = false;
      // Owners and employees can be admins (never the shared LTC / STC logins).
      $('memAdmin').disabled = !adminAllowed();
      if ($('memAdmin').disabled) $('memAdmin').checked = false;
      // Only slip owners can be on the board.
      $('memBoard').disabled = $('memClass').value !== 'certificated';
      if ($('memBoard').disabled) $('memBoard').checked = false;
    });
    $('memNew').addEventListener('click', function () { openMemberForm(null); });
    wireCerts();
    // A board member is always an admin.
    $('memBoard').addEventListener('change', function () {
      if (this.checked) $('memAdmin').checked = true;
      $('memBoardNameWrap').hidden = !this.checked;
    });
    $('memAdmin').addEventListener('change', function () {
      if (!this.checked && $('memBoard').checked) {
        this.checked = true;
        alert('Board members always have admin rights. Untick Board of Directors first to remove admin rights.');
      }
    });
    $('memCancel').addEventListener('click', function () { $('memForm').hidden = true; memEditing = null; });

    // "Find another slip" at the top of the edit form: search and switch slips without going back to the list.
    var jumpHits = [];
    function memDirty() {
      var m = memEditing;
      if (!m) return !!($('memSlip').value.trim() || $('memOwner').value.trim() || $('memEmail').value.trim());
      return $('memOwner').value !== (m.owner_name || '') || $('memEmail').value !== (m.email || '') ||
        $('memNote').value !== (memNotes[m.slip] || '') || $('memActive').checked !== !!m.active || $('memCanVote').checked !== !!m.can_vote ||
        $('memClass').value !== (m.member_class || 'certificated') || $('memBoard').checked !== !!m.is_board ||
        $('memAdmin').checked !== !!m.admin_rights || $('memBoardName').value !== (m.board_name || '');
    }
    function drawJump() {
      var f = $('memJump').value.trim().toLowerCase(), list = $('memJumpList');
      if (!f) { list.hidden = true; jumpHits = []; return; }
      var slipFirst = function (m) { return m.slip.toLowerCase() === f ? 0 : m.slip.toLowerCase().indexOf(f) === 0 ? 1 : 2; };
      jumpHits = memRows.filter(function (m) {
        return (m.slip + ' ' + m.owner_name + ' ' + (m.email || '') + ' ' + (memNotes[m.slip] || '')).toLowerCase().indexOf(f) !== -1;
      }).sort(function (a, b) { return slipFirst(a) - slipFirst(b) || a.slip.localeCompare(b.slip, undefined, { numeric: true }); }).slice(0, 8);
      list.innerHTML = jumpHits.length ? jumpHits.map(function (m, i) {
        return '<button type="button" data-jump="' + i + '"' + (memEditing && memEditing.slip === m.slip ? ' class="on"' : '') + '><strong>' + D.esc(m.slip) + '</strong> ' +
          D.esc(m.owner_name) + ' <span class="note">' + (m.email ? D.esc(m.email) : 'no email') + '</span></button>';
      }).join('') : '<p class="note" style="margin:6px 10px">No slips match.</p>';
      list.hidden = false;
    }
    function jumpTo(m) {
      if (!m) return;
      if (memEditing && memEditing.slip === m.slip) { $('memJump').value = ''; drawJump(); return; }
      if (memDirty() && !confirm('You have unsaved changes to ' + (memEditing ? 'slip ' + memEditing.slip : 'this new slip') + '. Leave without saving?')) return;
      $('memJump').value = ''; drawJump();
      openMemberForm(m);
    }
    // Clicking the Members menu item while editing a slip goes back to the full list.
    document.querySelector('.admin-tab[data-tab="members"]').addEventListener('click', function () {
      if ($('memForm').hidden) return;
      if (memDirty() && !confirm('You have unsaved changes to ' + (memEditing ? 'slip ' + memEditing.slip : 'this new slip') + '. Leave without saving?')) return;
      $('memForm').hidden = true; memEditing = null;
      $('memJump').value = ''; $('memJumpList').hidden = true;
      $('memSearch').value = ''; drawMembers();
      window.scrollTo({ top: document.querySelector('.admin-tabs').getBoundingClientRect().top + window.scrollY - 10 });
    });
    $('memJump').addEventListener('input', drawJump);
    $('memJump').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); jumpTo(jumpHits[0]); }
      if (e.key === 'Escape') { this.value = ''; drawJump(); }
    });
    $('memJumpList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-jump]');
      if (b) jumpTo(jumpHits[+b.getAttribute('data-jump')]);
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.mem-jump')) $('memJumpList').hidden = true; });
    $('memSearch').addEventListener('input', drawMembers);
    $('memShow').addEventListener('change', drawMembers);
    $('memSort').addEventListener('change', drawMembers);
    $('memRows').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-slip]');
      if (!b) return;
      var m = memRows.find(function (x) { return x.slip === b.getAttribute('data-slip'); });
      if (m) openMemberForm(m);
    });
    $('memPwGen').addEventListener('click', function () { $('memPw').value = suggestPassword(); });

    $('memPwSet').addEventListener('click', function () {
      if (!memEditing) return;
      var pw = $('memPw').value.trim();
      $('memError').hidden = true; $('memPwDone').hidden = true;
      if (pw.length < 8) return showErr($('memError'), 'The new password needs at least 8 characters.');
      if (!confirm('Set a new password for slip ' + memEditing.slip + '? The old password will stop working.')) return;
      var btn = $('memPwSet'); btn.disabled = true;
      callAdmin({ action: 'set_password', slip: memEditing.slip, password: pw }).then(function (res) {
        $('memPwDone').textContent = res.message + ' New password: ' + pw;
        $('memPwDone').hidden = false;
        $('memPw').value = '';
      }).catch(function (ex) { showErr($('memError'), ex.message); })
        .then(function () { btn.disabled = false; });
    });

    $('memForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('memError'), done = $('memDone');
      err.hidden = true; done.hidden = true;
      var owner = $('memOwner').value.trim();
      var email = $('memEmail').value.trim();
      var note = $('memNote').value.trim();
      if (!owner) return showErr(err, 'Please enter the owner of record.');
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showErr(err, 'That email address doesn\'t look right.');
      var btn = $('memSave'); btn.disabled = true;

      var work;
      if (!memEditing) {
        var slip = $('memSlip').value.trim().toUpperCase().replace(/\s+/g, '');
        var pw = $('memPw').value.trim();
        if (!/^[A-Z0-9-]{1,20}$/.test(slip)) { btn.disabled = false; return showErr(err, 'Please enter a valid slip (letters, numbers and dashes).'); }
        if (pw.length < 8) { btn.disabled = false; return showErr(err, 'Please set a starting password of at least 8 characters.'); }
        work = callAdmin({ action: 'create_slip', slip: slip, owner_name: owner, email: email, password: pw, can_vote: $('memCanVote').checked })
          .then(function () {
            return Promise.all([
              note ? sb.from('member_notes').upsert({ slip: slip, note: note }) : null,
              $('memActive').checked ? null : sb.from('members').update({ active: false }).eq('slip', slip),
              $('memClass').value === 'certificated' ? null : sb.from('members').update({ member_class: $('memClass').value }).eq('slip', slip),
              ($('memAdmin').checked || $('memBoard').checked) ? sb.from('members').update({ admin_rights: true, is_board: $('memBoard').checked }).eq('slip', slip) : null
            ]);
          })
          .then(function () { return 'Slip ' + slip + ' added. Starting password: ' + pw; });
      } else {
        var m = memEditing;
        var row = { owner_name: owner, email: email || null };
        if (!m.is_admin) {
          row.active = $('memActive').checked; row.can_vote = $('memCanVote').checked; row.member_class = $('memClass').value;
          row.is_board = $('memBoard').checked && row.member_class === 'certificated';
          row.board_name = row.is_board ? ($('memBoardName').value.trim() || null) : null;
          row.admin_rights = (row.is_board || $('memAdmin').checked) && (row.member_class === 'certificated' || row.member_class === 'employee');
          if (!m.is_board && row.is_board &&
              !confirm('Put slip ' + m.slip + ' (' + owner + ') on the Board of Directors? They will also get admin rights and will approve meeting minutes.')) { btn.disabled = false; return; }
          if (m.admin_rights && !row.admin_rights &&
              !confirm('Remove admin rights from slip ' + m.slip + '? They will no longer be able to use the Admin page.')) { btn.disabled = false; return; }
          if (!m.admin_rights && row.admin_rights && !row.is_board &&
              !confirm('Give slip ' + m.slip + ' (' + owner + ') admin rights? They will be able to use everything on the Admin page.')) { btn.disabled = false; return; }
        }
        work = sb.from('members').update(row).eq('slip', m.slip).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          var hadNote = !!memNotes[m.slip];
          if (note) return sb.from('member_notes').upsert({ slip: m.slip, note: note });
          if (hadNote) return sb.from('member_notes').delete().eq('slip', m.slip);
        }).then(function (r) {
          if (r && r.error) throw new Error(r.error.message);
          return 'Saved changes to slip ' + m.slip + '.';
        });
      }

      work.then(function (msg) {
        done.textContent = msg;
        done.hidden = false;
        return loadMembers().then(function () {
          if (!memEditing) {
            // New slip added: clear the form for the next one, keeping the confirmation (and starting password) visible.
            openMemberForm(null);
            $('memAdded').textContent = msg + '  (The form is cleared for the next slip.)';
            $('memAdded').hidden = false;
          } else {
            memEditing = memRows.find(function (x) { return x.slip === memEditing.slip; }) || memEditing;
          }
        });
      }).catch(function (ex) { showErr(err, ex.message); })
        .then(function () { btn.disabled = false; });
    });
  }
  /* ---------- Help requests ---------- */
  var hrRows = [], hrWired = false;
  var HR_STATUS = { new: 'New', open: 'Being handled', done: 'Done' };
  function setupRequests() {
    if (!hrWired) {
      hrWired = true;
      $('hrRefresh').addEventListener('click', loadRequests);
      $('hrShow').addEventListener('change', drawRequests);
      $('hrTopics').innerHTML = D.HELP_TOPICS.map(function (t, i) {
        return '<label>' + D.esc(t) + '<input type="text" data-topic="' + i + '" maxlength="500" placeholder="(uses the default)" autocomplete="off" spellcheck="false"></label>';
      }).join('');
      $('hrSettings').addEventListener('submit', function (e) {
        e.preventDefault();
        function list(v) { return v.split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
        var def = list($('hrNotify').value), topics = {}, bad = [];
        document.querySelectorAll('#hrTopics input').forEach(function (inp) {
          var v = list(inp.value); if (v.length) topics[D.HELP_TOPICS[+inp.getAttribute('data-topic')]] = v.join(', ');
          bad = bad.concat(v);
        });
        bad = bad.concat(def).filter(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
        if (bad.length) { $('hrNotifyDone').textContent = 'This doesn’t look like an email address: ' + bad.join(', '); return; }
        sb.from('site_settings').upsert([{ key: 'help_notify_email', value: def.join(', ') }, { key: 'help_notify_topics', value: JSON.stringify(topics) }]).then(function (r) {
          var missing = D.HELP_TOPICS.filter(function (t) { return !topics[t]; });
          $('hrNotifyDone').textContent = r.error ? r.error.message : 'Saved.' + (!def.length && missing.length ? ' No default set, so these topics won’t be emailed: ' + missing.join(', ') + '.' : '');
        });
      });
      $('hrList').addEventListener('click', function (e) {
        var b = e.target.closest('[data-hr-save]'); if (!b) return;
        var id = b.getAttribute('data-hr-save'), card = b.closest('.hr-card');
        b.disabled = true;
        sb.from('help_requests').update({ status: card.querySelector('select').value, admin_note: card.querySelector('textarea').value.trim(),
          handled_by: null, updated_at: new Date().toISOString() }).eq('id', id).then(function (r) {
          b.disabled = false;
          if (r.error) { alert(r.error.message); return; }
          loadRequests();
        });
      });
    }
    sb.from('site_settings').select('key, value').in('key', ['help_notify_email', 'help_notify_topics']).then(function (r) {
      var map = {}; (r.data || []).forEach(function (x) { map[x.key] = x.value; });
      $('hrNotify').value = map.help_notify_email || '';
      var topics = {}; try { topics = JSON.parse(map.help_notify_topics || '{}'); } catch (x) {}
      document.querySelectorAll('#hrTopics input').forEach(function (inp) { inp.value = topics[D.HELP_TOPICS[+inp.getAttribute('data-topic')]] || ''; });
    });
    loadRequests();
  }
  function loadRequests() {
    return sb.from('help_requests').select('*').order('created_at', { ascending: false }).limit(300).then(function (r) {
      hrRows = r.data || [];
      var n = hrRows.filter(function (x) { return x.status === 'new'; }).length;
      $('requestsTab').innerHTML = 'Help Requests' + (n ? '<span class="board-count">' + n + '</span>' : '');
      drawRequests();
    });
  }
  function drawRequests() {
    var show = $('hrShow').value;
    var rows = hrRows.filter(function (x) {
      return show === 'all' || (show === 'todo' ? x.status !== 'done' : x.status === show);
    });
    var tel = function (p) { return p.replace(/[^\d+]/g, ''); };
    $('hrList').innerHTML = rows.length ? rows.map(function (x) {
      var who = D.esc(x.name || '(no name)') + ' <span class="note">&middot; ' + (x.member_class && x.member_class !== 'certificated'
        ? D.esc(CLASS_LABEL[x.member_class] || x.member_class) + (x.via_email ? '' : ' login') : x.slip ? 'slip ' + D.esc(x.slip) : 'member') +
        (x.via_email ? ' &middot; from an email&rsquo;s Help Desk button, no login' : '') + '</span>';
      var wants = [x.contact_text ? 'Text' : '', x.contact_call ? 'Call' : ''].filter(Boolean);
      return '<div class="hr-card st-' + x.status + '">' +
        '<div class="hr-head"><div><strong>' + D.esc(x.topic) + '</strong> &middot; ' + who + '</div>' +
          '<div class="note">' + D.esc(D.fmtWhen(x.created_at)) + ' <span class="help-status help-' + x.status + '">' + HR_STATUS[x.status] + '</span></div></div>' +
        '<div class="hr-msg">' + D.esc(x.message) + '</div>' +
        '<div class="hr-contact">' +
          (x.email ? '<a href="mailto:' + D.esc(x.email) + '?subject=' + encodeURIComponent('Your help request: ' + x.topic) + '">' + D.esc(x.email) + '</a>' : '') +
          (x.phone ? '<span>' + D.esc(x.phone) + ' &nbsp;<a href="tel:' + D.esc(tel(x.phone)) + '">Call</a> &middot; <a href="sms:' + D.esc(tel(x.phone)) + '">Text</a></span>' : '') +
          (wants.length ? '<span class="badge badge-cert">Prefers: ' + wants.join(' or ') + '</span>' : (x.email ? '<span class="note">Prefers email</span>' : '')) +
        '</div>' +
        '<div class="hr-edit">' +
          '<label style="font-size:.85rem">Status <select>' + ['new', 'open', 'done'].map(function (s) {
            return '<option value="' + s + '"' + (s === x.status ? ' selected' : '') + '>' + HR_STATUS[s] + '</option>'; }).join('') + '</select></label>' +
          '<textarea rows="2" maxlength="2000" placeholder="Notes for the office (members don’t see these)">' + D.esc(x.admin_note || '') + '</textarea>' +
          '<button type="button" class="btn-sm btn-primary-sm" data-hr-save="' + x.id + '">Save</button>' +
        '</div></div>';
    }).join('') : '<p class="note">No help requests here.</p>';
  }
})();
