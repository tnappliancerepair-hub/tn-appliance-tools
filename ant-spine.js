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
    if (path.includes('tech-')) return 'tech'; // tech-job, tech-simple, tech-daily, tech-ant, tech-payouts, …
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
  // Which lenses each role may even SEE in the strip. Customers must never be
  // shown links into tech/office/owner tools (they're internal); techs see
  // their job + the customer view; office/owner see everything.
  // Which lenses each role may SEE in the strip. 'tdr' is the report itself
  // (opens the TDR card). Techs now get the full working loop Teddy asked for:
  // Day (their dashboard) ↔ Job ↔ TDR ↔ Teddy Tool ↔ Customer. Customers see
  // nothing internal.
  const VISIBLE_LENSES = {
    customer: ['customer'],
    tech: ['day', 'job', 'tdr', 'owner', 'customer'],
    office: ['day', 'job', 'tdr', 'owner', 'office', 'customer'],
    owner: ['day', 'job', 'tdr', 'owner', 'office', 'customer'],
  };

  function techIdFromUrl() {
    try { const u = new URLSearchParams(root.location.search); return u.get('tech_id') || u.get('techId') || ''; } catch (_) { return ''; }
  }

  function buildStrip(jobId, currentRole) {
    if (!jobId) return '';
    if (currentRole === 'customer') return '';
    const allowed = VISIBLE_LENSES[currentRole] || ['customer'];
    const tid = techIdFromUrl();
    const tq = tid ? `&tech_id=${tid}` : '';
    const dayHref = `/tech-daily-dashboard.html${tid ? `?tech_id=${tid}` : ''}`;
    const lenses = [
      { lens: 'day',    match: 'tech-daily-dashboard', label: '🗓 Day',        href: dayHref },
      { lens: 'job',    match: 'tech-job',             label: '🔧 Job',        href: `/tech-job.html?job_id=${jobId}${tq}` },
      { lens: 'tdr',    match: '__tdr__',              label: '📝 TDR',        href: '#', tdr: true },
      { lens: 'owner',  match: 'teddy-tdr-tool',       label: '📋 Teddy Tool', href: `/teddy-tdr-tool.html?job_id=${jobId}${tq}` },
      { lens: 'office', match: 'warranty-review',      label: '📦 Warranty',   href: `/warranty-review.html?job_id=${jobId}` },
      { lens: 'office', match: 'job-detail',           label: '🗂 Job Detail', href: `/job-detail.html?job_id=${jobId}` },
      { lens: 'customer', match: 'customer-portal',    label: '👤 Customer',   href: `/customer-portal.html?job_id=${jobId}` },
    ].filter((l) => allowed.includes(l.lens));
    const here = root.location.pathname.replace(/^\//, '').toLowerCase();
    const items = lenses.map((l) => {
      const isHere = l.match !== '__tdr__' && here.indexOf(l.match) !== -1;
      const style = `display:inline-block; padding:5px 11px; margin:0 3px; font-size:11.5px; font-family: ui-monospace, monospace; text-decoration:none; border-radius:12px; border:1px solid ${isHere ? 'rgba(116,227,196,0.6)' : 'rgba(255,255,255,0.15)'}; color:${isHere ? '#74e3c4' : '#c4cbd6'}; background:${isHere ? 'rgba(116,227,196,0.12)' : 'transparent'}; font-weight:700;`;
      // TDR opens the report card in place; the rest are same-tab links so the
      // browser Back button returns you exactly where you were.
      if (l.tdr) return `<a href="#" onclick="window.Ant&&window.Ant.openTdr();return false;" style="${style}">${l.label}</a>`;
      return `<a href="${l.href}" style="${style}">${l.label}</a>`;
    }).join('');
    return `
      <div id="ant-spine-strip" style="position:fixed; top:0; left:0; right:0; z-index:9999; padding:6px 12px; background:rgba(8,10,14,0.94); backdrop-filter: blur(10px); border-bottom:1px solid rgba(255,255,255,0.06); display:flex; align-items:center; gap:4px; overflow-x:auto; white-space:nowrap;">
        <span style="font-size:10px; color:#5a6172; font-family: ui-monospace, monospace; padding-right:4px;">#${jobId} ·</span>
        ${items}
        <span id="ant-spine-pulse" style="margin-left:auto; font-size:10px; color:#5a6172; font-family: ui-monospace, monospace;" title="live awareness">⚪ idle</span>
      </div>
      <div style="height:34px"></div>
    `;
  }

  // 📝 TDR nav: open the report card in place if this surface has it; otherwise
  // deep-link to the job page and auto-open it there (#tdr). One tap from anywhere.
  function openTdr() {
    if (typeof root.antTdrOpen === 'function') { try { root.antTdrOpen(); return; } catch (_) {} }
    const jobId = detectJobId(); const tid = techIdFromUrl();
    if (jobId) root.location.href = `/tech-job.html?job_id=${jobId}${tid ? `&tech_id=${tid}` : ''}#tdr`;
  }

  function injectStrip(jobId, role) {
    const existing = root.document.getElementById('ant-spine-strip');
    if (existing) return;
    const html = buildStrip(jobId, role);
    if (!html) return; // customers (and any empty case) get no cross-tool strip
    const wrap = root.document.createElement('div');
    wrap.innerHTML = html;
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

  // Which LANE an outbound message went out on (two-lane separation, 2026-07-15):
  // human = the shared office/tech line (757-5500); ai = the AI line (588-9500).
  function laneOf(md) {
    const src = (md.source || '').toLowerCase();
    const lane = (md.lane || '').toLowerCase();
    const from = String(md.from || md.from_number || '').replace(/\D/g, '');
    if (lane === 'human' || src === 'human_line' || src === 'office_translated_reply' || src === 'tech_field' || from.endsWith('7575500') || from.endsWith('8578800')) return 'human';
    if (lane === 'ai' || from.endsWith('5889500')) return 'ai';
    return src ? 'ai' : 'human'; // customer_sms_reply w/o lane info = historically office
  }
  function whoOf(md, lane) {
    return md.sender || md.tech_name || (lane === 'human' ? 'Office' : 'Ant');
  }

  function classifyMessage(row) {
    const a = row.action || '';
    const md = row.metadata || {};
    const cls = (md.recipient_class || '').toLowerCase();
    const recipient = (md.recipient || '').toLowerCase();
    if (a === 'inbound_customer_sms_received') {
      return { direction: 'in', counterparty: 'customer', who: 'Customer' };
    }
    if (a === 'sms_sent' || a === 'sms_owner_bypass') {
      const ct = cls === 'internal' ? (recipient.endsWith('4855795') ? 'owner' : 'tech') : 'customer';
      // Raw send-envelope = the AI line / automated (human sends log customer_sms_reply, not sms_sent).
      return { direction: 'out', counterparty: ct, lane: 'ai', who: 'Ant' };
    }
    // The reply back to the customer — from a human (office/tech, 757-5500) or the AI.
    if (a === 'customer_sms_reply') {
      const lane = laneOf(md);
      return { direction: 'out', counterparty: 'customer', lane, who: whoOf(md, lane) };
    }
    if (a === 'sms_gated' || a === 'dropped_customer_sms') {
      return { direction: 'out', counterparty: 'customer', blocked: true };
    }
    if (a === 'feedback_sms_sent' || a === 'teddy_sms_triggered') {
      return { direction: 'out', counterparty: 'customer', lane: 'ai', who: 'Ant' };
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
      const body = (md.body_preview || md.body || md.response || md.message || md.text || md.reply || '').trim();
      if (!body && !c.blocked) continue;
      items.push({ row: m, cls: c, body });
    }
    if (items.length === 0) {
      return `<div style="padding:14px; text-align:center; color:#9aa1ad; font-size:12px;">No SMS in this thread yet.</div>`;
    }
    const html = items.map(({ row, cls, body }) => {
      const isIn = cls.direction === 'in';
      const emoji = (!isIn && cls.lane === 'ai') ? '🤖' : '👤';
      const name = cls.who || (isIn ? 'Customer' : 'Us');
      const laneNote = (!isIn && cls.lane === 'ai') ? ' · AI' : '';
      const labelColor = (!isIn && cls.lane === 'ai') ? '#b39dff' : (isIn ? '#8fc4ff' : '#74e3c4');
      const fade = cls.blocked ? 'opacity:0.5;' : '';
      const blockedNote = cls.blocked ? '<div style="font-size:10px; color:#ff9d4a; margin-top:4px;">⚠ blocked by gate</div>' : '';
      // Tint AI-line outbound violet so it's obviously the AI (read-only), never mistaken for a human's text.
      let bs = bubbleStyle(cls.direction, cls.counterparty);
      if (!isIn && cls.lane === 'ai') bs = bs.replace(/background:[^;]+;/, 'background:rgba(150,120,255,0.13);').replace(/border:[^;]+;/, 'border:1px solid rgba(150,120,255,0.4);');
      return `
        <div style="display:flex; flex-direction:column; padding:0 4px; ${fade}">
          <div style="${bs}">
            <div style="font-size:10px; color:${labelColor}; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; font-weight:700;">${emoji} ${name}${laneNote} · ${fmtTs(row.ts_ms)}</div>
            <div>${(body || '(blocked)').replace(/[<>&]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;' }[c]))}</div>
            ${blockedNote}
          </div>
        </div>`;
    }).join('');
    return `<div style="display:flex; flex-direction:column; gap:2px; padding:8px; max-height:50vh; overflow-y:auto;">${html}</div>`;
  }

  async function fetchSmsThread(jobId, hoursBack) {
    const h = Number(hoursBack || 720);
    // Phone-keyed thread (Netlify): returns the WHOLE conversation — inbound +
    // outbound + replies — not just rows tagged with this job_id. The old
    // get_sms_thread_for_job matched by job_id, but outbound sms_sent rows carry
    // no job_id, so it only showed a fragment. (Jimmy 2026-07-04.)
    try {
      const r = await fetch(`/.netlify/functions/sms-thread?job_id=${jobId}&hours_back=${h}`, { cache: 'no-store' });
      const d = await r.json();
      if (d && Array.isArray(d.messages)) return d.messages;
    } catch (_) {}
    // Fallback to the legacy XS endpoint if the function is unavailable.
    try {
      const r2 = await fetch(`${XANO_BASE}/get_sms_thread_for_job?job_id=${jobId}&hours_back=${h}`, { cache: 'no-store' });
      const d2 = await r2.json();
      return (d2 && d2.messages) || [];
    } catch (_) { return []; }
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

  // ── Unified Job Timeline (the central brain feed) ──────────────
  // Renders every event on a job in chronological order — TDR writes,
  // photos, calls, SMS, vision classifications, status changes,
  // warranty actions. Same data, role-filtered per viewer.
  const TIMELINE_ICON = {
    sms_sent: '📱', inbound_customer_sms_received: '📱', sms_owner_bypass: '📱', feedback_sms_sent: '📱', dropped_customer_sms: '📱',
    phone_call_summary: '📞', ant_field_assist_dispatched: '📞', ant_field_assist_call_summary_sent: '📞', vapi_call_completed: '📞',
    tdr_field_updated_from_voice: '📋', tdr_finalized_from_voice: '📋', tdr_submitted: '📋', tdr_write_from_sms: '📋',
    attachment_upload_completed: '📷', customer_intake_bundle_signal_emitted: '📷', ant_field_assist_photo_requested: '📷',
    vision_classification_saved: '🤖', attachment_vision_handled: '🤖', tdr_suggestion_drafted: '🤖',
    appointment_scheduled: '📅', appointment_reminder_sent: '📅', appointment_reminder_voice_placed: '📅', reschedule_call_due: '📅',
    job_started: '🔧', job_completed: '✅', job_canceled: '❌', tech_on_the_way: '🚗',
    warranty_submission_recorded: '📦', warranty_claim_action_persisted: '📦', warranty_status_watcher_parsed: '📦',
    new_job_greeting_sent: '👋', prediag_request_sent: '🧠',
    change_request_submitted: '💬', change_request_decided: '💬',
  };
  const TIMELINE_LABEL = {
    sms_sent: 'SMS sent', inbound_customer_sms_received: 'Customer text in', sms_owner_bypass: 'SMS (owner)', feedback_sms_sent: 'Feedback SMS', dropped_customer_sms: 'SMS held (gate)',
    phone_call_summary: 'Phone call', ant_field_assist_dispatched: 'Brooke called tech', ant_field_assist_call_summary_sent: 'Brooke call wrap', vapi_call_completed: 'Vapi call',
    tdr_field_updated_from_voice: 'TDR field (voice)', tdr_finalized_from_voice: 'TDR finalized (voice)', tdr_submitted: 'TDR submitted', tdr_write_from_sms: 'TDR field (SMS)',
    attachment_upload_completed: 'Photo uploaded', customer_intake_bundle_signal_emitted: 'Customer media in', ant_field_assist_photo_requested: 'Photo requested',
    vision_classification_saved: 'Vision tagged photo', attachment_vision_handled: 'Vision processed', tdr_suggestion_drafted: 'Ant TDR draft',
    appointment_scheduled: 'Appointment scheduled', appointment_reminder_sent: 'Reminder sent', appointment_reminder_voice_placed: 'Reminder call placed', reschedule_call_due: 'Reschedule call queued',
    job_started: 'Job started', job_completed: 'Job completed', job_canceled: 'Job canceled', tech_on_the_way: 'Tech on the way',
    warranty_submission_recorded: 'Warranty marked', warranty_claim_action_persisted: 'Warranty package built', warranty_status_watcher_parsed: 'Vendor status update',
    new_job_greeting_sent: 'Greeting SMS sent', prediag_request_sent: 'Pre-diag request',
    change_request_submitted: 'Change request in', change_request_decided: 'Change request decided',
  };

  // Per-role visibility: which actions a given role should see.
  const TIMELINE_ROLE_FILTERS = {
    customer: new Set([
      'sms_sent', 'inbound_customer_sms_received', 'feedback_sms_sent',
      'phone_call_summary',
      'attachment_upload_completed', 'customer_intake_bundle_signal_emitted',
      'appointment_scheduled', 'appointment_reminder_sent',
      'job_started', 'job_completed', 'tech_on_the_way',
      'new_job_greeting_sent',
    ]),
    // tech / office / owner see everything
  };

  function pickIcon(action) {
    const key = String(action || '').toLowerCase();
    if (TIMELINE_ICON[key]) return TIMELINE_ICON[key];
    if (/^sms/.test(key)) return '📱';
    if (/call|vapi/.test(key)) return '📞';
    if (/tdr/.test(key)) return '📋';
    if (/attach|photo|upload/.test(key)) return '📷';
    if (/vision/.test(key)) return '🤖';
    if (/appointment|schedul/.test(key)) return '📅';
    if (/warranty|submission/.test(key)) return '📦';
    return '•';
  }
  function pickLabel(action) {
    const key = String(action || '').toLowerCase();
    return TIMELINE_LABEL[key] || key.replace(/_/g, ' ');
  }
  function shouldShowForRole(action, role) {
    const allow = TIMELINE_ROLE_FILTERS[role];
    if (!allow) return true; // tech/office/owner see all
    return allow.has(String(action || '').toLowerCase());
  }
  function summarizeMetadata(action, metaStr) {
    if (!metaStr) return '';
    let m;
    try { m = typeof metaStr === 'string' ? JSON.parse(metaStr) : metaStr; }
    catch (_) { return ''; }
    if (!m || typeof m !== 'object') return '';
    if (action === 'tdr_field_updated_from_voice') return m.field ? `${m.field}: filled` : '';
    if (action === 'phone_call_summary') {
      const dur = m.duration_sec ? `${Math.round(m.duration_sec / 60)}min` : '';
      const sum = (m.summary || '').slice(0, 140);
      return [dur, sum].filter(Boolean).join(' · ');
    }
    if (action === 'attachment_upload_completed') return m.s3_key ? '' : '';
    if (action === 'vision_classification_saved') return m.classification ? `${m.classification} (${m.confidence}%)` : '';
    if (action === 'sms_sent' || action === 'feedback_sms_sent') return (m.body || m.message || '').slice(0, 140);
    if (action === 'inbound_customer_sms_received') return (m.body || '').slice(0, 140);
    if (action === 'appointment_scheduled') return m.scheduled_start_ms ? new Date(Number(m.scheduled_start_ms)).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' CT' : '';
    if (action === 'change_request_submitted') return (m.title || '').slice(0, 120);
    return '';
  }
  function fmtRelative(tsMs) {
    const now = Date.now();
    const diff = now - Number(tsMs);
    if (!diff || diff < 0) return 'now';
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  }

  function renderTimeline(events, role, opts) {
    const limit = (opts && opts.limit) || 60;
    const filtered = (events || []).filter((e) => shouldShowForRole(e.action, role)).slice(0, limit);
    if (filtered.length === 0) {
      return '<div style="padding:14px;text-align:center;color:#9aa1ad;font-size:12px;">No activity yet on this job.</div>';
    }
    return '<div style="font-family:-apple-system,system-ui,sans-serif">' + filtered.map((e) => {
      const icon = pickIcon(e.action);
      const label = pickLabel(e.action);
      const summary = summarizeMetadata(e.action, e.metadata);
      const ts = Number(e.created_at) || 0;
      const rel = fmtRelative(ts);
      return `
        <div style="display:flex;gap:10px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);align-items:flex-start;">
          <div style="font-size:16px;line-height:1;width:22px;flex-shrink:0;">${icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
              <span style="font-size:12px;color:#cfd6e0;font-weight:600;">${label}</span>
              <span style="font-size:10px;color:#9aa1ad;font-family:monospace;flex-shrink:0;">${rel} ago</span>
            </div>
            ${summary ? `<div style="font-size:11px;color:#9aa1ad;line-height:1.4;margin-top:2px;word-break:break-word;">${summary.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : ''}
          </div>
        </div>
      `;
    }).join('') + '</div>';
  }

  async function fetchJobTimeline(jobId) {
    const r = await fetch(`${XANO_BASE}/get_job_event_stream?job_id=${jobId}`, { cache: 'no-store' });
    const d = await r.json();
    return {
      events: (d && d.events) || [],
      latestId: (d && d.latest_event_id) || 0,
      currentState: (d && d.current_state) || null,
    };
  }

  async function mountJobTimeline(jobId, mountElOrId, opts) {
    if (!jobId) return null;
    const mount = typeof mountElOrId === 'string' ? root.document.getElementById(mountElOrId) : mountElOrId;
    if (!mount) return null;
    const options = opts || {};
    const role = options.filterFor || detectRole();
    mount.innerHTML = '<div style="padding:14px;text-align:center;color:#9aa1ad;font-size:12px;">Loading job activity…</div>';
    try {
      const { events } = await fetchJobTimeline(jobId);
      mount.innerHTML = renderTimeline(events, role, options);
      if (!mount._antTimelineListener) {
        mount._antTimelineListener = async () => {
          try {
            const { events } = await fetchJobTimeline(jobId);
            mount.innerHTML = renderTimeline(events, role, options);
          } catch (_) {}
        };
        root.addEventListener('ant:state-changed', mount._antTimelineListener);
      }
      return { rerender: mount._antTimelineListener };
    } catch (err) {
      mount.innerHTML = `<div style="padding:14px;text-align:center;color:#ff6b6b;font-size:12px;">Timeline load failed: ${err.message}</div>`;
      return null;
    }
  }

  // ── Public API ─────────────────────────────────────────────────
  root.Ant = root.Ant || {};
  root.Ant.role = detectRole;
  root.Ant.jobId = detectJobId;
  root.Ant.deepLinkStrip = injectStrip;
  root.Ant.openTdr = openTdr;
  root.Ant.startLiveAwareness = startLiveAwareness;
  root.Ant.mountSmsThread = mountSmsThread;
  root.Ant.mountJobTimeline = mountJobTimeline;
  root.Ant.spineVersion = '1.2.0';

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
      // Auto-mount unified job timeline sentinel.
      const tlMount = root.document.getElementById('ant-job-timeline');
      if (tlMount) {
        try { mountJobTimeline(jobId, tlMount, { filterFor: role }); } catch (_) {}
      }
    }
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window);
