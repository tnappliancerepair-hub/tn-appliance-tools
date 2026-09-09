// platform-rma-tee — phase-2 of parts-return tracking: auto-match SquareTrade/Allstate
// RMA return-labels to the platform returns worklist. SquareTrade emails a prepaid return
// label per part to send back (from rma_request@squaretrade.com); if a part isn't returned,
// the shop eats a chargeback. This reads those emails from TN's Gmail, parses each part
// (RMA #, FedEx tracking #, distributor, part #, claim #), matches it to a platform job by
// claim, and stamps the RMA #/tracking/carrier onto that job's return row — creating the
// return row if the tech hasn't logged it yet, so an owed-back part can never slip.
//
// Idempotent: matching is by (job, normalized part #); a re-run updates the same row and
// never duplicates. Reads Gmail read-only (legacy pollers untouched); writes only into TN's
// platform tenant with the service key.
//
//   GET ?secret=<admin>[&dryrun=1]   (dryrun lists what WOULD land, writes nothing)
//   Kill switch: vault PLATFORM_RMA_TEE_ENABLED=false
'use strict';

const { getSecret, getSecretFresh } = require('./_lib/secrets');
const { readMany } = require('./_lib/gmail-accounts');

const TN_COMPANY = 'be4d11a1-5219-469b-916a-ab990be7ea7f';   // TN Appliance Exchange LLC (keeper)
const GUARD_FALLBACK = 'tn-vapi-admin-9f83b1c4e7a206d5';
const SENDER_DEFAULT = 'rma_request@squaretrade.com';
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function normP(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

// ── RMA email parser (ported from squaretrade-rma-watch.js parseReturns) ──
// Returns one record per part. Handles single- AND multi-part emails; RMA/tracking can be
// shared across the email (one shipment) or per-part — paired by order, fallback to first.
function parseReturns(subject, body) {
  const pick = (re, s) => { const m = (s || '').match(re); return m ? m[1].trim() : ''; };
  const all = (re, s) => { const out = []; let m; const r = new RegExp(re.source, 'gi'); while ((m = r.exec(s || ''))) out.push(m[1].trim()); return out; };

  const claim = pick(/Claim #\[?claim_([0-9]+)\]?/i, subject) || pick(/Claim Number:\s*([0-9]+)/i, body);
  const customer = pick(/Customer Name:\s*([^\n\r]+)/i, body);
  let rmas = all(/RMA\s*#?\s*is\s*([A-Za-z0-9\-]+)/i, body);
  if (!rmas.length) { const sr = pick(/RMA Number #\[?([A-Za-z0-9\-]+)\]?/i, subject); if (sr) rmas = [sr]; }
  const trackings = all(/tracking\s*#?\s*is\s*([0-9]{8,})/i, body);

  const blocks = [];
  const bre = /Distributor:\s*([A-Za-z0-9 .,&\/\-]+?)\s*Part Number:\s*([A-Za-z0-9.\/\-]+)(?:[\s\S]{0,160}?Return Description:\s*([^\n\r]+))?/gi;
  let bm;
  while ((bm = bre.exec(body))) blocks.push({ distributor: bm[1].trim(), part: bm[2].trim(), return_desc: (bm[3] || '').trim() });
  if (!blocks.length) return [];
  return blocks.map((b, i) => ({ ...b, rma: rmas[i] || rmas[0] || '', tracking: trackings[i] || trackings[0] || '', claim, customer }));
}

// ── Platform Supabase (service key) ──
function pf(base, key) {
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async get(path) { const r = await fetch(`${base}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(10000) }); return r.ok ? r.json() : []; },
    async insert(table, row) { const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: AbortSignal.timeout(10000) }); return r.ok; },
    async patch(table, filter, patch) { const r = await fetch(`${base}/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(patch), signal: AbortSignal.timeout(10000) }); return r.ok; },
  };
}
async function resolveJobByClaim(db, claim) {
  const c = String(claim || '').trim(); if (!c) return null;
  const rows = await db.get(`job?company_id=eq.${TN_COMPANY}&claim_number=eq.${encodeURIComponent(c)}&select=id&limit=1`);
  return (rows && rows[0] && rows[0].id) || null;
}

async function runRma(dry) {
  const enabled = String((await getSecretFresh('PLATFORM_RMA_TEE_ENABLED')) || 'true').toLowerCase() !== 'false';
  if (!dry && !enabled) return { ok: true, disabled: true, note: 'PLATFORM_RMA_TEE_ENABLED=false' };

  const base = ((await getSecret('PLATFORM_SUPABASE_URL')) || '').replace(/\/+$/, '');
  const key = (await getSecret('PLATFORM_SUPABASE_SERVICE_KEY')) || '';
  if (!base || !key) return { ok: false, error: 'platform_not_configured' };
  const db = pf(base, key);

  const sender = (await getSecretFresh('PLATFORM_RMA_TEE_SENDER')) || SENDER_DEFAULT;
  const hrs = parseInt((await getSecretFresh('PLATFORM_RMA_TEE_WINDOW_HOURS')) || '48', 10) || 48;
  const after = Math.floor((Date.now() - hrs * 3600 * 1000) / 1000);
  const query = `from:${sender} after:${after}`;

  let msgs = [];
  try { msgs = await readMany(query, { max: 40 }); } catch (e) { return { ok: false, error: 'gmail read failed: ' + String((e && e.message) || e) }; }

  const res = { ok: true, mode: dry ? 'dryrun' : 'live', scanned: msgs.length, parts: 0, created: 0, updated: 0, unmatched_claim: 0, no_part: 0, samples: [] };

  for (const m of msgs) {
    let recs = [];
    try { recs = parseReturns(m.subject || '', m.body || ''); } catch (_) { recs = []; }
    for (const rec of recs) {
      res.parts++;
      const part = String(rec.part || '').trim();
      if (!part) { res.no_part++; continue; }               // need a part # to key the return row on
      const carrier = rec.tracking ? 'FedEx' : '';           // SquareTrade prepaid labels ship FedEx
      const jobId = await resolveJobByClaim(db, rec.claim);
      if (!jobId) { res.unmatched_claim++; if (res.samples.length < 8) res.samples.push({ outcome: 'no_job_for_claim', claim: rec.claim, part, rma: rec.rma }); continue; }

      // find an existing part row on this job whose # matches (case/format-insensitive)
      const npart = normP(part);
      let hit = null;
      try {
        const existing = await db.get(`job_part?job_id=eq.${jobId}&company_id=eq.${TN_COMPANY}&select=id,number,disposition,source,rma_number&limit=200`);
        hit = (existing || []).find((r) => normP(r.number) === npart) || null;
      } catch (_) {}

      const stamp = { disposition: 'return', rma_number: rec.rma || null, return_tracking: rec.tracking || null, return_carrier: carrier || null };
      if (dry) {
        if (res.samples.length < 8) res.samples.push({ outcome: hit ? 'would_update' : 'would_create', job_id: jobId, part, rma: rec.rma, tracking: rec.tracking, distributor: rec.distributor });
        hit ? res.updated++ : res.created++;
        continue;
      }
      if (hit) {
        const patch = Object.assign({}, stamp);
        if (!hit.source && rec.distributor) patch.source = rec.distributor;   // fill the distributor if blank
        const ok = await db.patch('job_part', `id=eq.${hit.id}&company_id=eq.${TN_COMPANY}`, patch);
        if (ok) res.updated++; else res.errors = (res.errors || 0) + 1;
      } else {
        const ok = await db.insert('job_part', Object.assign({
          company_id: TN_COMPANY, job_id: jobId, number: part, name: rec.return_desc || 'Warranty return', source: rec.distributor || null,
        }, stamp));
        if (ok) res.created++; else res.errors = (res.errors || 0) + 1;
      }
    }
  }
  return res;
}

exports.config = { timeout: 26 };
exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const guard = (await getSecret('VAPI_ADMIN_SECRET')) || GUARD_FALLBACK;
  if (q.secret !== guard) return json(403, { ok: false, error: 'forbidden' });
  const res = await runRma(q.dryrun === '1');
  return json(200, res);
};
exports.runRma = runRma;
