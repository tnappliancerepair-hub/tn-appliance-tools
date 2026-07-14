// ant-sounds.js — synthesized reward cues for the board (no audio files, CSP-safe,
// no copyrighted melodies). Rewards Danielle for keeping the board current:
//   AntSounds.move()  — soft magical sparkle when a card is FILED (the daily action)
//   AntSounds.magic() — a wand-whoosh + bright bell arpeggio when an ESTIMATE is
//                       finished (Harry Potter spirit, our own tune)
//   AntSounds.win()   — an 80s synth fanfare for a MEANINGFUL milestone (Paid, a
//                       section completed) — she's an 80s music fan too
// Mute: localStorage ant_sound='off', or AntSounds.mute(true). (Teddy 2026-07-14:
// "she didn't like the old celebration sound — HP fan + 80s fan, try this.")
(function () {
  'use strict';
  var AC = window.AudioContext || window.webkitAudioContext;
  function ctx() { if (!AC) return null; try { var c = window.__antAudioCtx || (window.__antAudioCtx = new AC()); if (c.state === 'suspended') c.resume(); return c; } catch (_) { return null; } }
  function muted() { try { return localStorage.getItem('ant_sound') === 'off'; } catch (_) { return false; } }

  // A detuned bell / celesta note (triangle + octave sine shimmer).
  function bell(c, freq, start, dur, gain, type) {
    var o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), g2 = c.createGain();
    o.type = type || 'triangle'; o.frequency.value = freq; o2.type = 'sine'; o2.frequency.value = freq * 2.001;
    o2.connect(g2); g2.gain.value = 0.32; g2.connect(g); o.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(gain, start + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.start(start); o2.start(start); o.stop(start + dur + 0.02); o2.stop(start + dur + 0.02);
  }
  // A fat detuned saw synth note (80s) with a filter sweep.
  function synth(c, freq, start, dur, gain) {
    var o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = freq; o2.type = 'sawtooth'; o2.frequency.value = freq * 1.006;
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, start); f.frequency.exponentialRampToValueAtTime(5400, start + 0.12); f.Q.value = 7;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(gain, start + 0.015); g.gain.setValueAtTime(gain, start + dur * 0.55); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.start(start); o2.start(start); o.stop(start + dur + 0.02); o2.stop(start + dur + 0.02);
  }
  // A wand-whoosh: a rising band-passed noise sweep ("spell cast").
  function whoosh(c, start, dur, gain) {
    var len = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var s = c.createBufferSource(); s.buffer = b; var f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.3;
    f.frequency.setValueAtTime(500, start); f.frequency.exponentialRampToValueAtTime(4600, start + dur);
    var g = c.createGain(); g.gain.setValueAtTime(0.0001, start); g.gain.linearRampToValueAtTime(gain, start + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.connect(f); f.connect(g); g.connect(c.destination); s.start(start); s.stop(start + dur + 0.02);
  }

  var API = {
    // soft single sparkle — a card was filed into a folder (the daily habit)
    move: function () { if (muted()) return; var c = ctx(); if (!c) return; var t = c.currentTime; bell(c, 1568, t, 0.26, 0.13); bell(c, 2349.3, t + 0.045, 0.30, 0.08); },
    // ✨ magical shimmer — estimate finished (Harry Potter spirit)
    magic: function () {
      if (muted()) return; var c = ctx(); if (!c) return; var t = c.currentTime;
      whoosh(c, t, 0.30, 0.09);
      var arp = [1174.7, 1396.9, 1760.0, 2349.3];   // D6 F6 A6 D7 — bright, magical
      for (var i = 0; i < arp.length; i++) bell(c, arp[i], t + 0.07 + i * 0.075, 0.62, 0.21);
      bell(c, 3520.0, t + 0.44, 0.5, 0.09);          // high fairy-dust sparkle
    },
    // 🎹 80s synth fanfare — a meaningful milestone (Paid / section done)
    win: function () {
      if (muted()) return; var c = ctx(); if (!c) return; var t = c.currentTime;
      var arp = [523.25, 659.25, 783.99, 1046.5];    // C E G C — punchy rising
      for (var i = 0; i < arp.length; i++) synth(c, arp[i], t + i * 0.085, 0.22, 0.15);
      [1046.5, 1318.5, 1568.0].forEach(function (f) { synth(c, f, t + 0.34, 0.55, 0.12); });  // chord stab up top
      var len = Math.floor(c.sampleRate * 0.12), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);   // gated-snare hit
      for (var k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / len, 1.5);
      var s = c.createBufferSource(); s.buffer = b; var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1300; var g = c.createGain(); g.gain.value = 0.13;
      s.connect(hp); hp.connect(g); g.connect(c.destination); s.start(t + 0.34);
    },
    mute: function (on) { try { localStorage.setItem('ant_sound', on ? 'off' : 'on'); } catch (_) {} return !muted(); },
    isMuted: muted,
  };
  window.AntSounds = API;
})();
