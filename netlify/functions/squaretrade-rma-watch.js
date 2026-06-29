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
    if (p.mimeType === 'text/html' && p.body && p.body.data) return Buffer.from(p.body.data, 'base64').toString('utf8')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    return '';
  }
  return walk(payload) || '';
}

// Returns an ARRAY of return-records — one per part. Handles single-part emails AND
// multi-part emails (several Parts Information blocks). RMA/tracking can be shared across
// the email (one shipment) or per-part; we pair by order and fall back to the first.
function parseReturns(subject, body) {
  const pick = (re, s) => { const m = (s || '').match(re); return m ? m[1].trim() : ''; };
  const all = (re, s) => { const out = []; let m; const r = new RegExp(re.source, 'gi'); while ((m = r.exec(s || ''))) out.push(m[1].trim()); return out; };

  const claim = pick(/Claim #\[?claim_([0-9]+)\]?/i, subject) || pick(/Claim Number:\s*([0-9]+)/i, body);
  const customer = pick(/Customer Name:\s*([^\n\r]+)/i, body);

  // RMA # supports dashes (e.g. 10-96069). Prefer body occurrences (one per part); else subject.
  let rmas = all(/RMA\s*#?\s*is\s*([A-Za-z0-9\-]+)/i, body);
  if (!rmas.length) { const sr = pick(/RMA Number #\[?([A-Za-z0-9\-]+)\]?/i, subject); if (sr) rmas = [sr]; }
  const trackings = all(/tracking\s*#?\s*is\s*([0-9]{8,})/i, body);

  // each part block: Distributor … Part Number … (Return Description …)
  const blocks = [];
  const bre = /Distributor:\s*([A-Za-z0-9 .,&\/\-]+?)\s*Part Number:\s*([A-Za-z0-9.\/\-]+)(?:[\s\S]{0,160}?Return Description:\s*([^\n\r]+))?/gi;
  let bm;
  while ((bm = bre.exec(body))) blocks.push({ distributor: bm[1].trim(), part: bm[2].trim(), return_desc: (bm[3] || '').trim() });

  if (!blocks.length) return [];
  return blocks.map((b, i) => ({
    ...b,
    rma: rmas[i] || rmas[0] || '',
    tracking: trackings[i] || trackings[0] || '',
    claim, customer,
  }));
}

// Best-effort explicit-deadline parser. Today's Allstate/SquareTrade RMA emails
// carry NO deadline (just the "won't be paid / may be charged" warning), so this
// usually returns null and we anchor off the email's issue date + policy window.
// But if a vendor email ever says "return within N days" or "by <date>", grab it.
function parseDeadline(body) {
  const within = (body || '').match(/return[^.]{0,50}?within\s+(\d{1,3})\s+(business\s+)?days/i);
  if (within) return { days: Number(within[1]) };
  const by = (body || '').match(/return[^.]{0,50}?by\s+([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i);
  if (by) { const ms = Date.parse(by[1]); if (ms) return { due_ms: ms, text: by[1].trim() }; }
  return null;
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
    // INSPECT mode: dump a real email body so we can see the exact deadline wording.
    //   GET ?inspect=1[&n=1]
    if ((event.queryStringParameters || {}).inspect === '1') {
      const n = Math.max(1, Math.min(3, parseInt((event.queryStringParameters || {}).n, 10) || 1));
      const dump = [];
      for (const m of ((list.data && list.data.messages) || []).slice(0, n)) {
        const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
        const hs = (full.data.payload && full.data.payload.headers) || [];
        dump.push({ subject: (hs.find((h) => h.name === 'Subject') || {}).value || '', date: (hs.find((h) => h.name === 'Date') || {}).value || '', body: bodyText(full.data.payload).replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').slice(0, 6000) });
      }
      return json(200, { ok: true, emails: dump });
    }
    for (const m of ((list.data && list.data.messages) || [])) {
      try {
        const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
        const hs = (full.data.payload && full.data.payload.headers) || [];
        const subject = (hs.find((h) => h.name === 'Subject') || {}).value || '';
        const dateHdr = (hs.find((h) => h.name === 'Date') || {}).value || '';
        const issuedMs = Date.parse(dateHdr) || null;   // when the label was actually issued (the real anchor)
        const bod = bodyText(full.data.payload);
        const dl = parseDeadline(bod);                   // explicit deadline if the email has one (usually null)
        const recs = parseReturns(subject, bod);
        // one entry per part; key = email id + part (so multi-part emails dedup per part)
        for (const rec of recs) if (rec.part || rec.rma) parsed.push({ id: m.id, key: `${m.id}:${rec.part || rec.rma}`, subject, issued_ms: issuedMs, due_ms: (dl && dl.due_ms) || null, due_days: (dl && dl.days) || null, deadline_text: (dl && dl.text) || '', ...rec });
      } catch (_) {}
    }
  } catch (e) { return json(200, { ok: false, error: 'gmail read failed: ' + String((e && e.message) || e) }); }

  // match each to a job by claim number (best-effort)
  for (const p of parsed) {
    if (!p.claim) continue;
    try { const j = await crud.searchOne(crud.TABLES.jobs, { claim_number: p.claim }); if (j) { p.job_id = j.id; } } catch (_) {}
  }

  if (dry) return json(200, { ok: true, count: parsed.length, parsed });

  // BACKFILL mode: record every currently-parsed part as a return-to-do (no SMS, ignores
  // the seen-set) so the warranty-parts section on each job populates from history. Run once.
  if ((event.queryStringParameters || {}).backfill === '1') {
    let n = 0;
    for (const p of parsed) {
      try {
        await crud.logEvent('parts_return_label', { rma: p.rma, claim: p.claim, tracking: p.tracking, distributor: p.distributor, part: p.part, return_desc: p.return_desc, customer: p.customer, job_id: p.job_id || null, status: 'pending', email_id: p.id, issued_ms: p.issued_ms || null, due_ms: p.due_ms || null, due_days: p.due_days || null, deadline_text: p.deadline_text || '', backfill: true, at_ms: Date.now() });
        n++;
      } catch (_) {}
    }
    return json(200, { ok: true, backfilled: n });
  }

  const seen = await seenIds();
  const fresh = parsed.filter((p) => !seen.has(p.key));

  // BASELINE mode: mark the current backlog as already-seen WITHOUT recording return-tos
  // or texting, so only genuinely-new labels alert from here forward. Run once.
  if ((event.queryStringParameters || {}).baseline === '1') {
    const ids = [...seen, ...parsed.map((p) => p.key)].slice(-400);
    try { await crud.logEvent('sp_rma_seen', { ids, baseline: true, at_ms: Date.now() }); } catch (_) {}
    return json(200, { ok: true, baselined: parsed.length, note: 'current labels marked seen; only NEW ones will alert' });
  }
  // record each fresh return-to-do durably
  for (const p of fresh) {
    try {
      await crud.logEvent('parts_return_label', {
        rma: p.rma, claim: p.claim, tracking: p.tracking, distributor: p.distributor,
        part: p.part, return_desc: p.return_desc, customer: p.customer, job_id: p.job_id || null,
        status: 'pending', email_id: p.id, issued_ms: p.issued_ms || null, due_ms: p.due_ms || null,
        due_days: p.due_days || null, deadline_text: p.deadline_text || '', at_ms: Date.now(),
      });
    } catch (_) {}
  }
  // remember the message ids (keep last 200)
  if (fresh.length) {
    const ids = [...seen, ...fresh.map((p) => p.key)].slice(-400);
    try { await crud.logEvent('sp_rma_seen', { ids, at_ms: Date.now() }); } catch (_) {}
  }

  if (fresh.length) {
    const lines = fresh.slice(0, 8).map((p) => `• ${p.part} (${p.return_desc || 'return'}) → ${p.distributor} · ${p.customer || p.claim} · FedEx ${p.tracking}`);
    const body = `[ant] 📦 ${fresh.length} part(s) to RETURN (SquareTrade chargeback risk):\n\n${lines.join('\n')}\n\nLabel emails are in the inbox (from rma_request@squaretrade.com). Print + ship each so we get paid + avoid the core charge.`;
    try { await sendSms(OWNER, body, 'owner', 'sp_rma_watch'); } catch (_) {}
  }

  return json(200, { ok: true, parsed: parsed.length, new_labels: fresh.length, recorded: fresh.map((p) => ({ part: p.part, claim: p.claim, rma: p.rma, job_id: p.job_id || null })) });
};
