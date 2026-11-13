/* Event page: details, and for votes the ballot (with a final confirmation) and results.
   Owners with several slips (same email on file) vote each slip from one login. */
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

    if (!me) {
      $('ballotBody').innerHTML = '<p class="note">Your slip could not be found.</p>';
      return loadResults();
    }
    if (me.is_admin) {
      $('ballotBody').innerHTML = '<p class="note">Admin accounts don\'t vote. Members vote by logging in with their own slip. ' +
        'You can follow the voting on the <a href="admin.html">Admin page</a> (Results button).</p>';
      return loadResults();
    }

    Promise.all([
      sb.rpc('my_slips'),
      sb.from('votes').select('slip, choice, cast_at').eq('event_id', ev.id)
    ]).then(function (res) {
      var all = (res[0].data && res[0].data.length) ? res[0].data : [{ slip: me.slip, owner_name: '', can_vote: true }];
      var slips = all.filter(function (s) { return s.can_vote !== false; });
      var nonVoting = all.filter(function (s) { return s.can_vote === false; });
      var votes = {};
      (res[1].data || []).forEach(function (v) { votes[v.slip] = v; });
      if (!slips.length) {
        $('ballotBody').innerHTML = '<p class="note">' + (nonVoting.length > 1 ? 'Your slips are non-voting slips' : 'Slip ' + D.esc(nonVoting[0].slip) + ' is a non-voting slip') +
          ', so there is no ballot to cast.</p>';
      } else {
        renderBallot(slips, votes, st);
        if (nonVoting.length) {
          $('ballotBody').insertAdjacentHTML('beforeend', '<p class="note" style="margin:10px 0 0">Non-voting slip' + (nonVoting.length > 1 ? 's' : '') + ': ' +
            nonVoting.map(function (s) { return D.esc(s.slip); }).join(', ') + '.</p>');
        }
      }
      loadResults();
      if (location.hash === '#ballot') {
        $('ballotCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', location.pathname + location.search);
      }
    });
  }

  function radios(slip, choices) {
    return choices.map(function (c) {
      return '<label class="ballot-choice"><input type="radio" name="choice-' + D.esc(slip) + '" value="' + D.esc(c) + '"> <span>' + D.esc(c) + '</span></label>';
    }).join('');
  }

  function renderBallot(slips, votes, st) {
    var multi = slips.length > 1;
    var done = slips.filter(function (s) { return votes[s.slip]; });
    var todo = slips.filter(function (s) { return !votes[s.slip]; });
    var html = '';

    if (done.length) {
      html += '<div class="member-login-note voted-list">' + done.map(function (s) {
        var v = votes[s.slip];
        return '<div>Slip <strong>' + D.esc(s.slip) + '</strong> voted <strong>' + D.esc(v.choice) + '</strong> on ' + D.esc(D.fmtWhen(v.cast_at)) + '.</div>';
      }).join('') + '</div>';
    }

    if (!todo.length) {
      html += '<p class="note" style="margin:10px 0 0">' + (multi ? 'All of your slips have voted. ' : '') +
        'Thank you for voting. Votes are final and can\'t be changed.</p>';
    } else if (st === 'upcoming') {
      html += '<p>The ballot will appear here when voting opens.</p>';
    } else if (st === 'closed') {
      html += '<p>Voting has closed. No vote was recorded for slip' + (todo.length > 1 ? 's ' : ' ') +
        '<strong>' + todo.map(function (s) { return D.esc(s.slip); }).join(', ') + '</strong>.</p>';
    } else {
      var choices = D.ballotChoices(ev);
      html += '<form id="ballotForm" class="ballot-form' + (todo.length > 1 ? ' multi' : '') + '">';
      if (todo.length > 1) {
        html += '<p style="margin:0">You have <strong>' + todo.length + ' slips</strong> still to vote. Each slip gets one vote. ' +
          'Choose for each slip, or use a button to fill them all in:</p>' +
          '<div class="ballot-fill">Same for all: ' + choices.map(function (c) {
            return '<button type="button" class="btn-sm" data-fill="' + D.esc(c) + '">' + D.esc(c) + '</button>';
          }).join('') + '</div>' +
          todo.map(function (s) {
            return '<fieldset class="ballot-slip"><legend>Slip ' + D.esc(s.slip) + '</legend>' +
              '<div class="ballot-slip-choices">' + radios(s.slip, choices) + '</div></fieldset>';
          }).join('') +
          '<p class="note" style="margin:0">You can vote some slips now and the rest later, until voting closes.</p>';
      } else {
        html += '<p style="margin:0">Voting for slip <strong>' + D.esc(todo[0].slip) + '</strong>. Choose one:</p>' + radios(todo[0].slip, choices);
      }
      html += '<button type="submit" class="btn btn-gold">' + (todo.length > 1 ? 'Cast Votes' : 'Cast Vote') + '</button></form>';
    }
    $('ballotBody').innerHTML = html;

    var form = $('ballotForm');
    if (!form) return;
    form.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fill]');
      if (!b) return;
      var val = b.getAttribute('data-fill');
      form.querySelectorAll('input[type="radio"]').forEach(function (r) { if (r.value === val) r.checked = true; });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var picks = todo.map(function (s) {
        var r = form.querySelector('input[name="choice-' + CSS.escape(s.slip) + '"]:checked');
        return r ? { slip: s.slip, choice: r.value } : null;
      }).filter(Boolean);
      if (!picks.length) {
        $('ballotError').textContent = todo.length > 1 ? 'Please choose a vote for at least one slip.' : 'Please choose one of the choices.';
        $('ballotError').hidden = false;
        return;
      }
      $('ballotError').hidden = true;
      openConfirm(picks, todo.length - picks.length);
    });
  }

  function openConfirm(picks, skipped) {
    $('vcList').innerHTML =
      '<p>You are casting ' + (picks.length > 1 ? picks.length + ' votes' : 'this vote') + ':</p>' +
      '<ul class="vc-picks">' + picks.map(function (p) {
        return '<li><span>Slip ' + D.esc(p.slip) + '</span><strong>' + D.esc(p.choice) + '</strong></li>';
      }).join('') + '</ul>' +
      (skipped ? '<p class="note">' + skipped + ' slip' + (skipped > 1 ? 's are' : ' is') + ' left blank and can vote later.</p>' : '');
    $('vcCast').textContent = picks.length > 1 ? 'Cast My Votes' : 'Cast My Vote';
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
      var errors = [];
      picks.reduce(function (chain, p) {
        return chain.then(function () {
          return sb.rpc('cast_vote', { p_event_id: ev.id, p_choice: p.choice, p_slip: p.slip }).then(function (r) {
            if (r.error) errors.push(r.error.message);
          });
        });
      }, Promise.resolve()).then(function () {
        $('vcCast').disabled = false;
        close();
        if (errors.length) {
          $('ballotError').textContent = errors.join(' ');
          $('ballotError').hidden = false;
        }
        loadBallot();
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
      '<p class="note" style="margin:12px 0 0">Percentages are of votes cast. ' + cast + ' of ' + eligible + ' voting slips have voted (' +
        (eligible ? Math.round(cast * 1000 / eligible) / 10 : 0) + '% turnout).</p>';
    });
  }
})();
