// office-scorecard — owner-only truth view for phone coverage + office output.
// Replaces "I worked 65 hours" with the timestamped record: what actually got done.
// Owner-gated (VAPI_ADMIN_SECRET).  GET ?secret=&days=7
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const SITE = 'https://tnapplianceexchange.net';
function json(c, o) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }

// "when is he coming / is he late" — the call type Teddy wants to kill.
const ARRIVAL_RE = /when.*(com|arriv|here|show)|is he (com|late|here|on)|running late|\beta\b|what time|how long|still com|on (his|the) way|almost|near/i;
const HUMAN_FLAGS = new Set(['asked_for_human_or_upset', 'repeated_human_requests']);

async function phoneSnapshot(adminSec) {
  try {
    const r = await fetch(`${SITE}/.netlify/functions/vapi-admin?secret=${encodeURIComponent(adminSec)}&action=daycalls`, { signal: AbortSignal.timeout(60000) });
    const d = await r.json().catch(() => ({}));
    const calls = Array.isArray(d.calls) ? d.calls : [];
    let asked_human = 0, arrival = 0, transferred = 0, dropped = 0;
    const arrivalCallers = new Set();
    for (const c of calls) {
      const flags = c.flags || [];
      const text = `${c.summary || ''} ${c.last_user || ''}`;
      if (flags.some((f) => HUMAN_FLAGS.has(f))) asked_human++;
      if (ARRIVAL_RE.test(text)) { arrival++; if (c.from) arrivalCallers.add(c.from); }
      if (c.ended === 'assistant-forwarded-call' || /forward|transfer/.test(String(c.ended))) transferred++;
      if (c.ended === 'silence-timed-out' || flags.includes('dropped_or_failed')) dropped++;
    }
    return { ok: true, total: d.total || calls.length, asked_human, arrival, arrival_distinct: arrivalCallers.size, transferred, dropped, window_hours: d.window_hours || 24 };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// Count event_log rows for an action within the window; capture the newest ts.
async function footprint(action, sinceMs) {
  // Deep-paginate (was a single 250-row page, which capped every high-volume action at
  // exactly 250 and undercounted the real total). Rows come id-desc (≈ newest first), so
  // once a full page falls entirely outside the window everything after is older too — stop.
  let n = 0, last = 0;
  try {
    for (let page = 1; page <= 40; page++) {   // up to 20k rows — ample for a ≤30-day window
      const rows = await crud.searchPageN(crud.TABLES.event_log, { action }, { id: 'desc' }, 500, page);
      const list = Array.isArray(rows) ? rows : (rows && rows.items) || [];
      if (!list.length) break;
      let anyInWindow = false;
      for (const r of list) {
        const t = Number(r.created_at || (r.metadata && r.metadata.at_ms) || 0);
        if (t && t >= sinceMs) { n++; if (t > last) last = t; anyInWindow = true; }
      }
      if (list.length < 500) break;   // exhausted
      if (!anyInWindow) break;         // whole page older than the window → done
    }
  } catch (_) {}
  return { n, last };
}

async function openCallbacks(adminSec) {
  // best-effort: the callbacks queue endpoint (owner-worked list)
  try {
    const r = await fetch(`https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA/list_callback_requests`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json().catch(() => null);
    const arr = Array.isArray(d) ? d : (d && (d.callbacks || d.items)) || [];
    const open = arr.filter((c) => !c.handled_at && !c.resolved_at && String(c.status || '').toLowerCase() !== 'handled');
    let oldest = 0;
    for (const c of open) { const t = Number(c.created_at || c.at_ms || 0); if (t && (!oldest || t < oldest)) oldest = t; }
    return { ok: true, open: open.length, oldest_ms: oldest };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });

  const days = Math.min(Math.max(parseInt(q.days, 10) || 7, 1), 30);
  const sinceMs = Date.now() - days * 86400000;

  const [phone, cb, sched, moves, invoices, texts, tdrs, checks] = await Promise.all([
    phoneSnapshot(admin),
    openCallbacks(admin),
    footprint('schedule_receipt', sinceMs),
    footprint('office_stage_set', sinceMs),
    footprint('office_invoice_logged', sinceMs),
    footprint('customer_sms_reply', sinceMs),
    footprint('create_tdr', sinceMs),
    footprint('office_checklist_set', sinceMs),
  ]);

  const lastActive = Math.max(sched.last, moves.last, invoices.last, texts.last, checks.last, 0);

  return json(200, {
    ok: true,
    generated_ms: Date.now(),
    window_days: days,
    phone_today: phone,
    callbacks: cb,
    office_footprint: {
      schedules_saved: sched.n,
      board_moves: moves.n,
      invoices_logged: invoices.n,
      customer_texts: texts.n,
      tdrs_filed: tdrs.n,
      checklist_ticks: checks.n,
      last_active_ms: lastActive,
    },
    note: 'phone_today = last 24h from Vapi; office_footprint = last N days from the system log. Transfers were OFF until 2026-07-21, so pre-fix "transferred" reads 0 — clean baseline starts now.',
  });
};
