// address-notify — Teddy's "multiple addresses" idea (2026-07-17). When a customer
// has TWO different addresses on file (the job's dispatch/service address ≠ our
// canonical customer record — the exact Jayaswy Kota case where AHS dispatched the
// stale one), we don't guess. We text the customer, state the address we're about to
// send the tech to, and ask them to confirm it — because they're the only one who
// KNOWS which house. A wrong address "throws the guys for a loop" and burns a truck
// roll; one text kills it.
//
// SAFE, low-volume by design:
//  • conflict-only — fires ONLY when the house number OR zip genuinely differ (not
//    on formatting like "Dr." vs "Drive"), so near-zero false positives.
//  • ONE text per job, claimed before send (at-most-once).
//  • guardedSend enforces opt-out / quiet-hours / caps.
//  • tag carries 'intake' so the address-confirm passes the intake-only SMS gate.
//  • kill switch ADDRESS_CONFIRM_LIVE=false.
//
// On reply (handled in customer-sms-inbound): YES → address_confirmed; anything else
// (a corrected address) → address_correction_reported, which raises a RED flag on the
// board for Danielle to apply with one tap (Teddy chose flag-for-Danielle, not auto).
'use strict';

const guard = require('./sms-guard');
const crud = require('./xano/metadata-crud');

const LIVE = String(process.env.ADDRESS_CONFIRM_LIVE || 'true').toLowerCase() !== 'false';

function metaOf(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

// First run of digits in a street = house number. "1042 Kelsey Glen Dr." -> "1042".
function houseNum(s) { const m = String(s || '').match(/\d+/); return m ? m[0] : ''; }
function zip5(s) { const m = String(s || '').replace(/\D/g, '').match(/^\d{5}/); return m ? m[0] : String(s || '').replace(/\D/g, '').slice(0, 5); }
function hasStreet(s) { const t = String(s || '').trim(); return /[a-zA-Z]/.test(t) && /\d/.test(t) && t.replace(/\s/g, '').length >= 4 && houseNum(t) !== '1'; }

// True only when the two addresses are GENUINELY different places — different house
// number or different zip. Deliberately conservative: we'd rather miss a rare edge
// than text someone over "St" vs "Street". Both sides must be real addresses.
function addressConflict(svc, cust) {
  const sA = svc.address, sZ = zip5(svc.zip), cA = cust.address, cZ = zip5(cust.zip);
  if (!hasStreet(sA) || !hasStreet(cA)) return false;   // need two real streets to have a conflict
  const hnDiff = houseNum(sA) && houseNum(cA) && houseNum(sA) !== houseNum(cA);
  const zipDiff = sZ && cZ && sZ !== cZ;
  return !!(hnDiff || zipDiff);
}

function confirmMessage(name, appliance, svcAddr, svcCity) {
  const who = String(name || '').trim() || 'there';
  const what = String(appliance || 'appliance').toLowerCase();
  const where = [String(svcAddr || '').trim(), String(svcCity || '').trim()].filter(Boolean).join(', ');
  return `Hi ${who}, it's TN Appliance Exchange \u{1F41C}. We have more than one address on file for you, and we want to send your tech to the right place for your ${what} repair. Is this the correct service address: ${where}? Reply YES to confirm, or just reply with the correct address. Thanks!`;
}

async function hasJobMarker(action, jobId) {
  try {
    const rows = await crud.searchPage(crud.TABLES.event_log, { action }, { id: 'desc' }, 2000);
    return rows.some((r) => String(metaOf(r).job_id || '') === String(jobId));
  } catch (_) { return false; }
}

// Read a job + its customer, decide if there's a two-address conflict, and (if live)
// send the one confirm text. Returns a verbose result for the sweep/dry-run to report.
async function checkAndConfirm({ job_id, dry }) {
  if (!job_id) return { job_id, ok: false, reason: 'no_job' };

  let job;
  try { job = await crud.searchOne(crud.TABLES.jobs, { id: Number(job_id) }); } catch (_) {}
  if (!job) return { job_id, ok: false, reason: 'job_not_found' };

  const custId = Number(job.customer_id || 0);
  let cust = {};
  if (custId) { try { cust = (await crud.searchOne(crud.TABLES.customer, { id: custId })) || {}; } catch (_) {} }

  const svc = { address: job.service_address, city: job.service_city, state: job.service_state, zip: job.service_zip };
  const canon = { address: cust.address, city: cust.city, state: cust.state, zip: cust.zip };

  if (!addressConflict(svc, canon)) return { job_id, ok: false, reason: 'no_conflict', svc, canon };
  if (await hasJobMarker('address_confirm_sent', job_id)) return { job_id, ok: false, reason: 'already_sent', flagged: true };

  const phone = cust.phone || '';
  const name = String(cust.first_name || '').trim() || String(cust.name || '').trim().split(/\s+/)[0] || 'there';
  const appliance = job.appliance_type || job.appliance || 'appliance';
  const msg = confirmMessage(name, appliance, svc.address, svc.city);

  if (dry) return { job_id, ok: false, reason: 'dry_run', would_send: !!phone, phone: phone ? guard.toE164(phone) : '', message: msg, svc, canon };
  if (!phone) return { job_id, ok: false, reason: 'no_phone', svc, canon };
  if (!LIVE) { try { await crud.logEvent('address_confirm_paused', { job_id, at_ms: Date.now() }); } catch (_) {} return { job_id, ok: false, reason: 'paused' }; }

  // Claim BEFORE sending so a second sweep/trigger can't double-send. This row is ALSO
  // the board's "pending" flag until the reply resolves it.
  try {
    await crud.logEvent('address_confirm_sent', {
      job_id, at_ms: Date.now(), claimed: true,
      service_address: svc.address || '', service_city: svc.city || '', service_state: svc.state || '', service_zip: svc.zip || '',
      canon_address: canon.address || '', canon_city: canon.city || '', canon_zip: canon.zip || '',
      customer_id: custId,
    });
  } catch (_) {}

  const res = await guard.guardedSend({ phone, message: msg, tag: 'intake_address_confirm', kind: 'intake' });
  try { await crud.logEvent('address_confirm_notified', { job_id, phone: guard.toE164(phone), reason: res.reason, at_ms: Date.now() }); } catch (_) {}
  return { job_id, ok: res.sent, reason: res.reason, flagged: true };
}

module.exports = { checkAndConfirm, addressConflict, confirmMessage, houseNum, zip5, hasStreet, LIVE };
