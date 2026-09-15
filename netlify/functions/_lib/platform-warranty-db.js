// platform-warranty-db — the ONE place a warranty dispatch lands/updates a job on a
// shop's Supabase board, so the email intake (platform-email-intake) and the Frontdoor
// webhook (platform-frontdoor-webhook) never drift. Company-scoped in code (service key
// bypasses RLS); every write stamps company_id from the resolved company row.
//
// `db` is a platform-rest client (get / insert / patch). `co` is the company row
// {id, name, trade, settings}. `n` is one normalized job (from a parser, or from the
// ServicePower API via servicepower-auto-accept). `n.source` optionally overrides the
// job's source column (default 'warranty_email').
'use strict';

const { inboundNote, INBOUND_STATUS } = require('./frontdoor-parse');

// Statuses we're willing to MOVE a card to from an inbound vendor event. Only 'canceled'
// is a confirmed platform job.status value (new/scheduled/in_progress/awaiting_parts/
// completed/canceled) — 'held' has no platform column, so a hold lands as a note only,
// never an invalid enum write.
const PLATFORM_MOVE = { canceled: 'canceled' };

// FILL-THE-BLANK enrichment on a dedup. A dispatch that dedupes still carries real data,
// and throwing it away is how a card stays blind: the NSA rows already on this board came
// in through Xano's generic capture, which never parsed NSA, so several have NO appliance
// and NO model while the dispatch email states both.
//
// Only ever fills something that is EMPTY (or the 'Appliance' placeholder). Never
// overwrites a value a human or a better source already put there.
//
// ⚠️ SCOPED TO WHAT ACTUALLY SURVIVES, on purpose. platform-tn-mirror rewrites job.problem
// from Xano every 5 minutes and its keepTyped guard only stops an EMPTY Xano value from
// replacing a non-empty one -- Xano's value here is non-empty (it is the email subject
// echoed), so a problem we wrote would be gone before the office finished scrolling. So
// problem is deliberately NOT enriched. dispatch_id and service_window are not mirrored at
// all, and unit.label/attributes ARE keepTyped-guarded, so those four stick.
//
// Never throws: a dedup must still return even if enrichment fails.
// opts.dry reports what WOULD fill without writing. Deliberately a flag on this function
// rather than a second implementation in the caller: a separate dry-run would drift from
// the real fill rules, and then the preview stops predicting the write.
async function enrichBlanks(db, companyId, job, n, opts) {
  const dry = !!(opts && opts.dry);
  const filled = [];
  // Some callers hand us a minimal inline rest() client. No patch = no enrichment,
  // never a crash on the dedup path. A dry run needs no patch method at all.
  if (!db || (!dry && typeof db.patch !== 'function')) return filled;
  try {
    const blank = (v) => !String(v == null ? '' : v).trim();
    const jobPatch = {};
    if (blank(job.dispatch_id) && n.dispatch_id) jobPatch.dispatch_id = n.dispatch_id;
    if (blank(job.service_window) && n.service_window) jobPatch.service_window = n.service_window;
    if (Object.keys(jobPatch).length) {
      if (!dry) await db.patch('job', `id=eq.${job.id}`, jobPatch);
      filled.push(...Object.keys(jobPatch));
    }

    if (!job.unit_id) return filled;
    const rows = await db.get(`unit?id=eq.${job.unit_id}&select=id,label,attributes&limit=1`);
    const u = rows && rows[0];
    if (!u) return filled;

    // attributes is ONE jsonb column and a PATCH replaces it whole, so this is a
    // read-modify-write of the entire object -- a partial write is how the next run
    // blanks a serial.
    const attrs = Object.assign({}, u.attributes || {});
    const want = { brand: n.brand, model: n.model, serial: n.serial, appliance_type: n.appliance };
    const unitPatch = {};
    let attrsChanged = false;
    for (const k of Object.keys(want)) {
      if (blank(attrs[k]) && String(want[k] || '').trim()) { attrs[k] = String(want[k]).trim(); attrsChanged = true; filled.push('unit.' + k); }
    }
    if (attrsChanged) unitPatch.attributes = attrs;

    // 'Appliance' is the mirror's own placeholder for "we don't know what this is", so it
    // counts as blank here exactly like keepTyped treats it.
    const label = String(u.label || '').trim();
    if ((!label || /^(appliance|vehicle)$/i.test(label))) {
      const better = [n.brand, n.appliance].filter(Boolean).join(' ').trim();
      if (better) { unitPatch.label = better; filled.push('unit.label'); }
    }
    if (Object.keys(unitPatch).length && !dry) await db.patch('unit', `id=eq.${u.id}`, unitPatch);
  } catch (e) {
    return filled.concat(['error:' + String((e && e.message) || e).slice(0, 60)]);
  }
  return filled;
}

// create ONE warranty job on a shop's board (warranty fields + unit attrs). Deduped by
// claim # (or dispatch #) within the shop, so a re-sent dispatch never double-creates.
// Uses only db.get + db.insert (client-agnostic across platform-rest + the inline rest()).
async function createWarrantyJob(db, co, n) {
  const companyId = co.id;
  const appl = n.appliance || '';
  const kind = co.trade === 'automotive' ? 'vehicle' : (appl || 'appliance');
  // DEDUP — check BOTH keys, each against its OWN column.
  //
  // This used to check one column ("claim if present, else dispatch"), which silently
  // twinned any dispatch whose existing copy was filed under the other number. That is
  // not hypothetical: the NSA rows already on the board are split across every
  // combination (claim=Case#/dispatch=Dispatch#, claim only, dispatch only, neither),
  // because the legacy Xano capture never parsed NSA at all. A vendor that issues TWO
  // numbers per job needs both looked up or the second arrival is a new card.
  //
  // Deliberately SAME-COLUMN only (claim vs claim, dispatch vs dispatch), never
  // cross-matched: these namespaces are vendor-specific, and wrongly collapsing two real
  // jobs loses work, while a twin only costs a card. Short-circuits on the first hit, so
  // the common case is still one indexed lookup.
  for (const [col, val] of [['claim_number', n.claim_number], ['dispatch_id', n.dispatch_id]]) {
    const key = String(val || '').trim();
    if (!key) continue;
    const dup = await db.get(`job?company_id=eq.${companyId}&${col}=eq.${encodeURIComponent(key)}&select=id,unit_id,dispatch_id,service_window&limit=1`);
    if (dup && dup[0]) {
      const filled = await enrichBlanks(db, companyId, dup[0], n);
      return { job_id: dup[0].id, deduped: true, matched_on: col, filled };
    }
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
    // source: the email tee's jobs stay 'warranty_email'; the ServicePower API intake
    // passes 'servicepower_api' so the two paths stay measurable against each other.
    source: n.source || 'warranty_email', warranty_company: n.warranty_company || null,
    claim_number: n.claim_number || null, dispatch_id: n.dispatch_id || null,
    service_window: n.service_window || null,
  });
  try {
    await db.insert('thread_message', {
      company_id: companyId, customer_id: customer.id, job_id: job.id, direction: 'in', channel: 'email', sender: 'warranty', kind: 'note',
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
      direction: 'in', channel: 'email', sender: 'warranty', kind: 'note', body: note,
    });
  } catch (_) {}
  return { operation: s.operation, dispatch_id: s.dispatch_id, job_id: jobId, matched: true, mode: 'applied', moved_to: target || null };
}

module.exports = { createWarrantyJob, resolveJob, applyDispatchUpdate, enrichBlanks };
