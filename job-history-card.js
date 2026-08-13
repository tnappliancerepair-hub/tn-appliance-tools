// job-history-card — drops a "🔧 Previous visits" card onto a job surface so the tech (and
// office) always see what was done on this customer's appliance last time, even when the
// return trip is a separate job record. Reads /job-history and renders prior visits with
// the diagnosis + PART NUMBER from each. (Teddy 2026-08-13, from Jimmy's "no history / can't
// find the part I put in.")
//
// Auto-mounts on any page whose URL carries ?job_id= (e.g. tech-job.html). Other surfaces
// (office board drawer) call window.AntJobHistory.mount(jobId, targetEl) when they open.
(function () {
  'use strict';
  var API = '/.netlify/functions/job-history';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function urlJob() { try { return Number(new URLSearchParams(location.search).get('job_id') || 0); } catch (e) { return 0; } }

  var CSS = ''
    + '.ajh-card{border:1px solid rgba(128,128,128,.35);border-radius:14px;background:#fffef8;color:#1a1a1a;'
    + 'margin:12px 0;padding:12px 14px;box-shadow:0 2px 10px rgba(0,0,0,.08);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'
    + '.ajh-h{font-weight:700;font-size:14px;letter-spacing:.01em;margin-bottom:8px;color:#8a4b12}'
    + '.ajh-row{display:block;text-decoration:none;color:inherit;border-top:1px solid rgba(128,128,128,.2);padding:9px 2px}'
    + '.ajh-row:first-of-type{border-top:0}'
    + '.ajh-top{font-size:14px}.ajh-top b{font-weight:700}'
    + '.ajh-st{float:right;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}'
    + '.ajh-parts{margin-top:3px;font-size:14px;font-weight:600;color:#8a4b12}'
    + '.ajh-dx{margin-top:2px;font-size:13px;color:#4b5563}';

  function render(data, target) {
    if (!data || !data.prior || !data.prior.length) return null;
    if (!target) return null;
    if (target.querySelector && target.querySelector('.ajh-card')) return null; // no dupes
    var rows = data.prior.map(function (p) {
      var parts = [];
      if (p.part) parts.push('🔩 ' + esc(p.part));
      if (p.failed_component) parts.push(esc(p.failed_component));
      return '<a class="ajh-row" href="/tech-job.html?job_id=' + p.job_id + '">'
        + '<div class="ajh-top"><span class="ajh-st">' + esc(p.status || '') + '</span>'
        + '<b>' + esc(p.when || '—') + '</b>' + (p.tech ? ' · ' + esc(p.tech) : '') + (p.appliance ? ' · ' + esc(p.appliance) : '') + '</div>'
        + (parts.length ? '<div class="ajh-parts">' + parts.join(' · ') + '</div>' : '')
        + (p.diagnosis ? '<div class="ajh-dx">' + esc(p.diagnosis) + '</div>' : '')
        + '</a>';
    }).join('');
    var card = document.createElement('div');
    card.className = 'ajh-card';
    card.innerHTML = '<style>' + CSS + '</style>'
      + '<div class="ajh-h">🔧 Previous visits — this customer' + (data.appliance ? ' · ' + esc(data.appliance) : '') + '</div>' + rows;
    if (target.insertBefore) target.insertBefore(card, target.firstChild); else target.appendChild(card);
    return card;
  }

  function mount(jobId, target) {
    if (!jobId) return;
    fetch(API + '?job_id=' + encodeURIComponent(jobId))
      .then(function (r) { return r.json(); })
      .then(function (d) { render(d, target || (document.querySelector('#job-history-slot') || document.body)); })
      .catch(function () {});
  }

  window.AntJobHistory = { mount: mount, render: render };

  document.addEventListener('DOMContentLoaded', function () {
    var jid = urlJob();
    if (jid) mount(jid, document.querySelector('#job-history-slot') || document.querySelector('main') || document.body);
  });
})();
