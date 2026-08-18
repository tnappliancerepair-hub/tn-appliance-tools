// new-job-shop-email — emails the shop the moment a NEW in-house (cash / self-pay)
// job comes in, so Danielle never misses it in the text flood (her request,
// 2026-08-18: "I need when an in-house job comes in an email sent to the shop with
// the info"). Reads the open self-pay leads, emails ONE per job (deduped), pulls the
// full service ADDRESS per job, and FLAGS when the street address is missing (Ann
// captures the zip but not the street today — the other half of Danielle's note).
//
// Sends via gmail-send FROM the shop Gmail (tnappliancerepair@gmail.com) TO itself, so
// it lands in the shop inbox she watches. RETRY-SAFE: a job is only marked emailed on a
// real SENT (not a dry-run / scope error), so nothing is lost while the send scope is
// being granted — the backlog flushes the moment the re-auth lands. Kill: NEW_JOB_EMAIL=false.
//
//   GET ?secret=<admin>[&dry=1][&days=3]   manual  ·  scheduled runs self-authorize.
'use strict';
const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');

const SITE = 'https://tnapplianceexchange.net';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const SHOP_EMAIL = 'tnappliancerepair@gmail.com';
const MAX_PER_RUN = 12;                 // backstop so a first-run backlog can't blast
exports.config = { timeout: 26 };

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function ctTime(ms) { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); } catch (_) { return ''; } }
function fmtPhone(p) { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? d.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') : String(p || ''); }

// Pull the full service address for a job (cash-leads only carries the zip).
async function addressFor(jobId) {
  try {
    const d = await fetch(`${XANO}/get_job_for_dashboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }), signal: AbortSignal.timeout(6000) }).then((r) => r.json());
    const j = (d && d.job) || {}; const c = (d && d.customer) || {};
    const street = String(j.service_address || '').trim();
    const city = String(j.service_city || c.city || '').trim();
    const state = String(j.service_state || c.state || '').trim();
    const zip = String(j.service_zip || c.zip || '').trim();
    return { street, city, state, zip, has_street: !!street };
  } catch (_) { return { street: '', city: '', state: '', zip: '', has_street: false }; }
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  if (String(await getSecret('NEW_JOB_EMAIL') || '').toLowerCase() === 'false') return json(200, { ok: true, disabled: true });
  const dry = q.dry === '1';
  const days = Math.max(1, Math.min(14, parseInt(q.days, 10) || 3));

  // 1) the open self-pay (in-house) leads, newest first
  let leads = [];
  try {
    const d = await fetch(`${SITE}/.netlify/functions/cash-leads?days=${days}`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
    leads = (d && d.leads) || [];
  } catch (e) { return json(200, { ok: false, error: 'cash-leads fetch failed: ' + String((e && e.message) || e) }); }

  // 2) which jobs have we already emailed the shop about? (email once per job, ever)
  const emailed = new Set();
  try {
    const prior = await crud.searchPage(crud.TABLES.event_log, { action: 'new_job_shop_emailed' }, { id: 'desc' }, 500);
    for (const r of prior) { const jid = Number(meta(r).job_id || 0); if (jid) emailed.add(jid); }
  } catch (_) {}

  const fresh = leads.filter((L) => Number(L.job_id) && !emailed.has(Number(L.job_id))).slice(0, MAX_PER_RUN);
  const out = { ok: true, mode: dry ? 'dry' : 'live', leads: leads.length, fresh: fresh.length, sent: 0, missing_address: 0, sample: [] };
  if (!fresh.length) { out.note = 'no new in-house jobs to email'; return json(200, out); }

  for (const L of fresh) {
    const jobId = Number(L.job_id);
    const addr = await addressFor(jobId);
    if (!addr.has_street) out.missing_address++;
    const addrLine = addr.has_street
      ? `${addr.street}${addr.city ? ', ' + addr.city : ''}${addr.state ? ', ' + addr.state : ''}${addr.zip ? ' ' + addr.zip : ''}`
      : `⚠️ NO STREET ADDRESS ON FILE — zip ${addr.zip || L.zip || '?'}. Call to confirm the address.`;
    const subject = `🏠 New in-house job — ${L.name || 'customer'}${L.appliance ? ' · ' + L.appliance : ''}`;
    const body =
      `A new in-house (cash / self-pay) job just came in:\n\n` +
      `Customer: ${L.name || 'Unknown'}\n` +
      `Phone: ${fmtPhone(L.phone) || 'none on file'}\n` +
      `Appliance: ${L.appliance || 'n/a'}\n` +
      `Problem: ${L.problem || 'n/a'}\n` +
      `Address: ${addrLine}\n` +
      `Came in: ${ctTime(L.created_ms || Date.now())} CT\n\n` +
      `Open the job: ${SITE}/job-detail.html?job_id=${jobId}\n` +
      `— Ann 🐜`;

    if (dry) { out.sample.push({ job: jobId, name: L.name, has_street: addr.has_street }); continue; }

    // Send from the shop Gmail to the shop inbox. Only mark emailed on a REAL send —
    // a dry-run / scope error must NOT burn the job (it retries once send is granted).
    let sent = null;
    try {
      const r = await fetch(`${SITE}/.netlify/functions/gmail-send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: admin, from: SHOP_EMAIL, to: SHOP_EMAIL, subject, body, send: true }),
        signal: AbortSignal.timeout(15000),
      });
      sent = await r.json().catch(() => null);
    } catch (e) { sent = { ok: false, error: String((e && e.message) || e) }; }

    if (sent && sent.ok && sent.mode === 'sent') {
      try { await crud.logEvent('new_job_shop_emailed', { job_id: jobId, name: L.name, has_street: addr.has_street, at_ms: Date.now() }); } catch (_) {}
      out.sent++; out.sample.push({ job: jobId, name: L.name, emailed: true });
    } else {
      // Not sent (likely send scope not yet granted). Leave un-marked so it retries.
      out.email_error = (sent && (sent.error || sent.mode)) || 'send_failed';
      out.sample.push({ job: jobId, name: L.name, emailed: false, why: out.email_error });
    }
  }

  try { await crud.logEvent('new_job_shop_email_run', { mode: out.mode, fresh: out.fresh, sent: out.sent, missing_address: out.missing_address, at_ms: Date.now() }); } catch (_) {}
  return json(200, out);
};
