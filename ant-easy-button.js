// ant-easy-button.js — THE Easy Button (Teddy 2026-08-22: "We're the easy button!
// We should have an easy button on our pages"). A bold, unmistakable floating button
// on every customer page: one tap → the easiest ways to get a broken machine handled
// (call & talk to Ann, text us, or start online with a quick video). The idea made
// physical — "broken machine? one tap, we take it from here."
//
// Loaded site-wide by ant-track.js. Self-gates like ant-open-badge/ant-amazon: shows
// ONLY on public customer pages (hard denylist for office/tech/admin/txn tools + the
// intake page itself, which IS the easy path). Uses the MAIN Ann line (629-272-1234);
// the ads line (615-845-8500) is kept separate for paid-lead attribution. Real <a>
// hrefs so ant-track's delegated listener auto-fires the GA call/text/intake events.
// No deps, no layout shift (fixed), theme-neutral (own card colors), a11y + reduced-
// motion aware. Sits above the 24/7 badge bar so they stack cleanly.
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  try {
    var path = (location.pathname || '').toLowerCase();
    var DENY = ['/office', '/tech', '/admin', '/dashboard', '/money', '/cash-tdr', '/teddy-tdr',
      '/warranty', '/pay', '/return', '/beat-the-boss', '/ant-brain', '/callbacks', '/creator',
      '/vendor', '/owner', '/gbp-', '/get-', '/appliance-ai', '/book', '/sign', '/upload',
      '/finish-upload', '/waiver', '/customer-portal', '/status', '/pay.html'];
    for (var i = 0; i < DENY.length; i++) { if (path.indexOf(DENY[i]) > -1) return; }

    var CALL = 'tel:+16292721234';
    var TEXT = 'sms:+16292721234';
    var ONLINE = '/appliance-ai.html?utm_source=easy_button&utm_medium=site&utm_campaign=easy_button';
    var reduce = false; try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}

    function build() {
      if (document.getElementById('tn-easy')) return;

      // ── styles (scoped by #tn-easy prefix) ──
      if (!document.getElementById('tn-easy-style')) {
        var st = document.createElement('style'); st.id = 'tn-easy-style';
        st.textContent =
          '#tn-easy{position:fixed;right:16px;bottom:calc(74px + env(safe-area-inset-bottom,0px));z-index:99992;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
          '#tn-easy-fab{display:inline-flex;align-items:center;gap:9px;border:0;cursor:pointer;color:#fff;font-weight:900;font-size:15px;letter-spacing:.01em;padding:13px 18px;border-radius:999px;background:linear-gradient(135deg,#ff6a2b,#e5301a);box-shadow:0 8px 26px rgba(229,48,26,.45)}' +
          '#tn-easy-fab .z{font-size:17px;line-height:1}' +
          (reduce ? '' : '#tn-easy-fab{animation:tnEasyPulse 2.4s infinite}@keyframes tnEasyPulse{0%{box-shadow:0 8px 26px rgba(229,48,26,.45),0 0 0 0 rgba(229,48,26,.5)}70%{box-shadow:0 8px 26px rgba(229,48,26,.45),0 0 0 14px rgba(229,48,26,0)}100%{box-shadow:0 8px 26px rgba(229,48,26,.45),0 0 0 0 rgba(229,48,26,0)}}') +
          '#tn-easy-sheet{position:absolute;right:0;bottom:60px;width:290px;max-width:78vw;background:#0e1524;color:#eef2fb;border:1px solid rgba(120,160,255,.22);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.5);padding:16px;display:none}' +
          '#tn-easy.open #tn-easy-sheet{display:block}' +
          '#tn-easy-sheet h4{margin:0 0 3px;font-size:16px;font-weight:800;color:#fff}' +
          '#tn-easy-sheet .sub{margin:0 0 13px;font-size:12.5px;color:#aab6d4}' +
          '#tn-easy-sheet a.row{display:flex;align-items:center;gap:12px;text-decoration:none;color:#eef2fb;background:#16203400;border:1px solid rgba(120,160,255,.18);border-radius:12px;padding:12px 13px;margin-bottom:9px}' +
          '#tn-easy-sheet a.row:last-of-type{margin-bottom:4px}' +
          '#tn-easy-sheet a.row .ic{font-size:20px;width:26px;text-align:center;flex:0 0 auto}' +
          '#tn-easy-sheet a.row b{display:block;font-size:14.5px;font-weight:800}' +
          '#tn-easy-sheet a.row span{display:block;font-size:12px;color:#aab6d4}' +
          '#tn-easy-sheet a.row.go{background:linear-gradient(135deg,#31d67a,#1aa85c);border:0;color:#04210f}' +
          '#tn-easy-sheet a.row.go b{color:#04210f}#tn-easy-sheet a.row.go span{color:#0a3d22}' +
          '#tn-easy-foot{margin-top:10px;font-size:11.5px;color:#8a97b4;text-align:center}' +
          '#tn-easy-x{position:absolute;top:9px;right:11px;background:transparent;border:0;color:#8a97b4;font-size:19px;line-height:1;cursor:pointer;padding:4px}';
        (document.head || document.documentElement).appendChild(st);
      }

      var wrap = document.createElement('div');
      wrap.id = 'tn-easy';
      wrap.innerHTML =
        '<div id="tn-easy-sheet" role="dialog" aria-label="Easy Button - get help now">' +
          '<button id="tn-easy-x" aria-label="Close">×</button>' +
          '<h4>Broken machine? We\'ve got it.</h4>' +
          '<p class="sub">Pick the easy way - we take it from there.</p>' +
          '<a class="row" href="' + CALL + '"><span class="ic">📞</span><span><b>Call &amp; talk to Ann</b><span>Answered 24/7 - even at 2am</span></span></a>' +
          '<a class="row" href="' + TEXT + '"><span class="ic">💬</span><span><b>Text us</b><span>Tell us what\'s wrong</span></span></a>' +
          '<a class="row go" href="' + ONLINE + '"><span class="ic">📸</span><span><b>Start online</b><span>Send a quick video - get an honest answer</span></span></a>' +
          '<div id="tn-easy-foot">One tap, any hour. No forms, no runaround.</div>' +
        '</div>' +
        '<button id="tn-easy-fab" aria-expanded="false" aria-controls="tn-easy-sheet"><span class="z">⚡</span> Easy Button</button>';
      document.body.appendChild(wrap);

      var fab = document.getElementById('tn-easy-fab');
      var xb = document.getElementById('tn-easy-x');
      function setOpen(on) {
        wrap.classList.toggle('open', on);
        fab.setAttribute('aria-expanded', on ? 'true' : 'false');
      }
      fab.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!wrap.classList.contains('open')); });
      if (xb) xb.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); setOpen(false); });
      // tap outside closes; taps on the action links close after navigating
      document.addEventListener('click', function (e) { if (wrap.classList.contains('open') && !wrap.contains(e.target)) setOpen(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    }

    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build);
  } catch (e) { /* never break a page */ }
})();
