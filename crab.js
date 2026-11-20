/* Angry crab: climbs out of a spot on the page, thrashes its claws at the player in 3D, then scuttles back down.
   Usage: AngryCrab.show(domRect, { sound: true }).then(...)  (tap anywhere to send it away early).
   The crab is built from flat layers (legs, shell, eye stalks, claws) stacked at different depths inside a
   3D scene, so as it twists the claws and eyes swing out in front of the shell. */
(function () {
  'use strict';
  var css = [
    '.crab-shade{position:fixed;inset:0;z-index:400;background:radial-gradient(circle at 50% 50%,rgba(120,20,10,.25),rgba(7,24,41,.82));opacity:0;transition:opacity .35s;cursor:pointer}',
    '.crab-shade.on{opacity:1}',
    '.crab-scene{position:fixed;left:0;top:0;width:300px;height:250px;margin:-125px 0 0 -150px;z-index:401;perspective:900px;pointer-events:none}',
    '.crab-rig{position:absolute;inset:0;transform-style:preserve-3d;will-change:transform}',
    '.crab-sway{position:absolute;inset:0;transform-style:preserve-3d;animation:crab-sway .9s ease-in-out infinite alternate}',
    '.crab-bob{position:absolute;inset:0;transform-style:preserve-3d;animation:crab-bob .26s ease-in-out infinite alternate}',
    '.crab-layer{position:absolute;left:0;top:0;width:300px;height:250px;overflow:visible}',
    '.crab-legs{transform:translateZ(-30px)}',
    '.crab-body{transform:translateZ(0)}',
    '.crab-eyes{transform:translateZ(28px)}',
    '.crab-claw-l{transform:translateZ(55px)}',
    '.crab-claw-r{transform:translateZ(55px) scaleX(-1)}',
    '.crab-shadow{position:absolute;left:60px;top:205px;width:180px;height:34px;border-radius:50%;background:radial-gradient(rgba(0,0,0,.45),rgba(0,0,0,0) 70%);transform:translateZ(-60px) rotateX(70deg)}',
    '.crab-layer g{transform-box:view-box}',
    '.crab-arm{transform-origin:96px 150px;animation:crab-arm .23s ease-in-out infinite alternate}',
    '.crab-claw-r .crab-arm{animation-duration:.29s;animation-delay:-.1s}',
    '.crab-jaw{transform-origin:52px 74px;animation:crab-jaw .11s ease-in-out infinite alternate}',
    '.crab-claw-r .crab-jaw{animation-duration:.14s}',
    '.crab-leg{animation:crab-leg .14s ease-in-out infinite alternate}',
    '.crab-leg:nth-child(2n){animation-delay:-.07s}',
    '.crab-stalk-l{transform-origin:132px 118px;animation:crab-stalk .33s ease-in-out infinite alternate}',
    '.crab-stalk-r{transform-origin:168px 118px;animation:crab-stalk .29s ease-in-out infinite alternate-reverse}',
    '.crab-shell{animation:crab-shake .07s linear infinite alternate}',
    '.crab-mouth{transform-origin:150px 172px;animation:crab-mouth .18s ease-in-out infinite alternate}',
    '.crab-snap{position:fixed;z-index:402;font:900 22px/1 "Arial Black",Arial,sans-serif;color:#fff;-webkit-text-stroke:1.5px #8f0d14;text-shadow:0 3px 0 #8f0d14;pointer-events:none;animation:crab-snap .55s ease-out forwards}',
    '.crab-drop{position:fixed;z-index:402;width:9px;height:12px;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;background:#9fd3ea;box-shadow:inset -2px -2px 0 rgba(0,0,0,.12);pointer-events:none}',
    '@keyframes crab-sway{from{transform:rotateY(-24deg) rotateZ(-5deg)}to{transform:rotateY(24deg) rotateZ(5deg)}}',
    '@keyframes crab-bob{from{transform:translateY(0)}to{transform:translateY(-9px)}}',
    '@keyframes crab-arm{from{transform:rotate(-24deg)}to{transform:rotate(22deg)}}',
    '@keyframes crab-jaw{from{transform:rotate(0)}to{transform:rotate(-34deg)}}',
    '@keyframes crab-leg{from{transform:rotate(-7deg)}to{transform:rotate(7deg)}}',
    '@keyframes crab-stalk{from{transform:rotate(-12deg)}to{transform:rotate(10deg)}}',
    '@keyframes crab-shake{from{transform:translate(-1px,.5px)}to{transform:translate(1px,-.5px)}}',
    '@keyframes crab-mouth{from{transform:scaleY(1)}to{transform:scaleY(.55)}}',
    '@keyframes crab-snap{0%{transform:translate(-50%,-50%) scale(.3) rotate(var(--r));opacity:0}25%{transform:translate(-50%,-50%) scale(1.25) rotate(var(--r));opacity:1}100%{transform:translate(-50%,-110%) scale(1) rotate(var(--r));opacity:0}}',
    '@media (prefers-reduced-motion:reduce){.crab-sway,.crab-bob,.crab-arm,.crab-jaw,.crab-leg,.crab-stalk-l,.crab-stalk-r,.crab-shell,.crab-mouth{animation:none}}'
  ].join('\n');

  var DEFS = '<defs>' +
    '<radialGradient id="crabShell" cx="42%" cy="30%" r="75%"><stop offset="0" stop-color="#ffb08a"/><stop offset=".35" stop-color="#f0552e"/><stop offset=".8" stop-color="#b5260f"/><stop offset="1" stop-color="#6e1206"/></radialGradient>' +
    '<radialGradient id="crabLimb" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#ff9a73"/><stop offset=".5" stop-color="#e2461f"/><stop offset="1" stop-color="#8a1a08"/></radialGradient>' +
    '<radialGradient id="crabEye" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset=".8" stop-color="#e9edf2"/><stop offset="1" stop-color="#9aa6b2"/></radialGradient>' +
    '</defs>';

  function svg(cls, inner) {
    return '<svg class="crab-layer ' + cls + '" viewBox="0 0 300 250" xmlns="http://www.w3.org/2000/svg">' + DEFS + inner + '</svg>';
  }

  // Four jointed legs on each side, hinged where they meet the shell.
  function legs() {
    var out = '';
    [[-1, 0], [1, 0]].forEach(function (sd) {
      var dir = sd[0];
      for (var i = 0; i < 4; i++) {
        var hx = 150 + dir * (52 + i * 6), hy = 150 + i * 13;
        var kx = 150 + dir * (88 + i * 8), ky = 132 + i * 20;
        var fx = 150 + dir * (112 + i * 6), fy = 182 + i * 14;
        out += '<g class="crab-leg" style="transform-origin:' + hx + 'px ' + hy + 'px">' +
          '<path d="M' + hx + ' ' + hy + ' L' + kx + ' ' + ky + ' L' + fx + ' ' + fy + '" fill="none" stroke="#7a1606" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<path d="M' + hx + ' ' + hy + ' L' + kx + ' ' + ky + ' L' + fx + ' ' + fy + '" fill="none" stroke="url(#crabLimb)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</g>';
      }
    });
    return out;
  }

  function body() {
    return '<g class="crab-shell">' +
      '<ellipse cx="150" cy="152" rx="74" ry="50" fill="url(#crabShell)" stroke="#5e0f05" stroke-width="2.5"/>' +
      // spiky rim
      '<path d="M78 140 l-9 -6 l11 -2 M222 140 l9 -6 l-11 -2 M84 124 l-7 -9 l11 2 M216 124 l7 -9 l-11 2" fill="#b5260f" stroke="#5e0f05" stroke-width="1.5" stroke-linejoin="round"/>' +
      // shell highlights and spots
      '<ellipse cx="128" cy="128" rx="30" ry="12" fill="#fff" opacity=".28" transform="rotate(-14 128 128)"/>' +
      '<circle cx="176" cy="138" r="5" fill="#8f1d0a" opacity=".55"/><circle cx="190" cy="154" r="3.5" fill="#8f1d0a" opacity=".55"/><circle cx="112" cy="160" r="4" fill="#8f1d0a" opacity=".5"/>' +
      // angry mouth with teeth
      '<g class="crab-mouth"><path d="M126 176 Q150 158 174 176 Q150 188 126 176 Z" fill="#3a0802" stroke="#5e0f05" stroke-width="2"/>' +
      '<path d="M132 172 l4 6 l4 -7 l4 6 l4 -7 l4 7 l4 -6 l4 7 l4 -6" fill="#fff" stroke="#fff" stroke-width="1" stroke-linejoin="round"/></g>' +
      // steam puffs of rage
      '<g opacity=".85" fill="#fff"><circle cx="96" cy="104" r="5"><animate attributeName="cy" values="110;84" dur=".7s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur=".7s" repeatCount="indefinite"/></circle>' +
      '<circle cx="204" cy="104" r="5"><animate attributeName="cy" values="110;84" dur=".7s" begin=".35s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur=".7s" begin=".35s" repeatCount="indefinite"/></circle></g>' +
      '</g>';
  }

  function eye(cls, bx, ex, browTilt) {
    return '<g class="' + cls + '">' +
      '<path d="M' + bx + ' 118 Q' + ((bx + ex) / 2) + ' 100 ' + ex + ' 78" fill="none" stroke="#7a1606" stroke-width="9" stroke-linecap="round"/>' +
      '<path d="M' + bx + ' 118 Q' + ((bx + ex) / 2) + ' 100 ' + ex + ' 78" fill="none" stroke="url(#crabLimb)" stroke-width="6" stroke-linecap="round"/>' +
      '<circle cx="' + ex + '" cy="70" r="14" fill="url(#crabEye)" stroke="#5e0f05" stroke-width="2"/>' +
      '<circle cx="' + (ex + (ex < 150 ? 4 : -4)) + '" cy="73" r="6.5" fill="#1c0a05"><animate attributeName="r" values="6.5;5;6.5" dur=".5s" repeatCount="indefinite"/></circle>' +
      '<circle cx="' + (ex + (ex < 150 ? 2 : -6)) + '" cy="70" r="2" fill="#fff"/>' +
      '<path d="M' + (ex - 16) + ' ' + (58 - browTilt) + ' L' + (ex + 16) + ' ' + (58 + browTilt) + '" stroke="#3a0802" stroke-width="6" stroke-linecap="round"/>' +
      '</g>';
  }

  // One big claw (drawn on the left; the right one is the same picture mirrored). The arm swings at the
  // shoulder and the upper jaw snaps open and shut.
  function claw() {
    return '<g class="crab-arm">' +
      '<path d="M96 150 Q70 138 64 108" fill="none" stroke="#7a1606" stroke-width="16" stroke-linecap="round"/>' +
      '<path d="M96 150 Q70 138 64 108" fill="none" stroke="url(#crabLimb)" stroke-width="12" stroke-linecap="round"/>' +
      // palm and fixed lower jaw
      '<path d="M44 108 Q30 96 34 74 Q38 62 52 74 Q70 86 78 104 Q70 120 44 108 Z" fill="url(#crabShell)" stroke="#5e0f05" stroke-width="2.5"/>' +
      '<path d="M34 74 Q20 70 14 52 Q30 56 42 70" fill="url(#crabShell)" stroke="#5e0f05" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<path d="M20 58 l5 2 M27 64 l5 1" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
      // snapping upper jaw
      '<g class="crab-jaw"><path d="M52 74 Q44 46 22 30 Q48 34 62 56 Q66 66 52 74 Z" fill="url(#crabShell)" stroke="#5e0f05" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<path d="M30 38 l3 5 M38 44 l2 5 M46 52 l1 5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g>' +
      '<ellipse cx="50" cy="92" rx="10" ry="5" fill="#fff" opacity=".3" transform="rotate(-30 50 92)"/>' +
      '</g>';
  }

  var styled = false, ac = null;
  function addStyle() {
    if (styled) return;
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
    styled = true;
  }

  // Clacking claws and a grumble, made with the Web Audio API.
  function sound(ms) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      var t0 = ac.currentTime, end = t0 + ms / 1000;
      var growl = ac.createOscillator(), gg = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      growl.type = 'sawtooth'; growl.frequency.value = 95;
      lfo.frequency.value = 9; lg.gain.value = 25; lfo.connect(lg).connect(growl.frequency);
      gg.gain.setValueAtTime(.0001, t0); gg.gain.exponentialRampToValueAtTime(.09, t0 + .15); gg.gain.setValueAtTime(.09, end - .3); gg.gain.exponentialRampToValueAtTime(.0001, end);
      growl.connect(gg).connect(ac.destination); growl.start(t0); lfo.start(t0); growl.stop(end); lfo.stop(end);
      for (var t = t0 + .5; t < end - .2; t += .13 + Math.random() * .12) {
        var n = ac.createBufferSource(), buf = ac.createBuffer(1, 900, ac.sampleRate), d = buf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
        n.buffer = buf;
        var f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500 + Math.random() * 1500; f.Q.value = 2;
        var g = ac.createGain(); g.gain.value = .6;
        n.connect(f).connect(g).connect(ac.destination); n.start(t);
      }
    } catch (e) { /* no sound available */ }
  }

  function splash(x, y) {
    for (var i = 0; i < 14; i++) {
      var d = document.createElement('div');
      d.className = 'crab-drop';
      d.style.left = x + 'px'; d.style.top = y + 'px';
      document.body.appendChild(d);
      var a = -Math.PI / 2 + (Math.random() - .5) * 2.2, v = 60 + Math.random() * 90;
      d.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + Math.cos(a) * v + 'px), calc(-50% + ' + (Math.sin(a) * v) + 'px)) scale(.9)', opacity: 1, offset: .5 },
        { transform: 'translate(calc(-50% + ' + Math.cos(a) * v * 1.4 + 'px), calc(-50% + ' + (Math.sin(a) * v + 120) + 'px)) scale(.6)', opacity: 0 }
      ], { duration: 700 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = function () { this.effect.target.remove(); };
    }
  }

  function snapWord(x, y) {
    var words = ['SNAP!', 'CLACK!', 'PINCH!', 'SNIP!'];
    var w = document.createElement('div');
    w.className = 'crab-snap';
    w.textContent = words[Math.floor(Math.random() * words.length)];
    w.style.left = x + 'px'; w.style.top = y + 'px';
    w.style.setProperty('--r', (Math.random() * 30 - 15) + 'deg');
    document.body.appendChild(w);
    setTimeout(function () { w.remove(); }, 600);
  }

  function show(from, opts) {
    opts = opts || {};
    addStyle();
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var W = window.innerWidth, H = window.innerHeight;
    var sx = Math.max(20, Math.min(W - 20, from ? from.left + from.width / 2 : W / 2));
    var sy = Math.max(20, Math.min(H - 20, from ? from.top + from.height / 2 : H / 2));
    var cx = W / 2, cy = H * 0.45;
    var size = Math.min(1.25, (W - 32) / 300, (H * 0.6) / 250);
    var THRASH = opts.duration || 2800;

    var shade = document.createElement('div');
    shade.className = 'crab-shade';
    var scene = document.createElement('div');
    scene.className = 'crab-scene';
    scene.style.left = cx + 'px'; scene.style.top = cy + 'px';
    scene.innerHTML = '<div class="crab-rig"><div class="crab-sway"><div class="crab-bob">' +
      '<div class="crab-shadow"></div>' +
      svg('crab-legs', legs()) + svg('crab-body', body()) +
      svg('crab-eyes', eye('crab-stalk-l', 132, 118, 7) + eye('crab-stalk-r', 168, 182, -7)) +
      svg('crab-claw-l', claw()) + svg('crab-claw-r', claw()) +
      '</div></div></div>';
    document.body.appendChild(shade);
    document.body.appendChild(scene);
    requestAnimationFrame(function () { shade.classList.add('on'); });
    var rig = scene.querySelector('.crab-rig');
    var startT = 'translate(' + (sx - cx) + 'px,' + (sy - cy) + 'px) scale(.06) rotateX(80deg)';
    var fullT = 'translate(0,0) scale(' + size + ') rotateX(0deg)';

    return new Promise(function (resolve) {
      var done = false, timers = [];
      function finish() {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        shade.classList.remove('on');
        var back = rig.animate([{ transform: fullT }, { transform: 'translate(0,-30px) scale(' + size * 1.05 + ') rotateX(-10deg)', offset: .3 }, { transform: startT }],
          { duration: reduce ? 200 : 520, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' });
        back.onfinish = function () {
          if (!reduce) splash(sx, sy);
          scene.remove(); setTimeout(function () { shade.remove(); }, 400);
          resolve();
        };
      }
      shade.addEventListener('click', finish);

      if (reduce) {
        rig.style.transform = fullT;
        timers.push(setTimeout(finish, 1500));
        return;
      }
      if (opts.sound !== false) sound(THRASH + 700);
      splash(sx, sy);
      // Bursts out of the water, overshoots toward the player, then settles in to thrash.
      rig.animate([
        { transform: startT },
        { transform: 'translate(' + (sx - cx) * .4 + 'px,' + ((sy - cy) * .4 - 80) + 'px) scale(' + size * .7 + ') rotateX(30deg) rotateZ(-20deg)', offset: .45 },
        { transform: 'translate(0,10px) scale(' + size * 1.18 + ') rotateX(-12deg) rotateZ(6deg)', offset: .78 },
        { transform: fullT }
      ], { duration: 700, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
      // SNAP! words popping off the claws while it thrashes.
      function pop() {
        if (done) return;
        var side = Math.random() < .5 ? -1 : 1;
        snapWord(cx + side * (90 + Math.random() * 40) * size, cy - (60 + Math.random() * 50) * size);
        timers.push(setTimeout(pop, 280 + Math.random() * 260));
      }
      timers.push(setTimeout(pop, 650));
      timers.push(setTimeout(finish, 700 + THRASH));
    });
  }

  window.AngryCrab = { show: show };
})();
