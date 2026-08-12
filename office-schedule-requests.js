// office-schedule-requests — the office side of a CUSTOMER SCHEDULING REQUEST (Teddy
// 2026-08-12: "the customer put in the effort to get on the schedule — we put in the effort
// to get them right. Hold their spot; if the part ETA or a tech in that city that day won't
// work, we CALL THEM BACK"). Ann files these on the call as by:customer holds; this bright,
// unmissable banner surfaces every pending one on any office page:
//   • Tap the card → the job's tile, to approve/book (or adjust the day)
//   • 📞 Call     → dials the customer to reschedule if the day can't route
//   • Release     → clears the request once it's handled
// Fluorescent so it can't be missed. Reads the same hold store the office board uses.
//
// Drop-in: <script src="/office-schedule-requests.js"></script>
(function () {
  'use strict';
  if (window.__schedReqInjected) return;
  window.__schedReqInjected = true;

  var HOLD = '/.netlify/functions/schedule-hold';
  var POLL_MS = 20000;
  var userClosed = false;   // once a user collapses it, respect that until a NEW request arrives
  var lastCount = 0;

  var css = ''
    + '#schedReqBar{position:fixed;left:14px;bottom:14px;z-index:98000;width:340px;max-width:calc(100vw - 28px);'
    + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:none;}'
    + '#schedReqBar.show{display:block;}'
    // FLUORESCENT header — neon lime, near-black text, glowing pulse. Impossible to miss.
    + '.sreq-head{display:flex;align-items:center;gap:9px;background:#c6ff00;color:#0a1400;'
    + 'font-weight:900;font-size:15px;letter-spacing:.3px;padding:12px 14px;border-radius:13px;cursor:pointer;'
    + 'border:2px solid #eaff6b;box-shadow:0 0 22px rgba(198,255,0,.75),0 8px 26px rgba(0,0,0,.45);'
    + 'text-transform:uppercase;animation:sreqGlow 1.5s ease-in-out infinite;}'
    + '@keyframes sreqGlow{0%,100%{box-shadow:0 0 16px rgba(198,255,0,.6),0 8px 26px rgba(0,0,0,.45)}'
    + '50%{box-shadow:0 0 34px rgba(198,255,0,.95),0 8px 26px rgba(0,0,0,.5)}}'
    + '.sreq-head .bell{font-size:18px;line-height:1;animation:sreqWig 1.1s ease-in-out infinite;}'
    + '@keyframes sreqWig{0%,100%{transform:rotate(0)}25%{transform:rotate(-16deg)}75%{transform:rotate(16deg)}}'
    + '.sreq-head .chev{margin-left:auto;font-size:13px;opacity:.8;}'
    + '.sreq-list{margin-top:9px;background:#0e1524;border:2px solid #c6ff00;border-radius:13px;overflow:hidden;'
    + 'box-shadow:0 0 18px rgba(198,255,0,.25),0 14px 32px rgba(0,0,0,.5);display:none;max-height:60vh;overflow-y:auto;}'
    + '#schedReqBar.open .sreq-list{display:block;}'
    + '.sreq-row{padding:12px 13px;border-top:1px solid #22304a;cursor:pointer;transition:background .12s;}'
    + '.sreq-row:first-child{border-top:none;}'
    + '.sreq-row:hover{background:#16223a;}'
    + '.sreq-name{color:#fff;font-weight:800;font-size:15px;line-height:1.2;}'
    + '.sreq-name .appl{color:#9fb0c9;font-weight:600;font-size:13px;}'
    + '.sreq-when{color:#c6ff00;font-weight:900;font-size:14px;margin-top:3px;}'
    + '.sreq-loc{color:#b9c6dc;font-size:12.5px;margin-top:3px;}'
    + '.sreq-tap{color:#6f8099;font-size:11px;margin-top:5px;font-style:italic;}'
    + '.sreq-acts{display:flex;gap:8px;margin-top:9px;}'
    + '.sreq-btn{flex:1;text-align:center;text-decoration:none;font-weight:800;font-size:13px;padding:9px;border-radius:8px;cursor:pointer;}'
    + '.sreq-open{background:#2f6bff;color:#fff;} .sreq-open:hover{background:#4079ff;}'
    + '.sreq-call{background:#1f7a3d;color:#eafff0;} .sreq-call:hover{background:#279149;}'
    + '.sreq-rel{background:#2a3142;color:#c3cee0;flex:0 0 auto;padding:9px 12px;} .sreq-rel:hover{background:#39435a;}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var bar = document.createElement('div'); bar.id = 'schedReqBar';
  bar.innerHTML = '<div class="sreq-head"><span class="bell">🔔</span><span class="sreq-count"></span><span class="chev">▾</span></div><div class="sreq-list"></div>';
  function mount() { (document.body || document.documentElement).appendChild(bar); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  var head = bar.querySelector('.sreq-head');
  var countEl = bar.querySelector('.sreq-count');
  var listEl = bar.querySelector('.sreq-list');
  head.addEventListener('click', function () { bar.classList.toggle('open'); userClosed = !bar.classList.contains('open'); });

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function prettyDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); if (!m) return iso || '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function prettyPhone(p) { var d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : (p || ''); }

  function release(jobId, rowEl) {
    fetch(HOLD, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'release', job_id: Number(jobId) }) })
      .then(function () { if (rowEl && rowEl.parentNode) rowEl.parentNode.removeChild(rowEl); setTimeout(poll, 400); })
      .catch(function () {});
  }

  function render(reqs) {
    if (!reqs.length) { bar.classList.remove('show'); lastCount = 0; return; }
    countEl.textContent = reqs.length + ' customer scheduling request' + (reqs.length > 1 ? 's' : '');
    listEl.innerHTML = '';
    reqs.forEach(function (r) {
      var row = document.createElement('div'); row.className = 'sreq-row';
      var when = prettyDate(r.date) + (r.time_pref ? ' · ' + esc(r.time_pref) : '');
      var loc = [r.city, r.zip].filter(Boolean).join(', ');
      var ph = prettyPhone(r.phone);
      var locLine = [loc, ph].filter(Boolean).join('  ·  📞 ');
      var tile = '/office-board.html?job=' + encodeURIComponent(r.job_id);
      row.innerHTML = ''
        + '<div class="sreq-name">' + esc(r.customer || 'Customer') + (r.appliance ? ' <span class="appl">· ' + esc(r.appliance) + '</span>' : '') + '</div>'
        + '<div class="sreq-when">wants ' + when + '</div>'
        + (locLine ? '<div class="sreq-loc">' + esc(locLine) + '</div>' : '')
        + '<div class="sreq-tap">they made the effort — get them on, or call to adjust</div>'
        + '<div class="sreq-acts">'
        + '<a class="sreq-btn sreq-open" target="_blank" rel="noopener" href="' + tile + '">Open tile →</a>'
        + (ph ? '<a class="sreq-btn sreq-call" href="tel:' + encodeURIComponent(String(r.phone).replace(/\D/g, '')) + '">📞 Call</a>' : '')
        + '<span class="sreq-btn sreq-rel">Release</span>'
        + '</div>';
      // Tapping the card body (not a button) opens the tile in a new tab.
      row.addEventListener('click', function (e) {
        if (e.target.closest('.sreq-btn')) return;
        window.open(tile, '_blank', 'noopener');
      });
      row.querySelector('.sreq-rel').addEventListener('click', function (e) { e.stopPropagation(); release(r.job_id, row); });
      listEl.appendChild(row);
    });
    bar.classList.add('show');
    // Auto-open when a NEW request arrives (so it can't be missed), unless the user
    // just collapsed it and nothing new has come in.
    if (reqs.length > lastCount) { bar.classList.add('open'); userClosed = false; }
    else if (!userClosed) { bar.classList.add('open'); }
    lastCount = reqs.length;
  }

  var busy = false;
  function poll() {
    if (busy || document.hidden) return; busy = true;
    fetch(HOLD, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var holds = (d && d.holds) || [];
        var reqs = holds.filter(function (h) { return h && h.by === 'customer' && h.date; })
          .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
        render(reqs);
      })
      .catch(function () {})
      .then(function () { busy = false; });
  }
  setInterval(poll, POLL_MS);
  setTimeout(poll, 1500);
})();
