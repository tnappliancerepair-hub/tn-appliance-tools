// Universal office search. Instead of adding its own full-width bar (which
// stacked a SECOND band on top of the office-nav pill row and ate vertical
// space), it now drops a compact 🔍 pill INTO the office-nav row itself — so the
// top of the page is just the one pill bar. Tap the pill → a floating search
// box drops down under the nav; close it and it's gone. On pages without the
// office-nav row it falls back to a tiny standalone button. (Teddy 2026-07-03)
//
// Searches name / phone / address across all jobs via
// /api:3e_TffpA/office_universal_search. Click a result → the job's board tile.
(function () {
  'use strict';
  if (window.__officeSearchInjected) return;
  window.__officeSearchInjected = true;

  const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';

  const css = `
    #ofcSearchPill {
      flex-shrink: 0; white-space: nowrap; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px;
      background: rgba(90,169,255,0.13);
      border: 2px solid rgba(90,169,255,0.55);
      color: #7bb8ff; font-weight: 700; font-size: 14px;
      padding: 10px 16px; border-radius: 22px; line-height: 1;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #ofcSearchPill:active { transform: scale(0.96); }
    .ofc-search-overlay {
      position: fixed; left: 12px; right: 12px; z-index: 9500;
      max-width: 640px; margin: 0 auto;
      display: none;
    }
    .ofc-search-overlay.show { display: block; }
    .ofc-search-inputwrap { position: relative; display: flex; align-items: center; gap: 8px; }
    .ofc-search-input {
      flex: 1;
      background: #1a1f2c;
      border: 1px solid #5aa9ff;
      border-radius: 10px;
      color: #fff; padding: 11px 14px; font-size: 15px; outline: none;
      box-shadow: 0 12px 28px rgba(0,0,0,0.45);
    }
    .ofc-search-input::placeholder { color: rgba(255,255,255,0.45); }
    .ofc-search-close {
      width: 34px; height: 34px; flex-shrink: 0; border-radius: 50%; border: 0;
      background: #2a3040; color: #fff; font-size: 17px; line-height: 1; cursor: pointer; padding: 0;
    }
    .ofc-search-results {
      margin-top: 6px; background: #1a1f2c;
      border: 1px solid rgba(255,255,255,0.12); border-radius: 10px;
      max-height: 60vh; overflow-y: auto;
      box-shadow: 0 12px 28px rgba(0,0,0,0.5); display: none;
    }
    .ofc-search-results.show { display: block; }
    .ofc-search-row { padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; color: #e8edf5; font-size: 14px; }
    .ofc-search-row:hover { background: rgba(90,169,255,0.10); }
    .ofc-search-row:last-child { border-bottom: none; }
    .ofc-search-row .name { font-weight: 600; }
    .ofc-search-row .meta { font-size: 12px; color: rgba(255,255,255,0.55); margin-top: 2px; }
    .ofc-search-status { padding: 14px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px; font-family: ui-monospace, Menlo, monospace; }
    /* Fallback standalone bar (pages with no office-nav row) */
    .ofc-search-fallback { position: sticky; top: 0; z-index: 1000; display: flex; justify-content: flex-end; padding: 6px 12px; background: rgba(20,24,32,0.92); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(255,255,255,0.06); }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // The 🔍 pill (goes into the nav row) + the floating search overlay (fixed).
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.id = 'ofcSearchPill';
  pill.setAttribute('aria-label', 'Search jobs');
  pill.innerHTML = '🔍 <span>Search</span>';

  const overlay = document.createElement('div');
  overlay.className = 'ofc-search-overlay';
  overlay.innerHTML = `
    <div class="ofc-search-inputwrap">
      <input class="ofc-search-input" id="ofcSearch" placeholder="Search name, phone, address…" autocomplete="off" inputmode="search">
      <button type="button" class="ofc-search-close" id="ofcSearchClose" aria-label="Close search" title="Close">✕</button>
    </div>
    <div class="ofc-search-results" id="ofcSearchResults"></div>
  `;

  let debounceTimer = null;
  let mountedInNav = false;
  // The search endpoint runs ~7-8s, so keystrokes can resolve OUT OF ORDER — an earlier
  // "Kar" request landing after "Karen" and stomping the good results with "No matches"
  // (Teddy 2026-08-12: "it'll say nothing found, and then it'll find it"). A monotonic
  // token makes only the LATEST query allowed to paint; every older one is discarded.
  let searchSeq = 0;
  let activeCtrl = null;

  // Try to drop the pill into the office-nav row. That row renders on
  // DOMContentLoaded, so poll briefly; fall back to a tiny standalone bar.
  let tries = 0;
  function mount() {
    if (!document.body) return setTimeout(mount, 20);
    const nav = document.getElementById('office-topnav');
    if (nav) {
      nav.appendChild(pill);
      mountedInNav = true;
    } else if (tries++ < 60) {          // wait up to ~1.8s for office-nav
      return setTimeout(mount, 30);
    } else {
      const bar = document.createElement('div');
      bar.className = 'ofc-search-fallback';
      bar.appendChild(pill);
      document.body.insertBefore(bar, document.body.firstChild);
    }
    document.body.appendChild(overlay);
    wire();
  }
  mount();

  function wire() {
    const input = document.getElementById('ofcSearch');
    const results = document.getElementById('ofcSearchResults');
    const closeBtn = document.getElementById('ofcSearchClose');

    function hideResults() { results.classList.remove('show'); results.innerHTML = ''; }

    function positionOverlay() {
      // Drop the box just under whatever bar the pill lives in.
      const anchor = mountedInNav ? document.getElementById('office-topnav') : pill;
      const rect = anchor.getBoundingClientRect();
      overlay.style.top = Math.max(6, rect.bottom + 6) + 'px';
    }

    function open() {
      positionOverlay();
      overlay.classList.add('show');
      input.value = '';
      hideResults();
      requestAnimationFrame(() => input.focus());
    }
    function close() {
      clearTimeout(debounceTimer);
      input.value = '';
      hideResults();
      overlay.classList.remove('show');
    }

    // Collapsed on every load / back-nav.
    close();
    window.addEventListener('pageshow', close);

    pill.addEventListener('click', () => { overlay.classList.contains('show') ? close() : open(); });
    closeBtn.addEventListener('click', (e) => { e.preventDefault(); close(); });

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(debounceTimer);
      if (q.length < 2) { hideResults(); return; }
      debounceTimer = setTimeout(() => runSearch(q, results), 300);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    // Tap outside the overlay AND outside the pill closes it.
    document.addEventListener('mousedown', (e) => { if (overlay.classList.contains('show') && !overlay.contains(e.target) && e.target !== pill && !pill.contains(e.target)) close(); });
    document.addEventListener('touchstart', (e) => { if (overlay.classList.contains('show') && !overlay.contains(e.target) && e.target !== pill && !pill.contains(e.target)) close(); }, { passive: true });
  }

  async function runSearch(q, resultsEl) {
    // Claim the latest-query token, and abort whatever was still in flight so a slow
    // older request can't come back and overwrite us.
    const mySeq = ++searchSeq;
    if (activeCtrl) { try { activeCtrl.abort(); } catch (_) {} }
    const stale = () => mySeq !== searchSeq;           // a newer keystroke has taken over

    resultsEl.innerHTML = `<div class="ofc-search-status">Searching…</div>`;
    resultsEl.classList.add('show');
    // office_universal_search scans every job and now runs ~7-8s on the grown
    // board — right at the old 8s abort, so a real match (e.g. "Selvish Capers")
    // randomly showed "Server timeout." Give it real headroom. (Teddy 2026-07-07)
    const ctrl = new AbortController();
    activeCtrl = ctrl;
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ctrl.abort(); }, 20000);
    try {
      const r = await fetch(`${XANO_BASE}/office_universal_search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (stale()) return;                             // a newer query already owns the results box
      if (!r.ok) throw new Error('server ' + r.status);
      const d = await r.json();
      if (stale()) return;
      if (!d.success || !d.items || d.items.length === 0) {
        resultsEl.innerHTML = `<div class="ofc-search-status">No matches.</div>`;
        return;
      }
      // The search returns the customer's NEWEST job — which can be a canceled
      // duplicate. Resolve any canceled hit to the customer's ACTIVE job so we
      // never surface a "canceled" that isn't the real story. (Teddy 2026-07-01.)
      let items = d.items.slice(0, 10);
      items = await Promise.all(items.map(resolveActive));
      if (stale()) return;                             // resolveActive added awaits — re-check
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
          // Land on the job's board TILE (the actionable drawer), not a read-only page.
          if (jid) window.location.href = `/office-board.html?job=${jid}`;
        };
        row.addEventListener('click', navigate);
        row.addEventListener('touchend', navigate);
      });
    } catch (e) {
      clearTimeout(t);
      // A newer keystroke superseded us (its abort() landed here) — stay silent; the
      // newer query owns the box. Only a REAL 20s timeout or error on the CURRENT query
      // may paint a message.
      if (stale()) return;
      if (e && e.name === 'AbortError' && !timedOut) return;
      const msg = (timedOut || (e && e.name === 'AbortError')) ? 'Server timeout — try again.' : 'Search error.';
      resultsEl.innerHTML = `<div class="ofc-search-status">${msg}</div>`;
    } finally {
      if (activeCtrl === ctrl) activeCtrl = null;
    }
  }

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
