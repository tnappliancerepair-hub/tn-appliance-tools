// dupe-auto-merge — kills the ~22/day duplicate jobs Danielle deletes by hand.
//
// Warranty UPDATE emails (SquareTrade/AHS) spawn a NEW bare job when the claim #
// doesn't parse, so the intake dedup is skipped. Rather than risk surgery on the
// live warranty-intake XS, this catches the dupe the moment it lands and auto-
// resolves it — exactly what Danielle does manually, but automatic and reversible.
//
// SAFE BY DESIGN — it only cancels a job that is ALL of:
//   • a FRESH arrival (created in the last fresh_hours), AND
//   • UNASSIGNED (no tech) and not started/en-route/in-progress, AND
//   • a duplicate of a MORE-COMPLETE job for the same customer+appliance (or same
//     claim #) — the keeper (one with a claim #, a tech, or a schedule) is kept.
// The dupe's claim # is copied to the keeper first if the keeper lacks it. Cancel
// = scheduling_status "canceled" (soft, reversible — same as Danielle's Delete).
//
//   GET ?secret=<admin>                 DRY RUN — show what it WOULD merge
//   GET ?secret=<admin>&confirm=1       act now (one-off test before enabling)
//   scheduled (every 15m)               acts only when DUPE_AUTO_MERGE_ENABLED=true,
//                                       else shadow-logs what it would do
'use strict';
const { getSecret } = require('./_lib/secrets');
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
function j(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
const p10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const ms = (x) => x ? new Date(x).getTime() : 0;
const TERMINAL = new Set(['canceled', 'cancelled', 'completed', 'no_fix_possible']);
function normAppl(s) {
  s = String(s || '').toLowerCase();
  if (/fridge|refriger/.test(s)) return 'refrigerator';
  if (/wash/.test(s)) return 'washer';
  if (/\bdry/.test(s)) return 'dryer';
  if (/dish/.test(s)) return 'dishwasher';
  if (/range|stove|oven|cooktop/.test(s)) return 'range';
  if (/microwav/.test(s)) return 'microwave';
  if (/freezer/.test(s)) return 'freezer';
  if (/ice/.test(s)) return 'icemaker';
  return s.replace(/[^a-z]/g, '').slice(0, 12);
}

// Resolve a table id by field shape (ids conflict across the repo).
async function resolveTables() {
  const cands = [6, 5, 7, 1, 2, 8, 9, 10, 14, 16, 3, 4];
  let customer = null, jobs = null;
  for (const id of cands) {
    if (customer && jobs) break;
    let row;
    try { const r = await fetch(`${META}/table/${id}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: 1, page: 1 }) }); if (!r.ok) continue; row = ((await r.json()).items || [])[0]; } catch (_) { continue; }
    if (!row) continue;
    const k = Object.keys(row);
    if (!customer && k.includes('first_name') && k.includes('last_name') && k.includes('phone') && !k.includes('conversation_id') && !k.includes('customer_id')) customer = id;
    if (!jobs && k.includes('customer_id') && (k.includes('scheduling_status') || k.includes('appliance_type'))) jobs = id;
  }
  return { customer, jobs };
}
async function listPage(tableId, perPage, page) {
  const r = await fetch(`${META}/table/${tableId}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: perPage, page: page || 1, sort: { id: 'desc' } }) });
  if (!r.ok) throw new Error(`list ${tableId} p${page} -> ${r.status}`);
  return ((await r.json()).items) || [];
}

const isTerminal = (jb) => TERMINAL.has(String(jb.scheduling_status || '').toLowerCase()) || TERMINAL.has(String(jb.current_status || '').toLowerCase());
// keeper score: a job with a claim #, a tech, or a schedule is "more real".
const score = (jb) => (String(jb.claim_number || '').trim() ? 4 : 0) + (Number(jb.technician_id || 0) > 0 ? 2 : 0) + (Number(jb.scheduled_start || 0) > 0 ? 1 : 0);
// a fresh dupe is only auto-cancelable if it's a bare, unworked stub.
function cancelable(jb, freshCut) {
  if (isTerminal(jb)) return false;
  if (ms(jb.created_at) < freshCut) return false;              // not fresh
  if (Number(jb.technician_id || 0) > 0) return false;          // assigned — leave it
  if (jb.job_started_at || jb.tech_en_route_at) return false;   // work started
  if (String(jb.current_status || '').toLowerCase() === 'in_progress') return false;
  return true;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  const envLive = (await getSecret('DUPE_AUTO_MERGE_ENABLED')) === 'true';
  const isCron = !q.secret; // Netlify scheduled invocation passes no query string
  if (!isCron && q.secret !== admin) return j(401, { ok: false, error: 'unauthorized' });
  // Live action: env flag on (scheduled) OR explicit secret+confirm (manual test).
  const live = q.dry === '1' ? false : (envLive || (q.secret === admin && q.confirm === '1'));

  const freshHours = Math.max(1, Math.min(72, parseInt(q.fresh_hours, 10) || 6));
  const freshCut = Date.now() - freshHours * 3600000;

  let T;
  try { T = await resolveTables(); } catch (e) { return j(200, { ok: false, error: String(e.message || e) }); }
  if (!T.jobs) return j(200, { ok: false, error: 'could not resolve jobs table' });

  // Customer phone map (so cross-customer dupes — same person, new customer row —
  // still match by phone, not just customer_id).
  const phoneOf = {};
  if (T.customer) { try { for (let pg = 1; pg <= 3; pg++) { const rows = await listPage(T.customer, 500, pg); for (const c of rows) phoneOf[c.id] = p10(c.phone); if (rows.length < 500) break; } } catch (_) {} }

  // Recent jobs.
  let jobs = [];
  try { for (let pg = 1; pg <= 3; pg++) { const rows = await listPage(T.jobs, 400, pg); jobs = jobs.concat(rows); if (rows.length < 400) break; } }
  catch (e) { return j(200, { ok: false, error: 'jobs: ' + String(e.message || e) }); }
  const live_jobs = jobs.filter((jb) => !isTerminal(jb));

  // Group by claim # and by (customer-key + appliance).
  const groups = {};
  const addTo = (key, jb) => { if (!key) return; (groups[key] = groups[key] || []).push(jb); };
  for (const jb of live_jobs) {
    const claim = String(jb.claim_number || '').trim();
    if (claim) addTo('claim:' + claim, jb);
    const cust = phoneOf[jb.customer_id] || ('cid' + (jb.customer_id || 0));
    if (cust && Number(jb.customer_id || 0) > 0) addTo('cust:' + cust + '|' + normAppl(jb.appliance_type || jb.appliance), jb);
  }

  // Debug: surface the raw duplicate groups (2+ live jobs sharing a key) so we
  // can see what's there before the safety filters trim it.
  if (q.debug === '1') {
    const dbg = [];
    for (const key of Object.keys(groups)) {
      const g = groups[key].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
      if (g.length < 2) continue;
      dbg.push({ key, n: g.length, jobs: g.map((jb) => ({ id: jb.id, claim: String(jb.claim_number || '').trim(), tech: Number(jb.technician_id || 0), appl: normAppl(jb.appliance_type || jb.appliance), age_h: Math.round((Date.now() - ms(jb.created_at)) / 3600000), status: jb.scheduling_status, started: !!(jb.job_started_at || jb.tech_en_route_at) })) });
    }
    return j(200, { ok: true, debug: true, live_jobs: live_jobs.length, customers_mapped: Object.keys(phoneOf).length, groups_2plus: dbg.length, groups: dbg.slice(0, 30) });
  }

  // Build merge actions (dedupe a job that appears in two groups).
  const planned = []; const handled = new Set();
  for (const key of Object.keys(groups)) {
    const g = groups[key].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
    if (g.length < 2) continue;
    if (!g.some((jb) => ms(jb.created_at) >= freshCut)) continue; // only act on fresh dupe situations
    const keeper = g.slice().sort((a, b) => (score(b) - score(a)) || (a.id - b.id))[0];
    for (const d of g) {
      if (d.id === keeper.id || handled.has(d.id)) continue;
      if (!cancelable(d, freshCut)) continue;
      handled.add(d.id);
      planned.push({
        dupe: d.id, keeper: keeper.id, by: key.split(':')[0],
        appliance: normAppl(d.appliance_type || d.appliance),
        dupe_claim: String(d.claim_number || '').trim(), keeper_has_claim: !!String(keeper.claim_number || '').trim(),
        keeper_obj: keeper,
      });
    }
  }

  const out = { ok: true, mode: live ? 'LIVE' : 'shadow', fresh_hours: freshHours, live_jobs: live_jobs.length, dupes_found: planned.length, plan: planned.map((p) => ({ cancel_dupe: p.dupe, keep: p.keeper, matched_by: p.by, appliance: p.appliance })) };
  if (!live) { out.note = isCron ? 'shadow — set DUPE_AUTO_MERGE_ENABLED=true to act' : 'DRY RUN — add &confirm=1 to act'; return j(200, out); }

  // Act: preserve claim to keeper if missing, then cancel the dupe.
  let merged = 0; const fails = [];
  for (const p of planned) {
    try {
      if (p.dupe_claim && !p.keeper_has_claim) {
        await fetch(`${META}/table/${T.jobs}/content/${p.keeper}`, { method: 'PUT', headers: authH(), body: JSON.stringify({ claim_number: p.dupe_claim }) }).catch(() => {});
      }
      const r = await fetch(`${XANO}/office_set_job_status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: p.dupe, scheduling_status: 'canceled', actor: 'auto_dedup' }) });
      if (r.ok) {
        merged++;
        await fetch(`${META}/table/3/content`, { method: 'POST', headers: authH(), body: JSON.stringify({ action: 'dupe_auto_merged', metadata: { dupe_job: p.dupe, keeper_job: p.keeper, matched_by: p.by, appliance: p.appliance, claim_preserved: !!(p.dupe_claim && !p.keeper_has_claim), at_ms: Date.now() } }) }).catch(() => {});
      } else fails.push({ dupe: p.dupe, status: r.status });
    } catch (e) { fails.push({ dupe: p.dupe, err: String(e.message || e) }); }
  }
  out.merged = merged; out.failed = fails.length; out.failed_list = fails.slice(0, 8);
  return j(200, out);
};
