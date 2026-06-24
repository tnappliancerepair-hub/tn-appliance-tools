// squaretrade-rma-watch — the PARTS-RETURN CHARGEBACK-KILLER.
// SquareTrade/Allstate emails a prepaid return label per part to return
// (from rma_request@squaretrade.com). If a part isn't returned, we eat a chargeback.
// This watches the inbox, parses every RMA email, records a return-to-do per part
// (RMA#, FedEx tracking#, distributor, part#, claim#, customer), matches it to the job,
// and texts Teddy a digest of new labels so NOTHING slips.
//
//   scheduled (every 30 min)   parse new RMA emails → record + digest
//   GET ?dryrun=1              show parsed matches, no record/SMS
'use strict';

const { google } = require('googleapis');
const { sendSms } = require('./_lib/sms');
const crud = require('./_lib/xano/metadata-crud');

const OWNER = '+16154855795';
const QUERY = 'from:rma_request@squaretrade.com newer_than:30d';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }

// pull the text body out of a gmail payload (prefer text/plain, fall back to stripped html)
function bodyText(payload) {
  function walk(p) {
    if (!p) return '';
    if (p.mimeType === 'text/plain' && p.body && p.body.data) return Buffer.from(p.body.data, 'base64').toString('utf8');
    if (p.parts) { for (const sp of p.parts) { const t = walk(sp); if (t) return t; } }
    if (p.mimeType === 'text/html' && p.body && p.body.data) return Buffer.from(p.body.data, 'base64').toString('utf8').replace(/<[^>]+>/g, ' ');
    return '';
  }
  return walk(payload) || '';
}

function parseRma(subject, body) {
  const pick = (re, s) => { const m = (s || '').match(re); return m ? m[1].trim() : ''; };
  return {
    rma: pick(/RMA Number #\[?([0-9]+)\]?/i, subject) || pick(/RMA #\s*is\s*([0-9]+)/i, body),
    claim: pick(/Claim #\[?claim_([0-9]+)\]?/i, subject) || pick(/Claim Number:\s*([0-9]+)/i, body),
    tracking: pick(/tracking #?\s*is\s*([0-9]{8,})/i, body),
    distributor: pick(/Distributor:\s*([A-Za-z0-9 .,&\/\-]+?)\s*(?:Part Number|$)/i, body),
    part: pick(/Part Number:\s*([A-Za-z0-9.\/\-]+)/i, body),
    return_desc: pick(/Return Description:\s*([^\n\r]+)/i, body),
    customer: pick(/Customer Name:\s*([^\n\r]+)/i, body),
  };
}

async function seenIds() {
  try {
    const row = await crud.searchOne(crud.TABLES.event_log, { action: 'sp_rma_seen' }, { id: 'desc' });
    let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } }
    return new Set((m && m.ids) || []);
  } catch (_) { return new Set(); }
}

exports.handler = async function (event) {
  const dry = (event.queryStringParameters || {}).dryrun === '1';
  const clientId = process.env.GMAIL_CLIENT_ID, clientSecret = process.env.GMAIL_CLIENT_SECRET, refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return json(200, { ok: false, error: 'no gmail creds' });

  let parsed = [];
  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const list = await gmail.users.messages.list({ userId: 'me', q: QUERY, maxResults: 25 });
    for (const m of ((list.data && list.data.messages) || [])) {
      try {
        const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
        const hs = (full.data.payload && full.data.payload.headers) || [];
        const subject = (hs.find((h) => h.name === 'Subject') || {}).value || '';
        const rec = parseRma(subject, bodyText(full.data.payload));
        if (rec.rma || rec.claim) parsed.push({ id: m.id, subject, ...rec });
      } catch (_) {}
    }
  } catch (e) { return json(200, { ok: false, error: 'gmail read failed: ' + String((e && e.message) || e) }); }

  // match each to a job by claim number (best-effort)
  for (const p of parsed) {
    if (!p.claim) continue;
    try { const j = await crud.searchOne(crud.TABLES.jobs, { claim_number: p.claim }); if (j) { p.job_id = j.id; } } catch (_) {}
  }

  if (dry) return json(200, { ok: true, count: parsed.length, parsed });

  const seen = await seenIds();
  const fresh = parsed.filter((p) => !seen.has(p.id));
  // record each fresh return-to-do durably
  for (const p of fresh) {
    try {
      await crud.logEvent('parts_return_label', {
        rma: p.rma, claim: p.claim, tracking: p.tracking, distributor: p.distributor,
        part: p.part, return_desc: p.return_desc, customer: p.customer, job_id: p.job_id || null,
        status: 'pending', email_id: p.id, at_ms: Date.now(),
      });
    } catch (_) {}
  }
  // remember the message ids (keep last 200)
  if (fresh.length) {
    const ids = [...seen, ...fresh.map((p) => p.id)].slice(-200);
    try { await crud.logEvent('sp_rma_seen', { ids, at_ms: Date.now() }); } catch (_) {}
  }

  if (fresh.length) {
    const lines = fresh.slice(0, 8).map((p) => `• ${p.part} (${p.return_desc || 'return'}) → ${p.distributor} · ${p.customer || p.claim} · FedEx ${p.tracking}`);
    const body = `[ant] 📦 ${fresh.length} part(s) to RETURN (SquareTrade chargeback risk):\n\n${lines.join('\n')}\n\nLabel emails are in the inbox (from rma_request@squaretrade.com). Print + ship each so we get paid + avoid the core charge.`;
    try { await sendSms(OWNER, body, 'owner', 'sp_rma_watch'); } catch (_) {}
  }

  return json(200, { ok: true, parsed: parsed.length, new_labels: fresh.length, recorded: fresh.map((p) => ({ part: p.part, claim: p.claim, rma: p.rma, job_id: p.job_id || null })) });
};
