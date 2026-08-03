// servicepower-parts-watch — read ServicePower "SERVICER NEW NOTES" part emails and
// put the SUPPLIED parts onto each job's tech ticket, so the tech sees exactly what's
// supposed to be there and taps had / used / missing / return-required.
//
// Teddy + Danielle (2026-06-29): the parts that are supposed to arrive are in the
// emails. ServicePower (Allstate) sends structured notes — one per Call Number (the
// work order), with Part Number, Quantity, "requires return: Yes/No", Tracking. A
// thread can carry several work orders (separate messages), so we walk every message
// and every Call Number block, match each to its job, and record its parts.
//
// Records warranty_part_supplied (same shape warranty-parts.js reads) so the parts
// show on the existing tech "📦 Parts for this job" card. Dedup by message id so a
// re-run never double-adds. DRY-RUN FIRST: ?dry=1 shows what it parsed + matched.
//
//   GET ?secret=<admin>&dry=1[&days=14]   parse + match, write nothing
//   GET ?secret=<admin>[&days=14]         record new supplied parts
'use strict';
const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { readMany } = require('./_lib/gmail-accounts');
const crud = require('./_lib/xano/metadata-crud');
const partNotify = require('./_lib/part-notify');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

// Parse one message body → { call, parts:[{part,desc,qty,requires_return,tracking,provider}] }.
// A message normally has ONE Call Number; we still loop all blocks in case it batches.
function parseMessage(body) {
  const out = [];
  // split into per-Call-Number blocks (keep single-block messages intact)
  const callRe = /Call Number:\s*([0-9A-Za-z-]+)/gi;
  const idxs = []; let mm;
  while ((mm = callRe.exec(body)) !== null) idxs.push({ call: mm[1].trim(), at: mm.index });
  if (!idxs.length) return out;
  for (let i = 0; i < idxs.length; i++) {
    const seg = body.slice(idxs[i].at, i + 1 < idxs.length ? idxs[i + 1].at : body.length);
    if (!/part (order|tracking) details|Part Number:/i.test(seg)) continue; // skip "call created" notes
    const parts = [];
    const segs = seg.split(/Part Number:/i).slice(1);
    for (const s of segs) {
      const part = ((s.match(/^\s*([A-Za-z0-9.\-]+)/) || [])[1] || '').trim();
      if (!part || /^not$/i.test(part)) continue;
      const desc = ((s.match(/Part Description:\s*(.+)/i) || [])[1] || '').trim().replace(/\s+(Quantity|Number|If used|Tracking|Shipping):.*/i, '').trim();
      const qty = parseInt((s.match(/Quantity:\s*(\d+)/i) || [])[1], 10) || 1;
      const requires_return = /requires return:\s*yes/i.test(s);
      let tracking = ((s.match(/Tracking Number:\s*([A-Za-z0-9]+)/i) || [])[1] || '').trim();
      if (/^no$/i.test(tracking) || /not/i.test(tracking)) tracking = '';
      const provider = ((s.match(/Shipping Provider:\s*([A-Za-z ]+)/i) || [])[1] || '').trim();
      parts.push({ part, desc: /not yet/i.test(desc) ? '' : desc, qty, requires_return, tracking, provider });
    }
    if (parts.length) out.push({ call: idxs[i].call, parts });
  }
  return out;
}

// Resolve a ServicePower Call Number → job_id. The intake stores the Call Number
// as jobs.claim_number, and find_job_by_claim_number also checks dispatch_source_id.
// Its response shape is { best:{job_id}, candidates:[{job_id}] } — NOT a top-level
// job_id (that was the bug that made every match come back null). We read best/
// candidates, and fall back to a direct metadata search on both fields.
function pickJobId(d) {
  if (!d) return null;
  if (d.best && d.best.job_id) return Number(d.best.job_id);
  const c = Array.isArray(d.candidates) ? d.candidates : [];
  if (c.length && c[0].job_id) return Number(c[0].job_id);
  return null;
}
async function matchJob(call) {
  const variants = Array.from(new Set([call, String(call).replace(/^0+/, '')].filter(Boolean)));
  for (const v of variants) {
    try {
      const d = await (await fetch(`${XANO}/find_job_by_claim_number?claim_number=${encodeURIComponent(v)}`, { signal: AbortSignal.timeout(10000) })).json();
      const jid = pickJobId(d);
      if (jid) return jid;
    } catch (_) {}
  }
  // Last resort: direct metadata search on the jobs table (exact, then trimmed).
  for (const v of variants) {
    for (const field of ['claim_number', 'dispatch_source_id']) {
      try {
        const row = await crud.searchOne(crud.TABLES.jobs, { [field]: v }, { created_at: 'desc' });
        if (row && row.id) return Number(row.id);
      } catch (_) {}
    }
  }
  return null;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  // Scheduled (cron) runs carry {next_run} in the body — they self-authorize and run
  // live with no ?secret. Manual runs still require the admin secret. (Without this the
  // every-20-min cron 401'd on EVERY invocation and never processed a single email —
  // which is why supplied parts kept piling up and had to be forwarded by hand.)
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const dry = q.dry === '1';
  const days = Math.max(1, Math.min(60, parseInt(q.days, 10) || 14));

  let msgs = [];
  try { msgs = await readMany(`from:servicepower.com "Part Number" newer_than:${days}d`, { max: 60 }); }
  catch (e) { return json(200, { ok: false, error: 'gmail: ' + String(e.message || e) }); }

  // dedup — message ids already processed
  const done = new Set();
  try { const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'sp_parts_watch_done' }, { id: 'desc' }, 80); for (const r of rows || []) for (const id of (meta(r).ids || [])) done.add(String(id)); } catch (_) {}

  const fresh = msgs.filter((m) => !done.has(String(m.id)));
  const plan = [];
  for (const m of fresh) {
    for (const wo of parseMessage(m.body || '')) {
      const job_id = await matchJob(wo.call);
      plan.push({ msg_id: m.id, call: wo.call, job_id, matched: !!job_id, parts: wo.parts });
    }
  }

  const out = { ok: true, dry, messages_scanned: msgs.length, new_messages: fresh.length, work_orders: plan.length };
  if (dry) { out.plan = plan.slice(0, 25); return json(200, out); }

  // record matched parts; flag unmatched (don't lose them)
  let recorded = 0; const processedIds = new Set(); const unmatched = []; const notifyJobs = new Set();
  for (const wo of plan) {
    if (!wo.job_id) { unmatched.push({ call: wo.call, parts: wo.parts.map((p) => p.part) }); processedIds.add(wo.msg_id); continue; }
    for (const p of wo.parts) {
      try {
        await crud.logEvent('warranty_part_supplied', {
          job_id: wo.job_id, claim: wo.call, part: p.part, description: p.desc, qty: p.qty,
          distributor: '', vendor: 'ServicePower', requires_return: p.requires_return,
          status: p.requires_return ? 'to_return' : 'used', tracking: p.tracking, provider: p.provider,
          source: 'servicepower_email', at_ms: Date.now(),
        });
        recorded++;
      } catch (_) {}
    }
    notifyJobs.add(wo.job_id);
    processedIds.add(wo.msg_id);
  }
  if (processedIds.size) { try { await crud.logEvent('sp_parts_watch_done', { ids: [...processedIds], count: processedIds.size, recorded, at_ms: Date.now() }); } catch (_) {} }

  // Auto-text the customer "we've ordered your part" + ask availability — ONCE per job
  // (notifyPartOrdered dedupes one-per-job across runs, and guardedSend enforces opt-out
  // + quiet-hours + caps). HELD by default: sends nothing until the vault flag
  // WARRANTY_PARTS_AUTOTEXT is 'on'/'true' (Teddy 2026-08-03 — flip it on when ready).
  // The office's existing MANUAL part-ordered text is unaffected by this flag.
  const autotextOn = ['on', 'true', '1'].includes(String(await getSecretFresh('WARRANTY_PARTS_AUTOTEXT') || '').trim().toLowerCase());
  let customer_texts = 0, retry_texts = 0;
  if (autotextOn) {
    for (const jid of notifyJobs) {
      try { const r = await partNotify.notifyPartOrdered({ job_id: jid }); if (r && r.ok) customer_texts++; } catch (_) {}
    }
    // Retry net: re-attempt any recently-supplied job whose text was deferred (quiet hours).
    try { const rn = await partNotify.notifyRecentSupplied({}); retry_texts = rn.sent || 0; } catch (_) {}
  }

  out.recorded_parts = recorded;
  out.autotext = autotextOn ? 'live' : 'held';
  out.customer_texts = customer_texts;
  out.retry_texts = retry_texts;
  out.unmatched = unmatched;
  if (unmatched.length) out.note = unmatched.length + ' work order(s) had no matching job — listed under unmatched, not lost.';
  return json(200, out);
};
