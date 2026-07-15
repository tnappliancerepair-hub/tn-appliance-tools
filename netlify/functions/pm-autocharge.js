// pm-autocharge — auto-charge a property-management account's card on file when their job
// is COMPLETED + invoiced (Teddy 2026-07-15: "auto charge after completion"). Runs on a
// schedule: finds recently-completed jobs that belong to a card-on-file PM account, have an
// invoice total, and haven't been charged yet, then charges via pm-charge (auto up to the
// $400 pre-auth / NTE; over that it sends the PM the one-tap approval link). Idempotent per
// job (pm_payment / pm_autocharge marker).
//
// SAFETY: real money. DRY/SHADOW by default — it logs what it WOULD charge. It only charges
// for real when PM_AUTOCHARGE_LIVE=true (cron) or ?confirm=1 (manual). Flip the env when ready.
//
//   GET ?secret=<admin>            DRY - show what it would charge
//   GET ?secret=<admin>&confirm=1  LIVE (manual)
//   (cron, no secret)              LIVE only if PM_AUTOCHARGE_LIVE=true, else SHADOW-logs
'use strict';
const { listPmAccounts } = require('./_lib/pm-accounts');
const META = (process.env.XANO_METADATA_BASE || 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1').replace(/\/+$/, '');
const SITE = 'https://tnapplianceexchange.net';
exports.config = { timeout: 26 };
function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function authH() { const t = process.env.XANO_METADATA_TOKEN; if (!t) throw new Error('no metadata token'); return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }; }
const s = (v) => String(v == null ? '' : v).trim();
const low = (v) => s(v).toLowerCase();

async function listPage(tableId, perPage, page) {
  const r = await fetch(`${META}/table/${tableId}/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ per_page: perPage, page: page || 1, sort: { id: 'desc' } }) });
  if (!r.ok) throw new Error(`list ${tableId} p${page} -> ${r.status}`);
  return ((await r.json()).items) || [];
}
async function searchAction(action, perPage) {
  const r = await fetch(`${META}/table/3/content/search`, { method: 'POST', headers: authH(), body: JSON.stringify({ search: { action }, sort: { id: 'desc' }, per_page: perPage || 500 }) });
  if (!r.ok) return [];
  return ((await r.json()).items) || [];
}
async function logRow(action, metadata) { try { await fetch(`${META}/table/3/content`, { method: 'POST', headers: authH(), body: JSON.stringify({ action, metadata }) }); } catch (_) {} }

// Dollars-or-cents guard: the office worksheet stores amount_invoiced as a dollar amount.
function invoiceCents(job) {
  const raw = job.amount_invoiced != null ? job.amount_invoiced : job.invoice_total;
  const n = parseFloat(String(raw == null ? '' : raw).replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100); // dollars -> cents
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const admin = process.env.VAPI_ADMIN_SECRET || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret && q.secret !== admin) return json(401, { ok: false, error: 'unauthorized' });
  const isCron = !q.secret;
  const liveEnv = process.env.PM_AUTOCHARGE_LIVE === 'true';
  const live = q.confirm === '1' || (isCron && liveEnv);   // manual confirm, or cron only when env-enabled

  // 1) card-on-file PM accounts -> lookup maps (linked customer ids + company name).
  let accounts = [];
  try { accounts = (await listPmAccounts()).filter((a) => a.track !== 'net_terms' && a.stripe_customer_id); } catch (e) { return json(200, { ok: false, error: 'accounts: ' + e.message }); }
  const byCustomer = {}, byCompany = {}, byPmKey = {};
  for (const a of accounts) {
    byPmKey[a.pm_key] = a;
    (a.customer_ids || []).forEach((cid) => { byCustomer[String(cid)] = a; });
    if (a.company) byCompany[low(a.company)] = a;
  }
  if (!accounts.length) return json(200, { ok: true, mode: 'none', note: 'no card-on-file PM accounts yet', charged: 0, plan: [] });

  // 2) already-handled job ids (dedup).
  const done = new Set();
  for (const act of ['pm_payment', 'pm_autocharge', 'pm_charge_pending']) {
    (await searchAction(act, 600)).forEach((r) => { const j = s((r.metadata || {}).job_id); if (j) done.add(j); });
  }

  // 3) recently-completed jobs -> match to a PM account.
  let jobs = [];
  try { for (let p = 1; p <= 4; p++) { const rows = await listPage(7, 300, p); jobs = jobs.concat(rows); if (rows.length < 300) break; } }
  catch (e) { return json(200, { ok: false, error: 'jobs: ' + e.message }); }

  const CUTOFF = Date.now() - 7 * 86400000;
  const plan = []; let charged = 0, held = 0; const fails = [];
  for (const j of jobs) {
    const ss = low(j.scheduling_status), cs = low(j.current_status);
    if (ss !== 'completed' && cs !== 'completed') continue;
    const jid = s(j.id);
    if (!jid || done.has(jid)) continue;
    const compAt = Number(j.job_completed_at || j.updated_at || j.created_at || 0);
    if (compAt && compAt < CUTOFF) continue;   // only recent completions

    // match job -> PM account
    let acct = null, how = '';
    if (j.pm_key && byPmKey[s(j.pm_key)]) { acct = byPmKey[s(j.pm_key)]; how = 'job.pm_key'; }
    if (!acct) { const b = String(j.bill_to_customer_id || j.customer_id || ''); if (byCustomer[b]) { acct = byCustomer[b]; how = 'customer_id'; } }
    if (!acct) { const co = low(j.customer_last || j.warranty_company); if (co && byCompany[co]) { acct = byCompany[co]; how = 'company'; } }
    if (!acct) continue;

    const cents = invoiceCents(j);
    if (cents <= 0) { plan.push({ job: jid, pm: acct.pm_key, matched: how, skip: 'no_invoice_total' }); continue; }
    if (cents > 500000) { plan.push({ job: jid, pm: acct.pm_key, matched: how, skip: 'amount_over_5000_manual', cents }); continue; }

    const entry = { job: jid, pm: acct.pm_key, company: acct.company, matched: how, amount_cents: cents, over_preauth: cents > (parseInt(acct.threshold_cents, 10) || 40000) };
    if (!live) { plan.push(Object.assign({ action: 'WOULD_' + (entry.over_preauth ? 'REQUEST_APPROVAL' : 'CHARGE') }, entry)); continue; }

    // LIVE: charge (pm-charge decides auto vs approval-link based on the pre-auth).
    try {
      const cr = await fetch(`${SITE}/.netlify/functions/pm-charge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: admin, pm_key: acct.pm_key, amount_cents: cents, job_id: jid, description: 'Appliance repair — job #' + jid, actor: 'auto_on_completion' }) });
      const cd = await cr.json();
      await logRow('pm_autocharge', { job_id: jid, pm_key: acct.pm_key, amount_cents: cents, result: cd && cd.status, at_ms: Date.now() });
      if (cd && cd.status === 'charged') charged++;
      else if (cd && cd.status === 'awaiting_approval') held++;
      else fails.push({ job: jid, status: cd && cd.status, error: cd && cd.error });
      plan.push(Object.assign({ action: cd && cd.status }, entry));
    } catch (e) { fails.push({ job: jid, error: e.message }); }
  }

  return json(200, { ok: true, mode: live ? 'LIVE' : (isCron ? 'SHADOW' : 'DRY'), live_enabled: liveEnv, accounts: accounts.length, candidates: plan.length, charged, held_for_approval: held, failed: fails.length, plan: plan.slice(0, 60), fails });
};
