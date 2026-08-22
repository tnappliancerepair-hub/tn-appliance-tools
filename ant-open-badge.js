// ant-open-badge.js — the 24/7·365 moat, on every customer page (Teddy 2026-08-21:
// "I'm all the way in on it — make sure everyone knows"). Loaded site-wide by
// ant-track.js. A slim fixed bottom bar: "we answer 24/7·365, even at 2am — get
// booked now." Honest: our AI chat + Ann answer around the clock (a live human is
// business hours; off-hours we still answer + book), so "we answer 24/7" is true.
//
// Self-gating like ant-amazon.js: shows ONLY on public customer/SEO pages — hard
// denylist for the office/tech/admin/txn tools. Dismissable (7 days). No layout
// shift (fixed), no deps, never blocks, safe on any page.
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  try {
    var path = (location.pathname || '').toLowerCase();
    // Don't show on the app/internal tools, or on the intake page itself (it already
    // carries the message + is where this bar sends people).
    var DENY = ['/office', '/tech', '/admin', '/dashboard', '/money', '/cash-tdr', '/teddy-tdr',
      '/warranty', '/pay', '/return', '/beat-the-boss', '/ant-brain', '/callbacks', '/creator',
      '/vendor', '/owner', '/gbp-', '/get-', '/appliance-ai', '/book', '/sign', '/upload',
      '/finish-upload', '/waiver', '/customer-portal', '/status', '/pay.html', '/always-open'];
    for (var i = 0; i < DENY.length; i++) { if (path.indexOf(DENY[i]) === 0 || path.indexOf(DENY[i]) > -1) return; }

    var OFF = 'tn_open_badge_off';
    try { var raw = localStorage.getItem(OFF); if (raw && (Date.now() - parseInt(raw, 10)) < 7 * 864e5) return; } catch (_) {}

    var CTA = '/appliance-ai.html?utm_source=open_badge&utm_medium=site&utm_campaign=always_open';
    var CALL = 'tel:+16292721234';  // primary Ann-routing customer line (24/7)
    var reduce = false; try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}

    function build() {
      if (document.getElementById('tn-open-badge')) return;
      var bar = document.createElement('div');
      bar.id = 'tn-open-badge';
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'We answer 24/7, 365 days a year');
      bar.style.cssText = [
        'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:99990',
        'background:linear-gradient(90deg,#0b1220,#111a2e)', 'color:#eef2fb',
        'font:600 14px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        'display:flex', 'align-items:center', 'gap:10px',
        'padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px))',
        'box-shadow:0 -6px 22px rgba(0,0,0,.28)', 'border-top:1px solid rgba(120,160,255,.25)'
      ].join(';');

      var dot = '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#31d67a;box-shadow:0 0 0 0 rgba(49,214,122,.6)' +
        (reduce ? '' : ';animation:tnpulse 1.8s infinite') + '"></span>';
      var msg = '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + dot +
        ' <b style="color:#fff">We answer 24/7·365</b> <span style="color:#b8c4de">— even at 2am. Not sure? Talk to Ann.</span></span>';
      var callBtn = '<a href="' + CALL + '" style="flex:0 0 auto;background:transparent;border:1.5px solid rgba(49,214,122,.55);color:#31d67a;text-decoration:none;font-weight:800;font-size:14px;padding:8px 12px;border-radius:10px;white-space:nowrap">📞 Talk to Ann</a>';
      var btn = '<a href="' + CTA + '" style="flex:0 0 auto;background:linear-gradient(135deg,#31d67a,#1aa85c);color:#04210f;text-decoration:none;font-weight:800;font-size:14px;padding:9px 14px;border-radius:10px;white-space:nowrap">Book →</a>';
      var x = '<button id="tn-open-x" aria-label="Dismiss" style="flex:0 0 auto;background:transparent;border:0;color:#8a97b4;font-size:20px;line-height:1;padding:4px 4px;cursor:pointer">×</button>';
      bar.innerHTML = msg + callBtn + btn + x;

      if (!document.getElementById('tn-open-style') && !reduce) {
        var st = document.createElement('style'); st.id = 'tn-open-style';
        st.textContent = '@keyframes tnpulse{0%{box-shadow:0 0 0 0 rgba(49,214,122,.55)}70%{box-shadow:0 0 0 8px rgba(49,214,122,0)}100%{box-shadow:0 0 0 0 rgba(49,214,122,0)}}';
        (document.head || document.documentElement).appendChild(st);
      }
      document.body.appendChild(bar);
      var xb = document.getElementById('tn-open-x');
      if (xb) xb.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        try { localStorage.setItem(OFF, String(Date.now())); } catch (_) {}
        bar.parentNode && bar.parentNode.removeChild(bar);
      });
    }
    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build);
  } catch (e) { /* never break a page */ }
})();
