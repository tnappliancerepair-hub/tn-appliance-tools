// backfill-part-numbers — one-time recovery. Historic part numbers that techs
// entered landed in the wrong field (the parts_needed LIST column, or folded into
// failed_component), so the office board — which reads verified_part_number — showed
// "no part #". This sweeps every TDR, pulls a real part-number token out of those
// fields, and copies it into verified_part_number so the board finally shows it.
// Owner-gated. DRY-RUN by default; add &confirm=1 to write. &limit=N caps a run.
//   GET ?secret=<admin>[&confirm=1][&limit=N]
'use strict';
const md = require('./_lib/xano/metadata-crud');
const { getSecret } = require('./_lib/secrets');
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const TDR_TABLE = 12;
exports.config = { timeout: 60 };

function json(c, o) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o, null, 2) }; }
function hdr() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('XANO_METADATA_TOKEN not set'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }

// A real part-number token: letters + at least 3 digits, length >= 5, dashes ok.
// (Rejects plain words + weak tokens like "3-prong"; accepts W10740624, DA97-08573A.)
function partToken(s) {
  const cands = String(s || '').match(/[A-Z0-9][A-Z0-9-]{4,}/gi) || [];
  for (const raw of cands) {
    const t = raw.replace(/^-+|-+$/g, '').toUpperCase();
    if (t.length >= 5 && /[A-Z]/.test(t) && (t.match(/\d/g) || []).length >= 3) return t;
  }
  return '';
}
function fromParts(v) { // parts_needed is a list (array) column, sometimes a string
  if (Array.isArray(v)) { for (const x of v) { const s = String(x || '').trim(); if (s) return s; } return ''; }
  return String(v || '').trim();
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'unauthorized — ?secret=' });
  const live = q.confirm === '1';
  const cap = Math.min(parseInt(q.limit, 10) || 100000, 100000);

  // Pull every TDR (sort+page with no search filter returns all rows, paginated).
  const all = []; const PER = 250;
  try {
    for (let p = 1; p <= 200; p++) {
      const r = await fetch(`${META}/table/${TDR_TABLE}/content/search`, { method: 'POST', headers: hdr(), body: JSON.stringify({ sort: { id: 'desc' }, per_page: PER, page: p }) });
      if (!r.ok) break;
      const j = await r.json().catch(() => ({}));
      const items = j.items || [];
      all.push(...items);
      if (items.length < PER) break;
    }
  } catch (e) { return json(200, { ok: false, error: 'read_failed: ' + String((e && e.message) || e) }); }

  // Find TDRs with no verified_part_number but a recoverable one elsewhere.
  const recover = [];
  for (const t of all) {
    if (String(t.verified_part_number || '').trim()) continue;
    let part = partToken(fromParts(t.parts_needed)); let from = 'parts_needed';
    if (!part) { const tok = partToken(t.failed_component); if (tok) { part = tok; from = 'failed_component'; } }
    if (part) recover.push({ tdr_id: t.id, job_id: t.job_id, part, from });
  }
  const picked = recover.slice(0, cap);

  let wrote = 0, failed = 0;
  if (live) {
    for (const rec of picked) {
      try {
        const rows = await md.search(TDR_TABLE, { id: rec.tdr_id });
        const row = Array.isArray(rows) ? (rows.find((r) => Number(r.id) === rec.tdr_id) || rows[0]) : null;
        if (!row) { failed++; continue; }
        const merged = Object.assign({}, row, { verified_part_number: rec.part });
        delete merged.id; delete merged.created_at;
        await md.update(TDR_TABLE, rec.tdr_id, merged);
        wrote++;
      } catch (_) { failed++; }
    }
  }

  return json(200, {
    ok: true,
    mode: live ? 'LIVE — wrote to verified_part_number' : 'DRY RUN (add &confirm=1 to write)',
    tdrs_scanned: all.length,
    recoverable: recover.length,
    wrote, failed,
    sample: recover.slice(0, 30),
  });
};
