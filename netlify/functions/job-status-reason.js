// job-status-reason — composes a clear, honest "here's where it stands and WHY
// it's waiting" sentence for any job, from claim #, phone, or job_id. Built so Ant
// can RELAY a specific status to a warranty-company rep (or a customer) instead of
// just taking a message (Teddy, 2026-06-22). Also reusable by office/portal.
//
//   GET /job-status-reason?claim=55129879
//   GET /job-status-reason?phone=6155551212
//   GET /job-status-reason?job_id=19705
//     -> { ok, found, reason, headline, customer, appliance, status, tech, part_eta, scheduled_day }

'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const TECHS = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 6: 'John' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function dayCT(v) {
  if (!v) return '';
  let ms = v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { const d = new Date(v + 'T12:00:00'); return isNaN(d) ? v : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); }
  if (typeof v === 'string') ms = Date.parse(v);
  if (!ms || isNaN(ms)) return '';
  return new Date(Number(ms)).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' });
}
async function jfetch(url, opts) { try { const r = await fetch(url, opts); return await r.json(); } catch (_) { return null; } }

// Build the spoken reason from the job fields.
function compose(j, tech, cust) {
  const status = String(j.current_status || j.scheduling_status || '').toLowerCase();
  const appliance = [j.brand, j.appliance_type].filter(Boolean).join(' ') || 'appliance';
  const first = (cust && cust.first_name) ? cust.first_name : 'the customer';
  const techName = (tech && tech.first_name) ? tech.first_name : (TECHS[j.technician_id] || '');
  const partEta = dayCT(j.part_eta || j.parts_eta_date);
  const day = dayCT(j.scheduled_start);
  const partName = (j.failed_component || j.verified_part_number || 'the part').toString();

  if (/complete|done/.test(status)) return { headline: 'Completed', reason: `That repair is complete${j.repair_completed ? ' — ' + j.repair_completed : '.'}` };
  if (/cancel/.test(status)) return { headline: 'Canceled', reason: `That job was canceled.` };
  if (/await|part|order/.test(status)) {
    return { headline: 'Waiting on a part', reason: partEta
      ? `We've diagnosed the ${appliance} and we're waiting on the part — expected ${partEta}. The moment it's in, we schedule the install and ${first} gets a day.`
      : `We've diagnosed the ${appliance} and the part is on order. As soon as it arrives we schedule the install.` };
  }
  if (/in_progress|started/.test(status)) return { headline: 'In progress', reason: `${techName || 'Our tech'} is on the ${appliance} right now.` };
  if (/scheduled/.test(status) || day) {
    return { headline: 'Scheduled', reason: day
      ? `${first} is scheduled with ${techName || 'a tech'} for ${day}. We run day-of routing, so ${first} gets a live arrival window that morning.`
      : `Scheduled with ${techName || 'a tech'} — ${first} gets a live window the morning of.` };
  }
  if (/not_ready|needs|broadcast|intake|new/.test(status)) return { headline: 'In scheduling', reason: `We've received the ${appliance} job and it's in our scheduling queue — a day gets set shortly and ${first} is texted to confirm.` };
  const fs = (j.friendly_status || '').trim();
  return { headline: fs || 'In progress', reason: fs ? `Current status: ${fs}.` : `The ${appliance} job is in progress — let me get a tech to confirm the next step.` };
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const claim = (q.claim || q.claim_or_dispatch_number || '').trim();
  const phone = (q.phone || '').replace(/\D/g, '');
  const jobId = parseInt(String(q.job_id || '').replace(/\D/g, ''), 10) || 0;

  let job = null, tech = null, cust = null;
  if (claim) {
    const d = await jfetch(`${XANO}/lookup_by_claim_number`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim_or_dispatch_number: claim }) });
    if (d && d.success && (d.matches || []).length) { job = d.matches[0]; tech = d.tech; cust = d.customer; }
  } else if (phone) {
    const d = await jfetch(`${XANO}/lookup_customer_by_phone?phone=${phone}`);
    if (d && d.found) { cust = d.customer; job = (d.jobs && d.jobs[0]) || d.job || null; tech = d.tech; }
  } else if (jobId) {
    const d = await jfetch(`${XANO}/get_job_for_dashboard?job_id=${jobId}`);
    job = (d && (d.job || d)) || null; cust = d && d.customer; tech = d && d.tech;
  }

  if (!job) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, found: false, reason: "I don't see that one in our system yet — it may be a brand-new dispatch we haven't received. I can take the details and have someone confirm." }) };

  const { headline, reason } = compose(job, tech, cust);
  return { statusCode: 200, headers: CORS, body: JSON.stringify({
    ok: true, found: true,
    headline, reason,
    customer: cust ? `${(cust.first_name || '').trim()} ${(cust.last_name || '').trim()}`.trim() : '',
    appliance: [job.brand, job.appliance_type].filter(Boolean).join(' '),
    status: job.current_status || job.scheduling_status || '',
    tech: (tech && tech.first_name) || TECHS[job.technician_id] || '',
    part_eta: job.part_eta || job.parts_eta_date || '',
    scheduled_day: dayCT(job.scheduled_start),
    claim_number: job.claim_number || claim,
    job_id: job.id || jobId,
  }) };
};
