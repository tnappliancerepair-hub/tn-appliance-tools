// frontdoor-webhook — OUTBOUND receiver for the Frontdoor / AHS Status API
// (Frontdoor -> Ant). Frontdoor POSTs dispatch lifecycle events to THIS endpoint:
// new dispatches (Schedule), status changes (Status), notes, and non-covered-cost
// (ncc). No Developer Portal access is needed for outbound — Frontdoor only needs a
// secure webhook URL + an agreed auth method. Full spec: docs/frontdoor-integration-
// spec-2026-07-09.md.
//
// This is the auto-intake path that replaces parsing AHS dispatch emails: a Schedule
// event carries the ENTIRE job (customer, phone, address, appliance, brand, symptom,
// autho-required, priority) in real time.
//
//   POST (Authorization: Bearer <token>)  body = [ { external_organization_id,
//         operation, dispatch:{external_id,...}, ... } ]   ->  200 { ok, mode, results }
//
// SAFETY — ships DARK. It authenticates, parses, dedups, and LOGS every event, but
// does NOT create/mutate live jobs until vault FRONTDOOR_WEBHOOK_LIVE = '1'. Until then
// each event is recorded to event_log (action 'frontdoor_webhook_event') so we can
// validate real payloads in sandbox before flipping intake on. Frontdoor also has no
// URL for us yet, so nothing can hit this until we hand it over + agree the token.
'use strict';

const { getSecret } = require('./_lib/secrets');
const { areaForVendor } = require('./_lib/frontdoor');

const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const EVENT_LOG_TABLE = 3;

function j(c, b) { return { statusCode: c, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
async function xanoPost(path, payload, ms) {
  const r = await fetch(XANO + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}), signal: AbortSignal.timeout(ms || 15000),
  });
  return r.json().catch(() => ({}));
}
// AHS/HSA/FTDR/2-10 tenant code -> the warranty_company label we store on a job.
const TENANT_LABEL = { AHS: 'AHS', HSA: 'HSA', FTDR: 'Frontdoor', '2-10': '2-10' };
function metaHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : null;
}
async function logEvent(action, metadata) {
  const h = metaHeaders(); if (!h) return false;
  try {
    const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
      method: 'POST', headers: h, body: JSON.stringify({ action, metadata }),
    });
    return r.ok;
  } catch (_) { return false; }
}

// Pull the bearer token off the Authorization header (case-insensitive).
function bearerOf(event) {
  const hs = event.headers || {};
  const raw = hs.authorization || hs.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return m ? m[1].trim() : '';
}

// Normalize one event into a compact, human-readable summary for the log + a stable
// dedup key. Faithful to the Schedule/Status/notes/ncc shapes in the spec doc.
function summarize(ev) {
  const op = String(ev.operation || '').toLowerCase();
  const tenant = ev.external_organization_id || '';
  const d = ev.dispatch || {};
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
    out.symptom = (Array.isArray(item.symptoms) && item.symptoms.join('; ')) || '';
    out.priority = d.priority || ''; out.autho_required = !!d.isAuthoRequired;
    out.dispatch_type = d.dispatchType || ''; out.trade = d.trade || '';
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

// Map a summarized Schedule event -> create_job_from_email input. The name splits on
// the first space (Frontdoor sends "FIRST LAST"). dry_run is driven by the LIVE flag so
// a dark webhook validates the whole path without inserting anything.
function buildIntake(s, live) {
  const name = String(s.customer || '').trim();
  const sp = name.indexOf(' ');
  const first = sp > 0 ? name.slice(0, sp) : name;
  const last = sp > 0 ? name.slice(sp + 1) : '';
  return {
    // Frontdoor dispatches are the AHS/warranty family — use the existing 'email_ahs'
    // intake bucket (a dedicated 'frontdoor_webhook' source can be added to the enum
    // later via XS for cleaner attribution). The real tenant stays in warranty_company.
    intake_source: 'email_ahs',
    received_at_ms: Date.now(),
    customer_first_name: first,
    customer_last_name: last,
    customer_phone: s.phone || '',
    customer_email: s.email || '',
    service_address: s.address || '',
    service_city: s.city || '',
    service_state: s.state || '',
    service_zip: s.zip || '',
    appliance_type: s.appliance || '',
    brand: s.brand || '',
    problem_summary: s.symptom || '',
    warranty_company: TENANT_LABEL[s.tenant] || (s.tenant || ''),
    dispatch_number: s.dispatch_id || '',
    dry_run: !live,
  };
}

exports.config = { timeout: 26 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return j(405, { ok: false, error: 'Method Not Allowed' });

  const live = (await getSecret('FRONTDOOR_WEBHOOK_LIVE')) === '1';
  const expected = (await getSecret('FRONTDOOR_WEBHOOK_TOKEN')) || '';

  // Auth (Bearer). When a token is configured we ALWAYS enforce it (401 on mismatch,
  // per the spec). When no token is set we only accept in dark mode — so we can never
  // process live intake unauthenticated.
  const provided = bearerOf(event);
  if (expected) {
    if (provided !== expected) {
      await logEvent('frontdoor_webhook_rejected', { reason: 'bad_bearer', at_ms: Date.now() });
      return j(401, { ok: false, error: 'unauthorized' });
    }
  } else if (live) {
    return j(401, { ok: false, error: 'webhook token not configured' });
  }

  let body; try { body = JSON.parse(event.body || 'null'); } catch (_) {
    return j(400, { ok: false, error: 'invalid JSON' });
  }
  // Frontdoor sends an array; tolerate a single object too.
  const events = Array.isArray(body) ? body : (body && typeof body === 'object' ? [body] : null);
  if (!events || !events.length) return j(400, { ok: false, error: 'expected a non-empty array of events' });

  const results = [];
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') { results.push({ ok: false, error: 'bad event' }); continue; }
    const s = summarize(ev);
    // Record every event either way — this is our sandbox-validation trail + the audit
    // record once live. Retry-safe: duplicates are harmless as log rows; the future
    // job-create/status-sync handlers dedup on s.dedup before mutating anything.
    await logEvent('frontdoor_webhook_event', { ...s, live, at_ms: Date.now() });

    try {
      if (s.operation === 'schedule') {
        // Auto-intake: create (or dedup to) the Ant job. In dark mode this runs with
        // dry_run:true so we validate the full mapping against real payloads without
        // inserting. create_job_from_email dedups on claim/phone+city, so retries +
        // duplicate deliveries are safe. Region is already resolved (s.area) for
        // downstream auto-routing to the right cluster.
        const intake = buildIntake(s, live);
        const r = await xanoPost('/create_job_from_email', intake);
        const jobId = r && (r.job_id || r.id || (r.job && r.job.id)) || null;
        await logEvent('frontdoor_dispatch_scheduled', { dispatch_id: s.dispatch_id, vendor_id: s.vendor_id, area: s.area, tenant: s.tenant, job_id: jobId, dry_run: !live, at_ms: Date.now() });
        results.push({ operation: 'schedule', dispatch_id: s.dispatch_id, area: s.area, job_id: jobId, mode: live ? 'created' : 'dry_run' });
      } else if (s.operation === 'status' || s.operation === 'notes' || s.operation === 'ncc') {
        // Frontdoor-initiated status / note / NCC. Recorded against the dispatch so it's
        // captured + auditable now; the direct job update rides on a find-by-dispatch
        // lookup (thin XS endpoint, next step) to attach it to the matching Ant job.
        await logEvent('frontdoor_dispatch_' + s.operation, { ...s, at_ms: Date.now() });
        results.push({ operation: s.operation, dispatch_id: s.dispatch_id, mode: 'recorded' });
      } else {
        results.push({ operation: s.operation, dispatch_id: s.dispatch_id, mode: 'unknown_op' });
      }
    } catch (e) {
      await logEvent('frontdoor_webhook_error', { dispatch_id: s.dispatch_id, operation: s.operation, error: String((e && e.message) || e).slice(0, 200), at_ms: Date.now() });
      results.push({ operation: s.operation, dispatch_id: s.dispatch_id, mode: 'error', error: String((e && e.message) || e).slice(0, 120) });
    }
  }

  return j(200, { ok: true, mode: live ? 'live' : 'dark', received: events.length, results });
};
