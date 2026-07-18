// ahs-parts-watch — read AHS / Frontdoor part-ordered emails and put the supplied part
// onto the job's tech ticket so the tech sees what's coming + marks Used / Unused /
// Missing like everything else.
//
// CURRENT Frontdoor format (2026-07): subject "Part automatically ordered for dispatch
// id NNNN" with a Dispatch ID + a flattened part table (Part Ordered / Part Number
// Ordered / Quantity Ordered / Supplier → "Burner Switch  DG44-01006C  1  Sundberg").
// Real part #, no tracking, no return (AHS ships to the shop). parseFrontdoorOrdered
// handles it; matchJob resolves the Dispatch ID → job via claim_number/dispatch_source_id.
//
// LEGACY format (kept as fallback): a regular Work Order with the part described in prose
// in the notes — "Part(s) ordered from Marcone eta 07/03/2026" — no structured part #;
// captured by distributor + ETA + work order, and stamps parts_eta_date.
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

// Structured Frontdoor "Part automatically ordered for dispatch id N" — the CURRENT AHS
// format: a Dispatch ID + a flattened part table (headers Part Ordered / Part Number
// Ordered / Quantity Ordered / Supplier, then a value row like
// "Burner Switch    DG44-01006C    1    Sundberg"). No tracking, no return — AHS ships
// the part to the shop. Returns [] if the email isn't this format.
function parseFrontdoorOrdered(body) {
  const t = String(body || '').replace(/\u00a0/g, ' ');
  const dispatch = (t.match(/Dispatch ID:\s*(\d{5,})/i) || t.match(/dispatch id\s+(\d{5,})/i) || [])[1] || '';
  if (!dispatch) return [];
  if (!/order/i.test(t) || !/Supplier:/i.test(t)) return [];
  // everything after the "Supplier:" column header, up to the footer, holds the value rows
  let region = t.slice(t.search(/Supplier:\s*/i) + 'Supplier:'.length);
  const foot = region.search(/Frontdoor,\s|PLEASE DO NOT REPLY|We respect your privacy|&copy;|©/i);
  if (foot > 0) region = region.slice(0, foot);
  const parts = [];
  for (let line of region.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    const cols = line.split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean);
    if (cols.length < 2) continue;
    // the part-number column has letters AND digits, mostly alnum/dash, len >= 4
    const pIdx = cols.findIndex((c) => /[A-Za-z]/.test(c) && /\d/.test(c) && /^[A-Za-z0-9][A-Za-z0-9.\-]{3,}$/.test(c));
    if (pIdx < 0) continue;
    const part = cols[pIdx];
    const description = cols.slice(0, pIdx).join(' ').trim();
    const qtyTok = cols.slice(pIdx + 1).find((c) => /^\d{1,3}$/.test(c));
    const last = cols[cols.length - 1];
    const distributor = last && !/^\d+$/.test(last) && last !== part ? last : '';
    parts.push({ wo: dispatch, part, description, qty: qtyTok ? parseInt(qtyTok, 10) : 1, distributor, eta: '', requires_return: false, note: '' });
  }
  return parts;
}

// Parse one email body. Tries the current structured Frontdoor format first, then the
// older prose "parts ordered from <distributor>" work-order format.
function parseMessage(body) {
  const fd = parseFrontdoorOrdered(body);
  if (fd.length) return fd;
  const out = [];
  const woRe = /Work\s*Order\s*#?\s*([0-9]{5,})/gi;
  const idxs = []; let mm;
  while ((mm = woRe.exec(body)) !== null) idxs.push({ wo: mm[1].trim(), at: mm.index });
  // If no explicit "Work Order N", still try a single block (some templates put the
  // number elsewhere) — but only if there's a part-ordered phrase to anchor on.
  if (!idxs.length) {
    const one = scanParts(body);
    if (one) out.push({ wo: (body.match(/\b(\d{7,})\b/) || [])[1] || '', part: '', description: '', qty: 1, ...one });
    return out;
  }
  for (let i = 0; i < idxs.length; i++) {
    const seg = body.slice(idxs[i].at, i + 1 < idxs.length ? idxs[i + 1].at : body.length);
    const p = scanParts(seg);
    if (p) out.push({ wo: idxs[i].wo, part: '', description: '', qty: 1, ...p });
  }
  return out;
}

// Look for "part(s) ordered from <distributor> [eta <date>]". These are long email
// THREADS (lots of CSC cross-talk), so we anchor on the order phrase and only read
// the NLA/cancel signal + the ETA from a small window AROUND that phrase — a stray
// "bill out labor" elsewhere in the thread must not nuke a legit current order.
function scanParts(seg) {
  const re = /parts?\s*(?:\([s]?\))?\s*(?:were\s+|are\s+|have\s+been\s+)?order(?:ed)?\s+(?:from|through|with)\s+([A-Za-z0-9 .&'\-]{2,40}?)(?=[.,\n;]|\s+eta|\s+by\b|$)/i;
  const om = re.exec(seg);
  if (!om) return null;
  const start = Math.max(0, om.index - 30);
  const win = seg.slice(start, om.index + om[0].length + 130); // sentence around the order
  // "No part is coming" cases — NLA / bill-out-labor / cancelled — only count when they
  // sit right next to THIS order phrase (not somewhere else in the thread).
  if (/\bNLA\b|no longer available|bill out labor|labor to date|cancel(l)?ed/i.test(win)) return null;
  const distributor = om[1].trim().replace(/\s+/g, ' ');
  let eta = '';
  const etaM = win.match(/\beta\b[:\s]*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i) || win.match(/(?:arriv\w+|expected|delivery)[^0-9]{0,12}([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i);
  if (etaM) eta = isoDate(etaM[1]);
  const note = win.replace(/\s+/g, ' ').trim().slice(0, 160);
  return { distributor, eta, note };
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
  // Scheduled (cron) runs carry {next_run} in the body — they self-authorize and run
  // live with no ?secret. Manual runs still require the admin secret. (Without this the
  // every-20-min cron 401'd on EVERY invocation and never processed a single email.)
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
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
      if (!wo.part && !wo.distributor) continue; // need a real part # OR a distributor to be a part note
      const job_id = wo.wo ? await matchJob(wo.wo) : null;
      plan.push({ msg_id: m.id, wo: wo.wo, job_id, matched: !!job_id, part: wo.part || '', description: wo.description || '', qty: wo.qty || 1, distributor: wo.distributor, eta: wo.eta, note: wo.note });
    }
  }

  const out = { ok: true, dry, messages_scanned: msgs.length, new_messages: fresh.length, work_orders: plan.length };
  if (dry) { out.plan = plan.slice(0, 25); return json(200, out); }

  let recorded = 0, etas = 0; const processedIds = new Set(); const unmatched = [];
  for (const wo of plan) {
    if (!wo.job_id) { unmatched.push({ wo: wo.wo, part: wo.part, distributor: wo.distributor, eta: wo.eta }); processedIds.add(wo.msg_id); continue; }
    // Record a supplied part the tech accounts for. New AHS format carries a real part #
    // (+ description/supplier); older prose format has only a distributor. Status
    // 'requested' = ordered + on the way (AHS ships to the shop, no return / no tracking).
    try {
      await crud.logEvent('warranty_part_supplied', {
        job_id: wo.job_id, claim: wo.wo,
        part: wo.part || `Part from ${wo.distributor}`,
        description: wo.part
          ? [wo.description, wo.distributor ? 'via ' + wo.distributor : '', wo.qty > 1 ? '(qty ' + wo.qty + ')' : '', '(AHS dispatch ' + wo.wo + ')'].filter(Boolean).join(' ')
          : `Ordered from ${wo.distributor}${wo.eta ? `, ETA ${wo.eta}` : ''} (AHS WO ${wo.wo})`,
        qty: wo.qty || 1, distributor: wo.distributor || '', vendor: 'AHS',
        requires_return: false, status: 'requested', tracking: '', source: 'ahs_email', at_ms: Date.now(),
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
