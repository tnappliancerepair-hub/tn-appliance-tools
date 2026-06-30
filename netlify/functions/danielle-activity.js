// danielle-activity — what is the office actually DOING, by the numbers? Tallies
// the human/office event_log actions over a window so we can see what's repetitive
// and worth automating. (Teddy asked 2026-06-30: "anything repetitive we could
// automate?") Read-only.
//   GET ?secret=<admin>[&days=14]
'use strict';
const { getSecret } = require('./_lib/secrets');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const T = 3; // event_log
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// The actions that represent OFFICE/human work (not loop plumbing or tech-side).
const OFFICE_ACTIONS = {
  scheduling: ['danielle_schedule_parallel_job', 'appointment_scheduled_signal_emitted', 'job_reassigned', 'reassign_job'],
  status_moves: ['office_set_job_status', 'office_stage_set', 'office_remove_job'],
  filling_gaps: ['office_quick_fill', 'update_job_basics', 'update_job_full_info'],
  customer_texts: ['customer_sms_reply', 'translated_reply_sent', 'message_text_back_sent', 'job_status_sent'],
  warranty: ['warranty_submitted', 'record_warranty_submission', 'warranty_claim_action_persisted'],
  parts: ['record_parts_order', 'mark_parts_arrived', 'parts_return_label'],
  invoicing: ['record_job_invoice', 'office_invoice_logged'],
  chasing_techs: ['request_tech_report', 'send_office_to_tech_message'],
};

async function countAction(H, action, cutoff) {
  try {
    const r = await fetch(`${META}/table/${T}/content/search`, {
      method: 'POST', headers: H, body: JSON.stringify({ search: { action }, per_page: 500, page: 1, sort: { id: 'desc' } }),
    });
    if (!r.ok) return { total: 0, byDay: {} };
    const d = await r.json().catch(() => ({}));
    const rows = (d.items || []).filter((x) => { const m = x.created_at ? new Date(x.created_at).getTime() : Date.now(); return m >= cutoff; });
    const byDay = {};
    for (const x of rows) { const day = (x.created_at ? new Date(x.created_at).toISOString().slice(0, 10) : 'NA'); byDay[day] = (byDay[day] || 0) + 1; }
    return { total: rows.length, byDay };
  } catch (_) { return { total: 0, byDay: {} }; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  const tok = process.env.XANO_METADATA_TOKEN;
  if (!tok) return j(500, { ok: false, error: 'no metadata token' });
  const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
  const days = Math.max(1, Math.min(60, parseInt(q.days, 10) || 14));
  const cutoff = Date.now() - days * 86400000;

  const all = Array.from(new Set(Object.values(OFFICE_ACTIONS).flat()));
  const counts = {};
  await Promise.all(all.map(async (a) => { counts[a] = await countAction(H, a, cutoff); }));

  const groups = {};
  for (const [grp, acts] of Object.entries(OFFICE_ACTIONS)) {
    let total = 0; const detail = {};
    for (const a of acts) { const c = counts[a] || { total: 0 }; if (c.total) detail[a] = c.total; total += c.total; }
    groups[grp] = { total, detail };
  }
  const ranked = Object.entries(groups).sort((a, b) => b[1].total - a[1].total).map(([g, v]) => ({ category: g, count: v.total, per_day: Math.round((v.total / days) * 10) / 10, actions: v.detail }));

  return j(200, { ok: true, window_days: days, ranked });
};
