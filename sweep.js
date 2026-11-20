/* Crab Pot Sweep (prototype): minesweeper on the marina slip map, played entirely in the page.
   Some slips hide a crab pot. Open a slip to see how many of its neighbors hide one; mark pots
   with a buoy. Open every safe slip to win. Neighbors are worked out from where the slips sit:
   slips touching in a row, slips across the dock, and (optionally) the nearest slips across the fairway. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };

  // Slips have fewer neighbors than squares on a grid, so these run a little higher than classic minesweeper.
  var LEVELS = { easy: 0.15, normal: 0.20, hard: 0.25 };
  var NEAR = 20;          // outline gap (map units) for touching / across-the-dock neighbors
  var FAIRWAY = 130;     // furthest gap that can still count as "across the fairway"
  var FAIRWAY_SLACK = 30; // other docks' slips must be nearly as close as the nearest one...
  var SIDEWAYS = 30;      // ...and sit no more than about one slip width to the side of it

  var svg, slips = [], byId = {}, nbNear = {}, nbFair = {};
  var game, zoom = 1, buoyMode = false, timer = null;

  /* ---------- Map & geometry ---------- */
  var ver = (/[?&]v=([^&]+)/.exec((document.querySelector('script[src^="sweep.js"]') || {}).src || '') || [])[1];
  fetch('images/marina-slip-map.svg' + (ver ? '?v=' + ver : '')).then(function (r) { return r.text(); }).then(function (txt) {
    var box = $('swMap');
    box.innerHTML = '<div class="game-map-stage">' + txt + '</div>';
    svg = box.querySelector('svg');
    svg.removeAttribute('width'); svg.removeAttribute('height');
    readSlips();
    buildNeighbors();
    if (/[?&]debug\b/.test(location.search)) window.sweepDebug = { near: nbNear, fair: nbFair, game: function () { return game; } };
    bindMap();
    cropToDocks();
    // Start zoomed in far enough that slips are about a fingertip wide (players scroll the map to move around).
    setZoom(Math.round(Math.max(1, 1300 / ($('swMap').clientWidth || 1300)) * 2) / 2);
    newGame();
  }).catch(function () { $('swMap').innerHTML = '<p class="note">The marina map could not be loaded. Please refresh the page.</p>'; });

  function outline(g) {
    var el = g.querySelector('polygon, rect');
    if (!el) return null;
    if (el.tagName === 'polygon') {
      return el.getAttribute('points').trim().split(/\s+/).map(function (p) { return p.split(',').map(Number); });
    }
    var x = +el.getAttribute('x'), y = +el.getAttribute('y'), w = +el.getAttribute('width'), h = +el.getAttribute('height');
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }

  function readSlips() {
    svg.querySelectorAll('g.slip').forEach(function (g) {
      var pts = outline(g);
      if (!pts) return;
      var id = g.getAttribute('data-dock') + g.getAttribute('data-num');
      var cx = 0, cy = 0;
      pts.forEach(function (p) { cx += p[0]; cy += p[1]; });
      var s = { id: id, dock: g.getAttribute('data-dock'), g: g, pts: pts, cx: cx / pts.length, cy: cy / pts.length };
      slips.push(s); byId[id] = s;
      // A layer on top of the slip for numbers, buoys and pots.
      var o = document.createElementNS(NS, 'g');
      o.setAttribute('class', 'sw-mark');
      o.setAttribute('pointer-events', 'none');
      g.appendChild(o);
      s.mark = o;
    });
  }

  // Show just the docks (plus a little water) instead of the whole map with its land and legend.
  function cropToDocks() {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    slips.forEach(function (s) { s.pts.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); });
    var m = 30;
    svg.setAttribute('viewBox', [x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m].map(Math.round).join(' '));
  }

  function segDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    var u = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
    return Math.hypot(a[0] + u * dx - p[0], a[1] + u * dy - p[1]);
  }
  function gap(A, B) {
    var best = Infinity;
    [[A, B], [B, A]].forEach(function (pair) {
      var X = pair[0], Y = pair[1];
      X.forEach(function (p) {
        for (var i = 0; i < Y.length; i++) best = Math.min(best, segDist(p, Y[i], Y[(i + 1) % Y.length]));
      });
    });
    return best;
  }

  function buildNeighbors() {
    var far = {};
    slips.forEach(function (s) { nbNear[s.id] = []; nbFair[s.id] = []; far[s.id] = []; });
    for (var i = 0; i < slips.length; i++) {
      for (var j = i + 1; j < slips.length; j++) {
        var a = slips[i], b = slips[j];
        if (Math.hypot(a.cx - b.cx, a.cy - b.cy) > FAIRWAY + 80) continue;
        var d = gap(a.pts, b.pts);
        if (d < NEAR) { nbNear[a.id].push(b.id); nbNear[b.id].push(a.id); }
        else if (d < FAIRWAY && a.dock !== b.dock) { far[a.id].push([b.id, d]); far[b.id].push([a.id, d]); }
      }
    }
    // Across the fairway: the facing slip on another dock plus the ones just beside it (like across the dock),
    // judged by how far each sits sideways from the line to the nearest facing slip (center to center).
    // A pair counts only when each slip picks the other, so the relation is the same both ways.
    var picks = {};
    function cdist(a, b) { return Math.hypot(a.cx - b.cx, a.cy - b.cy); }
    slips.forEach(function (s) {
      picks[s.id] = {};
      var perDock = {};
      far[s.id].forEach(function (x) { (perDock[byId[x[0]].dock] = perDock[byId[x[0]].dock] || []).push(x); });
      // Each facing dock separately, so a dock that is closer on one side doesn't hide the one on the other.
      Object.keys(perDock).forEach(function (dock) {
        var list = perDock[dock];
        var near = list.reduce(function (a, b) { return cdist(s, byId[b[0]]) < cdist(s, byId[a[0]]) ? b : a; });
        var n0 = byId[near[0]], ux = n0.cx - s.cx, uy = n0.cy - s.cy, L = Math.hypot(ux, uy);
        ux /= L; uy /= L;
        list.forEach(function (x) {
          var c = byId[x[0]], dx = c.cx - s.cx, dy = c.cy - s.cy;
          var side = Math.abs(dx * uy - dy * ux), ahead = dx * ux + dy * uy;
          if (x[1] <= near[1] + FAIRWAY_SLACK && side <= SIDEWAYS && ahead > 0) picks[s.id][x[0]] = true;
        });
      });
    });
    slips.forEach(function (s) {
      nbFair[s.id] = Object.keys(picks[s.id]).filter(function (o) { return picks[o][s.id]; });
    });
  }

  function neighbors(id) {
    return game.fairway ? nbNear[id].concat(nbFair[id].filter(function (x) { return nbNear[id].indexOf(x) < 0; })) : nbNear[id];
  }

  /* ---------- Random numbers (seeded, so a daily board is the same for everyone) ---------- */
  function hash(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    return h >>> 0;
  }
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  /* ---------- Game ---------- */
  function newGame() {
    if (!svg) return;
    var daily = $('swDaily').checked;
    game = {
      level: $('swLevel').value,
      fairway: $('swFairway').checked,
      daily: daily,
      seed: daily ? 'daily|' + today() + '|' + $('swLevel').value + '|' + $('swFairway').checked : 'free|' + Date.now() + '|' + Math.random(),
      pots: null, open: {}, buoy: {}, taps: 0, opened: 0, over: false, started: 0, hit: ''
    };
    game.potCount = Math.round(slips.length * LEVELS[game.level]);
    stopTimer();
    slips.forEach(function (s) { s.g.setAttribute('class', 'slip'); s.mark.innerHTML = ''; });
    setStatus('Tap any slip to start. Your first tap is always safe.');
    $('swResult').hidden = true;
    updateStats();
  }

  // Pots are laid after the first tap, keeping that slip and its neighbors clear so the game opens up.
  // The shuffle depends only on the seed, so a daily board is the same for everyone; any pot that lands
  // on the first tap's patch moves to the next spare slip in the shuffled order.
  function layPots(first) {
    var r = rng(hash(game.seed));
    var keep = {}; keep[first] = true;
    neighbors(first).forEach(function (n) { keep[n] = true; });
    var order = slips.map(function (s) { return s.id; }).sort();
    for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
    game.pots = {};
    var placed = 0;
    for (var k = 0; k < order.length && placed < game.potCount; k++) {
      if (keep[order[k]]) continue;
      game.pots[order[k]] = true; placed++;
    }
  }

  function count(id) { return neighbors(id).filter(function (n) { return game.pots[n]; }).length; }

  function tap(id) {
    if (game.over || game.buoy[id]) return;
    if (game.open[id]) { chord(id); return; }
    if (!game.pots) { layPots(id); game.started = Date.now(); startTimer(); setStatus(''); }
    game.taps++;
    if (game.pots[id]) { lose(id); return; }
    flood(id);
    sfx('open');
    if (game.opened === slips.length - game.potCount) win();
    updateStats();
  }

  // Opening a slip with no pots around it opens all its neighbors too, spreading across the empty patch.
  function flood(start) {
    var stack = [start];
    while (stack.length) {
      var id = stack.pop();
      if (game.open[id] || game.buoy[id] || game.pots[id]) continue;
      game.open[id] = true; game.opened++;
      var n = count(id);
      paintOpen(id, n);
      if (n === 0) neighbors(id).forEach(function (x) { if (!game.open[x]) stack.push(x); });
    }
  }

  // Tapping an opened number whose buoys are all placed opens the rest of its neighbors.
  function chord(id) {
    var n = count(id), nb = neighbors(id);
    var flags = nb.filter(function (x) { return game.buoy[x]; }).length;
    flashNeighbors(id);
    if (!n || flags !== n) return;
    var shut = nb.filter(function (x) { return !game.open[x] && !game.buoy[x]; });
    if (!shut.length) return;
    game.taps++;
    var bad = shut.filter(function (x) { return game.pots[x]; });
    if (bad.length) { lose(bad[0]); return; }
    shut.forEach(flood);
    sfx('open');
    if (game.opened === slips.length - game.potCount) win();
    updateStats();
  }

  function toggleBuoy(id) {
    if (game.over || game.open[id]) return;
    if (game.buoy[id]) { delete game.buoy[id]; byId[id].mark.innerHTML = ''; byId[id].g.classList.remove('sw-buoy'); }
    else {
      game.buoy[id] = true;
      byId[id].g.classList.add('sw-buoy');
      byId[id].mark.innerHTML = buoySvg(byId[id]);
    }
    sfx('buoy');
    updateStats();
  }

  function lose(id) {
    game.over = true; game.hit = id; stopTimer();
    Object.keys(game.pots).forEach(function (p) {
      var s = byId[p];
      if (game.buoy[p]) return;
      s.g.classList.add('sw-pot');
      s.mark.innerHTML = potSvg(s);
    });
    byId[id].g.classList.add('sw-hit');
    Object.keys(game.buoy).forEach(function (b) { if (!game.pots[b]) byId[b].g.classList.add('sw-wrong'); });
    setStatus('');
    updateStats();
    var msg = function () {
      showResult(false, 'Fouled your prop on slip ' + id + '!', 'A crab pot line wrapped your prop, and its crab is not happy. ' + game.opened + ' of ' + (slips.length - game.potCount) + ' safe slips opened.');
    };
    // An angry crab climbs out of the pot and thrashes its claws, then the result shows.
    var poly = byId[id].g.querySelector('polygon, rect');
    if (window.AngryCrab && poly) {
      sfx('hit');
      window.AngryCrab.show(poly.getBoundingClientRect(), { sound: $('swSound').checked }).then(msg);
    } else { sfx('hit'); msg(); }
  }

  function win() {
    game.over = true; stopTimer();
    Object.keys(game.pots).forEach(function (p) {
      if (!game.buoy[p]) { game.buoy[p] = true; byId[p].g.classList.add('sw-buoy'); byId[p].mark.innerHTML = buoySvg(byId[p]); }
    });
    sfx('win');
    setStatus('');
    showResult(true, 'Harbor swept!', 'Every crab pot found in ' + fmtTime(elapsed()) + ' with ' + game.taps + ' taps.');
    updateStats();
  }

  /* ---------- Drawing ---------- */
  var NUM_COLORS = ['', '#1f5fbf', '#2e7d32', '#c62828', '#4a148c', '#8d2a0b', '#00838f', '#212121', '#616161'];

  function badgeSize(s) {
    var xs = s.pts.map(function (p) { return p[0]; }), ys = s.pts.map(function (p) { return p[1]; });
    return Math.max(9, Math.min(15,Math.max.apply(null, xs) - Math.min.apply(null, xs), Math.max.apply(null, ys) - Math.min.apply(null, ys)) * 0.72);
  }

  function paintOpen(id, n) {
    var s = byId[id];
    s.g.classList.add('sw-open');
    s.g.classList.toggle('sw-zero', n === 0);
    if (!n) { s.mark.innerHTML = ''; return; }
    var fs = badgeSize(s);
    s.mark.innerHTML = '<circle cx="' + s.cx + '" cy="' + s.cy + '" r="' + (fs * 0.62) + '" fill="#fff" stroke="' + NUM_COLORS[n] + '" stroke-width="1.2"/>' +
      '<text x="' + s.cx + '" y="' + s.cy + '" text-anchor="middle" dominant-baseline="central" font-weight="700" font-size="' + fs + '" fill="' + NUM_COLORS[n] + '">' + n + '</text>';
  }

  function buoySvg(s) {
    var r = badgeSize(s) * 0.55;
    return '<line x1="' + s.cx + '" y1="' + (s.cy + r) + '" x2="' + s.cx + '" y2="' + (s.cy - r * 1.5) + '" stroke="#1c2733" stroke-width="1.2"/>' +
      '<circle cx="' + s.cx + '" cy="' + s.cy + '" r="' + r + '" fill="#f26b21" stroke="#fff" stroke-width="1.2"/>' +
      '<rect x="' + (s.cx - r) + '" y="' + (s.cy - r * 0.25) + '" width="' + (r * 2) + '" height="' + (r * 0.5) + '" fill="#fff"/>';
  }

  function potSvg(s) {
    var r = badgeSize(s) * 0.55, x = s.cx - r, y = s.cy - r * 0.8, w = r * 2, h = r * 1.6;
    var bars = '';
    for (var i = 1; i < 4; i++) bars += '<line x1="' + (x + w * i / 4) + '" y1="' + y + '" x2="' + (x + w * i / 4) + '" y2="' + (y + h) + '" stroke="#3b2a1a" stroke-width=".8"/>';
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="1.5" fill="#d9a441" stroke="#3b2a1a" stroke-width="1.2"/>' + bars +
      '<line x1="' + x + '" y1="' + (y + h / 2) + '" x2="' + (x + w) + '" y2="' + (y + h / 2) + '" stroke="#3b2a1a" stroke-width=".8"/>';
  }

  function flashNeighbors(id) {
    var nb = neighbors(id);
    nb.forEach(function (x) { byId[x].g.classList.add('sw-flash'); });
    setTimeout(function () { nb.forEach(function (x) { byId[x].g.classList.remove('sw-flash'); }); }, 700);
  }

  /* ---------- Input: tap opens, long-press / right-click places a buoy ---------- */
  function bindMap() {
    var press = null, longFired = false;
    function slipAt(e) { var g = e.target.closest && e.target.closest('g.slip'); return g ? g.getAttribute('data-dock') + g.getAttribute('data-num') : null; }

    svg.addEventListener('pointerdown', function (e) {
      var id = slipAt(e);
      if (!id || e.button > 0) return;
      longFired = false;
      press = { id: id, x: e.clientX, y: e.clientY, t: setTimeout(function () {
        longFired = true;
        if (game.open[byId[id].id]) flashNeighbors(id); else toggleBuoy(id);
        if (navigator.vibrate) navigator.vibrate(25);
      }, 450) };
    });
    function cancel() { if (press) { clearTimeout(press.t); press = null; } }
    svg.addEventListener('pointermove', function (e) { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) cancel(); });
    svg.addEventListener('pointerup', cancel);
    svg.addEventListener('pointercancel', cancel);
    svg.addEventListener('pointerleave', cancel);
    svg.addEventListener('click', function (e) {
      var id = slipAt(e);
      if (!id) return;
      if (longFired) { longFired = false; return; }
      if (buoyMode && !game.open[id]) toggleBuoy(id); else tap(id);
    });
    svg.addEventListener('contextmenu', function (e) {
      var id = slipAt(e);
      if (!id) return;
      e.preventDefault();
      if (game.open[id]) flashNeighbors(id); else toggleBuoy(id);
    });
    // Hovering an opened number outlines the slips it counts.
    svg.addEventListener('mouseover', function (e) {
      var id = slipAt(e);
      svg.querySelectorAll('.sw-hover').forEach(function (g) { g.classList.remove('sw-hover'); });
      if (id && game && game.open[id] && !game.over) neighbors(id).forEach(function (x) { byId[x].g.classList.add('sw-hover'); });
    });
    svg.addEventListener('mouseleave', function () { svg.querySelectorAll('.sw-hover').forEach(function (g) { g.classList.remove('sw-hover'); }); });
  }

  /* ---------- Panel ---------- */
  function elapsed() { return game && game.started ? Math.floor(((game.over && game.ended) || Date.now()) - game.started) / 1000 : 0; }
  function fmtTime(sec) { sec = Math.floor(sec); return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
  function startTimer() { stopTimer(); timer = setInterval(updateStats, 1000); }
  function stopTimer() { if (game && game.started && !game.ended && game.over) game.ended = Date.now(); clearInterval(timer); timer = null; }

  function updateStats() {
    if (!game) return;
    $('swPots').textContent = game.potCount - Object.keys(game.buoy).length;
    $('swOpened').textContent = game.opened + ' / ' + (slips.length - game.potCount);
    $('swTaps').textContent = game.taps;
    $('swTime').textContent = fmtTime(elapsed());
  }
  function setStatus(t) { $('swStatus').textContent = t; $('swStatus').hidden = !t; }
  function showResult(won, title, body) {
    var r = $('swResult');
    r.className = 'sw-result ' + (won ? 'won' : 'lost');
    r.innerHTML = '<strong>' + title + '</strong> ' + body + ' <button type="button" class="btn-sm" id="swAgain">Play again</button>';
    r.hidden = false;
    $('swAgain').addEventListener('click', newGame);
  }

  function setZoom(z) {
    zoom = Math.max(1, Math.min(5, z));
    var stage = $('swMap').querySelector('.game-map-stage');
    if (stage) stage.style.width = (zoom * 100) + '%';
  }

  $('swNew').addEventListener('click', newGame);
  ['swLevel', 'swFairway', 'swDaily'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      if (game && game.pots && !game.over && !confirm('Start a new board with this setting?')) return;
      newGame();
    });
  });
  $('swZoomIn').addEventListener('click', function () { setZoom(zoom + 0.5); });
  $('swZoomOut').addEventListener('click', function () { setZoom(zoom - 0.5); });
  $('swBuoyMode').addEventListener('click', function () {
    buoyMode = !buoyMode;
    this.setAttribute('aria-pressed', buoyMode);
    this.textContent = buoyMode ? 'Tap places buoys' : 'Tap opens slips';
    $('swMap').classList.toggle('buoy-mode', buoyMode);
  });

  /* ---------- Sound (simple tones; the Poker Run's sounds can be swapped in later) ---------- */
  var ac;
  function sfx(kind) {
    if (!$('swSound').checked) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      var notes = { open: [[660, 0, .06]], buoy: [[520, 0, .05], [780, .05, .06]], hit: [[180, 0, .25], [120, .12, .35]], win: [[523, 0, .12], [659, .12, .12], [784, .24, .12], [1047, .36, .3]] }[kind];
      notes.forEach(function (n) {
        var o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + n[1];
        o.type = kind === 'hit' ? 'sawtooth' : 'sine';
        o.frequency.value = n[0];
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.18, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + n[2]);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + n[2] + .02);
      });
    } catch (e) { /* no sound available */ }
  }
})();
