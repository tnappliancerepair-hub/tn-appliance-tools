// ahs-parts-watch — read AHS / Frontdoor "Notes Entered" work-order emails where a
// part was ordered, and put that supplied part onto the job's tech ticket + feed its
// ETA into scheduling so we don't roll a truck before the part lands.
//
// Teddy + Danielle (2026-06-29): AHS parts come differently than ServicePower. The
// email is a regular Work Order (e.g. "NORMAL Work Order 48841459"), and the part is
// described in prose in the DISPATCH NOTES — "Part(s) ordered from Marcone eta
// 07/03/2026" — there is NO structured part number. So we capture the distributor +
// ETA + work order, record it as a supplied part (so the tech can mark Used / Unused /
// Missing like everything else), and stamp the job's parts_eta_date so the auto-
// scheduler waits for it.
//
//   GET ?secret=<admin>&dry=1[&days=14]   parse + match, write nothing
//   GET ?secret=<admin>[&days=14]         record supplied parts + set ETAs
'use strict';
const { getSecret } = require('./_lib/secrets');
const { readMany } = require('./_lib/gmail-accounts');
const crud = require('./_lib/xano/metadata-crud');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

// MM/DD/YYYY (or MM/DD/YY) → YYYY-MM-DD. Returns '' if it can't.
function isoDate(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return '';
  let [, mo, d, y] = m;
  if (y.length === 2) y = '20' + y;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Parse one email body → [{ wo, distributor, eta, note }] (one per work order that
// has a part-ordered note). AHS usually carries ONE work order per email but we walk
// all of them in case a thread batches.
function parseMessage(body) {
  const out = [];
  const woRe = /Work\s*Order\s*#?\s*([0-9]{5,})/gi;
  const idxs = []; let mm;
  while ((mm = woRe.exec(body)) !== null) idxs.push({ wo: mm[1].trim(), at: mm.index });
  // If no explicit "Work Order N", still try a single block (some templates put the
  // number elsewhere) — but only if there's a part-ordered phrase to anchor on.
  if (!idxs.length) {
    const one = scanParts(body);
    if (one) out.push({ wo: (body.match(/\b(\d{7,})\b/) || [])[1] || '', ...one });
    return out;
  }
  for (let i = 0; i < idxs.length; i++) {
    const seg = body.slice(idxs[i].at, i + 1 < idxs.length ? idxs[i + 1].at : body.length);
    const p = scanParts(seg);
    if (p) out.push({ wo: idxs[i].wo, ...p });
  }
  return out;
}

// Look for "part(s) ordered from <distributor> [eta <date>]" (+ a loose standalone eta).
function scanParts(seg) {
  // Skip "no part is coming" cases — NLA / bill-out-labor / cancelled. Recording a
  // "Part from Marcone" on these would mislead the office into thinking one's en route.
  if (/\bNLA\b|no longer available|bill out labor|labor to date|cancel(l)?ed/i.test(seg)) return null;
  const om = seg.match(/parts?\s*(?:\([s]?\))?\s*(?:were\s+|are\s+|have\s+been\s+)?order(?:ed)?\s+(?:from|through|with)\s+([A-Za-z0-9 .&'\-]{2,40}?)(?=[.,\n;]|\s+eta|\s+by\b|$)/i);
  if (!om) return null;
  const distributor = om[1].trim().replace(/\s+/g, ' ');
  let eta = '';
  const etaM = seg.match(/\beta\b[:\s]*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i) || seg.match(/(?:arriv\w+|expected|delivery)[^0-9]{0,12}([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i);
  if (etaM) eta = isoDate(etaM[1]);
  const note = (seg.match(/(parts?[^.\n]{0,120})/i) || [])[1] || '';
  return { distributor, eta, note: note.trim().slice(0, 160) };
}

function pickJobId(d) {
  if (!d) return null;
  if (d.best && d.best.job_id) return Number(d.best.job_id);
  const c = Array.isArray(d.candidates) ? d.candidates : [];
  if (c.length && c[0].job_id) return Number(c[0].job_id);
  return null;
}
async function matchJob(wo) {
  const variants = Array.from(new Set([wo, String(wo).replace(/^0+/, '')].filter(Boolean)));
  for (const v of variants) {
    try {
      const d = await (await fetch(`${XANO}/find_job_by_claim_number?claim_number=${encodeURIComponent(v)}`, { signal: AbortSignal.timeout(10000) })).json();
      const jid = pickJobId(d);
      if (jid) return jid;
    } catch (_) {}
  }
  for (const v of variants) {
    for (const field of ['claim_number', 'dispatch_source_id', 'job_number']) {
      try { const row = await crud.searchOne(crud.TABLES.jobs, { [field]: v }, { created_at: 'desc' }); if (row && row.id) return Number(row.id); } catch (_) {}
    }
  }
  return null;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const dry = q.dry === '1';
  const days = Math.max(1, Math.min(60, parseInt(q.days, 10) || 14));

  let msgs = [];
  try { msgs = await readMany(`from:frontdoor.com (ordered OR "eta" OR part) newer_than:${days}d`, { max: 60 }); }
  catch (e) { return json(200, { ok: false, error: 'gmail: ' + String(e.message || e) }); }

  const done = new Set();
  try { const rows = await crud.searchPage(crud.TABLES.event_log, { action: 'ahs_parts_watch_done' }, { id: 'desc' }, 80); for (const r of rows || []) for (const id of (meta(r).ids || [])) done.add(String(id)); } catch (_) {}

  const fresh = msgs.filter((m) => !done.has(String(m.id)));
  const plan = [];
  for (const m of fresh) {
    for (const wo of parseMessage(m.body || '')) {
      if (!wo.distributor) continue;
      const job_id = wo.wo ? await matchJob(wo.wo) : null;
      plan.push({ msg_id: m.id, wo: wo.wo, job_id, matched: !!job_id, distributor: wo.distributor, eta: wo.eta, note: wo.note });
    }
  }

  const out = { ok: true, dry, messages_scanned: msgs.length, new_messages: fresh.length, work_orders: plan.length };
  if (dry) { out.plan = plan.slice(0, 25); return json(200, out); }

  let recorded = 0, etas = 0; const processedIds = new Set(); const unmatched = [];
  for (const wo of plan) {
    if (!wo.job_id) { unmatched.push({ wo: wo.wo, distributor: wo.distributor, eta: wo.eta }); processedIds.add(wo.msg_id); continue; }
    // Record a supplied part the tech accounts for (no part # from AHS — label by distributor + WO).
    try {
      await crud.logEvent('warranty_part_supplied', {
        job_id: wo.job_id, claim: wo.wo, part: `Part from ${wo.distributor}`,
        description: `Ordered from ${wo.distributor}${wo.eta ? `, ETA ${wo.eta}` : ''} (AHS WO ${wo.wo})`,
        distributor: wo.distributor, vendor: 'AHS', requires_return: false, status: 'to_return',
        tracking: '', source: 'ahs_email', at_ms: Date.now(),
      });
      recorded++;
    } catch (_) {}
    // Feed the ETA into scheduling so we don't roll before the part lands.
    if (wo.eta) {
      try { await crud.update(crud.TABLES.jobs, wo.job_id, { parts_status: 'awaiting_parts', parts_eta_date: wo.eta }); etas++; } catch (_) {}
    }
    processedIds.add(wo.msg_id);
  }
  if (processedIds.size) { try { await crud.logEvent('ahs_parts_watch_done', { ids: [...processedIds], count: processedIds.size, recorded, etas, at_ms: Date.now() }); } catch (_) {} }

  out.recorded_parts = recorded;
  out.etas_set = etas;
  out.unmatched = unmatched;
  if (unmatched.length) out.note = unmatched.length + ' work order(s) had no matching job — listed under unmatched, not lost.';
  return json(200, out);
};
