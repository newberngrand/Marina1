/* Event page: details, and for votes the ballot (with a final confirmation) and results. */
(function () {
  var D = window.MemberData;
  function $(id) { return document.getElementById(id); }
  var id = new URLSearchParams(location.search).get('id');
  var sb, ev, me;

  document.addEventListener('DOMContentLoaded', function () {
    MemberAuth.getClient().then(function (client) {
      sb = client;
      return sb.auth.getSession();
    }).then(function (r) {
      if (!r.data.session) { $('evStatus').textContent = 'Please log in to view member events.'; MemberAuth.openLogin('login'); return; }
      if (!id) { $('evStatus').textContent = 'Event not found.'; return; }
      return Promise.all([
        sb.from('events').select('*').eq('id', id).maybeSingle(),
        sb.from('members').select('slip, is_admin').eq('user_id', r.data.session.user.id).maybeSingle()
      ]).then(function (res) {
        ev = res[0].data;
        me = res[1].data;
        if (!ev) { $('evStatus').textContent = 'This event is no longer available.'; return; }
        renderEvent();
        if (ev.event_type === 'vote') loadBallot();
      });
    }).catch(function (e) { $('evStatus').textContent = e.message || 'Something went wrong.'; });
  });

  function renderEvent() {
    document.title = ev.title + ' | New Bern Grand Marina';
    $('evEyebrow').textContent = D.eventTypeLabel(ev.event_type);
    $('evH1').textContent = ev.title;
    var facts = '';
    if (ev.starts_at) facts += '<dt>When</dt><dd>' + D.esc(D.fmtWhen(ev.starts_at, ev.ends_at)) + '</dd>';
    if (ev.location) facts += '<dt>Where</dt><dd>' + D.esc(ev.location) + '</dd>';
    if (ev.event_type === 'vote') facts += '<dt>Voting</dt><dd>' + D.esc(D.voteWindowText(ev)) + '</dd>';
    facts += '<dt>Type</dt><dd>' + D.eventTypeLabel(ev.event_type) + (ev.active ? '' : ' (inactive: only admins can see this)') + '</dd>';
    $('evFacts').innerHTML = facts;
    if (ev.summary) { $('evSummaryText').textContent = ev.summary; $('evSummaryText').hidden = false; }
    $('evDetailsText').innerHTML = ev.details ? D.richText(ev.details) : '';
    $('evStatus').hidden = true;
    $('evBody').hidden = false;
  }

  function loadBallot() {
    $('ballotCard').hidden = false;
    var st = D.voteState(ev);
    $('ballotWindow').className = 'vote-state vote-' + st;
    $('ballotWindow').textContent = D.voteWindowText(ev) + '.';

    var myVote = me && !me.is_admin
      ? sb.from('votes').select('choice, cast_at').eq('event_id', ev.id).eq('slip', me.slip).maybeSingle()
      : Promise.resolve({ data: null });
    myVote.then(function (r) {
      var v = r.data;
      if (!me) {
        $('ballotBody').innerHTML = '<p class="note">Your slip could not be found.</p>';
      } else if (me.is_admin) {
        $('ballotBody').innerHTML = '<p class="note">Admin accounts don\'t vote. Members vote by logging in with their own slip. ' +
          'You can follow the voting on the <a href="admin.html">Admin page</a> (Results button).</p>';
      } else if (v) {
        showVoted(v);
      } else if (st === 'open') {
        showBallot();
      } else if (st === 'upcoming') {
        $('ballotBody').innerHTML = '<p>The ballot will appear here when voting opens.</p>';
      } else {
        $('ballotBody').innerHTML = '<p>Voting has closed. No vote was recorded for slip <strong>' + D.esc(me.slip) + '</strong>.</p>';
      }
      loadResults();
    });
  }

  function showVoted(v) {
    $('ballotBody').innerHTML =
      '<div class="member-login-note">Slip <strong>' + D.esc(me.slip) + '</strong> voted <strong>' + D.esc(v.choice) + '</strong> on ' +
      D.esc(D.fmtWhen(v.cast_at)) + '. Thank you for voting.</div>' +
      '<p class="note" style="margin:10px 0 0">Votes are final and can\'t be changed.</p>';
  }

  function showBallot() {
    var choices = D.ballotChoices(ev);
    $('ballotBody').innerHTML =
      '<p style="margin-top:0">Voting for slip <strong>' + D.esc(me.slip) + '</strong>. Choose one:</p>' +
      '<form id="ballotForm" class="ballot-form">' +
        choices.map(function (c, i) {
          return '<label class="ballot-choice"><input type="radio" name="choice" value="' + D.esc(c) + '"' + (i === 0 ? ' required' : '') + '> <span>' + D.esc(c) + '</span></label>';
        }).join('') +
        '<button type="submit" class="btn btn-gold">Cast Vote</button>' +
      '</form>';
    $('ballotForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var picked = $('ballotForm').querySelector('input[name="choice"]:checked');
      if (!picked) return;
      openConfirm(picked.value);
    });
  }

  function openConfirm(choice) {
    $('vcSlip').textContent = me.slip;
    $('vcChoice').textContent = choice;
    $('ballotError').hidden = true;
    var dlg = $('voteConfirm');
    dlg.classList.add('open');
    $('vcBack').focus();
    function close() {
      dlg.classList.remove('open');
      $('vcBack').removeEventListener('click', close);
      $('vcCast').removeEventListener('click', cast);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function cast() {
      $('vcCast').disabled = true;
      $('vcCast').textContent = 'Casting…';
      sb.rpc('cast_vote', { p_event_id: ev.id, p_choice: choice }).then(function (r) {
        $('vcCast').disabled = false;
        $('vcCast').textContent = 'Cast My Vote';
        close();
        if (r.error) {
          $('ballotError').textContent = r.error.message;
          $('ballotError').hidden = false;
          // Refresh in case the vote was already recorded or voting just closed.
          return loadBallot();
        }
        showVoted(r.data);
        loadResults();
      });
    }
    $('vcBack').addEventListener('click', close);
    $('vcCast').addEventListener('click', cast);
    document.addEventListener('keydown', onKey);
  }

  function loadResults() {
    sb.rpc('vote_totals', { p_event_id: ev.id }).then(function (r) {
      var rows = r.data || [];
      if (!rows.length) {
        if (ev.results_visibility === 'after_close' && D.voteState(ev) !== 'closed') {
          $('resultsCard').hidden = false;
          $('resultsTitle').textContent = 'Results';
          $('resultsBody').innerHTML = '<p class="note" style="margin:0">Results will be posted here after voting closes.</p>';
        }
        return;
      }
      var cast = Number(rows[0].cast_total), eligible = Number(rows[0].eligible);
      var closed = D.voteState(ev) === 'closed';
      $('resultsCard').hidden = false;
      $('resultsTitle').textContent = closed ? 'Final Results' : 'Running Totals';
      $('resultsBody').innerHTML = rows.map(function (x) {
        var n = Number(x.votes), p = cast ? Math.round(n * 1000 / cast) / 10 : 0;
        return '<div class="result-row"><div class="result-label"><strong>' + D.esc(x.choice) + '</strong><span>' + n + ' (' + p + '%)</span></div>' +
          '<div class="vr-bar"><span style="width:' + p + '%"></span></div></div>';
      }).join('') +
      '<p class="note" style="margin:12px 0 0">' + cast + ' of ' + eligible + ' slips have voted.</p>';
    });
  }
})();
