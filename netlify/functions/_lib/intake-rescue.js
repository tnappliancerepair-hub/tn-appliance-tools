// intake-rescue — catch a lead on the PLATFORM when Xano can't take it.
//
// THE HOLE THIS CLOSES
// Every web/AI intake endpoint creates its job in Xano (`create_job_from_chat`) inside a
// `catch (_) {}`. When that call fails, jobId stays null and the failure is silent — but on
// the PAID path the customer has already been charged. Downstream everything is gated on
// `if (jobId)`, so that customer gets: no job, no confirmation text, no finish-upload chase,
// no model-sticker OCR. The office gets a siren reading "Job #?" pointing at a board with no
// card on it. The money is in and the work is invisible.
//
// WHAT THIS DOES
// Only when Xano already failed: create the job on the platform instead, and tell a human
// where it landed. Nothing changes on a normal day — this never runs when Xano answers.
//
// WHY IT ACTUALLY HEALS
// `platform-tn-job-back` (live, cron 8-59/15) already pushes platform-native jobs INTO Xano,
// keyed on claim number, link-before-create, so it cannot duplicate. So a rescued lead flows
// back into Xano by itself once Xano recovers. The backup repairs itself.
//
// ⚠️ LOGS + ALERTS MUST NOT TOUCH XANO. The whole premise is that Xano is the thing that
// just failed, so crud.logEvent would fail too. The audit row goes to the platform, and the
// alert uses a `platform_` tag so _lib/sms-guard.deliver() sends DIRECT to Telnyx instead of
// routing through Xano's send_sms.
//
//   rescueLead({ name, phone, zip, city, appliance, brand, problem, customer_type,
//                warranty_company, claim_number, source, amount, session_id, slug? })
//     -> { ok, job_id, portal_url, intake_url, deduped? }  |  { ok:false, error }
'use strict';

const { getSecret } = require('./secrets');
const { createLeadJob } = require('./platform-db');

const SITE = 'https://tnapplianceexchange.net';
const OWNER = '+16154855795';     // Teddy
const DANIELLE = '+16154850713';

// TN's own website feeds TN's own board. A second shop gets its own site and its own slug,
// so this is a default, not a rule -- override with PLATFORM_DEFAULT_SLUG.
const DEFAULT_SLUG = process.env.PLATFORM_DEFAULT_SLUG || 'tn-appliance-exchange-llc';

async function cfg() {
  const url = (await getSecret('PLATFORM_SUPABASE_URL')) || '';
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  return { url: String(url).replace(/\/+$/, ''), key };
}

// Fields createLeadJob doesn't take (it is the phone brain's lead shape) but a rescued
// web/paid intake genuinely carries. Best-effort: a failed patch must never lose the job.
async function stampJob(jobId, patch) {
  try {
    const { url, key } = await cfg();
    if (!url || !key || !jobId) return false;
    const clean = {};
    for (const k of Object.keys(patch || {})) { const v = patch[k]; if (v != null && v !== '') clean[k] = v; }
    if (!Object.keys(clean).length) return false;
    const r = await fetch(`${url}/rest/v1/job?id=eq.${jobId}`, {
      method: 'PATCH',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(clean), signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch (_) { return false; }
}

// The audit trail lands on the PLATFORM on purpose -- see the header note.
// Table shape is (company_id, type, entity, payload), so resolve the tenant by slug rather
// than guessing; a row with no company belongs to no board and helps nobody.
async function companyIdForSlug(slug) {
  try {
    const { url, key } = await cfg();
    if (!url || !key) return null;
    const r = await fetch(`${url}/rest/v1/company?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`, {
      headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    return (rows && rows[0] && rows[0].id) || null;
  } catch (_) { return null; }
}

async function logPlatform(companyId, type, payload) {
  try {
    const { url, key } = await cfg();
    if (!url || !key || !companyId) return;
    await fetch(`${url}/rest/v1/event`, {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ company_id: companyId, type, entity: 'job', payload }), signal: AbortSignal.timeout(8000),
    });
  } catch (_) {}
}

async function rescueLead(lead) {
  const L = lead || {};
  const slug = L.slug || DEFAULT_SLUG;
  const companyId = await companyIdForSlug(slug);
  const res = await createLeadJob({
    slug,
    name: L.name || 'Customer',
    phone: L.phone || '',
    what: L.appliance || L.machine || 'appliance',
    detail: L.problem || '',
    city: L.city || L.town || '',
    source: L.source || 'intake_rescue',
  });
  if (!res || !res.ok) {
    // Both systems refused the lead. Say so loudly rather than returning a quiet false --
    // a paid customer with no job anywhere is the worst outcome in this whole flow.
    await logPlatform(companyId, 'intake_rescue_failed', { error: (res && res.error) || 'unknown', name: L.name || '', phone: L.phone || '', amount: L.amount || null, session_id: L.session_id || '', at: new Date().toISOString() });
    try {
      const { sendSms } = require('./sms');
      await sendSms(OWNER, '🚨 LEAD LOST — Xano AND the platform both refused a ' + (L.customer_type === 'warranty' ? 'warranty' : 'paid') + ' intake for ' + (L.name || 'a customer') + ' ' + (L.phone || '') + '. Call them. Nothing saved it.', 'owner', 'platform_intake_rescue');
    } catch (_) {}
    return { ok: false, error: (res && res.error) || 'platform_refused' };
  }

  // Carry the fields the lead shape doesn't cover. `source` marks where it was born so the
  // board (and any later audit) can tell a rescue from a normal platform-native job.
  await stampJob(res.job_id, {
    source: 'intake_rescue',
    warranty_company: L.warranty_company || null,
    claim_number: L.claim_number || null,
    availability: L.availability || null,
  });

  await logPlatform(companyId, 'intake_rescued_to_platform', {
    job_id: res.job_id, deduped: !!res.deduped,
    name: L.name || '', phone: L.phone || '', appliance: L.appliance || '',
    customer_type: L.customer_type || '', amount: L.amount || null,
    session_id: L.session_id || '', source: L.source || '',
    at: new Date().toISOString(),
  });

  // One alert, only on a real rescue -- a deduped hit is the same lead arriving twice and
  // must not re-text anyone.
  if (!res.deduped) {
    const money = L.amount ? (' $' + L.amount) : '';
    const msg = '⚠️ XANO DIDN\'T TAKE THIS ' + (L.customer_type === 'warranty' ? 'WARRANTY' : 'PAID') + ' INTAKE' + money
      + ' — caught it on the platform instead. ' + (L.name || 'customer') + ' · ' + (L.appliance || 'appliance')
      + (L.city || L.town ? (' · ' + (L.city || L.town)) : '')
      + ' → work it here: ' + SITE + '/platform/office-board.html?job=' + res.job_id
      + '  (it pushes back into Xano on its own once Xano is up)';
    try {
      const { sendSms } = require('./sms');
      await sendSms(OWNER, msg, 'owner', 'platform_intake_rescue');
      await sendSms(DANIELLE, msg, 'warranty_handler', 'platform_intake_rescue');
    } catch (_) {}
  }

  return { ok: true, job_id: res.job_id, portal_url: res.portal_url || '', intake_url: res.intake_url || '', deduped: !!res.deduped };
}

module.exports = { rescueLead, DEFAULT_SLUG };
