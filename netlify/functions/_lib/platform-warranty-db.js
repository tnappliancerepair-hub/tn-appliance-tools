// platform-warranty-db — the ONE place a warranty dispatch lands/updates a job on a
// shop's Supabase board, so the email intake (platform-email-intake) and the Frontdoor
// webhook (platform-frontdoor-webhook) never drift. Company-scoped in code (service key
// bypasses RLS); every write stamps company_id from the resolved company row.
//
// `db` is a platform-rest client (get / insert / patch). `co` is the company row
// {id, name, trade, settings}. `n` is one normalized job (from a parser).
'use strict';

const { inboundNote, INBOUND_STATUS } = require('./frontdoor-parse');

// Statuses we're willing to MOVE a card to from an inbound vendor event. Only 'canceled'
// is a confirmed platform job.status value (new/scheduled/in_progress/awaiting_parts/
// completed/canceled) — 'held' has no platform column, so a hold lands as a note only,
// never an invalid enum write.
const PLATFORM_MOVE = { canceled: 'canceled' };

// create ONE warranty job on a shop's board (warranty fields + unit attrs). Deduped by
// claim # (or dispatch #) within the shop, so a re-sent dispatch never double-creates.
// Uses only db.get + db.insert (client-agnostic across platform-rest + the inline rest()).
async function createWarrantyJob(db, co, n) {
  const companyId = co.id;
  const appl = n.appliance || '';
  const kind = co.trade === 'automotive' ? 'vehicle' : (appl || 'appliance');
  const dedupKey = n.claim_number || n.dispatch_id || '';
  if (dedupKey) {
    const col = n.claim_number ? 'claim_number' : 'dispatch_id';
    const dup = await db.get(`job?company_id=eq.${companyId}&${col}=eq.${encodeURIComponent(dedupKey)}&select=id&limit=1`);
    if (dup && dup[0]) return { job_id: dup[0].id, deduped: true };
  }
  let customer = null;
  if (n.phone) { const f = await db.get(`customer?company_id=eq.${companyId}&phone=eq.${encodeURIComponent(n.phone)}&select=id&limit=1`); customer = f && f[0]; }
  if (!customer && (n.last || n.first)) {
    const f = await db.get(`customer?company_id=eq.${companyId}&first_name=eq.${encodeURIComponent(n.first || '')}&last_name=eq.${encodeURIComponent(n.last || '')}&select=id&limit=1`);
    customer = f && f[0];
  }
  if (!customer) {
    customer = await db.insert('customer', {
      company_id: companyId, first_name: n.first || null, last_name: n.last || null,
      phone: n.phone || null, email: n.email || null, address: n.address || null,
      city: n.city || null, state: n.state || null, zip: n.zip || null,
    });
  }
  const label = [n.brand, appl].filter(Boolean).map((x) => x).join(' ').trim() || (kind === 'vehicle' ? 'Vehicle' : 'Appliance');
  const unit = await db.insert('unit', {
    company_id: companyId, customer_id: customer.id, kind, label,
    attributes: { brand: n.brand || '', model: n.model || '', serial: n.serial || '', appliance_type: appl },
  });
  const job = await db.insert('job', {
    company_id: companyId, customer_id: customer.id, unit_id: unit.id, status: 'new',
    problem: n.problem || (appl ? appl + ' issue' : 'Warranty dispatch'),
    source: 'warranty_email', warranty_company: n.warranty_company || null,
    claim_number: n.claim_number || null, dispatch_id: n.dispatch_id || null,
    service_window: n.service_window || null,
  });
  try {
    await db.insert('thread_message', {
      company_id: companyId, customer_id: customer.id, job_id: job.id, direction: 'in', channel: 'email', sender: 'warranty',
      body: `📥 ${n.warranty_company || 'Warranty'} dispatch${n.claim_number ? ' #' + n.claim_number : ''}: ${label}${n.problem ? ' — ' + n.problem : ''}${n.service_window ? ' · ' + n.service_window : ''}`,
    });
  } catch (_) {}
  try { await db.insert('portal_grant', { company_id: companyId, customer_id: customer.id, job_id: job.id }); } catch (_) {}
  return { job_id: job.id, customer_id: customer.id, deduped: false };
}

// Resolve the shop's job for an inbound status/notes/ncc event by dispatch # (then claim #).
async function resolveJob(db, companyId, s) {
  const key = s.dispatch_id || '';
  if (!key) return null;
  let f = await db.get(`job?company_id=eq.${companyId}&dispatch_id=eq.${encodeURIComponent(key)}&select=id,customer_id,status&limit=1`);
  if (f && f[0]) return f[0];
  f = await db.get(`job?company_id=eq.${companyId}&claim_number=eq.${encodeURIComponent(key)}&select=id,customer_id,status&limit=1`);
  return (f && f[0]) || null;
}

// Apply a status/notes/ncc event to the shop's matching job. Read-only preview when
// live=false (resolve + return the would-be note/move, no writes); writes the thread note
// + optional card move only when live.
async function applyDispatchUpdate(db, co, s, live) {
  const companyId = co.id;
  const jobRow = await resolveJob(db, companyId, s);
  if (!jobRow) {
    return { operation: s.operation, dispatch_id: s.dispatch_id, matched: false, mode: live ? 'unmatched' : 'dry_unmatched' };
  }
  const jobId = jobRow.id;
  const note = inboundNote(s);
  const code = (s.operation === 'status' && s.status_code != null) ? Number(s.status_code) : null;
  const mapped = (code != null) ? INBOUND_STATUS[code] : null;      // 'canceled' | 'held' | undefined
  const target = mapped ? PLATFORM_MOVE[mapped] : null;             // only 'canceled' actually moves the card
  if (!live) {
    return { operation: s.operation, dispatch_id: s.dispatch_id, job_id: jobId, matched: true, mode: 'dry_run', would_status: target || null, would_note: note };
  }
  if (target && jobRow.status !== target) {
    try { await db.patch('job', `id=eq.${jobId}`, { status: target }); } catch (_) {}
  }
  try {
    await db.insert('thread_message', {
      company_id: companyId, customer_id: jobRow.customer_id, job_id: jobId,
      direction: 'in', channel: 'email', sender: 'warranty', body: note,
    });
  } catch (_) {}
  return { operation: s.operation, dispatch_id: s.dispatch_id, job_id: jobId, matched: true, mode: 'applied', moved_to: target || null };
}

module.exports = { createWarrantyJob, resolveJob, applyDispatchUpdate };
