// WAIVER_SIGNED — emails an archival copy of a signed liability waiver to the
// waiver inbox (default tnappliance@gmail.com) with the signature image
// attached, so the office can search it in Gmail and forward it to the
// insurance company on demand.
//
// Emitted by api/intake/save_customer_waiver_POST.xs after a customer signs on
// waiver.html. Runs async in the loop so an email failure can never block the
// customer's signature submission.
//
// Payload:
//   { job_id, customer_id, signer_name, signer_email, phone_last4,
//     acknowledgments, signed_at_ms, signature_b64 }
//
// Requires (Mac Mini colony-loop/.env, matching Netlify):
//   EMAIL_SHARED_SECRET   bearer for send-email's X-Internal-Auth
//   WAIVER_ARCHIVE_EMAIL  (optional) recipient; defaults to tnappliance@gmail.com
// And on Netlify: EMAIL_ENABLED=true + the recipient verified in SES.

import { config } from '../config.js';
import { fmtCT } from '../time.js';

const ARCHIVE_EMAIL = process.env.WAIVER_ARCHIVE_EMAIL || 'tnappliance@gmail.com';

function applianceLabel(raw) {
  return String(raw || '').trim() || 'appliance';
}

export async function run(signal, ctx) {
  const { xano, log } = ctx;
  const p = signal.payload || {};
  const jobId = Number(p.job_id);
  if (!jobId) {
    await xano.markSignalProcessed(signal.id, 'waiver_archive_skipped', { reason: 'no_job_id' });
    return { success: true, action: 'skipped_no_job_id' };
  }

  // Enrich with appliance + address so the archived email is self-contained.
  let job = {};
  let customer = {};
  try {
    const c = await xano.getTechAssignmentContext(jobId, 1);
    if (c && c.success) {
      job = c.job || {};
      customer = c.customer || {};
    }
  } catch (err) {
    log('waiver_archive_context_failed', { job_id: jobId, error: String(err.message || err) });
  }

  const custName = `${(customer.first_name || '').trim()} ${(customer.last_name || '').trim()}`.trim()
    || (p.signer_name || '').trim() || '(customer)';
  const appliance = applianceLabel(job.appliance_type);
  const address = [job.service_address, job.service_city, job.service_state, job.service_zip]
    .filter((x) => x && String(x).trim()).join(', ');
  const signedAt = p.signed_at_ms ? fmtCT(Number(p.signed_at_ms)) : 'unknown';

  let acks = p.acknowledgments;
  try { if (typeof acks === 'string') acks = JSON.parse(acks); } catch (_) { /* leave as-is */ }
  const acksText = acks && typeof acks === 'object'
    ? Object.keys(acks).map((k) => `  - ${k}: ${acks[k] ? 'yes' : 'NO'}`).join('\n')
    : String(p.acknowledgments || '(none recorded)');

  const subject = `Signed Waiver — ${custName} — Job #${jobId} — ${signedAt}`;
  const body = [
    'A customer signed the liability/scope-of-work waiver. Archival copy for your records + insurance.',
    '',
    `Customer:        ${custName}`,
    `Job #:           ${jobId}`,
    `Appliance:       ${appliance}`,
    `Service address: ${address || '(not on file)'}`,
    `Signer name:     ${(p.signer_name || '').trim() || '(blank)'}`,
    `Signer email:    ${(p.signer_email || '').trim() || '(blank)'}`,
    `Phone (last 4):  ${(p.phone_last4 || '').trim() || '(blank)'}`,
    `Signed at:       ${signedAt}`,
    '',
    'Acknowledgments:',
    acksText,
    '',
    'The signed signature image is attached as a PNG.',
  ].join('\n');

  const sharedSecret = process.env.EMAIL_SHARED_SECRET;
  if (!sharedSecret) {
    log('waiver_archive_no_secret', { job_id: jobId });
    await xano.markSignalProcessed(signal.id, 'waiver_archive_skipped', {
      job_id: jobId, reason: 'EMAIL_SHARED_SECRET_unset',
    });
    return { success: false, action: 'no_email_secret', job_id: jobId };
  }

  const attachments = [];
  const sig = String(p.signature_b64 || '').trim();
  if (sig) {
    attachments.push({ filename: `waiver-job-${jobId}.png`, mime_type: 'image/png', content_b64: sig });
  }

  let sent = false;
  let mode = 'unknown';
  let errMsg = null;
  try {
    // Hard 12s timeout — a hung fetch must never wedge the dispatch loop.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let r;
    try {
      r = await fetch(`${config.netlifyFunctionsBase}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': sharedSecret },
        body: JSON.stringify({ to: ARCHIVE_EMAIL, subject, body, attachments }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const d = await r.json().catch(() => ({}));
    sent = !!(d && d.ok);
    mode = (d && d.mode) || (r.ok ? 'sent' : `http_${r.status}`);
    if (!sent) errMsg = (d && d.error) || `http_${r.status}`;
  } catch (err) {
    errMsg = String(err.message || err);
  }

  const meta = { job_id: jobId, to: ARCHIVE_EMAIL, sent, mode, error: errMsg, had_signature: !!sig };
  await xano.markSignalProcessed(signal.id, 'waiver_archive_emailed', meta);
  log('waiver_archive_emailed', meta);
  return { success: sent, action: 'waiver_archive_emailed', ...meta };
}
