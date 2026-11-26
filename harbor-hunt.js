/* Harbor Hunt: a two-player hidden-fleet game played from Marina Chat.
   Challenge someone who's in the chat; each of you hides four boats on an 8 x 8 harbor;
   then take turns calling squares on the other's harbor until one finds every boat.
   Boat positions stay on the server (hh_* functions); a shot only reveals hit, miss or sunk.
   Live updates come through Supabase Realtime, with a quick check every few seconds as backup. */
(function () {
  var FLEET = [
    { type: 'yacht', name: 'Yacht', len: 4 },
    { type: 'sailboat', name: 'Sailboat', len: 3 },
    { type: 'trawler', name: 'Trawler', len: 3 },
    { type: 'skiff', name: 'Skiff', len: 2 }
  ];
  var NAMES = { yacht: 'Yacht', sailboat: 'Sailboat', trawler: 'Trawler', skiff: 'Skiff' };
  var ROWS = 'ABCDEFGH';
  var ctx = null, sb = null, match = null, shots = [], myShips = null, seat = 0;
  var place = { ships: {}, sel: 'yacht', vertical: false }, open = false, busy = false, lastStatus = '', lastTurn = 0, flashId = 0;
  var dismissed = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function label(i) { return ROWS[Math.floor(i / 8)] + (i % 8 + 1); }
  function short(n) { return String(n || '').replace(/\s*\(.*\)\s*$/, '') || n; }

  window.HarborHunt = { init: init };

  function init(c) {
    if (ctx) return;
    ctx = c; sb = c.sb;
    document.body.insertAdjacentHTML('beforeend',
      '<div class="hh-overlay" id="hhOverlay" hidden><div class="hh-panel" role="dialog" aria-modal="true" aria-labelledby="hhTitle">' +
        '<div class="hh-head"><h2 id="hhTitle"><span aria-hidden="true">&#9875;</span> Harbor Hunt</h2>' +
        '<button type="button" class="hh-x" id="hhClose" aria-label="Back to chat">Back to chat</button></div>' +
        '<div class="hh-body" id="hhBody"></div></div></div>');
    $('hhClose').addEventListener('click', hide);
    $('hhOverlay').addEventListener('click', function (e) { if (e.target.id === 'hhOverlay') hide(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) hide(); });
    $('hhBody').addEventListener('click', onClick);
    $('chGame').hidden = false;
    $('chGame').addEventListener('click', function () { show(); });
    $('hhBar').addEventListener('click', onClick);
    window.addEventListener('focus', function () { if (document.title.indexOf('Your turn') >= 0) document.title = 'Marina Chat | New Bern Grand Marina'; });

    sb.channel('harbor-hunt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hh_matches' }, function () { refresh(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hh_shots' }, function (p) {
        if (match && p.new.match_id === match.id) refresh();
      })
      .subscribe();
    refresh();
    var tick = 0;
    setInterval(function () { tick++; if (document.visibilityState === 'visible' && (match || tick % 2 === 0)) refresh(); }, 4000);
    setInterval(function () { if (open && !match) lobby(); }, 15000);
  }

  // The latest game this chat window is part of.
  function refresh() {
    if (busy) return Promise.resolve();
    var cid = ctx.clientId;
    return sb.from('hh_matches').select('*').or('p1_client.eq.' + cid + ',p2_client.eq.' + cid)
      .order('created_at', { ascending: false }).limit(1).then(function (r) {
        var m = r.data && r.data[0];
        var fresh = m && (['invited', 'placing', 'playing'].indexOf(m.status) >= 0
          ? Date.now() - new Date(m.updated_at).getTime() < 30 * 60000
          : Date.now() - new Date(m.updated_at).getTime() < 10 * 60000 && !dismissed[m.id]);
        if (!fresh) { match = null; shots = []; myShips = null; bar(); if (open) lobby(); return; }
        var changed = !match || match.id !== m.id;
        if (changed) { myShips = null; place = { ships: {}, sel: 'yacht', vertical: false }; }
        match = m; seat = m.p1_client === cid ? 1 : 2;
        var loads = [sb.from('hh_shots').select('*').eq('match_id', m.id).order('id')];
        if (!myShips && (m.status === 'playing' || m.status === 'done' || (m.status === 'placing' && m['p' + seat + '_ready']))) {
          loads.push(sb.rpc('hh_my_board', { p_match: m.id, p_client: cid }));
        }
        return Promise.all(loads).then(function (res) {
          var before = shots.length;
          shots = res[0].data || [];
          if (shots.length > before) flashId = shots[shots.length - 1].id;
          if (res[1] && res[1].data) myShips = res[1].data;
          var nowStatus = m.status + ':' + m.turn;
          // Open the board when a game you're in starts, and nudge the title when it's your turn.
          if (m.status !== lastStatus && (m.status === 'placing' || (m.status === 'invited' && seat === 1))) show(true);
          if (m.status === 'playing' && m.turn === seat && lastTurn !== seat && !document.hasFocus()) document.title = '⚓ Your turn · Marina Chat';
          lastStatus = m.status; lastTurn = m.status === 'playing' ? m.turn : 0;
          bar();
          if (open) draw();
          return nowStatus;
        });
      });
  }

  function them() { return match ? (seat === 1 ? match.p2_name : match.p1_name) : ''; }
  function themClient() { return match ? (seat === 1 ? match.p2_client : match.p1_client) : null; }

  // Strip above the message box: invitations, and a way back into a game in progress.
  function bar() {
    var b = $('hhBar'), m = match;
    if (!m || ['invited', 'placing', 'playing'].indexOf(m.status) < 0) { b.hidden = true; b.innerHTML = ''; return; }
    var html;
    if (m.status === 'invited' && seat === 2) {
      html = '<span>&#9875; <strong>' + esc(short(them())) + '</strong> challenges you to Harbor Hunt!</span>' +
        '<span class="hh-bar-btns"><button type="button" class="btn-sm btn-primary-sm" data-hh="accept">Accept</button>' +
        '<button type="button" class="btn-sm" data-hh="decline">No thanks</button></span>';
    } else {
      var what = m.status === 'invited' ? 'waiting for ' + esc(short(them())) + ' to accept'
        : m.status === 'placing' ? (m['p' + seat + '_ready'] ? 'waiting for ' + esc(short(them())) + ' to hide their boats' : 'hide your boats')
        : m.turn === seat ? '<strong>your turn!</strong>' : esc(short(them())) + '&rsquo;s turn';
      html = '<span>&#9875; Harbor Hunt with ' + esc(short(them())) + ': ' + what + '</span>' +
        '<span class="hh-bar-btns"><button type="button" class="btn-sm btn-primary-sm" data-hh="open">Open</button></span>';
    }
    b.innerHTML = html; b.hidden = false;
  }

  function show(auto) {
    if (auto && open) { draw(); return; }
    open = true;
    $('hhOverlay').hidden = false;
    document.documentElement.classList.add('hh-lock');
    if (match) draw(); else lobby();
  }
  function hide() {
    open = false;
    $('hhOverlay').hidden = true;
    document.documentElement.classList.remove('hh-lock');
    if (match && ['done', 'declined', 'cancelled'].indexOf(match.status) >= 0) { dismissed[match.id] = 1; match = null; bar(); }
  }
  function body(html) { $('hhBody').innerHTML = html; }
  function msg(text, bad) { var el = $('hhMsg'); if (el) { el.textContent = text || ''; el.className = 'hh-msg' + (bad ? ' bad' : ''); } }

  /* ---------- Choose someone to play ---------- */
  function lobby() {
    body('<p class="hh-intro">Hide your four boats in your harbor, then take turns calling squares to find the other player&rsquo;s boats. First to find every boat wins.</p>' +
      '<h3>Who would you like to play?</h3><div id="hhPlayers"><p class="note">Looking for players&hellip;</p></div><p class="hh-msg" id="hhMsg"></p>' + rulesHtml());
    sb.rpc('hh_players', { p_client: ctx.clientId }).then(function (r) {
      var list = (r && r.data) || [];
      $('hhPlayers').innerHTML = list.length ? '<ul class="hh-players">' + list.map(function (p) {
        return '<li><span>' + esc(p.name) + '</span>' + (p.busy ? '<span class="note">in a game</span>'
          : '<button type="button" class="btn-sm btn-primary-sm" data-hh="challenge" data-client="' + esc(p.client) + '">Challenge</button>') + '</li>';
      }).join('') + '</ul>' : '<p class="note">No one else is in the chat right now. When someone joins, they&rsquo;ll show up here.</p>';
    });
  }
  function rulesHtml() {
    return '<details class="hh-rules"><summary>How to play</summary><ul>' +
      '<li>Each harbor is 8 &times; 8 squares, rows A&ndash;H and columns 1&ndash;8.</li>' +
      '<li>Your fleet: Yacht (4 squares), Sailboat (3), Trawler (3) and Skiff (2). Boats go straight across or straight down and can&rsquo;t overlap.</li>' +
      '<li>Take turns calling one square on the other harbor. You&rsquo;ll hear Hit, Miss, or Sunk when you&rsquo;ve found a whole boat.</li>' +
      '<li>The first to find all four boats wins. The chat announces the winner.</li></ul></details>';
  }

  /* ---------- Drawing ---------- */
  function draw() {
    var m = match;
    if (!m) return lobby();
    if (m.status === 'invited') {
      if (seat === 1) body('<div class="hh-wait"><div class="hh-spinner" aria-hidden="true"></div><p>Waiting for <strong>' + esc(them()) + '</strong> to accept your challenge&hellip;</p>' +
        '<button type="button" class="btn-sm" data-hh="leave">Cancel challenge</button></div>');
      else body('<div class="hh-wait"><p><strong>' + esc(them()) + '</strong> challenges you to Harbor Hunt!</p><div class="hh-actions">' +
        '<button type="button" class="btn btn-gold" data-hh="accept">Accept</button> <button type="button" class="btn hh-btn-outline" data-hh="decline">No thanks</button></div>' + rulesHtml() + '</div>');
      return;
    }
    if (m.status === 'declined' || m.status === 'cancelled') {
      body('<div class="hh-wait"><p>' + (m.status === 'declined' ? esc(short(seat === 1 ? them() : 'You')) + (seat === 1 ? ' said no thanks this time.' : ' said no thanks.') : 'That game was called off.') + '</p>' +
        '<div class="hh-actions"><button type="button" class="btn btn-gold" data-hh="lobby">Find someone to play</button></div></div>');
      return;
    }
    if (m.status === 'placing' && !m['p' + seat + '_ready']) return drawPlacing();
    if (m.status === 'placing') {
      body('<div class="hh-wait"><div class="hh-spinner" aria-hidden="true"></div><p>Your boats are hidden. Waiting for <strong>' + esc(them()) + '</strong> to hide theirs&hellip;</p>' +
        '<button type="button" class="btn-sm" data-hh="leave">Call off the game</button></div>' + boardsHtml(false));
      return;
    }
    drawPlaying();
  }

  function shipAt(ships) {
    var at = {};
    (ships || []).forEach(function (s) { s.cells.forEach(function (c, k) { at[c] = { type: s.type, first: k === 0, last: k === s.cells.length - 1, vertical: s.cells.length > 1 && s.cells[1] - s.cells[0] === 8 }; }); });
    return at;
  }
  function gridHtml(opts) {
    var h = '<div class="hh-grid' + (opts.target ? ' target' : '') + (opts.active ? ' active' : '') + '" role="grid" aria-label="' + esc(opts.label) + '">';
    h += '<span class="hh-corner"></span>';
    for (var c = 0; c < 8; c++) h += '<span class="hh-colh">' + (c + 1) + '</span>';
    for (var r = 0; r < 8; r++) {
      h += '<span class="hh-rowh">' + ROWS[r] + '</span>';
      for (c = 0; c < 8; c++) {
        var i = r * 8 + c, cell = opts.cell(i);
        h += '<button type="button" class="hh-cell ' + cell.cls + '" data-cell="' + i + '"' + (cell.disabled ? ' disabled' : '') +
          ' aria-label="' + label(i) + (cell.say ? ', ' + cell.say : '') + '">' + (cell.mark || '') + '</button>';
      }
    }
    return h + '</div>';
  }
  function boatCls(s) { return s ? ' boat b-' + s.type + (s.first ? ' first' : '') + (s.last ? ' last' : '') + (s.vertical ? ' v' : ' h') : ''; }

  function drawPlacing() {
    var ships = FLEET.map(function (f) { return place.ships[f.type] ? { type: f.type, cells: place.ships[f.type] } : null; }).filter(Boolean);
    var at = shipAt(ships), done = ships.length === 4;
    var html = '<p class="hh-intro">Hide your boats from <strong>' + esc(them()) + '</strong>. Pick a boat, then tap the square where it should start.</p>' +
      '<div class="hh-place">' +
        '<div class="hh-fleet">' + FLEET.map(function (f) {
          return '<button type="button" class="hh-boatbtn' + (place.sel === f.type ? ' sel' : '') + (place.ships[f.type] ? ' placed' : '') + '" data-hh="pick" data-type="' + f.type + '">' +
            '<span class="hh-boatpic b-' + f.type + '">' + new Array(f.len + 1).join('<i></i>') + '</span>' + f.name + ' <span class="note">' + f.len + '</span>' +
            (place.ships[f.type] ? ' &#10003;' : '') + '</button>';
        }).join('') +
        '<div class="hh-tools"><button type="button" class="btn-sm" data-hh="rotate">' + (place.vertical ? '&#8597; Going down' : '&#8596; Going across') + '</button>' +
        '<button type="button" class="btn-sm" data-hh="shuffle">Shuffle</button><button type="button" class="btn-sm" data-hh="clear">Clear</button></div></div>' +
        gridHtml({ label: 'Your harbor', active: true, cell: function (i) { var s = at[i]; return { cls: boatCls(s), say: s ? NAMES[s.type] : 'water' }; } }) +
      '</div><p class="hh-msg" id="hhMsg"></p>' +
      '<div class="hh-actions"><button type="button" class="btn btn-gold" data-hh="ready"' + (done ? '' : ' disabled') + '>Ready &mdash; hide my boats</button>' +
      '<button type="button" class="btn-sm" data-hh="leave">Call off the game</button></div>';
    body(html);
  }

  function boardsHtml(playing) {
    var mineShots = shots.filter(function (s) { return s.player === seat; });
    var theirShots = shots.filter(function (s) { return s.player !== seat; });
    var mine = {}, theirs = {};
    mineShots.forEach(function (s) { mine[s.cell] = s; });
    theirShots.forEach(function (s) { theirs[s.cell] = s; });
    var at = shipAt(myShips), myTurn = playing && match.status === 'playing' && match.turn === seat;
    var foundTypes = mineShots.filter(function (s) { return s.result === 'sunk'; }).map(function (s) { return s.sunk_type; });
    var lostTypes = theirShots.filter(function (s) { return s.result === 'sunk'; }).map(function (s) { return s.sunk_type; });
    function fleetLine(list) {
      return '<div class="hh-fleetline">' + FLEET.map(function (f) { var gone = list.indexOf(f.type) >= 0; return '<span class="' + (gone ? 'gone' : '') + '">' + f.name + '</span>'; }).join('') + '</div>';
    }
    var target = gridHtml({ label: short(them()) + '’s harbor', target: true, active: myTurn, cell: function (i) {
      var s = mine[i];
      if (s) return { cls: s.result + (s.id === flashId ? ' flash' : ''), mark: s.result === 'miss' ? '<i></i>' : '&#10006;', disabled: true, say: s.result };
      return { cls: '', disabled: !myTurn, say: 'not called yet' };
    } });
    var own = gridHtml({ label: 'Your harbor', cell: function (i) {
      var s = theirs[i], b = at[i];
      return { cls: boatCls(b) + (s ? ' ' + s.result + (s.id === flashId ? ' flash' : '') : ''), mark: s ? (s.result === 'miss' ? '<i></i>' : '&#10006;') : '', disabled: true,
        say: (b ? NAMES[b.type] : 'water') + (s ? ', ' + s.result : '') };
    } });
    return '<div class="hh-boards">' +
      '<div class="hh-board"><h3>' + esc(short(them())) + '&rsquo;s harbor</h3>' + target + '<div class="note">Boats you&rsquo;ve sunk:</div>' + fleetLine(foundTypes) + '</div>' +
      '<div class="hh-board mine"><h3>Your harbor</h3>' + own + '<div class="note">Your boats sunk:</div>' + fleetLine(lostTypes) + '</div></div>';
  }

  function drawPlaying() {
    var m = match, last = shots[shots.length - 1], line = '';
    if (last) {
      var who = last.player === seat ? 'You' : short(them());
      line = who + ' called ' + label(last.cell) + ': ' + (last.result === 'miss' ? 'miss.' : last.result === 'hit' ? 'hit!' : 'sunk the ' + (NAMES[last.sunk_type] || 'boat') + '!');
    }
    var status;
    if (m.status === 'done') {
      var won = m.winner === seat;
      status = '<div class="hh-result ' + (won ? 'won' : 'lost') + '">' + (won ? '&#127942; You won! You found every boat.' : esc(short(them())) + ' won this one.') + '</div>';
    } else {
      status = '<div class="hh-turn ' + (m.turn === seat ? 'mine' : '') + '">' + (m.turn === seat ? 'Your turn &mdash; tap a square on ' + esc(short(them())) + '&rsquo;s harbor' : 'Waiting for ' + esc(short(them())) + '&hellip;') + '</div>';
    }
    body(status + (line ? '<p class="hh-last">' + esc(line) + '</p>' : '') + '<p class="hh-msg" id="hhMsg"></p>' + boardsHtml(true) +
      '<div class="hh-actions">' + (m.status === 'done'
        ? '<button type="button" class="btn btn-gold" data-hh="rematch">Play again</button><button type="button" class="btn-sm" data-hh="close">Close</button>'
        : '<button type="button" class="btn-sm" data-hh="leave">Give up</button>') + '</div>');
  }

  /* ---------- Placing boats ---------- */
  function cellsFor(len, start, vertical) {
    var r = Math.floor(start / 8), c = start % 8, out = [];
    for (var k = 0; k < len; k++) {
      var rr = vertical ? r + k : r, cc = vertical ? c : c + k;
      if (rr > 7 || cc > 7) return null;
      out.push(rr * 8 + cc);
    }
    return out;
  }
  function overlaps(cells, except) {
    return Object.keys(place.ships).some(function (t) { return t !== except && place.ships[t].some(function (x) { return cells.indexOf(x) >= 0; }); });
  }
  function shuffle() {
    for (var tries = 0; tries < 200; tries++) {
      place.ships = {};
      var ok = FLEET.every(function (f) {
        for (var n = 0; n < 100; n++) {
          var cells = cellsFor(f.len, Math.floor(Math.random() * 64), Math.random() < 0.5);
          if (cells && !overlaps(cells, f.type)) { place.ships[f.type] = cells; return true; }
        }
        return false;
      });
      if (ok) return;
    }
  }

  function onClick(e) {
    var b = e.target.closest('[data-hh], [data-cell]');
    if (!b || b.disabled) return;
    var act = b.getAttribute('data-hh');
    if (b.hasAttribute('data-cell') && !act) return cellClick(+b.getAttribute('data-cell'));
    if (act === 'open') return show();
    if (act === 'close') return hide();
    if (act === 'lobby') { if (match) dismissed[match.id] = 1; match = null; bar(); return lobby(); }
    if (act === 'challenge' || act === 'rematch') {
      var target = act === 'rematch' ? themClient() : b.getAttribute('data-client');
      if (act === 'rematch') { dismissed[match.id] = 1; }
      busy = true;
      return sb.rpc('hh_challenge', { p_client: ctx.clientId, p_target: target }).then(function (r) {
        busy = false;
        if (r.error) { if (act === 'rematch') { match = null; lobby(); } msg(r.error.message, true); return; }
        refresh().then(function () { show(true); });
      });
    }
    if (act === 'accept' || act === 'decline') {
      busy = true;
      return sb.rpc('hh_respond', { p_match: match.id, p_client: ctx.clientId, p_accept: act === 'accept' }).then(function (r) {
        busy = false;
        if (r.error) { alert(r.error.message); }
        if (act === 'decline') dismissed[match.id] = 1;
        refresh().then(function () { if (act === 'accept') show(); });
      });
    }
    if (act === 'leave') {
      var playing = match && match.status === 'playing';
      if (!confirm(playing ? 'Give up this game? ' + short(them()) + ' will win.' : 'Call off this game?')) return;
      busy = true;
      return sb.rpc('hh_leave', { p_match: match.id, p_client: ctx.clientId }).then(function () { busy = false; refresh(); });
    }
    if (act === 'pick') { place.sel = b.getAttribute('data-type'); return drawPlacing(); }
    if (act === 'rotate') { place.vertical = !place.vertical; return drawPlacing(); }
    if (act === 'shuffle') { shuffle(); place.sel = null; return drawPlacing(); }
    if (act === 'clear') { place.ships = {}; place.sel = 'yacht'; return drawPlacing(); }
    if (act === 'ready') {
      var payload = FLEET.map(function (f) { return { type: f.type, cells: place.ships[f.type] }; });
      busy = true;
      b.disabled = true;
      return sb.rpc('hh_place', { p_match: match.id, p_client: ctx.clientId, p_ships: payload }).then(function (r) {
        busy = false;
        if (r.error) { b.disabled = false; return msg(r.error.message, true); }
        myShips = payload;
        refresh();
      });
    }
  }

  function cellClick(i) {
    var m = match;
    if (!m) return;
    if (m.status === 'placing' && !m['p' + seat + '_ready']) {
      // Tapping a placed boat picks it up to move; otherwise place the chosen boat starting here.
      var hit = Object.keys(place.ships).filter(function (t) { return place.ships[t].indexOf(i) >= 0; })[0];
      if (hit && hit !== place.sel) { place.sel = hit; return drawPlacing(); }
      if (!place.sel) return msg('Pick a boat first.', true);
      var f = FLEET.filter(function (x) { return x.type === place.sel; })[0];
      var cells = cellsFor(f.len, i, place.vertical);
      if (!cells) return msg('The ' + f.name + ' doesn’t fit there. Try another square or turn it.', true);
      if (overlaps(cells, f.type)) return msg('Boats can’t overlap.', true);
      place.ships[f.type] = cells;
      var next = FLEET.filter(function (x) { return !place.ships[x.type]; })[0];
      place.sel = next ? next.type : null;
      return drawPlacing();
    }
    if (m.status === 'playing' && m.turn === seat) {
      busy = true;
      document.querySelectorAll('.hh-grid.target .hh-cell').forEach(function (c) { c.disabled = true; });
      sb.rpc('hh_fire', { p_match: m.id, p_client: ctx.clientId, p_cell: i }).then(function (r) {
        busy = false;
        if (r.error) { msg(r.error.message, true); return refresh(); }
        refresh();
      });
    }
  }
})();
