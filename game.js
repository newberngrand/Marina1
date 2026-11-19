/* Poker Run game page: join, pick a slip on the marina map each day to flip a card, trade on the
   last day, and the leaderboard when the game is over. All rules are enforced by the database
   (game_state / game_join / game_pick / game_discard); this page only shows and asks. */
(function () {
  var D = window.MemberData, P = window.PokerCards;
  function $(id) { return document.getElementById(id); }
  var id = new URLSearchParams(location.search).get('id');
  var sb, ev, st, email = '', svg, zoom = 1, trade = {}, pendingSlip = null, busy = false;
  var EMAIL_KEY = 'pokerRunEmail';

  function savedEmail() { try { return localStorage.getItem(EMAIL_KEY) || ''; } catch (e) { return ''; } }
  function rememberEmail(v) { try { if (v) localStorage.setItem(EMAIL_KEY, v); else localStorage.removeItem(EMAIL_KEY); } catch (e) {} }
  function showErr(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }
  function cleanMsg(e) { return String((e && e.message) || e || 'Something went wrong.').replace(/^.*?ERROR:\s*/, ''); }
  function fmtDay(ymd) {
    var p = ymd.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (window.innerWidth < 700) zoom = 2.2;
    MemberAuth.getClient().then(function (client) {
      sb = client;
      return sb.auth.getSession();
    }).then(function (r) {
      if (!r || !r.data.session) { $('gmStatus').textContent = 'Please log in to play.'; MemberAuth.openLogin('login'); return; }
      if (!id) { $('gmStatus').textContent = 'Game not found.'; return; }
      return sb.from('events').select('*').eq('id', id).maybeSingle().then(function (res) {
        ev = res.data;
        if (!ev || ev.event_type !== 'game') { $('gmStatus').textContent = 'This game is no longer available.'; return; }
        document.title = ev.title + ' | New Bern Grand Marina';
        $('gmEyebrow').textContent = D.gameLabel(ev.game_kind);
        $('gmH1').textContent = ev.title;
        email = savedEmail();
        setup();
        loadMap();
        MemberAuth.track('view_event', { type: 'event', id: ev.id, label: ev.title, details: { type: 'game' } });
        return refresh();
      });
    }).catch(function (e) { $('gmStatus').textContent = cleanMsg(e); });
  });

  function refresh() {
    return sb.rpc('game_state', { p_event: id, p_email: email || null }).then(function (r) {
      if (r.error) { $('gmStatus').textContent = cleanMsg(r.error); $('gmLoading').hidden = false; return; }
      st = r.data;
      render();
    });
  }

  function setup() {
    $('gmZoomIn').addEventListener('click', function () { setZoom(zoom * 1.5); });
    $('gmZoomOut').addEventListener('click', function () { setZoom(zoom / 1.5); });
    $('gmFlipCancel').addEventListener('click', closeFlip);
    $('gmFlipOk').addEventListener('click', function () { closeFlip(); refresh(); });
    $('gmFlipGo').addEventListener('click', doPick);
    $('gmTradeBtn').addEventListener('click', function () { doTrade(Object.keys(trade)); });
    $('gmKeepBtn').addEventListener('click', function () {
      if (confirm('Keep these five cards? Your hand will be final.')) doTrade([]);
    });
    $('gmHand').addEventListener('click', function (e) {
      var c = e.target.closest('[data-card]');
      if (!c || !st || !st.me || st.me.phase !== 'decide') return;
      var cid = c.getAttribute('data-card');
      if (trade[cid]) delete trade[cid]; else trade[cid] = true;
      renderHand();
    });
    document.querySelectorAll('[data-ga]').forEach(function (b) {
      b.addEventListener('click', function () { adminAction(b.getAttribute('data-ga')); });
    });
    // Keep the board fresh (slips others pick, the switch to the leaderboard).
    setInterval(function () { if (!document.hidden && !busy && !$('gmFlip').classList.contains('open')) refresh(); }, 30000);
  }

  /* ---------- Rendering ---------- */
  function render() {
    $('gmLoading').hidden = true;
    var me = st.me;

    // Admin practice controls
    $('gmAdmin').hidden = !(st.is_admin && st.practice);
    if (st.is_admin && st.practice) {
      $('gmAdminDay').textContent = st.over ? 'The practice game is over. Reset practice to play again.'
        : 'Practice day ' + st.practice_day + ' of 5. Practice players pick for today when you click Next day or End game.';
      var hideBtn = { bots: st.over || st.practice_day > 2, bots_play: st.over, next_day: st.over || st.practice_day >= 5, end: st.over };
      document.querySelectorAll('[data-ga]').forEach(function (b) { b.hidden = !!hideBtn[b.getAttribute('data-ga')]; });
      var roster = st.roster || [];
      $('gmRoster').innerHTML = roster.length ? '<strong>Players (' + roster.length + '):</strong> ' + roster.map(function (p) {
        return D.esc(p.name) + ' <span class="note">(' + p.cards + ' card' + (p.cards === 1 ? '' : 's') + ')</span>';
      }).join(', ') : (st.over ? '' : '<span class="note">No players yet.</span>');
    }

    // Header
    var dayText;
    if (st.over) dayText = 'Game over';
    else if (st.practice) dayText = 'Practice game &middot; Day ' + st.practice_day + ' of 5';
    else if (st.day) dayText = 'Day ' + st.day + ' of 5 &middot; ' + D.esc(fmtDay(st.days[st.day - 1]));
    else if (!st.elapsed) dayText = 'Starts ' + D.esc(fmtDay(st.days[0]));
    else dayText = 'No game today &middot; next pick ' + D.esc(fmtDay(st.days[st.elapsed] || st.days[4]));
    $('gmDay').innerHTML = dayText;
    var facts = '';
    if (ev.game_prize) facts += '<dt>Prize</dt><dd>' + D.esc(ev.game_prize) + '</dd>';
    facts += '<dt>Ends</dt><dd>' + (st.practice ? 'When an admin ends the practice' : D.esc(D.fmtWhen(st.ends_at))) + '</dd>';
    facts += '<dt>Players</dt><dd>' + st.players + '</dd>';
    $('gmFacts').innerHTML = facts;
    $('gmTop').hidden = false;
    $('gmMsg').innerHTML = message();

    renderJoin();
    renderHand();

    var canPick = !!(me && (me.phase === 'pick' || me.phase === 'drawing'));
    $('gmBoard').hidden = !!(st.over || !st.day || !(me || st.join_open));
    $('gmBoardTitle').textContent = !me ? 'The board' : me.phase === 'drawing' ? 'Pick ' + me.draws_owed + ' more slip' + (me.draws_owed > 1 ? 's' : '')
      : canPick ? 'Pick ' + (me.picks_left > 1 ? me.picks_left + ' slips' : 'a slip') : 'Today\'s board';
    $('gmBoardNote').textContent = canPick ? 'Every slip hides a face-down card. Tap an open slip to flip it. Slips already picked today are greyed out.'
      : 'Slips already picked today are greyed out. A fresh deck is dealt every morning.';
    $('gmMap').classList.toggle('can-pick', canPick);
    paintMap();
    renderLeaderboard();
  }

  function message() {
    var me = st.me;
    if (!me) {
      if (st.over) return 'This game is over. Here are the results.';
      if (!st.can_play) return 'You can follow along, but this game is open to ' + (ev.game_players || []).map(function (c) { return D.esc(D.classLabel(c)); }).join(', ') + '.';
      if (st.join_open) return 'Join below to start playing.';
      return 'Sign-up for this game closed after day 2.';
    }
    var who = st.shared ? '<span class="note">Playing as <strong>' + D.esc(me.name) + '</strong> (' + D.esc(email) + ') &middot; <a href="#" id="gmNotMe">Not you?</a></span><br>' : '';
    var m = '';
    switch (me.phase) {
      case 'waiting': m = 'You\'re in! Come back on day 1 to pick your first card.'; break;
      case 'rest': m = 'No pick today. See you on the next game day.'; break;
      case 'pick':
        m = me.picks_left > 1 ? 'You have <strong>' + me.picks_left + ' picks</strong> today (you missed ' + (me.picks_left > 2 ? 'some days' : 'a day') + '). Tap slips on the map below.'
          : 'Pick <strong>one slip</strong> on the map below to flip today\'s card.';
        break;
      case 'picked': m = 'You\'ve picked today. Come back tomorrow for your next card. Remember: miss two days in a row and you\'re out.'; break;
      case 'decide':
        m = 'That\'s five cards! Now you can trade: tap up to 3 cards to swap (4 if you keep an Ace), or keep your hand.'; break;
      case 'drawing': m = 'Pick <strong>' + me.draws_owed + '</strong> more slip' + (me.draws_owed > 1 ? 's' : '') + ' on the map for your new card' + (me.draws_owed > 1 ? 's' : '') + '.'; break;
      case 'done': m = 'Your hand is final. The leaderboard appears when the game ends' + (st.practice ? '.' : ' (' + D.esc(D.fmtWhen(st.ends_at)) + ').'); break;
      case 'out': m = 'You missed two days in a row, so you\'re out of this game. Better luck next time!'; break;
      case 'over': m = 'The game is over. See the leaderboard below.'; break;
    }
    setTimeout(function () {
      var nm = $('gmNotMe');
      if (nm) nm.onclick = function (e) { e.preventDefault(); email = ''; rememberEmail(''); refresh(); };
    });
    return who + m;
  }

  function renderJoin() {
    var me = st.me, box = $('gmJoin'), body = $('gmJoinBody');
    showErr($('gmJoinError'), '');
    if (me || st.over || !st.can_play || (!st.join_open && !st.shared)) { box.hidden = true; return; }
    box.hidden = false;
    if (st.shared) {
      body.innerHTML = '<p>Everyone on this login plays their own hand. Enter your email so the game knows who you are' +
        (st.join_open ? ' (and your name if this is your first time).' : '.') + '</p>' +
        '<form id="gmJoinForm" class="admin-grid">' +
        '<label>Your email <input type="email" id="gmJoinEmail" maxlength="254" required autocomplete="email" value="' + D.esc(email) + '"></label>' +
        (st.join_open ? '<label>Your name (first time only) <input type="text" id="gmJoinName" maxlength="120" autocomplete="name"></label>' : '') +
        '<div class="full"><button type="submit" class="btn btn-gold">' + (st.join_open ? 'Join / continue' : 'Continue') + '</button></div></form>';
      $('gmJoinForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var em = $('gmJoinEmail').value.trim().toLowerCase(), nm = $('gmJoinName') ? $('gmJoinName').value.trim() : '';
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return showErr($('gmJoinError'), 'Please enter a valid email address.');
        sb.rpc('game_state', { p_event: id, p_email: em }).then(function (r) {
          if (r.error) return showErr($('gmJoinError'), cleanMsg(r.error));
          if (r.data.joined) { email = em; rememberEmail(em); return refresh(); }
          if (!r.data.join_open) return showErr($('gmJoinError'), 'We couldn\'t find that email in this game, and sign-up has closed.');
          if (!nm) return showErr($('gmJoinError'), 'Welcome! Please enter your name too, so it can go on the leaderboard.');
          return sb.rpc('game_join', { p_event: id, p_name: nm, p_email: em }).then(function (j) {
            if (j.error) return showErr($('gmJoinError'), cleanMsg(j.error));
            email = em; rememberEmail(em);
            return refresh();
          });
        });
      });
    } else {
      body.innerHTML = '<p>One entry per owner. If you have more than one slip, you play one hand together.</p>' +
        '<form id="gmJoinForm" class="admin-grid">' +
        '<label>Name on the leaderboard <input type="text" id="gmJoinName" maxlength="120" value="' + D.esc(st.default_name || '') + '"></label>' +
        '<div class="full"><button type="submit" class="btn btn-gold">Join the game</button></div></form>';
      $('gmJoinForm').addEventListener('submit', function (e) {
        e.preventDefault();
        sb.rpc('game_join', { p_event: id, p_name: $('gmJoinName').value.trim() || null, p_email: null }).then(function (j) {
          if (j.error) return showErr($('gmJoinError'), cleanMsg(j.error));
          MemberAuth.track('game_join', { type: 'event', id: ev.id, label: ev.title });
          return refresh();
        });
      });
    }
  }

  function renderHand() {
    var me = st && st.me;
    if (!me) { $('gmHand').innerHTML = ''; $('gmHandName').textContent = ''; $('gmTrade').hidden = true; return; }
    var held = me.cards.filter(function (c) { return !c.discarded; });
    var gone = me.cards.filter(function (c) { return c.discarded; });
    var deciding = me.phase === 'decide';
    if (!deciding) trade = {};
    var html = '';
    for (var i = 0; i < 5; i++) {
      var c = held[i];
      if (c) {
        html += '<div class="hand-slot filled' + (deciding ? ' pickable' : '') + (trade[c.id] ? ' trading' : '') + '" data-card="' + c.id + '"' +
          (deciding ? ' role="button" tabindex="0" aria-pressed="' + !!trade[c.id] + '"' : '') + '>' + P.face(c.card) +
          '<span class="slot-cap">' + (c.kind === 'auto' ? 'Random card' : (c.kind === 'draw' ? 'Traded in &middot; ' : 'Day ' + c.day + ' &middot; ') + 'Slip ' + D.esc(c.slip || '')) + '</span>' +
          (trade[c.id] ? '<span class="trade-mark">Trade</span>' : '') + '</div>';
      } else {
        html += '<div class="hand-slot empty"><span>' + (i + 1) + '</span></div>';
      }
    }
    $('gmHand').innerHTML = html;
    var codes = held.map(function (c) { return c.card; });
    $('gmHandName').innerHTML = codes.length ? (held.length < 5 ? 'So far: ' : 'Your hand: ') + '<strong>' + D.esc(P.evaluate(codes).name) + '</strong>' +
      (gone.length ? ' <span class="note">&middot; traded away: ' + gone.map(function (c) { return D.esc(P.cardName(c.card)); }).join(', ') + '</span>' : '') : '';
    $('gmTrade').hidden = !deciding;
    if (deciding) {
      var ids = Object.keys(trade), n = ids.length;
      var keptAce = held.some(function (c) { return !trade[c.id] && P.rankOf(c.card) === 14; });
      var ok = n >= 1 && (n <= 3 || (n === 4 && keptAce));
      $('gmTradeBtn').disabled = !ok;
      $('gmTradeBtn').textContent = n ? 'Trade ' + n + ' card' + (n > 1 ? 's' : '') : 'Trade cards';
      $('gmTradeNote').textContent = n > 4 ? 'You can trade at most 4 cards.'
        : n === 4 && !keptAce ? 'To trade 4 cards, the card you keep must be an Ace.'
        : 'Tap the cards you want to trade. Up to 3, or 4 if the card you keep is an Ace.';
    }
  }

  function renderLeaderboard() {
    $('gmLeader').hidden = !st.over;
    if (!st.over) return;
    var rows = (st.leaderboard || []).map(function (p) {
      var full = !p.out_day && p.cards.length === 5;
      return { p: p, full: full, hand: full ? P.evaluate(p.cards) : null };
    });
    rows.sort(function (a, b) {
      if (a.full !== b.full) return a.full ? -1 : 1;
      if (!a.full) return b.p.cards.length - a.p.cards.length;
      return P.compare(a.hand, b.hand) || (new Date(a.p.finished_at || 0) - new Date(b.p.finished_at || 0));
    });
    $('gmLeaderNote').textContent = rows.length ? 'Best hand to worst. Ties go to high card and kickers, then to whoever finished first.' : 'Nobody played this game.';
    var place = 0;
    $('gmLeaderList').innerHTML = rows.map(function (r, i) {
      if (r.full) place = i + 1;
      return '<li class="lb-row' + (r.p.mine ? ' mine' : '') + (i === 0 && r.full ? ' winner' : '') + (r.full ? '' : ' out') + '">' +
        '<span class="lb-place">' + (r.full ? place : '&ndash;') + '</span>' +
        '<div class="lb-who"><strong>' + D.esc(r.p.name) + '</strong>' + (r.p.mine ? ' <span class="badge badge-game">You</span>' : '') +
        (i === 0 && r.full ? ' <span class="badge badge-vote">Winner' + (ev.game_prize ? ': ' + D.esc(ev.game_prize) : '') + '</span>' : '') +
        '<div class="lb-hand">' + (r.full ? D.esc(r.hand.name) : 'Out on day ' + r.p.out_day + ' (missed two days in a row)') + '</div></div>' +
        '<div class="lb-cards">' + r.p.cards.map(function (c) { return P.face(c); }).join('') + '</div></li>';
    }).join('');
  }

  /* ---------- Map ---------- */
  function loadMap() {
    var ver = (/[?&]v=([^&]+)/.exec((document.querySelector('script[src^="game.js"]') || {}).src || '') || [])[1];
    fetch('images/marina-slip-map.svg' + (ver ? '?v=' + ver : '')).then(function (r) { return r.text(); }).then(function (txt) {
      var box = $('gmMap');
      box.innerHTML = '<div class="game-map-stage">' + txt + '</div>';
      svg = box.querySelector('svg');
      svg.removeAttribute('width'); svg.removeAttribute('height');
      svg.addEventListener('click', function (e) {
        var g = e.target.closest('g.slip');
        if (!g || !box.classList.contains('can-pick') || g.classList.contains('taken')) return;
        openFlip(g.getAttribute('data-dock') + g.getAttribute('data-num'));
      });
      setZoom(zoom);
      paintMap();
    }).catch(function () { $('gmMap').innerHTML = '<p class="note">The marina map could not be loaded. Please refresh the page.</p>'; });
  }

  function setZoom(z) {
    zoom = Math.max(1, Math.min(5, z));
    var stage = $('gmMap').querySelector('.game-map-stage');
    if (stage) stage.style.width = (zoom * 100) + '%';
  }

  function paintMap() {
    if (!svg || !st) return;
    var taken = {}, mine = {};
    (st.taken || []).forEach(function (s) { taken[s] = true; });
    if (st.me && st.day) st.me.cards.forEach(function (c) { if (c.day === st.day && c.slip) mine[c.slip] = c.card; });
    svg.querySelectorAll('g.slip').forEach(function (g) {
      var s = g.getAttribute('data-dock') + g.getAttribute('data-num');
      g.classList.toggle('mine', !!mine[s]);
      g.classList.toggle('taken', !!taken[s] && !mine[s]);
      var t = g.querySelector('title');
      if (!t) { t = document.createElementNS('http://www.w3.org/2000/svg', 'title'); g.appendChild(t); }
      t.textContent = 'Slip ' + s + (mine[s] ? ': your ' + P.cardName(mine[s]) : taken[s] ? ' (picked today)' : '');
    });
  }

  /* ---------- Picking ---------- */
  function openFlip(slip) {
    pendingSlip = slip;
    $('gmFlipTitle').textContent = 'Slip ' + slip;
    $('gmFlipBack').innerHTML = P.back();
    $('gmFlipFront').innerHTML = '';
    $('gmFlipCard').classList.remove('flipped');
    $('gmFlipNote').textContent = 'Flip this card? Once it\'s flipped, it\'s yours.';
    showErr($('gmFlipError'), '');
    $('gmFlipAsk').hidden = false; $('gmFlipDone').hidden = true;
    $('gmFlipGo').disabled = false;
    $('gmFlip').classList.add('open');
    $('gmFlipGo').focus();
  }
  function closeFlip() { $('gmFlip').classList.remove('open'); pendingSlip = null; }

  function doPick() {
    if (!pendingSlip || busy) return;
    busy = true; $('gmFlipGo').disabled = true;
    sb.rpc('game_pick', { p_event: id, p_slip: pendingSlip, p_email: email || null }).then(function (r) {
      busy = false;
      if (r.error) { $('gmFlipGo').disabled = false; showErr($('gmFlipError'), cleanMsg(r.error)); refresh(); return; }
      var card = r.data;
      $('gmFlipFront').innerHTML = P.face(card);
      requestAnimationFrame(function () { $('gmFlipCard').classList.add('flipped'); });
      $('gmFlipNote').textContent = 'The ' + P.cardName(card) + '!';
      $('gmFlipAsk').hidden = true; $('gmFlipDone').hidden = false;
      MemberAuth.track('game_pick', { type: 'event', id: ev.id, label: ev.title, details: { slip: pendingSlip } });
      setTimeout(function () { $('gmFlipOk').focus(); }, 50);
    });
  }

  function doTrade(ids) {
    if (busy) return;
    if (ids.length && !confirm('Trade ' + ids.length + ' card' + (ids.length > 1 ? 's' : '') + '? You\'ll pick ' + (ids.length > 1 ? ids.length + ' new slips' : 'a new slip') + ' on the map. This can\'t be undone.')) return;
    busy = true;
    sb.rpc('game_discard', { p_event: id, p_cards: ids, p_email: email || null }).then(function (r) {
      busy = false;
      if (r.error) return showErr($('gmError'), cleanMsg(r.error));
      showErr($('gmError'), '');
      trade = {};
      refresh().then(function () { if (ids.length) $('gmBoard').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    });
  }

  /* ---------- Practice controls ---------- */
  function adminAction(act) {
    var ask = { reset: 'Reset the practice game? Every hand and practice player will be cleared.',
                end: 'End the practice game now and show the leaderboard?' }[act];
    if (ask && !confirm(ask)) return;
    showErr($('gmAdminError'), '');
    sb.rpc('game_admin', { p_event: id, p_action: act, p_n: act === 'bots' ? 5 : 0 }).then(function (r) {
      if (r.error) return showErr($('gmAdminError'), cleanMsg(r.error));
      refresh();
    });
  }
})();
