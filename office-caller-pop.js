// office-caller-pop — the laptop screen-pop (Teddy 2026-08-12: "Danielle and Sofia mainly
// work on their laptops... a little card, they glance, tap, the tile opens — NOT a screen
// takeover that loses their work"). A tiny widget that lives in the bottom-right corner of
// any office page. It quietly polls the caller-pop feed; when a call comes in, the caller's
// whole story slides up. Tap "Open" and their tile opens in a NEW TAB, so whatever they were
// doing stays exactly where it was. Dismiss and it's gone. It never covers the screen,
// never steals focus, never interrupts a keystroke.
//
// Drop-in: <script src="/office-caller-pop.js"></script>
(function () {
  'use strict';
  if (window.__callerPopInjected) return;
  window.__callerPopInjected = true;

  var FEED = '/.netlify/functions/caller-pop-feed';
  var POLL_MS = 5000;                 // glance-fast, but light on the backend
  var startMs = Date.now();           // only pop calls that ring AFTER this page opened
  var seen = {};                      // id -> true, so a call never double-pops
  try { (JSON.parse(sessionStorage.getItem('cpop_seen') || '[]') || []).forEach(function (id) { seen[id] = true; }); } catch (e) {}
  function remember(id) { seen[id] = true; try { sessionStorage.setItem('cpop_seen', JSON.stringify(Object.keys(seen).slice(-50))); } catch (e) {} }

  var css = ''
    + '#cpopWrap{position:fixed;right:16px;bottom:16px;z-index:99000;display:flex;flex-direction:column;gap:10px;'
    + 'max-width:340px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;pointer-events:none;}'
    + '.cpop{pointer-events:auto;background:#141a26;border:1px solid #33405c;border-radius:14px;overflow:hidden;'
    + 'box-shadow:0 12px 34px rgba(0,0,0,.45);opacity:0;transform:translateY(14px);'
    + 'transition:opacity .28s ease,transform .28s ease;}'
    + '.cpop.in{opacity:1;transform:translateY(0);}'
    + '.cpop-top{display:flex;align-items:center;gap:8px;padding:11px 12px 6px;}'
    + '.cpop-ring{font-size:16px;line-height:1;animation:cpopWig 1.1s ease-in-out infinite;}'
    + '@keyframes cpopWig{0%,100%{transform:rotate(0)}25%{transform:rotate(-14deg)}75%{transform:rotate(14deg)}}'
    + '.cpop-name{font-weight:800;font-size:15px;color:#fff;flex:1;line-height:1.15;}'
    + '.cpop-x{cursor:pointer;color:#7c8aa5;font-size:18px;line-height:1;padding:2px 4px;border-radius:6px;}'
    + '.cpop-x:hover{background:rgba(255,255,255,.08);color:#cdd7e6;}'
    + '.cpop-sum{padding:0 12px 10px;color:#9fb0c9;font-size:13px;line-height:1.35;}'
    + '.cpop-open{display:block;text-align:center;text-decoration:none;background:#2f6bff;color:#fff;font-weight:800;'
    + 'font-size:14px;padding:11px;letter-spacing:.2px;}'
    + '.cpop-open:hover{background:#4079ff;}'
    + '.cpop.warr{border-color:#a06a2c;} .cpop.warr .cpop-open{background:#b5792f;} .cpop.warr .cpop-open:hover{background:#c9873a;}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var wrap = document.createElement('div');
  wrap.id = 'cpopWrap';
  function mount() { (document.body || document.documentElement).appendChild(wrap); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  // A soft, brief chime so a heads-down dispatcher notices the ring. Best-effort — stays
  // silent until the page has had any user interaction (browser autoplay rule); office
  // pages always have. Never blares.
  function chime() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      var ac = window.__cpopAC || (window.__cpopAC = new Ctx());
      if (ac.state === 'suspended') { ac.resume().catch(function () {}); }
      [880, 1174].forEach(function (f, i) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = f;
        var t = ac.currentTime + i * 0.14;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.24);
      });
    } catch (e) {}
  }

  function card(p) {
    var el = document.createElement('div');
    el.className = 'cpop' + (p.claim ? ' warr' : '');
    var warr = !!p.claim;
    el.innerHTML = ''
      + '<div class="cpop-top">'
      + '<span class="cpop-ring">' + (warr ? '📋' : '📞') + '</span>'
      + '<span class="cpop-name"></span>'
      + '<span class="cpop-x" title="Dismiss">×</span>'
      + '</div>'
      + '<div class="cpop-sum"></div>'
      + '<a class="cpop-open" target="_blank" rel="noopener">Open their tile →</a>';
    el.querySelector('.cpop-name').textContent = p.header || p.name || 'Incoming call';
    el.querySelector('.cpop-sum').textContent = p.summary || 'On the line now';
    var a = el.querySelector('.cpop-open'); a.href = p.link || '/office.html';
    function close() { el.classList.remove('in'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300); }
    el.querySelector('.cpop-x').addEventListener('click', close);
    a.addEventListener('click', function () { setTimeout(close, 60); });        // tap opens the tab, card fades
    wrap.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('in'); });
    setTimeout(close, 90000);                                                    // auto-clear after 90s if untouched
    return el;
  }

  var busy = false;
  function poll() {
    if (busy || document.hidden) return;
    busy = true;
    fetch(FEED + '?since_ms=' + startMs, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var pops = (d && d.pops) || [];
        var fresh = 0;
        pops.forEach(function (p) {
          if (!p || seen[p.id]) return;
          if (Number(p.at_ms) < startMs - 2000) { remember(p.id); return; }      // pre-load ring, skip
          remember(p.id); card(p); fresh++;
        });
        if (fresh) chime();
      })
      .catch(function () {})
      .then(function () { busy = false; });
  }
  setInterval(poll, POLL_MS);
  setTimeout(poll, 1200);
})();
