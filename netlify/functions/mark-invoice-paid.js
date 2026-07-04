// mark-invoice-paid — the office marks a job's invoice PAID / UNPAID by hand.
//
// Danielle's model (Teddy 2026-07-04): SHE is the source of truth for "paid".
// Warranty jobs get paid by the vendor EFT (no customer_payment_received row),
// and some cash jobs are settled off-app — so there was no way to show them
// Paid. This writes a manual paid/unpaid marker that list-invoices honors (and
// which WINS over auto-detection, latest write per job). Reversible.
//
// Fired two ways, both = "Danielle verified it":
//   • dropping the card into the board's 💰 Paid folder  (method:'board')
//   • tapping ✓ Mark paid / ↩ Mark unpaid on invoices.html (method:'invoices')
//
//   POST { job_id, paid:true|false, by?, method? }  -> { ok, job_id, paid }
'use strict';

const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const EVENT_LOG = 3;
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) }; }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return j(200, { ok: true });
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'POST only' });
  const tok = process.env.XANO_METADATA_TOKEN;
  if (!tok) return j(200, { ok: false, error: 'no metadata token' });

  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (_) {}
  const job_id = parseInt(b.job_id, 10);
  if (!job_id) return j(400, { ok: false, error: 'job_id required' });
  const paid = b.paid !== false && b.paid !== 'false' && b.paid !== 0; // default true
  const by = String(b.by || 'Danielle').slice(0, 40);
  const method = String(b.method || 'office').slice(0, 24);

  try {
    const r = await fetch(`${META}/table/${EVENT_LOG}/content`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: paid ? 'invoice_marked_paid' : 'invoice_marked_unpaid',
        metadata: { job_id, paid, by, method, at_ms: Date.now() },
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return j(200, { ok: false, error: 'write failed ' + r.status });
    return j(200, { ok: true, job_id, paid });
  } catch (e) { return j(200, { ok: false, error: String((e && e.message) || e) }); }
};
