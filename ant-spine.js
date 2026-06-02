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

  // ── Unified SMS thread per job ────────────────────────────────
  // Renders every inbound + outbound SMS for a job's customer into ONE
  // chronological feed. Each lens (tech/office/customer) can filter via
  // opts.filterFor — 'tech' hides internal-to-internal chatter, 'customer'
  // shows only their own thread, 'office'/'owner' shows everything.

  function bubbleStyle(direction, role) {
    const base = 'max-width:80%; padding:8px 12px; border-radius:14px; font-size:13px; line-height:1.4; margin:4px 0; word-break:break-word;';
    if (direction === 'in') {
      // Customer → us, or tech → us
      const color = role === 'tech' ? '#9d6cf3' : '#4ca7ff';
      return base + `align-self:flex-start; background:rgba(${role === 'tech' ? '157,108,243' : '76,167,255'},0.15); border:1px solid rgba(${role === 'tech' ? '157,108,243' : '76,167,255'},0.35); color:#e8eaf0;`;
    }
    // out (us → someone)
    return base + 'align-self:flex-end; background:rgba(116,227,196,0.12); border:1px solid rgba(116,227,196,0.35); color:#e8eaf0;';
  }

  function classifyMessage(row) {
    const a = row.action || '';
    const md = row.metadata || {};
    const cls = (md.recipient_class || '').toLowerCase();
    const recipient = (md.recipient || '').toLowerCase();
    const fromN = (md.from_number || '').toLowerCase();
    if (a === 'inbound_customer_sms_received') {
      return { direction: 'in', counterparty: 'customer' };
    }
    if (a === 'sms_sent' || a === 'sms_owner_bypass') {
      const ct = cls === 'internal' ? (recipient.endsWith('4855795') ? 'owner' : 'tech') : 'customer';
      return { direction: 'out', counterparty: ct };
    }
    if (a === 'sms_gated' || a === 'dropped_customer_sms') {
      return { direction: 'out', counterparty: 'customer', blocked: true };
    }
    if (a === 'feedback_sms_sent' || a === 'teddy_sms_triggered') {
      return { direction: 'out', counterparty: 'customer' };
    }
    return { direction: 'unknown', counterparty: 'unknown' };
  }

  function fmtTs(ms) {
    if (!ms) return '';
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms));
    } catch (_) { return ''; }
  }

  function renderThread(messages, opts) {
    const filterFor = opts.filterFor || 'office';
    const items = [];
    for (const m of messages) {
      const c = classifyMessage(m);
      // Lens filters
      if (filterFor === 'customer' && c.counterparty !== 'customer') continue;
      if (filterFor === 'tech' && c.counterparty === 'owner') continue;
      // Skip internal-to-internal noise on tech lens (owner alerts etc)
      const md = m.metadata || {};
      const body = (md.body_preview || md.body || md.response || '').trim();
      if (!body && !c.blocked) continue;
      items.push({ row: m, cls: c, body });
    }
    if (items.length === 0) {
      return `<div style="padding:14px; text-align:center; color:#9aa1ad; font-size:12px;">No SMS in this thread yet.</div>`;
    }
    const html = items.map(({ row, cls, body }) => {
      const tag = cls.counterparty + (cls.direction === 'in' ? ' →' : ' ←');
      const fade = cls.blocked ? 'opacity:0.5;' : '';
      const blockedNote = cls.blocked ? '<div style="font-size:10px; color:#ff9d4a; margin-top:4px;">⚠ blocked by gate</div>' : '';
      return `
        <div style="display:flex; flex-direction:column; padding:0 4px; ${fade}">
          <div style="${bubbleStyle(cls.direction, cls.counterparty)}">
            <div style="font-size:10px; color:#9aa1ad; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">${tag} · ${fmtTs(row.ts_ms)}</div>
            <div>${(body || '(blocked)').replace(/[<>&]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;' }[c]))}</div>
            ${blockedNote}
          </div>
        </div>`;
    }).join('');
    return `<div style="display:flex; flex-direction:column; gap:2px; padding:8px; max-height:50vh; overflow-y:auto;">${html}</div>`;
  }

  async function fetchSmsThread(jobId, hoursBack) {
    const h = Number(hoursBack || 720);
    const r = await fetch(`${XANO_BASE}/get_sms_thread_for_job?job_id=${jobId}&hours_back=${h}`, { cache: 'no-store' });
    const d = await r.json();
    return (d && d.messages) || [];
  }

  async function mountSmsThread(jobId, mountElOrId, opts) {
    if (!jobId) return null;
    const mount = typeof mountElOrId === 'string' ? root.document.getElementById(mountElOrId) : mountElOrId;
    if (!mount) return null;
    const options = opts || {};
    const filterFor = options.filterFor || detectRole();
    mount.innerHTML = '<div style="padding:14px; text-align:center; color:#9aa1ad; font-size:12px;">Loading SMS thread…</div>';
    try {
      const messages = await fetchSmsThread(jobId, options.hoursBack);
      mount.innerHTML = renderThread(messages, { filterFor });
      // Re-render on live awareness updates
      if (!mount._antSmsListener) {
        mount._antSmsListener = async () => {
          try {
            const msgs = await fetchSmsThread(jobId, options.hoursBack);
            mount.innerHTML = renderThread(msgs, { filterFor });
          } catch (_) {}
        };
        root.addEventListener('ant:state-changed', mount._antSmsListener);
      }
      return { rerender: mount._antSmsListener };
    } catch (err) {
      mount.innerHTML = `<div style="padding:14px; text-align:center; color:#ff6b6b; font-size:12px;">SMS thread load failed: ${err.message}</div>`;
      return null;
    }
  }

  // ── Public API ─────────────────────────────────────────────────
  root.Ant = root.Ant || {};
  root.Ant.role = detectRole;
  root.Ant.jobId = detectJobId;
  root.Ant.deepLinkStrip = injectStrip;
  root.Ant.startLiveAwareness = startLiveAwareness;
  root.Ant.mountSmsThread = mountSmsThread;
  root.Ant.spineVersion = '1.1.0';

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
      // Auto-mount SMS thread if the page has a sentinel element.
      const smsMount = root.document.getElementById('ant-sms-thread');
      if (smsMount) {
        try { mountSmsThread(jobId, smsMount, { filterFor: role }); } catch (_) {}
      }
    }
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
