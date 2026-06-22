// frontdoor-queue — Danielle's Frontdoor/AHS portal helper. For every completed
// (or in-progress) AHS/HSA/Frontdoor job it composes the EXACT portal fields —
// dispatch ID, serviced/contact dates, a clean "Work Performed" narrative written
// from the TDR, a generated Invoice ID, part #, parts-to-return — so she opens
// contractor.frontdoorhome.com, pastes, and clicks Submit. Read-only: composes,
// never submits. Pairs with frontdoor-invoices.html (UI) + tdr-chase.js (the
// upstream nudge that fills the thin fields). Spec: docs/frontdoor-portal-workflows-2026-06-22.md
//
//   GET /frontdoor-queue?key=tn-frontdoor-2026&days=45  ->  { ok, count, jobs:[...] }

'use strict';

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const KEY = 'tn-frontdoor-2026';
const FD_VENDORS = ['ahs', 'hsa', 'frontdoor', 'americanhome', 'american home shield'];
const TAX_RATE = { TN: 0.0975, LA: 0.0945 };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

async function jfetch(url, opts, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 12000);
  try { const r = await fetch(url, Object.assign({ signal: ctl.signal }, opts || {})); return await r.json(); }
  catch (_) { return null; } finally { clearTimeout(t); }
}
function ctDate(ms) { if (!ms) return ''; try { return new Date(Number(ms)).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: 'numeric' }); } catch (_) { return ''; } }
function cap(s) { s = String(s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; }
function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

// Parts arrays may be a JSON string, an array of {part_number,name}, or plain strings.
function partsList(v) {
  let arr = v;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (_) { return arr ? [String(arr)] : []; } }
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => {
    if (!p) return '';
    if (typeof p === 'string') return p;
    const nm = clean(p.name); const pn = clean(p.part_number);
    return nm && pn ? `${nm} (${pn})` : (nm || pn);
  }).filter(Boolean);
}

// Compose the "Work Performed" prose AHS reviewers read — only from what the tech
// actually recorded. No invented dollars, no filler. Honest + professional.
function workPerformed(b) {
  const t = b.tdr || {};
  const appliance = clean([b.brand, b.appliance_type].filter(Boolean).join(' ')) || 'appliance';
  const diag = clean(t.diagnosis || b.problem_summary);
  const comp = clean(t.failed_component);
  const cause = clean(t.failure_cause);
  const repair = clean(t.repair_completed);
  const part = clean(t.verified_part_number);
  const used = partsList(t.parts_used);
  const out = [];
  out.push(`Diagnosed ${appliance}${diag ? ': ' + diag : '.'}`);
  if (comp) out.push(`Found ${comp} failed${cause ? ' — ' + cause : ''}.`);
  if (repair) out.push(cap(repair) + (/[.!?]$/.test(repair) ? '' : '.'));
  else if (comp) out.push(`Replaced ${comp}${part ? ' (part ' + part + ')' : ''}.`);
  if (used.length) out.push(`Parts used: ${used.join(', ')}.`);
  out.push('Tested operational on completion.');
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function stageOf(j) {
  const s = String(j.job_current_status || j.job_scheduling_status || '').toLowerCase();
  if (/complet|done|invoic|paid/.test(s)) return 'invoice';
  if (/await|part/.test(s)) return 'parts';
  return 'autho';
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters || {};
  if ((q.key || '') !== KEY) return { statusCode: 401, headers: CORS, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
  const days = Math.min(parseInt(q.days || '45', 10) || 45, 120);

  // 1) source list of warranty jobs with a TDR
  const list = await jfetch(`${XANO}/find_recent_completed_warranty_jobs?days_back=${days}&limit=250`, null, 15000);
  let matches = (list && Array.isArray(list.matches)) ? list.matches : [];
  matches = matches.filter((m) => FD_VENDORS.includes(String(m.warranty_company || '').toLowerCase()));
  if (matches.length === 0) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, count: 0, jobs: [] }) };

  const ids = matches.map((m) => m.job_id).filter(Boolean);
  const csv = ids.join(',');

  // 2) rich per-job bundle + 3) invoice status (both batched)
  const [bundleRes, subRes] = await Promise.all([
    jfetch(`${XANO}/get_warranty_card_bundle_for_jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_ids_csv: csv }) }, 15000),
    jfetch(`${XANO}/list_warranty_submissions_for_jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_ids_csv: csv }) }, 12000),
  ]);
  const bundles = {}; ((bundleRes && bundleRes.bundles) || []).forEach((b) => { bundles[b.job_id] = b; });
  const subs = {}; ((subRes && subRes.submissions) || []).forEach((s) => { subs[s.job_id] = s; });

  const jobs = matches.map((m) => {
    const b = bundles[m.job_id] || {};
    const t = b.tdr || {};
    const c = b.customer || {};
    const sub = subs[m.job_id] || null;
    const dispatch = clean(b.claim_number || b.dispatch_id || m.claim_number);
    const state = String(c.state || '').toUpperCase();
    const laborH = (t.labor_time_hours != null && t.labor_time_hours !== '') ? Number(t.labor_time_hours) : (m.tdr_labor_hours || 0);
    const repair = clean(t.repair_completed || m.tdr_repair_completed);
    const toReturn = partsList(t.parts_not_used);

    // what's missing to bill cleanly — the chase targets these
    const missing = [];
    if (!laborH) missing.push('labor hours');
    if (!repair) missing.push('repair notes');
    if (!dispatch) missing.push('dispatch #');

    const fd = {
      dispatch_id: dispatch,
      invoice_id: dispatch ? ('TN-' + dispatch) : ('TN-J' + m.job_id),
      contact_date: ctDate(b.job_created_at || m.job_created_at),
      serviced_date: ctDate(b.job_completed_at || t.created_at || m.tdr_created_at),
      complete_by: 'Contractor Complete',
      item: clean([b.brand, b.appliance_type].filter(Boolean).join(' ')) || clean(m.appliance_type),
      model_number: clean(b.model_number),
      serial_number: clean(b.serial_number),
      failed_component: clean(t.failed_component || m.tdr_failed_component),
      failure_reason: clean(t.failure_cause || m.tdr_failure_cause),
      part_number: clean(t.verified_part_number),
      part_description: clean(t.failed_component || m.tdr_failed_component),
      labor_hours: laborH || '',
      work_performed: workPerformed(b),
      tax_rate: TAX_RATE[state] || '',
      parts_to_return: toReturn,
      // ── SmartAutho (authorization estimate) fields ──
      diagnosis: clean(t.diagnosis || b.problem_summary || m.tdr_diagnosis),
      job_type: (clean(t.verified_part_number) || clean(t.failed_component || m.tdr_failed_component)) ? 'Replace Part' : 'Labor-Only',
      fix_action: repair || (clean(t.failed_component || m.tdr_failed_component) ? ('Replace ' + clean(t.failed_component || m.tdr_failed_component) + (clean(t.verified_part_number) ? ' (part ' + clean(t.verified_part_number) + ')' : '')) : ''),
      part_qty: '1',
    };

    return {
      job_id: m.job_id,
      stage: stageOf(m),
      warranty_company: m.warranty_company,
      customer_name: clean(((c.first_name || '') + ' ' + (c.last_name || '')).trim()) || '(no name)',
      address: [c.address, c.city, c.state, c.zip].filter(Boolean).join(', '),
      phone: clean(c.phone),
      tech_name: b.tech ? clean(((b.tech.first_name || '') + ' ' + (b.tech.last_name || '')).trim()) : '',
      status: m.job_current_status || m.job_scheduling_status || '',
      has_parts_to_return: fd.parts_to_return.length > 0,
      missing,
      invoiced: !!sub,
      invoice_status: sub ? (sub.status || 'submitted') : '',
      invoice_conf: sub ? (sub.confirmation_id || '') : '',
      fd,
    };
  });

  // sort: ready-to-bill (no missing fields, not yet invoiced) first
  jobs.sort((a, b) => {
    const ra = (a.missing.length === 0 && !a.invoiced) ? 0 : 1;
    const rb = (b.missing.length === 0 && !b.invoiced) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return b.job_id - a.job_id;
  });

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, count: jobs.length, jobs }) };
};
