// frontdoor-item-ids — capture the STAR line-item ids Frontdoor already sends us, so our
// status pushes can echo them back in `items`.
//
// WHY THIS EXISTS. Akshay's own working request body carries
//   items: [{ id: 822, legacy_item_id: 822, description: "Air Conditioning (Central-Electric)" }]
// and on 2026-09-18 he asked us to start sending it. We had been sending nothing, because
// nothing on our side stored a line-item id -- the AHS intake reads only Description off
//   <WorkOrderLineList Id="20242" Description="Dryer">
// and drops the Id. The number we need has been arriving in every dispatch email all along.
//
// DIRECTION MATTERS. This reads the DISPATCH EMAIL (Gmail -> jobs), not jobs -> Gmail:
//   * one bounded Gmail list call instead of one per job,
//   * the dispatch number is an EXACT single-field match against a job (Xano search is
//     single-field only), so resolution is a real lookup, not a guess.
// The inbound webhook captures the same ids when it goes live (it spells them external_id);
// this covers every job on the board today and every dispatch until then.
//
// WHERE IT LANDS. event_log, action "frontdoor_items_<job_id>" -- a compound action key, so
// reading it back at push time is one exact-match lookup with no JSON decoding. No schema
// change, no XanoScript deploy (the AHS intake is XS and can only be pushed from the Mac).
//
//   GET ?secret=<admin>                    -> dry-run, last 7 days
//   GET ?secret=<admin>&apply=1            -> WRITE the item ids
//   GET ?secret=<admin>&days=90&max=200&apply=1   -> one-time backfill
//   GET ?secret=<admin>&dispatch=23457839&apply=1 -> one dispatch on demand
// Scheduled runs (body {next_run}) self-authorize and apply.
'use strict';
const { google } = require('googleapis');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const FD_RE = /ahs|american home shield|frontdoor|home shield|hsa|2-?10|two-?ten/i;
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
const cacheKey = (jobId) => 'frontdoor_items_' + jobId;

function findXmlAtt(payload) {
  if (!payload) return null;
  for (const p of (payload.parts || [])) {
    const fn = (p.filename || '').toLowerCase();
    if ((fn.endsWith('.xml') || (p.mimeType || '').includes('xml')) && p.body && p.body.attachmentId) return p.body.attachmentId;
    const n = findXmlAtt(p); if (n) return n;
  }
  return null;
}

// Parse every dispatch in one XML, each with its own line items.
//   <DispatchList Id="23457839" ...>
//     <WorkOrderLineList Id="20242" Description="Dryer"> ... </WorkOrderLineList>
//     <WorkOrderLineList Id="20312" Description="Washer"> ... </WorkOrderLineList>
//
// Items are scoped to the DispatchList block that contains them -- never scraped off the
// whole document -- so a second dispatch in the same mail can't inherit the first one's
// lines. Deduped by id because the feed repeats blocks (DispatchContact does the same).
function parseDispatches(xml) {
  const out = [];
  const blocks = String(xml || '').split(/(?=<DispatchList\s)/);
  for (const b of blocks) {
    const d = b.match(/<DispatchList[^>]*\sId="(\d+)"/i);
    if (!d) continue;
    const seen = new Set(); const items = [];
    const re = /<WorkOrderLineList[^>]*\sId="(\d+)"[^>]*\sDescription="([^"]*)"/gi;
    let m;
    while ((m = re.exec(b))) {
      const id = Number(m[1]);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push({ id, description: decode(m[2]) });
    }
    if (items.length) out.push({ dispatch_number: d[1], items });
  }
  return out;
}

// Resolve a dispatch number to ONE job via the deployed resolver (it searches BOTH
// claim_number and dispatch_source_id, which a single-field metadata search cannot).
// It returns one candidate per matching FIELD, so the same job can come back twice --
// dedupe on job_id, and refuse anything genuinely ambiguous rather than guess.
async function resolveJob(dispatchNumber) {
  const r = await fetch(`${XANO}/find_job_by_claim_number?claim_number=${encodeURIComponent(dispatchNumber)}`, {
    signal: AbortSignal.timeout(12000),
  }).then((x) => x.json()).catch(() => null);
  const cands = (r && r.candidates) || [];
  const ids = [...new Set(cands.map((c) => Number(c.job_id)).filter(Boolean))];
  if (ids.length !== 1) return { job_id: null, ambiguous: ids.length > 1, count: ids.length };
  const wc = String((cands.find((c) => Number(c.job_id) === ids[0]) || {}).warranty_company || '');
  return { job_id: ids[0], warranty_company: wc };
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const apply = scheduled || q.apply === '1';
  const force = q.force === '1';
  const days = Math.min(Math.max(parseInt(q.days, 10) || (scheduled ? 3 : 7), 1), 400);
  const max = Math.min(parseInt(q.max, 10) || (scheduled ? 40 : 25), 200);

  const cid = process.env.GMAIL_CLIENT_ID, cs = process.env.GMAIL_CLIENT_SECRET, rt = process.env.GMAIL_REFRESH_TOKEN;
  if (!cid || !cs || !rt) return json(500, { ok: false, error: 'gmail_env_missing' });
  const oauth2 = new google.auth.OAuth2(cid, cs); oauth2.setCredentials({ refresh_token: rt });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  // One dispatch on demand, else the recent-dispatch window. The item ids live in the XML
  // attachment, so a body-only Frontdoor mail simply carries none (reported, not an error).
  const query = q.dispatch
    ? String(q.dispatch)
    : `subject:"New Dispatch Notification" has:attachment newer_than:${days}d`;

  const results = []; const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  let scanned = 0;
  try {
    const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: max });
    const msgs = (list.data.messages) || [];
    const seenDispatch = new Set();
    for (const { id } of msgs) {
      scanned++;
      const mm = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const att = findXmlAtt(mm.data.payload);
      if (!att) { bump('no_xml'); continue; }
      const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: att });
      const xml = Buffer.from(a.data.data, 'base64url').toString('utf8');
      for (const d of parseDispatches(xml)) {
        // A dispatch re-mails on every update; only the newest copy needs reading.
        if (seenDispatch.has(d.dispatch_number)) continue;
        seenDispatch.add(d.dispatch_number);
        const rec = { dispatch_number: d.dispatch_number, items: d.items };
        const j = await resolveJob(d.dispatch_number);
        if (!j.job_id) { rec.status = j.ambiguous ? 'ambiguous_job_match' : 'no_job_match'; bump(rec.status); results.push(rec); continue; }
        rec.job_id = j.job_id;
        if (!FD_RE.test(j.warranty_company || '')) { rec.status = 'not_frontdoor'; bump(rec.status); results.push(rec); continue; }
        let cached = null;
        try { cached = await crud.searchOne(crud.TABLES.event_log, { action: cacheKey(j.job_id) }, { id: 'desc' }); } catch (_) {}
        if (cached && !force) { rec.status = 'already_cached'; bump(rec.status); results.push(rec); continue; }
        if (!apply) { rec.status = 'would_write'; bump(rec.status); results.push(rec); continue; }
        try {
          await crud.logEvent(cacheKey(j.job_id), {
            job_id: j.job_id, dispatch_number: d.dispatch_number, items: d.items,
            source: 'dispatch_email', at_ms: Date.now(),
          });
          rec.status = 'WROTE'; bump(rec.status);
        } catch (e) { rec.status = 'error'; rec.error = String((e && e.message) || e).slice(0, 120); bump('error'); }
        results.push(rec);
      }
    }
  } catch (e) {
    return json(200, { ok: false, error: String((e && e.message) || e).slice(0, 200), scanned, counts, results });
  }

  return json(200, { ok: true, mode: apply ? 'APPLIED' : 'dry-run', query, scanned, counts, results });
};
