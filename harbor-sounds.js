/* Harbor Hunt sounds, made on the fly with the Web Audio API (no sound files), in full stereo.
   Every sound is built from separate left and right layers (slightly different noise, pitch
   and timing) so it sounds wide, then placed left-to-right by where the shot landed, and sent
   through a stereo "open water" echo made from a generated impulse response.
   boom    - a hit: a sharp crack, a deep thump, a rolling rumble that spreads, falling debris
   splash  - a miss: a plunge, the column of water collapsing, droplets scattered left and right
   sink    - a boat going down: a hull groan, water rushing in, bubbles all around
   place   - a hull settling onto the water when a boat is placed
   ambient - low idling engines (one on each side), lapping water and swells while the game is open
   Sound starts on the player's first tap (browsers require a tap before playing audio).
   The on/off choice is remembered on this device. */
(function () {
  var KEY = 'harborHuntSound';
  var ctx = null, master = null, verb = null, dry = null, noiseL = null, noiseR = null, amb = null;
  var on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) {}

  function makeNoise(seconds, brown) {
    var b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = b.getChannelData(0), last = 0;
    for (var i = 0; i < d.length; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  // A stereo impulse response: decaying noise that differs between left and right, for a wide, open echo.
  function makeVerb(seconds, decay) {
    var len = ctx.sampleRate * seconds, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < ctx.sampleRate * 0.012 ? 0 : 1);
    }
    return b;
  }
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = 0.95; master.connect(comp);
    dry = ctx.createGain(); dry.gain.value = 1; dry.connect(master);
    var conv = ctx.createConvolver(); conv.buffer = makeVerb(2.6, 2.8);
    var wet = ctx.createGain(); wet.gain.value = 0.32; conv.connect(wet); wet.connect(master);
    verb = conv;
    noiseL = makeNoise(2); noiseR = makeNoise(2);
    return true;
  }
  function ready() { return on && init(); }
  function now(ms) { return ctx.currentTime + (ms || 0) / 1000; }

  // A place in the stereo field, with a send to the echo.
  function spot(pan, send) {
    var p = ctx.createStereoPanner ? ctx.createStereoPanner() : null, g = ctx.createGain();
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan || 0)); g.connect(p); p.connect(dry); } else g.connect(dry);
    var s = ctx.createGain(); s.gain.value = send === undefined ? 0.6 : send; g.connect(s); s.connect(verb);
    return g;
  }
  function noiseBurst(out, t0, dur, type, f0, f1, q, vol, attack, buf) {
    var src = ctx.createBufferSource(); src.buffer = buf || noiseL;
    var f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
  }
  function tone(out, t0, f0, f1, dur, vol, type, attack) {
    var o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  // The same layer on both sides, a little different each side, so it sounds wide.
  function wide(pan, spread, send, fn) {
    fn(spot(pan - spread, send), noiseL, 0);
    fn(spot(pan + spread, send), noiseR, 0.006 + Math.random() * 0.01);
  }

  var S = {
    boom: function (pan) {
      if (!ready()) return;
      var t = now(); pan = pan || 0;
      wide(pan, 0.25, 0.4, function (o, buf, d) { noiseBurst(o, t + d, 0.14, 'highpass', 3000, 1300, 0.7, 0.45, 0.002, buf); });          // crack
      var thump = spot(pan, 0.5); tone(thump, t, 110, 34, 0.7, 1, 'sine'); tone(thump, t, 62, 28, 0.9, 0.6, 'triangle');                  // thump
      wide(pan, 0.7, 0.9, function (o, buf, d) { noiseBurst(o, t + 0.02 + d * 3, 1.8, 'lowpass', 1100, 60, 0.8, 0.55, 0.03, buf); });    // rumble spreading out
      wide(pan, 0.5, 0.7, function (o, buf, d) { noiseBurst(o, t + 0.05 + d, 0.6, 'bandpass', 2200, 700, 1.5, 0.12, 0.02, buf); });      // roar of the fireball
      for (var k = 0; k < 7; k++) {                                                                                                       // debris splashing down around it
        var dt = 0.35 + Math.random() * 0.9, p = pan + (Math.random() - 0.5) * 1.2;
        noiseBurst(spot(p, 0.6), t + dt, 0.12 + Math.random() * 0.1, 'bandpass', 1400 + Math.random() * 1600, 500, 1.4, 0.06 + Math.random() * 0.05, 0.004, Math.random() < 0.5 ? noiseL : noiseR);
      }
    },
    splash: function (pan) {
      if (!ready()) return;
      var t = now(); pan = pan || 0;
      wide(pan, 0.2, 0.5, function (o, buf, d) { noiseBurst(o, t + d, 0.5, 'bandpass', 2000, 500, 0.8, 0.45, 0.006, buf); });            // plunge
      tone(spot(pan, 0.3), t, 180, 70, 0.25, 0.35, 'sine');                                                                                // the "plop"
      wide(pan, 0.45, 0.7, function (o, buf, d) { noiseBurst(o, t + 0.28 + d * 4, 0.7, 'lowpass', 2600, 300, 0.7, 0.28, 0.05, buf); });  // column collapsing
      for (var k = 0; k < 9; k++) {                                                                                                       // droplets scattered left and right
        var dt = 0.25 + Math.random() * 0.7, f = 900 + Math.random() * 1700, p = pan + (Math.random() - 0.5) * 1.4;
        tone(spot(p, 0.5), t + dt, f, f * 1.7, 0.05 + Math.random() * 0.03, 0.05 + Math.random() * 0.04, 'sine', 0.003);
      }
    },
    sink: function (pan) {
      if (!ready()) return;
      var t = now(100); pan = pan || 0;
      var groanL = spot(pan - 0.3, 0.8), groanR = spot(pan + 0.3, 0.8);
      tone(groanL, t, 92, 42, 2.6, 0.32, 'sawtooth', 0.3); tone(groanR, t + 0.05, 97, 44, 2.6, 0.28, 'sawtooth', 0.3);                     // hull groan, slightly out of tune each side
      tone(spot(pan, 0.9), t + 0.8, 230, 130, 1.2, 0.08, 'triangle', 0.2);                                                                // metal creak
      wide(pan, 0.6, 0.8, function (o, buf, d) { noiseBurst(o, t + d * 5, 2.8, 'lowpass', 650, 80, 1, 0.38, 0.35, buf); });               // water rushing in
      for (var k = 0; k < 22; k++) {                                                                                                      // bubbles all around
        var dt = 0.3 + Math.random() * 2.6, f = 160 + Math.random() * 480, p = pan + (Math.random() - 0.5) * 1.6;
        tone(spot(p, 0.6), t + dt, f, f * 2.4, 0.08 + Math.random() * 0.05, 0.07 + Math.random() * 0.05, 'sine', 0.005);
      }
    },
    place: function () {
      if (!ready()) return;
      var t = now();
      tone(spot(0, 0.4), t, 150, 65, 0.25, 0.35, 'sine');
      wide(0, 0.3, 0.5, function (o, buf, d) { noiseBurst(o, t + d, 0.35, 'lowpass', 800, 150, 0.7, 0.13, 0.01, buf); });
    },
    ambientStart: function () {
      if (!ready() || amb) return;
      var out = ctx.createGain(); out.gain.value = 0.0001; out.connect(dry);
      var send = ctx.createGain(); send.gain.value = 0.35; out.connect(send); send.connect(verb);
      out.gain.exponentialRampToValueAtTime(0.11, now(1800));
      var nodes = [];
      function panned(p) { var n = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (n.pan) n.pan.value = p; n.connect(out); return n; }
      // Two idling diesels, one on each side, a little out of step, gently throbbing.
      [[-0.65, 40.5, 0.33], [0.65, 43.2, 0.27]].forEach(function (e) {
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 150; lp.connect(panned(e[0]));
        var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = e[1];
        var o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = e[1] / 2;
        var g = ctx.createGain(); g.gain.value = 0.3; o.connect(g); var g2 = ctx.createGain(); g2.gain.value = 0.12; o2.connect(g2); g2.connect(g); g.connect(lp);
        var lfo = ctx.createOscillator(); lfo.frequency.value = e[2]; var lg = ctx.createGain(); lg.gain.value = 0.13; lfo.connect(lg); lg.connect(g.gain);
        nodes.push(o, o2, lfo);
      });
      // Water lapping against hulls: different noise on each side, swelling at different rates.
      [[-0.85, noiseL, 0.17, 380], [0.85, noiseR, 0.23, 460], [0, makeNoise(4, true), 0.07, 220]].forEach(function (w) {
        var src = ctx.createBufferSource(); src.buffer = w[1]; src.loop = true;
        var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = w[3];
        var g = ctx.createGain(); g.gain.value = w[1] === noiseL || w[1] === noiseR ? 0.16 : 0.5;
        var l = ctx.createOscillator(); l.frequency.value = w[2]; var lg = ctx.createGain(); lg.gain.value = g.gain.value * 0.85; l.connect(lg); lg.connect(g.gain);
        src.connect(f); f.connect(g); g.connect(panned(w[0]));
        nodes.push(src, l);
      });
      nodes.forEach(function (n) { n.start(); });
      amb = { out: out, nodes: nodes };
    },
    ambientStop: function () {
      if (!amb || !ctx) return;
      var a = amb; amb = null;
      a.out.gain.cancelScheduledValues(ctx.currentTime);
      a.out.gain.setValueAtTime(a.out.gain.value, ctx.currentTime);
      a.out.gain.exponentialRampToValueAtTime(0.0001, now(700));
      setTimeout(function () { a.nodes.forEach(function (n) { try { n.stop(); } catch (e) {} }); a.out.disconnect(); }, 800);
    },
    isOn: function () { return on; },
    toggle: function () {
      on = !on;
      try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
      if (!on) S.ambientStop();
      return on;
    },
    unlock: function () { if (on) init(); }
  };
  window.HarborSounds = S;
})();
