// email-part-return — the dream: a tech marks a part "Return" on the TDR and taps
// "email me the return label." This emails them the ACTUAL prepaid return label (the PDF
// SquareTrade/Allstate sent to our inbox) so they can print + ship it later that day/week.
//
// Resolves the return-label details for the job+part (RMA #, FedEx tracking, distributor)
// from what the RMA watcher + parts watcher already recorded, forwards the label PDF if we
// have the source email on file, and always includes the RMA #, tracking + a FedEx link.
// If the prepaid label hasn't landed in the inbox yet, it sends the details now and records
// the request so the label can follow.
//
//   POST { job_id, part, to, tech_id }  ->  { ok, to, had_label, label_pending, mode }
'use strict';

const crud = require('./_lib/xano/metadata-crud');

const SITE = (process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
function json(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
function pkey(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
async function jget(url, ms) { const r = await fetch(url, { signal: AbortSignal.timeout(ms || 10000) }); return r.json().catch(() => ({})); }

// Pull the PDF label attachment out of the original RMA email (best-effort).
async function fetchLabelPdf(emailId) {
  const clientId = process.env.GMAIL_CLIENT_ID, clientSecret = process.env.GMAIL_CLIENT_SECRET, refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken || !emailId) return null;
  try {
    const { google } = require('googleapis');
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const full = await gmail.users.messages.get({ userId: 'me', id: emailId, format: 'full' });
    const found = [];
    (function walk(p) {
      if (!p) return;
      const mt = (p.mimeType || '').toLowerCase();
      const fn = (p.filename || '');
      if ((mt === 'application/pdf' || /\.pdf$/i.test(fn)) && p.body && p.body.attachmentId) found.push({ filename: fn || 'return-label.pdf', attachmentId: p.body.attachmentId });
      if (p.parts) p.parts.forEach(walk);
    })(full.data.payload);
    if (!found.length) return null;
    const a = found[0];
    const att = await gmail.users.messages.attachments.get({ userId: 'me', messageId: emailId, id: a.attachmentId });
    const b64 = String((att.data && att.data.data) || '').replace(/-/g, '+').replace(/_/g, '/');
    if (!b64) return null;
    return { filename: a.filename.replace(/[^A-Za-z0-9._-]/g, '_'), mime_type: 'application/pdf', content_b64: b64 };
  } catch (_) { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });

  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const jobId = Number(b.job_id || 0);
  const part = String(b.part || '').trim();
  const to = String(b.to || '').trim();
  if (!jobId || !part) return json(400, { ok: false, error: 'job_id + part required' });
  if (!/.+@.+\..+/.test(to)) return json(400, { ok: false, error: 'valid to email required' });

  // Find the matching return-label record (RMA watcher) + supplied-part record.
  const pk = pkey(part);
  let label = null, supplied = null;
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'parts_return_label' }, { id: 'desc' }, 400);
    for (const r of rows || []) { const m = meta(r); if (Number(m.job_id) !== jobId) continue; if (!label && (!m.part || pkey(m.part) === pk)) label = m; if (pkey(m.part) === pk) { label = m; break; } }
  } catch (_) {}
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'warranty_part_supplied' }, { id: 'desc' }, 300);
    for (const r of rows || []) { const m = meta(r); if (Number(m.job_id) === jobId && pkey(m.part) === pk) { supplied = m; break; } }
  } catch (_) {}

  // Context (customer / appliance / claim) for the email.
  let cust = '', appliance = '', claim = (label && label.claim) || '';
  try {
    const tr = await jget(`${SITE}/.netlify/functions/job-truth?job_id=${jobId}&lens=office`, 8000);
    const f = (tr && tr.facts) || {};
    cust = f.customer_name || f.customer_first || (label && label.customer) || '';
    appliance = f.appliance || '';
    claim = claim || f.claim_number || '';
  } catch (_) {}

  const rma = (label && label.rma) || '';
  const tracking = (label && label.tracking) || '';
  const distributor = (label && label.distributor) || (supplied && supplied.distributor) || '';
  const desc = (supplied && supplied.description) || (label && label.return_desc) || '';
  const fedexLink = tracking ? `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tracking)}` : '';

  // Attach the actual prepaid label PDF if we have the source email.
  let pdf = null;
  if (label && label.email_id) pdf = await fetchLabelPdf(label.email_id);
  const hadLabel = !!pdf;
  const labelPending = !label && !!supplied; // required-return part, but the prepaid label email hasn't landed yet

  const lines = [];
  lines.push('Return label for a warranty part.');
  lines.push('');
  lines.push(`Job #${jobId}${cust ? ' — ' + cust : ''}${appliance ? ' (' + appliance + ')' : ''}`);
  if (claim) lines.push(`Claim #: ${claim}`);
  lines.push('');
  lines.push('PART TO RETURN');
  lines.push(`  ${part}${desc ? ' — ' + desc : ''}`);
  if (rma) lines.push(`  RMA #: ${rma}`);
  if (distributor) lines.push(`  Distributor: ${distributor}`);
  if (tracking) { lines.push(`  FedEx tracking: ${tracking}`); lines.push(`  Track / label: ${fedexLink}`); }
  lines.push('');
  if (hadLabel) lines.push('The prepaid return label is attached (PDF) — print it, tape it on, drop it at FedEx.');
  else if (labelPending) lines.push('The prepaid label from the warranty company hasn\'t hit our inbox yet. Use the RMA # above; we\'ll forward the label PDF the moment it arrives.');
  else lines.push('Use the RMA # / tracking above to return it. If a prepaid label was emailed to the shop, check the SquareTrade/Allstate email or ask the office.');
  lines.push('');
  lines.push('Ship it back this week — an unreturned part is a chargeback.');
  lines.push('');
  lines.push('— Ant, TN Appliance Exchange');

  // CC the shop so there's a RECEIPT that the tech marked this part for return (Teddy 7/8).
  const cc = String(process.env.RETURNS_CC_EMAIL || 'tnappliancerepair@gmail.com').split(',').map((s) => s.trim()).filter(Boolean);
  const subject = `Return label — ${part}${rma ? ' (RMA ' + rma + ')' : ''} · Job #${jobId}`;
  const payload = { to, cc, subject, body: lines.join('\n') };
  if (pdf) payload.attachments = [pdf];

  let mode = 'unknown', sendOk = false, sendErr = '';
  try {
    const r = await fetch(`${SITE}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Internal-Auth': process.env.EMAIL_SHARED_SECRET || '' },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({}));
    sendOk = !!(d && d.ok);
    mode = (d && d.mode) || (sendOk ? 'live' : 'error');
    sendErr = (d && d.error) || '';
  } catch (e) { sendErr = String((e && e.message) || e); }

  try { await crud.logEvent('part_return_emailed', { job_id: jobId, part, to, cc, rma, tracking, had_label: hadLabel, label_pending: labelPending, mode, ok: sendOk, tech_id: Number(b.tech_id || 0) || null, at_ms: Date.now() }); } catch (_) {}

  if (!sendOk && mode !== 'dry-run') return json(200, { ok: false, error: sendErr || 'send failed', to });
  return json(200, { ok: true, to, cc, had_label: hadLabel, label_pending: labelPending, mode });
};
