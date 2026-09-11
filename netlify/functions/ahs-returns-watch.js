// ahs-returns-watch — AHS's half of the parts-return chargeback shield.
//
// WHY THIS EXISTS. Measured 2026-09-11 on the platform, last 90 days:
//
//     SquareTrade  1,024 parts / 426 jobs   491 with tracking   20 flagged owed-back
//     AHS            980 parts / 489 jobs     0 with tracking    0 flagged owed-back
//
// AHS is HALF our parts volume and every one of those 980 rows says "nothing owed back" --
// because ahs-parts-watch hard-codes requires_return:false on the part-ordered email, which
// genuinely doesn't state one. The obligation arrives LATER, in a separate email nobody was
// reading: "AHS Part Return Notification" from AHS_Purchasing_Part_Returns@ahs.com.
//
// AHS is the STRICTER of the two vendors, not the looser one:
//   * an explicit clock  -- "returned to the supplier within 10 days" (or 30)
//   * an explicit dollar -- "or $295.74 will be deducted from your payables"
//   * NO shipping label  -- unlike SquareTrade's prepaid FedEx label, we pay the freight
//     unless the error was AHS's, so a forgotten return costs twice.
//
// Real notices in the last 30 days alone: $122.39, $149.95, $192.13, $219.68, $295.74, and
// a run of $60 cores. Today the only thing standing between that and the payables deduction
// is someone noticing the email and hand-emailing Bobbi at AHS for an RMA.
//
// WHAT IT DOES. Reads those notices, parses each part, joins to the job, and stamps
// must_return + the deadline + the dollar onto the platform job_part row -- so the obligation
// lights up in every lens that ALREADY reads must_return (tech card "OWED BACK", office tile
// "N STILL OWED BACK", the drawer), with the clock and the money the office needs to triage.
//
// THE JOIN KEY, verified against live data: the notice's "PO #: 73350799-4667379" carries the
// AHS claim number as its FIRST segment. All 11 PO numbers sampled matched a real AHS job on
// the platform by claim_number. A claim can cover several machines (the documented multi-
// machine stop), so we prefer the sibling that already carries this part number.
//
// DELIBERATELY DOES NOT TOUCH disposition. 064 is explicit: must_return is the VENDOR's rule,
// disposition is what the TECH did, and a CORE is owed back even when it was USED. Forcing
// disposition='return' here would erase the tech's truth and is the exact conflation that
// migration warns about.
//
//   GET ?secret=<admin>&dryrun=1[&days=30]   parse + match, write nothing
//   GET ?secret=<admin>[&days=30]            stamp the obligations
//   Kill switch: vault AHS_RETURNS_WATCH_ENABLED=false
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { readMany } = require('./_lib/gmail-accounts');
const crud = require('./_lib/xano/metadata-crud');

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';   // TN Appliance Exchange LLC (keeper)
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const SENDER_DEFAULT = 'AHS_Purchasing_Part_Returns@ahs.com';

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function normP(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

// ── parser ───────────────────────────────────────────────────────────────────
// A part number in the "Parts:" run has letters AND several digits (WE01X25334,
// AKC72949319, WPW10500140); the descriptions around it -- "Drum Bearing", "heating
// element", "comp", "board core" -- carry no digits at all. Keying on digit-count rather
// than capitalisation is what separates them, because "Drum Bearing" is Title Case too.
function looksLikePartNo(tok) {
  const t = String(tok || '').trim();
  if (t.length < 5 || t.length > 24) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9.\-\/]*$/.test(t)) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  return (t.replace(/\D/g, '').length >= 3);
}

// "Parts: WE01X25334 Drum Bearing WE11X21156 heating element WE03X25576 Front Bearing Note:"
// -> three {number, description}. Each part number opens a part; everything up to the next
// part number is its description.
function parsePartsRun(run) {
  const out = [];
  const toks = String(run || '').split(/\s+/).filter(Boolean);
  let cur = null;
  for (const tok of toks) {
    if (looksLikePartNo(tok)) {
      if (cur) out.push(cur);
      cur = { number: tok, description: '' };
    } else if (cur) {
      cur.description = (cur.description ? cur.description + ' ' : '') + tok;
    }
  }
  if (cur) out.push(cur);
  return out.map((p) => ({ number: p.number, description: p.description.trim() }));
}

// Parse one "AHS Part Return Notification". Returns null when the email isn't one.
// `receivedMs` anchors the deadline -- AHS states a RELATIVE window ("within 30 days"),
// so the clock is notice-date + N, and we take the notice date from the email itself.
function parseAhsReturnNotice(subject, body, receivedMs) {
  const t = String(body || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (!/Part Return Notification/i.test(t) && !/Part Return Notification/i.test(String(subject || ''))) return null;

  const pick = (re, s) => { const m = String(s || '').match(re); return m ? String(m[1]).trim() : ''; };

  // "PO #: 73350799-4667379" / "PO #:  70192519-4414549" / "... 79865299-5217099 CORE ONLY"
  const poRaw = pick(/PO\s*#\s*:?\s*([0-9]{5,}\s*-\s*[0-9]{3,})/i, t) || pick(/PO#\s*([0-9]{5,}\s*-\s*[0-9]{3,})/i, String(subject || ''));
  const po = poRaw.replace(/\s+/g, '');
  const claim = (po.split('-')[0] || '').trim();
  if (!claim) return null;                                 // no join key -> not actionable

  const days = parseInt(pick(/within\s+(\d{1,3})\s+days/i, t), 10) || 0;
  const penalty = pick(/\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)\s*will be deducted/i, t);
  const penaltyCents = penalty ? Math.round(parseFloat(penalty.replace(/,/g, '')) * 100) : null;

  // REA # holds either a real RMA/RA number or prose instructions ("invoice", "call tag").
  // Keep the number when there is one; the prose is an instruction, not an identifier.
  const rea = pick(/REA\s*#\s*:?\s*([^•]+?)(?:\s*Parts\s*:|\s*•|$)/i, t);
  const rma = pick(/\b(?:RMA|RA)\s*#?\s*([A-Za-z0-9][A-Za-z0-9\-]{3,})/i, rea) || '';

  let partsRun = pick(/Parts\s*:\s*([\s\S]*?)(?:\s*Note\s*:|$)/i, t);
  const parts = parsePartsRun(partsRun);

  const dueMs = (receivedMs && days) ? receivedMs + days * 86400000 : 0;
  return {
    po, claim,
    vendor_no: pick(/Vendor\s*#\s*:?\s*([0-9]+)/i, t),
    job_name: pick(/Job Name\s*:?\s*([^•]+?)(?:\s*•|$)/i, t),
    supplier: pick(/Supplier Name\s*:?\s*([^•]+?)(?:\s*•|$)/i, t),
    rea, rma,
    core_only: /CORE ONLY/i.test(String(subject || '') + ' ' + t),
    days,
    penalty_cents: penaltyCents,
    due_date: dueMs ? new Date(dueMs).toISOString().slice(0, 10) : '',
    parts,
  };
}

// ── platform rest ────────────────────────────────────────────────────────────
function pf(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  const u = (p) => `${base}/rest/v1/${p}`;
  return {
    async get(p) { try { const r = await fetch(u(p), { headers: H, signal: AbortSignal.timeout(12000) }); return r.ok ? await r.json() : []; } catch (_) { return []; } },
    async patch(table, filter, row) { try { const r = await fetch(u(`${table}?${filter}`), { method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, H), body: JSON.stringify(row), signal: AbortSignal.timeout(12000) }); return r.ok; } catch (_) { return false; } },
    async insert(table, row) { try { const r = await fetch(u(table), { method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, H), body: JSON.stringify(row), signal: AbortSignal.timeout(12000) }); return r.ok; } catch (_) { return false; } },
  };
}

// One AHS claim can cover several machines -- each its own job row (the documented multi-
// machine stop). Pick the sibling that already carries this part; else the live one; else
// the newest. Guessing wrong would stamp the obligation on the wrong machine's ticket.
async function resolveJob(db, claim, partNos) {
  const c = String(claim || '').trim(); if (!c) return null;
  const jobs = await db.get(`job?company_id=eq.${TN_COMPANY}&claim_number=eq.${encodeURIComponent(c)}&select=id,status,scheduled_day,created_at&limit=20`);
  if (!Array.isArray(jobs) || !jobs.length) return null;
  if (jobs.length === 1) return jobs[0].id;

  const wanted = new Set((partNos || []).map(normP).filter(Boolean));
  if (wanted.size) {
    const rows = await db.get(`job_part?job_id=in.(${jobs.map((j) => j.id).join(',')})&select=job_id,number&limit=400`);
    for (const r of (Array.isArray(rows) ? rows : [])) {
      if (r && r.number && wanted.has(normP(r.number))) return r.job_id;      // the part is already on this one
    }
  }
  const rank = (s) => (s === 'canceled' ? 3 : (s === 'completed' ? 2 : 1));   // prefer a live job
  return jobs.slice().sort((a, b) =>
    (rank(a.status) - rank(b.status)) || (String(b.created_at || '').localeCompare(String(a.created_at || '')))
  )[0].id;
}

async function runAhsReturns(opts = {}) {
  const dry = !!opts.dry;
  const days = Math.max(1, Math.min(180, parseInt(opts.days, 10) || 30));

  const enabled = String((await getSecretFresh('AHS_RETURNS_WATCH_ENABLED')) || 'true').toLowerCase() !== 'false';
  if (!dry && !enabled) return { ok: true, disabled: true, note: 'AHS_RETURNS_WATCH_ENABLED=false' };

  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!base || !key) return { ok: false, error: 'platform_not_configured' };
  const db = pf(base, key);

  const sender = (await getSecretFresh('AHS_RETURNS_WATCH_SENDER')) || SENDER_DEFAULT;
  let msgs = [];
  try { msgs = await readMany(`from:${sender} newer_than:${days}d`, { max: 60 }); }
  catch (e) { return { ok: false, error: 'gmail read failed: ' + String((e && e.message) || e) }; }

  const res = {
    ok: true, mode: dry ? 'dryrun' : 'live', window_days: days,
    scanned: msgs.length, notices: 0, parts: 0,
    flagged: 0, created: 0, already_returned: 0,
    unmatched_claim: 0, unparsed: 0, errors: 0,
    at_risk_cents: 0, samples: [],
  };
  const seenPo = new Set();

  for (const m of msgs) {
    const receivedMs = Date.parse(m.date || '') || Date.now();
    let n = null;
    try { n = parseAhsReturnNotice(m.subject || '', m.body || '', receivedMs); } catch (_) { n = null; }
    if (!n) { res.unparsed++; continue; }
    res.notices++;
    // The penalty AHS states is PER PO, not per part -- count it once per PO or a 3-part
    // notice triples the money at risk.
    if (n.penalty_cents && !seenPo.has(n.po)) { res.at_risk_cents += n.penalty_cents; seenPo.add(n.po); }

    const jobId = await resolveJob(db, n.claim, n.parts.map((p) => p.number));
    if (!jobId) {
      res.unmatched_claim++;
      if (res.samples.length < 10) res.samples.push({ outcome: 'no_job_for_claim', po: n.po, claim: n.claim, job_name: n.job_name, parts: n.parts.map((p) => p.number) });
      // NEVER DROP a money obligation because the join missed. Record it so the office can
      // link it by hand instead of it vanishing with the email.
      if (!dry) { try { await crud.logEvent('warranty_part_unmatched', { vendor: 'AHS', claim: n.claim, po: n.po, parts: n.parts, supplier: n.supplier, due: n.due_date, penalty_cents: n.penalty_cents, source: 'ahs_return_notice', at_ms: Date.now() }); } catch (_) {} }
      continue;
    }

    let existing = [];
    try { existing = await db.get(`job_part?job_id=eq.${jobId}&company_id=eq.${TN_COMPANY}&select=id,number,name,source,returned_at,must_return&limit=200`); } catch (_) { existing = []; }

    for (const p of n.parts) {
      res.parts++;
      const np = normP(p.number);
      const hit = (existing || []).find((r) => normP(r.number) === np) || null;

      if (hit && hit.returned_at) { res.already_returned++; continue; }        // office already closed it

      const stamp = {
        must_return: true,
        return_due_at: n.due_date || null,
        return_penalty_cents: n.penalty_cents,
        return_po: n.po,
      };
      if (n.rma) stamp.rma_number = n.rma;

      if (dry) {
        if (res.samples.length < 10) res.samples.push({ outcome: hit ? 'would_flag' : 'would_create', job_id: jobId, po: n.po, part: p.number, desc: p.description, due: n.due_date, penalty_cents: n.penalty_cents, core: n.core_only, supplier: n.supplier });
        hit ? res.flagged++ : res.created++;
        continue;
      }
      if (hit) {
        const patch = Object.assign({}, stamp);
        if (!hit.source && n.supplier) patch.source = n.supplier;              // fill the return destination if blank
        const ok = await db.patch('job_part', `id=eq.${hit.id}&company_id=eq.${TN_COMPANY}`, patch);
        ok ? res.flagged++ : res.errors++;
      } else {
        // The notice named a part that never made it onto the job. Create the row rather
        // than lose the obligation -- an untracked owed-back part is the whole exposure.
        const ok = await db.insert('job_part', Object.assign({
          company_id: TN_COMPANY, job_id: jobId,
          number: p.number,
          name: p.description || (n.core_only ? 'Core' : 'Warranty part'),
          source: n.supplier || null,
        }, stamp));
        ok ? res.created++ : res.errors++;
      }
    }
  }

  res.at_risk_dollars = Math.round(res.at_risk_cents) / 100;
  return res;
}

exports.config = { timeout: 26 };
exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  let scheduled = false; try { scheduled = !!JSON.parse(event.body || '{}').next_run; } catch (_) {}
  if (!scheduled && q.secret !== guard) return json(403, { ok: false, error: 'forbidden — ?secret=' });
  const res = await runAhsReturns({ dry: q.dryrun === '1', days: q.days });
  return json(200, res);
};
exports.runAhsReturns = runAhsReturns;
exports.parseAhsReturnNotice = parseAhsReturnNotice;
exports.parsePartsRun = parsePartsRun;
