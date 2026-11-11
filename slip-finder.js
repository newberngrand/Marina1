/* Slip finder: type a dock + slip (e.g. "B23", "A-0A") to highlight it on the slip map. */
(function () {
  var holder = document.getElementById('slipMap');
  var form = document.getElementById('slipForm');
  var input = document.getElementById('slipInput');
  var info = document.getElementById('slipInfo');
  var resetBtn = document.getElementById('slipReset');
  var photo = document.getElementById('mapPhoto');
  if (!holder || !form) return;

  var svg, fullBox, current, anim;

  fetch('images/marina-slip-map.svg')
    .then(function (r) { return r.text(); })
    .then(function (txt) {
      holder.innerHTML = txt;
      svg = holder.querySelector('svg');
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      var q = new URLSearchParams(location.search).get('slip');
      if (q) { input.value = q; find(q, false); }
    })
    .catch(function () {
      svg = null;
    });

  function parse(text) {
    var t = String(text || '').toUpperCase()
      .replace(/DOCK|SLIP|NUMBER|NO\.?|#/g, ' ')
      .replace(/[^A-Z0-9]/g, '');
    var m = t.match(/^([A-GZ])(?:0|O)([A-G])$/);          // head-of-dock slips like A0A / AOA
    if (m) return { dock: m[1], num: '0' + m[2] };
    m = t.match(/^([A-GZ])(\d{1,2})$/);
    if (m) return { dock: m[1], num: String(parseInt(m[2], 10)) };
    m = t.match(/^(\d{1,2})([A-GZ])$/);                     // "23B"
    if (m) return { dock: m[2], num: String(parseInt(m[1], 10)) };
    return null;
  }

  function sideText(dock, num) {
    if (num.charAt(0) === '0' && num.length === 2) return 'at the head of the dock, near the Riverwalk';
    if (dock === 'Z') return 'off the Riverwalk next to the railroad bridge';
    if (dock === 'G') return 'on the river side of G Dock';
    return (parseInt(num, 10) % 2 === 0 ? 'on the west side' : 'on the east side') + ' of ' + dock + ' Dock';
  }

  function showDiagram(on) {
    holder.hidden = !on;
    photo.hidden = on;
    resetBtn.hidden = !on;
  }

  function clear() {
    if (!svg) return;
    svg.classList.remove('finding');
    if (current) current.classList.remove('hit');
    var old = svg.querySelector('#slipPin'); if (old) old.remove();
    current = null;
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
    el.parentNode.appendChild(el);  // draw on top

    var b = el.getBBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    var pin = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pin.setAttribute('id', 'slipPin');
    pin.innerHTML = '<circle class="pulse" cx="' + cx + '" cy="' + cy + '" r="18"/>' +
      '<circle class="pulse p2" cx="' + cx + '" cy="' + cy + '" r="18"/>' +
      '<circle class="ring" cx="' + cx + '" cy="' + cy + '" r="' + (Math.max(b.width, b.height) / 2 + 14) + '"/>';
    svg.appendChild(pin);
    showDiagram(true);

    var size = el.getAttribute('data-size');
    var sizeTxt = el.getAttribute('data-dock') === 'G' && size === '60' ? "60'+" : size + "'";
    info.className = 'slip-info found';
    info.innerHTML = '<span class="slip-tag">' + p.dock + '-' + p.num + '</span>' +
      '<span><strong>' + p.dock + ' Dock, Slip ' + p.num + '</strong> · ' + sizeTxt + ' slip, ' + sideText(p.dock, p.num) + '.</span>';

    var url = new URL(location.href); url.searchParams.set('slip', p.dock + p.num);
    history.replaceState(null, '', url);
    if (scroll) holder.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); find(input.value, true); });
  resetBtn.addEventListener('click', function () {
    clear(); input.value = ''; info.className = 'slip-info'; info.textContent = '';
    showDiagram(false);
    var url = new URL(location.href); url.searchParams.delete('slip'); history.replaceState(null, '', url);
  });
})();
