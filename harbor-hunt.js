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
  var dismissed = {}, seenShot = {}, animated = {}, drawnSig = '', tilted = {}, ended = {};
  var SND = window.HarborSounds || { boom: noop, splash: noop, sink: noop, place: noop, ambientStart: noop, ambientStop: noop, isOn: function () { return false; }, toggle: noop, unlock: noop };
  function noop() {}

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function label(i) { return ROWS[Math.floor(i / 8)] + (i % 8 + 1); }
  function short(n) { return String(n || '').replace(/\s*\(.*\)\s*$/, '') || n; }

  // The artwork (boats, water, flames, splashes) is shared with Harbor Hunt against the computer (harbor-solo.js).
  window.HarborHunt = { init: init, art: { svgDefs: svgDefs, boatSvg: boatSvg, boatHtml: boatHtml, fxHtml: fxHtml, gridHtml: gridHtml,
    sunkCells: sunkCells, fleetButtons: fleetButtons, FLEET: FLEET, NAMES: NAMES, label: label } };

  function init(c) {
    if (ctx) return;
    ctx = c; sb = c.sb;
    document.body.insertAdjacentHTML('beforeend',
      '<div class="hh-overlay" id="hhOverlay" hidden><div class="hh-panel" role="dialog" aria-modal="true" aria-labelledby="hhTitle">' +
        '<div class="hh-head"><h2 id="hhTitle"><span aria-hidden="true">&#9875;</span> Harbor Hunt</h2>' +
        '<span class="hh-head-btns"><button type="button" class="hh-x hh-snd" id="hhSound"></button>' +
        '<button type="button" class="hh-x" id="hhClose" aria-label="Back to chat">Back to chat</button></span></div>' +
        '<div class="hh-body" id="hhBody"></div></div></div>' + svgDefs());
    function soundLabel() { $('hhSound').innerHTML = SND.isOn() ? '&#128266; Sound on' : '&#128263; Sound off'; $('hhSound').setAttribute('aria-pressed', SND.isOn() ? 'true' : 'false'); }
    soundLabel();
    $('hhSound').addEventListener('click', function () { SND.toggle(); soundLabel(); if (open && SND.isOn()) SND.ambientStart(); });
    // Browsers only allow sound after a tap, so any tap in the game unlocks it.
    $('hhOverlay').addEventListener('pointerdown', function () { SND.unlock(); if (open) SND.ambientStart(); });
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
          shots = res[0].data || [];
          var maxId = shots.length ? shots[shots.length - 1].id : 0;
          if (seenShot[m.id] === undefined) seenShot[m.id] = maxId;     // first look: no effects for old shots
          else if (maxId > seenShot[m.id]) {
            var fresh = shots.filter(function (x) { return x.id > seenShot[m.id]; }), last = fresh[fresh.length - 1];
            seenShot[m.id] = maxId; flashId = last.id;
            var pan = ((last.cell % 8) - 3.5) / 3.5 * 0.75;
            if (last.result === 'miss') SND.splash(pan);
            else { SND.boom(pan); if (last.result === 'sunk') setTimeout(function () { SND.sink(pan); }, 500); }
          }
          if (res[1] && res[1].data) myShips = res[1].data;
          var nowStatus = m.status + ':' + m.turn;
          // Open the board when a game you're in starts, and nudge the title when it's your turn.
          if (m.status !== lastStatus && (m.status === 'placing' || (m.status === 'invited' && seat === 1))) show(true);
          if (m.status === 'playing' && m.turn === seat && lastTurn !== seat && !document.hasFocus()) document.title = '⚓ Your turn · Marina Chat';
          lastStatus = m.status; lastTurn = m.status === 'playing' ? m.turn : 0;
          bar();
          var sig = m.id + m.status + m.turn + m.p1_ready + m.p2_ready + shots.length + (myShips ? 1 : 0);
          if (open && sig !== drawnSig) draw();
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
    open = true; drawnSig = '';
    $('hhOverlay').hidden = false;
    SND.ambientStart();
    document.documentElement.classList.add('hh-lock');
    if (match) draw(); else lobby();
  }
  function hide() {
    open = false;
    $('hhOverlay').hidden = true;
    SND.ambientStop();
    document.documentElement.classList.remove('hh-lock');
    if (match && ['done', 'declined', 'cancelled'].indexOf(match.status) >= 0) { dismissed[match.id] = 1; match = null; bar(); }
  }
  function body(html) {
    $('hhBody').innerHTML = html;
    drawnSig = match ? match.id + match.status + match.turn + match.p1_ready + match.p2_ready + shots.length + (myShips ? 1 : 0) : '';
    if (flashId) animated[flashId] = 1;
  }
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

  /* ---------- Shared paint: gradients and filters used by every boat, flame and splash ---------- */
  function svgDefs() {
    function grad(id, stops, x2, y2) {
      return '<linearGradient id="' + id + '" x1="0" y1="0" x2="' + (x2 || 0) + '" y2="' + (y2 === undefined ? 1 : y2) + '">' + stops.map(function (s) {
        return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"/>'; }).join('') + '</linearGradient>';
    }
    function rad(id, stops, cx, cy, r) {
      return '<radialGradient id="' + id + '" cx="' + (cx || 0.5) + '" cy="' + (cy || 0.5) + '" r="' + (r || 0.5) + '">' + stops.map(function (s) {
        return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"/>'; }).join('') + '</radialGradient>';
    }
    return '<svg class="hh-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
      grad('hhCream', [[0, '#fffef8'], [0.35, '#f4ecd9'], [0.75, '#d9cba8'], [1, '#8f7f5c']]) +
      grad('hhWhite', [[0, '#ffffff'], [0.4, '#eef2f6'], [0.78, '#c4cfd9'], [1, '#7f8f9e']]) +
      grad('hhGreen', [[0, '#6fb894'], [0.35, '#3d8462'], [0.75, '#24573f'], [1, '#0f2a1d']]) +
      grad('hhRed', [[0, '#ff9f7c'], [0.35, '#d4613f'], [0.75, '#a3412a'], [1, '#5a1f12']]) +
      grad('hhDeck', [[0, '#fbfcfd'], [0.6, '#e1e7ec'], [1, '#b7c2cc']]) +
      grad('hhTeak', [[0, '#e2b07a'], [0.5, '#b07a45'], [1, '#7a4f26']]) +
      grad('hhGlass', [[0, '#a8d8f0'], [0.35, '#3d7397'], [0.7, '#1b3953'], [1, '#0b1a28']]) +
      grad('hhRoof', [[0, '#ffffff'], [0.55, '#e6ecf1'], [1, '#aebbc6']]) +
      grad('hhChrome', [[0, '#ffffff'], [0.5, '#9aa6b1'], [1, '#e5eaee']]) +
      grad('hhSheen', [[0, 'rgba(255,255,255,.85)'], [0.3, 'rgba(255,255,255,.15)'], [0.55, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,.28)']]) +
      grad('hhLong', [[0, 'rgba(0,0,0,.18)'], [0.25, 'rgba(0,0,0,0)'], [0.85, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,.25)']], 1, 0) +
      rad('hhFlame', [[0, '#ffffff'], [0.18, '#fff4b8'], [0.42, '#ffbe3b'], [0.68, '#f2561d'], [0.88, 'rgba(160,30,10,.55)'], [1, 'rgba(120,20,10,0)']], 0.5, 0.72, 0.6) +
      rad('hhBoom', [[0, '#ffffff'], [0.15, '#fffbe0'], [0.35, '#ffd060'], [0.55, '#ff7a1f'], [0.75, '#b8320f'], [0.9, 'rgba(70,30,20,.7)'], [1, 'rgba(40,30,30,0)']]) +
      rad('hhSmoke', [[0, 'rgba(70,66,62,.85)'], [0.6, 'rgba(90,86,82,.45)'], [1, 'rgba(110,106,102,0)']]) +
      rad('hhSlick', [[0, 'rgba(20,20,26,.75)'], [0.45, 'rgba(60,40,80,.45)'], [0.65, 'rgba(30,90,90,.35)'], [0.82, 'rgba(120,90,30,.25)'], [1, 'rgba(0,0,0,0)']]) +
      '<filter id="hhBlur" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="4"/></filter>' +
      '<filter id="hhBlurS" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="1.6"/></filter>' +
      // Flames lick and flicker: turbulence pushes the flame shape around, the seed changes many times a second.
      '<filter id="hhFire" x="-40%" y="-40%" width="180%" height="180%"><feTurbulence type="fractalNoise" baseFrequency="0.06 0.14" numOctaves="2" seed="2" result="n">' +
        '<animate attributeName="seed" values="1;3;5;2;6;4;7;1" dur="0.7s" repeatCount="indefinite"/></feTurbulence>' +
        '<feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" result="d"/>' +
        '<feGaussianBlur in="d" stdDeviation="0.6"/></filter>' +
      // Billowing fireball and smoke edges.
      '<filter id="hhBillow" x="-50%" y="-50%" width="200%" height="200%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="8" result="n"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="n" scale="26" xChannelSelector="R" yChannelSelector="B" result="d"/><feGaussianBlur in="d" stdDeviation="1.2"/></filter>' +
      '</defs></svg>';
  }
  function hull(W, k, x0) {   // stern on the left, pointed bow on the right; k insets it for decks
    x0 = (x0 || 4) + k;
    var y0 = 16 + k, y1 = 84 - k, xb = W - 4 - k * 1.6, xm = W * 0.66;
    return 'M' + (x0 + 6) + ',' + y0 + ' L' + xm + ',' + y0 + ' Q' + (xb - 8) + ',' + (y0 + 4) + ' ' + xb + ',50 Q' + (xb - 8) + ',' + (y1 - 4) + ' ' + xm + ',' + y1 +
      ' L' + (x0 + 6) + ',' + y1 + ' Q' + x0 + ',' + y1 + ' ' + x0 + ',' + (y1 - 6) + ' L' + x0 + ',' + (y0 + 6) + ' Q' + x0 + ',' + y0 + ' ' + (x0 + 6) + ',' + y0 + ' Z';
  }
  function cleat(x, y) { return '<rect x="' + (x - 4) + '" y="' + (y - 1.5) + '" width="8" height="3" rx="1.5" fill="url(#hhChrome)" stroke="#5b6670" stroke-width=".6"/>'; }
  function boatSvg(type, len) {
    var W = len * 100, sx = type === 'skiff' ? 14 : 4, h = '<svg viewBox="0 0 ' + W + ' 100" preserveAspectRatio="none" aria-hidden="true">';
    // Wake and foam where the hull meets the water.
    h += '<g class="hh-wake"><path d="M' + (sx + 2) + ',30 Q' + (sx - 26) + ',14 ' + (sx - 60) + ',6 M' + (sx + 2) + ',70 Q' + (sx - 26) + ',86 ' + (sx - 60) + ',94" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="4" stroke-linecap="round" filter="url(#hhBlurS)"/>' +
      '<ellipse cx="' + (sx - 6) + '" cy="50" rx="16" ry="22" fill="rgba(255,255,255,.4)" filter="url(#hhBlur)"/></g>';
    h += '<path d="' + hull(W, -2, sx) + '" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="5" filter="url(#hhBlurS)"/>';
    var body = { yacht: 'hhCream', sailboat: 'hhWhite', trawler: 'hhGreen', skiff: 'hhRed' }[type];
    var edge = { yacht: '#7d6a45', sailboat: '#0b2540', trawler: '#0f2a1d', skiff: '#5a1f12' }[type];
    h += '<path d="' + hull(W, 0, sx) + '" fill="url(#' + body + ')" stroke="' + edge + '" stroke-width="2"/>';
    h += '<path d="' + hull(W, 0, sx) + '" fill="url(#hhLong)"/>';
    if (type === 'yacht') {
      h += '<path d="' + hull(W, 5, sx) + '" fill="none" stroke="#c9a15a" stroke-width="2.5"/>' +
        '<path d="' + hull(W, 9, sx) + '" fill="url(#hhDeck)"/>' +
        '<path d="' + hull(W, 11, sx) + '" fill="none" stroke="#9aa6b1" stroke-width="1" stroke-dasharray="3 3"/>' +
        '<rect x="16" y="29" width="72" height="42" rx="6" fill="url(#hhTeak)"/>' +
        '<path d="M16,35 H88 M16,41 H88 M16,47 H88 M16,53 H88 M16,59 H88 M16,65 H88" stroke="rgba(70,40,15,.35)" stroke-width="1.2"/>' +
        '<rect x="30" y="38" width="30" height="24" rx="4" fill="rgba(40,110,150,.55)" stroke="#e8eef3" stroke-width="2"/>' +
        '<rect x="96" y="25" width="192" height="50" rx="16" fill="url(#hhRoof)" stroke="#8d9aa6" stroke-width="1.6"/>' +
        '<rect x="104" y="31" width="176" height="10" rx="5" fill="url(#hhGlass)"/><rect x="104" y="59" width="176" height="10" rx="5" fill="url(#hhGlass)"/>' +
        '<rect x="138" y="37" width="100" height="26" rx="10" fill="url(#hhWhite)" stroke="#7f8f9e" stroke-width="1.4"/>' +
        '<rect x="148" y="43" width="30" height="14" rx="4" fill="url(#hhGlass)"/><circle cx="210" cy="50" r="5" fill="url(#hhChrome)" stroke="#5b6670" stroke-width="1"/>' +
        '<path d="M238,38 Q256,50 238,62" fill="url(#hhGlass)" stroke="#2c5a7c" stroke-width="1.2"/>' +
        '<rect x="300" y="40" width="34" height="20" rx="4" fill="url(#hhDeck)" stroke="#9aa6b1" stroke-width="1"/>' +
        '<path d="M346,50 L372,50" stroke="#8d7a55" stroke-width="2"/><circle cx="362" cy="50" r="3.5" fill="#5b6670"/>' +
        cleat(24, 23) + cleat(24, 77) + cleat(330, 25) + cleat(330, 75);
    } else if (type === 'sailboat') {
      h += '<path d="' + hull(W, 5, sx) + '" fill="none" stroke="#0b2540" stroke-width="3"/>' +
        '<path d="' + hull(W, 9, sx) + '" fill="url(#hhDeck)"/>' +
        '<path d="' + hull(W, 11, sx) + '" fill="none" stroke="#9aa6b1" stroke-width="1" stroke-dasharray="3 3"/>' +
        '<rect x="18" y="33" width="58" height="34" rx="8" fill="url(#hhTeak)"/>' +
        '<path d="M18,40 H76 M18,47 H76 M18,54 H76 M18,61 H76" stroke="rgba(70,40,15,.35)" stroke-width="1.2"/>' +
        '<circle cx="34" cy="50" r="8" fill="none" stroke="url(#hhChrome)" stroke-width="3"/>' +
        '<rect x="84" y="30" width="98" height="40" rx="15" fill="url(#hhRoof)" stroke="#8d9aa6" stroke-width="1.6"/>' +
        '<rect x="96" y="36" width="30" height="7" rx="3" fill="url(#hhGlass)"/><rect x="96" y="57" width="30" height="7" rx="3" fill="url(#hhGlass)"/>' +
        '<rect x="140" y="41" width="22" height="18" rx="3" fill="rgba(40,110,150,.5)" stroke="#e8eef3" stroke-width="1.5"/>' +
        '<path d="M196,50 L28,50" stroke="#4c5761" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="M190,43 Q115,40 40,46 L40,54 Q115,60 190,57 Z" fill="url(#hhWhite)" stroke="#b8c2cc" stroke-width="1.2"/>' +
        '<path d="M170,44 Q140,50 170,56 M130,43 Q100,50 130,57 M90,44 Q66,50 90,56" fill="none" stroke="rgba(120,135,150,.5)" stroke-width="1"/>' +
        '<path d="M196,50 L' + (W - 8) + ',50 M196,50 L120,18 M196,50 L120,82" stroke="#5b6670" stroke-width="1.1"/>' +
        '<circle cx="196" cy="50" r="7.5" fill="url(#hhChrome)" stroke="#4c5761" stroke-width="2.2"/>' + cleat(22, 22) + cleat(22, 78) + cleat(262, 50);
    } else if (type === 'trawler') {
      h += '<path d="' + hull(W, 4, sx) + '" fill="none" stroke="#e7d9a6" stroke-width="2"/>' +
        '<path d="' + hull(W, 8, sx) + '" fill="url(#hhDeck)"/>' +
        '<rect x="16" y="28" width="82" height="44" rx="4" fill="#4f6c7e"/>' +
        '<path d="M16,36 H98 M16,44 H98 M16,52 H98 M16,60 H98 M16,68 H98 M28,28 V72 M44,28 V72 M60,28 V72 M76,28 V72 M92,28 V72" stroke="rgba(230,240,245,.35)" stroke-width="1.4"/>' +
        '<ellipse cx="40" cy="44" rx="10" ry="7" fill="#e07b2a" stroke="#8a4513" stroke-width="1"/><ellipse cx="68" cy="58" rx="9" ry="6" fill="#e9c23a" stroke="#8a6d13" stroke-width="1"/>' +
        '<rect x="106" y="22" width="110" height="56" rx="6" fill="url(#hhRoof)" stroke="#7d8a95" stroke-width="1.6"/>' +
        '<rect x="112" y="27" width="98" height="46" rx="4" fill="none" stroke="#c9d2da" stroke-width="1"/>' +
        '<rect x="190" y="29" width="18" height="42" rx="4" fill="url(#hhGlass)"/>' +
        '<rect x="128" y="40" width="24" height="20" rx="4" fill="#2b2b2b"/><ellipse cx="140" cy="50" rx="8" ry="6" fill="#4d4d4d"/><ellipse cx="138" cy="48" rx="3" ry="2" fill="#777"/>' +
        '<rect x="164" y="44" width="14" height="12" rx="6" fill="url(#hhChrome)"/>' +
        '<path d="M150,20 L136,2 M150,80 L136,98" stroke="#6b5a3f" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M136,2 L100,6 M136,98 L100,94" stroke="rgba(80,70,50,.6)" stroke-width="1"/>' + cleat(250, 24) + cleat(250, 76);
    } else {
      h += '<rect x="0" y="40" width="18" height="20" rx="3" fill="#20252b"/><rect x="2" y="43" width="11" height="14" rx="2" fill="#4a535c"/><rect x="14" y="46" width="6" height="8" fill="#1a1d22"/>' +
        '<path d="' + hull(W, 7, sx) + '" fill="url(#hhDeck)"/>' +
        '<path d="' + hull(W, 9, sx) + '" fill="none" stroke="#9aa6b1" stroke-width="1" stroke-dasharray="3 3"/>' +
        '<rect x="74" y="33" width="46" height="34" rx="6" fill="url(#hhRoof)" stroke="#7d8a95" stroke-width="1.6"/>' +
        '<circle cx="90" cy="50" r="6" fill="#2b2f35" stroke="url(#hhChrome)" stroke-width="2"/>' +
        '<path d="M120,35 Q133,50 120,65" fill="url(#hhGlass)" stroke="#2c5a7c" stroke-width="1.6"/>' +
        '<rect x="30" y="37" width="32" height="26" rx="6" fill="#e3e8ec" stroke="#aab4bd" stroke-width="1.4"/><path d="M30,50 H62" stroke="#c5ccd3" stroke-width="1"/>' +
        cleat(160, 30) + cleat(160, 70);
    }
    h += '<path d="' + hull(W, 0, sx) + '" fill="url(#hhSheen)" opacity=".75"/>';
    return h + '</svg>';
  }
  function boatHtml(type, cells, state) {
    var len = cells.length, sorted = cells.slice().sort(function (a, b) { return a - b; });
    var v = len > 1 && sorted[1] - sorted[0] === 8, r = Math.floor(sorted[0] / 8), c = sorted[0] % 8;
    var down = /sinking|wreck/.test(state || '');
    return '<div class="hh-boat b-' + type + ' ' + (state || 'afloat') + (v ? ' v' : '') + '" style="grid-column:' + (c + 2) + ' / span ' + (v ? 1 : len) +
      ';grid-row:' + (r + 2) + ' / span ' + (v ? len : 1) + ';--len:' + len + '">' +
      (down ? '<span class="hh-slick"></span>' : '') +
      '<div class="hh-boat-rot"><div class="hh-boat-in">' + boatSvg(type, len) + '</div>' +
      (/sinking/.test(state) ? '<span class="hh-bubbles"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="hh-churn"></span>' : '') +
      (down ? '<span class="hh-debris"><i></i><i></i><i></i></span>' : '') + '</div></div>';
  }
  function flameSvg() {
    return '<svg class="hh-flame" viewBox="0 0 40 60" aria-hidden="true"><g filter="url(#hhFire)">' +
      '<path d="M20,58 C6,52 4,38 12,28 C12,36 16,38 17,34 C14,24 18,12 24,4 C24,16 34,22 32,36 C36,32 36,26 35,22 C40,32 38,52 20,58 Z" fill="url(#hhFlame)"/>' +
      '<path d="M20,56 C13,52 12,44 16,38 C17,43 20,44 21,40 C21,34 24,30 26,26 C27,36 31,40 28,48 C27,53 24,55 20,56 Z" fill="#fff6c8" opacity=".85"/></g></svg>';
  }
  function fxHtml(cell, kind, isNewShot) {
    var r = Math.floor(cell / 8), c = cell % 8, plane = '', up = '', k, n;
    function bits(cls, count, spread) {
      var s = '';
      // Sparks, debris and droplets fly mostly upward, then fall back.
      for (var j = 0; j < count; j++) s += '<i class="' + cls + '" style="--a:' + Math.round(-170 + (j + Math.random()) * (160 / count)) + 'deg;--d:' + (0.6 + Math.random() * (spread || 0.7)).toFixed(2) + ';--t:' + (Math.random() * 0.15).toFixed(2) + 's"></i>';
      return s;
    }
    if (kind === 'miss') {
      plane = '<i class="ring"></i>';
      if (isNewShot) { plane += '<i class="spray"></i><i class="rip"></i><i class="rip r2"></i><i class="rip r3"></i>'; up = '<span class="crown"></span><span class="column"></span><span class="column c2"></span><span class="column c3"></span>' + bits('drop', 18, 0.9); }
    } else {
      var out = / out/.test(' ' + kind);
      plane = '<i class="scorch"></i>';
      up = out ? '<em class="smk"></em><em class="smk s2"></em>' : flameSvg() + '<em class="smk"></em><em class="smk s2"></em><em class="smk s3"></em>';
      if (isNewShot) {
        plane += '<i class="shock"></i><i class="spray"></i>';
        up += '<i class="flash"></i><span class="fball"><svg viewBox="0 0 100 100" aria-hidden="true"><g filter="url(#hhBillow)"><circle cx="50" cy="50" r="40" fill="url(#hhBoom)"/>' +
          '<circle cx="34" cy="40" r="22" fill="url(#hhBoom)"/><circle cx="66" cy="44" r="20" fill="url(#hhBoom)"/></g></svg></span>' +
          '<span class="plume"><svg viewBox="0 0 100 100" aria-hidden="true"><g filter="url(#hhBillow)"><circle cx="50" cy="55" r="34" fill="url(#hhSmoke)"/><circle cx="36" cy="40" r="24" fill="url(#hhSmoke)"/><circle cx="62" cy="38" r="26" fill="url(#hhSmoke)"/></g></svg></span>' +
          bits('spk', 12, 0.9) + bits('deb', 6, 0.6);
      }
    }
    return '<div class="hh-fx fx-' + kind + (isNewShot ? ' new' : '') + '" style="grid-column:' + (c + 2) + ';grid-row:' + (r + 2) + '">' +
      '<span class="hh-plane">' + plane + '</span><span class="hh-up">' + up + '</span></div>';
  }
  function isNew(shot) { return !!shot && shot.id === flashId && !animated[shot.id]; }
  // Squares of a boat sunk on the other harbor: from the server, or worked out from the hits (older games).
  function sunkCells(shot, hitSet) {
    if (shot.sunk_cells && shot.sunk_cells.length) return shot.sunk_cells;
    var len = { yacht: 4, sailboat: 3, trawler: 3, skiff: 2 }[shot.sunk_type] || 2, c = shot.cell;
    for (var pass = 0; pass < 2; pass++) {
      var step = pass ? 8 : 1;
      for (var start = c - (len - 1) * step; start <= c; start += step) {
        var run = [], ok = true;
        for (var k = 0; k < len; k++) {
          var x = start + k * step;
          if (x < 0 || x > 63 || (!pass && Math.floor(x / 8) !== Math.floor(c / 8)) || !hitSet[x]) { ok = false; break; }
          run.push(x);
        }
        if (ok) return run;
      }
    }
    return [c];
  }

  // Across / down: two raised 3D buttons with double-ended arrows; only one is pressed at a time.
  function dirToggle(attr, vertical) {
    var arrow = '<svg viewBox="0 0 40 16" aria-hidden="true"><path d="M2,8 L10,1 L10,5 L30,5 L30,1 L38,8 L30,15 L30,11 L10,11 L10,15 Z"/></svg>';
    return '<span class="hh-dir" role="radiogroup" aria-label="Boat direction">' +
      '<button type="button" class="hh-dirbtn' + (vertical ? '' : ' on') + '" ' + attr + '="dir" data-v="0" role="radio" aria-checked="' + !vertical + '" title="Going across">' + arrow + '</button>' +
      '<button type="button" class="hh-dirbtn v' + (vertical ? ' on' : '') + '" ' + attr + '="dir" data-v="1" role="radio" aria-checked="' + vertical + '" title="Going down">' + arrow + '</button></span>';
  }
  function fleetButtons(attr, place, pic) {
    var rows = FLEET.map(function (f) {
      var sel = place.sel === f.type;
      return '<div class="hh-boatrow"><button type="button" class="hh-boatbtn' + (sel ? ' sel' : '') + (place.ships[f.type] ? ' placed' : '') + '" ' + attr + '="pick" data-type="' + f.type + '">' +
        '<span class="hh-boatpic" style="--len:' + f.len + '">' + pic(f.type, f.len) + '</span>' + f.name + ' <span class="note">' + f.len + '</span>' +
        (place.ships[f.type] ? ' &#10003;' : '') + '</button>' + (sel ? dirToggle(attr, place.vertical) : '') + '</div>';
    }).join('');
    return rows + (place.sel ? '' : '<div class="hh-boatrow hh-dirrow"><span class="note">Direction</span>' + dirToggle(attr, place.vertical) + '</div>');
  }

  function gridHtml(opts) {
    var h = '<div class="hh-grid' + (opts.target ? ' target' : '') + (opts.active ? ' active' : '') + (opts.extra || '') + '" role="grid" aria-label="' + esc(opts.label) + '">';
    // Every square has a fixed spot, so the boats and effects laid over them don't push them around.
    h += '<span class="hh-corner" style="grid-area:1/1"></span>';
    for (var c = 0; c < 8; c++) h += '<span class="hh-colh" style="grid-area:1/' + (c + 2) + '">' + (c + 1) + '</span>';
    for (var r = 0; r < 8; r++) {
      h += '<span class="hh-rowh" style="grid-area:' + (r + 2) + '/1">' + ROWS[r] + '</span>';
      for (c = 0; c < 8; c++) {
        var i = r * 8 + c, cell = opts.cell(i);
        h += '<button type="button" class="hh-cell ' + (cell.cls || '') + '" style="grid-area:' + (r + 2) + '/' + (c + 2) + '" data-cell="' + i + '"' + (cell.disabled ? ' disabled' : '') +
          ' aria-label="' + label(i) + (cell.say ? ', ' + cell.say : '') + '"></button>';
      }
    }
    return h + (opts.layers || '') + '</div>';
  }

  function drawPlacing() {
    var ships = FLEET.map(function (f) { return place.ships[f.type] ? { type: f.type, cells: place.ships[f.type] } : null; }).filter(Boolean);
    var where = {}, done = ships.length === 4;
    ships.forEach(function (s) { s.cells.forEach(function (x) { where[x] = s.type; }); });
    var layers = ships.map(function (s) { return boatHtml(s.type, s.cells, 'afloat' + (place.sel === s.type ? ' sel' : '')); }).join('');
    var html = '<p class="hh-intro">Hide your boats from <strong>' + esc(them()) + '</strong>. Pick a boat, then tap the square where it should start.</p>' +
      '<div class="hh-place">' +
        '<div class="hh-fleet">' + fleetButtons('data-hh', place, boatSvg) +
        '<div class="hh-tools"><button type="button" class="btn-sm" data-hh="shuffle">Shuffle</button><button type="button" class="btn-sm" data-hh="clear">Clear</button></div></div>' +
        gridHtml({ label: 'Your harbor', active: true, layers: layers, cell: function (i) { return { say: where[i] ? NAMES[where[i]] : 'water' }; } }) +
      '</div><p class="hh-msg" id="hhMsg"></p>' +
      '<div class="hh-actions"><button type="button" class="btn btn-gold" data-hh="ready"' + (done ? '' : ' disabled') + '>Ready &mdash; hide my boats</button>' +
      '<button type="button" class="btn-sm" data-hh="leave">Call off the game</button></div>';
    body(html);
  }

  function boardsHtml(playing) {
    var mineShots = shots.filter(function (s) { return s.player === seat; });
    var theirShots = shots.filter(function (s) { return s.player !== seat; });
    var mine = {}, theirs = {}, myHits = {};
    mineShots.forEach(function (s) { mine[s.cell] = s; if (s.result !== 'miss') myHits[s.cell] = 1; });
    theirShots.forEach(function (s) { theirs[s.cell] = s; });
    var myTurn = playing && match.status === 'playing' && match.turn === seat;
    var foundTypes = mineShots.filter(function (s) { return s.result === 'sunk'; }).map(function (s) { return s.sunk_type; });
    var lostTypes = theirShots.filter(function (s) { return s.result === 'sunk'; }).map(function (s) { return s.sunk_type; });
    function fleetLine(list) {
      return '<div class="hh-fleetline">' + FLEET.map(function (f) { var gone = list.indexOf(f.type) >= 0; return '<span class="' + (gone ? 'gone' : '') + '">' + f.name + '</span>'; }).join('') + '</div>';
    }
    // Their harbor: boats you've sunk appear (sinking, then a wreck); hits burn, misses ripple.
    var tLayers = '', wreckCells = {};
    mineShots.filter(function (s) { return s.result === 'sunk'; }).forEach(function (s) {
      var cells = sunkCells(s, myHits);
      cells.forEach(function (x) { wreckCells[x] = 1; });
      tLayers += boatHtml(s.sunk_type, cells, isNew(s) ? 'sinking' : 'wreck');
    });
    mineShots.forEach(function (s) { tLayers += fxHtml(s.cell, s.result === 'miss' ? 'miss' : (wreckCells[s.cell] && !isNew(s) ? 'hit out' : 'hit'), isNew(s)); });
    var tiltIn = !tilted[match.id]; tilted[match.id] = 1;
    var target = gridHtml({ label: short(them()) + '’s harbor', target: true, active: myTurn, extra: ' tilt' + (tiltIn ? ' tilt-in' : ''), layers: tLayers, cell: function (i) {
      var s = mine[i];
      if (s) return { cls: 'called', disabled: true, say: s.result };
      return { disabled: !myTurn, say: 'not called yet' };
    } });
    // Your harbor: your boats, and their shots on them.
    var oLayers = '', where = {};
    (myShips || []).forEach(function (b) {
      b.cells.forEach(function (x) { where[x] = b.type; });
      var sunkShot = theirShots.filter(function (s) { return s.result === 'sunk' && s.sunk_type === b.type; })[0];
      oLayers += boatHtml(b.type, b.cells, sunkShot ? (isNew(sunkShot) ? 'sinking' : 'wreck') : 'afloat');
    });
    theirShots.forEach(function (s) {
      var gone = lostTypes.indexOf(where[s.cell]) >= 0;
      oLayers += fxHtml(s.cell, s.result === 'miss' ? 'miss' : (gone && !isNew(s) ? 'hit out' : 'hit'), isNew(s));
    });
    var own = gridHtml({ label: 'Your harbor', layers: oLayers, cell: function (i) {
      var s = theirs[i];
      return { disabled: true, say: (where[i] ? NAMES[where[i]] : 'water') + (s ? ', ' + s.result : '') };
    } });
    return '<div class="hh-boards">' +
      '<div class="hh-board theirs"><h3>' + esc(short(them())) + '&rsquo;s harbor</h3><div class="hh-tilt">' + target + '</div>' + '<div class="note">Boats you&rsquo;ve sunk:</div>' + fleetLine(foundTypes) + '</div>' +
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
      // The big finish: the captain cheered at the helm, or bobbing in a ring buoy. Once per game, after the last boat goes down.
      if (!ended[m.id] && window.HarborEndings) {
        ended[m.id] = 1;
        var them2 = short(them()), lastShot = shots[shots.length - 1];
        setTimeout(function () {
          HarborEndings.show(won
            ? { won: true, title: 'Victory, Captain!', text: 'You found every one of ' + them2 + '\u2019s boats. The crew is cheering!', button: 'See the boards' }
            : { won: false, title: 'Man overboard!', text: them2 + ' found your whole fleet. Dry off and challenge them again!', button: 'See the boards' });
        }, lastShot && isNew(lastShot) ? 2600 : 400);
      }
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
    if (act === 'dir') { place.vertical = b.getAttribute('data-v') === '1'; return drawPlacing(); }
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
      SND.place();
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
