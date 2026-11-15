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
      });
    }).catch(function (e) {
      $('adminLoading').textContent = e.message || 'Something went wrong.';
    });
  });

  /* ---------- Tabs ---------- */
  function setupTabs() {
    var tabs = document.querySelectorAll('.admin-tab');
    function show(name) {
      tabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
      document.querySelectorAll('.admin-panel').forEach(function (p) {
        p.hidden = p.getAttribute('data-panel') !== name;
      });
      try { sessionStorage.setItem('adminTab', name); } catch (e) {}
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { show(t.getAttribute('data-tab')); }); });
    var saved = null;
    try { saved = sessionStorage.getItem('adminTab'); } catch (e) {}
    if (saved) show(saved);
  }

  /* ---------- Events ---------- */
  function setupEvents() {
    $('evType').innerHTML = D.EVENT_TYPES.map(function (t) {
      return '<option value="' + t.id + '">' + t.label + '</option>';
    }).join('');
    $('evNew').addEventListener('click', function () { openEventForm(null); });
    $('evCancel').addEventListener('click', function () { $('evForm').hidden = true; });
    $('evForm').addEventListener('submit', saveEvent);
    $('evType').addEventListener('change', updateBallotBox);
    $('evBallotKind').addEventListener('change', updateBallotBox);
    $('evSignupOn').addEventListener('change', updateBallotBox);
    setupResults();
    setupExclusions();
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
      if (act === 'delete' && confirm('Delete "' + ev.title + '"? This cannot be undone.\n\nTip: choose Deactivate instead to just hide it from members.')) {
        sb.from('events').delete().eq('id', ev.id).then(function (r) {
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
        return '<tr' + (ev.active ? '' : ' class="row-inactive"') + '>' +
          '<td><a href="event.html?id=' + ev.id + '" target="_blank" rel="noopener"><strong>' + D.esc(ev.title) + '</strong></a>' +
            (ev.summary ? '<div class="note">' + D.esc(ev.summary) + '</div>' : '') + '</td>' +
          '<td><span class="badge badge-' + ev.event_type + '">' + D.eventTypeLabel(ev.event_type) + '</span></td>' +
          '<td>' + (ev.starts_at ? D.esc(D.fmtWhen(ev.starts_at, ev.ends_at)) : (isVote ? '' : '<span class="note">No date</span>')) + voteInfo + '</td>' +
          '<td>' + (ev.active ? 'Active' : '<span class="inactive">Inactive</span>') + '</td>' +
          '<td class="row-actions">' +
            (isVote ? '<button type="button" class="btn-sm btn-primary-sm" data-act="results" data-id="' + ev.id + '">Results</button>' : '') +
            (ev.signup_enabled ? '<button type="button" class="btn-sm btn-primary-sm" data-act="signups" data-id="' + ev.id + '">Sign-ups (' + (signupCounts[ev.id] || 0) + ')</button>' : '') +
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
    $('evBallotKind').value = ev ? ev.ballot_kind : 'yes_no';
    $('evResults').value = ev ? ev.results_visibility : 'after_close';
    $('evOptions').value = ev && ev.ballot_options ? ev.ballot_options.join('\n') : '';
    $('evVoteOpen').value = ev ? D.toLocalInput(ev.vote_opens_at) : '';
    $('evVoteClose').value = ev ? D.toLocalInput(ev.vote_closes_at) : '';
    loadExclusionsFor(ev);
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
    if (row.starts_at && row.ends_at && row.ends_at < row.starts_at) return showErr($('evError'), 'The end time is before the start time.');
    var id = $('evId').value;
    if (row.event_type === 'vote') {
      row.results_visibility = $('evResults').value;
      row.vote_opens_at = D.fromLocalInput($('evVoteOpen').value);
      row.vote_closes_at = D.fromLocalInput($('evVoteClose').value);
      if (!row.vote_closes_at) return showErr($('evError'), 'Please set when voting closes.');
      if (row.vote_opens_at && row.vote_closes_at <= row.vote_opens_at) return showErr($('evError'), 'Voting must close after it opens.');
      if (!$('evBallotKind').disabled) {
        row.ballot_kind = $('evBallotKind').value;
        row.ballot_options = row.ballot_kind === 'choice'
          ? $('evOptions').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean)
              .filter(function (s, i, a) { return a.indexOf(s) === i; })
          : [];
        if (row.ballot_kind === 'choice' && row.ballot_options.length < 2) return showErr($('evError'), 'Please enter at least two custom choices, one per line.');
      }
      if (!id && new Date(row.vote_closes_at) <= new Date() &&
          !confirm('The closing time is in the past, so this ballot will not accept any votes. Save anyway?')) return;
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
    var q = id ? sb.from('events').update(row).eq('id', id).select('id').single() : sb.from('events').insert(row).select('id').single();
    q.then(function (r) {
      if (r.error) return showErr($('evError'), r.error.message);
      return (isVoteNow ? saveExclusions(r.data.id) : Promise.resolve()).then(function (problem) {
        if (problem) return showErr($('evError'), 'The event was saved, but: ' + problem);
        $('evForm').hidden = true;
        loadEvents();
      });
    });
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
      sb.from('votes').select('slip, choice, cast_at').eq('event_id', ev.id),
      sb.from('vote_exclusions').select('slip, reason').eq('event_id', ev.id)
    ]).then(function (r) {
      var votes = {}, excl = {};
      (r[1].data || []).forEach(function (v) { votes[v.slip] = v; });
      (r[2].data || []).forEach(function (x) { excl[x.slip] = x.reason; });
      resultRows = (r[0].data || [])
        .filter(function (m) { return (m.active && m.can_vote) || votes[m.slip]; })
        .sort(function (a, b) { return a.slip.localeCompare(b.slip, undefined, { numeric: true }); })
        .map(function (m) { return { slip: m.slip, owner: m.owner_name, vote: votes[m.slip] || null, excluded: excl[m.slip] || null }; });
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
      return !f || (r.slip + ' ' + r.owner).toLowerCase().indexOf(f) !== -1;
    });
    $('vrRows').innerHTML = rows.length ? rows.map(function (r) {
      var status = r.vote ? '<span class="vote-choice">' + D.esc(r.vote.choice) + '</span>'
        : r.excluded ? '<span class="inactive">Ineligible</span> <span class="note">' + D.esc(r.excluded) + '</span>'
        : '<span class="note">Not voted</span>';
      var action = r.vote ? ''
        : r.excluded ? '<button type="button" class="btn-sm" data-ex="remove" data-slip="' + D.esc(r.slip) + '">Restore</button>'
        : (open ? '<button type="button" class="btn-sm btn-danger" data-ex="add" data-slip="' + D.esc(r.slip) + '">Ineligible</button>' : '');
      return '<tr' + (r.excluded ? ' class="row-inactive"' : '') + '><td><strong>' + D.esc(r.slip) + '</strong></td><td>' + D.esc(r.owner) + '</td>' +
        '<td>' + status + '</td>' +
        '<td class="note">' + (r.vote ? D.esc(D.fmtWhen(r.vote.cast_at)) : '') + '</td>' +
        '<td class="row-actions">' + action + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="note">No slips match.</td></tr>';

    // Running totals (all slips, not just the filtered rows). Ineligible slips don't count.
    var choices = D.ballotChoices(current);
    var counts = {}; choices.forEach(function (c) { counts[c] = 0; });
    var cast = 0, excluded = 0;
    resultRows.forEach(function (r) {
      if (r.excluded) { excluded++; return; }
      if (r.vote) { cast++; counts[r.vote.choice] = (counts[r.vote.choice] || 0) + 1; }
    });
    var eligible = resultRows.length - excluded;
    function pct(n, d) { return d ? (Math.round(n * 1000 / d) / 10) + '%' : '–'; }
    var maxCount = Math.max.apply(null, choices.map(function (c) { return counts[c]; }));
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
    var lines = [['Slip', 'Owner', 'Vote', 'Cast at (Eastern)'].map(q).join(',')];
    resultRows.forEach(function (r) {
      lines.push([r.slip, r.owner, rowStatus(r), r.vote ? D.fmtWhen(r.vote.cast_at) : ''].map(q).join(','));
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
      '<table><thead><tr><th>Slip</th><th>Owner</th><th>Vote</th><th>Cast</th><th></th></tr></thead><tbody>' +
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
    }).join('');
    $('docCategory').addEventListener('change', updateDateLabel);
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
  }

  function updateDateLabel() {
    var cat = D.DOC_CATEGORIES.find(function (c) { return c.id === $('docCategory').value; });
    $('docDateLabel').textContent = cat.dateLabel + (cat.id === 'minutes' ? ' (required)' : ' (optional)');
    $('docDate').required = cat.id === 'minutes';
  }

  function openDocForm(d) {
    $('docFormTitle').textContent = d ? 'Edit Document' : 'Upload Document';
    $('docSave').textContent = d ? 'Save Changes' : 'Upload';
    $('docId').value = d ? d.id : '';
    $('docCategory').value = d ? d.category : 'minutes';
    $('docDate').value = d && d.doc_date ? d.doc_date : '';
    $('docTitle').value = d ? d.title : '';
    $('docDesc').value = d ? d.description : '';
    $('docActive').checked = d ? d.active : true;
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
    var id = $('docId').value;
    var file = $('docFile').files[0];
    var row = {
      category: $('docCategory').value,
      title: $('docTitle').value.trim(),
      description: $('docDesc').value.trim(),
      doc_date: $('docDate').value || null,
      active: $('docActive').checked
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
      btn.textContent = 'Uploading…';
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

  function docRow(d) {
    return '<tr' + (d.active ? '' : ' class="row-inactive"') + '>' +
      '<td><strong>' + D.esc(d.title) + '</strong>' + (d.description ? '<div class="note">' + D.esc(d.description) + '</div>' : '') + '</td>' +
      '<td>' + (d.doc_date ? D.fmtDay(d.doc_date) : '') + '</td>' +
      '<td class="note">' + D.esc(d.file_name) + '<br>' + D.fileSize(d.size_bytes) + '</td>' +
      '<td>' + (d.active ? 'Visible' : '<span class="inactive">Hidden</span>') + '</td>' +
      '<td class="row-actions">' +
        '<button type="button" class="btn-sm" data-act="open" data-id="' + d.id + '">Open</button>' +
        '<button type="button" class="btn-sm" data-act="edit" data-id="' + d.id + '">Edit</button>' +
        '<button type="button" class="btn-sm" data-act="toggle" data-id="' + d.id + '">' + (d.active ? 'Hide' : 'Show') + '</button>' +
        '<button type="button" class="btn-sm btn-danger" data-act="delete" data-id="' + d.id + '">Delete</button>' +
      '</td></tr>';
  }

  function loadDocs() {
    return sb.from('documents').select('*').order('doc_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).then(function (r) {
      docs = r.data || [];
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
        btn.textContent = 'Uploading ' + (k + 1) + ' of ' + files.length + '…';
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
      ['photo_added', 'Gallery photo added'], ['photo_updated', 'Gallery photo updated'], ['photo_deleted', 'Gallery photo deleted'],
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
    var btn = $('logCsv'); btn.disabled = true; btn.textContent = 'Preparing…';
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
  var memRows = [], memNotes = {}, memEditing = null, memWired = false;

  function loadMembers() {
    if (!memWired) { wireMembers(); memWired = true; }
    return Promise.all([
      sb.from('members').select('slip, owner_name, email, active, is_admin, can_vote, user_id'),
      sb.from('member_notes').select('slip, note')
    ]).then(function (r) {
      if (r[0].error) return;
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
    var f = $('memSearch').value.toLowerCase(), show = $('memShow').value;
    $('memRows').innerHTML = memRows.filter(function (m) {
      if (show === 'noemail' && (m.email || m.is_admin)) return false;
      if (show === 'nonvoting' && (m.can_vote || m.is_admin)) return false;
      if (show === 'inactive' && m.active) return false;
      return !f || (m.slip + ' ' + m.owner_name + ' ' + (m.email || '') + ' ' + (memNotes[m.slip] || '')).toLowerCase().indexOf(f) !== -1;
    }).map(function (m) {
      return '<tr' + (m.active ? '' : ' class="row-inactive"') + '><td><strong>' + D.esc(m.slip) + '</strong></td><td>' + D.esc(m.owner_name) +
        (memNotes[m.slip] ? '<div class="note">' + D.esc(memNotes[m.slip]) + '</div>' : '') +
        '</td><td>' + (m.email ? D.esc(m.email) : '<em>none</em>') + '</td>' +
        '<td>' + (m.is_admin ? 'Admin' : (m.active ? 'Active' : '<span class="inactive">Inactive</span>')) +
        (!m.is_admin && !m.can_vote ? '<div class="note">Non-voting</div>' : '') + '</td>' +
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
    $('memActive').disabled = !isNew && m.is_admin;
    $('memCanVote').disabled = !isNew && m.is_admin;
    $('memPw').value = '';
    $('memPwLegend').textContent = isNew ? 'Starting password (required)' : 'Set a new password';
    $('memPwSet').hidden = isNew;
    $('memPwHelp').textContent = isNew
      ? 'Give this password to the owner privately. They can change it after logging in.'
      : 'Sets the password right away. Give it to the owner privately; they can change it after logging in.';
    $('memSave').textContent = isNew ? 'Add Slip' : 'Save Changes';
    ['memError', 'memDone', 'memPwDone'].forEach(function (id) { $(id).hidden = true; });
    $('memForm').hidden = false;
    $('memForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    (isNew ? $('memSlip') : $('memOwner')).focus();
  }

  function wireMembers() {
    $('memNew').addEventListener('click', function () { openMemberForm(null); });
    $('memCancel').addEventListener('click', function () { $('memForm').hidden = true; memEditing = null; });
    $('memSearch').addEventListener('input', drawMembers);
    $('memShow').addEventListener('change', drawMembers);
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
              $('memActive').checked ? null : sb.from('members').update({ active: false }).eq('slip', slip)
            ]);
          })
          .then(function () { return 'Slip ' + slip + ' added. Starting password: ' + pw; });
      } else {
        var m = memEditing;
        var row = { owner_name: owner, email: email || null };
        if (!m.is_admin) { row.active = $('memActive').checked; row.can_vote = $('memCanVote').checked; }
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
            var slipNow = $('memSlip').value.trim().toUpperCase();
            var created = memRows.find(function (x) { return x.slip === slipNow; });
            if (created) { memEditing = created; $('memSlip').readOnly = true; $('memFormTitle').textContent = 'Edit Slip ' + created.slip; $('memSave').textContent = 'Save Changes'; $('memPwSet').hidden = false; $('memPwLegend').textContent = 'Set a new password'; $('memPw').value = ''; }
          } else {
            memEditing = memRows.find(function (x) { return x.slip === memEditing.slip; }) || memEditing;
          }
        });
      }).catch(function (ex) { showErr(err, ex.message); })
        .then(function () { btn.disabled = false; });
    });
  }
})();
