// office-activity — OWNER-ONLY daily readout of what happened in the office.
// "Between you and me" (Teddy): gated by his tech PIN (technician_id 1), NOT the
// office password (Danielle has that). Reads today's human/office actions from
// event_log via the Metadata API and returns a clean timeline + counts.
//
//   POST { pin, days?:0 }   ->  { ok, day_ct, counts{}, timeline[] }

'use strict';

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const SITE = 'https://tnapplianceexchange.net';
const EVENT_LOG_TABLE = 3;

function headers() {
  const t = process.env.XANO_METADATA_TOKEN;
  if (!t) throw new Error('XANO_METADATA_TOKEN not set');
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}

// Human/office actions worth surfacing, with friendly labels.
const ACTIONS = {
  danielle_schedule_parallel_job: 'Scheduled (tech + day)',
  appointment_scheduled_signal_emitted: 'Appointment set',
  office_set_job_status: 'Status changed',
  job_state_transition: 'Board move',
  office_remove_job: 'Deleted / archived',
  reassign_job: 'Reassigned tech',
  job_basics_updated: 'Edited job info',
  office_quick_fill: 'Filled claim / phone',
  mark_parts_arrived: 'Parts marked arrived',
  mark_callback_handled: 'Callback handled',
  record_job_invoice: 'Invoice logged',
  create_tdr: 'TDR filed',
  tech_job_started: 'Tech started job',
  tech_job_complete: 'Tech completed job',
  customer_feedback_received: 'Customer feedback',
};

function ctDayStartMs(daysBack) {
  const OFF = 5 * 3600 * 1000; // CT = UTC-5 (CDT)
  const ctNow = Date.now() - OFF;
  const midnight = Math.floor(ctNow / 86400000) * 86400000 - (daysBack || 0) * 86400000;
  return midnight + OFF;
}
function ctLabel(ms) {
  return new Date(ms - 0).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function searchAction(action) {
  const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ search: { action }, sort: { created_at: 'desc' }, per_page: 40, page: 1 }),
  });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j && j.items) || [];
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  // OWNER-ONLY gate: Teddy's tech PIN (technician_id 1).
  const pin = String(b.pin || '');
  if (!pin) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'owner_pin_required' }) };
  try {
    const vr = await fetch(`${SITE}/.netlify/functions/verify-pin-proxy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ technician_id: 1, pin }),
    });
    const vd = await vr.json().catch(() => ({}));
    if (!vd || !vd.success) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'wrong_pin' }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'pin_verify_failed: ' + String(e.message || e) }) };
  }

  const startMs = ctDayStartMs(Number(b.days || 0));
  const counts = {};
  const timeline = [];
  try {
    const results = await Promise.all(Object.keys(ACTIONS).map(async (a) => ({ a, rows: await searchAction(a) })));
    for (const { a, rows } of results) {
      for (const row of rows) {
        const at = Number(row.created_at || 0);
        if (at < startMs) continue; // today only
        const md = row.metadata || {};
        counts[a] = (counts[a] || 0) + 1;
        timeline.push({
          action: a,
          label: ACTIONS[a],
          job_id: md.job_id || md.jobId || null,
          actor: md.actor || md.source || '',
          at_ms: at,
          time: ctLabel(at),
        });
      }
    }
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e.message || e) }) };
  }

  timeline.sort((x, y) => y.at_ms - x.at_ms);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, day_ct: new Date(startMs).toLocaleDateString('en-US', { timeZone: 'America/Chicago' }), total: timeline.length, counts, timeline: timeline.slice(0, 200) }),
  };
};
