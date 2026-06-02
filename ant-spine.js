// Unified workspace spine — single shared module dropped into every
// per-job page. Provides:
//   - window.Ant.role()             — 'tech' | 'office' | 'customer' | 'owner'
//   - window.Ant.jobId()            — number from URL ?job_id=
//   - window.Ant.deepLinkStrip()    — renders the cross-tool nav strip
//   - window.Ant.startLiveAwareness — polls get_job_event_stream every 30s,
//                                     fires 'ant:state-changed' DOM event
//                                     when latest_event_id increases
//
// Auto-runs on DOMContentLoaded if the page has a #ant-spine slot OR
// the URL has ?job_id= (in which case it injects the strip + starts polling).
//
// Drop into any page with: <script src="/ant-spine.js" defer></script>

(function (root) {
  'use strict';

  const XANO_BASE = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
  const POLL_INTERVAL_MS = 30 * 1000;

  // ── Role detection ─────────────────────────────────────────────
  // Heuristic stack — first match wins. Pages can override by setting
  // window.ANT_ROLE before this script loads.
  function detectRole() {
    if (root.ANT_ROLE) return root.ANT_ROLE;
    const path = (root.location.pathname || '').toLowerCase();
    const search = root.location.search || '';
    if (path.includes('tech-ant') || path.includes('tech-daily') || path.includes('tech-payouts') || path.includes('tech-performance')) return 'tech';
    if (path.includes('customer-portal') || path.includes('customer-feedback') || path.includes('cash-tdr-customer') || path.includes('upload.html') || /[?&](mode=resume|token=)/.test(search)) return 'customer';
    if (path.includes('teddy-tdr-tool') || path.includes('operator-status')) return 'owner';
    if (path.includes('office-') || path.includes('warranty-') || path.includes('needs-') || path.includes('job-detail') || path.includes('office.html')) return 'office';
    return 'office';
  }

  function detectJobId() {
    try {
      const u = new URLSearchParams(root.location.search);
      const v = u.get('job_id') || u.get('jobId') || u.get('job');
      return v ? Number(v) : 0;
    } catch (_) { return 0; }
  }

  // ── Cross-tool deep-link strip ─────────────────────────────────
  // Renders a thin nav bar with links to every other lens of the
  // current job. The current role's link is highlighted (you-are-here).
  function buildStrip(jobId, currentRole) {
    if (!jobId) return '';
    const lenses = [
      { role: 'owner',    label: '📋 Teddy Tool',    href: `/teddy-tdr-tool.html?job_id=${jobId}` },
      { role: 'tech',     label: '🔧 Tech View',     href: `/tech-ant-chat.html?job_id=${jobId}` },
      { role: 'office',   label: '📦 Warranty',      href: `/warranty-review.html?job_id=${jobId}` },
      { role: 'office',   label: '🗂 Job Detail',    href: `/job-detail.html?job_id=${jobId}` },
      { role: 'customer', label: '👤 Customer View', href: `/customer-portal.html?job_id=${jobId}` },
    ];
    const items = lenses.map((l) => {
      const isHere = l.role === currentRole && root.location.pathname.replace(/^\//, '') === l.href.replace(/^\//, '').split('?')[0];
      const style = `display:inline-block; padding:4px 10px; margin:0 4px; font-size:11px; font-family: ui-monospace, monospace; text-decoration:none; border-radius:12px; border:1px solid ${isHere ? 'rgba(116,227,196,0.6)' : 'rgba(255,255,255,0.15)'}; color:${isHere ? '#74e3c4' : '#9aa1ad'}; background:${isHere ? 'rgba(116,227,196,0.10)' : 'transparent'};`;
      return `<a href="${l.href}" style="${style}" target="${isHere ? '_self' : '_blank'}">${l.label}</a>`;
    }).join('');
    return `
      <div id="ant-spine-strip" style="position:fixed; top:0; left:0; right:0; z-index:9999; padding:6px 12px; background:rgba(8,10,14,0.92); backdrop-filter: blur(10px); border-bottom:1px solid rgba(255,255,255,0.06); display:flex; align-items:center; gap:6px; overflow-x:auto; white-space:nowrap;">
        <span style="font-size:10px; color:#5a6172; font-family: ui-monospace, monospace; padding-right:6px;">JOB #${jobId} ·</span>
        ${items}
        <span id="ant-spine-pulse" style="margin-left:auto; font-size:10px; color:#5a6172; font-family: ui-monospace, monospace;" title="live awareness">⚪ idle</span>
      </div>
      <div style="height:34px"></div>
    `;
  }

  function injectStrip(jobId, role) {
    const existing = root.document.getElementById('ant-spine-strip');
    if (existing) return;
    const wrap = root.document.createElement('div');
    wrap.innerHTML = buildStrip(jobId, role);
    while (wrap.firstChild) root.document.body.insertBefore(wrap.firstChild, root.document.body.firstChild);
  }

  function setPulse(state) {
    const el = root.document.getElementById('ant-spine-pulse');
    if (!el) return;
    const map = {
      idle:    { color: '#5a6172', icon: '⚪', label: 'idle' },
      polling: { color: '#9aa1ad', icon: '🟡', label: 'syncing' },
      ok:      { color: '#74e3c4', icon: '🟢', label: 'live' },
      change:  { color: '#4ca7ff', icon: '🔵', label: 'updated' },
      error:   { color: '#ff9d4a', icon: '🟠', label: 'offline' },
    };
    const s = map[state] || map.idle;
    el.style.color = s.color;
    el.textContent = `${s.icon} ${s.label}`;
  }

  // ── Live awareness polling ─────────────────────────────────────
  // Polls get_job_event_stream every POLL_INTERVAL_MS. When the
  // returned latest_event_id is greater than the last seen value,
  // fires a CustomEvent('ant:state-changed', { detail: payload })
  // on window. Pages can listen and re-render relevant pieces.
  function startLiveAwareness(jobId, opts) {
    if (!jobId) return null;
    const options = opts || {};
    let lastSeenId = 0;
    let lastPayload = null;
    let stopped = false;

    async function tick() {
      if (stopped) return;
      setPulse('polling');
      try {
        const url = `${XANO_BASE}/get_job_event_stream?job_id=${jobId}` + (lastSeenId > 0 ? `&since_id=${lastSeenId}` : '');
        const r = await fetch(url, { cache: 'no-store' });
        const d = await r.json();
        if (!d || !d.success) { setPulse('error'); return; }
        lastPayload = d;
        const newId = Number(d.latest_event_id || 0);
        if (newId > lastSeenId && lastSeenId > 0) {
          // Real change since last poll
          setPulse('change');
          root.dispatchEvent(new CustomEvent('ant:state-changed', { detail: d }));
          setTimeout(() => setPulse('ok'), 2500);
        } else {
          setPulse('ok');
        }
        // Always emit a fresh-data event for first poll + every tick
        root.dispatchEvent(new CustomEvent('ant:tick', { detail: d }));
        if (newId > lastSeenId) lastSeenId = newId;
      } catch (err) {
        setPulse('error');
      }
    }

    // Fire immediately, then on interval
    tick();
    const handle = root.setInterval(tick, options.intervalMs || POLL_INTERVAL_MS);

    return {
      stop: function () { stopped = true; root.clearInterval(handle); setPulse('idle'); },
      lastPayload: function () { return lastPayload; },
    };
  }

  // ── Public API ─────────────────────────────────────────────────
  root.Ant = root.Ant || {};
  root.Ant.role = detectRole;
  root.Ant.jobId = detectJobId;
  root.Ant.deepLinkStrip = injectStrip;
  root.Ant.startLiveAwareness = startLiveAwareness;
  root.Ant.spineVersion = '1.0.0';

  // ── Auto-init ──────────────────────────────────────────────────
  // If the page opted in by setting window.ANT_SPINE_AUTO=true OR has a
  // job_id in the URL, inject the strip + start polling automatically.
  function autoInit() {
    const jobId = detectJobId();
    const role = detectRole();
    const autoOptIn = root.ANT_SPINE_AUTO === true;
    const autoOptOut = root.ANT_SPINE_AUTO === false;
    if (autoOptOut) return;
    if (!autoOptIn && !jobId) return;
    if (jobId) {
      try { injectStrip(jobId, role); } catch (_) {}
      try { root._antSpineHandle = startLiveAwareness(jobId); } catch (_) {}
    }
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
