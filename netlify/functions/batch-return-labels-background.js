// batch-return-labels-background — "send me ALL my open SquareTrade return labels at once."
// The one-at-a-time email-part-return button is great for a single part, but with 150+
// parts owed back nobody taps it 150 times. This walks every OPEN return, pulls each
// prepaid label PDF out of the original RMA email, and emails them in printable batches
// (grouped by distributor, most-urgent first) with a cover sheet — customer · part · RMA
// · tracking · due — so Teddy prints a stack, tapes them on, and ships.
//
// Background fn (15-min budget) — pulling 150 PDFs from Gmail can't finish in a sync 26s.
//   POST { to?, distributor?, tech_id?, max_per_email?, limit? }   (fired by batch-return-labels)
'use strict';
const crud = require('./_lib/xano/metadata-crud');
const { loadOpenReturns } = require('./_lib/returns');

const SITE = (process.env.PUBLIC_SITE_BASE || 'https://tnapplianceexchange.net').replace(/\/+$/, '');
function json(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function fmtDue(ms) { if (!ms) return 'no date'; const d = Math.round((ms - Date.now()) / 86400000); return d < 0 ? `${-d}d OVERDUE` : (d === 0 ? 'due today' : `${d}d left`); }

// Pull the prepaid label PDF attachment out of the original RMA email (best-effort).
async function fetchLabelPdf(gmail, emailId) {
  if (!emailId) return null;
  try {
    const full = await gmail.users.messages.get({ userId: 'me', id: emailId, format: 'full' });
    const found = [];
    (function walk(p) {
      if (!p) return;
      const mt = (p.mimeType || '').toLowerCase(); const fn = (p.filename || '');
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

async function sendEmail(payload) {
  try {
    const r = await fetch(`${SITE}/.netlify/functions/send-email`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Auth': process.env.EMAIL_SHARED_SECRET || '' },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({}));
    return !!(d && d.ok);
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const to = String(b.to || process.env.RETURNS_CC_EMAIL || 'tnappliancerepair@gmail.com').trim();
  const perEmail = Math.min(Math.max(parseInt(b.max_per_email, 10) || 15, 3), 20);
  const distFilter = String(b.distributor || '').trim().toUpperCase();
  const techFilter = b.tech_id ? Number(b.tech_id) : null;
  const limit = b.limit ? Number(b.limit) : 0;

  let open = [];
  try { const res = await loadOpenReturns({ max: 500 }); open = (res && res.returns) || []; } catch (_) {}
  if (distFilter) open = open.filter((o) => String(o.distributor || '').toUpperCase() === distFilter);
  if (techFilter) open = open.filter((o) => Number(o.tech_id) === techFilter);
  // most-urgent first (soonest due), then by distributor so batches are tidy
  open.sort((a, c) => ((a.due_ms || 8e15) - (c.due_ms || 8e15)) || String(a.distributor).localeCompare(String(c.distributor)));
  if (limit > 0) open = open.slice(0, limit);

  const gmailReady = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
  let gmail = null;
  if (gmailReady) { try { const { google } = require('googleapis'); const o = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET); o.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN }); gmail = google.gmail({ version: 'v1', auth: o }); } catch (_) {} }

  // Resolve each return's label PDF (bounded concurrency so it's quick but gentle on Gmail).
  let withPdf = 0, pending = 0;
  const CONC = 4;
  for (let i = 0; i < open.length; i += CONC) {
    const slice = open.slice(i, i + CONC);
    await Promise.all(slice.map(async (o) => {
      o.pdf = gmail ? await fetchLabelPdf(gmail, o.email_id) : null;
      if (o.pdf) withPdf++; else pending++;
    }));
  }

  // Batch: group by distributor, chunk to perEmail. Each email = a printable stack.
  const groups = {};
  for (const o of open) { const g = (o.distributor || 'OTHER').toUpperCase(); (groups[g] = groups[g] || []).push(o); }
  const batches = [];
  for (const g of Object.keys(groups).sort()) { const arr = groups[g]; for (let i = 0; i < arr.length; i += perEmail) batches.push({ dist: g, items: arr.slice(i, i + perEmail), part: Math.floor(i / perEmail) + 1, parts: Math.ceil(arr.length / perEmail) }); }

  let emailsSent = 0, labelsAttached = 0;
  for (const batch of batches) {
    const attached = batch.items.filter((o) => o.pdf);
    const lines = [];
    lines.push(`SquareTrade / Allstate return labels — ${batch.dist}${batch.parts > 1 ? ` (batch ${batch.part} of ${batch.parts})` : ''}`);
    lines.push(`${attached.length} printable label(s) attached below. Print, tape on the matching part, drop at FedEx.`);
    lines.push('');
    lines.push('PARTS IN THIS BATCH:');
    batch.items.forEach((o, i) => {
      lines.push(`  ${i + 1}. ${o.part}${o.return_desc ? ' (' + o.return_desc + ')' : ''} — ${o.customer || 'job #' + (o.job_id || '?')}`);
      lines.push(`     RMA ${o.rma || '—'} · tracking ${o.tracking || '—'} · ${fmtDue(o.due_ms)}${o.pdf ? '' : '  ⚠ label PDF not on file — use the RMA/tracking'}`);
    });
    lines.push('');
    lines.push('Ship these this week — an unreturned part is a chargeback.');
    lines.push('— Ant, TN Appliance Exchange');
    const ok = await sendEmail({ to, subject: `📦 Return labels — ${batch.dist}${batch.parts > 1 ? ` (${batch.part}/${batch.parts})` : ''} · ${attached.length} labels`, body: lines.join('\n'), attachments: attached.map((o) => o.pdf) });
    if (ok) { emailsSent++; labelsAttached += attached.length; }
  }

  try { await crud.logEvent('batch_return_labels_sent', { to, open: open.length, with_pdf: withPdf, pending, emails: emailsSent, labels_attached: labelsAttached, distributor: distFilter || 'all', at_ms: Date.now() }); } catch (_) {}

  // A quick text so Teddy knows it landed + how many.
  try {
    const { sendSms } = require('./_lib/sms');
    const OWNER = process.env.OWNER_PHONE || '+16154855795';
    await sendSms(OWNER, `📦 Return labels emailed to ${to}: ${labelsAttached} printable labels across ${emailsSent} email(s), grouped by distributor (most-urgent first).${pending ? ` ${pending} had no label PDF on file (RMA/tracking on the cover sheet).` : ''}`, 'owner', 'batch_return_labels');
  } catch (_) {}

  return json(200, { ok: true, open: open.length, with_pdf: withPdf, pending, emails: emailsSent, labels_attached: labelsAttached });
};
