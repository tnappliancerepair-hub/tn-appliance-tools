/* ant-valuebar — the differentiator, loud on every customer page (Teddy, 2026-06-22):
   "$50 phone diagnosis, less than half the $100–150 everyone else charges, in half
   the time — just take a video + model pic from your phone, anytime 24/7, honest
   answer (even 'don't fix it') within 2 business hours."
   Self-injecting + self-guarding: never renders on internal office/tech tools, the
   intake page itself, or post-payment pages. Sticky top, responsive, links to intake. */
(function () {
  try {
    var p = (location.pathname || '').toLowerCase();
    // skip internal tools + the intake/thank-you pages (the bar's own destination)
    if (/office|tech-|tech\.|admin|teddy|warranty|money|payroll|dispatch|operator|needs-|dupe|cluster|frontdoor|schedule-sanity|callback|financial|call-performance|customer-search|job-detail|health-check|operator-status|agent-proposals|cash-pipeline|appliance-ai|book-repair|quick-check|pay-thanks|finish-upload|cash-tdr|signup|company-admin|melissa|recent-calls|media-board|cash-leads|vacation|parts-ledger|parts-orders|parts-finder|view-job|dashboard|leaderboard|payout|tech-day|tech-scheduler|crew|loop-control/.test(p)) return;
    if (document.getElementById('ant-valuebar')) return;

    var css = ''
      + '#ant-valuebar{position:sticky;top:0;z-index:99999;background:linear-gradient(90deg,#ff6200,#ff8a3d);color:#160800;'
      + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;'
      + 'justify-content:center;gap:14px;padding:9px 14px;font-size:14px;line-height:1.3;box-shadow:0 2px 12px rgba(0,0,0,.28)}'
      + '#ant-valuebar .vb-txt b{font-weight:800}#ant-valuebar .vb-txt{font-weight:600;text-align:center}'
      + '#ant-valuebar a.vb-cta{flex:0 0 auto;background:#160800;color:#fff;text-decoration:none;font-weight:800;'
      + 'border-radius:999px;padding:7px 16px;font-size:13px;white-space:nowrap}'
      + '#ant-valuebar a.vb-cta:hover{background:#000}'
      + '#ant-valuebar a.vb-cta2{background:transparent;color:#160800;border:2px solid #160800;padding:5px 13px}'
      + '#ant-valuebar a.vb-cta2:hover{background:rgba(0,0,0,.12)}'
      + '@media(max-width:680px){#ant-valuebar a.vb-cta2{display:none}}'
      + '#ant-valuebar .vb-full{display:inline}#ant-valuebar .vb-short{display:none}'
      + '@media(max-width:680px){#ant-valuebar{font-size:12.5px;gap:9px;padding:8px 10px}'
      + '#ant-valuebar .vb-full{display:none}#ant-valuebar .vb-short{display:inline}}';
    var st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);

    var bar = document.createElement('div');
    bar.id = 'ant-valuebar';
    // Localize for city landing pages — title is "Appliance Repair {City} TN | …".
    // Falls back to the generic bar on any non-city page (no regression).
    var cityM = (document.title || '').match(/Appliance Repair\s+([A-Za-z][A-Za-z .'-]{1,26})\s+TN\b/);
    var city = cityM ? cityM[1].trim() : '';
    var inCity = city ? (' in <b>' + city + '</b>') : '';
    bar.innerHTML =
      '<div class="vb-txt">'
      + '<span class="vb-full">🔧 Broken appliance' + inCity + '? <b>Book a repair</b> — we text you right back. Or get a <b>$50 phone diagnosis</b> first (half the $100–150 others charge, answer in 2 hrs).</span>'
      + '<span class="vb-short">🔧 <b>Book a repair</b>' + inCity + ' — we text you right back.</span>'
      + '</div>'
      + '<a class="vb-cta" href="/book-repair.html">Book a Repair →</a>'
      + '<a class="vb-cta vb-cta2" href="/appliance-ai.html">$50 Quick Check</a>';

    function mount() { if (document.body && !document.getElementById('ant-valuebar')) document.body.insertBefore(bar, document.body.firstChild); }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  } catch (e) { /* never break a page over a banner */ }
})();
