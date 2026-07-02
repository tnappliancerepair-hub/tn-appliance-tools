// job-status-reason — now a THIN DELEGATOR over job-truth (the one job brain).
//
// This used to carry its own copy of the status/canceled/recall/part-ETA logic,
// which is exactly the duplication Teddy called out (2026-07-02) — every view
// re-deriving the truth its own way and drifting. It now asks job-truth for the
// single canonical answer and maps it back to this endpoint's original response
// shape, so EVERY existing caller flows through one brain with zero changes:
//   • customer-portal.html   (?job_id=&voice=customer)
//   • office-board.html      (?job_id=)
//   • office-messages.html   (?phone=[&voice=customer])
//   • colony-loop text agent sms_response_status_inquiry (?phone=&voice=customer)
//   • Vapi phone tool (relay a status to a customer or warranty rep)
//
// voice=customer -> customer lens (2nd person). Otherwise -> warranty lens
// (3rd-person rep summary). Contract preserved: ok, found, reason, headline,
// office_note, customer, appliance, status, tech, part_eta, scheduled_day,
// claim_number, job_id.
'use strict';

const jobTruth = require('./job-truth');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function headlineFor(f) {
  const s = String(f.status || '').toLowerCase();
  if (/complete|done/.test(s)) return f.is_warranty ? 'Completed — recall via warranty co' : 'Completed';
  if (/await|part|order/.test(s)) return 'Waiting on a part';
  if (/in_progress|started/.test(s)) return 'In progress';
  if (/scheduled/.test(s) || f.scheduled_day) return 'Scheduled';
  if (/cancel/.test(s)) return 'Office to confirm';
  if (/not_ready|needs|broadcast|intake|new/.test(s)) return 'In scheduling';
  return 'In progress';
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const claim = q.claim || q.claim_or_dispatch_number || '';
  const youVoice = String(q.voice || '').toLowerCase() === 'customer';

  // Ask the ONE brain.
  const res = await jobTruth.handler({
    httpMethod: 'GET',
    queryStringParameters: { job_id: q.job_id || '', claim, phone: q.phone || '', lens: 'all' },
  });
  let d = {}; try { d = JSON.parse(res.body || '{}'); } catch (_) {}

  if (!d || !d.ok || !d.found) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, found: false, reason: (d && d.reason) || "I don't see that one in our system yet — it may be a brand-new dispatch we haven't received. I can take the details and have someone confirm." }) };
  }

  const f = d.facts, L = d.lenses || {};
  let reason = youVoice ? (L.customer || '') : (L.warranty || '');
  // Warranty lens already folds in the office note; append it for the customer
  // voice too so Ant relays the freshest human update either way.
  if (youVoice && f.office_note && !reason.includes(f.office_note)) reason += ` Latest office update: ${f.office_note}`;

  return { statusCode: 200, headers: CORS, body: JSON.stringify({
    ok: true, found: true,
    headline: headlineFor(f), reason,
    office_note: f.office_note || '', office_note_at: 0,
    customer: f.customer_name, appliance: f.appliance,
    status: f.status, tech: f.tech_name,
    part_eta: f.part_eta, scheduled_day: f.scheduled_day,
    claim_number: f.claim_number, job_id: f.job_id,
  }) };
};
