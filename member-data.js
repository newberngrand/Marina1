/* Shared labels and helpers for the member portal, event page and admin page. */
(function () {
  var TZ = 'America/New_York';

  var EVENT_TYPES = [
    { id: 'meeting', label: 'Meeting' },
    { id: 'vote', label: 'Vote' },
    { id: 'notice', label: 'Notice' },
    { id: 'social', label: 'Social' },
    { id: 'game', label: 'Game' },
    { id: 'maintenance', label: 'Maintenance' },
    { id: 'other', label: 'Other' }
  ];

  // Games that can be run as a Game event (each one gets its own play screen).
  var GAMES = [
    { id: 'poker_run', label: '5 Card Poker Run' }
  ];

  var CLASS_LABELS = [
    { id: 'certificated', label: 'Slip owners' },
    { id: 'ltc', label: 'Long-term cruisers (LTC)' },
    { id: 'stc', label: 'Transients (STC)' },
    { id: 'employee', label: 'Employees' }
  ];

  var DOC_CATEGORIES = [
    { id: 'bylaws', label: 'Bylaws & Amendments', dateLabel: 'Effective date' },
    { id: 'rules', label: 'Rules & Regulations', dateLabel: 'Effective date' },
    { id: 'minutes', label: 'Meeting Minutes', dateLabel: 'Meeting date' },
    { id: 'financials', label: 'Budgets & Financials', dateLabel: 'Date' },
    { id: 'permits', label: 'Permits & Licenses', dateLabel: 'Issue date' },
    { id: 'insurance', label: 'Insurance', dateLabel: 'Effective date' },
    { id: 'forms', label: 'Forms', dateLabel: 'Date' },
    { id: 'other', label: 'Other Documents', dateLabel: 'Date' },
    { id: 'board', label: 'Board Documents', dateLabel: 'Date', boardOnly: true }
  ];

  function label(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label;
    return id;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Plain text with line breaks and clickable links, safely escaped.
  function richText(s) {
    return esc(s)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }

  function fmtDate(d) {
    return new Date(d).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function fmtTime(d) {
    return new Date(d).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  }
  function fmtWhen(start, end) {
    if (!start) return '';
    var s = fmtDate(start) + ', ' + fmtTime(start);
    if (end) {
      s += (fmtDate(end) === fmtDate(start) ? ' – ' + fmtTime(end) : ' – ' + fmtDate(end) + ', ' + fmtTime(end));
    }
    return s;
  }
  // A plain YYYY-MM-DD (no time zone shift).
  function fmtDay(ymd) {
    if (!ymd) return '';
    var p = ymd.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  function monthKey(ymd) {
    var p = ymd.split('-');
    return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // <input type="datetime-local"> value (Eastern time) <-> ISO timestamp.
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
    var hh = parts.hour === '24' ? '00' : parts.hour;
    return parts.year + '-' + parts.month + '-' + parts.day + 'T' + hh + ':' + parts.minute;
  }
  function fromLocalInput(v) {
    if (!v) return null;
    // Interpret the typed wall-clock time as Eastern time.
    var guess = new Date(v + ':00Z');
    for (var i = 0; i < 2; i++) {
      var shown = toLocalInput(guess.toISOString());
      var diff = new Date(v + ':00Z') - new Date(shown + ':00Z');
      guess = new Date(guess.getTime() + diff);
    }
    return guess.toISOString();
  }

  function fileSize(n) {
    if (!n) return '';
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function openDocument(sb, path, fileName, meta) {
    meta = meta || {};
    if (window.MemberAuth && MemberAuth.track) {
      MemberAuth.track('open_document', { type: 'document', id: meta.id || path, label: meta.title || fileName,
        details: meta.category ? { section: meta.category } : {} });
    }
    var win = window.open('', '_blank');
    return sb.storage.from('marina-docs').createSignedUrl(path, 300).then(function (r) {
      if (r.error) { if (win) win.close(); alert('Sorry, that document could not be opened.'); return; }
      if (win) win.location = r.data.signedUrl; else window.location = r.data.signedUrl;
    });
  }

  function ballotChoices(ev) {
    if (ev.ballot_kind === 'yes_no') return ['Yea', 'Nay'];
    if (ev.ballot_kind === 'yes_no_abstain') return ['Yea', 'Nay', 'Abstain'];
    if (ev.ballot_kind === 'approve_disapprove') return ['Approve', 'Disapprove'];
    return ev.ballot_options || [];
  }
  // 'upcoming' | 'open' | 'closed'
  function voteState(ev) {
    var now = Date.now();
    if (ev.vote_opens_at && now < new Date(ev.vote_opens_at).getTime()) return 'upcoming';
    if (ev.vote_closes_at && now >= new Date(ev.vote_closes_at).getTime()) return 'closed';
    return 'open';
  }
  function voteWindowText(ev) {
    var st = voteState(ev);
    var close = ev.vote_closes_at ? fmtDate(ev.vote_closes_at) + ' at ' + fmtTime(ev.vote_closes_at) : '';
    if (st === 'upcoming') return 'Voting opens ' + fmtDate(ev.vote_opens_at) + ' at ' + fmtTime(ev.vote_opens_at) + ' and closes ' + close;
    if (st === 'open') return 'Voting is open until ' + close;
    return 'Voting closed ' + close;
  }


  /* ---------- pictures: resize/rotate, and a full-screen zoom viewer (certificates) ---------- */
  // A small copy for the thumbnail (and, when rotating, the turned image itself).
  function loadImage(src) {
    return new Promise(function (ok, bad) {
      var img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = function () { ok(img); }; img.onerror = function () { bad(new Error('Could not read that image.')); };
      img.src = src;
    });
  }
  function drawImage(img, maxW, turn) {
    var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, maxW / Math.max(w, h));
    var cw = Math.round((turn ? h : w) * s), ch = Math.round((turn ? w : h) * s), cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    var g = cv.getContext('2d');
    if (turn) { g.translate(cw, 0); g.rotate(Math.PI / 2); }
    g.drawImage(img, 0, 0, w * s, h * s);
    return new Promise(function (ok) { cv.toBlob(ok, 'image/jpeg', maxW > 1000 ? 0.9 : 0.82); });
  }
  // Full-screen viewer: fit to screen; click, the wheel or a pinch zooms in; drag to move around.
  function openViewer(src, title) {
    var ov = document.createElement('div'); ov.className = 'img-viewer';
    ov.innerHTML = '<div class="iv-bar"><span>' + esc(title) + '</span><span><button type="button" data-z="-1" aria-label="Zoom out">&minus;</button>' +
      '<button type="button" data-z="0">Fit</button><button type="button" data-z="1" aria-label="Zoom in">+</button>' +
      '<a href="' + src + '" target="_blank" rel="noopener">Open</a><button type="button" data-x aria-label="Close">&times;</button></span></div>' +
      '<div class="iv-stage"><img alt=""></div>';
    document.body.appendChild(ov);
    var stage = ov.querySelector('.iv-stage'), img = ov.querySelector('img'), z = 1, fit = 1, tx = 0, ty = 0, drag = null, moved = false;
    function apply() {
      var sw = stage.clientWidth, sh = stage.clientHeight, w = img.naturalWidth * z, h = img.naturalHeight * z;
      tx = w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, tx));
      ty = h <= sh ? (sh - h) / 2 : Math.min(0, Math.max(sh - h, ty));
      img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + z + ')';
      stage.style.cursor = z > fit + 1e-3 ? 'grab' : 'zoom-in';
    }
    function zoomAt(nz, cx, cy) { nz = Math.max(fit, Math.min(4, nz)); tx = cx - (cx - tx) * nz / z; ty = cy - (cy - ty) * nz / z; z = nz; apply(); }
    function close() { ov.remove(); document.removeEventListener('keydown', key); }
    function key(e) { if (e.key === 'Escape') close(); }
    img.onload = function () { fit = z = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight, 1); tx = ty = 0; apply(); };
    img.src = src;
    document.addEventListener('keydown', key);
    ov.querySelector('.iv-bar').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-x')) return close();
      var d = +b.getAttribute('data-z'), cx = stage.clientWidth / 2, cy = stage.clientHeight / 2;
      if (d === 0) { z = fit; apply(); } else zoomAt(z * (d > 0 ? 1.5 : 1 / 1.5), cx, cy);
    });
    stage.addEventListener('wheel', function (e) { e.preventDefault(); var r = stage.getBoundingClientRect(); zoomAt(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    var pts = {}, pinch = 0;
    stage.addEventListener('pointerdown', function (e) {
      pts[e.pointerId] = [e.clientX, e.clientY]; moved = false;
      var ids = Object.keys(pts);
      if (ids.length === 2) { pinch = Math.hypot(pts[ids[0]][0] - pts[ids[1]][0], pts[ids[0]][1] - pts[ids[1]][1]); drag = null; }
      else drag = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = [e.clientX, e.clientY];
      var ids = Object.keys(pts), r = stage.getBoundingClientRect();
      if (ids.length === 2 && pinch) {
        var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        zoomAt(z * d / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); pinch = d; moved = true; return;
      }
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) moved = true;
      tx = drag.tx + e.clientX - drag.x; ty = drag.ty + e.clientY - drag.y; apply();
    });
    stage.addEventListener('pointerup', function (e) {
      delete pts[e.pointerId]; if (Object.keys(pts).length < 2) pinch = 0;
      if (!moved && drag) { var r = stage.getBoundingClientRect(); if (z > fit + 1e-3) { z = fit; apply(); } else zoomAt(fit * 2.5, e.clientX - r.left, e.clientY - r.top); }
      drag = null;
    });
    window.addEventListener('resize', function () { if (!document.body.contains(ov)) return; var was = z <= fit + 1e-3; fit = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight, 1); if (was) z = fit; apply(); });
  }
  window.MemberData = {
    ballotChoices: ballotChoices, voteState: voteState, voteWindowText: voteWindowText,
    EVENT_TYPES: EVENT_TYPES, DOC_CATEGORIES: DOC_CATEGORIES, GAMES: GAMES,
    gameLabel: function (id) { return label(GAMES, id); },
    classLabel: function (id) { return label(CLASS_LABELS, id); },
    eventTypeLabel: function (id) { return label(EVENT_TYPES, id); },
    categoryLabel: function (id) { return label(DOC_CATEGORIES, id); },
    esc: esc, richText: richText, fmtWhen: fmtWhen, fmtDay: fmtDay, monthKey: monthKey,
    toLocalInput: toLocalInput, fromLocalInput: fromLocalInput, fileSize: fileSize,
    openDocument: openDocument, loadImage: loadImage, drawImage: drawImage, openViewer: openViewer
  };
})();
