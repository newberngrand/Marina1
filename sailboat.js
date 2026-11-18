/* Marina Map extra: when a slip is shown, a little 3D sailboat sails in from the
   Trent River (between the compass rose and the "R" of RIVER), leaving a dotted
   trail, and stops just outside the slip.
   The route is found on the map itself: docks, slips, land, the railroad bridge
   and labels are obstacles, and the boat takes the shortest open-water path.
   To turn this off, remove the sailboat.js <script> tag from marina-map.html. */
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var START = { x: 1748, y: 728 };   // between the compass rose and the final "R" of TRENT RIVER
  var CELL = 6;                      // route grid size (map units)
  var CLEAR = 9;                     // how far the boat keeps from docks and slips (map units)
  var grid = null, gridSvg = null, raf = 0, woodLines = [], shoreLine = [];
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  window.addEventListener('slipshown', function (e) { sail(e.detail.svg, e.detail.slip); });
  window.addEventListener('slipcleared', function (e) { stop(e.detail.svg); });
  // A link like marina-map.html?slip=B23 can show the slip before this script is listening.
  var already = document.querySelector('#slipMap svg .slip.hit');
  if (already) sail(already.ownerSVGElement, already);

  function stop(svg) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (!svg) return;
    ['#sbTrail', '#sbBoat'].forEach(function (s) { var n = svg.querySelector(s); if (n) n.remove(); });
  }

  /* ---------- obstacle grid ---------- */
  function pts(el) {
    return el.getAttribute('points').trim().split(/\s+/).map(function (p) { var a = p.split(','); return { x: +a[0], y: +a[1] }; });
  }
  function inPoly(x, y, P) {
    var c = false;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
      if ((P[i].y > y) !== (P[j].y > y) && x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x) c = !c;
    }
    return c;
  }
  function rectPoly(x, y, w, h) { return [{ x: x, y: y }, { x: x + w, y: y }, { x: x + w, y: y + h }, { x: x, y: y + h }]; }

  function buildGrid(svg) {
    // Always plan on the whole map (its original viewBox), whatever the current zoom.
    var vb = [40, 90, 1920, 1410];
    var W = Math.ceil(vb[2] / CELL), H = Math.ceil(vb[3] / CELL);
    var g = new Uint8Array(W * H);
    var polys = [];

    // Land: everything above the shoreline (with the riverwalk).
    var shore = svg.querySelector('polyline');
    shoreLine = shore ? pts(shore) : [];
    // Docks (wood), slips, railroad bridge.
    woodLines = [];
    svg.querySelectorAll('polygon').forEach(function (p) {
      var f = p.getAttribute('fill') || '';
      if (f === 'url(#wood)' || f === 'url(#ties)') {
        var P = pts(p); polys.push(P);
        if (f === 'url(#wood)' && P.length === 4) {
          // Centre line of the walkway: middle of the two short edges.
          var e1 = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y), e2 = Math.hypot(P[2].x - P[1].x, P[2].y - P[1].y);
          var a = e1 < e2 ? [P[0], P[1], P[2], P[3]] : [P[1], P[2], P[3], P[0]];
          woodLines.push([{ x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }, { x: (a[2].x + a[3].x) / 2, y: (a[2].y + a[3].y) / 2 }]);
        }
      }
    });
    svg.querySelectorAll('.slip').forEach(function (s) {
      var p = s.querySelector('polygon'), r = s.querySelector('rect');
      if (p) polys.push(pts(p));
      else if (r) polys.push(rectPoly(+r.getAttribute('x'), +r.getAttribute('y'), +r.getAttribute('width'), +r.getAttribute('height')));
    });
    // The title panel and the compass. (Round size and dock badges are just labels; the boat may pass them.)
    svg.querySelectorAll('rect').forEach(function (r) {
      // The title panel (not the water background, which also is a big rect).
      if (+r.getAttribute('width') >= 600 && +r.getAttribute('width') < 1500 && !/^url/.test(r.getAttribute('fill') || '')) polys.push(rectPoly(+r.getAttribute('x'), +r.getAttribute('y'), +r.getAttribute('width'), +r.getAttribute('height')));
    });
    svg.querySelectorAll('g[transform^="translate"]').forEach(function (t) {
      var c = t.querySelector('circle');
      var m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(t.getAttribute('transform'));
      if (c && m) { var R = +c.getAttribute('r'), cx = +m[1], cy = +m[2]; polys.push(rectPoly(cx - R, cy - R, 2 * R, 2 * R)); }
    });

    function cellX(i) { return vb[0] + (i + 0.5) * CELL; }
    function cellY(j) { return vb[1] + (j + 0.5) * CELL; }
    // Land.
    for (var i = 0; i < W; i++) {
      var sy = shoreY(cellX(i));
      for (var j = 0; j < H && cellY(j) < sy + 4; j++) g[j * W + i] = 1;
    }
    // Shapes.
    polys.forEach(function (P) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      P.forEach(function (q) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
      var i0 = Math.max(0, Math.floor((x0 - vb[0]) / CELL)), i1 = Math.min(W - 1, Math.floor((x1 - vb[0]) / CELL));
      var j0 = Math.max(0, Math.floor((y0 - vb[1]) / CELL)), j1 = Math.min(H - 1, Math.floor((y1 - vb[1]) / CELL));
      for (var jj = j0; jj <= j1; jj++) for (var ii = i0; ii <= i1; ii++) {
        if (inPoly(cellX(ii), cellY(jj), P)) g[jj * W + ii] = 1;
      }
    });
    // Keep the boat a little away from everything.
    var r = Math.ceil(CLEAR / CELL), out = new Uint8Array(W * H);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      if (!g[y * W + x]) continue;
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        var X = x + dx, Y = y + dy;
        if (X >= 0 && Y >= 0 && X < W && Y < H) out[Y * W + X] = 1;
      }
    }
    return { W: W, H: H, b: out, vb: vb, cellX: cellX, cellY: cellY };
  }

  function shoreY(x) {
    var P = shoreLine;
    if (!P.length) return -Infinity;
    for (var k = 0; k < P.length - 1; k++) {
      if (x >= P[k].x && x <= P[k + 1].x) return P[k].y + (P[k + 1].y - P[k].y) * (x - P[k].x) / (P[k + 1].x - P[k].x);
    }
    return x < P[0].x ? P[0].y : P[P.length - 1].y;
  }

  function cellOf(p) {
    return { i: Math.floor((p.x - grid.vb[0]) / CELL), j: Math.floor((p.y - grid.vb[1]) / CELL) };
  }
  function free(p) {
    var c = cellOf(p);
    return c.i >= 0 && c.j >= 0 && c.i < grid.W && c.j < grid.H && !grid.b[c.j * grid.W + c.i];
  }

  /* ---------- where to stop ---------- */
  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    var t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  function nearStructure(p) {
    var d = Math.abs(p.y - shoreY(p.x));
    woodLines.forEach(function (w) { d = Math.min(d, segDist(p, w[0], w[1])); });
    return d;
  }
  // The slip's open end (away from its dock or the shore) and the outward direction.
  function mouth(slip) {
    var cands = [], p = slip.querySelector('polygon'), r = slip.querySelector('rect');
    var P = p ? pts(p) : rectPoly(+r.getAttribute('x'), +r.getAttribute('y'), +r.getAttribute('width'), +r.getAttribute('height'));
    var cx = 0, cy = 0;
    P.forEach(function (q) { cx += q.x / P.length; cy += q.y / P.length; });
    for (var k = 0; k < P.length; k++) {
      var a = P[k], b = P[(k + 1) % P.length];
      var m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, L = Math.hypot(m.x - cx, m.y - cy) || 1;
      var n = { x: (m.x - cx) / L, y: (m.y - cy) / L };
      var test = { x: m.x + n.x * 40, y: m.y + n.y * 40 };
      cands.push({ m: m, n: n, open: free(test), away: nearStructure(m), short: Math.hypot(b.x - a.x, b.y - a.y) });
    }
    // Slips open on a short edge: prefer one with open water in front, farthest from the dock/shore.
    var shortest = Math.min.apply(null, cands.map(function (c) { return c.short; }));
    cands.sort(function (u, v) {
      var su = u.short < shortest * 1.35 ? 1 : 0, sv = v.short < shortest * 1.35 ? 1 : 0;
      if (u.open !== v.open) return u.open ? -1 : 1;
      if (su !== sv) return sv - su;
      return v.away - u.away;
    });
    return cands[0];
  }

  /* ---------- route (A* on the grid) ---------- */
  function route(from, to) {
    var W = grid.W, H = grid.H, b = grid.b;
    var s = cellOf(from), t = cellOf(to);
    var start = s.j * W + s.i, goal = t.j * W + t.i;
    var gS = new Float32Array(W * H).fill(Infinity), came = new Int32Array(W * H).fill(-1), shut = new Uint8Array(W * H);
    var heap = [];
    function h(k) { var dx = Math.abs(k % W - t.i), dy = Math.abs(((k / W) | 0) - t.j); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); }
    function push(k, f) {
      heap.push([f, k]); var i = heap.length - 1;
      while (i > 0) { var p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; var tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p; }
    }
    function pop() {
      var top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last; var i = 0;
        for (;;) {
          var l = 2 * i + 1, r = l + 1, m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break; var tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m;
        }
      }
      return top;
    }
    gS[start] = 0; push(start, h(start));
    var D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (heap.length) {
      var cur = pop()[1];
      if (cur === goal) break;
      if (shut[cur]) continue;
      shut[cur] = 1;
      var cx = cur % W, cy = (cur / W) | 0;
      for (var d = 0; d < 8; d++) {
        var nx = cx + D[d][0], ny = cy + D[d][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var nk = ny * W + nx;
        if (b[nk] && nk !== goal) continue;
        if (D[d][2] > 1 && (b[cy * W + nx] || b[ny * W + cx])) continue;   // no cutting corners
        var ng = gS[cur] + D[d][2];
        if (ng < gS[nk]) { gS[nk] = ng; came[nk] = cur; push(nk, ng + h(nk)); }
      }
    }
    if (came[goal] < 0 && goal !== start) return null;
    var path = [], k2 = goal;
    while (k2 >= 0) { path.push({ x: grid.cellX(k2 % W), y: grid.cellY((k2 / W) | 0) }); if (k2 === start) break; k2 = came[k2]; }
    return path.reverse();
  }

  // Straighten the grid path: keep only the turns needed to stay in open water.
  function clearLine(a, b) {
    var L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(L / (CELL / 2));
    for (var i = 1; i < n; i++) if (!free({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n })) return false;
    return true;
  }
  function simplify(P) {
    var out = [P[0]], i = 0;
    while (i < P.length - 1) {
      var j = P.length - 1;
      while (j > i + 1 && !clearLine(P[i], P[j])) j--;
      out.push(P[j]); i = j;
    }
    return out;
  }
  // Smooth curve through the turn points (Catmull-Rom), sampled every few units.
  function smooth(P) {
    if (P.length < 3) return P;
    var out = [];
    for (var i = 0; i < P.length - 1; i++) {
      var p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      var n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 4));
      for (var s = 0; s < n; s++) {
        var t = s / n, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
        });
      }
    }
    out.push(P[P.length - 1]);
    return out;
  }

  /* ---------- the boat ---------- */
  function addDefs(svg) {
    if (svg.querySelector('#sbHull')) return;
    var defs = svg.querySelector('defs') || svg.insertBefore(document.createElementNS(NS, 'defs'), svg.firstChild);
    defs.insertAdjacentHTML('beforeend',
      '<linearGradient id="sbHull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e3e9f0"/><stop offset="1" stop-color="#a9b6c6"/></linearGradient>' +
      '<linearGradient id="sbSail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#f3f0e8"/><stop offset="1" stop-color="#cfc8b8"/></linearGradient>' +
      '<linearGradient id="sbJib" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e8e3d6"/><stop offset="1" stop-color="#ffffff"/></linearGradient>' +
      '<radialGradient id="sbShadow"><stop offset="0" stop-color="#0b2540" stop-opacity=".45"/><stop offset="1" stop-color="#0b2540" stop-opacity="0"/></radialGradient>');
  }
  // Drawn bow-to-the-right, about 64 units tall, origin at the waterline.
  var BOAT =
    '<ellipse cx="2" cy="3" rx="30" ry="6" fill="url(#sbShadow)"/>' +
    '<g class="sb-bob">' +
      '<path d="M-27,-9 L31,-9 Q25,3 14,6 L-21,6 Q-27,2 -27,-9 Z" fill="url(#sbHull)" stroke="#5b6b80" stroke-width="1"/>' +
      '<path d="M-26,-4 L28,-4 Q26,-1 24,0 L-25,0 Z" fill="#0e2a4a"/>' +
      '<path d="M-27,-9 L31,-9 L28,-12 L-24,-12 Z" fill="#c9a36b" stroke="#8a6a3f" stroke-width=".6"/>' +
      '<rect x="-14" y="-17" width="14" height="6" rx="2" fill="#f4f6f9" stroke="#8796aa" stroke-width=".6"/>' +
      '<line x1="2" y1="-12" x2="2" y2="-66" stroke="#5a4632" stroke-width="2.2" stroke-linecap="round"/>' +
      '<path d="M0,-64 Q-12,-38 -21,-15 L0,-15 Z" fill="url(#sbSail)" stroke="#b8b0a0" stroke-width=".7"/>' +
      '<path d="M5,-60 Q16,-36 27,-13 L5,-13 Z" fill="url(#sbJib)" stroke="#b8b0a0" stroke-width=".7"/>' +
      '<path d="M2,-66 L14,-63 L2,-60 Z" fill="#e5322b"/>' +
      '<path class="sb-spray" d="M31,-6 q6,2 9,6 M29,0 q5,1 8,4" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>' +
    '</g>';

  function unitsPerPx(svg) {
    var vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    return vb[2] / (svg.clientWidth || 800);
  }

  function sail(svg, slip) {
    stop(svg);
    if (!svg || !slip) return;
    if (!grid || gridSvg !== svg) { grid = buildGrid(svg); gridSvg = svg; }
    addDefs(svg);

    var mo = mouth(slip);
    var k = Math.max(38, Math.min(50, svg.clientWidth * 0.042)) / 64 * unitsPerPx(svg);   // boat about 38-50px tall on screen
    function at(d) { return { x: mo.m.x + mo.n.x * d, y: mo.m.y + mo.n.y * d }; }
    // The open water in front of the slip: from d0 (clear of the slip) to d1 (next obstacle).
    var d0 = -1, d1 = -1;
    for (var d = 4; d <= 260; d += 3) {
      if (free(at(d))) { if (d0 < 0) d0 = d; d1 = d; } else if (d0 >= 0) break;
    }
    var stopAt, approach;
    if (d0 >= 0) {
      // Stop with the bow just short of the slip (the hull reaches 31 units ahead of the boat's centre),
      // but never past the middle of the fairway.
      var off = 31 * k * Math.abs(mo.n.x) + 6 * k + 4;
      var stopD = Math.max(d0, Math.min(off, (d0 + d1) / 2));
      stopAt = at(stopD);
      approach = at(Math.min(d1, stopD + 40));
    } else {
      // A few slips at the head of a dock sit right against the shore: stop at the nearest open water.
      var best = null, bd = Infinity;
      for (var dy2 = -200; dy2 <= 200; dy2 += 4) for (var dx2 = -200; dx2 <= 200; dx2 += 4) {
        var q = { x: mo.m.x + dx2, y: mo.m.y + dy2 }, dd = dx2 * dx2 + dy2 * dy2;
        if (dd < bd && free(q)) { bd = dd; best = q; }
      }
      if (!best) return;
      stopAt = approach = best;
      var L2 = Math.hypot(mo.m.x - best.x, mo.m.y - best.y) || 1;
      mo = { m: mo.m, n: { x: (best.x - mo.m.x) / L2, y: (best.y - mo.m.y) / L2 } };   // face the slip at the end
    }
    var cells = route(START, approach);
    if (!cells) return;
    var turns = simplify(cells);
    turns[0] = START;
    turns.push(stopAt);
    var line = smooth(turns);
    var len = [0];
    for (var i = 1; i < line.length; i++) len.push(len[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
    var total = len[len.length - 1];

    var trail = document.createElementNS(NS, 'path');
    trail.setAttribute('id', 'sbTrail');
    trail.setAttribute('fill', 'none');
    trail.setAttribute('stroke', '#0e2a4a');
    trail.setAttribute('stroke-opacity', '.75');
    trail.setAttribute('stroke-width', (3 * unitsPerPx(svg)).toFixed(2));
    trail.setAttribute('stroke-linecap', 'round');
    trail.setAttribute('stroke-dasharray', '0 ' + (9 * unitsPerPx(svg)).toFixed(2));
    var boat = document.createElementNS(NS, 'g');
    boat.setAttribute('id', 'sbBoat');
    boat.setAttribute('pointer-events', 'none');
    trail.setAttribute('pointer-events', 'none');
    boat.innerHTML = BOAT;
    var pin = svg.querySelector('#slipPin3d');
    svg.insertBefore(trail, pin || null);
    svg.appendChild(boat);

    var dPath = 'M' + line[0].x.toFixed(1) + ' ' + line[0].y.toFixed(1), drawn = 0;
    function place(dist) {
      var i = 1;
      while (i < len.length - 1 && len[i] < dist) i++;
      var a = line[i - 1], b = line[i], seg = (len[i] - len[i - 1]) || 1, t = Math.max(0, Math.min(1, (dist - len[i - 1]) / seg));
      var x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      // Face the way we're going (or into the slip at the end).
      var dx = b.x - a.x;
      if (dist >= total) dx = -mo.n.x || dx;
      var flip = dx < 0 ? -1 : 1;
      boat.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') scale(' + (flip * k).toFixed(3) + ' ' + k.toFixed(3) + ')');
      while (drawn < i - 1) { drawn++; dPath += ' L' + line[drawn].x.toFixed(1) + ' ' + line[drawn].y.toFixed(1); }
      trail.setAttribute('d', dPath + ' L' + x.toFixed(1) + ' ' + y.toFixed(1));
    }

    if (reduceMotion) { place(total); boat.classList.add('sb-docked'); return; }
    var dur = Math.max(3500, Math.min(8000, total / 0.32)), t0 = performance.now();
    function frame(now) {
      var p = Math.min(1, (now - t0) / dur);
      var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;   // ease in and out
      place(e * total);
      if (p < 1) raf = requestAnimationFrame(frame);
      else { raf = 0; boat.classList.add('sb-docked'); }
    }
    place(0);
    raf = requestAnimationFrame(frame);
  }
})();
