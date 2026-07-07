// callback-intake — Teddy 2026-07-07: THE standard flow for a RECALL / CALLBACK contact.
//
// When a customer comes back ("same problem", "the repair didn't hold", "you came out
// but it's broken again"), we do the SAME thing every time no matter how they reached us
// (inbound text, office-taken call, or the AI phone):
//   1) spin up a FRESH recall job (or relabel an existing empty lead) — we create OUR job
//      even if they still have to re-open the claim with the warranty company, so it's never
//      lost while the warranty side catches up,
//   2) clone their warranty info (company + claim + address) from their prior job,
//   3) hand back the ONE warranty-intake link (video + model # + availability + waiver),
//   4) it lands in Needs-Scheduling with everything we need — nothing to chase.
//
//   POST {
//     job_id?,            // ATTACH mode: relabel THIS existing job as the recall job (e.g. a fresh web lead)
//     phone?,             // NEW mode (no job_id): find the customer + prior job by phone, create a fresh recall job
//     appliance?,         // optional appliance_type override
//     note?,              // optional note folded into customer_preference_text (e.g. "Available Mon 7/13")
//     warranty_company?,  // optional override (else cloned from prior job)
//     claim_number?,      // optional override (else cloned from prior job)
//     send_link?,         // if true, TEXT the customer the warranty-intake link now
//     source?             // 'inbound_text' | 'office' | 'phone'  (audit only)
//   }
//   -> { ok, job_id, action:'attached'|'created'|'noop',
//        warranty_intake_url, prior_job_id?, warranty_company?, claim_number?, sent_link:bool }
'use strict';
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const OFFICE_PW = 'antlives';
const SITE = 'https://tnapplianceexchange.net';
// Fields worth carrying from the prior job onto a fresh recall job.
const CLONE_KEYS = [
  'customer_id', 'bill_to_customer_id',
  'service_address', 'service_city', 'service_state', 'service_zip', 'zip',
  'warranty_company', 'claim_number', 'dispatch_source_id',
  'region', 'market', 'access_notes', 'sms_consent',
];

function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }
function last10(v) { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
function e164(p) { const d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') return '+' + d; if (d.length === 10) return '+1' + d; return d ? ('+' + d) : ''; }
async function jget(u, ms) { const r = await fetch(u, { signal: AbortSignal.timeout(ms || 12000) }); return r.json().catch(() => ({})); }
async function jpost(u, body, ms) { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms || 15000) }); return r.json().catch(() => ({})); }

// Enum-safe job write: the Metadata API silently drops enum writes (customer_type),
// so warranty/type fields go through the XS db.edit endpoint (office-password gated).
async function setJobFull(jobId, fields) {
  return jpost(`${XANO}/update_job_full_info`, Object.assign({ job_id: jobId, office_password: OFFICE_PW }, fields), 15000);
}

// Find the customer's PRIOR warranty job (the recall source) by phone.
// office_universal_search is reliable by phone and returns job ids; we then read each
// candidate to find the most-recent one carrying a warranty_company/claim.
async function findPriorWarrantyJob(phone, excludeJobId) {
  const p10 = last10(phone);
  if (!p10) return null;
  let hits = [];
  try {
    const d = await jget(`${XANO}/office_universal_search?q=${p10}`, 15000);
    hits = d.results || d.items || (Array.isArray(d) ? d : []);
  } catch (_) {}
  const ids = hits.map((h) => Number(h.job_id || h.id)).filter((n) => n && n !== Number(excludeJobId));
  ids.sort((a, b) => b - a); // newest first
  let best = null;
  for (const id of ids.slice(0, 8)) {
    let job = null;
    try { job = await crud.searchOne(crud.TABLES.jobs, { id }); } catch (_) {}
    if (!job) continue;
    const wc = String(job.warranty_company || '').trim();
    if (wc) { best = job; if (String(job.claim_number || '').trim()) break; } // prefer one with a claim
  }
  return best;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}

  const source = String(b.source || 'office');
  const note = String(b.note || '').trim();
  const applianceIn = String(b.appliance || b.appliance_type || '').trim();
  let jobId = Number(b.job_id) || 0;
  let phone = String(b.phone || '').trim();

  // If attaching to an existing job, load it to fill phone + as clone fallback.
  let attachJob = null;
  if (jobId) {
    try { attachJob = await crud.searchOne(crud.TABLES.jobs, { id: jobId }); } catch (_) {}
    if (!attachJob) return json(200, { ok: false, error: 'job_id not found' });
    if (!phone) phone = attachJob.phone || attachJob.customer_phone || '';
  }
  if (!jobId && last10(phone).length !== 10) {
    return json(400, { ok: false, error: 'Provide a valid phone (new callback) or an existing job_id.' });
  }

  // Find the prior warranty job to clone from (may be null for a pure cash recall).
  const prior = await findPriorWarrantyJob(phone, jobId);
  const warrantyCompany = String(b.warranty_company || (prior && prior.warranty_company) || (attachJob && attachJob.warranty_company) || '').trim();
  const claimNumber = String(b.claim_number || (prior && prior.claim_number) || (attachJob && attachJob.claim_number) || '').trim();
  const appliance = applianceIn || (prior && (prior.appliance_type)) || (attachJob && attachJob.appliance_type) || '';
  const priorId = prior ? Number(prior.id) : 0;
  const isWarranty = !!warrantyCompany;

  const recallLine = 'RECALL' + (priorId ? (' of job #' + priorId) : '') +
    (claimNumber ? (' (' + (warrantyCompany || 'warranty') + ' claim ' + claimNumber + ')') : '') +
    ' — same problem as before, the prior repair did not hold.';
  const prefText = [note, recallLine].filter(Boolean).join(' ');

  let action = 'noop';
  let outJobId = jobId;

  if (jobId) {
    // ATTACH: relabel the existing (usually empty lead) job as the recall job.
    action = 'attached';
    const fields = {
      customer_type: isWarranty ? 'warranty' : 'self_pay',
      channel: 'callback_recall',
      scheduling_status: 'needs_more_info',
      customer_preference_text: prefText,
      problem_summary: recallLine + (appliance ? (' Appliance: ' + appliance + '.') : ''),
    };
    if (isWarranty) { fields.warranty_company = warrantyCompany; if (claimNumber) fields.claim_number = claimNumber; }
    if (appliance) fields.appliance_type = appliance;
    await setJobFull(jobId, fields);
  } else {
    // NEW: create a fresh recall job cloning the prior warranty job's core.
    const row = { channel: 'callback_recall', current_status: 'new', scheduling_status: 'needs_more_info',
      customer_type: isWarranty ? 'warranty' : 'self_pay',
      appliance_type: appliance || 'appliance',
      customer_preference_text: prefText,
      problem_summary: recallLine + (appliance ? (' Appliance: ' + appliance + '.') : '') };
    // Carry the customer link + address + warranty from the prior job (customer_id
    // brings the phone with it). If there's no prior job, the office links it by hand.
    if (prior) for (const k of CLONE_KEYS) { if (prior[k] !== undefined && prior[k] !== null && prior[k] !== '') row[k] = prior[k]; }
    if (isWarranty) { row.warranty_company = warrantyCompany; if (claimNumber) row.claim_number = claimNumber; }
    let created = null;
    try { created = await crud.insert(crud.TABLES.jobs, row); } catch (e) { return json(200, { ok: false, error: 'create failed: ' + e.message }); }
    outJobId = Number(created && (created.id || created.job_id)) || 0;
    if (!outJobId) return json(200, { ok: false, error: 'create returned no id' });
    action = 'created';
  }

  // Audit the recall linkage (feeds the office board + prevents double-handling).
  try { await crud.logEvent('callback_job_created', { job_id: outJobId, prior_job_id: priorId, warranty_company: warrantyCompany, claim_number: claimNumber, source, action, at_ms: Date.now() }); } catch (_) {}

  const url = `${SITE}/warranty-intake.html?job_id=${outJobId}`;

  // Optionally text the customer the ONE intake link right now.
  let sentLink = false;
  if (b.send_link && last10(phone).length === 10) {
    const first = String((prior && prior.first_name) || (attachJob && attachJob.first_name) || '').trim();
    const hi = first ? ('Hi ' + first + ', ') : 'Hi, ';
    const msg = hi + "TN Appliance Exchange 🐜 — sorry your repair didn't hold. Let's get you taken care of. Tap here to send a 10-sec video + a photo of the model # and pick the days that work — takes about a minute: " + url + " (Reply here or call 615-280-2949 anytime.)";
    try {
      await jpost(`${XANO}/send_sms`, { to: e164(phone), message: msg, customer_first_name: first, context_tag: 'callback_intake_link' }, 12000);
      sentLink = true;
    } catch (_) {}
  }

  return json(200, { ok: true, job_id: outJobId, action, warranty_intake_url: url, prior_job_id: priorId || undefined, warranty_company: warrantyCompany || undefined, claim_number: claimNumber || undefined, sent_link: sentLink });
};
