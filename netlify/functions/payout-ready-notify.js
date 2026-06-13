// Notify-on-EFT: when warranty payments land (SquareTrade et al. pay a batch of
// jobs), this texts Teddy a per-tech breakdown of what's now ready to release,
// linking to Money → Payroll where the "Release paid" buttons live (one-tap
// approve — you stay in control of every dollar out).
//
// Scheduled (see netlify.toml). Reuses payroll-rollup (60-day window to catch
// jobs from prior periods that a remittance just covered) + the warranty
// submissions status. Dedupes on the exact ready-set signature so it only
// pings when something NEW becomes payable — no spam.

'use strict';

const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://tnapplianceexchange.net';
const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
const META = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:meta/workspace/1';
const EVENT_LOG_TABLE = 3;
const OWNER = '+16154855795';
const FROM = '+16158578800'; // tech-direction Telnyx number

const TECH_NAME = { 1: 'Teddy', 2: 'Jimmy', 3: 'Andre', 4: 'Lee', 5: 'Billy', 6: 'John' };

function metaHeaders() {
  const t = process.env.XANO_METADATA_TOKEN;
  return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
}
function meta(row) { let m = row && row.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }

// CT hour gate so we don't text at 3am.
function ctHour() {
  const s = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false });
  return parseInt(s, 10);
}

async function lastSignature() {
  try {
    const r = await fetch(`${META}/table/${EVENT_LOG_TABLE}/content/search`, {
      method: 'POST', headers: metaHeaders(),
      body: JSON.stringify({ search: { action: 'payout_ready_notified' }, sort: { created_at: 'desc' }, per_page: 1, page: 1 }),
    });
    if (!r.ok) return '';
    const d = await r.json();
    const row = (d && d.items || [])[0];
    return row ? (meta(row).signature || '') : '';
  } catch (_) { return ''; }
}
const { sendSms: sendSmsXano } = require('./_lib/sms');
async function sendSms(text) { return sendSmsXano(OWNER, text, 'owner', 'payout_ready_notify'); }

// Schedule is declared in netlify.toml ([functions."payout-ready-notify"]).
exports.handler = async function () {
  if (ctHour() < 8 || ctHour() > 18) return { statusCode: 200, body: 'outside hours' };
  try {
    const end = Date.now();
    const start = end - 60 * 86400000;
    const pr = await (await fetch(`${SITE}/.netlify/functions/payroll-rollup?start_ms=${start}&end_ms=${end}`, { cache: 'no-store' })).json();
    const techs = (pr && pr.techs) || [];

    // Unreleased, real-pay job lines, indexed by job_id.
    const unreleased = {};
    for (const t of techs) {
      for (const j of (t.jobs || [])) {
        if (j.released || j.addon || j.tip || !(j.pay > 0)) continue;
        unreleased[String(j.job_id)] = { tech_id: t.technician_id, pay: j.pay };
      }
    }
    const ids = Object.keys(unreleased);
    if (!ids.length) return { statusCode: 200, body: 'nothing unreleased' };

    // Which of those are warranty-PAID (the EFT landed)?
    const wr = await (await fetch(`${XANO}/list_warranty_submissions_for_jobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_ids_csv: ids.join(',') }),
    })).json();
    const paidSet = new Set();
    for (const s of (wr && wr.submissions || [])) {
      if (String(s.status || '').toLowerCase() === 'paid') paidSet.add(String(s.job_id));
    }
    const readyIds = ids.filter((id) => paidSet.has(id)).sort();
    if (!readyIds.length) return { statusCode: 200, body: 'nothing warranty-paid yet' };

    // Dedup on the exact ready set.
    const signature = readyIds.join(',');
    if (signature === (await lastSignature())) return { statusCode: 200, body: 'already notified this set' };

    // Group by tech for the SMS.
    const byTech = {};
    let total = 0;
    for (const id of readyIds) {
      const u = unreleased[id]; byTech[u.tech_id] = (byTech[u.tech_id] || 0) + u.pay; total += u.pay;
    }
    const lines = Object.keys(byTech).map((tid) => `${TECH_NAME[tid] || ('tech ' + tid)} $${byTech[tid].toFixed(0)}`).join(', ');
    const text = `[ant] 💰 warranty paid — $${total.toFixed(0)} ready to release to techs (${readyIds.length} jobs): ${lines}. Approve in Money → Payroll: ${SITE}/money.html`;

    const sent = await sendSms(text);
    await fetch(`${META}/table/${EVENT_LOG_TABLE}/content`, {
      method: 'POST', headers: metaHeaders(),
      body: JSON.stringify({ action: 'payout_ready_notified', metadata: { signature, total: total.toFixed(2), jobs: readyIds.length, sent, at_ms: Date.now() } }),
    });
    return { statusCode: 200, body: JSON.stringify({ notified: sent, total, jobs: readyIds.length }) };
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ error: err.message }) };
  }
};
