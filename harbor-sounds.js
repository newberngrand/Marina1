/* Harbor Hunt sounds, made on the fly with the Web Audio API (no sound files).
   boom    - a hit: a sharp crack, a deep thump and a rolling rumble
   splash  - a miss: a plunge into the water and a few droplets
   sink    - a boat going down: a groan, then gurgling bubbles
   place   - a hull settling onto the water when a boat is placed
   ambient - low, quiet idling engines and lapping water while the game is open
   Sound starts on the player's first tap (browsers require a tap before playing audio).
   The on/off choice is remembered on this device. */
(function () {
  var KEY = 'harborHuntSound';
  var ctx = null, master = null, noise = null, amb = null;
  var on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) {}

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    var d = noise.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  function ready() { return on && init(); }
  function now(ms) { return ctx.currentTime + (ms || 0) / 1000; }

  function noiseBurst(t0, dur, type, f0, f1, q, vol, attack, out) {
    var src = ctx.createBufferSource(); src.buffer = noise;
    var f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(out || master);
    src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
  }
  function tone(t0, f0, f1, dur, vol, type, out) {
    var o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(out || master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  var S = {
    boom: function () {
      if (!ready()) return;
      var t = now();
      noiseBurst(t, 0.12, 'highpass', 2500, 1200, 0.7, 0.55, 0.003);       // crack
      tone(t, 120, 38, 0.55, 0.9, 'sine');                                  // thump
      noiseBurst(t + 0.02, 1.3, 'lowpass', 900, 70, 0.8, 0.7, 0.02);        // rumble
      noiseBurst(t + 0.25, 0.9, 'bandpass', 600, 200, 1.2, 0.12, 0.05);     // debris
    },
    splash: function () {
      if (!ready()) return;
      var t = now();
      noiseBurst(t, 0.45, 'bandpass', 1800, 500, 0.9, 0.5, 0.008);          // plunge
      noiseBurst(t, 0.25, 'lowpass', 400, 120, 0.7, 0.35, 0.005);           // body of water
      for (var k = 0; k < 5; k++) {                                         // droplets
        var dt = 0.12 + Math.random() * 0.45, f = 900 + Math.random() * 1400;
        tone(t + dt, f, f * 1.6, 0.06, 0.07, 'sine');
      }
    },
    sink: function () {
      if (!ready()) return;
      var t = now(0.1);
      tone(t, 95, 45, 2.2, 0.45, 'sawtooth');                              // hull groan
      noiseBurst(t, 2.4, 'lowpass', 500, 90, 1, 0.35, 0.3);                 // water rushing in
      for (var k = 0; k < 14; k++) {                                        // bubbles
        var dt = 0.3 + Math.random() * 2.1, f = 180 + Math.random() * 420;
        tone(t + dt, f, f * 2.2, 0.09, 0.09, 'sine');
      }
    },
    place: function () {
      if (!ready()) return;
      var t = now();
      tone(t, 160, 70, 0.22, 0.35, 'sine');
      noiseBurst(t, 0.3, 'lowpass', 700, 150, 0.7, 0.15, 0.01);
    },
    ambientStart: function () {
      if (!ready() || amb) return;
      var out = ctx.createGain(); out.gain.value = 0.0001; out.connect(master);
      out.gain.exponentialRampToValueAtTime(0.09, now(1500));
      // Two idling diesels a little out of step, through a low filter, gently throbbing.
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; lp.connect(out);
      var o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 41;
      var o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 43.5;
      var og = ctx.createGain(); og.gain.value = 0.35; o1.connect(og); o2.connect(og); og.connect(lp);
      var lfo = ctx.createOscillator(); lfo.frequency.value = 0.35;
      var lfoG = ctx.createGain(); lfoG.gain.value = 0.15; lfo.connect(lfoG); lfoG.connect(og.gain);
      // Water lapping: low noise that swells and fades.
      var src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      var wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 420;
      var wg = ctx.createGain(); wg.gain.value = 0.22;
      var wl = ctx.createOscillator(); wl.frequency.value = 0.18;
      var wlg = ctx.createGain(); wlg.gain.value = 0.18; wl.connect(wlg); wlg.connect(wg.gain);
      src.connect(wf); wf.connect(wg); wg.connect(out);
      [o1, o2, lfo, src, wl].forEach(function (n) { n.start(); });
      amb = { out: out, nodes: [o1, o2, lfo, src, wl] };
    },
    ambientStop: function () {
      if (!amb || !ctx) return;
      var a = amb; amb = null;
      a.out.gain.cancelScheduledValues(ctx.currentTime);
      a.out.gain.setValueAtTime(a.out.gain.value, ctx.currentTime);
      a.out.gain.exponentialRampToValueAtTime(0.0001, now(600));
      setTimeout(function () { a.nodes.forEach(function (n) { try { n.stop(); } catch (e) {} }); a.out.disconnect(); }, 700);
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
