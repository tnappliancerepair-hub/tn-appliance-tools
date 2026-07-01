// Universal office search widget. Auto-injects a search bar at the top
// of any page that loads this file. One <script src="/office-search.js">
// tag per page is all that's needed.
//
// Searches name / phone / address across all jobs via
// /api:3e_TffpA/office_universal_search. Click a result → navigates to
// /job-detail.html?job_id=X.
(function () {
  'use strict';
  if (window.__officeSearchInjected) return;
  window.__officeSearchInjected = true;

  const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

  // CSS — kept compact, self-isolated
  const css = `
    .ofc-search-bar {
      position: sticky; top: 0; z-index: 1000;
      background: rgba(20, 24, 32, 0.95);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      padding: 8px 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .ofc-search-input {
      width: 100%;
      max-width: 720px;
      margin: 0 auto;
      display: block;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      color: #fff;
      padding: 10px 14px;
      font-size: 15px;
      outline: none;
    }
    .ofc-search-input::placeholder { color: rgba(255,255,255,0.45); }
    .ofc-search-input:focus { border-color: #5aa9ff; background: rgba(255,255,255,0.10); }
    .ofc-search-results {
      position: absolute;
      left: 12px; right: 12px;
      max-width: 720px;
      margin: 6px auto 0;
      background: #1a1f2c;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      max-height: 60vh;
      overflow-y: auto;
      box-shadow: 0 12px 28px rgba(0,0,0,0.4);
      display: none;
      z-index: 1001;
    }
    .ofc-search-results.show { display: block; }
    .ofc-search-row {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      cursor: pointer;
      color: #e8edf5;
      font-size: 14px;
    }
    .ofc-search-row:hover { background: rgba(90,169,255,0.10); }
    .ofc-search-row:last-child { border-bottom: none; }
    .ofc-search-row .name { font-weight: 600; }
    .ofc-search-row .meta { font-size: 12px; color: rgba(255,255,255,0.55); margin-top: 2px; }
    .ofc-search-status {
      padding: 14px; text-align: center; color: rgba(255,255,255,0.5);
      font-size: 13px; font-family: ui-monospace, Menlo, monospace;
    }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // Inject bar at the top of <body>. (TN/LA region toggle retired
  // 2026-06-01 along with office-tn.html / office-la.html — region split
  // folded into the unified dashboard.)
  const bar = document.createElement('div');
  bar.className = 'ofc-search-bar';
  bar.innerHTML = `
    <div style="max-width: 720px; margin: 0 auto; display: flex; align-items: center; gap: 8px;">
      <input class="ofc-search-input" id="ofcSearch" placeholder="Search name, phone, address…" autocomplete="off" inputmode="search" style="flex:1; max-width:none; margin:0;">
    </div>
    <div class="ofc-search-results" id="ofcSearchResults"></div>
  `;
  // Wait for body to exist
  function inject() {
    if (!document.body) { return setTimeout(inject, 20); }
    document.body.insertBefore(bar, document.body.firstChild);
    wire();
  }
  inject();

  let debounceTimer = null;
  function wire() {
    const input = document.getElementById('ofcSearch');
    const results = document.getElementById('ofcSearchResults');

    function hide() { results.classList.remove('show'); }
    function show() { results.classList.add('show'); }
    function setStatus(msg) {
      results.innerHTML = `<div class="ofc-search-status">${escapeHtml(msg)}</div>`;
      show();
    }

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(debounceTimer);
      if (q.length < 2) { hide(); return; }
      debounceTimer = setTimeout(() => runSearch(q, results), 300);
    });

    input.addEventListener('blur', () => { setTimeout(hide, 200); });
    input.addEventListener('focus', () => {
      if (input.value.trim().length >= 2) show();
    });
  }

  async function runSearch(q, resultsEl) {
    resultsEl.innerHTML = `<div class="ofc-search-status">Searching…</div>`;
    resultsEl.classList.add('show');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`${XANO_BASE}/office_universal_search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('server ' + r.status);
      const d = await r.json();
      if (!d.success || !d.items || d.items.length === 0) {
        resultsEl.innerHTML = `<div class="ofc-search-status">No matches.</div>`;
        return;
      }
      // The search returns the customer's NEWEST job — which can be a canceled
      // duplicate (e.g. a web-chat re-submission after an AHS dispatch). Resolve
      // any canceled hit to the customer's ACTIVE job so we never surface a
      // "canceled" that isn't the real story. (Teddy 2026-07-01.)
      let items = d.items.slice(0, 10);
      items = await Promise.all(items.map(resolveActive));
      // dedupe by resolved job_id (multiple dupes can resolve to the same job)
      const seenJ = new Set();
      items = items.filter(it => { const k = String(it.job_id); if (seenJ.has(k)) return false; seenJ.add(k); return true; });
      resultsEl.innerHTML = items.map(it => {
        const name = ((it.customer_first || '') + ' ' + (it.customer_last || '')).trim() || '(no name)';
        const meta = [it.customer_phone, it.address, it.city].filter(Boolean).join(' · ');
        const right = [it.appliance, it.warranty_company, it.scheduling_status].filter(Boolean).join(' · ');
        return `<div class="ofc-search-row" data-jid="${it.job_id}">
          <div class="name">${escapeHtml(name)}</div>
          <div class="meta">${escapeHtml(meta)}</div>
          <div class="meta">${escapeHtml(right)}</div>
        </div>`;
      }).join('');
      resultsEl.querySelectorAll('.ofc-search-row').forEach(row => {
        row.style.cursor = 'pointer';
        const navigate = (e) => {
          e.preventDefault();
          const jid = row.dataset.jid;
          if (jid) window.location.href = `/job-detail.html?job_id=${jid}`;
        };
        // click handles mouse + iOS Safari touch; touchend covers Android quirks
        row.addEventListener('click', navigate);
        row.addEventListener('touchend', navigate);
      });
    } catch (e) {
      clearTimeout(t);
      const msg = e && e.name === 'AbortError' ? 'Server timeout — try again.' : 'Search error.';
      resultsEl.innerHTML = `<div class="ofc-search-status">${msg}</div>`;
    }
  }

  // Given a search hit, if it's canceled, find the customer's ACTIVE job on the
  // same claim and return that instead (so we surface the real job, not a
  // canceled duplicate). Best-effort + fast; falls back to the original hit.
  async function resolveActive(it) {
    if (!it || !/cancel/i.test(String(it.scheduling_status || ''))) return it;
    try {
      const es = await fetch(`${XANO_BASE}/get_job_event_stream?job_id=${it.job_id}`).then(r => r.json());
      const claim = es && es.current_state && es.current_state.job && es.current_state.job.claim_number;
      if (!claim) return it;
      const cl = await fetch(`${XANO_BASE}/lookup_by_claim_number`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_or_dispatch_number: claim }),
      }).then(r => r.json());
      const active = (cl.matches || []).find(m => !/cancel|complete/i.test(String(m.scheduling_status || m.current_status || '')));
      if (active) return Object.assign({}, it, { job_id: active.id, scheduling_status: active.scheduling_status || 'scheduled' });
    } catch (_) {}
    return it;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
})();
