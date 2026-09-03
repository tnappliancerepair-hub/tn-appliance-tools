// frontdoor-parse — the Frontdoor/AHS webhook PAYLOAD parser, shared by the legacy
// (Xano) receiver and the new multi-tenant platform receiver so both read a dispatch
// event identically. Pure functions, no I/O — ported verbatim from the field mapping in
// frontdoor-webhook.js (the legacy single-tenant receiver, which keeps its own inline
// copy while it retires). Full shapes: docs/frontdoor-integration-spec-2026-07-09.md.
'use strict';

const { areaForVendor } = require('./frontdoor');

// external_organization_id -> the warranty_company label we store on a job.
const TENANT_LABEL = { AHS: 'AHS', HSA: 'HSA', FTDR: 'Frontdoor', '2-10': '2-10' };

// A SMALL whitelist of inbound status codes that auto-move the card. We deliberately do
// NOT reverse-map the whole catalog (many codes, e.g. EN_ROUTE/COMPLETE, are things WE
// report TO them; echoing one back must never flip our card). Cancel/hold are the safe
// auto-moves; auth denials/approvals get a loud note instead.
const INBOUND_STATUS = {
  40: 'canceled',   // Job Cancelled
  230: 'canceled',  // Appointment Cancelled
  150: 'held',      // On Hold
};
// Structured authorization outcome (a real flag the rest of the system reads), keyed by FD code.
const AUTHO_CODES = { 350: 'approved', 360: 'denied', 370: 'approved_limited' };
// Codes worth a highlighted note even though they don't move the card.
const NOTE_PREFIX = {
  350: '✅ AUTH APPROVED', 360: '⚠️ AUTH DENIED', 370: '✅ AUTH APPROVED (with limitations)',
  120: '⚠️ Customer missed appointment', 130: '⚠️ Possible denial', 140: '⚠️ Incomplete',
  270: '🔄 Reschedule appointment set', 60: '⚠️ Unable to contact customer',
};

// Normalize one Frontdoor event into a compact summary + a stable dedup key.
function summarize(ev) {
  const op = String((ev && ev.operation) || '').toLowerCase();
  const tenant = (ev && ev.external_organization_id) || '';
  const d = (ev && ev.dispatch) || {};
  const dispatchId = d.external_id != null ? String(d.external_id) : '';
  const out = { operation: op || 'unknown', tenant, dispatch_id: dispatchId };
  if (op === 'schedule') {
    const cust = (d.customers && d.customers[0]) || {};
    const addr = cust.address || {};
    const item = (d.items && d.items[0]) || {};
    const vendorId = (ev.vendor && ev.vendor.external_id != null) ? String(ev.vendor.external_id) : '';
    const areaMeta = areaForVendor(vendorId);
    out.vendor_id = vendorId;
    out.area = (areaMeta && areaMeta.area) || '';
    out.cluster = (areaMeta && areaMeta.cluster) || '';
    out.lead_tech_id = (areaMeta && areaMeta.lead_tech_id) || 0;
    out.customer = cust.name || '';
    out.email = cust.email || '';
    out.phone = (cust.phone && cust.phone[0] && cust.phone[0].number) || '';
    out.address = [addr.streetNumber, addr.streetName, (addr.unitType ? (addr.unitType + ' ' + (addr.unitNumber || '')).trim() : (addr.unitNumber || ''))].filter(Boolean).join(' ').trim();
    out.city = addr.city || ''; out.state = addr.state || ''; out.zip = addr.zip || '';
    out.appliance = item.description || '';
    out.brand = (item.attributes && item.attributes.Brand) || '';
    out.model = (item.attributes && (item.attributes.Model || item.attributes.ModelNumber)) || '';
    out.serial = (item.attributes && (item.attributes.Serial || item.attributes.SerialNumber)) || '';
    out.symptom = (Array.isArray(item.symptoms) && item.symptoms.join('; ')) || '';
    out.priority = d.priority || ''; out.autho_required = !!d.isAuthoRequired;
    out.dispatch_type = d.dispatchType || ''; out.trade = d.trade || '';
    out.date = d.date || '';
    out.contract_id = (d.contract && d.contract.external_id != null) ? String(d.contract.external_id) : '';
    out.dedup = 'schedule:' + dispatchId + ':' + (d.date || '');
  } else if (op === 'status') {
    const s = ev.status || {};
    out.status_code = s.code; out.status = s.description || '';
    out.updated_at = s.updated_at || '';
    out.dedup = 'status:' + dispatchId + ':' + (s.code != null ? s.code : '') + ':' + (s.updated_at || '');
  } else if (op === 'notes') {
    const n = ev.note || {};
    out.note = n.text || ''; out.note_by = n.created_by || ''; out.note_at = n.created_at || '';
    out.dedup = 'notes:' + dispatchId + ':' + (n.created_at || '');
  } else if (op === 'ncc') {
    const n = ev.ncc || {};
    out.ncc_status = n.status || '';
    out.dedup = 'ncc:' + dispatchId + ':' + (n.status || '');
  } else {
    out.dedup = op + ':' + dispatchId;
  }
  return out;
}

// Compose the office-note / thread-message text for an inbound event.
function inboundNote(s) {
  if (s.operation === 'notes') return '📥 AHS note: ' + String(s.note || '').slice(0, 400);
  if (s.operation === 'ncc') return '⚠️ AHS NCC (no-charge callback): ' + (s.ncc_status || '') + ' — finish on the original claim, do not close out.';
  const code = (s.status_code != null) ? Number(s.status_code) : null;
  const pre = (code != null && NOTE_PREFIX[code]) ? NOTE_PREFIX[code] + ' — ' : '';
  return '📥 AHS status: ' + pre + (s.status || '') + (code != null ? ' (code ' + code + ')' : '');
}

// Map a summarized SCHEDULE event -> the `n` shape createWarrantyJob(db, co, n) expects.
// Frontdoor keys on the DispatchNumber (no separate claim #), and sends "FIRST LAST".
function scheduleToJob(s) {
  const name = String(s.customer || '').trim();
  const sp = name.indexOf(' ');
  return {
    first: sp > 0 ? name.slice(0, sp) : name,
    last: sp > 0 ? name.slice(sp + 1) : '',
    phone: s.phone || '', email: s.email || '',
    address: s.address || '', city: s.city || '', state: s.state || '', zip: s.zip || '',
    appliance: s.appliance || '', brand: s.brand || '', model: s.model || '', serial: s.serial || '',
    problem: s.symptom || '',
    warranty_company: TENANT_LABEL[s.tenant] || (s.tenant || ''),
    claim_number: null, dispatch_id: s.dispatch_id || '',
    service_window: s.date || '',
  };
}

module.exports = { TENANT_LABEL, INBOUND_STATUS, AUTHO_CODES, NOTE_PREFIX, summarize, inboundNote, scheduleToJob };
