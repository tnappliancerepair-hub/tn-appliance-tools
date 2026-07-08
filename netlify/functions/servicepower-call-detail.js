// servicepower-call-detail — READ-ONLY probe that pulls everything ServicePower knows
// about ONE dispatch (call): getCallInfo + getCallAttributes + getCallNotes +
// getProductCoverage. Purpose: find where the PARTS-on-record live in the API so we can
// make them the AUTHORITATIVE source for the TDR return list (vs parsing email).
//
// Owner-gated. Safe — never writes.
//   GET ?secret=<VAPI_ADMIN_SECRET>&call=<callNumber>[&job_id=][&raw=1]
//     -> { ok, call_number, fss_call_id, mfg_id, parts, sources:{info,attributes,notes,coverage} }
//   raw=1 also returns the raw SOAP bodies so we can see the exact tags.
'use strict';

const crud = require('./_lib/xano/metadata-crud');
const sp = require('./_lib/servicepower');
const { getSecret } = require('./_lib/secrets');

exports.config = { timeout: 26 };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
function j(c, b) { return { statusCode: c, headers: CORS, body: JSON.stringify(b, null, 2) }; }

function spCallNumber(job) {
  const claim = String((job && job.claim_number) || '').trim();
  if (claim) return claim;
  const ni = String((job && job.notes_internal) || '');
  const m = ni.match(/SERVICEPOWER DISPATCH\s+([0-9]{6,})/i);
  return m ? m[1] : '';
}

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
async function verifyOffice(password) {
  if (!password) return false;
  try {
    const r = await fetch(`${XANO}/verify_office_password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(8000) });
    const d = await r.json().catch(() => ({})); return !!(d && (d.valid || d.success || d.ok));
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  // Accept GET (?…) or POST ({…}) so the one-tap office button can call it.
  const q = { ...(event.queryStringParameters || {}) };
  if (event.httpMethod === 'POST') { try { Object.assign(q, JSON.parse(event.body || '{}')); } catch (_) {} }
  // Auth: admin secret OR office password (so the office button works without a secret in the page).
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const authed = String(q.secret || '') === admin || (await verifyOffice(q.password));
  if (!authed) return j(401, { ok: false, error: 'bad secret / office password' });
  if (!(await sp.isConfigured())) return j(200, { ok: false, error: 'ServicePower creds not in vault' });

  let callNumber = String(q.call || q.call_number || '').replace(/\D/g, '');
  // allow resolving the call number from a job_id
  if (!callNumber && q.job_id) {
    try { const job = await crud.searchOne(crud.TABLES.jobs, { id: Number(q.job_id) }) || {}; callNumber = spCallNumber(job); } catch (_) {}
  }
  if (!callNumber) return j(400, { ok: false, error: 'pass call=<callNumber> or job_id=<id> with a ServicePower dispatch' });

  // Resolve FSSCallId + MfgId from the dispatch board (some detail ops need them).
  let fssCallId = String(q.fss || '');
  let mfgId = String(q.mfg || '');
  if (!fssCallId || !mfgId) {
    const DAY = 86400000, now = Date.now();
    const f = (ms) => { const d = new Date(ms); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()} 00:00:00`; };
    for (let off = -1; off < 30; off += 2) {
      try {
        const look = await sp.getCallInfo({ fromDateTime: f(now - (off + 2) * DAY), toDateTime: f(now - off * DAY), callNo: callNumber });
        const c = (look.calls || []).find((x) => x.call_number === callNumber) || (look.calls || [])[0];
        if (c) { fssCallId = fssCallId || c.fss_call_id || ''; mfgId = mfgId || c.mfg_id || ''; break; }
      } catch (_) {}
    }
  }
  if (!mfgId) mfgId = 'I565';
  const args = { callNumber, fssCallId, mfgId };

  // Pull all four read ops in parallel.
  const [info, attrs, notes, cov] = await Promise.all([
    sp.getCallInfo({ callNo: callNumber, fromDateTime: '', toDateTime: '' }).catch((e) => ({ error: String(e && e.message || e) })),
    sp.getCallAttributes(args).catch((e) => ({ error: String(e && e.message || e) })),
    sp.getCallNotes(args).catch((e) => ({ error: String(e && e.message || e) })),
    sp.getProductCoverage(args).catch((e) => ({ error: String(e && e.message || e) })),
  ]);

  // Best-effort parts extraction from each source's raw body.
  const parts = []; const seen = new Set();
  for (const src of [attrs, notes, info]) {
    for (const p of sp.parseParts((src && src.raw) || '')) {
      const k = (p.part || '') + '|' + (p.description || '');
      if (!seen.has(k) && (p.part || p.description)) { seen.add(k); parts.push(p); }
    }
  }

  const wantRaw = q.raw === '1' || q.raw === true;
  const pack = (r) => ({ ok: !!(r && r.ok), error: r && r.error, ack: r && r.ack, err_code: r && r.err_code, err_desc: r && r.err_desc, raw: wantRaw ? (r && r.raw || '').slice(0, 12000) : undefined });

  // Log the result (incl. raw bodies) so Claude can read what ServicePower returned
  // WITHOUT the office needing to copy/paste anything back.
  try {
    await crud.logEvent('servicepower_call_detail_probe', {
      call_number: callNumber, job_id: Number(q.job_id || 0) || null, parts_found: parts.length, parts,
      raw_attributes: ((attrs && attrs.raw) || '').slice(0, 8000),
      raw_notes: ((notes && notes.raw) || '').slice(0, 8000),
      raw_info: ((info && info.raw) || '').slice(0, 6000),
      at_ms: Date.now(),
    });
  } catch (_) {}

  return j(200, {
    ok: true,
    call_number: callNumber, fss_call_id: fssCallId, mfg_id: mfgId,
    parts_found: parts.length,
    parts,
    note: parts.length ? 'Parts extracted heuristically — confirm against the raw, then I wire this as the authoritative source.' : 'No parts matched the generic patterns. Pass &raw=1 and share the output so I can see the exact tags.',
    sources: { info: pack(info), attributes: pack(attrs), notes: pack(notes), coverage: pack(cov) },
  });
};
