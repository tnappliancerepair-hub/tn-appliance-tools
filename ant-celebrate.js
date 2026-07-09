// ant-celebrate.js — a shared, self-contained celebration: full-screen confetti + a giant
// animated checkmark + optional stat tiles + synthesized sound (cash-register cha-ching +
// applause). No dependencies, CSP-safe (canvas confetti + Web-Audio, no external files).
//
//   window.antCelebrate({
//     tag:   'Invoiced',              // small uppercase eyebrow
//     big:   'INVOICED! 💵',          // the big headline
//     sub:   'Jane Doe',             // optional subline
//     tiles: [{value:'$240', label:'Amount invoiced', accent:'#4ade80'}, ...],  // 0-2 tiles
//     sound: 'both' | 'applause' | 'none',   // 'both' = cha-ching + applause
//   })
//
// Used by the office invoice worksheet (office-board) and available to any page. The TDR
// card has its own tech-pay variant; this is the generic engine for everywhere else.
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  window.antCelebrate = function (opts) {
    opts = opts || {};
    if (document.getElementById('ant-celebrate')) return;
    var sound = opts.sound || 'both';
    var tiles = Array.isArray(opts.tiles) ? opts.tiles.slice(0, 2) : [];
    var reduce = false; try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}

    var tileHtml = tiles.length ? ('<div style="display:flex;gap:12px;justify-content:center;margin-top:22px;flex-wrap:wrap">' +
      tiles.map(function (t) {
        var ac = t.accent || '#4ade80';
        return '<div style="background:rgba(255,255,255,.06);border:1px solid ' + ac + '66;border-radius:16px;padding:15px 22px;min-width:128px">' +
          '<div style="font-size:34px;font-weight:900;color:' + ac + '">' + esc(t.value) + '</div>' +
          '<div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:' + ac + 'cc;text-transform:uppercase">' + esc(t.label) + '</div>' +
          '</div>';
      }).join('') + '</div>') : '<div style="height:10px"></div>';

    var ov = document.createElement('div');
    ov.id = 'ant-celebrate';
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 820px at 50% 34%, rgba(16,185,129,0.30), rgba(6,10,18,0.95) 60%);opacity:0;transition:opacity .25s;font-family:-apple-system,system-ui,sans-serif;-webkit-tap-highlight-color:transparent');
    ov.innerHTML =
      '<canvas id="ant-celebrate-confetti" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>' +
      '<div style="position:relative;text-align:center;padding:24px;max-width:540px">' +
        '<div id="ant-celebrate-badge" style="margin:0 auto 16px;width:136px;height:136px;transform:scale(0)">' +
          '<svg viewBox="0 0 120 120" width="136" height="136">' +
            '<circle cx="60" cy="60" r="54" fill="none" stroke="#10b981" stroke-width="8" stroke-linecap="round" stroke-dasharray="339" stroke-dashoffset="339" id="ant-celebrate-ring" transform="rotate(-90 60 60)"/>' +
            '<path d="M36 62 L53 80 L86 43" fill="none" stroke="#4ade80" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="92" stroke-dashoffset="92" id="ant-celebrate-check"/>' +
          '</svg>' +
        '</div>' +
        '<div style="font-size:14px;font-weight:900;letter-spacing:.2em;color:#4ade80;text-transform:uppercase">' + esc(opts.tag || 'Done') + '</div>' +
        '<div style="font-size:42px;font-weight:900;color:#fff;line-height:1.05;margin-top:6px;text-shadow:0 4px 34px rgba(16,185,129,.55)">' + esc(opts.big || 'NICE WORK! 🎉') + '</div>' +
        (opts.sub ? '<div style="font-size:15px;color:#b7f7d8;margin-top:8px;font-weight:700">' + esc(opts.sub) + '</div>' : '') +
        tileHtml +
        '<button onclick="window.antCelebrateClose()" style="margin-top:26px;background:linear-gradient(135deg,#10b981,#047857);color:#fff;border:0;border-radius:30px;padding:15px 32px;font-size:16px;font-weight:900;cursor:pointer;box-shadow:0 10px 30px rgba(16,185,129,.5)">Done ✓</button>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.style.opacity = '1'; });

    var badge = document.getElementById('ant-celebrate-badge');
    var ring = document.getElementById('ant-celebrate-ring'), chk = document.getElementById('ant-celebrate-check');
    if (badge) setTimeout(function () { badge.style.transition = 'transform .55s cubic-bezier(.2,1.5,.4,1)'; badge.style.transform = 'scale(1)'; }, 80);
    if (reduce) { if (ring) ring.style.strokeDashoffset = '0'; if (chk) chk.style.strokeDashoffset = '0'; }
    else {
      if (ring) { ring.style.transition = 'stroke-dashoffset .7s ease .15s'; setTimeout(function () { ring.style.strokeDashoffset = '0'; }, 160); }
      if (chk) { chk.style.transition = 'stroke-dashoffset .45s ease'; setTimeout(function () { chk.style.strokeDashoffset = '0'; }, 560); }
      _confetti();
    }
    try { if (navigator.vibrate) navigator.vibrate([35, 55, 35, 55, 70]); } catch (_) {}
    if (sound === 'both') _sound(true); else if (sound === 'applause') _sound(false);
    ov._t = setTimeout(function () { window.antCelebrateClose(); }, 14000);
  };
  window.antCelebrateClose = function () {
    var ov = document.getElementById('ant-celebrate'); if (!ov) return;
    if (ov._t) clearTimeout(ov._t);
    ov.style.opacity = '0';
    setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 260);
  };

  function _confetti() {
    var cv = document.getElementById('ant-celebrate-confetti'); if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d'), W = cv.width = cv.offsetWidth, H = cv.height = cv.offsetHeight;
    var cols = ['#10b981', '#4ade80', '#ffd94a', '#38bdf8', '#f472b6', '#ffffff'];
    var N = Math.max(90, Math.min(200, Math.round(W / 5))), P = [];
    for (var i = 0; i < N; i++) P.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, r: 4 + Math.random() * 7, c: cols[(Math.random() * cols.length) | 0], vy: 2 + Math.random() * 4.5, vx: -2.5 + Math.random() * 5, rot: Math.random() * 6.28, vr: -0.25 + Math.random() * 0.5, sh: Math.random() < 0.5 ? 0 : 1 });
    var t0 = Date.now(), DUR = 3800;
    function frame() {
      var el = Date.now() - t0; ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < P.length; i++) { var p = P[i]; p.vy += 0.05; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - el / DUR);
        if (p.sh) ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6); else { ctx.beginPath(); ctx.arc(0, 0, p.r / 1.6, 0, 6.28); ctx.fill(); }
        ctx.restore();
      }
      if (el < DUR && document.getElementById('ant-celebrate-confetti')) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }
  function _sound(chaching) {
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      var ctx = window.__antAudioCtx || (window.__antAudioCtx = new AC());
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime;
      if (chaching) {
        function bell(freq, start, dur, gain) {
          var o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), g2 = ctx.createGain();
          o.type = 'triangle'; o.frequency.value = freq; o2.type = 'sine'; o2.frequency.value = freq * 2.01;
          o.connect(g); o2.connect(g2); g2.connect(g); g.connect(ctx.destination); g2.gain.value = 0.3;
          g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(gain, start + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
          o.start(start); o2.start(start); o.stop(start + dur); o2.stop(start + dur);
        }
        bell(1318.5, t, 0.5, 0.32); bell(1760.0, t + 0.11, 0.62, 0.38);
        var nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate), nd = nb.getChannelData(0);
        for (var i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nd.length, 2);
        var ns = ctx.createBufferSource(); ns.buffer = nb; var ng = ctx.createGain(); ng.gain.value = 0.22;
        var nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 1100;
        ns.connect(nf); nf.connect(ng); ng.connect(ctx.destination); ns.start(t);
      }
      _applause(ctx, t + (chaching ? 0.22 : 0.05), 1.8);
    } catch (_) {}
  }
  function _applause(ctx, start, dur) {
    try {
      var len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
      for (var i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      var src = ctx.createBufferSource(); src.buffer = buf;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start); g.gain.linearRampToValueAtTime(0.16, start + 0.35); g.gain.linearRampToValueAtTime(0.11, start + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(start); src.stop(start + dur);
      for (var k = 0; k < 16; k++) {
        var cs = ctx.createBufferSource(), cl = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate), c = cl.getChannelData(0);
        for (var j = 0; j < c.length; j++) c[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / c.length, 3);
        cs.buffer = cl; var cg = ctx.createGain(); cg.gain.value = 0.05 + Math.random() * 0.05;
        var cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 1400 + Math.random() * 1600;
        cs.connect(cf); cf.connect(cg); cg.connect(ctx.destination); cs.start(start + Math.random() * dur * 0.85);
      }
    } catch (_) {}
  }
})();
