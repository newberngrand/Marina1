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
        sb.from('members').select('slip, is_admin, admin_rights, member_class').eq('user_id', r.data.session.user.id).maybeSingle()
      ]).then(function (res) {
        ev = res[0].data;
        me = res[1].data;
        if (!ev) { $('evStatus').textContent = 'This event is no longer available.'; return; }
        renderEvent();
        MemberAuth.track('view_event', { type: 'event', id: ev.id, label: ev.title, details: { type: ev.event_type } });
        loadAttachments();
        if (ev.event_type === 'vote') loadBallot();
        if (ev.signup_enabled) loadSignup();
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
    if (sharedLogin()) { renderGroupBallot(st); return loadResults(); }

    Promise.all([
      sb.rpc('my_slips'),
      sb.from('votes').select('slip, choice, cast_at').eq('event_id', ev.id),
      sb.from('vote_exclusions').select('slip, reason').eq('event_id', ev.id)
    ]).then(function (res) {
      var excl = {};
      (res[2].data || []).forEach(function (x) { excl[x.slip] = x.reason; });
      var all = (res[0].data && res[0].data.length) ? res[0].data : [{ slip: me.slip, owner_name: '', can_vote: true }];
      var ineligible = all.filter(function (s) { return s.can_vote !== false && excl[s.slip]; });
      var slips = all.filter(function (s) { return s.can_vote !== false && !excl[s.slip]; });
      var nonVoting = all.filter(function (s) { return s.can_vote === false; });
      var votes = {};
      (res[1].data || []).forEach(function (v) { votes[v.slip] = v; });
      var exclNote = ineligible.length ? '<div class="ineligible-list">' + ineligible.map(function (s) {
        return 'Slip <strong>' + D.esc(s.slip) + '</strong> is not eligible to vote on this ballot (' + D.esc(excl[s.slip]) + ').';
      }).join('<br>') + ' Please contact the marina office with any questions.</div>' : '';
      if (!slips.length && ineligible.length) {
        $('ballotBody').innerHTML = exclNote;
      } else if (!slips.length) {
        $('ballotBody').innerHTML = '<p class="note">' + (nonVoting.length > 1 ? 'Your slips are non-voting slips' : 'Slip ' + D.esc(nonVoting[0].slip) + ' is a non-voting slip') +
          ', so there is no ballot to cast.</p>';
      } else {
        renderBallot(slips, votes, st);
        if (exclNote) $('ballotBody').insertAdjacentHTML('beforeend', exclNote);
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

  // Shared cruiser login (LTC / STC): each person types their name and gets one vote.
  var justVoted = '';
  function renderGroupBallot(st) {
    var html = '';
    if (justVoted) {
      html += '<div class="member-login-note" style="margin-bottom:12px">Thank you! The vote from <strong>' + D.esc(justVoted) +
        '</strong> has been recorded. If an email was given, a receipt is on its way to it. To vote for someone else on this login, fill in the ballot again.</div>';
      justVoted = '';
    }
    if (st === 'upcoming') html += '<p>The ballot will appear here when voting opens.</p>';
    else if (st === 'closed') html += '<p>Voting has closed.</p>';
    else {
      html += '<form id="ballotForm" class="ballot-form">' +
        '<p style="margin:0">Everyone using this login gets one vote. Type your name' + (emailRequired() ? ' and email' : '') + ' and choose one:</p>' +
        '<label class="ballot-name">Your name<input type="text" id="ballotName" maxlength="80" autocomplete="name" required></label>' +
        '<label class="ballot-name">Your email' + (emailRequired() ? '' : ' (optional)') + '<input type="email" id="ballotEmail" maxlength="254" autocomplete="email"' + (emailRequired() ? ' required' : '') + '></label>' +
        radios('group', D.ballotChoices(ev)) +
        '<button type="submit" class="btn btn-gold">Cast Vote</button>' +
        '<p class="note" style="margin:8px 0 0">Votes are final and can&rsquo;t be changed.</p></form>';
    }
    $('ballotBody').innerHTML = html;
    var form = $('ballotForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('ballotName').value.trim().replace(/\s+/g, ' ');
      var email = $('ballotEmail').value.trim();
      var r = form.querySelector('input[name="choice-group"]:checked');
      var okEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
      var msg = !name ? 'Please type your name.'
        : (emailRequired() && !email) ? 'Please type your email address.'
        : (email && !okEmail) ? 'That email address doesn’t look right.'
        : !r ? 'Please choose one of the choices.' : '';
      $('ballotError').textContent = msg;
      $('ballotError').hidden = !msg;
      if (!msg) openConfirm([{ slip: me.slip, name: name, email: email, choice: r.value }], 0);
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
        return '<li><span>' + (p.name ? D.esc(p.name) + (p.email ? '<br><small>' + D.esc(p.email) + '</small>' : '') : 'Slip ' + D.esc(p.slip)) + '</span><strong>' + D.esc(p.choice) + '</strong></li>';
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
          var args = { p_event_id: ev.id, p_choice: p.choice, p_slip: p.slip };
          if (p.name) args.p_voter_name = p.name;
          if (p.email) args.p_voter_email = p.email;
          return sb.rpc('cast_vote', args).then(function (r) {
            if (r.error) errors.push(r.error.message);
            else if (p.name) justVoted = p.name;
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

  /* ---------- Documents for review ---------- */
  function loadAttachments() {
    sb.from('event_attachments').select('id, title, file_name, storage_path, size_bytes').eq('event_id', ev.id).order('sort_order').then(function (r) {
      var list = r.data || [];
      if (!list.length) return;
      $('attachCard').hidden = false;
      $('attachList').innerHTML = list.map(function (a, i) {
        return '<li><button type="button" class="doc-link" data-i="' + i + '">' + D.esc(a.title) + '</button>' +
          ' <span class="note">&middot; ' + D.esc((a.file_name.split('.').pop() || '').toUpperCase()) + (a.size_bytes ? ', ' + D.fileSize(a.size_bytes) : '') + '</span></li>';
      }).join('');
      $('attachList').addEventListener('click', function (e) {
        var b = e.target.closest('.doc-link');
        if (!b) return;
        var a = list[+b.getAttribute('data-i')];
        D.openDocument(sb, a.storage_path, a.file_name, { id: a.id, title: a.title + ' (' + ev.title + ')' });
      });
    });
  }

  /* ---------- Sign-up sheet ---------- */
  // Group logins (LTC / STC / staff) are shared by many people: each person adds
  // their own sign-up, and changes go through the office.
  function sharedLogin() { return !!(me && !me.is_admin && me.member_class && me.member_class !== 'certificated'); }
  var justSignedUp = '';
  function emailRequired() { return sharedLogin() && (me.member_class === 'ltc' || me.member_class === 'stc'); }

  function signupIsOpen() {
    return ev.active && (!ev.signup_closes_at || new Date(ev.signup_closes_at) > new Date());
  }

  function loadSignup() {
    $('signupCard').hidden = false;
    var open = signupIsOpen();
    $('signupWindow').className = 'vote-state ' + (open ? 'vote-open' : 'vote-closed');
    $('signupWindow').textContent = open
      ? 'Sign-up is open' + (ev.signup_closes_at ? ' until ' + D.fmtWhen(ev.signup_closes_at) : '') + '.'
      : 'Sign-up closed' + (ev.signup_closes_at ? ' ' + D.fmtWhen(ev.signup_closes_at) : '') + '.';
    $('signupError').hidden = true;

    var mine = me
      ? Promise.all([
          sb.from('event_signups').select('*').eq('event_id', ev.id).eq('slip', me.slip).maybeSingle(),
          sb.from('members').select('owner_name, email').eq('slip', me.slip).maybeSingle()
        ])
      : Promise.resolve([{ data: null }, { data: null }]);
    mine.then(function (res) {
      var entry = res[0].data, profile = res[1].data || {};
      if (!me) $('signupBody').innerHTML = '<p class="note">Your slip could not be found.</p>';
      else if (sharedLogin()) {
        if (open) { showSignupForm(null, {}); showChangeBox(); }
        else $('signupBody').innerHTML = '<p>Sign-up has closed. To change or cancel a sign-up, please call the marina office at (252) 638-0318.</p>';
        if (justSignedUp) {
          $('signupBody').insertAdjacentHTML('afterbegin', '<div class="member-login-note" style="margin-bottom:12px">Thank you! <strong>' + D.esc(justSignedUp) +
            '</strong> is signed up. To sign up someone else, fill in the form again. To change or cancel a sign-up later, tick &ldquo;I need to change or cancel my sign-up&rdquo; below.</div>');
          justSignedUp = '';
        }
      }
      else if (entry) showMyEntry(entry, open);
      else if (open) showSignupForm(null, profile);
      else $('signupBody').innerHTML = '<p>Sign-up has closed. Slip <strong>' + D.esc(me.slip) + '</strong> did not sign up.</p>';
      if (me && (me.is_admin || me.admin_rights)) {
        $('signupBody').insertAdjacentHTML('beforeend', '<p class="note" style="margin:10px 0 0">Admin: the full list with email and phone numbers is on the <a href="admin.html">Admin page</a> (Sign-ups button).</p>');
      }
      loadSignupList();
      if (location.hash === '#signup') {
        $('signupCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', location.pathname + location.search);
      }
    });
  }

  function showMyEntry(x, open) {
    var fields = ev.signup_fields || [];
    $('signupBody').innerHTML =
      '<div class="member-login-note">You\'re signed up! <strong>' + D.esc(x.name) + '</strong> (slip ' + D.esc(x.slip) + ')' +
      fields.map(function (f, k) { return (x.answers || [])[k] ? '<br>' + D.esc(f) + ': <strong>' + D.esc(x.answers[k]) + '</strong>' : ''; }).join('') +
      '</div>' +
      (open ? '<div class="portal-actions"><button type="button" class="btn btn-outline" id="suEdit">Change my sign-up</button>' +
              '<button type="button" class="btn-sm btn-danger" id="suCancel">Cancel my sign-up</button></div>'
            : '<p class="note" style="margin:10px 0 0">Sign-up has closed, so it can no longer be changed. Call the office if your plans change.</p>');
    if (!open) return;
    $('suEdit').addEventListener('click', function () { showSignupForm(x, {}); });
    $('suCancel').addEventListener('click', function () {
      if (!confirm('Cancel your sign-up for "' + ev.title + '"?')) return;
      sb.from('event_signups').delete().eq('id', x.id).then(function (r) {
        if (r.error) { $('signupError').textContent = r.error.message; $('signupError').hidden = false; return; }
        loadSignup();
      });
    });
  }

  function showSignupForm(x, profile) {
    var fields = ev.signup_fields || [];
    function val(v) { return D.esc(v || ''); }
    $('signupBody').innerHTML =
      '<form class="member-form signup-form" id="suForm">' +
        '<div class="signup-grid">' +
          '<label>Name<input type="text" id="suName" maxlength="120" required value="' + val(x ? x.name : profile.owner_name) + '"></label>' +
          '<label>' + (sharedLogin() ? 'Login' : 'Slip') + '<input type="text" value="' + val(me.slip) + '" disabled></label>' +
          '<label>' + (emailRequired() ? 'Email (required)' : 'Email') + '<input type="email" id="suEmail" maxlength="254"' + (emailRequired() ? ' required' : '') + ' value="' + val(x ? x.email : profile.email) + '"></label>' +
          '<label>Phone<input type="tel" id="suPhone" maxlength="40" value="' + val(x ? x.phone : '') + '"></label>' +
          fields.map(function (f, k) {
            return '<label class="full">' + D.esc(f) + '<input type="text" class="su-ans" maxlength="200" value="' + val(x && x.answers ? x.answers[k] : '') + '"></label>';
          }).join('') +
        '</div>' +
        '<div class="portal-actions" style="margin-top:4px"><button type="submit" class="btn btn-gold">' + (x ? 'Save Changes' : 'Sign Me Up') + '</button>' +
        (x ? '<button type="button" class="btn btn-outline" id="suBack">Never mind</button>' : '') + '</div>' +
        '<p class="note" style="margin:0">Your email and phone are only seen by the board.' +
          (sharedLogin() ? ' You&rsquo;ll need this email if you want to change or cancel your sign-up later.' : '') + '</p>' +
      '</form>';
    if (x) $('suBack').addEventListener('click', loadSignup);
    $('suForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var row = {
        name: $('suName').value.trim(),
        email: $('suEmail').value.trim() || null,
        phone: $('suPhone').value.trim() || null,
        answers: Array.prototype.map.call(document.querySelectorAll('.su-ans'), function (i) { return i.value.trim(); })
      };
      if (!row.name) { $('signupError').textContent = 'Please enter your name.'; $('signupError').hidden = false; return; }
      if (emailRequired() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email || '')) {
        $('signupError').textContent = 'Please enter your email address. It is needed if you want to change or cancel your sign-up later.';
        $('signupError').hidden = false; return;
      }
      var q = x ? sb.from('event_signups').update(row).eq('id', x.id)
                : sb.from('event_signups').insert(Object.assign({ event_id: ev.id, slip: me.slip }, row));
      q.then(function (r) {
        if (r.error) {
          $('signupError').textContent = /row-level security/.test(r.error.message)
            ? 'Sign-up for this event has closed.'
            : (r.error.code === '23505' ? (sharedLogin() ? 'Someone named ' + row.name + ' is already signed up from this login.' : 'Your slip is already signed up.') : r.error.message);
          $('signupError').hidden = false;
          return;
        }
        if (sharedLogin()) justSignedUp = row.name;
        loadSignup();
      });
    });
  }

  /* Shared logins: change or cancel your own entry by typing the email used on it. */
  function showChangeBox() {
    var st = { email: '' };
    $('signupBody').insertAdjacentHTML('beforeend',
      '<div class="signup-change">' +
        '<label class="check"><input type="checkbox" id="scToggle"> I need to change or cancel my sign-up</label>' +
        '<div id="scBox" hidden>' +
          '<p class="note" style="margin:6px 0 8px">Type the email you used when you signed up.</p>' +
          '<form class="sc-row" id="scFind"><input type="email" id="scEmail" maxlength="254" placeholder="Your email" aria-label="Your email">' +
            '<button type="submit" class="btn-sm btn-primary-sm">Find my sign-up</button></form>' +
          '<div class="member-login-error" id="scErr" hidden></div>' +
          '<div class="note" id="scMsg"></div>' +
          '<div id="scEntries"></div>' +
        '</div>' +
      '</div>');
    function err(m) { $('scErr').textContent = m || ''; $('scErr').hidden = !m; }
    function msg(m) { $('scMsg').textContent = m || ''; }
    $('scToggle').addEventListener('change', function () { $('scBox').hidden = !this.checked; if (this.checked) $('scEmail').focus(); });
    $('scFind').addEventListener('submit', function (e) {
      e.preventDefault();
      var em = $('scEmail').value.trim();
      err(''); msg(''); $('scEntries').innerHTML = '';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return err('Please type the email you used when you signed up.');
      st.email = em;
      loadEntries();
    });
    function loadEntries(done, quiet) {
      sb.rpc('signup_email_entries', { p_event_id: ev.id, p_email: st.email }).then(function (r) {
        var j = r.data || {};
        if (r.error || !j.ok) { if (quiet) return; return err((j && j.error) || (r.error && r.error.message) || 'Something went wrong.'); }
        msg(done || '');
        var list = j.entries || [], fields = ev.signup_fields || [];
        $('scEntries').innerHTML = list.length ? list.map(function (x, i) {
          return '<div class="sc-entry"><div><strong>' + D.esc(x.name) + '</strong>' +
            fields.map(function (f, k) { return (x.answers || [])[k] ? '<br><span class="note">' + D.esc(f) + ':</span> ' + D.esc(x.answers[k]) : ''; }).join('') +
            '</div><div class="row-actions"><button type="button" class="btn-sm" data-sc-edit="' + i + '">Change</button>' +
            '<button type="button" class="btn-sm btn-danger" data-sc-del="' + i + '">Cancel sign-up</button></div></div>';
        }).join('') : '<p class="note">There are no sign-ups left that use ' + D.esc(st.email) + '.</p>';
        $('scEntries').onclick = function (e) {
          var b = e.target.closest('[data-sc-edit],[data-sc-del]');
          if (!b) return;
          var x = list[+(b.getAttribute('data-sc-edit') || b.getAttribute('data-sc-del'))];
          if (b.hasAttribute('data-sc-del')) {
            if (!confirm('Cancel the sign-up for ' + x.name + '?')) return;
            sb.rpc('signup_email_delete', { p_event_id: ev.id, p_email: st.email, p_id: x.id }).then(function (r) {
              var j = r.data || {};
              if (r.error || !j.ok) return err((j && j.error) || r.error.message);
              loadSignupList();
              $('scEntries').innerHTML = '';
              msg('The sign-up for ' + x.name + ' has been cancelled.');
              loadEntries('The sign-up for ' + x.name + ' has been cancelled.', true);
            });
          } else editEntry(x);
        };
      });
    }
    function editEntry(x) {
      var fields = ev.signup_fields || [];
      function val(v) { return D.esc(v || ''); }
      $('scEntries').innerHTML = '<form class="member-form signup-form" id="scForm"><div class="signup-grid">' +
        '<label>Name<input type="text" id="scName" maxlength="120" required value="' + val(x.name) + '"></label>' +
        '<label>Email (required)<input type="email" id="scNewEmail" maxlength="254" required value="' + val(x.email) + '"></label>' +
        '<label>Phone<input type="tel" id="scPhone" maxlength="40" value="' + val(x.phone) + '"></label>' +
        fields.map(function (f, k) { return '<label class="full">' + D.esc(f) + '<input type="text" class="sc-ans" maxlength="200" value="' + val((x.answers || [])[k]) + '"></label>'; }).join('') +
        '</div><div class="portal-actions" style="margin-top:4px"><button type="submit" class="btn btn-gold">Save Changes</button>' +
        '<button type="button" class="btn btn-outline" id="scBack">Never mind</button></div></form>';
      $('scBack').addEventListener('click', function () { loadEntries(); });
      $('scForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var newEmail = $('scNewEmail').value.trim();
        sb.rpc('signup_email_save', {
          p_event_id: ev.id, p_email: st.email, p_id: x.id,
          p_name: $('scName').value.trim(), p_new_email: newEmail, p_phone: $('scPhone').value.trim(),
          p_answers: Array.prototype.map.call(document.querySelectorAll('.sc-ans'), function (i) { return i.value.trim(); })
        }).then(function (r) {
          var j = r.data || {};
          if (r.error || !j.ok) return err((j && j.error) || r.error.message);
          err('');
          loadSignupList();
          if (newEmail.toLowerCase() !== st.email.toLowerCase()) {
            $('scEntries').innerHTML = '';
            msg('Saved. This sign-up now uses ' + newEmail + ', so type that email next time.');
          } else loadEntries('Your changes have been saved.');
        });
      });
    }
  }

  function loadSignupList() {
    if (!ev.signup_public && !(me && (me.is_admin || me.admin_rights))) { $('signupList').innerHTML = ''; return; }
    sb.rpc('signup_list', { p_event_id: ev.id }).then(function (r) {
      var rows = r.data || [], fields = ev.signup_fields || [];
      $('signupList').innerHTML = '<h4 class="signup-list-head">Who\'s coming (' + rows.length + ')</h4>' +
        (rows.length ? '<div class="admin-table-wrap"><table class="admin-table signup-table"><thead><tr><th>Name</th><th>Slip</th>' +
          fields.map(function (f) { return '<th>' + D.esc(f) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (x) {
            return '<tr' + (me && x.slip === me.slip ? ' class="mine"' : '') + '><td>' + D.esc(x.name) + '</td><td>' + D.esc(x.slip) + '</td>' +
              fields.map(function (f, k) { return '<td>' + D.esc((x.answers || [])[k] || '') + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>'
        : '<p class="note">Nobody has signed up yet. Be the first!</p>');
    });
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
      function pc(n, d) { return d ? Math.round(n * 1000 / d) / 10 : 0; }
      if (!eligible || (ev.audience || []).some(function (a) { return a !== 'certificated'; })) {
        // Ballot includes cruisers voting by name: no fixed list of voters, so show each choice as a share of the votes cast.
        $('resultsBody').innerHTML = rows.map(function (x) {
          var n = Number(x.votes), p = pc(n, cast);
          return '<div class="result-row"><div class="result-label"><strong>' + D.esc(x.choice) + '</strong>' +
            '<span>' + n + ' vote' + (n === 1 ? '' : 's') + ' (' + p + '%)</span></div>' +
            '<div class="vr-bar"><span style="width:' + p + '%"></span></div></div>';
        }).join('') + '<p class="note" style="margin:12px 0 0">' + cast + ' vote' + (cast === 1 ? '' : 's') + ' cast.</p>';
        return;
      }
      $('resultsBody').innerHTML = rows.map(function (x) {
        var n = Number(x.votes), p = pc(n, eligible);
        return '<div class="result-row"><div class="result-label"><strong>' + D.esc(x.choice) + '</strong>' +
          '<span>' + n + ' of ' + eligible + ' slips (' + p + '%)</span></div>' +
          '<div class="vr-bar"><span style="width:' + p + '%"></span></div></div>';
      }).join('') +
      '<p class="note" style="margin:12px 0 0">' + cast + ' of ' + eligible + ' voting slips have voted (' + pc(cast, eligible) + '% turnout).</p>';
    });
  }
})();
