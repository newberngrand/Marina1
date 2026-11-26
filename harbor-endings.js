/* Harbor Hunt endings, shared by the chat game and the game against the computer.
   Win:  a big fuss. Fireworks and confetti, and a cartoon captain at the helm, cheered by the crew.
   Lose: the captain bobbing in the sea in a ring buoy.
   Drawn as layered SVG with gradients and shading for a rounded, 3D look; sounds come from
   harbor-sounds.js (fanfare and cheering, or a sad trombone). */
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var SND = window.HarborSounds || {};

  // Shared paint for both scenes.
  var DEFS = '<defs>' +
    '<radialGradient id="heSkin" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffe2c8"/><stop offset=".6" stop-color="#f4b48e"/><stop offset="1" stop-color="#d98a62"/></radialGradient>' +
    '<radialGradient id="heBeard" cx=".45" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#e6ecf2"/><stop offset="1" stop-color="#b9c4ce"/></radialGradient>' +
    '<linearGradient id="heCoat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2d5a8c"/><stop offset=".55" stop-color="#173a63"/><stop offset="1" stop-color="#0b2240"/></linearGradient>' +
    '<linearGradient id="heHatTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd8e0"/></linearGradient>' +
    '<linearGradient id="heBrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a3a"/><stop offset="1" stop-color="#0d0d0d"/></linearGradient>' +
    '<radialGradient id="heGold" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#fff3b8"/><stop offset=".5" stop-color="#e8b648"/><stop offset="1" stop-color="#9a6d14"/></radialGradient>' +
    '<linearGradient id="heWood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d79a5a"/><stop offset=".5" stop-color="#9c5f2b"/><stop offset="1" stop-color="#5e3514"/></linearGradient>' +
    '<linearGradient id="heDeck" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c58a50"/><stop offset="1" stop-color="#7a4a22"/></linearGradient>' +
    '<linearGradient id="heSkyWin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f8fd0"/><stop offset=".7" stop-color="#9fd3f2"/><stop offset="1" stop-color="#e9f7ff"/></linearGradient>' +
    '<linearGradient id="heSkyLose" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f7f8f"/><stop offset="1" stop-color="#b9c6d1"/></linearGradient>' +
    '<linearGradient id="heSea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b97b8"/><stop offset=".6" stop-color="#1f6c8c"/><stop offset="1" stop-color="#0e3f57"/></linearGradient>' +
    '<linearGradient id="heStripe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d7e0e8"/></linearGradient>' +
    '<pattern id="heStripes" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="url(#heStripe)"/><rect width="10" height="4" fill="#1d4f8a"/></pattern>' +
    '<radialGradient id="heRingRed" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#ff7a63"/><stop offset=".6" stop-color="#d9321f"/><stop offset="1" stop-color="#8a160a"/></radialGradient>' +
    '<radialGradient id="heRingWhite" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#e9eef2"/><stop offset="1" stop-color="#a9b6c2"/></radialGradient>' +
    '<radialGradient id="heShine" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="rgba(255,255,255,.9)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient>' +
    '<filter id="heShadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#06223a" flood-opacity=".4"/></filter>' +
    '</defs>';

  function hat(x, y, s, tilt) {
    return '<g transform="translate(' + x + ',' + y + ') rotate(' + (tilt || 0) + ') scale(' + s + ')">' +
      '<ellipse cx="0" cy="-6" rx="44" ry="18" fill="url(#heHatTop)" stroke="#9aa7b3" stroke-width="1.5"/>' +
      '<path d="M-38,-2 Q0,10 38,-2 L36,8 Q0,20 -36,8 Z" fill="#14325a"/>' +
      '<path d="M-30,8 Q0,30 30,8 Q0,18 -30,8 Z" fill="url(#heBrim)"/>' +
      '<path d="M-24,4 Q0,13 24,4" stroke="url(#heGold)" stroke-width="3" fill="none"/>' +
      '<circle cx="0" cy="1" r="7" fill="url(#heGold)"/><path d="M0,-3 V5 M-3,1 H3 M-4,4 Q0,8 4,4" stroke="#7a4f0e" stroke-width="1.4" fill="none"/>' +
      '</g>';
  }
  function captainHead(happy) {
    return '<g class="he-head">' +
      '<circle cx="0" cy="0" r="34" fill="url(#heSkin)"/>' +
      '<ellipse cx="-34" cy="2" rx="7" ry="10" fill="url(#heSkin)"/><ellipse cx="34" cy="2" rx="7" ry="10" fill="url(#heSkin)"/>' +
      '<path d="M-33,4 Q-36,44 0,50 Q36,44 33,4 Q26,22 0,24 Q-26,22 -33,4 Z" fill="url(#heBeard)"/>' +
      (happy
        ? '<path d="M-17,-6 Q-11,-13 -5,-6" stroke="#2b1a10" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M5,-6 Q11,-13 17,-6" stroke="#2b1a10" stroke-width="3.2" fill="none" stroke-linecap="round"/>'
        : '<ellipse cx="-11" cy="-6" rx="4" ry="5" fill="#2b1a10"/><ellipse cx="11" cy="-6" rx="4" ry="5" fill="#2b1a10"/><circle cx="-10" cy="-8" r="1.4" fill="#fff"/><circle cx="12" cy="-8" r="1.4" fill="#fff"/>' +
          '<path d="M-18,-13 Q-12,-16 -5,-19 M18,-13 Q12,-16 5,-19" stroke="#e8ecef" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M-21,-2 Q-23,6 -20,9 Q-17,6 -21,-2 Z" fill="#9fd8f2"/>') +
      '<ellipse cx="-19" cy="8" rx="7" ry="4.5" fill="#ff8a7a" opacity=".55"/><ellipse cx="19" cy="8" rx="7" ry="4.5" fill="#ff8a7a" opacity=".55"/>' +
      '<ellipse cx="0" cy="4" rx="7" ry="6" fill="#f0a07a"/><ellipse cx="-2" cy="2" rx="2.5" ry="2" fill="#ffd9c0"/>' +
      '<path d="M-20,15 Q-10,8 0,14 Q10,8 20,15 Q10,18 0,16 Q-10,18 -20,15 Z" fill="#f4f7fa" stroke="#c9d2da" stroke-width="1"/>' +
      (happy ? '<path d="M-11,22 Q0,36 11,22 Z" fill="#7a1f1f"/><path d="M-8,24 Q0,29 8,24" fill="#fff"/>'
             : '<path d="M-9,28 Q0,22 9,28" stroke="#5a2a1a" stroke-width="3" fill="none" stroke-linecap="round"/>') +
      '</g>';
  }
  function sailor(x, y, s, flip, cls) {
    return '<g class="he-sailor ' + (cls || '') + '" transform="translate(' + x + ',' + y + ') scale(' + (flip ? -s : s) + ',' + s + ')">' +
      '<ellipse cx="0" cy="62" rx="24" ry="6" fill="rgba(0,0,0,.25)"/>' +
      '<path d="M-20,58 L-16,20 Q0,12 16,20 L20,58 Z" fill="#20314a"/>' +
      '<path d="M-22,24 Q0,10 22,24 L18,46 Q0,52 -18,46 Z" fill="url(#heStripes)" stroke="#1d4f8a" stroke-width="1"/>' +
      '<path d="M-10,14 L0,26 L10,14 Z" fill="#1d4f8a"/>' +
      '<g class="he-arm-l"><path d="M-18,24 Q-34,6 -30,-16" stroke="url(#heStripes)" stroke-width="10" fill="none" stroke-linecap="round"/><circle cx="-30" cy="-18" r="7" fill="url(#heSkin)"/></g>' +
      '<g class="he-arm-r"><path d="M18,24 Q34,6 30,-16" stroke="url(#heStripes)" stroke-width="10" fill="none" stroke-linecap="round"/><circle cx="30" cy="-18" r="7" fill="url(#heSkin)"/></g>' +
      '<circle cx="0" cy="0" r="17" fill="url(#heSkin)"/>' +
      '<path d="M-7,-3 Q-4,-7 -1,-3 M1,-3 Q4,-7 7,-3" stroke="#2b1a10" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="0" cy="8" rx="6" ry="5" fill="#7a1f1f"/><ellipse cx="-10" cy="4" rx="4" ry="2.5" fill="#ff8a7a" opacity=".5"/><ellipse cx="10" cy="4" rx="4" ry="2.5" fill="#ff8a7a" opacity=".5"/>' +
      '<ellipse cx="0" cy="-13" rx="17" ry="7" fill="url(#heHatTop)" stroke="#9aa7b3" stroke-width="1"/><rect x="-15" y="-13" width="30" height="5" rx="2" fill="#1d4f8a"/>' +
      '</g>';
  }
  function winScene() {
    var rays = '';
    for (var k = 0; k < 12; k++) rays += '<path d="M200,95 L' + (200 + Math.cos(k * Math.PI / 6) * 360) + ',' + (95 + Math.sin(k * Math.PI / 6) * 360) + ' L' + (200 + Math.cos(k * Math.PI / 6 + 0.13) * 360) + ',' + (95 + Math.sin(k * Math.PI / 6 + 0.13) * 360) + ' Z" fill="rgba(255,255,255,.18)"/>';
    var spokes = '';
    for (var j = 0; j < 8; j++) {
      var a = j * Math.PI / 4, x1 = Math.cos(a) * 12, y1 = Math.sin(a) * 12, x2 = Math.cos(a) * 52, y2 = Math.sin(a) * 52, x3 = Math.cos(a) * 64, y3 = Math.sin(a) * 64;
      spokes += '<path d="M' + x1 + ',' + y1 + ' L' + x3 + ',' + y3 + '" stroke="url(#heWood)" stroke-width="7" stroke-linecap="round"/><circle cx="' + x3 + '" cy="' + y3 + '" r="6.5" fill="url(#heWood)" stroke="#4a2a10" stroke-width="1"/>';
      if (j === 0) spokes += '<circle cx="' + x2 + '" cy="' + y2 + '" r="0" />';
    }
    return '<svg class="he-scene" viewBox="0 0 400 300" aria-hidden="true">' + DEFS +
      '<rect width="400" height="300" fill="url(#heSkyWin)"/>' +
      '<g class="he-rays">' + rays + '</g>' +
      '<circle cx="200" cy="95" r="26" fill="#fff6c8"/><circle cx="200" cy="95" r="40" fill="url(#heShine)"/>' +
      '<rect y="168" width="400" height="60" fill="url(#heSea)"/>' +
      '<path class="he-wave" d="M-40,176 Q-20,170 0,176 T40,176 T80,176 T120,176 T160,176 T200,176 T240,176 T280,176 T320,176 T360,176 T400,176 T440,176" stroke="rgba(255,255,255,.6)" stroke-width="2" fill="none"/>' +
      // Railing and deck
      '<rect x="0" y="196" width="400" height="10" fill="url(#heWood)"/>' +
      '<g fill="url(#heWood)">' + [20, 70, 120, 280, 330, 380].map(function (x) { return '<rect x="' + (x - 4) + '" y="200" width="8" height="34" rx="3"/>'; }).join('') + '</g>' +
      '<path d="M0,226 L400,226 L400,300 L0,300 Z" fill="url(#heDeck)"/>' +
      '<path d="M0,246 H400 M0,268 H400 M0,290 H400" stroke="rgba(60,30,10,.35)" stroke-width="2"/>' +
      // Crew cheering on both sides
      sailor(60, 200, 0.95, false, 'c1') + sailor(118, 214, 0.8, true, 'c2') + sailor(342, 200, 0.95, true, 'c3') + sailor(284, 214, 0.8, false, 'c4') +
      // The captain behind the wheel
      '<g class="he-captain" filter="url(#heShadow)">' +
        '<path d="M-46,120 L-40,58 Q0,40 40,58 L46,120 Z" fill="url(#heCoat)" transform="translate(200,150)"/>' +
        '<g transform="translate(200,150)"><path d="M-14,44 L0,70 L14,44 Z" fill="#f4f7fa"/><path d="M-4,50 L0,64 L4,50 Z" fill="#c0392b"/>' +
          '<circle cx="-10" cy="80" r="3.5" fill="url(#heGold)"/><circle cx="10" cy="80" r="3.5" fill="url(#heGold)"/><circle cx="-10" cy="96" r="3.5" fill="url(#heGold)"/><circle cx="10" cy="96" r="3.5" fill="url(#heGold)"/>' +
          '<path d="M-44,58 Q-56,52 -50,46 L-34,52 Z" fill="url(#heGold)"/><path d="M44,58 Q56,52 50,46 L34,52 Z" fill="url(#heGold)"/></g>' +
        '<g transform="translate(200,150)">' + captainHead(true) + '</g>' + hat(200, 118, 1, -6) +
        '<g class="he-wave-arm"><path d="M240,200 Q272,170 268,128" stroke="url(#heCoat)" stroke-width="15" fill="none" stroke-linecap="round"/><circle cx="268" cy="124" r="9" fill="url(#heSkin)"/></g>' +
      '</g>' +
      '<g class="he-wheel" transform="translate(200,236)">' + spokes +
        '<circle r="52" fill="none" stroke="url(#heWood)" stroke-width="9"/><circle r="52" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2" stroke-dasharray="20 300"/>' +
        '<circle r="13" fill="url(#heGold)" stroke="#7a4f0e" stroke-width="1.5"/><circle r="5" fill="#7a4f0e"/></g>' +
      '<path d="M168,236 Q160,220 158,208" stroke="url(#heCoat)" stroke-width="15" fill="none" stroke-linecap="round"/><circle cx="168" cy="238" r="9" fill="url(#heSkin)"/>' +
      '</svg>';
  }
  function loseScene() {
    var ring = '';
    for (var k = 0; k < 8; k++) {
      var a0 = k * Math.PI / 4, a1 = a0 + Math.PI / 4, R = 62, r = 36;
      var p = 'M' + (Math.cos(a0) * R) + ',' + (Math.sin(a0) * R * 0.42) + ' A' + R + ',' + (R * 0.42) + ' 0 0 1 ' + (Math.cos(a1) * R) + ',' + (Math.sin(a1) * R * 0.42) +
        ' L' + (Math.cos(a1) * r) + ',' + (Math.sin(a1) * r * 0.42) + ' A' + r + ',' + (r * 0.42) + ' 0 0 0 ' + (Math.cos(a0) * r) + ',' + (Math.sin(a0) * r * 0.42) + ' Z';
      ring += '<path d="' + p + '" fill="url(#' + (k % 2 ? 'heRingWhite' : 'heRingRed') + ')"/>';
    }
    var ringThick = ring.replace(/<path /g, '<path transform="translate(0,9)" opacity=".55" ');
    return '<svg class="he-scene" viewBox="0 0 400 300" aria-hidden="true">' + DEFS +
      '<rect width="400" height="300" fill="url(#heSkyLose)"/>' +
      '<g fill="rgba(255,255,255,.75)"><ellipse cx="80" cy="60" rx="50" ry="18"/><ellipse cx="115" cy="52" rx="34" ry="16"/><ellipse cx="310" cy="80" rx="58" ry="20"/><ellipse cx="350" cy="70" rx="34" ry="15"/></g>' +
      '<rect y="130" width="400" height="170" fill="url(#heSea)"/>' +
      '<path class="he-wave w1" d="M-60,150 Q-30,140 0,150 T60,150 T120,150 T180,150 T240,150 T300,150 T360,150 T420,150 T480,150 V300 H-60 Z" fill="rgba(255,255,255,.12)"/>' +
      // The captain's hat drifting away
      '<g class="he-drift">' + hat(318, 214, 0.55, 24) + '</g>' +
      // Captain in the ring buoy, bobbing
      '<g class="he-bob" transform="translate(190,210)">' +
        '<ellipse cx="0" cy="18" rx="80" ry="18" fill="rgba(5,30,45,.35)"/>' +
        '<g transform="translate(0,6)">' + ringThick + '</g>' +
        '<path d="M-34,10 Q-30,-40 0,-44 Q30,-40 34,10 Z" fill="url(#heCoat)"/>' +
        '<path d="M-10,-40 L0,-26 L10,-40 Z" fill="#f4f7fa"/>' +
        '<g transform="translate(0,-74) rotate(-6)">' + captainHead(false) + '</g>' +
        '<g transform="translate(-8,-112)"><path d="M-18,-2 Q-6,-14 6,-4 Q16,-14 22,-2" stroke="#e8ecef" stroke-width="4" fill="none" stroke-linecap="round"/></g>' +
        '<g transform="translate(0,6)">' + ring + '<ellipse cx="-30" cy="-16" rx="18" ry="5" fill="url(#heShine)" opacity=".8"/>' +
          '<path d="M-62,0 A62,26 0 0 0 62,0" fill="none" stroke="#f0e6c8" stroke-width="2" stroke-dasharray="6 5"/></g>' +
        '<path d="M-44,-6 Q-62,-2 -66,14" stroke="url(#heCoat)" stroke-width="13" fill="none" stroke-linecap="round"/><circle cx="-66" cy="16" r="8" fill="url(#heSkin)"/>' +
        '<path d="M44,-6 Q62,-2 66,14" stroke="url(#heCoat)" stroke-width="13" fill="none" stroke-linecap="round"/><circle cx="66" cy="16" r="8" fill="url(#heSkin)"/>' +
        '<g class="he-drip"><circle cx="-26" cy="-60" r="3" fill="#bfe6f7"/><circle cx="30" cy="-52" r="2.4" fill="#bfe6f7"/></g>' +
      '</g>' +
      '<path class="he-wave w2" d="M-60,236 Q-30,226 0,236 T60,236 T120,236 T180,236 T240,236 T300,236 T360,236 T420,236 T480,236 V300 H-60 Z" fill="rgba(20,90,120,.55)"/>' +
      '<path class="he-wave w3" d="M-60,262 Q-30,252 0,262 T60,262 T120,262 T180,262 T240,262 T300,262 T360,262 T420,262 T480,262 V300 H-60 Z" fill="rgba(12,60,85,.6)"/>' +
      '</svg>';
  }

  function show(o) {
    var old = document.getElementById('heOverlay');
    if (old) old.remove();
    var confetti = '';
    if (o.won) {
      var colors = ['#e8b648', '#d9321f', '#1d4f8a', '#2fae6a', '#ffffff', '#7a4fd0', '#ff8a3d'];
      for (var k = 0; k < 70; k++) {
        confetti += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + colors[k % colors.length] + ';--dx:' + (Math.random() * 120 - 60).toFixed(0) + 'px;--r:' + (Math.random() * 720 - 360).toFixed(0) +
          'deg;animation-delay:' + (Math.random() * 2.5).toFixed(2) + 's;animation-duration:' + (2.6 + Math.random() * 2).toFixed(2) + 's;width:' + (6 + Math.random() * 6).toFixed(0) + 'px"></i>';
      }
      for (var f = 0; f < 6; f++) {
        confetti += '<b class="he-fw" style="left:' + (10 + Math.random() * 80).toFixed(0) + '%;top:' + (8 + Math.random() * 35).toFixed(0) + '%;--c:' + colors[f % colors.length] + ';animation-delay:' + (f * 0.55).toFixed(2) + 's">' +
          new Array(13).join('<s></s>') + '</b>';
      }
    }
    var div = document.createElement('div');
    div.id = 'heOverlay';
    div.className = 'he-overlay ' + (o.won ? 'win' : 'lose');
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-modal', 'true');
    div.setAttribute('aria-label', o.title || (o.won ? 'You won' : 'You lost'));
    div.innerHTML = '<div class="he-fx" aria-hidden="true">' + confetti + '</div>' +
      '<div class="he-card">' + (o.won ? winScene() : loseScene()) +
        '<h2 class="he-title">' + esc(o.title || (o.won ? 'Victory, Captain!' : 'Man overboard!')) + '</h2>' +
        (o.text ? '<p class="he-text">' + esc(o.text) + '</p>' : '') +
        '<div class="he-btns"><button type="button" class="btn btn-gold" data-he="close">' + esc(o.button || 'Continue') + '</button></div></div>';
    document.body.appendChild(div);
    div.querySelector('[data-he="close"]').focus();
    function close() { div.classList.add('out'); setTimeout(function () { div.remove(); }, 300); if (o.onClose) o.onClose(); }
    div.addEventListener('click', function (e) { if (e.target === div || e.target.getAttribute('data-he') === 'close') close(); });
    document.addEventListener('keydown', function esc2(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', esc2); if (document.body.contains(div)) close(); } });
    if (o.won) { if (SND.fanfare) SND.fanfare(); if (SND.cheer) setTimeout(SND.cheer, 400); }
    else if (SND.trombone) SND.trombone();
  }

  window.HarborEndings = { show: show };
})();
