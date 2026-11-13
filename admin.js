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
        setupTabs();
        setupEvents();
        setupDocs();
        loadMembers();
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
    setupResults();
    $('evRows').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var ev = events.find(function (x) { return x.id === b.getAttribute('data-id'); });
      if (!ev) return;
      var act = b.getAttribute('data-act');
      if (act === 'edit') openEventForm(ev);
      if (act === 'results') showResults(ev);
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

  var voteCounts = {};

  function loadEvents() {
    return Promise.all([
      sb.from('events').select('*').order('starts_at', { ascending: false, nullsFirst: true }),
      sb.from('votes').select('event_id')
    ]).then(function (res) {
      var r = res[0];
      voteCounts = {};
      (res[1].data || []).forEach(function (v) { voteCounts[v.event_id] = (voteCounts[v.event_id] || 0) + 1; });
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
        return '<tr' + (ev.active ? '' : ' class="row-inactive"') + '>' +
          '<td><a href="event.html?id=' + ev.id + '" target="_blank" rel="noopener"><strong>' + D.esc(ev.title) + '</strong></a>' +
            (ev.summary ? '<div class="note">' + D.esc(ev.summary) + '</div>' : '') + '</td>' +
          '<td><span class="badge badge-' + ev.event_type + '">' + D.eventTypeLabel(ev.event_type) + '</span></td>' +
          '<td>' + (ev.starts_at ? D.esc(D.fmtWhen(ev.starts_at, ev.ends_at)) : (isVote ? '' : '<span class="note">No date</span>')) + voteInfo + '</td>' +
          '<td>' + (ev.active ? 'Active' : '<span class="inactive">Inactive</span>') + '</td>' +
          '<td class="row-actions">' +
            (isVote ? '<button type="button" class="btn-sm btn-primary-sm" data-act="results" data-id="' + ev.id + '">Results</button>' : '') +
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
    if ($('evType').disabled) delete row.event_type;
    var q = id ? sb.from('events').update(row).eq('id', id) : sb.from('events').insert(row);
    q.then(function (r) {
      if (r.error) return showErr($('evError'), r.error.message);
      $('evForm').hidden = true;
      loadEvents();
    });
  }

  function updateBallotBox() {
    var isVote = $('evType').value === 'vote';
    $('evBallot').hidden = !isVote;
    $('evOptionsWrap').hidden = $('evBallotKind').value !== 'choice';
    $('evVoteClose').required = isVote;
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
      excludeSlips(slips, $('vrExReason').value.trim() || 'In arrears');
    });
    $('vrRows').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ex]');
      if (!b || !current) return;
      var slip = b.getAttribute('data-slip');
      if (b.getAttribute('data-ex') === 'add') {
        var reason = prompt('Make slip ' + slip + ' ineligible for "' + current.title + '".\n\nReason:', 'In arrears');
        if (reason === null) return;
        excludeSlips([slip], reason.trim() || 'In arrears');
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
      if (act === 'open') D.openDocument(sb, d.storage_path, d.file_name);
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
