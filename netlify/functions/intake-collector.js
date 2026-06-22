// intake-collector — the FOUNDATION for cluster ghost-scheduling.
//
// Sweeps the Needs-Scheduled board during reasonable hours and texts each
// non-vendor job (that has a phone + no availability yet) the intake request:
// when they're available, their model #, and a quick video of the problem.
// We can't cluster-schedule around availability we don't have, so this collects
// it the moment a job is sitting unscheduled.
//
// - Reasonable hours only: scheduled hourly 9am-6pm CT (netlify.toml) AND a
//   runtime CT-hour guard (8am-8pm) so it can never text at night.
// - Rate-limited (MAX_PER_RUN) so it drains the backlog over a day or two
//   without tripping the SMS circuit breaker.
// - Vendor-locked (SquareTrade/ServicePower) jobs are skipped — the vendor
//   already set their slot, they don't need availability.
// - Records availability_requested_<job> so (a) we never re-ask, and (b) the
//   customer's reply routes to the availability parser (sms_response_availability).
'use strict';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SITE = 'https://tnapplianceexchange.net';
const MAX_PER_RUN = 15;

function ctHour() {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()), 10);
}
function first(s) { return String(s || '').trim().split(/\s+/)[0] || 'there'; }
function isVendor(w) { return /squaretrade|servicepower|service power/i.test(String(w || '')); }
async function jget(url, ms = 9000) { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.json().catch(() => ({})); }
async function jpost(url, body, ms = 9000) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); return r.json().catch(() => ({})); }
function ok(b) { return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }; }

exports.handler = async function () {
  const h = ctHour();
  if (h < 8 || h >= 20) return ok({ status: 'skipped_quiet_hours', ct_hour: h });

  let items = [];
  try {
    const d = await jget(`${XANO}/list_needs_scheduled_parallel?limit=1000`, 12000);
    items = d.items || d.jobs || d.rows || (Array.isArray(d) ? d : []);
  } catch (e) { return ok({ status: 'list_failed', error: String(e.message || e) }); }

  // Candidates: non-vendor, has a phone, no availability captured yet.
  const cands = items.filter((j) => {
    if (isVendor(j.warranty_company)) return false;
    const ph = String(j.customer_phone || j.phone || '').replace(/\D/g, '');
    if (ph.length < 10) return false;
    const hasAvail = !!((j.customer_preference_text || '').trim() || (j.customer_availability_grid || '').trim());
    return !hasAvail;
  });

  let sent = 0, skipped_dupe = 0, failed = 0;
  const done = [];
  for (const j of cands) {
    if (sent >= MAX_PER_RUN) break;
    const id = j.id || j.job_id;
    // Dedup — already asked (by this collector OR by job_created)?
    try {
      const dd = await jget(`${XANO}/list_recent_event_log?action=availability_requested_${id}&days_back=21&limit=1`, 7000);
      if ((dd.items || []).length) { skipped_dupe++; continue; }
    } catch (_) {}

    const phone = String(j.customer_phone || j.phone || '').replace(/\D/g, '');
    const cust = first(j.customer_first);
    const appl = (j.appliance || 'appliance');
    const portal = `${SITE}/customer-portal.html?job_id=${id}&last4=`;
    const msg = `Hi ${cust} — this is TN Appliance Exchange 🐜. To get your ${appl} scheduled fast: what days work best for you, and any days you can't do? Just reply right here. It also speeds things up a lot to add your model # + a quick video of the problem here: ${portal}`;

    let okSend = false;
    try { const r = await jpost(`${XANO}/send_sms`, { to: phone, message: msg, context_tag: 'intake_collect' }); okSend = !!(r && r.success); } catch (_) {}
    if (okSend) {
      sent++; done.push(id);
      try { await jpost(`${XANO}/record_event_log`, { action: `availability_requested_${id}`, metadata_json: JSON.stringify({ job_id: id, source: 'intake_collector', at_ms: Date.now() }) }); } catch (_) {}
    } else failed++;
  }

  return ok({ status: 'ran', ct_hour: h, candidates: cands.length, sent, skipped_dupe, failed, job_ids: done });
};
