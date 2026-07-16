// ant-magic.js — the Hogwarts EXPERIENCE for the board (self-contained, CSS/emoji
// only, no images/deps). Not a color scheme — a place Danielle WANTS to live in,
// and that rewards her for keeping it current:
//   ambient      — enchanted ceiling (twinkling stars) + floating Great Hall candles
//   AntMagic.award(kind) — House Points grow + a "+N" floats up (file/estimate/paid…)
//   AntMagic.owl()       — an owl swoops in with post (a NEW job landed)
//   AntMagic.train()     — the Hogwarts Express chugs across (a big win)
//   AntMagic.snitch()    — the golden snitch flutters by (milestones / idle delight)
//   AntMagic.sparkle(x,y)— a burst of stars where a card was just filed
// Respects prefers-reduced-motion + a mute flag (AntMagic.quiet()). Sounds via AntSounds.
// (Teddy 2026-07-14: "make it amazingly interesting — owl, glasses, a train.")
(function () {
  'use strict';
  function quiet() { try { return localStorage.getItem('ant_magic') === 'off' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } }
  function snd(fn) { try { if (window.AntSounds && window.AntSounds[fn]) window.AntSounds[fn](); } catch (_) {} }

  var STYLE = '\
@keyframes antOwlFly{0%{transform:translate(-16vw,10px) rotate(-4deg) scaleX(-1)}25%{transform:translate(24vw,-8px) rotate(4deg) scaleX(-1)}50%{transform:translate(52vw,8px) rotate(-4deg) scaleX(-1)}75%{transform:translate(80vw,-6px) rotate(4deg) scaleX(-1)}100%{transform:translate(118vw,10px) rotate(0) scaleX(-1)}}\
@keyframes antTrain{0%{transform:translateX(-42vw)}100%{transform:translateX(120vw)}}\
@keyframes antPuff{0%{opacity:.5;transform:translateY(0) scale(.5)}100%{opacity:0;transform:translateY(-24px) scale(1.7)}}\
@keyframes antSpk{0%{opacity:0;transform:translate(0,0) scale(.3)}20%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(1.1)}}\
@keyframes antTwinkle{0%,100%{opacity:.25}50%{opacity:1}}\
@keyframes antFlicker{0%,100%{opacity:.9;transform:translateY(0) rotate(-1deg)}50%{opacity:1;transform:translateY(-1px) rotate(1deg)}}\
@keyframes antFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(4px)}}\
@keyframes antPts{0%{opacity:0;transform:translateY(6px) scale(.7)}25%{opacity:1;transform:translateY(-4px) scale(1.15)}100%{opacity:0;transform:translateY(-30px) scale(1)}}\
@keyframes antBanner{0%{opacity:0;transform:translate(-50%,-26px)}10%{opacity:1;transform:translate(-50%,0)}88%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-26px)}}\
@keyframes antPat{0%{opacity:0;transform:translate(-12vw,32vh) scale(.8)}14%{opacity:.92}84%{opacity:.92}100%{opacity:0;transform:translate(112vw,18vh) scale(1.15)}}\
.ant-banner{position:fixed;top:72px;left:50%;z-index:2147482010;transform:translate(-50%,0);font:800 15px/1.35 "Orbitron","Arial Black",sans-serif;letter-spacing:.04em;color:#fff;background:linear-gradient(180deg,#2a1150,#5a1a5e 60%,#a12a6b);border:2px solid #ff2d95;border-radius:14px;padding:12px 22px;box-shadow:0 10px 34px rgba(0,0,0,.5),0 0 0 3px rgba(0,229,255,.35),0 0 26px rgba(255,45,149,.5);text-align:center;pointer-events:none;max-width:88vw;animation:antBanner var(--dur,4.4s) ease forwards}\
.ant-patronus{position:fixed;top:0;left:0;z-index:2147482006;font-size:58px;pointer-events:none;filter:drop-shadow(0 0 18px rgba(255,45,149,.95)) drop-shadow(0 0 30px rgba(0,229,255,.7)) brightness(1.15);animation:antPat 4.6s ease-in-out forwards}\
@keyframes antBadgePop{0%{transform:scale(1)}40%{transform:scale(1.28)}100%{transform:scale(1)}}\
@keyframes antSnitch{0%{transform:translate(-8vw,40vh) rotate(0)}20%{transform:translate(22vw,18vh) rotate(20deg)}40%{transform:translate(46vw,52vh) rotate(-15deg)}60%{transform:translate(64vw,22vh) rotate(18deg)}80%{transform:translate(86vw,44vh) rotate(-10deg)}100%{transform:translate(114vw,20vh) rotate(0)}}\
.ant-owl{position:fixed;top:60px;left:0;z-index:2147482000;font-size:34px;pointer-events:none;filter:drop-shadow(0 4px 8px rgba(0,0,0,.35));animation:antOwlFly 3.6s cubic-bezier(.4,0,.5,1) forwards}\
.ant-owl .env{position:absolute;bottom:-6px;left:8px;font-size:15px}\
.ant-train{position:fixed;bottom:20px;left:0;z-index:2147482000;font-size:32px;pointer-events:none;white-space:nowrap;filter:drop-shadow(0 3px 6px rgba(0,0,0,.3));animation:antTrain 4.8s linear forwards}\
.ant-puff{position:fixed;bottom:52px;z-index:2147481999;font-size:20px;pointer-events:none;animation:antPuff 1.1s ease-out forwards}\
.ant-spk{position:fixed;z-index:2147482001;pointer-events:none;font-size:15px;animation:antSpk .72s ease-out forwards}\
.ant-snitch{position:fixed;top:0;left:0;z-index:2147482000;font-size:26px;pointer-events:none;filter:drop-shadow(0 0 6px rgba(255,214,80,.8));animation:antSnitch 5.2s ease-in-out forwards}\
.ant-star{position:absolute;color:#fff;pointer-events:none;font-size:8px;animation:antTwinkle 3s ease-in-out infinite}\
.ant-candle{position:absolute;pointer-events:none;font-size:15px;filter:drop-shadow(0 0 8px rgba(0,229,255,.85));animation:antFloat 4s ease-in-out infinite}\
.ant-candle .fl{display:none}\
.ant-pts-badge{position:relative;z-index:4;display:inline-flex;align-items:center;gap:5px;font:800 13px/1 "Orbitron","Arial Black",sans-serif;letter-spacing:.03em;color:#06121a;background:linear-gradient(180deg,#00e5ff,#00b7c7);border:1px solid #ff2d95;border-radius:999px;padding:6px 12px;box-shadow:0 0 12px rgba(0,229,255,.6),0 0 0 1px rgba(255,45,149,.4);cursor:pointer;white-space:nowrap;user-select:none}\
.ant-pts-float{position:fixed;z-index:2147482002;pointer-events:none;font:900 15px/1 "Orbitron","Arial Black",sans-serif;color:#00e5ff;text-shadow:0 0 8px rgba(255,45,149,.8),0 1px 3px rgba(0,0,0,.6);animation:antPts 1.1s ease-out forwards}';

  function ensureStyle() { if (document.getElementById('ant-magic-css')) return; var s = document.createElement('style'); s.id = 'ant-magic-css'; s.textContent = STYLE; document.head.appendChild(s); }

  // ── Ambient enchanted ceiling: twinkling stars + a couple of floating candles,
  //    laid over the header (.topbar). Cheap, purely decorative, pointer-events:none.
  function ambient() {
    if (quiet()) return; ensureStyle();
    var bar = document.querySelector('.topbar'); if (!bar || bar.querySelector('.ant-ceiling')) return;
    // Confine the enchanted ceiling to the TITLE strip (top ~46px) so the stars +
    // floating candles sit in the empty space around the title — not hidden behind
    // the opaque search bar / hop pills below.
    var layer = document.createElement('div'); layer.className = 'ant-ceiling';
    layer.setAttribute('style', 'position:absolute;top:0;left:0;right:0;height:48px;overflow:hidden;pointer-events:none;z-index:0');
    for (var i = 0; i < 20; i++) {
      var st = document.createElement('div'); st.className = 'ant-star';
      st.textContent = Math.random() < 0.28 ? '✦' : '·';
      st.style.left = (30 + Math.random() * 68) + '%'; st.style.top = (Math.random() * 90) + '%';
      st.style.fontSize = (7 + Math.random() * 8) + 'px';
      st.style.animationDelay = (Math.random() * 3) + 's';
      layer.appendChild(st);
    }
    var spots = [['34%', '18px'], ['45%', '6px'], ['57%', '20px'], ['64%', '4px']];
    spots.forEach(function (p, i) {
      var cd = document.createElement('div'); cd.className = 'ant-candle'; cd.innerHTML = '🌟';
      cd.style.left = p[0]; cd.style.top = p[1]; cd.style.animationDelay = (i * 0.6) + 's';
      layer.appendChild(cd);
    });
    if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
    bar.insertBefore(layer, bar.firstChild);
    Array.prototype.forEach.call(bar.children, function (ch) { if (ch !== layer && !ch.style.position) { ch.style.position = 'relative'; ch.style.zIndex = '1'; } });
  }

  // ── House Points: the hook. Grows as she keeps the board current.
  var PTS = { file: 5, check: 3, estimate: 15, section: 15, paid: 25, schedule: 8 };
  function get() { try { return parseInt(localStorage.getItem('ant_house_pts') || '0', 10) || 0; } catch (_) { return 0; } }
  function set(v) { try { localStorage.setItem('ant_house_pts', String(v)); } catch (_) {} }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // Wizard rank — she LEVELS UP by keeping the board current. Leveling triggers a
  // Patronus + fanfare, so tidiness becomes a game she's climbing.
  var RANKS = [
    { p: 0, n: 'Rookie' }, { p: 250, n: 'Challenger' }, { p: 600, n: 'Ace' },
    { p: 1200, n: 'Pro' }, { p: 2500, n: 'All-Star' }, { p: 5000, n: 'Legend' },
    { p: 9000, n: 'Champion' }, { p: 16000, n: 'Grid Master' },
  ];
  function rankFor(p) { var r = RANKS[0]; for (var i = 0; i < RANKS.length; i++) { if (p >= RANKS[i].p) r = RANKS[i]; } return r; }
  function nextRank(p) { for (var i = 0; i < RANKS.length; i++) { if (RANKS[i].p > p) return RANKS[i]; } return null; }

  // Reusable magical banner (welcome / rank-up).
  function banner(html, dur) {
    if (quiet() || !document.body) return; ensureStyle();
    var old = document.querySelector('.ant-banner'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var el = document.createElement('div'); el.className = 'ant-banner'; el.style.setProperty('--dur', (dur || 4.4) + 's'); el.innerHTML = html;
    document.body.appendChild(el); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, (dur || 4.4) * 1000 + 100);
  }
  function patronus() {
    if (quiet() || !document.body) return; ensureStyle();
    if (document.querySelector('.ant-patronus')) return;
    var el = document.createElement('div'); el.className = 'ant-patronus'; el.textContent = '⭐';
    document.body.appendChild(el); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4700);
  }
  // Work streak — consecutive days she opens the Hall.
  function streak() {
    try {
      var d = new Date(); var key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      var last = localStorage.getItem('ant_last_day'); var s = parseInt(localStorage.getItem('ant_streak') || '0', 10) || 0;
      if (last !== key) {
        var y = new Date(d.getTime() - 86400000); var yk = y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate();
        s = (last === yk) ? s + 1 : 1;
        localStorage.setItem('ant_streak', String(s)); localStorage.setItem('ant_last_day', key);
      } else if (!s) { s = 1; localStorage.setItem('ant_streak', '1'); }
      return s;
    } catch (_) { return 1; }
  }
  function badge() {
    var b = document.getElementById('ant-pts-badge'); if (b) return b;
    ensureStyle();
    var row = document.querySelector('.topbar .tb-row'); if (!row) return null;
    b = document.createElement('div'); b.id = 'ant-pts-badge'; b.className = 'ant-pts-badge';
    var rk = rankFor(get()).n.split(',')[0];
    b.title = rankFor(get()).n + ' — arcade score earned by keeping the board current. Tap to mute the effects.';
    b.innerHTML = '🕹️ <span id="ant-pts-n">' + fmt(get()) + '</span> <span id="ant-pts-rank" style="opacity:.72;font-weight:700">· ' + rk + '</span>';
    b.onclick = function () { var off = !quiet(); try { localStorage.setItem('ant_magic', off ? 'off' : 'on'); localStorage.setItem('ant_sound', off ? 'off' : 'on'); } catch (_) {} b.style.opacity = off ? '.5' : '1'; if (!off) { ambient(); API.sparkle(); } };
    // place it right before the region toggle
    var seg = row.querySelector('.seg'); if (seg) row.insertBefore(b, seg); else row.appendChild(b);
    if (quiet()) b.style.opacity = '.5';
    return b;
  }

  var API = {
    award: function (kind, x, y) {
      var n = PTS[kind] || 5;
      var total = get() + n; set(total);
      var b = badge();
      if (b && !quiet()) {
        var nEl = document.getElementById('ant-pts-n'); if (nEl) nEl.textContent = fmt(total);
        var rkEl = document.getElementById('ant-pts-rank'); if (rkEl) rkEl.textContent = '· ' + rankFor(total).n.split(',')[0];
        b.style.animation = 'none'; void b.offsetWidth; b.style.animation = 'antBadgePop .5s ease';
        var r = b.getBoundingClientRect();
        var f = document.createElement('div'); f.className = 'ant-pts-float'; f.textContent = '+' + n + ' ✨';
        f.style.left = (r.left + r.width / 2 - 14) + 'px'; f.style.top = (r.bottom - 6) + 'px';
        document.body.appendChild(f); setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1100);
      }
      // sound: soft sparkle for small, 80s fanfare for the big ones
      if (kind === 'paid' || kind === 'section') snd('win'); else snd('move');
      if (x != null) API.sparkle(x, y);
      var before = total - n;
      // ⚡ RANK UP — the big one: a Patronus charges across + fanfare + banner.
      if (rankFor(total).n !== rankFor(before).n) {
        API.patronus(); API.snitch(); snd('win');
        banner('⚡ <b>You reached ' + rankFor(total).n + '!</b> ⚡<br><span style="font-weight:600;font-size:13px">' + fmt(total) + ' points — new high score, the Arcade salutes you.</span>', 5);
      } else if (Math.floor(total / 250) > Math.floor(before / 250)) {
        // House-cup checkpoint every 250 pts: snitch + train + fanfare
        API.snitch(); API.train(); snd('win');
      }
      return total;
    },
    owl: function () {
      if (quiet() || !document.body) return; ensureStyle();
      if (document.querySelector('.ant-owl')) return;
      var el = document.createElement('div'); el.className = 'ant-owl'; el.innerHTML = '🛸<span class="env">📦</span>';
      document.body.appendChild(el); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3800);
    },
    train: function () {
      if (quiet() || !document.body) return; ensureStyle();
      if (document.querySelector('.ant-train')) return;
      var el = document.createElement('div'); el.className = 'ant-train'; el.textContent = '🚗💨'; document.body.appendChild(el);
      for (var i = 0; i < 5; i++) (function (i) { setTimeout(function () { if (quiet()) return; var p = document.createElement('div'); p.className = 'ant-puff'; p.textContent = '☁️'; p.style.left = (10 + i * 20) + 'vw'; document.body.appendChild(p); setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 1100); }, i * 720 + 300); })(i);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4900);
    },
    snitch: function () {
      if (quiet() || !document.body) return; ensureStyle();
      if (document.querySelector('.ant-snitch')) return;
      var el = document.createElement('div'); el.className = 'ant-snitch'; el.textContent = '🟡'; el.innerHTML = '<span style="filter:hue-rotate(-8deg)">🪙</span>';
      document.body.appendChild(el); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 5300);
    },
    sparkle: function (x, y) {
      if (quiet() || !document.body) return; ensureStyle();
      if (x == null) { x = window.innerWidth / 2; y = 120; }
      var chars = ['✨', '⭐', '🌟', '✨', '💫'];
      for (var i = 0; i < 6; i++) {
        var s = document.createElement('div'); s.className = 'ant-spk'; s.textContent = chars[i % chars.length];
        var ang = (Math.PI * 2 * i) / 6 + Math.random() * 0.6, dist = 26 + Math.random() * 26;
        s.style.left = x + 'px'; s.style.top = y + 'px';
        s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(0) + 'px');
        s.style.setProperty('--dy', (Math.sin(ang) * dist - 12).toFixed(0) + 'px');
        document.body.appendChild(s);
        (function (s) { setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 760); })(s);
      }
    },
    patronus: patronus,
    banner: banner,
    rank: function () { return rankFor(get()); },
    // 🪄 Once-a-day welcome to the Great Hall — rank, points, and work streak.
    welcome: function () {
      if (quiet()) return;
      try {
        var d = new Date(), key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
        if (localStorage.getItem('ant_welcomed') === key) return;
        localStorage.setItem('ant_welcomed', key);
      } catch (_) {}
      var s = streak(), p = get(), rk = rankFor(p), nx = nextRank(p);
      setTimeout(function () {
        banner('🕹️ <b>Player 1 — welcome back to The Arcade</b> ✨<br>' +
          '<span style="font-weight:700;font-size:13px">' + rk.n + ' · ' + fmt(p) + ' points' +
          (s > 1 ? ' · 🔥 ' + s + '-day streak' : '') + '</span>' +
          (nx ? '<br><span style="font-weight:600;font-size:12px;opacity:.8">' + fmt(nx.p - p) + ' points to ' + nx.n.split(',')[0] + '</span>' : ''), 5);
        API.sparkle();
      }, 600);
    },
    quiet: function (off) { try { localStorage.setItem('ant_magic', off ? 'off' : 'on'); } catch (_) {} return !quiet(); },
    isQuiet: quiet,
    init: function () { try { badge(); ambient(); this.welcome(); } catch (_) {} },
  };
  window.AntMagic = API;
  // auto-init once the header exists
  if (document.readyState !== 'loading') setTimeout(API.init, 300); else document.addEventListener('DOMContentLoaded', function () { setTimeout(API.init, 300); });
})();
