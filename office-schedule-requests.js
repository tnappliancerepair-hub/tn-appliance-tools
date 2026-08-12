// office-schedule-requests — the office side of a CUSTOMER SCHEDULING REQUEST (Teddy
// 2026-08-12: "the customer's done their part; the office approves it, or if our guy won't
// be there that day, we call them back — 'since I've got you, what works for you?'"). When
// Ann files a request on a call, it lands as a by:customer hold; this slim banner surfaces
// every pending one on any office page so a scheduler sees it at a glance and acts:
//   • Open  → the job's tile, to approve/book it for real (or adjust the day)
//   • Release → clear the request (after they've booked it or called the customer back)
// It reads the same hold store the office board already uses. Non-intrusive: a thin bar
// that only appears when there's something to do.
//
// Drop-in: <script src="/office-schedule-requests.js"></script>
(function () {
  'use strict';
  if (window.__schedReqInjected) return;
  window.__schedReqInjected = true;

  var HOLD = '/.netlify/functions/schedule-hold';
  var POLL_MS = 20000;

  var css = ''
    + '#schedReqBar{position:fixed;left:12px;bottom:12px;z-index:98000;max-width:420px;'
    + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:none;}'
    + '#schedReqBar.show{display:block;}'
    + '.sreq-head{display:flex;align-items:center;gap:8px;background:#243b22;border:1px solid #3f6b39;'
    + 'color:#cdeec4;font-weight:800;font-size:13px;padding:9px 12px;border-radius:12px;cursor:pointer;'
    + 'box-shadow:0 10px 28px rgba(0,0,0,.4);}'
    + '.sreq-head .dot{width:8px;height:8px;border-radius:50%;background:#7ee06a;'
    + 'box-shadow:0 0 0 0 rgba(126,224,106,.6);animation:sreqPulse 1.8s infinite;}'
    + '@keyframes sreqPulse{0%{box-shadow:0 0 0 0 rgba(126,224,106,.55)}70%{box-shadow:0 0 0 8px rgba(126,224,106,0)}100%{box-shadow:0 0 0 0 rgba(126,224,106,0)}}'
    + '.sreq-head .chev{margin-left:auto;opacity:.7;}'
    + '.sreq-list{margin-top:8px;background:#141a26;border:1px solid #2b3348;border-radius:12px;overflow:hidden;'
    + 'box-shadow:0 12px 30px rgba(0,0,0,.45);display:none;}'
    + '#schedReqBar.open .sreq-list{display:block;}'
    + '.sreq-row{padding:10px 12px;border-top:1px solid #222a3a;}'
    + '.sreq-row:first-child{border-top:none;}'
    + '.sreq-name{color:#fff;font-weight:700;font-size:14px;}'
    + '.sreq-when{color:#8fd67f;font-weight:700;font-size:13px;margin-top:1px;}'
    + '.sreq-sub{color:#9fb0c9;font-size:12px;margin-top:1px;}'
    + '.sreq-acts{display:flex;gap:8px;margin-top:8px;}'
    + '.sreq-btn{flex:1;text-align:center;text-decoration:none;font-weight:800;font-size:13px;padding:8px;border-radius:8px;cursor:pointer;}'
    + '.sreq-open{background:#2f6bff;color:#fff;} .sreq-open:hover{background:#4079ff;}'
    + '.sreq-rel{background:#2a3142;color:#c3cee0;} .sreq-rel:hover{background:#39435a;}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var bar = document.createElement('div'); bar.id = 'schedReqBar';
  bar.innerHTML = '<div class="sreq-head"><span class="dot"></span><span class="sreq-count"></span><span class="chev">▾</span></div><div class="sreq-list"></div>';
  function mount() { (document.body || document.documentElement).appendChild(bar); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  var head = bar.querySelector('.sreq-head');
  var countEl = bar.querySelector('.sreq-count');
  var listEl = bar.querySelector('.sreq-list');
  head.addEventListener('click', function () { bar.classList.toggle('open'); });

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function prettyDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); if (!m) return iso || '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function release(jobId, rowEl) {
    fetch(HOLD, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'release', job_id: Number(jobId) }) })
      .then(function () { if (rowEl && rowEl.parentNode) rowEl.parentNode.removeChild(rowEl); setTimeout(poll, 400); })
      .catch(function () {});
  }

  function render(reqs) {
    if (!reqs.length) { bar.classList.remove('show'); return; }
    countEl.textContent = reqs.length + ' customer scheduling request' + (reqs.length > 1 ? 's' : '');
    listEl.innerHTML = '';
    reqs.forEach(function (r) {
      var row = document.createElement('div'); row.className = 'sreq-row';
      var when = prettyDate(r.date) + (r.time_pref ? ' · ' + esc(r.time_pref) : '');
      row.innerHTML = ''
        + '<div class="sreq-name">' + esc(r.customer || 'Customer') + (r.appliance ? ' <span style="color:#9fb0c9;font-weight:600">· ' + esc(r.appliance) + '</span>' : '') + '</div>'
        + '<div class="sreq-when">wants ' + when + '</div>'
        + '<div class="sreq-sub">they asked to be scheduled — approve on the tile, or call them back to adjust</div>'
        + '<div class="sreq-acts">'
        + '<a class="sreq-btn sreq-open" target="_blank" rel="noopener" href="/office-board.html?job=' + encodeURIComponent(r.job_id) + '">Open tile →</a>'
        + '<span class="sreq-btn sreq-rel">Release</span>'
        + '</div>';
      row.querySelector('.sreq-rel').addEventListener('click', function () { release(r.job_id, row); });
      listEl.appendChild(row);
    });
    bar.classList.add('show');
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
