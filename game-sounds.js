/* Poker Run sound effects, made on the fly with the Web Audio API (no sound files).
   draw   - a card sliding off the deck
   swish  - the card cutting the air as it spins
   reveal - a light chime when it lands face up
   plunk  - the card dropping into the hand
   Sound starts on the player's first tap (browsers require a tap before playing audio).
   The on/off choice is remembered on this device. */
(function () {
  var KEY = 'pokerRunSound';
  var ctx = null, noise = null, master = null;
  var on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) {}

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noise.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  function ready() { return on && init(); }
  function at(delayMs) { return ctx.currentTime + (delayMs || 0) / 1000; }

  // Filtered noise with a gain envelope: the basis of slides and swishes.
  function burst(t0, dur, f0, f1, q, vol, type) {
    var src = ctx.createBufferSource(); src.buffer = noise;
    var f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
  }
  function tone(t0, freq, endFreq, dur, vol, type) {
    var o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  var S = {
    isOn: function () { return on; },
    set: function (v) {
      on = !!v;
      try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
      if (on) init();
    },
    // Call from the tap itself so the browser lets audio start.
    unlock: function () { if (on) init(); },
    draw: function (delay) {
      if (!ready()) return;
      var t = at(delay);
      burst(t, 0.22, 5200, 1400, 0.9, 0.35);           // the slide
      burst(t + 0.16, 0.06, 2600, 2000, 1.5, 0.25);     // the snap off the deck
    },
    swish: function (delay, strength) {
      if (!ready()) return;
      var t = at(delay), v = 0.32 * (strength == null ? 1 : strength);
      burst(t, 0.28, 500, 3200, 1.3, v);
    },
    reveal: function (delay) {
      if (!ready()) return;
      var t = at(delay);
      tone(t, 1318.5, 0, 0.7, 0.09);          // E6
      tone(t + 0.07, 1975.5, 0, 0.8, 0.07);   // B6
      tone(t + 0.14, 2637, 0, 0.9, 0.04);     // E7 sparkle
    },
    plunk: function (delay) {
      if (!ready()) return;
      var t = at(delay);
      tone(t, 190, 70, 0.22, 0.55);                      // body of the thud
      burst(t, 0.05, 1800, 600, 0.7, 0.3, 'lowpass');    // card edge hitting the table
      tone(t + 0.01, 420, 260, 0.08, 0.12, 'triangle');
    }
  };
  window.PokerSounds = S;
})();
