// cash-paid-cover — the moment a cash-TDR customer PAYS (the Stripe webhook logs
// `stripe_webhook_processed`), make sure we're covered even if they skipped intake:
//   1) text them the AVAILABILITY question (so we collect when they're free),
//   2) send the WAIVER link (liability cover),
//   3) hold scheduling 2-3 days for the part — stamp parts_eta_date = today+3 and
//      put the job in awaiting_parts so the scheduler won't book before it lands.
// Idempotent per job (cash_paid_covered marker). Runs as a scheduled sweep AND can
// be fired manually for one job: ?secret=<admin>&job_id=19985[&force=1].
'use strict';
const { getSecret } = require('./_lib/secrets');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const SITE = 'https://tnapplianceexchange.net';
const PART_LEAD_DAYS = 3; // 2-3 day minimum before the part is here

function ymd(d) { const p = {}; for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)) p[x.type] = x.value; return `${p.year}-${p.month}-${p.day}`; }
function etaDate(days) { return ymd(new Date(Date.now() + days * 86400000)); }
async function rows(action, n) { try { return await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, n || 200); } catch (_) { return []; } }

async function alreadyCovered(jobId) {
  const seen = await rows('cash_paid_covered', 400);
  return seen.some((r) => { const m = r.metadata || {}; return String(m.job_id) === String(jobId); });
}

async function coverJob(jobId, reason) {
  const job = (await crud.searchOne(crud.TABLES.jobs, { id: jobId })) || {};
  if (!job.id) return { job_id: jobId, ok: false, error: 'job not found' };
  const cust = job.customer_id ? ((await crud.searchOne(crud.TABLES.customer, { id: job.customer_id })) || {}) : {};
  const phone = cust.phone || cust.mobile_number || cust.phone_number || job.customer_phone || '';
  const first = (cust.first_name || job.customer_first_name || '').trim() || 'there';
  const eta = etaDate(PART_LEAD_DAYS);

  // 3) hold scheduling for the part: awaiting_parts + ETA (scheduler won't book before it)
  try { await crud.update(crud.TABLES.jobs, jobId, { parts_status: 'awaiting_parts', parts_eta_date: eta }); } catch (_) {}

  // 1)+2) one text: availability ask + 2-3 day part note + waiver link
  let smsOk = false;
  if (phone) {
    const body =
      `Hi ${first}, thanks — payment received! 🎉 Your part is on the way (about 2-3 days). `
      + `Two quick things so we're ready to get you scheduled the moment it lands:\n\n`
      + `1) When ARE and AREN'T you available over the next few days? Just reply here.\n`
      + `2) Please sign our quick service waiver: ${SITE}/waiver.html?job_id=${jobId}\n\n`
      + `We'll text you a live arrival window the day of. — TN Appliance`;
    smsOk = await sendSms(phone, body, 'customer', 'cash_paid_cover');
  }

  await crud.logEvent('cash_paid_covered', { job_id: jobId, reason: reason || 'paid', sms: smsOk, phone_present: !!phone, parts_eta_date: eta, at_ms: Date.now() });
  return { job_id: jobId, ok: true, sms: smsOk, phone_present: !!phone, parts_eta_date: eta, first };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const manual = !!q.job_id;
  if (manual && q.secret !== admin) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };

  // manual single-job cover (testing / one-off)
  if (manual) {
    const jid = parseInt(q.job_id, 10);
    if (!q.force && (await alreadyCovered(jid))) return { statusCode: 200, body: JSON.stringify({ ok: true, job_id: jid, skipped: 'already_covered' }) };
    const res = await coverJob(jid, 'manual');
    return { statusCode: 200, body: JSON.stringify(res, null, 2) };
  }

  // scheduled sweep: cover any cash-TDR paid in the last ~45 min not yet covered
  const cutoff = Date.now() - 45 * 60 * 1000;
  const paid = await rows('stripe_webhook_processed', 100);
  const out = [];
  for (const r of paid) {
    const m = r.metadata || {};
    const jid = m.job_id;
    if (!jid) continue;
    const when = Date.parse(r.created_at || '') || (m.at_ms || 0);
    if (when && when < cutoff) continue; // only fresh payments
    if (await alreadyCovered(jid)) continue;
    try { out.push(await coverJob(jid, 'sweep')); } catch (e) { out.push({ job_id: jid, ok: false, error: String(e.message || e) }); }
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, covered: out.length, results: out }, null, 2) };
};
