/* Harbor Hunt against the computer, run as a Game event (harbor-solo.html?id=<event>).
   One player hides four boats, the computer hides its own, and they take turns calling
   squares. Everything happens in the browser; nothing is saved except each player's own
   win/loss record on this device. The artwork and sounds are shared with the two-player
   game in Marina Chat (harbor-hunt.js, harbor-sounds.js).
   Computer captains:
     Deckhand - mostly guesses
     Skipper  - searches in a checkerboard pattern and closes in on every hit
     Admiral  - works out where boats could still fit and aims where they're most likely */
(function () {
  var A = window.HarborHunt && window.HarborHunt.art;
  var SND = window.HarborSounds || { boom: noop, splash: noop, sink: noop, place: noop, ambientStart: noop, ambientStop: noop, isOn: function () { return false; }, toggle: noop, unlock: noop };
  function noop() {}
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var FLEET = A ? A.FLEET : [], NAMES = A ? A.NAMES : {}, LEN = { yacht: 4, sailboat: 3, trawler: 3, skiff: 2 };
  var LEVELS = [
    { id: 'easy', name: 'Deckhand', note: 'Mostly guesses. A relaxed game.' },
    { id: 'normal', name: 'Skipper', note: 'Searches carefully and closes in on every hit.' },
    { id: 'hard', name: 'Admiral', note: 'Works out where your boats could be. Bring your A game.' }
  ];
  var RECORD_KEY = 'harborHuntSoloRecord', LEVEL_KEY = 'harborHuntSoloLevel';
  var level = 'normal', phase = 'setup', place = { ships: {}, sel: 'yacht', vertical: false };
  var mine = [], cpu = [], myShots = [], cpuShots = [], nextId = 1, flashId = 0, drawnFlash = 0, cpuBusy = false, tilted = false, ev = null;

  try { level = localStorage.getItem(LEVEL_KEY) || 'normal'; } catch (e) {}

  document.addEventListener('DOMContentLoaded', function () {
    if (!A) { $('hsStatus').textContent = 'The game couldn’t load. Please refresh the page.'; return; }
    var id = new URLSearchParams(location.search).get('id');
    MemberAuth.getClient().then(function (sb) {
      return sb.auth.getSession().then(function (r) {
        if (!r.data.session) {
          $('hsStatus').innerHTML = 'Harbor Hunt is for slip owners, cruisers and staff. Please log in to play. <button type="button" class="btn btn-gold" id="hsLogin">Log In</button>';
          $('hsLogin').addEventListener('click', function () { MemberAuth.openLogin(); });
          return;
        }
        if (!id) { $('hsStatus').textContent = 'This game wasn’t found.'; return; }
        return Promise.all([sb.from('events').select('*').eq('id', id).maybeSingle(), sb.rpc('is_admin'),
          sb.from('members').select('member_class').eq('user_id', r.data.session.user.id).eq('active', true).limit(1)]).then(function (res) {
          ev = res[0].data;
          var admin = !!res[1].data, cls = (res[2].data && res[2].data[0] && res[2].data[0].member_class) || 'certificated';
          if (!ev || ev.event_type !== 'game' || ev.game_kind !== 'harbor_hunt') { $('hsStatus').textContent = 'This game is no longer available.'; return; }
          document.title = ev.title + ' | New Bern Grand Marina';
          $('hsTitle').textContent = ev.title;
          if (ev.summary) $('hsSub').textContent = ev.summary;
          var now = Date.now();
          if (!admin) {
            if (!ev.active) { $('hsStatus').textContent = 'This game isn’t open right now.'; return; }
            if (ev.starts_at && new Date(ev.starts_at).getTime() > now) { $('hsStatus').textContent = 'This game opens ' + new Date(ev.starts_at).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '.'; return; }
            if (ev.ends_at && new Date(ev.ends_at).getTime() <= now) { $('hsStatus').textContent = 'This game has finished. Thanks for playing!'; return; }
            if ((ev.game_players || []).indexOf(cls) < 0) { $('hsStatus').textContent = 'This game is for ' + (ev.game_players || []).map(function (c) { return { certificated: 'slip owners', ltc: 'long-term cruisers', stc: 'transients', employee: 'staff' }[c] || c; }).join(', ') + '.'; return; }
          }
          start();
          if (MemberAuth.track) MemberAuth.track('view_event', { type: 'event', id: ev.id, label: ev.title, details: { type: 'game', game: 'harbor_hunt' } });
        });
      });
    }).catch(function () { $('hsStatus').textContent = 'Something went wrong loading the game. Please refresh the page.'; });
  });

  window.HarborSolo = { preview: function () { start(); } };   // for checking the layout without logging in
  function start() {
    $('hsStatus').hidden = true;
    $('hsGame').hidden = false;
    document.body.insertAdjacentHTML('beforeend', A.svgDefs());
    function soundLabel() { $('hsSound').innerHTML = SND.isOn() ? '&#128266; Sound on' : '&#128263; Sound off'; }
    soundLabel();
    $('hsSound').addEventListener('click', function () { SND.toggle(); soundLabel(); if (SND.isOn() && phase === 'play') SND.ambientStart(); });
    $('hsGame').addEventListener('pointerdown', function () { SND.unlock(); if (phase === 'play') SND.ambientStart(); });
    $('hsBody').addEventListener('click', onClick);
    window.addEventListener('pagehide', function () { SND.ambientStop(); });
    drawSetup();
  }

  /* ---------- Hiding your boats ---------- */
  function cellsFor(len, startCell, vertical) {
    var r = Math.floor(startCell / 8), c = startCell % 8, out = [];
    for (var k = 0; k < len; k++) {
      var rr = vertical ? r + k : r, cc = vertical ? c : c + k;
      if (rr > 7 || cc > 7) return null;
      out.push(rr * 8 + cc);
    }
    return out;
  }
  function randomFleet() {
    for (var tries = 0; tries < 500; tries++) {
      var ships = [], used = {}, ok = FLEET.every(function (f) {
        for (var n = 0; n < 200; n++) {
          var cells = cellsFor(f.len, Math.floor(Math.random() * 64), Math.random() < 0.5);
          if (cells && !cells.some(function (x) { return used[x]; })) { cells.forEach(function (x) { used[x] = 1; }); ships.push({ type: f.type, cells: cells }); return true; }
        }
        return false;
      });
      if (ok) return ships;
    }
    return [];
  }
  function overlaps(cells, except) {
    return Object.keys(place.ships).some(function (t) { return t !== except && place.ships[t].some(function (x) { return cells.indexOf(x) >= 0; }); });
  }
  function record() { try { return JSON.parse(localStorage.getItem(RECORD_KEY) || '{}'); } catch (e) { return {}; } }

  function drawSetup() {
    phase = 'setup';
    SND.ambientStop();
    var ships = FLEET.map(function (f) { return place.ships[f.type] ? { type: f.type, cells: place.ships[f.type] } : null; }).filter(Boolean);
    var where = {}, done = ships.length === 4, rec = record();
    ships.forEach(function (s) { s.cells.forEach(function (x) { where[x] = s.type; }); });
    var layers = ships.map(function (s) { return A.boatHtml(s.type, s.cells, 'afloat' + (place.sel === s.type ? ' sel' : '')); }).join('');
    $('hsBody').innerHTML =
      '<h3>Choose your opponent</h3><div class="hs-levels">' + LEVELS.map(function (l) {
        var r = rec[l.id] || { w: 0, l: 0 };
        return '<button type="button" class="hs-level' + (level === l.id ? ' sel' : '') + '" data-hs="level" data-level="' + l.id + '"><strong>' + l.name + '</strong><span>' + l.note + '</span>' +
          (r.w || r.l ? '<em>Your record: ' + r.w + ' won, ' + r.l + ' lost</em>' : '') + '</button>';
      }).join('') + '</div>' +
      '<h3>Hide your boats</h3><p class="hh-intro">Pick a boat, then tap the square where it should start. Or press <strong>Shuffle</strong>.</p>' +
      '<div class="hh-place"><div class="hh-fleet">' + FLEET.map(function (f) {
        return '<button type="button" class="hh-boatbtn' + (place.sel === f.type ? ' sel' : '') + (place.ships[f.type] ? ' placed' : '') + '" data-hs="pick" data-type="' + f.type + '">' +
          '<span class="hh-boatpic" style="--len:' + f.len + '">' + A.boatSvg(f.type, f.len) + '</span>' + f.name + ' <span class="note">' + f.len + '</span>' + (place.ships[f.type] ? ' &#10003;' : '') + '</button>';
      }).join('') +
      '<div class="hh-tools"><button type="button" class="btn-sm" data-hs="rotate">' + (place.vertical ? '&#8597; Going down' : '&#8596; Going across') + '</button>' +
      '<button type="button" class="btn-sm" data-hs="shuffle">Shuffle</button><button type="button" class="btn-sm" data-hs="clear">Clear</button></div></div>' +
      A.gridHtml({ label: 'Your harbor', active: true, layers: layers, cell: function (i) { return { say: where[i] ? NAMES[where[i]] : 'water' }; } }) + '</div>' +
      '<p class="hh-msg" id="hhMsg"></p><div class="hh-actions"><button type="button" class="btn btn-gold" data-hs="go"' + (done ? '' : ' disabled') + '>Start the hunt</button></div>';
  }
  function msg(t, bad) { var el = $('hhMsg'); if (el) { el.textContent = t || ''; el.className = 'hh-msg' + (bad ? ' bad' : ''); } }

  function onClick(e) {
    var b = e.target.closest('[data-hs], [data-cell]');
    if (!b || b.disabled) return;
    var act = b.getAttribute('data-hs');
    if (!act && b.hasAttribute('data-cell')) return cellClick(+b.getAttribute('data-cell'));
    if (act === 'level') { level = b.getAttribute('data-level'); try { localStorage.setItem(LEVEL_KEY, level); } catch (x) {} return drawSetup(); }
    if (act === 'pick') { place.sel = b.getAttribute('data-type'); return drawSetup(); }
    if (act === 'rotate') { place.vertical = !place.vertical; return drawSetup(); }
    if (act === 'shuffle') { place.ships = {}; randomFleet().forEach(function (s) { place.ships[s.type] = s.cells; }); place.sel = null; SND.place(); return drawSetup(); }
    if (act === 'clear') { place.ships = {}; place.sel = 'yacht'; return drawSetup(); }
    if (act === 'go') return begin();
    if (act === 'again') { place.sel = null; return drawSetup(); }
    if (act === 'giveup') { if (confirm('Give up this game?')) finish(false, true); return; }
  }
  function cellClick(i) {
    if (phase === 'setup') {
      var hit = Object.keys(place.ships).filter(function (t) { return place.ships[t].indexOf(i) >= 0; })[0];
      if (hit && hit !== place.sel) { place.sel = hit; return drawSetup(); }
      if (!place.sel) return msg('Pick a boat first.', true);
      var f = FLEET.filter(function (x) { return x.type === place.sel; })[0], cells = cellsFor(f.len, i, place.vertical);
      if (!cells) return msg('The ' + f.name + ' doesn’t fit there. Try another square or turn it.', true);
      if (overlaps(cells, f.type)) return msg('Boats can’t overlap.', true);
      place.ships[f.type] = cells; SND.place();
      var next = FLEET.filter(function (x) { return !place.ships[x.type]; })[0];
      place.sel = next ? next.type : null;
      return drawSetup();
    }
    if (phase === 'play' && !cpuBusy && !myShots.some(function (s) { return s.cell === i; })) fire(i);
  }

  /* ---------- Playing ---------- */
  function begin() {
    mine = FLEET.map(function (f) { return { type: f.type, cells: place.ships[f.type].slice() }; });
    cpu = randomFleet(); myShots = []; cpuShots = []; flashId = 0; drawnFlash = 0; tilted = false; cpuBusy = false;
    phase = 'play';
    SND.ambientStart();
    drawPlay('Your turn first. Tap a square on the Captain’s harbor.');
  }
  function resolve(ships, shots, cell) {
    var res = 'miss', sunk = null, sunkCells = null;
    ships.forEach(function (s) {
      if (s.cells.indexOf(cell) < 0) return;
      res = 'hit';
      var hits = shots.filter(function (x) { return x.result !== 'miss'; }).map(function (x) { return x.cell; }).concat([cell]);
      if (s.cells.every(function (x) { return hits.indexOf(x) >= 0; })) { res = 'sunk'; sunk = s.type; sunkCells = s.cells.slice(); }
    });
    return { id: nextId++, cell: cell, result: res, sunk_type: sunk, sunk_cells: sunkCells };
  }
  function allSunk(shots) { return shots.filter(function (s) { return s.result !== 'miss'; }).length === 12; }
  function effects(shot) {
    var pan = ((shot.cell % 8) - 3.5) / 3.5 * 0.75;
    if (shot.result === 'miss') SND.splash(pan);
    else { SND.boom(pan); if (shot.result === 'sunk') setTimeout(function () { SND.sink(pan); }, 500); }
  }
  function said(shot, who) {
    return who + ' called ' + A.label(shot.cell) + ': ' + (shot.result === 'miss' ? 'miss.' : shot.result === 'hit' ? 'hit!' : 'sunk the ' + NAMES[shot.sunk_type] + '!');
  }
  function fire(cell) {
    var s = resolve(cpu, myShots, cell);
    myShots.push(s); flashId = s.id; effects(s);
    if (allSunk(myShots)) { drawPlay(said(s, 'You')); return setTimeout(function () { finish(true); }, 1800); }
    cpuBusy = true;
    drawPlay(said(s, 'You'));
    setTimeout(cpuTurn, s.result === 'sunk' ? 2300 : 1300);
  }
  function cpuTurn() {
    if (phase !== 'play') return;
    var cell = choose();
    var s = resolve(mine, cpuShots, cell);
    cpuShots.push(s); flashId = s.id; effects(s);
    cpuBusy = false;
    if (allSunk(cpuShots)) { drawPlay(said(s, 'The Captain')); return setTimeout(function () { finish(false); }, 2200); }
    drawPlay(said(s, 'The Captain'));
  }

  /* ---------- The computer's aim ---------- */
  function choose() {
    var tried = {}, open = [];
    cpuShots.forEach(function (s) { tried[s.cell] = s; });
    for (var i = 0; i < 64; i++) if (!tried[i]) open.push(i);
    var sunkSet = {};
    cpuShots.forEach(function (s) { if (s.result === 'sunk') s.sunk_cells.forEach(function (x) { sunkSet[x] = 1; }); });
    var live = cpuShots.filter(function (s) { return s.result !== 'miss' && !sunkSet[s.cell]; }).map(function (s) { return s.cell; });
    var left = FLEET.filter(function (f) { return !cpuShots.some(function (s) { return s.sunk_type === f.type; }); });
    function rnd(list) { return list[Math.floor(Math.random() * list.length)]; }
    function neighbours(c) {
      var r = Math.floor(c / 8), k = c % 8, out = [];
      if (r > 0) out.push(c - 8); if (r < 7) out.push(c + 8); if (k > 0) out.push(c - 1); if (k < 7) out.push(c + 1);
      return out.filter(function (x) { return !tried[x]; });
    }
    if (level === 'easy') {
      if (live.length && Math.random() < 0.3) { var nb = [].concat.apply([], live.map(neighbours)); if (nb.length) return rnd(nb); }
      return rnd(open);
    }
    if (level === 'normal') {
      if (live.length) {
        // Two or more hits in a line: keep going along that line first.
        if (live.length > 1) {
          var sorted = live.slice().sort(function (a, b) { return a - b; }), sameRow = sorted.every(function (x) { return Math.floor(x / 8) === Math.floor(sorted[0] / 8); });
          var sameCol = sorted.every(function (x) { return x % 8 === sorted[0] % 8; }), ends = [];
          if (sameRow) { ends = [sorted[0] - 1, sorted[sorted.length - 1] + 1].filter(function (x) { return x >= 0 && Math.floor(x / 8) === Math.floor(sorted[0] / 8); }); }
          if (sameCol) { ends = [sorted[0] - 8, sorted[sorted.length - 1] + 8].filter(function (x) { return x >= 0 && x < 64; }); }
          ends = ends.filter(function (x) { return !tried[x]; });
          if (ends.length) return rnd(ends);
        }
        var near = [].concat.apply([], live.map(neighbours));
        if (near.length) return rnd(near);
      }
      var minLen = Math.min.apply(null, left.map(function (f) { return f.len; }));
      var checker = open.filter(function (c) { return ((Math.floor(c / 8) + c % 8) % minLen) === 0; });
      return rnd(checker.length ? checker : open);
    }
    // Admiral: count every way the remaining boats could still fit; aim where the most overlap.
    var score = new Array(64).fill(0);
    left.forEach(function (f) {
      for (var start = 0; start < 64; start++) for (var v = 0; v < 2; v++) {
        var cells = cellsFor(f.len, start, !!v);
        if (!cells) continue;
        var blocked = cells.some(function (x) { return (tried[x] && tried[x].result === 'miss') || sunkSet[x]; });
        if (blocked) continue;
        var covers = cells.filter(function (x) { return live.indexOf(x) >= 0; }).length;
        if (live.length && !covers) continue;
        var w = live.length ? 1 + covers * covers * 25 : 1;
        cells.forEach(function (x) { if (!tried[x]) score[x] += w; });
      }
    });
    var best = -1, picks = [];
    open.forEach(function (c) { if (score[c] > best) { best = score[c]; picks = [c]; } else if (score[c] === best) picks.push(c); });
    return best > 0 ? rnd(picks) : rnd(open);
  }

  /* ---------- Drawing the boards ---------- */
  function fleetLine(list) {
    return '<div class="hh-fleetline">' + FLEET.map(function (f) { return '<span class="' + (list.indexOf(f.type) >= 0 ? 'gone' : '') + '">' + f.name + '</span>'; }).join('') + '</div>';
  }
  function drawPlay(line, ending) {
    var isNew = function (s) { return s && s.id === flashId && flashId !== drawnFlash; };
    var myHits = {};
    myShots.forEach(function (s) { if (s.result !== 'miss') myHits[s.cell] = 1; });
    var found = myShots.filter(function (s) { return s.result === 'sunk'; }).map(function (s) { return s.sunk_type; });
    var lost = cpuShots.filter(function (s) { return s.result === 'sunk'; }).map(function (s) { return s.sunk_type; });
    // The Captain's harbor (tilted): boats you've sunk, and at the end, the ones you missed.
    var tl = '', wreck = {};
    myShots.filter(function (s) { return s.result === 'sunk'; }).forEach(function (s) {
      s.sunk_cells.forEach(function (x) { wreck[x] = 1; });
      tl += A.boatHtml(s.sunk_type, s.sunk_cells, isNew(s) ? 'sinking' : 'wreck');
    });
    if (ending) cpu.forEach(function (b) { if (found.indexOf(b.type) < 0) tl += A.boatHtml(b.type, b.cells, 'afloat reveal'); });
    myShots.forEach(function (s) { tl += A.fxHtml(s.cell, s.result === 'miss' ? 'miss' : (wreck[s.cell] && !isNew(s) ? 'hit out' : 'hit'), isNew(s)); });
    var shotAt = {};
    myShots.forEach(function (s) { shotAt[s.cell] = s; });
    var myTurn = phase === 'play' && !cpuBusy;
    var tiltIn = !tilted; tilted = true;
    var target = A.gridHtml({ label: 'The Captain’s harbor', target: true, active: myTurn, extra: ' tilt' + (tiltIn ? ' tilt-in' : ''), layers: tl, cell: function (i) {
      return shotAt[i] ? { cls: 'called', disabled: true, say: shotAt[i].result } : { disabled: !myTurn, say: 'not called yet' };
    } });
    // Your harbor.
    var ol = '', where = {};
    mine.forEach(function (b) {
      b.cells.forEach(function (x) { where[x] = b.type; });
      var sk = cpuShots.filter(function (s) { return s.result === 'sunk' && s.sunk_type === b.type; })[0];
      ol += A.boatHtml(b.type, b.cells, sk ? (isNew(sk) ? 'sinking' : 'wreck') : 'afloat');
    });
    cpuShots.forEach(function (s) { ol += A.fxHtml(s.cell, s.result === 'miss' ? 'miss' : (lost.indexOf(where[s.cell]) >= 0 && !isNew(s) ? 'hit out' : 'hit'), isNew(s)); });
    var own = A.gridHtml({ label: 'Your harbor', layers: ol, cell: function (i) { return { disabled: true, say: where[i] ? NAMES[where[i]] : 'water' }; } });
    var lvl = LEVELS.filter(function (l) { return l.id === level; })[0];
    var status = ending || '<div class="hh-turn' + (myTurn ? ' mine' : '') + '">' + (myTurn ? 'Your turn &mdash; tap a square on the Captain&rsquo;s harbor' : '<span class="hs-think"></span> The ' + esc(lvl.name) + ' is taking aim&hellip;') + '</div>';
    $('hsBody').innerHTML = status + (line ? '<p class="hh-last">' + esc(line) + '</p>' : '') +
      '<div class="hh-boards"><div class="hh-board theirs"><h3>The ' + esc(lvl.name) + '&rsquo;s harbor</h3><div class="hh-tilt">' + target + '</div><div class="note">Boats you&rsquo;ve sunk:</div>' + fleetLine(found) + '</div>' +
      '<div class="hh-board mine"><h3>Your harbor</h3>' + own + '<div class="note">Your boats sunk:</div>' + fleetLine(lost) + '</div></div>' +
      '<div class="hh-actions">' + (ending ? '<button type="button" class="btn btn-gold" data-hs="again">Play again</button>' : '<button type="button" class="btn-sm" data-hs="giveup">Give up</button>') + '</div>';
    drawnFlash = flashId;
  }
  function finish(won, gaveUp) {
    phase = 'over';
    SND.ambientStop();
    var rec = record(), r = rec[level] || { w: 0, l: 0 };
    if (won) r.w++; else r.l++;
    rec[level] = r;
    try { localStorage.setItem(RECORD_KEY, JSON.stringify(rec)); } catch (e) {}
    var hits = myShots.filter(function (s) { return s.result !== 'miss'; }).length;
    var acc = myShots.length ? Math.round(hits * 100 / myShots.length) : 0;
    var lvl = LEVELS.filter(function (l) { return l.id === level; })[0];
    var head = '<div class="hh-result ' + (won ? 'won' : 'lost') + '">' + (won ? '&#127942; You won! Every boat found in ' + myShots.length + ' shots.' : gaveUp ? 'You gave up. The ' + esc(lvl.name) + '&rsquo;s boats are shown.' : 'The ' + esc(lvl.name) + ' found all your boats.') + '</div>' +
      '<p class="hh-last">Your aim: ' + hits + ' hits from ' + myShots.length + ' shots (' + acc + '%). Record against the ' + esc(lvl.name) + ': ' + r.w + ' won, ' + r.l + ' lost.</p>';
    drawPlay('', head);
  }
})();
