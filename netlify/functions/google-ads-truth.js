// google-ads-truth — what the ad money ACTUALLY bought, measured on our own records
// instead of Google's.
//
// WHY THIS EXISTS. Google reports "8 conversions, $105 each" for the After-Hours
// campaign. Every one of those is `Calls from ads` — a phone that rang. The actions we
// built to measure real outcomes (`Ant — Booked Job`, `Ant — Cash Paid`) all read ZERO,
// because nothing has ever fed them: 0 ad-click records in 30 days, 0 conversions
// uploaded. So the account can tell you a phone rang and nothing else, and $845/month
// has been unfalsifiable either way.
//
// The dedicated ads line (615-845-8500) is what makes the truth knowable — every call to
// it is a paid lead by construction. google-line-texml now writes a `google_ads_call`
// row for each one (caller + timestamp). This joins those calls to the jobs that came
// out of them and reports the only number that decides whether to scale: cost per job.
//
// READ-ONLY. Touches no campaign, uploads nothing, sends nothing.
//   GET ?secret=<admin>[&days=30]
'use strict';

const { getSecret } = require('./_lib/secrets');
const crud = require('./_lib/xano/metadata-crud');
const ads = require('./_lib/google-ads');

const XANO = 'https://xbtp-g9bh-ditq.n7e.xano.io/api:3e_TffpA';
// A caller is credited to the ad if a job appears for them within this window. Appliance
// repair books same-day or next-day; past a week the call is no longer plausibly the cause.
const ATTRIB_WINDOW_MS = 7 * 86400000;

function json(c, b) { return { statusCode: c, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b, null, 2) }; }
function meta(r) { let m = r && r.metadata; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { m = {}; } } return m || {}; }
// Phones are stored in mixed formats across both stores (+1615…, 615-…, 6155551234), so
// every comparison normalises to the last ten digits. Matching raw strings silently misses.
function last10(v) { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }

async function rows(action, days, n) {
  try {
    const r = await fetch(`${XANO}/list_recent_event_log?action=${encodeURIComponent(action)}&days_back=${days}&limit=${n || 500}`, { signal: AbortSignal.timeout(20000) });
    const d = await r.json();
    return (d && (d.items || d)) || [];
  } catch (_) { return []; }
}

// Spend for the window, straight from the account.
async function spend(days) {
  try {
    const c = await ads.creds();
    if (!c.clientId || !c.refresh || !c.devToken) return { configured: false };
    const token = await ads.accessToken(c);
    const cid = (await getSecret('GOOGLE_ADS_CONV_CID')) || '9267688121';
    const range = days <= 7 ? 'LAST_7_DAYS' : days <= 14 ? 'LAST_14_DAYS' : 'LAST_30_DAYS';
    const gaql = `SELECT metrics.cost_micros, metrics.clicks FROM campaign WHERE segments.date DURING ${range} AND campaign.status = 'ENABLED'`;
    const url = `https://googleads.googleapis.com/${c.version}/customers/${cid}/googleAds:search`;
    const run = (login) => fetch(url, { method: 'POST', headers: ads.apiHeaders(token, c, login), body: JSON.stringify({ query: gaql }) });
    let r = await run(cid);
    if (!r.ok && r.status === 403 && c.managerId) r = await run(c.managerId);
    const d = await r.json().catch(() => ({}));
    let cost = 0, clicks = 0;
    for (const x of (d.results || [])) { cost += Number(x.metrics?.costMicros || 0) / 1e6; clicks += Number(x.metrics?.clicks || 0); }
    return { configured: true, range, cost: Math.round(cost * 100) / 100, clicks };
  } catch (e) { return { configured: true, error: String((e && e.message) || e).slice(0, 120) }; }
}

exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const admin = (await getSecret('VAPI_ADMIN_SECRET')) || 'tn-vapi-admin-9f83b1c4e7a206d5';
  if (q.secret !== admin) return json(401, { ok: false, error: 'admin secret required (?secret=)' });
  const days = Math.max(1, Math.min(90, parseInt(q.days || '30', 10) || 30));

  const [calls, money] = await Promise.all([rows('google_ads_call', days, 800), spend(days)]);

  // One caller can ring twice (leg 1 then a leg-2 outcome row, or a genuine callback).
  // Collapse to the PERSON, keeping their first ring and best-known outcome - paying twice
  // for one human is a click-level question, not a lead-level one.
  const byCaller = {};
  for (const r of calls) {
    const m = meta(r);
    const ph = last10(m.from);
    if (ph.length !== 10) continue;
    const at = Number(m.at_ms) || Number(r.created_at) || 0;
    const c = byCaller[ph] || (byCaller[ph] = { phone: ph, first_at: at, rings: 0, answered: false, max_duration_s: 0 });
    c.rings++;
    if (at && (!c.first_at || at < c.first_at)) c.first_at = at;
    if (m.answered) c.answered = true;
    c.max_duration_s = Math.max(c.max_duration_s, Number(m.duration_s) || 0);
  }
  const callers = Object.values(byCaller);

  // Did each caller become a job? Match on the phone, then require the job to have been
  // created AFTER the call and inside the attribution window - a pre-existing warranty
  // customer who happened to dial the ads line is not a lead the ad produced.
  const out = { ok: true, days, spend: money, paid_calls: calls.length, unique_callers: callers.length, matched: 0, cash_jobs: 0, warranty_jobs: 0, leads: [] };

  for (const c of callers) {
    let job = null;
    try {
      const r = await fetch(`${XANO}/lookup_customer_by_phone?phone=${encodeURIComponent('+1' + c.phone)}`, { signal: AbortSignal.timeout(9000) });
      const d = await r.json().catch(() => ({}));
      const j = (d && (d.job || (Array.isArray(d.jobs) ? d.jobs[0] : null))) || null;
      if (j) {
        const created = Number(j.created_at || 0);
        // Unknown creation time is NOT a match - crediting the ad on a guess is how a
        // channel gets scaled on numbers that were never real.
        if (created && created >= c.first_at && (created - c.first_at) <= ATTRIB_WINDOW_MS) job = j;
      }
    } catch (_) {}
    if (job) {
      out.matched++;
      const warranty = !!String(job.warranty_company || '').trim();
      if (warranty) out.warranty_jobs++; else out.cash_jobs++;
      out.leads.push({ phone: '***-' + c.phone.slice(-4), rings: c.rings, answered: c.answered, job_id: job.id, warranty: warranty || undefined });
    } else {
      out.leads.push({ phone: '***-' + c.phone.slice(-4), rings: c.rings, answered: c.answered, job: null });
    }
  }

  const cost = Number(money.cost || 0);
  out.cost_per_call = callers.length ? Math.round((cost / callers.length) * 100) / 100 : null;
  out.cost_per_job = out.matched ? Math.round((cost / out.matched) * 100) / 100 : null;
  out.answered_rate = callers.length ? Math.round((callers.filter((c) => c.answered).length / callers.length) * 100) : null;
  if (!calls.length) {
    out.note = 'No google_ads_call rows yet. Logging went live 2026-09-13 — this fills as paid calls come in. Before that date the ads line was never recorded, which is why every outcome action reads 0.';
  }
  out.leads = out.leads.slice(0, 40);
  return json(200, out);
};
