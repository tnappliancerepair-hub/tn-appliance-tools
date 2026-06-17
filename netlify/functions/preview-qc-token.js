// preview-qc-token — owner-only. Mints a short-lived signed QC token for an
// EXISTING tdr (via generate-qc-token, which holds the internal-auth secret) so
// the Teddy Tool can open the exact customer-facing TDR page to REVIEW it —
// without sending any SMS or marking the TDR as sent. Preview tokens expire fast.
//
//   POST { secret, job_id, tdr_id }  ->  { ok, url }
'use strict';

const SITE = 'https://tnapplianceexchange.net';
const SECRET = 'tn-qc-preview-2026';
const PREVIEW_EXPIRY_SECONDS = 1800; // 30 min

function j(code, body) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return j(400, { ok: false, error: 'invalid_json' }); }
  if (b.secret !== SECRET) return j(401, { ok: false, error: 'unauthorized' });
  const jobId = Number(b.job_id), tdrId = Number(b.tdr_id);
  if (!jobId || !tdrId) return j(400, { ok: false, error: 'job_id and tdr_id required' });

  const internalAuth = process.env.HCP_INTERNAL_AUTH_SECRET;
  if (!internalAuth) return j(500, { ok: false, error: 'preview not configured (HCP_INTERNAL_AUTH_SECRET)' });

  try {
    const r = await fetch(`${SITE}/.netlify/functions/generate-qc-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-auth': internalAuth },
      body: JSON.stringify({ job_id: jobId, tdr_id: tdrId, expiry_seconds: PREVIEW_EXPIRY_SECONDS }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.token) return j(502, { ok: false, error: 'token_mint_failed', detail: (d && d.error) || r.status });
    return j(200, { ok: true, url: `${SITE}/cash-tdr-customer.html?token=${encodeURIComponent(d.token)}`, expires_at: d.expires_at });
  } catch (e) {
    return j(200, { ok: false, error: String((e && e.message) || e) });
  }
};
