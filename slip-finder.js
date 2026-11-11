/* Slip finder: type a dock + slip (e.g. "B23", "A-0A") to see it on the slip map.
   Whole-map view shows a 3D pin; "Zoom in" (or pinch / double-tap) zooms to the slip. */
(function () {
  var holder = document.getElementById('slipMap');
  var form = document.getElementById('slipForm');
  var input = document.getElementById('slipInput');
  var info = document.getElementById('slipInfo');
  var resetBtn = document.getElementById('slipReset');
  var photo = document.getElementById('mapPhoto');
  var zoomBtn = document.getElementById('slipZoom');
  if (!holder || !form) return;

  var NS = 'http://www.w3.org/2000/svg';
  var svg, stage, fullBox, current, center, anim, zoomed = false;

  fetch('images/marina-slip-map.svg')
    .then(function (r) { return r.text(); })
    .then(function (txt) {
      stage = document.createElement('div');
      stage.className = 'slip-stage';
      stage.innerHTML = txt;
      holder.insertBefore(stage, holder.firstChild);
      svg = stage.querySelector('svg');
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      fullBox = vb();
      addDefs();
      bindGestures();
      var q = new URLSearchParams(location.search).get('slip');
      if (q) { input.value = q; find(q, false); }
    })
    .catch(function () { svg = null; });

  function vb() { return svg.getAttribute('viewBox').split(/\s+/).map(Number); }

  function addDefs() {
    var defs = svg.querySelector('defs') || svg.insertBefore(document.createElementNS(NS, 'defs'), svg.firstChild);
    defs.insertAdjacentHTML('beforeend',
      '<radialGradient id="pinGrad" cx="35%" cy="30%" r="75%">' +
        '<stop offset="0" stop-color="#ff8a7a"/><stop offset=".45" stop-color="#e5322b"/><stop offset="1" stop-color="#8f0d14"/>' +
      '</radialGradient>' +
      '<radialGradient id="pinShadow"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>');
  }

  /* ---------- parsing & text ---------- */
  function parse(text) {
    var t = String(text || '').toUpperCase()
      .replace(/DOCK|SLIP|NUMBER|NO\.?|#/g, ' ')
      .replace(/[^A-Z0-9]/g, '');
    var m = t.match(/^([A-GZ])(?:0|O)([A-G])$/);
    if (m) return { dock: m[1], num: '0' + m[2] };
    m = t.match(/^([A-GZ])(\d{1,2})$/);
    if (m) return { dock: m[1], num: String(parseInt(m[2], 10)) };
    m = t.match(/^(\d{1,2})([A-GZ])$/);
    if (m) return { dock: m[2], num: String(parseInt(m[1], 10)) };
    return null;
  }
  function sideText(dock, num) {
    if (num.charAt(0) === '0' && num.length === 2) return 'at the head of the dock, near the Riverwalk';
    if (dock === 'Z') return 'off the Riverwalk next to the railroad bridge';
    if (dock === 'G') return 'on the river side of G Dock';
    return (parseInt(num, 10) % 2 === 0 ? 'on the west side' : 'on the east side') + ' of ' + dock + ' Dock';
  }

  /* ---------- view ---------- */
  function showDiagram(on) {
    holder.hidden = !on;
    photo.hidden = on;
    resetBtn.hidden = !on;
  }

  function animateTo(box, done) {
    if (anim) cancelAnimationFrame(anim);
    var from = vb(), t0 = performance.now(), dur = 650;
    function step(now) {
      var k = Math.min(1, (now - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      svg.setAttribute('viewBox', from.map(function (f, i) { return f + (box[i] - f) * e; }).join(' '));
      if (k < 1) anim = requestAnimationFrame(step); else if (done) done();
    }
    anim = requestAnimationFrame(step);
  }

  function slipBox() {
    var w = 620, h = w * fullBox[3] / fullBox[2];
    return clampBox([center.x - w / 2, center.y - h / 2, w, h]);
  }
  function clampBox(b) {
    b[0] = Math.max(fullBox[0], Math.min(b[0], fullBox[0] + fullBox[2] - b[2]));
    b[1] = Math.max(fullBox[1], Math.min(b[1], fullBox[1] + fullBox[3] - b[3]));
    return b;
  }

  function setZoom(on) {
    if (!current || zoomed === on) return;
    zoomed = on;
    holder.classList.toggle('zoomed', on);
    zoomBtn.innerHTML = on ? '&#8722; Whole marina' : '&#43; Zoom in';
    zoomBtn.setAttribute('aria-label', on ? 'Zoom out to the whole marina' : 'Zoom in to your slip');
    if (on) {
      hidePin();
      animateTo(slipBox(), showPulse);
    } else {
      hidePulse();
      animateTo(fullBox.slice(), dropPin);
    }
  }

  /* ---------- 3D pin ---------- */
  function pinSize() {
    var px = Math.max(44, Math.min(64, svg.clientWidth * 0.055));  // pin height on screen
    return (px / 60) * (vb()[2] / svg.clientWidth);                  // drawn 60 units tall
  }
  function dropPin() {
    hidePin();
    var k = pinSize();
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('id', 'slipPin3d');
    g.setAttribute('transform', 'translate(' + center.x + ' ' + center.y + ') scale(' + k + ')');
    g.innerHTML =
      '<ellipse class="pin-shadow" cx="7" cy="1" rx="13" ry="5" fill="url(#pinShadow)"/>' +
      '<g class="pin-drop"><g class="pin-bob">' +
        '<path d="M0,0 C-3,-12 -17,-24 -17,-39 A17,17 0 1 1 17,-39 C17,-24 3,-12 0,0 Z" fill="url(#pinGrad)" stroke="#6d0a10" stroke-width="1.2"/>' +
        '<circle cx="0" cy="-39" r="7.5" fill="#fff" stroke="#8f0d14" stroke-width="1"/>' +
        '<circle cx="0" cy="-39" r="3.2" fill="#0e2a4a"/>' +
        '<ellipse cx="-7" cy="-47" rx="4" ry="7" fill="#fff" opacity=".45" transform="rotate(-25 -7 -47)"/>' +
      '</g></g>';
    svg.appendChild(g);
  }
  function hidePin() { var p = svg && svg.querySelector('#slipPin3d'); if (p) p.remove(); }

  function showPulse() {
    hidePulse();
    var b = current.getBBox(), g = document.createElementNS(NS, 'g');
    g.setAttribute('id', 'slipPulse');
    g.innerHTML = '<circle class="pulse" cx="' + center.x + '" cy="' + center.y + '" r="18"/>' +
      '<circle class="pulse p2" cx="' + center.x + '" cy="' + center.y + '" r="18"/>' +
      '<circle class="ring" cx="' + center.x + '" cy="' + center.y + '" r="' + (Math.max(b.width, b.height) / 2 + 12) + '"/>';
    svg.appendChild(g);
  }
  function hidePulse() { var p = svg && svg.querySelector('#slipPulse'); if (p) p.remove(); }

  /* ---------- search ---------- */
  function clear() {
    if (!svg) return;
    svg.classList.remove('finding');
    if (current) current.classList.remove('hit');
    hidePin(); hidePulse();
    current = null; zoomed = false;
    holder.classList.remove('zoomed');
    svg.setAttribute('viewBox', fullBox.join(' '));
  }

  function find(text, scroll) {
    if (!svg) return;
    clear();
    var p = parse(text);
    var el = p && svg.querySelector('#slip-' + p.dock + '-' + p.num);
    if (!el) {
      info.className = 'slip-info error';
      info.innerHTML = p
        ? 'We couldn’t find slip <strong>' + p.num + '</strong> on <strong>' + p.dock + ' Dock</strong>. Please double-check your assignment or call the office at <a href="tel:+12526380318">(252) 638-0318</a>.'
        : 'Enter your dock letter and slip number, for example <strong>B23</strong> or <strong>A0A</strong>.';
      showDiagram(false);
      return;
    }
    current = el;
    el.classList.add('hit');
    svg.classList.add('finding');
    el.parentNode.appendChild(el);
    showDiagram(true);

    var b = el.getBBox();
    center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    zoomBtn.innerHTML = '&#43; Zoom in';
    dropPin();

    var size = el.getAttribute('data-size');
    var sizeTxt = el.getAttribute('data-dock') === 'G' && size === '60' ? "60'+" : size + "'";
    info.className = 'slip-info found';
    info.innerHTML = '<span class="slip-tag">' + p.dock + '-' + p.num + '</span>' +
      '<span><strong>' + p.dock + ' Dock, Slip ' + p.num + '</strong> · ' + sizeTxt + ' slip, ' + sideText(p.dock, p.num) + '.</span>';

    var url = new URL(location.href); url.searchParams.set('slip', p.dock + p.num);
    history.replaceState(null, '', url);
    if (scroll) holder.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- gestures: pinch, double-tap, drag to pan when zoomed ---------- */
  function bindGestures() {
    var pts = {}, startDist = 0, pinchDone = false, drag = null;
    function dist() {
      var a = Object.keys(pts).map(function (k) { return pts[k]; });
      return a.length < 2 ? 0 : Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    }
    stage.addEventListener('pointerdown', function (e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = Object.keys(pts).length;
      if (n === 2) { startDist = dist(); pinchDone = false; drag = null; }
      else if (n === 1 && zoomed) { drag = { x: e.clientX, y: e.clientY, box: vb() }; stage.setPointerCapture(e.pointerId); }
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pts).length === 2 && !pinchDone && startDist) {
        var r = dist() / startDist;
        if (r > 1.15) { pinchDone = true; setZoom(true); }
        else if (r < 0.87) { pinchDone = true; setZoom(false); }
      } else if (drag && zoomed) {
        var upp = drag.box[2] / svg.clientWidth, b = drag.box.slice();
        b[0] -= (e.clientX - drag.x) * upp; b[1] -= (e.clientY - drag.y) * upp;
        svg.setAttribute('viewBox', clampBox(b).join(' '));
      }
    });
    function up(e) { delete pts[e.pointerId]; if (Object.keys(pts).length < 2) startDist = 0; if (!Object.keys(pts).length) drag = null; }
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('dblclick', function () { setZoom(!zoomed); });
    stage.addEventListener('wheel', function (e) {
      if (!current || !(e.ctrlKey || e.metaKey)) return;   // trackpad pinch / ctrl+wheel
      e.preventDefault();
      setZoom(e.deltaY < 0);
    }, { passive: false });
    window.addEventListener('resize', function () { if (current && !zoomed) dropPin(); });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); find(input.value, true); });
  zoomBtn.addEventListener('click', function () { setZoom(!zoomed); });
  resetBtn.addEventListener('click', function () {
    clear(); input.value = ''; info.className = 'slip-info'; info.textContent = '';
    showDiagram(false);
    var url = new URL(location.href); url.searchParams.delete('slip'); history.replaceState(null, '', url);
  });
})();
